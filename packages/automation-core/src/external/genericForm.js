/**
 * genericForm.js — анкета на произвольном сайте: Яндекс.Формы, конструкторы вроде
 * Typeform, страницы «откликнуться» на сайтах компаний.
 *
 * Google Forms живёт отдельным модулем: там своя разметка на ARIA-ролях и предсказуемая
 * механика. Здесь — всё остальное, где под капотом обычный HTML: input, textarea,
 * select, radio, checkbox. Подпись поля ищем так же, как её видит человек: label,
 * aria-label, placeholder, ближайший текст сверху — что найдётся первым.
 *
 * Границы те же, что и у Google-модуля, и они не про технику, а про смысл:
 *   • капча (reCAPTCHA/hCaptcha/Turnstile) — это прямая просьба сайта убедиться, что
 *     он говорит с человеком. Обходить её мы не будем ни при каких условиях;
 *   • поле пароля — это форма входа, а не анкета;
 *   • загрузка файла — нужен живой человек;
 *   • ноль распознанных полей — значит по ссылке вообще не анкета.
 * Всё перечисленное возвращается как blocked и уходит владельцу уведомлением.
 */

const FIELD_SELECTOR = [
  'input[type="text"]', 'input[type="email"]', 'input[type="tel"]', 'input[type="url"]',
  'input[type="number"]', 'input[type="date"]', 'input:not([type])',
  'textarea', 'select', 'input[type="radio"]', 'input[type="checkbox"]',
].join(', ');

const SUBMIT_TEXTS = ['Отправить', 'Отправить заявку', 'Откликнуться', 'Submit', 'Send', 'Готово'];
const NEXT_TEXTS = ['Далее', 'Дальше', 'Продолжить', 'Next', 'OK', 'Ок'];
const { detectVisibleBlockersInPage } = require('./pageBlockers');

// Капча по видимому тексту страницы (виджеты ловит pageBlockers.js).
const CAPTCHA_TEXT_RE = /я не робот|i'?m not a robot|подтвердите, что вы (не робот|человек)|введите (текст|символы) с картинки/i;
const CONFIRMATION_RE = /спасибо|отправлен|принят|получили ваш|ответ записан|thank you|submitted|received/i;
const MAX_STEPS = 8;

/**
 * Читает поля страницы. Работает и для одностраничных форм, и для пошаговых —
 * во втором случае за раз видно только текущий шаг, поэтому вызывается в цикле.
 */
