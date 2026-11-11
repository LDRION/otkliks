/**
 * googleForm.js — чтение и заполнение анкеты в Google Forms.
 *
 * Самый частый внешний этап: работодатель пишет в чат «заполните анкету» и даёт
 * ссылку на forms.gle. Для кандидата это тот же скрининг, что и вопросы в переписке,
 * только руками и в другом окне.
 *
 * Формы читаем через ARIA-роли, а не через классы: классы в Google Forms
 * сгенерированы и меняются, роли (listitem/heading/radio/checkbox/listbox) стабильны,
 * потому что на них держится доступность.
 *
 * Чего сознательно НЕ делаем: форм с обязательным входом в Google-аккаунт, загрузкой
 * файлов и капчей не трогаем — там либо нужен живой человек, либо это уже обход
 * защиты, а не заполнение анкеты. Такие возвращаем как escalate, и с ними разбирается
 * владелец.
 */

const QUESTION_SELECTOR = 'div[role="listitem"]';
const SUBMIT_TEXTS = ['Отправить', 'Submit', 'Надіслати'];
const NEXT_TEXTS = ['Далее', 'Next', 'Далі'];
const CONFIRMATION_RE = /ответ записан|ваш ответ сохранен|your response has been recorded|thanks for filling/i;
const SIGN_IN_RE = /войдите в аккаунт|sign in to google|необходимо войти/i;
const MAX_PAGES = 5;

/** Собирает вопросы текущей страницы формы: id, заголовок, тип, варианты. */
async function readQuestions(page) {
  return page.evaluate((sel) => {
    const items = Array.from(document.querySelectorAll(sel));
    return items.map((item, index) => {
      const headingEl = item.querySelector('[role="heading"]');
      const title = (headingEl ? headingEl.textContent : '').trim();
      if (!title) return null;

      // Звёздочку обязательности Google рисует отдельным узлом с aria-label.
      const required = !!item.querySelector('[aria-label*="бязательн"], [aria-label*="Required"]')
        || /\*$/.test(title);

      const optionNodes = Array.from(item.querySelectorAll('[role="radio"], [role="checkbox"]'));
      // У радио значение лежит в data-value, у чекбоксов — в data-answer-value.
      // Без второго атрибута варианты чекбоксов не попадали в промпт, модель отвечала
      // своими словами, и ни одна галочка не проставлялась.
      const options = optionNodes
        .map((n) => (
          n.getAttribute('data-value')
          || n.getAttribute('data-answer-value')
          || n.getAttribute('aria-label')
          || n.textContent
          || ''
        ).trim())
        .filter(Boolean);

      let type = 'text';
      if (item.querySelector('textarea')) type = 'paragraph';
      else if (item.querySelector('[role="radiogroup"]') || item.querySelector('[role="radio"]')) type = 'radio';
      else if (item.querySelector('[role="checkbox"]')) type = 'checkbox';
      else if (item.querySelector('[role="listbox"]')) type = 'dropdown';
      else if (item.querySelector('input[type="file"]')) type = 'file';
      else if (item.querySelector('input[type="date"]')) type = 'date';

      return { id: `q${index}`, index, title: title.replace(/\s*\*$/, ''), type, required, options };
    }).filter(Boolean);
  }, QUESTION_SELECTOR);
}

async function readFormMeta(page) {
  return page.evaluate(() => {
    const h = document.querySelector('[role="heading"]');
    const desc = document.querySelector('[role="heading"] + div');
    return {
      title: (h ? h.textContent : document.title || '').trim(),
      description: (desc ? desc.textContent : '').trim().slice(0, 500),
    };
  });
}

