/**
 * portfolioLink.js — из одной ссылки на портфолио делает пару {domain, canonical},
 * которую ждёт coverLetter.js.
 *
 * Зачем: в форме было ДВА поля — «домен» (github.com) и «ссылка» (github.com/handle).
 * Второе поле полностью содержит первое, и человек честно не понимал, зачем его
 * спрашивают дважды. Домен нужен не сам по себе: toPlainText использует его как
 * ключ, чтобы найти и починить ссылку, если модель её исказит. Значит его можно
 * просто вывести.
 */

/** @returns {{domain: string, canonical: string} | undefined} */
function parsePortfolioLink(input) {
  const raw = String(input || '').trim();
  if (!raw) return undefined;

  // Люди пишут и «github.com/handle», и «https://github.com/handle» — принимаем оба.
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  if (!url.hostname.includes('.')) return undefined;

  const domain = url.hostname.replace(/^www\./i, '');
  // canonical показываем без схемы: в письме «github.com/handle» читается лучше,
  // чем «https://github.com/handle».
  const canonical = (domain + url.pathname.replace(/\/+$/, '')) || domain;
  return { domain, canonical };
}

module.exports = { parsePortfolioLink };
