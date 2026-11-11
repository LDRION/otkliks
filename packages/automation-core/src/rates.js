/**
 * rates.js — курсы валют к рублю для сравнения зарплат (salary.js).
 *
 * Работодатели пишут вилку в ₽, $ или €; пол кандидата задан в одной валюте. Чтобы
 * «$3000» корректно сравнить с «от 200 000 ₽», всё сводим к рублям по свежему курсу.
 *
 * Источник — ЦБ РФ (cbr-xml-daily.ru): бесплатно, без ключа, обновляется раз в сутки.
 * Кэшируем на 6 часов и держим запасные константы: если у пользователя нет сети или
 * ЦБ недоступен, фильтр по зарплате не должен падать — переведём по грубому курсу.
 */

// Запасные курсы (₽ за 1 единицу). Обновлять изредка руками — нужны лишь когда ЦБ
// недоступен, точность здесь вторична: решается вопрос «дотягивает до пола или нет».
const FALLBACK = { RUB: 1, USD: 90, EUR: 98 };
const TTL_MS = 6 * 60 * 60 * 1000;

let cache = null; // { at: number, rates }

async function fetchCbrRates() {
  const res = await fetch('https://www.cbr-xml-daily.ru/daily_json.js', {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`ЦБ вернул ${res.status}`);
  const data = await res.json();
  const val = (code, fb) => {
    const v = data?.Valute?.[code];
    // Value — рубли за Nominal единиц; для USD/EUR Nominal = 1, но делим на всякий.
    if (v && v.Value > 0 && v.Nominal > 0) return v.Value / v.Nominal;
    return fb;
  };
  return { RUB: 1, USD: val('USD', FALLBACK.USD), EUR: val('EUR', FALLBACK.EUR) };
}

/**
 * Актуальные курсы к рублю. Никогда не бросает: при любой ошибке возвращает
 * последний удачный кэш, а если его нет — запасные константы.
 * @returns {Promise<{ RUB: 1, USD: number, EUR: number }>}
 */
async function getRatesRub() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rates;
  try {
    const rates = await fetchCbrRates();
    cache = { at: Date.now(), rates };
    return rates;
  } catch {
    return (cache && cache.rates) || FALLBACK;
  }
}

module.exports = { getRatesRub, FALLBACK };
