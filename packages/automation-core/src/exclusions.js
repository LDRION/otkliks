/**
 * exclusions.js — кому автопилот не пишет (лаунчер 1.0.22).
 *
 * «Исключения» — переписки и вакансии, которые человек ведёт сам: { negotiationId?,
 * vacancyId?, company? }. «Чёрный список» — компании, от которых человек ничего не хочет:
 * { company, word?, broad }. В обоих случаях этому работодателю автопилот не пишет НИЧЕГО:
 * ни ответов в чат, ни откликов, ни анкет, ни доставки ответов из «Нужен ваш ответ».
 * Исключённый тред он даже не открывает — иначе hh снял бы у человека «непрочитано».
 *
 * Компания сравнивается так же, как при откликах (normalizeCompanyName). Запись чёрного
 * списка с broad — «и всё связанное по названию»: любая компания, в названии которой есть
 * её главное слово («Яндекс Директ» → всё со словом «яндекс»: Яндекс, Яндекс.Маркет, ЯндексGO).
 * Списки читаем заново на каждой проверке: человек мог добавить запись посреди круга.
 */

function companyKey(name) {
  // Ленивый require: applyJob сам подключает этот модуль.
  return require('./applyJob').normalizeCompanyName(String(name || '').replace(/[«»"“”„']/g, ''));
}

// Название целиком в нижнем регистре, без кавычек и формы собственности — для поиска слова.
function plainName(name) {
  return String(name || '').replace(/[«»"“”„']/g, ' ')
    .replace(/(^|\s)(?:ООО|ОАО|ЗАО|АО|ПАО|ИП|ГК|НКО|АНО)(?=\s)/gi, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

// Слова, по которым «связанное по названию» искать бессмысленно: совпадёт полрынка.
const GENERIC = new Set(['мой', 'моя', 'моё', 'наш', 'наша', 'наше', 'первый', 'первая', 'новый', 'новая', 'группа',
  'компания', 'компаний', 'холдинг', 'центр', 'банк', 'студия', 'агентство', 'лаборатория', 'технологии',
  'сервис', 'системы', 'решения', 'проект', 'школа', 'клиника', 'завод', 'фабрика', 'медицинский',
  'интернет', 'digital', 'group', 'company', 'the', 'it', 'ай', 'айти', 'гк', 'ооо', 'ао']);

/** Главное слово названия: «Яндекс Директ» → «яндекс», «Т-Банк» → «т-банк». */
function brandWord(name) {
  const words = plainName(name).split(/[\s.,()/]+/).map((w) => w.replace(/^[^а-яёa-z0-9]+|[^а-яёa-z0-9]+$/gi, '')).filter(Boolean);
  // Одни общие слова («Мой медицинский центр») — ищем название целиком, а не «мой».
  return words.find((w) => w.length >= 3 && !GENERIC.has(w)) || words.join(' ');
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * @returns {Promise<(target: { negotiationId?: string, vacancyId?: string, company?: string }) => false|'excluded'|'blacklist'>}
 */
async function loadExclusions(storage, tenantId) {
  const rows = (typeof storage.getExclusions === 'function' ? await storage.getExclusions(tenantId) : []) || [];
  const black = (typeof storage.getBlacklist === 'function' ? await storage.getBlacklist(tenantId) : []) || [];
  const negotiationIds = new Set(rows.map((r) => r.negotiationId).filter(Boolean).map(String));
  const vacancyIds = new Set(rows.map((r) => r.vacancyId).filter(Boolean).map(String));
  const companies = new Set(rows.map((r) => companyKey(r.company)).filter(Boolean));
  const blackExact = new Set(black.filter((b) => !b.broad).map((b) => companyKey(b.company)).filter(Boolean));
  const blackWords = black.filter((b) => b.broad).map((b) => b.word || brandWord(b.company)).filter(Boolean)
    .map((w) => new RegExp(`(?:^|[^а-яёa-z0-9])${escapeRe(w)}`, 'i'));
  return ({ negotiationId, vacancyId, company } = {}) => {
    if ((negotiationId && negotiationIds.has(String(negotiationId)))
      || (vacancyId && vacancyIds.has(String(vacancyId)))
      || (company && companies.has(companyKey(company)))) return 'excluded';
    if (company && (blackExact.has(companyKey(company)) || blackWords.some((re) => re.test(plainName(company))))) return 'blacklist';
    return false;
  };
}

module.exports = { loadExclusions, brandWord };