async function readFields(page) {
  return page.evaluate((sel) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };

    // Подпись поля — то, что рядом с ним видит человек. Перебираем источники в том
    // порядке, в каком они обычно осмысленны. Машинное name («task_380806266_text»,
    // «answer_choices_79683596») подписью не бывает никогда: его видел человек в отчёте
    // о заполненной анкете, а модель отвечала, не зная вопроса (живой случай 29.09.2026).
    const CONTROL = 'input:not([type="hidden"]), textarea, select, [role="radio"], [role="checkbox"]';
    const hasControl = (node) => node.matches?.(CONTROL) || !!node.querySelector?.(CONTROL);
    const squash = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    const readableName = (v) => (v && !/\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}/i.test(v) ? v : '');
    // Те же правила, что в formAgent.snapshot: подсказка «Писать тут» — не вопрос, вопрос
    // анкеты hh — блок data-qa="task-question" перед полем, запасной путь — по расположению.
    const GENERIC_HINT = /^(?:писать тут|пишите тут|ваш ответ|ответ|введите(?: текст| ответ| значение)?|напишите(?: ответ| здесь| тут)?|текст|комментарий|сообщение)[.…:]*$/i;
    const meaningful = (t) => (t && !GENERIC_HINT.test(t) ? t : '');
    const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const hhTaskQuestion = (el) => {
      let q = null;
      for (const cand of document.querySelectorAll('[data-qa="task-question"]')) if (before(cand, el)) q = cand;
      if (!q) return '';
      const name = el.getAttribute('name');
      const foreign = Array.from(document.querySelectorAll(CONTROL)).some((c) => c !== el
        && !(name && c.getAttribute('name') === name) && before(q, c) && before(c, el));
      return foreign ? '' : squash(q.innerText || q.textContent).slice(0, 200);
    };
    const textNear = (el) => {
      const r = el.getBoundingClientRect();
      if (!r.height) return '';
      const scope = el.closest('form') || document.body;
      const name = el.getAttribute('name');
      const others = Array.from(scope.querySelectorAll(CONTROL)).filter((c) => c !== el && !(name && c.getAttribute('name') === name));
      let best = null; let bestGap = 160;
      for (const n of scope.querySelectorAll('*')) {
        if (n === el || n.contains(el) || hasControl(n)) continue;
        // Другое поле между текстом и нашим — это вопрос или заголовок чужого поля.
        if (others.some((c) => before(n, c) && before(c, el))) continue;
        if (!Array.from(n.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
        const b = n.getBoundingClientRect();
        if (!b.width || !b.height || b.right < r.left || b.left > r.right) continue;
        const gap = r.top - b.bottom;
        if (gap < -2 || gap >= bestGap) continue;
        best = n; bestGap = gap;
      }
      return best ? meaningful(squash(best.innerText || best.textContent).slice(0, 200)) : '';
    };

    // Ближайший текст выше поля в его собственном блоке; сосед с другим полем — это уже
    // чужой вопрос, дальше не идём.
    const textAbove = (el, maxDepth = 5) => {
      let node = el;
      for (let depth = 0; node && node !== document.body && depth < maxDepth; depth += 1) {
        for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
          if (hasControl(sib)) return '';
          const t = squash(sib.innerText || sib.textContent);
          if (t) return t.slice(0, 200);
        }
        const parent = node.parentElement;
        if (!parent) break;
        const own = squash(Array.from(parent.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
        if (own) return own.slice(0, 200);
        node = parent;
      }
      return '';
    };

    const labelFor = (el) => {
      const type = (el.getAttribute('type') || '').toLowerCase();
      const isText = !['radio', 'checkbox'].includes(type);
      if (isText) {
        const task = hhTaskQuestion(el);
        if (task) return task;
      }
      if (el.id) {
        const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const t = meaningful(squash(byFor?.textContent));
        if (t) return t;
      }
      const parentLabel = meaningful(squash(el.closest('label')?.textContent));
      if (parentLabel && parentLabel !== squash(el.getAttribute('placeholder'))) return parentLabel;
      const aria = meaningful(squash(el.getAttribute('aria-label')));
      if (aria) return aria;
      if (el.getAttribute('aria-labelledby')) {
        const ref = document.getElementById(el.getAttribute('aria-labelledby'));
        const t = meaningful(squash(ref?.textContent));
        if (t) return t;
      }
      const above = meaningful(textAbove(el, 8));
      if (above) return above;
      const ph = squash(el.getAttribute('placeholder'));
      if (meaningful(ph)) return ph;
      const near = isText ? textNear(el) : '';
      if (near) return near;
      return ph || readableName(el.name);
    };

    // Вопрос группы вариантов, когда нет ни fieldset/legend, ни aria: текст внутри
    // общего блока до первого варианта (так в анкете hh) или над этим блоком.
    const groupText = (el) => {
      const task = hhTaskQuestion(el);
      if (task) return task;
      const all = el.name ? Array.from(document.getElementsByName(el.name)) : [el];
      if (all.length < 2) return ''; // одиночная галочка — сама себе вопрос
      let box = el.parentElement;
      while (box && box !== document.body && !all.every((x) => box.contains(x))) box = box.parentElement;
      if (!box || box === document.body) return '';
      for (const child of Array.from(box.children)) {
        if (hasControl(child)) break;
        const t = squash(child.innerText || child.textContent);
        if (t) return t.slice(0, 200);
      }
      return textAbove(box);
    };

    // Яндекс.Формы (и не только) не всегда ставят нативный required — обязательность
    // рисуется текстом («Обязательное поле») или звёздочкой перед подписью. Живой тест
    // на реальной анкете кандидата поймал это: все текстовые поля были required=false,
    // хотя в подписи прямо стояло "*Ваше ФИО \n Обязательное поле" — форма могла уйти
    // с пустыми полями, которые работодатель считает обязательными.
    const REQUIRED_TEXT_RE = /обязательн|required/i;
    const looksRequiredByText = (label) => REQUIRED_TEXT_RE.test(label) || /^\s*\*/.test(label);

    const els = Array.from(document.querySelectorAll(sel)).filter(visible);
    const groups = new Map();

    els.forEach((el, index) => {
      const tag = el.tagName.toLowerCase();
      const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;

      if (type === 'radio' || type === 'checkbox') {
        // Переключатели объединяем в один вопрос по имени группы: человеку это один
        // вопрос с вариантами, и модели его надо показать так же.
        const key = `${type}:${el.name || labelFor(el)}`;
        if (!groups.has(key)) {
          groups.set(key, {
            id: `f${index}`, kind: type, name: el.name || '',
            title: '', options: [], required: false, indexes: [],
          });
        }
        const g = groups.get(key);
        g.options.push(labelFor(el) || el.value);
        g.indexes.push(index);
        g.required = g.required || el.required;
        if (!g.title) {
          // Живой тест на реальной анкете (Яндекс.Формы): группа радиокнопок лежит в
          // div[role="radiogroup"] с aria-labelledby на текст вопроса — ни fieldset, ни
          // legend там нет вообще. Без этого title падал до el.name — техническое
          // "answer_choices_79683596" вместо "Ваш опыт работы", и модель отвечала на
          // вопрос вслепую, не видя, о чём он.
          const ariaGroup = el.closest('[role="radiogroup"], [role="group"]');
          const labelledById = ariaGroup?.getAttribute('aria-labelledby')?.split(/\s+/)[0];
          const ariaLabelEl = labelledById && document.getElementById(labelledById);
          const fieldset = el.closest('fieldset');
          const legend = fieldset ? fieldset.querySelector('legend') : null;
          g.title = (ariaLabelEl && ariaLabelEl.textContent.trim())
            || (legend && legend.textContent.trim())
            || groupText(el)
            // Одиночная галочка: её собственная подпись; у группы подпись варианта
            // («Да») — худший запасной вариант, поэтому после читаемого name.
            || (document.getElementsByName(el.name || '\u0000').length > 1
              ? readableName(el.name) || labelFor(el)
              : labelFor(el) || readableName(el.name));
        }
        if (looksRequiredByText(g.title)) g.required = true;
        return;
      }

      const options = tag === 'select'
        ? Array.from(el.options).map((o) => o.textContent.trim()).filter(Boolean)
        : [];

      const label = labelFor(el);
      groups.set(`field:${index}`, {
        id: `f${index}`, kind: type === 'select' ? 'select' : (tag === 'textarea' ? 'paragraph' : 'text'),
        // Настоящий HTML-тип (email/tel/number/date/url) — раньше терялся за общим
        // kind:'text', и модель не могла отличить "email для связи" от произвольного
        // текстового поля. Отдаём отдельно, чтобы formAnswers мог не писать туда прозу.
        format: tag === 'input' ? type : undefined,
        title: label, options, required: el.required || looksRequiredByText(label), indexes: [index],
      });
    });

    return Array.from(groups.values()).filter((g) => g.title);
  }, FIELD_SELECTOR);
}

