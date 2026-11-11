/**
 * negotiations.js — список чатов, чтение треда, отправка ответа. Портировано из личного
 * hhorosho. "Чат" на hh.ru — не страница hh.ru, а виджет на отдельном поддомене
 * chatik.hh.ru (та же cookie-сессия покрывает оба поддомена). browserCtx параметром.
 */

const { CLOSED_VACANCY_RE, CHAT_CLOSED_RE } = require('./vacancyState');

const CHATIK_BASE = 'https://chatik.hh.ru';

const MESSAGE_SELECTOR = '[data-qa^="chatik-chat-message-"]:not([data-qa$="-text"])';
// hh переименовал поле ввода: теперь это <textarea data-qa="text-input"
// placeholder="Сообщение">, а кнопки «Отправить» нет — отправка по Enter
// (enterkeyhint="enter"). Старые селекторы держим запасными.
const REPLY_TEXTAREA_SELECTOR = 'textarea[data-qa="text-input"], textarea[placeholder="Сообщение"], [data-qa="chatik-new-message-text"]';
const SEND_BUTTON_SELECTOR = '[data-qa="chatik-do-send-message"], [data-qa="chatik-send-message"]';

function threadUrl(negotiationId) {
  return `${CHATIK_BASE}/chat/${negotiationId}`;
}

/**
 * Список активных чатов. Тут скрывался главный источник "система не отвечает" за всю
 * сессию: список у hh ВИРТУАЛИЗИРОВАН — при скролле старые карточки не добавляются к
 * новым, а ПОДМЕНЯЮТСЯ (DOM держит одновременно всего ~9-14 штук). Прежний код мерил
 * "выросло ли число карточек в DOM" и, увидев, что оно перестало расти (14 → 14 → 14…),
 * решал, что список кончился — хотя реально в аккаунте могло быть под 500 чатов. Живой
 * тест на реальном аккаунте: из ~494 реальных активных чатов старый код видел 14 —
 * меньше 3%. Все остальные были для автопилота как будто не существовали вовсе, сколько
 * бы работодатель туда ни писал — отсюда и годами повторявшееся "система не отвечает".
 *
 * Фикс: копим карточки НА КАЖДОМ шаге скролла (raw HTML/текст карточки после скролла
 * теряется — виртуализация его выкидывает), а не один раз в конце. Останавливаемся,
 * когда несколько шагов подряд не приносят НИ ОДНОГО нового id, а не когда не растёт
 * голый DOM-счётчик.
 */
