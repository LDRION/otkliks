/**
 * formAnswers.js — ответы на вопросы внешней анкеты по резюме кандидата.
 *
 * Работодатели всё чаще вместо переписки кидают ссылку на форму: «заполните анкету и
 * мы вернёмся». Для кандидата это тот же скрининг, только руками и в другом окне —
 * ровно та работа, ради которой автопилот и существует.
 *
 * Отдельно от заполнения формы: здесь только текст → ответы, без браузера. Так это
 * тестируется без сети и переиспользуется для любой формы, не только Google.
 */

const { normalizeTelegram } = require('../replyAgent');

const KNOWLEDGE_TEST_HINTS = [
  /тест(?:овое)? задание|проверк[аи] знаний|экзамен|викторин/i,
  /выберите правильный ответ|правильных ответов|баллов за/i,
  /реши(?:те)? задач|напишите код|что выведет|сложность алгоритма/i,
];

/**
 * Похоже ли на проверку знаний, а не на анкету о кандидате.
 *
 * Разница принципиальная. Анкета спрашивает факты о человеке (опыт, зарплата, город,
 * готовность выйти) — их автопилот знает из резюме и заполняет за кандидата с его
 * ведома. Тест проверяет самого кандидата: пройти его вместо человека — значит
 * привести его на собеседование с чужим результатом, где это вскроется в первые же
 * минуты. Такие формы отдаём человеку.
 */
function looksLikeKnowledgeTest({ title = '', questions = [] }) {
  const haystack = [title, ...questions.map((q) => q.title)].join('\n');
  return KNOWLEDGE_TEST_HINTS.some((re) => re.test(haystack));
}

function buildSystemPrompt(profile) {
  const name = String(profile.fullName || '').trim();
  const email = String(profile.email || '').trim();
  const tg = normalizeTelegram(profile.contactTelegram);
  const strongList = (profile.strongStack || []).join(', ');
  return `Ты заполняешь анкету работодателя от имени ${name || 'кандидата'} — по фактам из его резюме.

Правила:
- Отвечай ТОЛЬКО тем, что есть в резюме или прямо следует из него. Не выдумывай компании,
  цифры, даты, сертификаты.
- Сильный стек кандидата: ${strongList || 'см. резюме'}. Про технологии из этого списка отвечай
  уверенно, без "мало опыта", даже если конкретный инструмент не назван в резюме буквально.
- Email кандидата: ${email || 'неизвестен'}. Используй его для полей "почта"/"email".
- Остальные контактные данные (имя, город) бери из резюме как есть. Телефон в резюме не
  публикуется и тебе недоступен — если форма его спрашивает, это честно неизвестный факт.
- Telegram кандидата: ${tg || 'неизвестен'}. ${tg ? 'Используй его для полей «Telegram»/«ник в телеграм»/«мессенджер».' : 'Если форма его спрашивает — это честно неизвестный факт.'}
  НИКОГДА не подставляй вместо него ники, ботов, каналы и ссылки из резюме — это проекты, не контакты.
- Для вопросов с вариантами выбирай ТОЧНОЕ значение из предложенных — не придумывай своё.
- Если данных для ответа нет и вопрос обязательный — по умолчанию дай нейтральный
  честный ответ ("обсудим на созвоне"), а не выдуманный факт.
- ИСКЛЮЧЕНИЕ из правила выше: если у поля указан формат email/tel/number/date/url —
  это структурированное поле, а не текст, и нейтральная фраза туда не может уйти
  физически ("обсудим на созвоне" в поле email выглядит как поломка, а не ответ).
  Для таких полей при отсутствии данных верни их в unanswered, а не в answers.
- Никакого markdown, только простой текст.

Верни СТРОГО JSON без пояснений и без блоков кода:
{"answers":[{"id":"<id вопроса>","value":"<ответ>"}],"unanswered":[{"id":"<id>","why":"<почему не смог>"}]}
Для чекбоксов value — массив строк. Для остальных типов — строка.`;
}

function buildUserPrompt({ resumeText, vacancyTitle, company, form }) {
  const questions = form.questions.map((q) => {
    const opts = q.options && q.options.length ? `\n   варианты: ${q.options.join(' | ')}` : '';
    const format = q.format && q.format !== 'text' && q.format !== 'search' ? `, формат: ${q.format}` : '';
    return `- id=${q.id} [${q.type}${format}${q.required ? ', обязательный' : ''}] ${q.title}${opts}`;
  }).join('\n');

  return [
    'РЕЗЮМЕ КАНДИДАТА:',
    resumeText,
    '',
    vacancyTitle ? `ВАКАНСИЯ: ${vacancyTitle}${company ? ` — ${company}` : ''}` : '',
    '',
    `АНКЕТА: ${form.title || 'без названия'}`,
    form.description ? `Описание: ${form.description}` : '',
    'ВОПРОСЫ:',
    questions,
  ].filter(Boolean).join('\n');
}

/** Достаём JSON, даже если модель обернула его в ```json — бывает у любых моделей. */
function parseAnswers(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('в ответе модели нет JSON');
  const parsed = JSON.parse(raw.slice(start, end + 1));
  return {
    answers: Array.isArray(parsed.answers) ? parsed.answers : [],
    unanswered: Array.isArray(parsed.unanswered) ? parsed.unanswered : [],
  };
}

async function generateFormAnswers({ form, resumeText, vacancyTitle, company }, profile, llmClient) {
  const { text } = await llmClient.ask(
    buildSystemPrompt(profile),
    buildUserPrompt({ resumeText, vacancyTitle, company, form }),
    { timeoutMs: 300000, kind: 'form_fill' },
  );
  return parseAnswers(text);
}

module.exports = { generateFormAnswers, looksLikeKnowledgeTest, parseAnswers, buildSystemPrompt, buildUserPrompt };
