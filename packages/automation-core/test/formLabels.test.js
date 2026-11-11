// Подписи полей в снимке формы (formAgent.snapshot). Живой случай 29.09.2026: в анкете
// hh.ru у полей нет <label>, и подписью становилось машинное name «task_380806266_text» —
// его видели и человек в отчёте, и модель, которая решала, что писать в поле.
// Нужен браузер Playwright; нет его на машине — тест пропускается.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { snapshot } = require('../src/external/formAgent');
const { readFields } = require('../src/external/genericForm');

const CANDIDATES = [process.env.CHROME, chromium.executablePath(), '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome'];
const executablePath = CANDIDATES.find((p) => p && fs.existsSync(p));

const HTML = `<!doctype html><html><body>
<form id="hh">
  <h2>Ответьте на вопросы работодателя</h2>
  <div class="task"><div class="task-question">Готовы ли вы к переезду в Санкт-Петербург?</div>
    <textarea name="task_380806266_text"></textarea></div>
  <div class="task"><div class="task-question"><p>Ваши ожидания по зарплате?</p></div>
    <div class="wrap"><textarea name="task_380806267_text" placeholder="Ваш ответ"></textarea></div></div>
  <div class="task"><div class="task-question">Есть ли опыт с Unity?</div>
    <label><input type="radio" name="task_380806268_radio" value="1"> Да</label>
    <label><input type="radio" name="task_380806268_radio" value="2"> Нет</label></div>
  <label><input type="checkbox" name="agree"> Согласен на обработку персональных данных</label>
</form>
<form id="gforms">
  <div role="listitem"><div id="q1" role="heading">Ваш Telegram</div><input type="text" aria-labelledby="q1"></div>
</form>
<form id="plain">
  <label for="email">Электронная почта</label><input id="email" type="email" name="email">
  <h3>Контакты</h3>
  <div><input type="text" placeholder="Город" name="field-1234567"></div>
  <div><input type="text" placeholder="Телефон" name="phone"></div>
  <div><input type="text" name="salary_expectation"></div>
  <button type="submit">Отправить</button>
</form>
</body></html>`;

test('подписи полей: текст вопроса вместо машинного name', { skip: !executablePath && 'нет браузера Playwright' }, async () => {
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage();
    await page.setContent(HTML);
    const snap = await snapshot(page);
    const byLabel = (re) => snap.items.find((i) => re.test(i.label));
    const labels = snap.items.map((i) => i.label);

    assert.ok(!labels.some((l) => /task_\d+/.test(l)), `машинное имя в подписях: ${labels.join(' | ')}`);
    assert.ok(byLabel(/^Готовы ли вы к переезду/), labels.join(' | '));
    // Вопрос с вопросительным знаком — без подсказки «Ваш ответ» в скобках.
    assert.ok(snap.items.some((i) => i.label === 'Ваши ожидания по зарплате?'), labels.join(' | '));

    const yes = snap.items.find((i) => i.kind === 'radio' && i.label === 'Да');
    assert.strictEqual(yes?.group, 'Есть ли опыт с Unity?');
    const agree = snap.items.find((i) => i.kind === 'checkbox');
    assert.match(agree.label, /Согласен на обработку/);
    assert.strictEqual(agree.group, undefined, 'у одиночной галочки нет вопроса группы');

    assert.ok(byLabel(/^Ваш Telegram$/), 'aria-labelledby');
    assert.ok(byLabel(/^Электронная почта$/), 'label for');
    // Заголовок раздела + подсказка из поля; машинное name не используется.
    assert.ok(byLabel(/^Контакты \(Город\)$/), labels.join(' | '));
    // Сосед с полем — чужой вопрос: «Телефон» берём из подсказки, а не заголовок раздела.
    assert.ok(byLabel(/^Телефон$/), labels.join(' | '));
    // Читаемое name — годится как последний вариант.
    assert.ok(byLabel(/^salary_expectation$/), labels.join(' | '));
    assert.ok(byLabel(/^Отправить$/), 'кнопка');
  } finally {
    await browser.close();
  }
});

