// Служебный текст провайдера вместо ответа нельзя ни слать работодателю, ни разбирать.
// Живой случай: «Вы исчерпали лимит на ответы от ИИ…» ушло в чат как ответ кандидата.
const test = require('node:test');
const assert = require('node:assert');
const { isAiErrorText } = require('../src/llm/aiErrorText');

test('тексты-ошибки провайдеров ловятся', () => {
  for (const t of ['Вы исчерпали лимит на ответы от ИИ. Повторите попытку позже.',
    'Что-то пошло не так. Искусственному интеллекту не удалось создать ответ.',
    'You have reached your daily limit. Try again later.', 'Too many requests']) {
    assert.ok(isAiErrorText(t), t);
  }
});

test('честные фразы AI-инженера про лимиты не трогаются', () => {
  for (const t of ['Да, настраивал rate limit в nginx и на уровне API-гейтвея, плюс квоты на клиента.',
    'Строил очереди с ретраями при превышении лимита запросов к OpenAI API.',
    'Если не дозвонюсь, попробуйте позже — я на связи.']) {
    assert.ok(!isAiErrorText(t), t);
  }
});
