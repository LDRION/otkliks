/**
 * resumeProfile.js — «собери сам»: стек и поисковые запросы берутся из самого резюме.
 *
 * Живой случай: в поле «сильный стек» человек написал «Собери сам», в «честных
 * пробелах» — «Никаких». Система понимала это буквально: каждый круг искала на hh
 * вакансии по фразе «Собери сам», а в промпты писем и оценки уходило «сильный стек:
 * Собери сам». Поиск по сути сводился к одному запросу на резюме, выдача кончалась
 * за пару часов, и автопилот по двадцать минут перебирал разобранное, ничего не делая.
 */

// Заглушки вместо списка: «собери сам», «нет», «никаких», прочерк и т.п.
const PLACEHOLDER_RE = /^(?:собери[\s-]*сам[а-я]*|сам[аио]?|авто[а-я]*|из резюме|по резюме|нет|никаких|никакие|ничего|не знаю|любой|любые|все|-+|—|\.+|\?+)$/i;

/** Список из профиля без заглушек: пустой массив значит «не задано — бери из резюме». */
function cleanProfileList(list) {
  return (Array.isArray(list) ? list : [])
    .map((s) => String(s || '').trim())
    .filter((s) => s && !PLACEHOLDER_RE.test(s));
}

// Резюме правят нечасто, а вызов модели на каждый круг — лишняя цена. Полсуток — чтобы
// правка резюме на hh подхватилась в тот же день, без перезапуска лаунчера.
const QUERIES_TTL_MS = 12 * 60 * 60 * 1000;
// После неудачи не долбим модель каждый круг: работаем по названию резюме и пробуем снова позже.
const FAILURE_TTL_MS = 30 * 60 * 1000;
const cache = new Map(); // cacheKey → { at, queries, failed }

const SYSTEM = `Ты помогаешь искать вакансии на hh.ru. По резюме составь 6 поисковых запросов — таких,
какие человек вводит в строку поиска hh: 2–4 слова, должность и/или ключевая технология
(например «Python разработчик», «LLM инженер», «Node.js backend»). Запросы должны находить
вакансии, на которые этот кандидат реально подходит по основному стеку, и не повторять друг
друга. Название резюме дословно не используй — оно уже ищется отдельно.
Верни ТОЛЬКО JSON-массив строк, без пояснений.`;

function parseQueries(raw) {
  const m = String(raw || '').match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr
      .map((q) => String(q || '').replace(/\s+/g, ' ').trim())
      .filter((q) => q.length >= 2 && q.length <= 60 && !PLACEHOLDER_RE.test(q)))];
  } catch {
    return [];
  }
}

/**
 * Поисковые запросы по тексту резюме. Кешируются на полсуток по cacheKey (id резюме).
 * loadResumeText зовётся только на промахе кеша — страница резюме не грузится каждый круг.
 * @returns {Promise<{ queries: string[], fresh: boolean }>} fresh — только что составлены
 *   (для строки в ленте: сообщаем один раз, а не каждый круг).
 */
async function deriveSearchQueries({ cacheKey, resumeTitle, loadResumeText, llmClient }) {
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < (hit.failed ? FAILURE_TTL_MS : QUERIES_TTL_MS)) {
    return { queries: hit.queries, fresh: false };
  }
  try {
    const resumeText = await loadResumeText();
    const { text } = await llmClient.ask(
      SYSTEM,
      `НАЗВАНИЕ РЕЗЮМЕ: ${resumeTitle}\n\nРЕЗЮМЕ:\n${String(resumeText || '').slice(0, 12000)}`,
      { timeoutMs: 120000, kind: 'search_queries' },
    );
    const title = String(resumeTitle || '').trim().toLowerCase();
    const queries = parseQueries(text).filter((q) => q.toLowerCase() !== title).slice(0, 6);
    if (!queries.length) throw new Error('модель не вернула запросов');
    cache.set(cacheKey, { at: Date.now(), queries });
    return { queries, fresh: true };
  } catch (e) {
    // Разлогин — не повод откладывать попытку на полчаса: пусть решает вызывающий.
    if (e.message !== 'LOGGED_OUT') cache.set(cacheKey, { at: Date.now(), queries: [], failed: true });
    throw e;
  }
}

module.exports = { cleanProfileList, deriveSearchQueries, parseQueries };
