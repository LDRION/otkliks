/**
 * resumeInput.js — приводит то, что человек вставил в поле «резюме», к рабочему виду.
 *
 * Зачем: раньше поле требовало ссылку на страницу «Похожие вакансии», а вставляют туда,
 * естественно, ссылку на само резюме — она под рукой и выглядит как «ссылка на резюме».
 * Разницы между ними снаружи не видно, автопилот молча открывал страницу резюме, карточек
 * вакансий там нет, и он не отправлял НИ ОДНОГО отклика. Ошибки при этом тоже не было —
 * просто ноль.
 *
 * Теперь принимаем любой из вариантов, потому что идентификатор резюме во всех один:
 *   • https://hh.ru/resume/<id>                        (и любой региональный поддомен)
 *   • https://hh.ru/search/vacancy?resume=<id>&…       (прежний формат «похожих вакансий»)
 *   • сам <id>
 *
 * Адрес поиска собираем сами. Формат проверен на живом hh.ru 23.08.2026:
 * /search/vacancy?resume=<id>&from=resumelist отдаёт список вакансий, подобранных под
 * это резюме.
 */

const ID_RE = /[a-f0-9]{32,40}/i;

function extractResumeId(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Ссылка на резюме не задана');

  // Сначала явный параметр — если это уже адрес «похожих вакансий».
  const byParam = /[?&]resume=([a-f0-9]+)/i.exec(raw);
  if (byParam) return byParam[1];

  // Затем путь /resume/<id> — то, что человек копирует из адресной строки.
  const byPath = /\/resume\/([a-f0-9]+)/i.exec(raw);
  if (byPath) return byPath[1];

  // И наконец голый идентификатор.
  const bare = ID_RE.exec(raw);
  if (bare && bare[0] === raw) return raw;

  throw new Error(`Не похоже на ссылку на резюме hh.ru: ${raw.slice(0, 80)}`);
}

/**
 * Адрес списка вакансий, подобранных hh.ru под это резюме.
 *
 * page/itemsOnPage появились, когда стало ясно, откуда «застой»: бралась ровно одна
 * страница выдачи по 20 карточек, и как только автопилот их обработал, свежих вакансий
 * не оставалось до тех пор, пока hh.ru не опубликует новые. Пул кандидатов упирался не
 * в дневной лимит, а в размер одной страницы.
 */
function toSearchUrl(input, { page = 0, itemsOnPage = 50 } = {}) {
  const params = new URLSearchParams({
    resume: extractResumeId(input),
    from: 'resumelist',
    items_on_page: String(itemsOnPage),
  });
  if (page > 0) params.set('page', String(page));
  return `https://hh.ru/search/vacancy?${params.toString()}`;
}

/** Адрес самой страницы резюме — оттуда читается его текст. */
function toResumeUrl(input) {
  return `https://hh.ru/resume/${extractResumeId(input)}`;
}

/** Годится ли строка как ссылка на резюме — для проверки в интерфейсе. */
function isValidResumeInput(input) {
  try {
    extractResumeId(input);
    return true;
  } catch {
    return false;
  }
}

module.exports = { extractResumeId, toSearchUrl, toResumeUrl, isValidResumeInput };
