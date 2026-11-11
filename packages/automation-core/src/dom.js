/**
 * dom.js — общие хелперы извлечения текста со страниц hh.ru. Портировано без изменений
 * из личного hhorosho (src/services/hh/dom.js) — не завязано на env/tenant, чистые хелперы.
 */

async function textBySelectors(page, selectors) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0) {
        const text = (await loc.innerText()).trim();
        if (text) return text;
      }
    } catch { /* пробуем следующий селектор */ }
  }
  return null;
}

async function extractWithFallback(page, selectors, { label }) {
  const found = await textBySelectors(page, selectors);
  if (found) return found;
  console.warn(`⚠️ hh/dom: не нашёл "${label}" по известным селекторам — верстка hh.ru могла измениться, беру весь текст страницы (фоллбэк).`);
  return (await page.evaluate(() => document.body.innerText)).trim();
}

module.exports = { textBySelectors, extractWithFallback };
