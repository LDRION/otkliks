/**
 * Разбор ссылки на портфолио — своя копия
 * packages/automation-core/src/portfolioLink.js.
 *
 * Копия, а не workspace-зависимость, по той же причине, что и lib/siberiClient.ts:
 * automation-core тянет за собой playwright, а сайту ради десяти строк разбора
 * ссылки браузерный движок в сборке не нужен.
 *
 * Зачем вообще: в форме было два поля — «домен» и «ссылка», — хотя второе целиком
 * содержит первое. Домен нужен только внутри, как ключ для починки ссылки в готовом
 * письме, поэтому его выводим, а у человека спрашиваем одну ссылку.
 */
export type PortfolioLink = { domain: string; canonical: string };

export function parsePortfolioLink(input: string): PortfolioLink | undefined {
  const raw = (input || '').trim();
  if (!raw) return undefined;

  // Принимаем и «github.com/handle», и «https://github.com/handle».
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  if (!url.hostname.includes('.')) return undefined;

  const domain = url.hostname.replace(/^www\./i, '');
  // В письме «github.com/handle» читается лучше, чем «https://github.com/handle».
  const canonical = domain + url.pathname.replace(/\/+$/, '');
  return { domain, canonical };
}