async function detectBlockers(page) {
  // Только видимое — см. pageBlockers.js: подстрока «captcha» в HTML и скрытые поля
  // пароля/файла давали ложные остановки.
  const b = await page.evaluate(detectVisibleBlockersInPage).catch(() => ({}));
  const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  if (b.captcha || CAPTCHA_TEXT_RE.test(text)) return 'REQUIRES_CAPTCHA';
  if (b.password) return 'REQUIRES_LOGIN';
  if (b.file) return 'REQUIRES_FILE_UPLOAD';
  return null;
}

async function clickButtonByText(page, texts) {
  for (const text of texts) {
    const btn = page
      .locator(`button:has-text("${text}"), input[type="submit"][value*="${text}"], [role="button"]:has-text("${text}"), a:has-text("${text}")`)
      .first();
    if ((await btn.count()) > 0 && await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      return true;
    }
  }
  const submit = page.locator('button[type="submit"], input[type="submit"]').first();
  if ((await submit.count()) > 0) {
    await submit.click({ timeout: 5000 }).catch(() => {});
    return true;
  }
  return false;
}

async function fillOne(page, field, value) {
  const all = page.locator(FIELD_SELECTOR);

  if (field.kind === 'text' || field.kind === 'email' || field.kind === 'tel'
      || field.kind === 'url' || field.kind === 'number' || field.kind === 'date'
      || field.kind === 'paragraph') {
    await all.nth(field.indexes[0]).fill(String(value));
    return true;
  }

  if (field.kind === 'select') {
    const el = all.nth(field.indexes[0]);
    try {
      await el.selectOption({ label: String(value) });
      return true;
    } catch {
      const opts = field.options.filter((o) => o.toLowerCase().includes(String(value).toLowerCase()));
      if (opts.length) {
        await el.selectOption({ label: opts[0] });
        return true;
      }
      return false;
    }
  }

  if (field.kind === 'radio' || field.kind === 'checkbox') {
    const values = Array.isArray(value) ? value : [value];
    let done = 0;
    for (const v of values) {
      const optionIndex = field.options.findIndex(
        (o) => o.toLowerCase().trim() === String(v).toLowerCase().trim()
          || o.toLowerCase().includes(String(v).toLowerCase()),
      );
      if (optionIndex === -1) continue;
      await all.nth(field.indexes[optionIndex]).check({ timeout: 3000 }).catch(() => {});
      done += 1;
    }
    return done > 0;
  }

  return false;
}

