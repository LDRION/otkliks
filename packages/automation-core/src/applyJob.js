/**
 * applyJob.js — оркестрация полного цикла для ОДНОГО резюме ОДНОГО арендатора: новые
 * вакансии → фильтр по уже виденным (storage) → сопроводительное (llmClient) → отклик
 * (browserCtx) → запись (storage) → уведомление (notifier).
 *
 * Обобщено из личного hhorosho: раньше storage/browser/llm/telegram были singleton-
 * импортами на process.env, теперь — параметры вызова, DI. Так cloud-worker подставляет
 * Mongoose-storage + tenant-браузер + Siberi/др. клиент, а local-agent — SQLite-storage +
 * локальный браузер + core-api-прокси-клиент, ОДНИМ И ТЕМ ЖЕ кодом.
 *
 * @typedef {Object} AutomationStorage
 * @property {(tenantId: string, resumeProfile: string) => Promise<number>} countAppliedToday
 * @property {(tenantId: string, resumeProfile: string, vacancyIds: string[]) => Promise<Set<string>>} findSeenVacancyIds
 * @property {(tenantId: string, companyKey: string) => Promise<boolean>} hasAppliedToCompany
 * @property {(tenantId: string) => Promise<string[]>} listNegotiationCompanies
 * @property {(tenantId: string, vacancyId: string, resumeProfile: string, fields: object) => Promise<void>} saveVacancy
 *
 * @typedef {Object} Notifier
 * @property {(payload: object) => Promise<void>} notifyApplied
 * @property {(message: string) => Promise<void>} notifyAlert
 */

// Коды причин человеку ничего не говорят, а именно по ним видно, почему за круг нет
// откликов. Без расшифровки «MODAL_NOT_FOUND» в ленте выглядит как сбой автопилота,
// хотя это чаще всего отклик через сайт работодателя.
const REASON_TEXT = {
  APPLY_BUTTON_NOT_FOUND: 'на странице нет кнопки «Откликнуться»',
  VACANCY_CLOSED: 'вакансия закрыта',
  MODAL_NOT_FOUND: 'hh не показал окно отклика — вероятно, отклик идёт через сайт работодателя',
  REQUIRES_SCREENING_QUESTIONS: 'работодатель требует заполнить анкету',
  LETTER_FORM_NOT_FOUND: 'в окне отклика не нашлось поля для письма',
  SUBMIT_BUTTON_NOT_FOUND: 'в окне отклика не нашлось кнопки отправки',
  SUBMIT_NOT_CONFIRMED: 'hh не подтвердил отправку',
  ALREADY_APPLIED: 'отклик уже был отправлен раньше',
};
const explainReason = (reason) => REASON_TEXT[reason] || reason;

const { fetchVacancyPool, fetchVacancyDescription } = require('./hh/vacancies');
const { runFormAgent } = require('./external/formAgent');
const { fetchResumeText, extractResumeId } = require('./hh/resume');
const { applyToVacancy } = require('./hh/apply');
const { generateCoverLetter } = require('./coverLetter');
const { getRatesRub } = require('./rates');
const {
  parseSalary, evaluateSalary, parseDesiredSalaryFromResume, toRub, formatSalary,
} = require('./salary');
const { assessVacancyFit } = require('./vacancyMatch');
const { loadExclusions } = require('./exclusions');
const { deriveSearchQueries } = require('./resumeProfile');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function randomDelayMs([minSec, maxSec]) {
  const sec = minSec + Math.random() * (maxSec - minSec);
  return Math.round(sec * 1000);
}

// Отрезаем организационно-правовую форму и всё после первой точки/запятой (у крупных
// компаний в названии вакансии часто отдел, например "Т-Банк. ИТ. Разработка" — для нас
// одна компания). Несколько откликов в одну компанию на практике дают тот же нулевой
// результат, что и один — только жгут дневной лимит и вызовы LLM впустую.
function normalizeCompanyName(name) {
  return String(name || '')
    .replace(/^(ООО|ОАО|ЗАО|АО|ПАО|ИП)\s+/i, '')
    .split(/[.,]/)[0]
    .trim()
    .toLowerCase();
}

