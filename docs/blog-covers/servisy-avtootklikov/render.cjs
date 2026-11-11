const { chromium } = require('../../../apps/marketing-site/node_modules/@playwright/test');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome' });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + __dirname + '/cover.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  await p.screenshot({ path: __dirname + '/cover.jpg', type: 'jpeg', quality: 90 });
  await b.close();
})();
