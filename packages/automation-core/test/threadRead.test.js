// Чтение треда: служебные строки chatik (даты, «Непрочитанные сообщения», карточка отклика)
// не сообщения, а пустой первый «…-text» не должен съедать сообщение целиком — живой тред
// 06.10.2026 читался одними датами, и ИИ ответил по описанию вакансии.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { chromium } = require('playwright');
const { fetchThreadMessages } = require('../src/hh/negotiations');

const EXE = '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const skip = !fs.existsSync(EXE) && 'нет Chromium для Playwright';

async function read(html) {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    const page = await browser.newPage();
    await page.route('https://chatik.hh.ru/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html><body>${html}</body></html>` }));
    const ctx = { getPage: async () => ({ browser, page }), isLoggedIn: async () => true };
    return await fetchThreadMessages(ctx, 'https://chatik.hh.ru/chat/1');
  } finally { await browser.close().catch(() => {}); }
}

const own = (id, text) => `<div data-qa="chatik-chat-message-${id}"><div class="message_my"><div data-qa="chatik-chat-message-${id}-text">${text}</div>06:49</div></div>`;

test('служебные строки отбрасываются, пустой «-text» не съедает сообщение', { skip, timeout: 60000 }, async () => {
  const r = await read([
    `<div data-qa="chatik-chat-message-date">29 сентября</div>`,
    own(1, 'Здравствуйте! Откликаюсь на вакансию.'),
    `<div data-qa="chatik-chat-message-date">4 октября</div>`,
    `<div data-qa="chatik-chat-message-2"><span data-qa="chatik-chat-message-2-status-text"></span><div data-qa="chatik-chat-message-2-text">Я могу передать вас HR, если вам интересно.</div>12:52</div>`,
    `<div data-qa="chatik-chat-message-date">Сегодня</div>`,
    `<div data-qa="chatik-chat-message-unread">Непрочитанные сообщения</div>`,
    `<div data-qa="chatik-chat-message-3">ЕленаМогу передать вас HR, компетентному в вопросах middle вакансии?13:55</div>`,
  ].join(''));
  assert.deepStrictEqual(r.messages, [
    { from: 'ai', text: 'Здравствуйте! Откликаюсь на вакансию.' },
    { from: 'employer', text: 'Я могу передать вас HR, если вам интересно.' },
    { from: 'employer', text: 'ЕленаМогу передать вас HR, компетентному в вопросах middle вакансии?' },
  ]);
  assert.strictEqual(r.layout, null);
});

test('отклик без письма: сообщений нет, вёрстка — для журнала', { skip, timeout: 60000 }, async () => {
  const r = await read(`<div data-qa="chatik-chat-message-date">27 сентября</div><div data-qa="chatik-chat-message-11"><div class="message_my">Без сопроводительного письма</div></div><div data-qa="chatik-chat-message-12">Добавить сопроводительное</div>`);
  assert.deepStrictEqual(r.messages, []);
  assert.match(r.layout, /chatik-chat-message-#/);
});

test('кнопки-варианты под последним сообщением бота', { skip, timeout: 60000 }, async () => {
  const r = await read([
    `<header><button>Вакансия</button><button>Резюме</button></header>`,
    `<div data-qa="chatik-chat-message-5"><div data-qa="chatik-chat-message-5-text">Есть ли у вас опыт сопровождения AI-продуктов?</div>14:48</div>`,
    `<div><button>Да</button><button>Нет</button><button style="display:none">Скрытая</button></div>`,
    `<footer><textarea data-qa="text-input"></textarea><button aria-label="Прикрепить"><svg width="10" height="10"></svg></button><button>Отправить</button></footer>`,
  ].join(''));
  assert.deepStrictEqual(r.quickReplies, ['Да', 'Нет']);
});

test('имя отправителя — отдельно, текст как раньше', { skip, timeout: 60000 }, async () => {
  const r = await read([
    `<div data-qa="chatik-chat-message-1"><span>Наталия</span><div>Тимофей Игоревич, здравствуйте!</div>13:00</div>`,
    `<div data-qa="chatik-chat-message-2"><span>Наталия</span><div data-qa="chatik-chat-message-2-text">Офис в Санкт-Петербурге.</div>13:05</div>`,
    `<div data-qa="chatik-chat-message-3"><div data-qa="chatik-chat-message-3-text">Здравствуйте</div><div>Подскажите</div>13:06</div>`,
    `<div data-qa="chatik-chat-message-4"><div class="message_my"><span>Тимофей</span><div data-qa="chatik-chat-message-4-text">Да</div></div></div>`,
  ].join(''));
  assert.deepStrictEqual(r.messages, [
    { from: 'employer', text: 'НаталияТимофей Игоревич, здравствуйте!', author: 'Наталия' },
    { from: 'employer', text: 'Офис в Санкт-Петербурге.', author: 'Наталия' },
    { from: 'employer', text: 'Здравствуйте' },
    { from: 'ai', text: 'Да' },
  ]);
});
