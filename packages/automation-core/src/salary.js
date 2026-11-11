/**
 * salary.js — разбор зарплат из карточек вакансий hh.ru и сравнение с полом кандидата.
 *
 * Зачем: человек в профиле указывает «рассматриваю от N» (в ₽/$/€), а работодатели
 * пишут вилку как угодно — «от 200 000 ₽», «100 000 – 150 000 ₽ на руки», «$3000»,
 * «до 5000 €», «180000-250000 руб.». Чтобы решать, откликаться или нет, всё приводим
 * к рублям (rates.js) и сравниваем с полом.
 *
 * Две вещи, ради которых это писалось:
 *  - вакансии БЕЗ указанной зарплаты — не отсекаем, откликаемся, а письмо об этом
 *    упоминает (applyJob → coverLetter);
 *  - $ и € понимаем и переводим в рубли, чтобы «$3000» корректно сравнивалось с
 *    полом, заданным в рублях (и наоборот).
 */

// Пробелы-разделители разрядов у hh бывают разные: обычный, неразрывный, тонкий,
// узкий неразрывный, figure space. Все они склеивают «200 000» в «200000».
const SEP = '\\s\\u00A0\\u202F\\u2009\\u2007';
const DIGIT_SEP = new RegExp(`(\\d)[${SEP}](\\d)`, 'g');

/** Валюта из символов/слов. hh для РФ-вакансий по умолчанию рубли, поэтому null → RUB. */
function detectCurrency(s) {
  if (/\$|\busd\b|долл/i.test(s)) return 'USD';
  if (/€|\beur\b|евро/i.test(s)) return 'EUR';
  if (/₽|руб|\bр\.?\b|\brub\b/i.test(s)) return 'RUB';
  return null;
}

/**
 * @param {string} raw — текст зарплаты из карточки вакансии
 * @returns {{ min: number|null, max: number|null, currency: 'RUB'|'USD'|'EUR' } | null}
 *   null — зарплата не указана / не распозналась.
 */
function parseSalary(raw) {
  const s0 = String(raw || '').trim();
  if (!s0) return null;
  // Явные «не указана»: на hh встречается «Уровень дохода не указан», «по договорённости».
  if (/не\s*указан|договор[её]нност|по\s*договор|not\s*specified/i.test(s0)) return null;

  // Склеиваем разряды: «200 000» → «200000» (несколько проходов — на «1 200 000»).
  let s = s0;
  for (let i = 0; i < 4; i += 1) s = s.replace(DIGIT_SEP, '$1$2');

  // Карточка зарплаты изолирована (только сумма и валюта), поэтому берём все числа
  // от 100 — стороннего мусора вроде возраста в этой ячейке не бывает.
  const nums = (s.match(/\d+/g) || []).map(Number).filter((n) => n >= 100);
  if (!nums.length) return null;

  const currency = detectCurrency(s0) || 'RUB';
  // Убираем оговорки «до вычета/после вычета/на руки/gross/net» — в них есть «до»,
  // которое иначе прочиталось бы как «до Y». И не полагаемся на \b: границы слова в
  // JS считаются по латинице, для кириллических «от»/«до» он не срабатывает вовсе.
  const clean = s0.replace(/до\s*вычета[^,;]*|после\s*вычета[^,;]*|на\s*руки|gross|net/gi, ' ');
  const hasFrom = /(?<![а-яё])от(?![а-яё])/i.test(clean) || /\bfrom\b/i.test(clean);
  const hasTo = /(?<![а-яё])до(?![а-яё])/i.test(clean) || /\bup\s*to\b/i.test(clean);

  let min = null;
  let max = null;
  if (nums.length >= 2) {
    // Вилка «X – Y» (в т.ч. «от X до Y»): границы по величине, а не по порядку слов.
    min = Math.min(nums[0], nums[1]);
    max = Math.max(nums[0], nums[1]);
  } else if (hasTo && !hasFrom) {
    max = nums[0]; // «до Y» — потолок известен, пола нет
  } else if (hasFrom && !hasTo) {
    min = nums[0]; // «от X» — пол известен, потолок открыт
  } else {
    min = nums[0];
    max = nums[0]; // единичное значение
  }
  return { min, max, currency };
}

/** Сумма в рубли по курсам rates ({ RUB:1, USD:.., EUR:.. }). */
function toRub(amount, currency, rates) {
  if (amount == null || Number.isNaN(amount)) return null;
  const rate = (rates && rates[currency]) || 1;
  return Math.round(amount * rate);
}

/**
 * Проходит ли вакансия по полу кандидата.
 *  - salary === null (не указана) → пропускаем фильтр, но помечаем unspecified:
 *    на такие откликаемся, а письмо об этом упомянет.
 *  - пол не задан (floorRub ≤ 0) → откликаемся на всё.
 *  - иначе берём ВЕРХНЮЮ известную границу (max, иначе min) в рублях и сравниваем с
 *    полом: вакансию отсекаем только если она заведомо не дотягивает до пола. «от X»
 *    без потолка = верхняя граница X (её и сравниваем с полом).
 *
 * @returns {{ pass: boolean, unspecified: boolean, ceilingRub?: number }}
 */
// Допуск вниз: вакансию с указанной вилкой отсекаем, только если её потолок ниже пола
// БОЛЬШЕ чем на эту сумму. Владелец: «расхождение на 50 000 ₽ вниз допустимо, а вот 40к
// при поле 250к — отсекать». Так не режем вакансии чуть ниже ориентира (240к при поле
// 250к пройдёт), но явный мисматч (40к) уходит в отсев.
const SALARY_TOLERANCE_RUB = 50000;

function evaluateSalary(salary, floorRub, rates) {
  if (!salary) return { pass: true, unspecified: true };
  if (!floorRub || floorRub <= 0) return { pass: true, unspecified: false };
  const ceilingRub = toRub(salary.max ?? salary.min, salary.currency, rates);
  if (ceilingRub == null) return { pass: true, unspecified: false };
  return { pass: ceilingRub >= floorRub - SALARY_TOLERANCE_RUB, unspecified: false, ceilingRub };
}

/**
 * «От какой ЗП» из резюме hh.ru — для авто-подхвата, когда в профиле пол не задан
 * руками. На странице резюме желаемая зарплата стоит в шапке, поэтому ищем первое
 * «<число> <валюта>» в начале текста (дальше по тексту числа встречаются в опыте).
 */
function parseDesiredSalaryFromResume(resumeText) {
  if (!resumeText) return null;
  const head = String(resumeText).slice(0, 1400);
  // Валюта на hh стоит после суммы («250 000 ₽»), но подстрахуемся и на префикс («$4000»).
  const CUR = '₽|руб[а-я.]*|\\$|usd|€|eur|евро|долл[а-я.]*';
  const m = head.match(new RegExp(
    `(?:(?:${CUR})\\s*\\d[\\d${SEP}]{2,})|(?:\\d[\\d${SEP}]{2,}\\s*(?:${CUR}))`, 'i',
  ));
  return m ? parseSalary(m[0]) : null;
}

/** Человеческая подпись суммы для письма/логов: «250 000 ₽», «$3000», «5000 €». */
function formatSalary(amount, currency) {
  const n = Math.round(Number(amount) || 0);
  if (!n) return '';
  const spaced = n.toLocaleString('ru-RU');
  if (currency === 'USD') return `$${spaced}`;
  if (currency === 'EUR') return `${spaced} €`;
  return `${spaced} ₽`;
}

module.exports = {
  parseSalary,
  toRub,
  evaluateSalary,
  parseDesiredSalaryFromResume,
  formatSalary,
  detectCurrency,
};