test('genericForm: те же подписи в быстром разборе форм', { skip: !executablePath && 'нет браузера Playwright' }, async () => {
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage();
    await page.setContent(HTML);
    const fields = await readFields(page);
    const titles = fields.map((f) => f.title);
    assert.ok(!titles.some((t) => /task_\d+|field-\d+/.test(t)), `машинное имя: ${titles.join(' | ')}`);
    assert.ok(titles.includes('Готовы ли вы к переезду в Санкт-Петербург?'), titles.join(' | '));
    assert.ok(titles.includes('Ваши ожидания по зарплате?'), titles.join(' | '));
    const radio = fields.find((f) => f.kind === 'radio');
    assert.strictEqual(radio.title, 'Есть ли опыт с Unity?');
    assert.deepStrictEqual(radio.options.map((o) => o.trim()), ['Да', 'Нет']);
    const agree = fields.find((f) => f.kind === 'checkbox');
    assert.match(agree.title, /Согласен на обработку/);
  } finally {
    await browser.close();
  }
});

// Живой случай 06–09.10.2026: анкета отклика hh (vacancy_response). Вопрос — в
// <div data-qa="task-question">, поле — глубоко в обёртках magritte, в <label> с подсказкой
// «Писать тут». 13 анкет ушли с подписью «Писать тут», модель не знала вопроса.
const HH_TASKS = `<!doctype html><html><body><form>
  <h3>Ответьте на вопросы</h3>
  <div class="task">
    <div class="g-user-content" data-qa="task-question">На какую заработную плату вы ориентируетесь?</div>
    <div><div><div><div><div><div><label class="magritte-textarea"><span class="ph">Писать тут</span>
      <textarea name="task_381_text" placeholder="Писать тут"></textarea></label></div></div></div></div></div></div>
  </div>
  <div class="task">
    <div class="g-user-content" data-qa="task-question">Готовы к гибридному формату?</div>
    <div><label><input type="radio" name="task_382" value="1"> Да</label><label><input type="radio" name="task_382" value="2"> Нет</label></div>
  </div>
  <div class="task">
    <div><div><div><div><div><div><div><div><textarea name="task_383_text" placeholder="Ваш ответ"></textarea></div></div></div></div></div></div></div></div>
  </div>
</form>
<form id="far"><p style="margin:0">Сколько лет опыта с Go?</p><div><div><div><div><div><div><div><div><div>
  <input type="text" name="field-99999" placeholder="Писать тут"></div></div></div></div></div></div></div></div></div></form>
</body></html>`;

test('анкета hh: вопрос из data-qa="task-question", а не «Писать тут»', { skip: !executablePath && 'нет браузера Playwright' }, async () => {
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage();
    await page.setContent(HH_TASKS);
    const snap = await snapshot(page);
    const labels = snap.items.map((i) => i.label);
    assert.ok(!labels.includes('Писать тут'), labels.join(' | '));
    assert.ok(labels.includes('На какую заработную плату вы ориентируетесь?'), labels.join(' | '));
    const yes = snap.items.find((i) => i.kind === 'radio' && i.label === 'Да');
    assert.strictEqual(yes?.group, 'Готовы к гибридному формату?');
    // Поле без своего task-question: чужой вопрос (с полем-вариантами между) не берём.
    assert.ok(!snap.items.some((i) => i.label === 'Готовы к гибридному формату?' && i.kind !== 'radio'), labels.join(' | '));
    // Без data-qa и глубже textAbove — по расположению.
    assert.ok(labels.includes('Сколько лет опыта с Go?'), labels.join(' | '));

    const fields = await readFields(page);
    const titles = fields.map((f) => f.title);
    assert.ok(titles.includes('На какую заработную плату вы ориентируетесь?'), titles.join(' | '));
    assert.ok(titles.includes('Готовы к гибридному формату?'), titles.join(' | '));
    assert.ok(titles.includes('Сколько лет опыта с Go?'), titles.join(' | '));
    assert.ok(!titles.includes('Писать тут'), titles.join(' | '));
  } finally {
    await browser.close();
  }
});
