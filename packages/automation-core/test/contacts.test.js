// Живой случай 28.09.2026: работодатель написал «свяжемся здесь или в тг», и автопилот
// назвал Telegram кандидата «@AI_ConstructorBot» — это его проект из резюме, не контакт.
// Плюс в конце сопроводительного ушла приписка «дайте знать, и я перепишу текст».
const test = require('node:test');
const assert = require('node:assert');
const { normalizeTelegram, contactRule } = require('../src/replyAgent');
const { cutAfterSignature } = require('../src/coverLetter');
const { stripAssistantLeak } = require('../src/assistantLeak');

test('Telegram из профиля нормализуется в @ник', () => {
  assert.strictEqual(normalizeTelegram('@ldrion'), '@ldrion');
  assert.strictEqual(normalizeTelegram('ldrion'), '@ldrion');
  assert.strictEqual(normalizeTelegram('https://t.me/ldrion'), '@ldrion');
  assert.strictEqual(normalizeTelegram('t.me/ldrion'), '');           // без схемы — не угадываем
  assert.strictEqual(normalizeTelegram('@ab'), '');                    // короче 5 символов
  assert.strictEqual(normalizeTelegram('@ldrion; DROP'), '');
});

test('контакт задан — в промпте только он и запрет брать ники из резюме', () => {
  const r = contactRule({ contactTelegram: '@ldrion' });
  assert.match(r, /Telegram @ldrion/);
  assert.match(r, /НИКОГДА не выдавай за контакт/);
});

test('контакта нет — «продолжим в чате hh», ничего не придумываем', () => {
  const r = contactRule({});
  assert.match(r, /удобно продолжить здесь, в чате hh/);
  assert.doesNotMatch(r, /@[A-Za-z]/);
});

test('после подписи в письме ничего не остаётся', () => {
  const letter = 'Текст письма.\n\nС уважением, Тимофей Коньшин\nЕсли нужно скорректировать детали по формату работы, дайте знать, и я перепишу текст под новые вводные.';
  assert.strictEqual(cutAfterSignature(letter), 'Текст письма.\n\nС уважением, Тимофей Коньшин');
  const twoLines = 'Текст.\n\nС уважением,\nТимофей Коньшин\nЕсли нужно — перепишу.';
  assert.strictEqual(cutAfterSignature(twoLines), 'Текст.\n\nС уважением,\nТимофей Коньшин');
});

test('приписка «перепишу текст под новые вводные» ловится фильтром', () => {
  const r = stripAssistantLeak('Готов созвониться. Если нужно скорректировать детали по формату работы или сделать акцент на других проектах из резюме, дайте знать, и я перепишу текст под новые вводные.');
  assert.strictEqual(r.text, 'Готов созвониться.');
});

test('обычная вежливая фраза работодателю не режется', () => {
  const r = stripAssistantLeak('Готов созвониться. Дайте знать, когда вам удобно.');
  assert.strictEqual(r.text, 'Готов созвониться. Дайте знать, когда вам удобно.');
});
