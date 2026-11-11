/**
 * externalStage.js — этапы, которые работодатель выносит за пределы hh.ru.
 *
 * Всё чаще ответ в чате выглядит так: «спасибо за отклик, заполните анкету по ссылке»
 * или «напишите нашему боту в телеграм». Формально отклик отправлен, фактически
 * кандидат стоит на месте, пока не сделает ещё один шаг руками. Задача автопилота —
 * довести до собеседования, значит такие шаги он закрывает сам: открывает ссылку в том
 * же браузере, читает вопросы, отвечает по резюме и отправляет.
 *
 * Два движка под одним конвейером: Google Forms (своя разметка на ARIA-ролях) и всё
 * остальное — Яндекс.Формы, Typeform, страницы «откликнуться» на сайтах компаний, где
 * под капотом обычный HTML. Дальше по конвейеру разницы между источниками нет.
 *
 * Что НЕ делаем и отдаём человеку:
 *   • проверки знаний и тестовые задания — результат должен быть кандидата, иначе он
 *     придёт на собеседование с чужим и это вскроется в первые минуты;
 *   • капчу — сайт прямым текстом просит убедиться, что перед ним человек;
 *   • формы входа, загрузку файлов — нужен живой человек;
 *   • телеграм-каналы и боты — действие неоднозначное, цена ошибки выше экономии минут.
 */

const googleForm = require('./googleForm');
const genericForm = require('./genericForm');
const { runFormAgent } = require('./formAgent');
const { generateFormAnswers, looksLikeKnowledgeTest } = require('./formAnswers');

const GOOGLE_FORM_RE = /(?:forms\.gle|docs\.google\.com\/forms)/i;
const YANDEX_FORM_RE = /(?:forms\.yandex|yandex\.ru\/forms)/i;
const TYPEFORM_RE = /typeform\.com/i;
const TELEGRAM_RE = /(?:t\.me|telegram\.me)/i;
const HH_RE = /(?:^|\/\/)(?:[a-z0-9-]+\.)?hh\.ru/i;

function classifyLink(url) {
  const raw = String(url || '');
  if (GOOGLE_FORM_RE.test(raw)) return 'google_form';
  if (YANDEX_FORM_RE.test(raw)) return 'yandex_form';
  if (TYPEFORM_RE.test(raw)) return 'typeform';
  if (TELEGRAM_RE.test(raw)) return 'telegram';
  if (HH_RE.test(raw)) return 'hh';
  return 'other';
}

const HUMAN_REASON = {
  KNOWLEDGE_TEST: 'это проверка знаний, а не анкета — проходить должен сам кандидат',
  REQUIRES_GOOGLE_SIGN_IN: 'форма открывается только для вошедших в Google — войдите один раз'
    + ' в «Настройках» → «Аккаунты для анкет», и дальше такие анкеты заполнятся сами',
  REQUIRES_LOGIN: 'страница просит войти в аккаунт — если это Google или Яндекс,'
    + ' войдите в «Настройках» → «Аккаунты для анкет», и анкета откроется автопилоту',
  REQUIRES_CAPTCHA: 'страница защищена капчей — её проходит только человек',
  PLAN_PARSE_FAILED: 'не удалось разобрать ответ модели по этой форме',
  DRY_RUN: 'проверочный прогон без отправки',
  REQUIRES_FILE_UPLOAD: 'в форме нужно приложить файл',
  NO_QUESTIONS_FOUND: 'по ссылке не нашлось анкеты — нужен ваш взгляд',
  REQUIRED_UNANSWERED: 'на обязательные вопросы не нашлось ответа в резюме',
  NO_CONFIRMATION: 'форма не подтвердила отправку',
  TELEGRAM: 'нужен переход в телеграм — это шаг для человека',
};

function engineFor(kind) {
  if (kind === 'google_form') return googleForm;
  // Яндекс.Формы, Typeform и произвольные страницы — обычный HTML.
  return genericForm;
}

/**
 * Проходит внешние этапы по ссылкам из сообщения работодателя.
 *
 * @returns {{ passed: Array<{url, title, filled}>, escalated: Array<{url, why, title?}> }}
 */
async function runExternalStage(opts) {
  const { links = [], browserCtx, llmClient, profile, resumeText, vacancyTitle, company } = opts;
  const passed = [];
  const escalated = [];

  for (const url of links) {
    const kind = classifyLink(url);

    if (kind === 'hh') continue;               // ссылка назад на вакансию — не этап
    if (kind === 'telegram') {
      escalated.push({ url, why: HUMAN_REASON.TELEGRAM });
      continue;
    }

    const engine = engineFor(kind);

    let form;
    try {
      form = await engine.readForm(browserCtx, url);
    } catch (e) {
      escalated.push({ url, why: `не удалось открыть страницу: ${e.message}` });
      continue;
    }

    if (form.blocked) {
      escalated.push({ url, title: form.title, why: HUMAN_REASON[form.blocked] || form.blocked });
      continue;
    }

    if (looksLikeKnowledgeTest(form)) {
      escalated.push({ url, title: form.title, why: HUMAN_REASON.KNOWLEDGE_TEST });
      continue;
    }

    let answers;
    try {
      const generated = await generateFormAnswers(
        { form, resumeText, vacancyTitle, company },
        profile,
        llmClient,
      );
      answers = generated.answers;
    } catch (e) {
      escalated.push({ url, title: form.title, why: `не удалось подготовить ответы: ${e.message}` });
      continue;
    }

    let result;
    try {
      result = await engine.fillAndSubmit(browserCtx, url, answers);
    } catch (e) {
      escalated.push({ url, title: form.title, why: `не удалось заполнить: ${e.message}` });
      continue;
    }

    if (result.submitted) {
      passed.push({ url, title: form.title, filled: result.filled, fields: result.fields || [] });
      continue;
    }

    // Быстрый разбор не справился — пускаем агента. Он смотрит на страницу как есть и
    // сам решает, что заполнять и куда нажимать, поэтому берёт формы, под которые у нас
    // нет и не может быть готового разбора: чужие конструкторы, многошаговые опросники,
    // формы с условными вопросами.
    const agent = await runFormAgent(browserCtx, url, {
      resumeText, vacancyTitle, company, profile, llmClient,
    }).catch((e) => ({ submitted: false, reason: e.message }));

    if (agent.submitted) {
      passed.push({
        url, title: form.title, byAgent: true,
        filled: (agent.fields || []).length || (agent.actions || []).length,
        fields: agent.fields || [],
      });
      continue;
    }

    const why = HUMAN_REASON[agent.reason] || HUMAN_REASON[result.reason]
      || agent.reason || result.reason || 'форма не отправилась';
    escalated.push({
      url,
      title: form.title,
      why: result.missed && result.missed.length
        ? `${why}: ${result.missed.slice(0, 3).join('; ')}`
        : why,
    });
  }

  return { passed, escalated };
}

module.exports = { runExternalStage, classifyLink, engineFor, HUMAN_REASON };