/** Клик по кнопке с одной из подписей. Google рисует кнопки как div[role=button]. */
async function clickButtonByText(page, texts) {
  for (const text of texts) {
    const btn = page.locator(`div[role="button"]:has-text("${text}"), button:has-text("${text}")`).first();
    if ((await btn.count()) > 0) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function fillOne(page, question, value) {
  const item = page.locator(QUESTION_SELECTOR).nth(question.index);

  if (question.type === 'text' || question.type === 'date') {
    await item.locator('input[type="text"], input[type="date"], input:not([type])').first().fill(String(value));
    return true;
  }

  if (question.type === 'paragraph') {
    await item.locator('textarea').first().fill(String(value));
    return true;
  }

  if (question.type === 'radio') {
    const target = item.locator(`[role="radio"][data-value="${String(value).replace(/"/g, '\\"')}"]`).first();
    if ((await target.count()) > 0) {
      await target.click();
      return true;
    }
    // Модель могла ответить близко по смыслу, но не буква в букву — берём вариант,
    // который содержит её ответ (или наоборот). Иначе обязательный вопрос останется
    // пустым и форма просто не отправится.
    const byText = item.locator(`[role="radio"]`).filter({ hasText: String(value).slice(0, 40) }).first();
    if ((await byText.count()) > 0) {
      await byText.click();
      return true;
    }
    return false;
  }

  if (question.type === 'checkbox') {
    const values = Array.isArray(value) ? value : [value];
    let clicked = 0;
    for (const v of values) {
      const box = item.locator(`[role="checkbox"][data-answer-value="${String(v).replace(/"/g, '\\"')}"]`).first();
      if ((await box.count()) > 0) {
        await box.click();
        clicked += 1;
      }
    }
    return clicked > 0;
  }

  if (question.type === 'dropdown') {
    await item.locator('[role="listbox"]').first().click();
    const option = page.locator(`[role="option"][data-value="${String(value).replace(/"/g, '\\"')}"]`).first();
    if ((await option.count()) > 0) {
      await option.click();
      return true;
    }
    await page.keyboard.press('Escape');
    return false;
  }

  return false; // file и всё незнакомое — не наша забота
}

/**
 * Читает форму целиком (все страницы) — без заполнения.
 * @returns {{ title, description, questions: Array, blocked?: string }}
 */
async function readForm(browserCtx, url) {
  const { browser, page } = await browserCtx.getPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(QUESTION_SELECTOR, { timeout: 15000 }).catch(() => {});

    // Форма, требующая входа, не всегда показывает предупреждение НА СЕБЕ — Google часто
    // молча РЕДИРЕКТИТ на отдельный accounts.google.com/.../signin, где текста из SIGN_IN_RE
    // нет вовсе (там "Вход", "Телефон или адрес эл. почты" — обычная форма логина). Раньше
    // это тихо схлопывалось в NO_QUESTIONS_FOUND («не нашлось анкеты, нужен ваш взгляд»),
    // хотя реальная причина — не настроен вход, а не то, что по ссылке нет анкеты.
    const onGoogleSignIn = /^https:\/\/accounts\.google\.com\//.test(page.url());
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (onGoogleSignIn || SIGN_IN_RE.test(bodyText)) {
      return { title: '', description: '', questions: [], blocked: 'REQUIRES_GOOGLE_SIGN_IN' };
    }

    const meta = await readFormMeta(page);
    const questions = await readQuestions(page);
    if (!questions.length) {
      return { ...meta, questions: [], blocked: 'NO_QUESTIONS_FOUND' };
    }
    if (questions.some((q) => q.type === 'file')) {
      return { ...meta, questions, blocked: 'REQUIRES_FILE_UPLOAD' };
    }
    return { ...meta, questions };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * Заполняет и отправляет форму готовыми ответами.
 * @param {Array<{id: string, value: any}>} answers
 * @returns {{ submitted: boolean, filled: number, missed: Array<string>, reason?: string }}
 */
async function fillAndSubmit(browserCtx, url, answers) {
  const byId = new Map(answers.map((a) => [a.id, a.value]));
  // Что именно вписали — для показа человеку в ленте и в кабинете.
  const filledFields = [];
  const { browser, page } = await browserCtx.getPage();
  const missed = [];
  let filled = 0;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(QUESTION_SELECTOR, { timeout: 15000 }).catch(() => {});

    for (let pageNum = 0; pageNum < MAX_PAGES; pageNum += 1) {
      const questions = await readQuestions(page);

      for (const q of questions) {
        const value = byId.get(q.id);
        if (value === undefined || value === null || value === '') {
          if (q.required) missed.push(q.title);
          continue;
        }
        const ok = await fillOne(page, q, value).catch(() => false);
        if (ok) {
          filled += 1;
          filledFields.push({ question: q.title, answer: Array.isArray(value) ? value.join(', ') : String(value) });
        } else if (q.required) missed.push(q.title);
      }

      // Многостраничные формы: пока есть «Далее» — идём дальше, вопросы следующей
      // страницы читаются заново (они появляются в DOM только после перехода).
      const submitted = await clickButtonByText(page, SUBMIT_TEXTS);
      if (submitted) break;
      const went = await clickButtonByText(page, NEXT_TEXTS);
      if (!went) break;
      await page.waitForTimeout(1200);
    }

    await page.waitForTimeout(2000);
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (CONFIRMATION_RE.test(bodyText)) return { submitted: true, filled, missed, fields: filledFields };

    return { submitted: false, filled, missed, fields: filledFields, reason: missed.length ? 'REQUIRED_UNANSWERED' : 'NO_CONFIRMATION' };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = { readForm, fillAndSubmit, readQuestions, QUESTION_SELECTOR, CONFIRMATION_RE };
