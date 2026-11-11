// Доказательства цен конкурентов: полностраничный скриншот со штампом времени и
// адреса + строки с ценами из текста страницы. Нужны, чтобы утверждение «дешевле всех»
// на сайте можно было подтвердить по запросу (ФАС, модерация Директа): цены у
// конкурентов меняются, и через месяц доказать, что было на дату сравнения, иначе
// нечем. Запускать при каждом пересмотре цен/сравнения:
//   PATH=/opt/node22/bin:$PATH node scripts/evidence/capture-competitor-prices.cjs
// Результат — evidence/prices/<дата>/ (коммитится: GitHub — внешняя копия с датой).
const fs = require('fs');
const path = require('path');
const { chromium } = require('../../apps/marketing-site/node_modules/@playwright/test');

const ROOT = path.resolve(__dirname, '../..');
const EXE = process.env.CHROME || '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const competitors = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/marketing-site/lib/competitors/competitors.json'), 'utf8')).competitors;

const now = new Date();
const msk = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'long', timeStyle: 'short' }).format(now);
const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(now);
const outDir = path.join(ROOT, 'evidence/prices', day);
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const manifest = { capturedAt: now.toISOString(), capturedAtMsk: `${msk} МСК`, items: [] };
  for (const c of competitors) {
    if (!/^https?:/.test(c.url) || /github\.com/.test(c.url)) continue;
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ru-RU', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' });
    const page = await ctx.newPage();
    const item = { id: c.id, name: c.name, url: c.url, file: `${c.id}.jpg` };
    try {
      await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      // Прокрутка до конца — чтобы подгрузились ленивые блоки с тарифами.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(1500);
      item.finalUrl = page.url();
      item.title = await page.title();
      item.priceLines = await page.evaluate(() => {
        const lines = document.body.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
        const out = [];
        lines.forEach((l, i) => {
          if (/\d[\d\s]*\s?(₽|руб)/i.test(l) && l.length < 160) out.push([lines[i - 1], l, lines[i + 1]].filter(Boolean).join(' · ').slice(0, 300));
        });
        return [...new Set(out)].slice(0, 40);
      });
      await page.evaluate(({ stamp }) => {
        const bar = document.createElement('div');
        bar.textContent = stamp;
        bar.style.cssText = 'position:relative;z-index:2147483647;background:#ffeb3b;color:#000;font:600 15px/1.4 Arial,sans-serif;padding:8px 14px;border-bottom:2px solid #000;';
        document.body.prepend(bar);
      }, { stamp: `Снято ${msk} МСК · ${page.url()}` });
      await page.screenshot({ path: path.join(outDir, item.file), fullPage: true, type: 'jpeg', quality: 60 });
      item.ok = true;
    } catch (e) {
      item.ok = false;
      item.error = String(e.message || e).slice(0, 300);
    }
    manifest.items.push(item);
    console.log(`${item.ok ? '✓' : '✗'} ${c.name} — ${item.ok ? `${item.priceLines.length} строк с ценами` : item.error}`);
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`→ ${outDir}`);
})();
