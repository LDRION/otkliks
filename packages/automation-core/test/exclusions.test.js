// Исключения и чёрный список: этому работодателю автопилот не пишет ничего (лаунчер 1.0.22).
const test = require('node:test');
const assert = require('node:assert');
const { loadExclusions, brandWord } = require('../src/exclusions');
const { messageBody } = require('../src/employerMessage');

const storage = {
  getExclusions: async () => [{ negotiationId: '5664198340', company: 'ООО Мой медицинский центр' }, { vacancyId: '777' }],
  getBlacklist: async () => [{ company: 'Яндекс Директ', word: 'яндекс', broad: true }, { company: 'ООО «Ромашка»', broad: false }],
};

test('исключения: тред, вакансия, работодатель целиком', async () => {
  const is = await loadExclusions(storage, 't');
  assert.strictEqual(is({ negotiationId: '5664198340' }), 'excluded');
  assert.strictEqual(is({ vacancyId: '777' }), 'excluded');
  assert.strictEqual(is({ company: 'Мой медицинский центр' }), 'excluded');
  assert.strictEqual(is({ negotiationId: '1', vacancyId: '2', company: 'Сбер' }), false);
});

test('чёрный список: точно или всё со словом', async () => {
  const is = await loadExclusions(storage, 't');
  for (const c of ['Яндекс', 'Яндекс.Маркет', 'ЯндексGO', 'ООО «Яндекс.Технологии»']) assert.strictEqual(is({ company: c }), 'blacklist', c);
  assert.strictEqual(is({ company: 'Ромашка' }), 'blacklist');
  assert.strictEqual(is({ company: 'Ромашка-Плюс' }), false);
  assert.strictEqual(is({ company: 'Пояндекс' }), false);
});

test('главное слово компании', () => {
  assert.strictEqual(brandWord('Яндекс Директ'), 'яндекс');
  assert.strictEqual(brandWord('Т-Банк'), 't-банк'.replace('t', 'т'));
  assert.strictEqual(brandWord('ООО «Мой медицинский центр»'), 'мой медицинский центр');
});

test('без хранилища исключений — ничего не исключено', async () => {
  assert.strictEqual((await loadExclusions({}, 't'))({ negotiationId: '1', company: 'Яндекс' }), false);
});

test('текст без приклеенного имени', () => {
  assert.strictEqual(messageBody({ text: 'НаталияТимофей, добрый день!', author: 'Наталия' }), 'Тимофей, добрый день!');
  assert.strictEqual(messageBody({ text: 'Тимофей, добрый день!', author: 'Наталия' }), 'Тимофей, добрый день!');
  assert.strictEqual(messageBody({ text: 'Просто текст' }), 'Просто текст');
});
