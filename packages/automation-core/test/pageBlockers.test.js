// Проверка распознавания «стоп-факторов» формы в настоящем браузере.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { chromium } = require('playwright');
const { detectVisibleBlockersInPage } = require('../src/external/pageBlockers');

const EXE = '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const skip = !fs.existsSync(EXE) && 'нет Chromium для Playwright';

async function blockersOf(html) {
  const b = await chromium.launch({ executablePath: EXE });
  try {
    const p = await b.newPage();
    await p.setContent(html);
    return await p.evaluate(detectVisibleBlockersInPage);
  } finally { await b.close(); }
}

test('страница вопросов работодателя hh: служебная капча в коде — не стоп', { skip }, async () => {
  const r = await blockersOf(`
    <script>window.hhConfig = { captchaUrl: '/captcha', recaptchaKey: 'x' };</script>
    <div class="grecaptcha-badge"><iframe src="https://www.google.com/recaptcha/api2/anchor?k=x&size=invisible" width="256" height="60"></iframe></div>
    <div class="login-popup" style="display:none"><input type="password"></div>
    <input type="file" style="display:none">
    <label>Подтвердите, что вы ознакомились с условиями <input type="checkbox"></label>
    <label>Ваши зарплатные ожидания <input type="text"></label>`);
  assert.deepStrictEqual(r, { captcha: false, password: false, file: false });
});

test('видимая капча «я не робот» — стоп', { skip }, async () => {
  const r = await blockersOf(`<div class="g-recaptcha"><iframe src="https://www.google.com/recaptcha/api2/anchor?k=x&size=normal" width="304" height="78"></iframe></div>`);
  assert.strictEqual(r.captcha, true);
});

test('капча-картинка с полем ввода — стоп', { skip }, async () => {
  const r = await blockersOf(`<img src="/captcha/image?id=1" width="150" height="50"><input name="captchaText">`);
  assert.strictEqual(r.captcha, true);
});

test('видимые поля пароля и файла — стоп', { skip }, async () => {
  const r = await blockersOf(`<input type="password"><input type="file">`);
  assert.strictEqual(r.password, true);
  assert.strictEqual(r.file, true);
});