async function fetchActiveThreads(browserCtx) {
  const { browser, page } = await browserCtx.getPage();
  try {
    await page.goto(`${CHATIK_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (!(await browserCtx.isLoggedIn(page))) {
      throw new Error('LOGGED_OUT');
    }

    await page.waitForSelector('[data-qa^="chatik-open-chat-"]', { timeout: 15000 }).catch(() => {});

    const byId = new Map();
    let stall = 0;
    // До 80 шагов — на живом аккаунте с ~500 чатами хватило 41 шага (~15 секунд).
    // STALL_LIMIT — 5 шагов подряд без НИ ОДНОГО нового id, не 1: следующая порция
    // иногда на шаг отстаёт от самого скролла.
    const MAX_ROUNDS = 80;
    const STALL_LIMIT = 5;

    for (let round = 0; round < MAX_ROUNDS && stall < STALL_LIMIT; round += 1) {
      const parsed = await page.evaluate(() => Array.from(document.querySelectorAll('[data-qa^="chatik-open-chat-"]')).map((el) => {
        const qa = el.getAttribute('data-qa') || '';
        const m = /^chatik-open-chat-(\d+)$/.exec(qa);

        // Раньше сюда шёл весь textContent карточки, склеенный без пробелов:
        // «Fullstack-разработчик (Python/FastAPI)08:30ТАРГЕТ АДСПривет, к какому-то
        // решению пришли?». innerText сохраняет переносы, поэтому карточку можно
        // разобрать по строкам: первая — вакансия, дальше компания/время/превью.
        // Иногда innerText не даёт переносов (зависит от вёрстки/видимости) — тогда
        // собираем строки из вложенных листовых узлов, каждая часть отдельным элементом.
        let lines = String(el.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
        if (lines.length < 2) {
          lines = Array.from(el.querySelectorAll('*'))
            .filter((child) => !child.children.length)
            .map((child) => (child.textContent || '').trim())
            .filter(Boolean);
        }

        // Время/дата сообщения в карточке: «14:05», «вчера», «пн», а для старых чатов —
        // дата «15.08» или «15.08.2025». Дату раньше не узнавали, и она попадала в
        // «компанию» (живой случай: company = «15.08» у чата Т-Банка).
        const isTime = (s) => /^\d{1,2}:\d{2}$/.test(s) || /^\d{1,2}\.\d{2}(\.\d{2,4})?$/.test(s)
          || /^(вчера|сегодня|[а-я]{2})$/i.test(s);
        const tidy = (s) => String(s || '')
          .replace(/ /g, ' ')
          .replace(/\s*\d{1,2}:\d{2}\s*$/, '')
          .replace(/\s*Отклик на вакансию\s*$/i, '')
          // hh.ru приклеивает дату (обновления/публикации вакансии, формат ДД.ММ) прямо
          // к названию в этой же строке карточки чата — «Разработчик — 03.04». Дата сама
          // по себе не выдумана, но ей не место внутри vacancyTitle: это поле уходит и в
          // промпт генерации сопроводительного письма (см. coverLetter.js), и в лоб
          // показывается в лентах лаунчера/дашборда — там оно просто мусор рядом с
          // названием, а не осмысленная информация.
          .replace(/\s*[—-]\s*\d{1,2}\.\d{2}\s*$/, '')
          .trim();

        const title = tidy(lines[0] || '');
        const company = tidy(lines.slice(1).find((l) => !isTime(l) && tidy(l) && tidy(l) !== title) || '');
        // hh сам помечает непрочитанные счётчиком прямо в карточке — [data-qa="chatik-info-badges"].
        // Уходит вместе с открытием чата (наш же fetchThreadMessages его и снимает), поэтому
        // это НЕ надёжный сигнал "нужен ответ" сам по себе — только "мы точно не читали это
        // с прошлого раза". См. negotiationsWatcher.js: используется как быстрый пропуск ТОЛЬКО
        // для тредов без другого незавершённого дела (ретрай отправки, ожидание уточнения и т.п.).
        const hasUnread = !!el.querySelector('[data-qa="chatik-info-badges"]');
        return {
          negotiationId: m ? m[1] : null, label: title.slice(0, 120), company: company.slice(0, 80), hasUnread,
        };
      })).catch(() => []);

      let added = 0;
      for (const t of parsed) {
        if (!t.negotiationId) continue;
        if (!byId.has(t.negotiationId)) added += 1;
        byId.set(t.negotiationId, t);
      }
      stall = added === 0 ? stall + 1 : 0;

      await page.evaluate(() => {
        // Контейнер ищем по факту прокручиваемости, а не по имени класса: у hh классы
        // сгенерированы и меняются, а «высота содержимого больше видимой» — не меняется.
        const first = document.querySelector('[data-qa^="chatik-open-chat-"]');
        for (let node = first?.parentElement; node; node = node.parentElement) {
          const cs = getComputedStyle(node);
          if (/(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 4) {
            node.scrollTop = node.scrollHeight;
            node.dispatchEvent(new Event('scroll', { bubbles: true }));
            break;
          }
        }
      }).catch(() => {});
      await page.waitForTimeout(350);
    }

    const threads = Array.from(byId.values()).map((t) => ({ ...t, href: threadUrl(t.negotiationId) }));
    if (!threads.length) {
      console.warn('⚠️ hh/negotiations: чатов не найдено — верстка chatik.hh.ru могла измениться либо чатов правда нет.');
    }
    return threads;
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// Служебные строки chatik, которые hh рисует теми же узлами, что и сообщения: даты
// («Сегодня», «2 октября»), «Непрочитанные сообщения», кнопка «Добавить сопроводительное»
// в карточке отклика. Раньше они уходили в тред как реплики — с любой стороной: живой
// тред 06.10.2026 кончался на «Непрочитанные сообщения» от работодателя, а «Сегодня»
// числилось нашим ответом. Последняя такая строка «от работодателя» заставляла ИИ отвечать
// в пустоту, «от нас» — пропускать настоящий вопрос. Отдельно они всегда, к тексту
// сообщений не приклеиваются (проверено по 1200+ сохранённым сообщениям), поэтому
// отсекаем только по полному совпадению.
const CHAT_CHROME_RE = /^(?:Сегодня|Вчера|Непрочитанные сообщения|Новые сообщения|Добавить сопроводительное|Без сопроводительного письма|\d{1,2} (?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?: \d{4}(?: г\.)?)?)$/i;

/** Служебная строка интерфейса chatik, а не сообщение человека. */
function isChatChrome(text) {
  return CHAT_CHROME_RE.test(String(text || '').trim());
}

// Возвращает { messages: [{from: 'employer'|'ai', text}], vacancyId }.
async function fetchThreadMessages(browserCtx, url) {
  const { browser, page } = await browserCtx.getPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (!(await browserCtx.isLoggedIn(page))) {
      throw new Error('LOGGED_OUT');
    }

    await page.waitForSelector(MESSAGE_SELECTOR, { timeout: 15000 }).catch(() => {});

    // История треда подгружается вверх. Нам нужен весь диалог: ответ строится по
    // контексту — что писал работодатель раньше и что отвечали мы.
    await page.evaluate(async (sel) => {
      const anyMessage = document.querySelector(sel);
      const scroller = anyMessage?.closest('[class*="scroll"], [class*="list"], [class*="messages"]')
        || document.scrollingElement;
      let previous = -1;
      for (let i = 0; i < 15; i += 1) {
        const count = document.querySelectorAll(sel).length;
        if (count === previous) break;
        previous = count;
        if (scroller) scroller.scrollTop = 0;
        await new Promise((r) => setTimeout(r, 350));
      }
      if (scroller) scroller.scrollTop = scroller.scrollHeight;   // вернуться к свежим
    }, MESSAGE_SELECTOR).catch(() => {});

    const messages = await page.evaluate((sel) => {
      // Текст сообщения нужно очистить от того, что hh рисует рядом: заголовка
      // «Отклик на вакансию» у первого сообщения и времени, приклеенного в конце.
      // Без этого мусор уезжал и в контекст модели, и в ленту событий, где выглядел
      // как «...С уважением, Тимофей Коньшин02:49».
      const clean = (raw) => String(raw || '')
        .replace(/\u00a0/g, ' ')
        .replace(/^\s*Отклик на вакансию\s*/i, '')
        // hh иногда рисует имя бота ПРЯМО В ТЕКСТЕ сообщения без разделителя (когда бот
        // заново "заходит" в чат) — "Робот-рекрутерГде вы проживаете...", а не просто
        // "Где вы проживаете...". Один и тот же вопрос бота из-за этого выглядел двумя
        // РАЗНЫМИ строками, дедуп повторов (см. negotiationsWatcher.js) их не признавал
        // одинаковыми, и на каждый вариант формулировки уходил отдельный, несогласованный
        // между собой ответ.
        .replace(/^\s*Робот-рекрутер\s*/, '')
        .replace(/\s*\d{1,2}:\d{2}\s*$/, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // Имя отправителя hh пишет первой строкой сообщения (у первого в серии). В textContent
      // оно приклеивалось к тексту — «НаталияТимофей Игоревич, здравствуйте!» — и так и
      // показывалось. Сам текст НЕ меняем (по нему наблюдатель сверяет сообщения между
      // кругами), имя отдаём отдельным полем author: его отрезают показ и промпт.
      const NAME_RE = /^(?:[А-ЯЁA-Z][а-яёa-z]+(?:[ -][А-ЯЁA-Z][а-яёa-z]+){0,2}|ИИ-помощник|Робот-рекрутер)$/;
      const NOT_NAME = /^(?:Здравствуйте|Добрый|Доброе|Привет|Спасибо|Благодарю|Благодарим|Уважаемый|Уважаемая|Коллеги|Да|Нет|Хорошо|Отлично|Понял|Поняла|Понятно|Супер|Ок|Отказ|Собеседование|Приглашение|Отклик|Сегодня|Вчера|Подскажите|Скажите|Напишите|Расскажите)$/i;
      const firstText = (root) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode: (t) => (t.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
        });
        return w.nextNode();
      };

      const nodes = Array.from(document.querySelectorAll(sel));
      return nodes.map((n) => {
        const isOwn = n.querySelector('[class*="message_my"]') != null;
        // Текст — из первого НЕПУСТОГО элемента «…-text», а если таких нет — из всего узла.
        // Раньше брали первый попавшийся: если он оказывался пустым служебным, сообщение
        // выпадало целиком, и в треде оставались одни даты (живой тред 06.10.2026: ни одного
        // сообщения работодателя, ИИ ответил по описанию вакансии).
        let text = '';
        let textEl = null;
        for (const el of n.querySelectorAll('[data-qa$="-text"]')) {
          text = clean(el.textContent);
          if (text) { textEl = el; break; }
        }
        if (!text) text = clean(n.textContent);
        const msg = { from: isOwn ? 'ai' : 'employer', text };
        const lead = isOwn ? null : firstText(n);
        const name = lead ? lead.textContent.trim() : '';
        if (name && NAME_RE.test(name) && !NOT_NAME.test(name) && !(textEl && textEl.contains(lead))
          && clean(n.textContent).length > name.length + 1) {
          msg.author = name;
        }
        return msg;
      }).filter((m) => {
        if (!m.text) return false;
        // Системные события присутствия ("Пользователь X присоединился/покинул чат") —
        // не реальные сообщения, не пускаем их в контекст LLM/триггер ответа.
        if (/(присоединился к чату|покинул чат)$/i.test(m.text)) return false;
        return true;
      });
    }, MESSAGE_SELECTOR);
    const real = messages.filter((m) => !isChatChrome(m.text));

    // Ни одного сообщения работодателя. Обычно так и есть (он молчит), но если hh при этом
    // показывал в списке непрочитанное — значит, вёрстка разошлась с парсером. Для разбора
    // по журналу запоминаем, какие data-qa нашлись (цифры — в #); решает наблюдатель.
    let layout = null;
    if (!real.some((m) => m.from === 'employer')) {
      layout = await page.evaluate((sel) => [...new Set(Array.from(document.querySelectorAll(sel))
        .map((n) => (n.getAttribute('data-qa') || '').replace(/\d+/g, '#')))].slice(0, 8).join(', '), MESSAGE_SELECTOR)
        .catch(() => '?') || '—';
    }

    if (!real.length) {
      console.warn(`⚠️ hh/negotiations: не нашёл сообщений на ${url} — верстка могла измениться.`);
    }

    // Кнопки-варианты ответа под последним сообщением («Да» / «Нет», «На территории РФ» …):
    // так скрининг-бот hh задаёт закрытые вопросы и принимает только один из вариантов —
    // нажатием или тем же словом текстом, а на развёрнутый ответ переспрашивает. Классов и
    // data-qa кнопок мы не знаем (с сервера вёрстку не увидеть), поэтому берём всё кликабельное
    // с коротким текстом НЕ ВЫШЕ последнего сообщения: шапка чата выше, а у поля ввода кнопки —
    // значки без текста. Использовать варианты или нет, решает наблюдатель (только для бота).
    const quickReplies = await page.evaluate((sel) => {
      const nodes = document.querySelectorAll(sel);
      const last = nodes[nodes.length - 1];
      if (!last) return [];
      const floor = last.getBoundingClientRect().top;
      const SKIP = /^(?:Отправить|Прикрепить|Файл|Шаблон[ыа]?|Ещё|Отмена|Закрыть|Удалить|Изменить|Ответить|Копировать|Переслать|Добавить сопроводительное)$/i;
      const out = [];
      for (const el of document.querySelectorAll('button, [role="button"]')) {
        const t = String(el.innerText || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 60 || SKIP.test(t) || out.includes(t)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.top < floor) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || el.disabled) continue;
        out.push(t);
      }
      return out.slice(0, 8);
    }, MESSAGE_SELECTOR).catch(() => []);

    const vacancyId = await page.evaluate(() => {
      const link = document.querySelector('a[href*="/vacancy/"]');
      if (!link) return null;
      const m = (link.href || '').match(/\/vacancy\/(\d+)/);
      return m ? m[1] : null;
    }).catch(() => null);

    return { messages: real, vacancyId, layout, quickReplies };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// Нормализация для сверки «наш текст реально появился в треде»: сравниваем без
// пробелов/регистра/переносов, чтобы форматирование hh не мешало.
const normForMatch = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

// Снимок наших сообщений в треде (сколько и текст последнего) — до и после отправки.
async function ownSnapshot(page) {
  return page.evaluate((sel) => {
    const own = Array.from(document.querySelectorAll(sel)).filter((n) => n.querySelector('[class*="message_my"]'));
    const last = own[own.length - 1];
    const textEl = last && last.querySelector('[data-qa$="-text"]');
    return { count: own.length, lastText: (textEl ? textEl.textContent : (last ? last.textContent : '')) || '' };
  }, MESSAGE_SELECTOR);
}

/**
 * Отправляет ответ в чат hh.ru и ПОДТВЕРЖДАЕТ, что сообщение реально появилось в треде.
 * Раньше функция возвращала success:true сразу после клика — без проверки. hh-чат это
 * React-виджет: .fill() часто не поднимает состояние, кнопка «отправить» остаётся
 * выключенной, клик уходит в пустоту — а лаунчер рапортовал «ответили». Теперь: вводим
 * значение нативным сеттером + событием input (React это видит), жмём кнопку, и только
 * если наше сообщение действительно возникло в переписке — success.
 * @returns {{ success: boolean, reason?: string, detail?: string }}
 */
async function sendReply(browserCtx, url, text) {
  const { browser, page } = await browserCtx.getPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (!(await browserCtx.isLoggedIn(page))) {
      return { success: false, reason: 'LOGGED_OUT' };
    }

    // Дать React дорисовать composer, затем ЭВРИСТИЧЕСКИ найти поле ввода и кнопку
    // отправки. hh регулярно меняет data-qa/классы (из-за чего ответы вообще не
    // отправлялись — REPLY_FIELD_NOT_FOUND), поэтому не полагаемся на один селектор:
    // известный пробуем первым, иначе берём самый нижний видимый ввод (composer всегда
    // внизу чата) и кнопку рядом с ним. Найденное помечаем атрибутом и дальше работаем
    // по нему — устойчиво к любой смене вёрстки.
    // Composer у hh догружается React'ом не сразу — поллим до ~9 секунд, пока поле
    // ввода не появится, а не сдаёмся после первой попытки.
    let tagged = { field: false, send: false };
    for (let attempt = 0; attempt < 11 && !tagged.field; attempt += 1) {
      await page.waitForTimeout(attempt === 0 ? 500 : 800);
      // eslint-disable-next-line no-await-in-loop
      tagged = await page.evaluate((known) => {
        // Видимость БЕЗ offsetParent: у hh composer прилеплен снизу (position: sticky/
        // fixed), а у таких элементов offsetParent === null — из-за этого поле ввода
        // считалось «невидимым» и не находилось. Проверяем по прямоугольникам и стилю.
        const vis = (el) => {
          if (!el) return false;
          if (!el.getClientRects().length) return false;
          const cs = getComputedStyle(el);
          return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || '1') !== 0;
        };
        let field = document.querySelector(known.field);
        if (!vis(field)) {
          const cands = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')).filter(vis);
          cands.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
          field = cands[0] || null;
        }
        if (!field) return { field: false, send: false };
        field.setAttribute('data-otkliks-input', '1');

        // Кнопку отправки помечаем ТОЛЬКО если она уверенно опознана (известный data-qa
        // или подсказка send/отправить). У hh кнопки нет вовсе — отправка по Enter,
        // поэтому «последнюю кнопку композера» не берём (это может быть смайлик/скрепка).
        let send = document.querySelector(known.send);
        let confident = vis(send);
        if (!confident) {
          send = null;
          const scope = field.closest('form') || (field.parentElement && field.parentElement.parentElement) || document.body;
          const btns = Array.from((scope || document.body).querySelectorAll('button')).filter(vis);
          const hint = (b) => `${b.getAttribute('data-qa') || ''} ${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`.toLowerCase();
          const hinted = btns.find((b) => /send|отправ|надісл/.test(hint(b)));
          if (hinted) { send = hinted; confident = true; }
        }
        if (send) send.setAttribute('data-otkliks-send', '1');
        return { field: true, send: confident };
      }, { field: REPLY_TEXTAREA_SELECTOR, send: SEND_BUTTON_SELECTOR }).catch(() => ({ field: false, send: false }));
    }

    if (!tagged.field) {
      // Поля ввода нет закономерно в ТРЁХ живых случаях — не поломка вёрстки, а хоть и
      // разные, но известные способы hh закрыть чат: архивная вакансия (см. apply.js),
      // работодатель явно отключил переписку по вакансии, или после отказа hh сам
      // закрывает чат до нового приглашения. Раньше все три схлопывались в
      // REPLY_FIELD_NOT_FOUND и ретраились 3 раза с ложной тревогой «проверьте вручную»,
      // хотя писать было физически некуда ни при одном исходе.
      const bodyTextNow = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (CLOSED_VACANCY_RE.test(bodyTextNow)) {
        return { success: false, reason: 'VACANCY_CLOSED', detail: 'вакансия в архиве — переписка закрыта, отвечать некуда' };
      }
      if (CHAT_CLOSED_RE.test(bodyTextNow)) {
        return { success: false, reason: 'VACANCY_CLOSED', detail: 'работодатель закрыл переписку по этому чату — отвечать некуда' };
      }
      // Чат только для чтения: переписка на странице видна (значит, страница загрузилась),
      // а поля ввода нет вообще или оно заблокировано. Живой случай — Т-Банк: автоматическое
      // «подайте заявку на стажировку на нашем сайте по ссылке» в чате без возможности
      // ответить. Раньше это считалось «сломалась вёрстка hh», ретраилось 3 круга и
      // заканчивалось тревогой «ответьте вручную» — хотя отвечать некуда и человеку тоже.
      // Ссылку из такого сообщения отдельно обрабатывает этап внешних анкет.
      // Любой активный текстовый ввод (даже без наших признаков) — не «только чтение»:
      // тогда это правда может быть новая вёрстка, и о ней надо узнать громко.
      const readonly = await page.evaluate((msgSel) => {
        const hasMessages = document.querySelectorAll(msgSel).length > 0;
        const inputs = Array.from(document.querySelectorAll(
          'textarea, [contenteditable="true"], [role="textbox"], input[type="text"], input:not([type])',
        ));
        const active = inputs.filter((el) => !el.disabled && !el.readOnly
          && el.getAttribute('aria-disabled') !== 'true' && el.getAttribute('aria-readonly') !== 'true');
        return hasMessages && active.length === 0;
      }, MESSAGE_SELECTOR).catch(() => false);
      if (readonly) {
        return { success: false, reason: 'CHAT_READONLY', detail: 'работодатель не принимает сообщения в этом чате — отвечать некуда' };
      }
      return { success: false, reason: 'REPLY_FIELD_NOT_FOUND', detail: 'не нашёл поле ввода в чате даже за 9с (вёрстка hh)' };
    }

    const field = page.locator('[data-otkliks-input]').first();
    const before = await ownSnapshot(page).catch(() => ({ count: 0, lastText: '' }));

    // Ввод значения так, чтобы React увидел его как пользовательский. Для <textarea>/
    // <input> — нативный value-setter + событие input (без нажатия Enter, иначе
    // многострочный текст ушёл бы по первому переносу). Для contenteditable — textContent.
    await field.click().catch(() => {});
    const entered = await field.evaluate((el, val) => {
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') {
        const proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
        if (setter) setter.call(el, val); else el.value = val;
      } else {
        el.textContent = val;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return (el.value || el.textContent || '').length;
    }, text).catch(() => 0);

    // Подстраховка: если значение не проставилось — печатаем реальными клавишами,
    // переносы строк — Shift+Enter, чтобы не отправить раньше времени.
    if (!entered) {
      await field.fill('').catch(() => {});
      for (const [i, para] of text.split('\n').entries()) {
        if (i > 0) await page.keyboard.press('Shift+Enter').catch(() => {});
        await field.pressSequentially(para, { delay: 2 }).catch(() => {});
      }
    }

    // Отправка: приоритет — найденная кнопка (если активна). Enter как крайняя мера.
    const sendBtn = page.locator('[data-otkliks-send]').first();
    let dispatched = false;
    if (tagged.send) {
      try {
        const disabled = await sendBtn.evaluate(
          (b) => b.disabled === true || b.getAttribute('aria-disabled') === 'true' || b.hasAttribute('disabled'),
        ).catch(() => false);
        if (!disabled) {
          await sendBtn.click();
          dispatched = true;
        }
      } catch { /* попробуем Enter ниже */ }
    }
    if (!dispatched) {
      await field.press('Enter').catch(() => {});
    }

    // ГЛАВНОЕ: подтверждаем, что сообщение реально появилось в переписке.
    const needle = normForMatch(text).slice(6, 46) || normForMatch(text).slice(0, 40);
    let confirmed = false;
    for (let i = 0; i < 12 && !confirmed; i += 1) {
      await page.waitForTimeout(600);
      const now = await ownSnapshot(page).catch(() => null);
      if (!now) continue;
      const appeared = now.count > before.count || normForMatch(now.lastText) !== normForMatch(before.lastText);
      if (appeared && (!needle || normForMatch(now.lastText).includes(needle))) confirmed = true;
    }

    if (!confirmed) {
      return { success: false, reason: 'NOT_CONFIRMED', detail: dispatched ? 'кнопка нажата, но сообщение не появилось' : 'кнопка отправки была неактивна' };
    }
    return { success: true };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// Сколько откликов hh сам перевёл в статус «Собеседование». Наш чат-классификатор
// ловит приглашения только из текста сообщений и часть пропускает, а на странице
// откликов hh есть точный счётчик во вкладке «Собеседование» — берём его как истину.
async function fetchInterviewCount(browserCtx) {
  const { browser, page } = await browserCtx.getPage();
  try {
    await page.goto('https://hh.ru/applicant/negotiations', { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Числа во вкладках дорисовываются скриптом — ждём появления постфиксов.
    await page.waitForSelector('[data-qa="tab-postfix"]', { timeout: 12000 }).catch(() => {});
    const count = await page.evaluate(() => {
      // Вкладка = метка «Собеседование» + счётчик [data-qa="tab-postfix"] рядом.
      // Ищем ИМЕННО метку (её текст ровно «Собеседование», без числа), затем
      // поднимаемся к контейнеру вкладки и читаем постфикс.
      const label = Array.from(document.querySelectorAll('span, a, div, button'))
        .find((el) => el.textContent && el.textContent.trim() === 'Собеседование');
      if (!label) return null;
      let el = label;
      for (let i = 0; i < 6 && el; i += 1) {
        const pf = el.querySelector && el.querySelector('[data-qa="tab-postfix"]');
        if (pf) {
          const n = parseInt(String(pf.textContent).replace(/\D/g, ''), 10);
          return Number.isFinite(n) ? n : 0;
        }
        el = el.parentElement;
      }
      // Вкладка есть, но без числа — значит приглашений ноль.
      return 0;
    });
    return typeof count === 'number' ? count : null;
  } catch {
    return null;
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = { fetchActiveThreads, fetchThreadMessages, sendReply, threadUrl, fetchInterviewCount, isChatChrome };
