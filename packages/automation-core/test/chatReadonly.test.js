// Чат без возможности ответить (Т-Банк: «подайте заявку на нашем сайте») — это не
// поломка вёрстки: отправка должна вернуть CHAT_READONLY, а не REPLY_FIELD_NOT_FOUND.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { chromium } = require('playwright');
const { sendReply } = require('../src/hh/negotiations');

const EXE = '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const skip = !fs.existsSync(EXE) && 'нет Chromium для Playwright';

const MSG = `<div data-qa="chatik-chat-message-1"><div data-qa="chatik-chat-message-1-text">Подайте заявку на нашем сайте: https://l.tbank.ru/t-start-frontend</div></div>`;

async function send(html) {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    const page = await browser.newPage();
    await page.route('https://chatik.hh.ru/**', (r) => r.fulfill({ contentType: 'text/html', body: `<html><body>${html}</body></html>` }));
    const ctx = { getPage: async () => ({ browser, page }), isLoggedIn: async () => true };
    return await sendReply(ctx, 'https://chatik.hh.ru/chat/1', 'Здравствуйте!');
  } finally { await browser.close(); }
}

test('сообщения есть, поля ввода нет — CHAT_READONLY', { skip, timeout: 60000 }, async () => {
  assert.strictEqual((await send(MSG)).reason, 'CHAT_READONLY');
});

test('поле ввода заблокировано — CHAT_READONLY', { skip, timeout: 60000 }, async () => {
  assert.strictEqual((await send(`${MSG}<textarea data-qa="text-input" disabled style="display:none"></textarea>`)).reason, 'CHAT_READONLY');
});

test('незнакомое активное поле — громкая REPLY_FIELD_NOT_FOUND, не молчим', { skip, timeout: 60000 }, async () => {
  assert.strictEqual((await send(`${MSG}<input type="text" placeholder="Напишите сообщение">`)).reason, 'REPLY_FIELD_NOT_FOUND');
});

test('страница не загрузилась (нет сообщений) — не считаем «только чтение»', { skip, timeout: 60000 }, async () => {
  assert.strictEqual((await send('<div>Загрузка…</div>')).reason, 'REPLY_FIELD_NOT_FOUND');
});