/**
 * @param {{
 *   tenantId: string, resumeProfile: string, resumeLabel?: string, similarVacanciesUrl: string,
 *   browserCtx: object, storage: AutomationStorage, llmClient: object,
 *   profile: import('./coverLetter').TenantProfile, notifier: Notifier,
 *   dailyCap?: number, delayRangeSec?: [number, number],
 * }} opts
 * @returns {Promise<{processed: number, applied: number, skipped: number}>}
 */
async function runForResume(opts) {
  const {
    tenantId, resumeProfile, resumeLabel, similarVacanciesUrl, browserCtx, storage, llmClient,
    // Пауза между откликами — защита от бота-паттерна на hh.ru, не техническое
    // ограничение. Сужена с [20,90] по явному решению владельца аккаунта (осознанный
    // риск: быстрее, но заметнее для антибот-эвристик hh) — см. живой замер скорости
    // откликов в этой же сессии (21.6/час на [20,90] → нужно быстрее для ~200/6-8ч).
    profile, notifier, dailyCap = 40, delayRangeSec = [10, 30], searchQueries = [],
    // Согласие человека на заполнение форм за него. Без него анкеты hh и отклики на
    // сайтах работодателей по-прежнему просто пропускаются.
    externalStageEnabled = false,
    // Технический журнал лаунчера: сюда сыплем решения ИИ-фильтра и причины пропусков.
    log = () => {},
    // Проверяется между вакансиями (см. цикл ниже) — раньше кнопка «Остановить» гасила
    // только таймер СЛЕДУЮЩЕГО круга, а уже идущий прогон по всем свежим вакансиям
    // доигрывал до конца (реальные отклики продолжали уходить работодателям, пока UI уже
    // показывал «автопилот выключен»). Текущую вакансию (уже начатый отклик/письмо) не
    // прерываем — только не берём следующую.
    shouldStop = () => false,
  } = opts;

  // В тексты для человека подставляем название резюме («AI / LLM инженер»), а ключ
  // (vrvxk7vz) оставляем внутренним — он ничего не говорит и выглядит как сбой.
  const resumeName = resumeLabel || resumeProfile;

  const resumeId = extractResumeId(similarVacanciesUrl);

  log(`📋 Обрабатываю резюме "${resumeName}": URL="${similarVacanciesUrl.slice(0, 80)}...", запросы=[${searchQueries.slice(0, 3).join(', ')}...]`);

  // Два разных счётчика, и путать их нельзя: appliedToday сторожит дневной лимит и
  // живёт с прошлых прогонов, appliedNow — сколько отправлено ИМЕННО СЕЙЧАС. Раньше
  // наружу отдавался первый, и в логе лаунчера получалось «просмотрено 7, откликов 13»
  // — цифры из разных миров, читаются как сбой.
  const startedAt = Date.now();
  let appliedToday = await storage.countAppliedToday(tenantId, resumeProfile);
  let appliedNow = 0;
  if (appliedToday >= dailyCap) {
    log(`⏸ applyJob(${tenantId}/${resumeProfile}): дневной лимит ${dailyCap} уже исчерпан, жду завтра.`);
    return { processed: 0, applied: 0, appliedToday, skipped: 0, hasMore: false, poolSize: 0 };
  }

  // Текст резюме нужен и для запросов ниже, и для писем — грузим один раз, по требованию.
  let resumeText = null;
  const loadResumeText = async () => {
    if (!resumeText) resumeText = await fetchResumeText(browserCtx, similarVacanciesUrl);
    return resumeText;
  };

  // «Собери сам»: кроме названия резюме искать не по чему (стек в настройках не задан или
  // там заглушка) — поисковые запросы составляются по самому резюме. Живой случай: поиск
  // сводился к одному запросу на резюме, выдача кончалась за пару часов, и автопилот по
  // двадцать минут перебирал уже разобранное, не делая ни одного отклика.
  let queries = searchQueries;
  if (queries.length <= 1) {
    try {
      const { queries: derived, fresh } = await deriveSearchQueries({
        cacheKey: resumeId, resumeTitle: resumeName, loadResumeText, llmClient,
      });
      queries = [...new Set([...queries, ...derived])].slice(0, 8);
      if (fresh) log(`🧭 «${resumeName}»: поисковые запросы собраны по резюме — ${derived.join(', ')}`);
    } catch (e) {
      if (e.message === 'LOGGED_OUT') {
        return { processed: 0, applied: 0, appliedToday, skipped: 0, hasMore: false, poolSize: 0, loggedOut: true };
      }
      log(`⚠️ «${resumeName}»: не удалось собрать поисковые запросы по резюме (${e.message}) — `
        + 'пока ищу по названию резюме, попробую снова через полчаса.');
    }
  }

  let list;
  try {
    // Подборка под резюме плюс обычный поиск по профессии и стеку: одной подборки
    // хватает на пару прогонов, дальше автопилот простаивал бы с невыбранным лимитом.
    // filterFresh даёт сборщику остановиться, как только набралось достаточно
    // необработанных вакансий — иначе он каждый круг перелистывал бы все страницы
    // всех источников только чтобы выбросить уже виденное.

    if (!similarVacanciesUrl) {
      log(`⚠️  similarVacanciesUrl ПУСТО для резюме "${resumeName}"`);
    }
    if (!searchQueries || !searchQueries.length) {
      log(`⚠️  searchQueries ПУСТО для резюме "${resumeName}"`);
    }

    list = await fetchVacancyPool(browserCtx, {
      resumeInputUrl: similarVacanciesUrl,
      queries,
      log,
      filterFresh: async (items) => {
        const ids = items.map((v) => v.vacancyId);
        const seenIds = await storage.findSeenVacancyIds(tenantId, resumeProfile, ids);
        return items.filter((v) => !seenIds.has(v.vacancyId));
      },
    });
  } catch (e) {
    if (e.message === 'LOGGED_OUT') {
      return { processed: 0, applied: 0, appliedToday, skipped: 0, hasMore: false, poolSize: 0, loggedOut: true };
    }
    log(`⚠️ applyJob(${tenantId}/${resumeProfile}): не удалось получить список вакансий:`, e.message);
    return { processed: 0, applied: 0, appliedToday, skipped: 0, hasMore: false, poolSize: 0 };
  }

  // status:'error' НЕ считаем "виденной" — временная поломка (не факт, что вакансия
  // непригодна) — retryable, в отличие от 'applied'/'skipped' (терминальные состояния).
  const seenIds = await storage.findSeenVacancyIds(tenantId, resumeProfile, list.map((v) => v.vacancyId));
  const fresh = list.filter((v) => !seenIds.has(v.vacancyId));

  // MODAL_NOT_FOUND — не сбой, а свойство вакансии: после «Откликнуться» окно
  // отклика не появляется (например, отклик уходит на сайт работодателя). Повторять
  // такую вечно бессмысленно — помечаем терминально, как и другие пропуски.
  // VACANCY_CLOSED — приём откликов закрыт, кнопки не будет уже никогда.
  // Всё остальное (сеть, LLM, таймауты) по-прежнему перепроверяется на следующем круге —
  // а если сбой на деле окажется структурным (сломалась вёрстка), store.js даёт этому
  // ретраю потолок по времени (ERROR_RETRY_WINDOW_MS), а не вечность.
  const TERMINAL_REASONS = new Set(['MODAL_NOT_FOUND', 'VACANCY_CLOSED']);

  let processed = 0;
  let skipped = 0;
  let consecutiveErrors = 0;
  let alertedThisRun = false;
  let lastFailure = null;   // {title, reason} — в тревогу шла НЕ причина, а название вакансии
  let loggedOut = false;    // сессия hh.ru отвалилась — круг прерываем, наверх сообщаем один раз
  const CONSECUTIVE_ERROR_ALERT_THRESHOLD = 5;

  // Пол по зарплате: ниже него вакансии с указанной вилкой не откликаем. Приоритет —
  // ручной из профиля; если не задан, подхватываем «от какой ЗП» прямо из резюме hh.ru.
  // Курсы валют тянем один раз на прогон, чтобы «$3000»/«5000 €» сравнивать с полом в
  // рублях (rates.js кэширует и не падает без сети).
  const rates = await getRatesRub();
  const minSalary = profile && profile.minSalary;
  const manualFloorRub = minSalary && Number(minSalary.amount) > 0
    ? toRub(Number(minSalary.amount), minSalary.currency || 'RUB', rates)
    : null;
  // undefined — ещё не считали из резюме; null — считали, но там нет вилки.
  let resumeFloorRub;
  let resumeFloorText = '';
  // Текст ориентира для письма («рассматриваю от 250 000 ₽»): показываем только если
  // пол реально задан — иначе в письме про зарплату сказать нечего, кроме факта.
  const floorAmountText = manualFloorRub
    ? formatSalary(Number(minSalary.amount), minSalary.currency || 'RUB')
    : '';

  // Пол в рублях для конкретной вакансии. Ручной приоритетнее; иначе — из резюме
  // (резюме читаем один раз и переиспользуем, оно нужно и для письма).
  async function resolveFloorRub() {
    if (manualFloorRub != null) return manualFloorRub;
    if (resumeFloorRub !== undefined) return resumeFloorRub;
    if (!resumeText) resumeText = await fetchResumeText(browserCtx, similarVacanciesUrl);
    const desired = parseDesiredSalaryFromResume(resumeText);
    resumeFloorRub = desired ? toRub(desired.max ?? desired.min, desired.currency, rates) : null;
    resumeFloorText = desired ? formatSalary(desired.max ?? desired.min, desired.currency) : '';
    return resumeFloorRub;
  }

  // Компании, с которыми уже ЕСТЬ переписка на hh.ru (см. listNegotiationCompanies) —
  // источник правды шире, чем vacancies.hasAppliedToCompany: та таблица знает только
  // про отклики, отправленные ЭТИМ лаунчером, а тут — реальный список чатов hh.ru,
  // включая переписки, начавшиеся до того, как на этом компьютере вообще появился
  // автопилот (ручной отклик, старая версия и т.п.). Без этого автопилот повторно
  // откликался в компанию, с которой уже шёл (иногда месяцами не тронутый) диалог —
  // раз в run, не на каждую вакансию: список компаний за прогон не меняется.
  let negotiationCompanyKeys;
  try {
    negotiationCompanyKeys = new Set(
      (await storage.listNegotiationCompanies(tenantId)).map(normalizeCompanyName).filter(Boolean),
    );
  } catch (e) {
    log(`⚠️ applyJob(${tenantId}/${resumeProfile}): не удалось прочитать список переписок:`, e.message);
    negotiationCompanyKeys = new Set();
  }

  for (const item of fresh) {
    if (appliedToday >= dailyCap) {
      log(`⏸ applyJob(${tenantId}/${resumeProfile}): дневной лимит ${dailyCap} достигнут в процессе прогона.`);
      break;
    }
    if (shouldStop()) {
      log(`⏹ ${resumeName}: остановлено пользователем — прекращаю после уже начатого, новые вакансии не беру.`);
      break;
    }

    processed += 1;
    const companyKey = normalizeCompanyName(item.company);
    const base = { title: item.title, company: item.company, url: item.url, companyKey };
    const save = (fields) => storage.saveVacancy(tenantId, item.vacancyId, resumeProfile, { ...base, ...fields })
      .catch((e) => log(`⚠️ applyJob(${tenantId}/${resumeProfile}): не удалось записать (${item.title}):`, e.message));

    try {
      // «Исключения»: этому работодателю человек пишет сам — откликом не пишем. Без записи
      // в базу: уберут исключение — вакансия снова в игре.
      const isExcluded = await loadExclusions(storage, tenantId);
      const why = isExcluded({ vacancyId: item.vacancyId, company: item.company });
      if (why) {
        log(`🚫 «${item.title}»: «${item.company}» в ${why === 'blacklist' ? 'чёрном списке' : 'исключениях'} — не откликаюсь.`);
        skipped += 1;
        continue;
      }
      if (companyKey && (await storage.hasAppliedToCompany(tenantId, companyKey))) {
        await save({ status: 'skipped', skipReason: 'ALREADY_APPLIED_TO_COMPANY' });
        skipped += 1;
        continue;
      }
      if (companyKey && negotiationCompanyKeys.has(companyKey)) {
        log(`🧠 «${item.title}»: с «${item.company}» уже есть переписка на hh.ru — не откликаюсь повторно.`);
        await save({ status: 'skipped', skipReason: 'ALREADY_TALKING_TO_COMPANY' });
        skipped += 1;
        continue;
      }

      // Стажёр/практикант/trainee/intern — позиция ниже уровня кандидата с опытом: не
      // тратим на неё отклик. Дёшево и детерминированно (работает даже когда AI занят) и
      // экономит вызов LLM-фильтра. Более тонкую «переквалификацию» (junior) ловит уже LLM.
      if (/(?:стаж[её]р|практикант|trainee|\bintern\b)/i.test(item.title || '')) {
        log(`🧠 «${item.title}»: стажёрская позиция — при вашем опыте пропускаю.`);
        await save({ status: 'skipped', skipReason: 'OVERQUALIFIED' });
        skipped += 1;
        continue;
      }

      // Фильтр по зарплате — до загрузки описания и вызова LLM (это дёшево, а отсев
      // экономит и то, и другое). С карточки зарплата есть не всегда; если её нет,
      // добираем со страницы вакансии ниже. Вакансии без вилки не режем — по ним
      // откликаемся, а письмо об этом упоминает (см. salaryUnspecified).
      let salary = parseSalary(item.salaryRaw);
      if (salary) {
        const floorRub = await resolveFloorRub();
        const verdict = evaluateSalary(salary, floorRub, rates);
        if (!verdict.pass) {
          await save({ status: 'skipped', skipReason: 'SALARY_BELOW_MIN', salaryRaw: item.salaryRaw });
          skipped += 1;
          continue;
        }
      }

      const { description, alreadyApplied, salaryRaw: pageSalaryRaw } = await fetchVacancyDescription(browserCtx, item.url);

      if (alreadyApplied) {
        await save({ description, status: 'skipped', skipReason: 'ALREADY_APPLIED_ON_HH' });
        skipped += 1;
        continue;
      }

      // Карточка вилку не показала — пробуем со страницы вакансии (надёжный элемент).
      if (!salary && pageSalaryRaw) {
        salary = parseSalary(pageSalaryRaw);
        if (salary) {
          const floorRub = await resolveFloorRub();
          const verdict = evaluateSalary(salary, floorRub, rates);
          if (!verdict.pass) {
            await save({ description, status: 'skipped', skipReason: 'SALARY_BELOW_MIN', salaryRaw: pageSalaryRaw });
            skipped += 1;
            continue;
          }
        }
      }

      if (!resumeText) resumeText = await fetchResumeText(browserCtx, similarVacanciesUrl);

      // ИИ-отбор: сверяем требования вакансии с резюме. Откликаемся, только если стек
      // закрыт хотя бы наполовину и основной язык вакансии не чужой (чтобы не слать
      // отклики на PHP/1С, которых в резюме нет). Медленнее, зато по делу.
      const fit = await assessVacancyFit({
        resumeText, vacancyTitle: item.title, company: item.company,
        vacancyDescription: description, strongStack: profile.strongStack || [], llmClient,
      });
      // AI не смог оценить (перегрузка/таймаут) — НЕ откликаемся наугад и НЕ хороним вакансию:
      // пропускаем круг и вернёмся к ней, когда провайдер отпустит (иначе под нагрузкой AI
      // фильтр «открывался» и мы слали отклики на всё подряд).
      if (!fit.assessed) {
        log(`🧠 «${item.title}»: AI занят — не смог оценить соответствие, вернусь к вакансии позже.`);
        skipped += 1;
        continue; // без save → останется в пуле и переоценится следующим кругом
      }
      if (!fit.apply) {
        const why = fit.coreStackForeign ? ', основной стек чужой'
          : (fit.overqualified ? ', позиция ниже вашего уровня' : '');
        log(`🧠 «${item.title}»: не мой профиль — совпадение ${fit.matchPercent < 0 ? '?' : `${fit.matchPercent}%`}${why}. Пропуск. ${fit.reason}`);
        await save({ description, status: 'skipped', skipReason: 'SKILL_MISMATCH' });
        skipped += 1;
        continue;
      }
      log(`🧠 «${item.title}»: подходит (совпадение ${fit.matchPercent < 0 ? '?' : `${fit.matchPercent}%`}) — откликаюсь.`);

      // Для письма про неуказанную ЗП нужен ориентир кандидата. Если пол задан руками —
      // он уже в floorAmountText; иначе добираем «от» из резюме (resumeText уже загружен,
      // это просто разбор строки, memoized). Без этого ориентир в письме терялся бы.
      if (!salary && !floorAmountText) await resolveFloorRub();

      const coverLetterText = await generateCoverLetter(
        {
          resumeText, vacancyTitle: item.title, company: item.company, vacancyDescription: description,
          // Зарплата не указана нигде — письмо вежливо это упомянет и назовёт ориентир
          // кандидата, если он известен (ручной пол или «от» из резюме).
          salaryUnspecified: !salary,
          expectedSalaryText: floorAmountText || resumeFloorText,
        },
        profile,
        llmClient,
      );

      const result = await applyToVacancy(browserCtx, item.url, resumeId, coverLetterText);
      if (result.success) {
        log(`✅ Отклик отправлен: «${item.title}» — ${item.company}`
          + (result.relocation ? ' (вакансия в другой стране — hh спросил, подтвердил отклик)' : ''));
        await save({ description, coverLetterText, status: 'applied', appliedAt: new Date() });
        appliedToday += 1;
        appliedNow += 1;
        consecutiveErrors = 0;
        await notifier.notifyApplied({
          tenantId, resumeProfile, title: item.title, company: item.company, url: item.url, coverLetterText,
        });
        await sleep(randomDelayMs(delayRangeSec));
      } else if (result.reason === 'LOGGED_OUT') {
        loggedOut = true;
        break;
      } else if (
        externalStageEnabled
        && result.formUrl
        && ['REQUIRES_SCREENING_QUESTIONS', 'MODAL_NOT_FOUND'].includes(result.reason)
      ) {
        // Тут отклик не заканчивается окном на hh: работодатель просит заполнить
        // анкету или уводит на свой сайт. Раньше такие вакансии просто списывались —
        // а это почти половина всей выдачи. Пускаем того же агента, который проходит
        // формы из чата: для него это такая же форма.
        const agent = await runFormAgent(browserCtx, result.formUrl, {
          resumeText, vacancyTitle: item.title, company: item.company, profile, llmClient,
        }).catch((e) => ({ submitted: false, reason: e.message }));

        if (agent.submitted) {
          await save({ description, coverLetterText, status: 'applied', appliedAt: new Date() });
          appliedToday += 1;
          appliedNow += 1;
          consecutiveErrors = 0;
          await notifier.notifyApplied({
            tenantId, resumeProfile, title: item.title, company: item.company, url: item.url, coverLetterText,
          });
          if (agent.fields?.length) {
            await notifier.notifyFormFilled?.({
              vacancyTitle: item.title, company: item.company,
              formTitle: 'Анкета работодателя', url: result.formUrl, fields: agent.fields,
            });
          }
          await sleep(randomDelayMs(delayRangeSec));
        } else {
          // Раньше эта ветка молчала: в ленте было «подходит — откликаюсь», а дальше ничего,
          // и вакансия тихо уходила в «пропущено». Живой разбор за сутки: 11 подходящих
          // вакансий потеряно так против 10 отправленных откликов.
          const why = `агент анкет не справился: ${agent.reason || 'без причины'}`;
          log(`⏭ «${item.title}»: ${explainReason(result.reason)} — ${why}`);
          await save({
            description, coverLetterText, status: 'skipped', skipReason: result.reason,
            skipDetail: [why, result.detail].filter(Boolean).join('; '),
          });
          skipped += 1;
        }
      } else if (result.reason === 'ALREADY_APPLIED' || result.reason === 'REQUIRES_SCREENING_QUESTIONS') {
        await save({ description, coverLetterText, status: 'skipped', skipReason: result.reason });
        skipped += 1;
        log(`⏭ «${item.title}»: пропуск — ${explainReason(result.reason)}`
          + (result.reason === 'REQUIRES_SCREENING_QUESTIONS' && !externalStageEnabled
            ? ' (автозаполнение анкет выключено в настройках)' : ''));
      } else if (TERMINAL_REASONS.has(result.reason)) {
        await save({ description, coverLetterText, status: 'skipped', skipReason: result.reason, skipDetail: result.detail });
        skipped += 1;
        log(`⏭ «${item.title}»: пропуск — ${explainReason(result.reason)}${result.detail ? ` (${result.detail})` : ''}`);
      } else {
        await save({ description, coverLetterText, status: 'error', skipReason: result.reason, skipDetail: result.detail });
        log(`⚠️ «${item.title}»: отклик не ушёл — ${explainReason(result.reason)}${result.detail ? ` (${result.detail})` : ''}`);
        lastFailure = { title: item.title, reason: result.reason };
        consecutiveErrors += 1;
      }
    } catch (e) {
      // Сессия hh.ru может отвалиться на любом шаге — при чтении описания вакансии
      // тоже. Раньше это считалось обычной ошибкой, круг доходил до пятой подряд и
      // слал «5 вакансий не удалось обработать», а следующий круг повторял всё
      // заново — отсюда одинаковые уведомления каждые несколько минут.
      if (e.message === 'LOGGED_OUT') {
        loggedOut = true;
        break;
      }
      await save({ status: 'error', skipReason: e.message.slice(0, 200) });
      log(`⚠️ «${item.title}»: ошибка — ${e.message.slice(0, 160)}`);
      lastFailure = { title: item.title, reason: e.message.slice(0, 120) };
      consecutiveErrors += 1;

      // Ошибки LLM (таймаут/затор/rate-limit) — не долбим следующую вакансию сразу же.
      if (/Siberi|LLM|generate/i.test(e.message)) {
        await sleep(30000);
      }
    }

    // Саму тревогу поднимает планировщик: круги идут раз в полторы минуты, и «раз за
    // прогон» превращалось в одинаковое уведомление каждые несколько минут. Здесь
    // только фиксируем факт серии.
    if (consecutiveErrors >= CONSECUTIVE_ERROR_ALERT_THRESHOLD) {
      alertedThisRun = true;
    }
  }

  // hasMore говорит планировщику, идти ли на следующий круг сразу. Идём, если лимит
  // ещё не выбран И в этом прогоне была работа: значит поток вакансий есть, и ждать
  // десять минут незачем. Пустой прогон — наоборот, повод выдержать обычную паузу.
  // Непройденная глубина выдачи — тоже работа: иначе после «пустого» круга ждали бы
  // десять минут, хотя дальше вглубь лежат вакансии, которых автопилот ещё не видел.
  const hasMore = appliedToday < dailyCap && (processed > 0 || Boolean(list.deepPending));
  return {
    processed, applied: appliedNow, appliedToday, skipped, hasMore: hasMore && !loggedOut, loggedOut,
    failureStreak: alertedThisRun ? consecutiveErrors : 0,
    lastFailure,
    poolSize: list.length, freshCount: fresh.length, deepPending: Boolean(list.deepPending),
    tookSec: Math.round((Date.now() - startedAt) / 1000),
  };
}

module.exports = { runForResume, normalizeCompanyName };