/** Читает форму, не трогая её. @returns {{title, description, questions, blocked?}} */
async function readForm(browserCtx, url) {
  const { browser, page } = await browserCtx.getPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500); // формы на JS дорисовываются после загрузки

    const blocked = await detectBlockers(page);
    if (blocked) {
      const title = await page.title().catch(() => '');
      return { title, description: '', questions: [], blocked };
    }

    const fields = await readFields(page);
    const title = await page.title().catch(() => '');
    if (!fields.length) return { title, description: '', questions: [], blocked: 'NO_QUESTIONS_FOUND' };

    // Наружу отдаём тот же формат вопросов, что и Google-модуль: дальше по конвейеру
    // (генерация ответов, эскалация) разницы между источниками быть не должно.
    const questions = fields.map((f) => ({
      id: f.id, title: f.title, type: f.kind, required: f.required, options: f.options, format: f.format,
    }));
    return { title, description: '', questions };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/** Заполняет и отправляет. Поддерживает пошаговые формы (кнопка «Далее»). */
async function fillAndSubmit(browserCtx, url, answers) {
  const byId = new Map(answers.map((a) => [a.id, a.value]));
  // Что именно вписали — для показа человеку в ленте и в кабинете.
  const filledFields = [];
  const { browser, page } = await browserCtx.getPage();
  const missed = [];
  let filled = 0;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    const blocked = await detectBlockers(page);
    if (blocked) return { submitted: false, filled: 0, missed: [], reason: blocked };

    for (let step = 0; step < MAX_STEPS; step += 1) {
      const fields = await readFields(page);
      for (const f of fields) {
        const value = byId.get(f.id);
        if (value === undefined || value === null || value === '') {
          if (f.required) missed.push(f.title);
          continue;
        }
        const ok = await fillOne(page, f, value).catch(() => false);
        if (ok) {
          filled += 1;
          filledFields.push({ question: f.title, answer: Array.isArray(value) ? value.join(', ') : String(value) });
        } else if (f.required) missed.push(f.title);
      }

      if (!filled && !fields.length) break;

      const urlBefore = page.url();
      const submitted = await clickButtonByText(page, SUBMIT_TEXTS);
      if (submitted) {
        await page.waitForTimeout(2500);
        const text = await page.evaluate(() => document.body.innerText).catch(() => '');
        if (CONFIRMATION_RE.test(text) || page.url() !== urlBefore) {
          return { submitted: true, filled, missed, fields: filledFields };
        }
        // Кнопка нажалась, подтверждения нет — возможно, это был шаг, а не финал.
      }
      const went = await clickButtonByText(page, NEXT_TEXTS);
      if (!went) break;
      await page.waitForTimeout(1500);
    }

    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (CONFIRMATION_RE.test(text)) return { submitted: true, filled, missed, fields: filledFields };

    return {
      submitted: false, filled, missed, fields: filledFields,
      reason: missed.length ? 'REQUIRED_UNANSWERED' : (filled ? 'NO_CONFIRMATION' : 'NO_QUESTIONS_FOUND'),
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = { readForm, fillAndSubmit, readFields, FIELD_SELECTOR };
