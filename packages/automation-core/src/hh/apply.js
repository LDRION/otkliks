/**
 * apply.js — клик "Откликнуться" с вставкой сопроводительного письма. Портировано из
 * личного hhorosho (откалибровано вживую на реальном hh.ru-аккаунте — три шага: выбор
 * резюме → "Добавить сопроводительное" раскрывает textarea → отправка). browserCtx
 * параметром вместо singleton-импорта.
 *
 * hh.ru рендерит пикер резюме ДВУМЯ разными способами в зависимости от состояния:
 * всплывающий listbox ([data-qa="drop-base"]), когда предвыбрано ДРУГОЕ резюме, ИЛИ
 * полноэкранный шаг модалки "Резюме для отклика" (без drop-base), когда нужное резюме
 * уже дефолтное. Настоящий .click() по строке резюме (не force-check самого radio)
 * работает в обоих вариантах одинаково.
 */

const { CLOSED_VACANCY_RE } = require('./vacancyState');

const APPLY_BUTTON_SELECTORS = [
  '[data-qa="vacancy-response-link-top"]',
  '[data-qa="vacancy-response-link-bottom"]',
  'button:has-text("Откликнуться")',
  'a:has-text("Откликнуться")',
];

// Раньше «вакансия закрыта» молча схлопывалось в APPLY_BUTTON_NOT_FOUND (retryable) и
// вакансия висела в вечном повторе — см. store.js ERROR_RETRY_WINDOW_MS для второго
// слоя защиты от той же беды, если верстка правда сломалась, а не просто закрылась.

const LETTER_TEXTAREA_SELECTORS = ['[data-qa="vacancy-response-popup-form-letter-input"]'];
const SUBMIT_SELECTORS = ['[data-qa="vacancy-response-submit-popup"]'];

const SUCCESS_TEXT = /отклик (успешно )?отправлен|вы откликнулись|резюме отправлено|отклик доставлен|ваш отклик/i;

// Вакансия в другой стране (Ташкент, Алматы, Минск…): перед окном отклика hh спрашивает
// «всё равно откликнуться?». Живой разбор: 7 из 7 потерянных «hh не показал окно
// отклика» за сутки — ровно такие вакансии, а российские с той же кнопкой проходили.
// Переезд этим не обещаем — это лишь подтверждение, что отклик в другую страну намеренный;
// вопрос о переезде в переписке по-прежнему уходит человеку (см. replyAgent.js).
const RELOCATION_CONFIRM = [
  '[data-qa="relocation-warning-confirm"]',
  'button:has-text("Все равно откликнуться")',
  'button:has-text("Всё равно откликнуться")',
].join(', ');

// Сколько ждём реакции hh.ru на «Откликнуться». 12 секунд — с запасом на медленный
// ответ: цена лишнего ожидания это несколько секунд на вакансию, цена нетерпения —
// терминальный MODAL_NOT_FOUND и потерянный отклик.
const MODAL_TIMEOUT_MS = 12000;

async function clickFirstMatch(root, selectors, timeout = 5000) {
  for (const sel of selectors) {
    try {
      const loc = root.locator(sel).first();
      await loc.waitFor({ state: 'visible', timeout });
      await loc.click();
      return true;
    } catch { /* пробуем следующий селектор */ }
  }
  return false;
}

async function fillFirstMatch(root, selectors, text, timeout = 5000) {
  for (const sel of selectors) {
    try {
      const loc = root.locator(sel).first();
      await loc.waitFor({ state: 'visible', timeout });
      await loc.fill(text);
      return true;
    } catch { /* пробуем следующий селектор */ }
  }
  return false;
}

async function selectResumeIfNeeded(page, dialog, resumeId) {
  const openTrigger = dialog.locator('[data-qa="cell"]').first();
  if ((await openTrigger.count()) === 0) return;

  try {
    await openTrigger.click({ timeout: 3000 });
    await page.waitForTimeout(700);

    const targetRow = dialog.locator(`[data-qa="cell"]:has(input[type="radio"][value="${resumeId}"])`).first();
    if ((await targetRow.count()) > 0) {
      await targetRow.click({ timeout: 3000 });
      await page.waitForTimeout(500);
    }
  } catch (e) {
    console.warn(`⚠️ hh/apply: не удалось выбрать резюме ${resumeId} в пикере — продолжаю с тем, что выбрано по умолчанию:`, e.message);
  }
}

// Что было на странице, когда окно отклика так и не появилось. Только элементы, которые
// могут объяснить затык (окна, предупреждения, всё про отклик) — шапка сайта не нужна.
// Уходит в skipDetail на сервер: следующий такой случай объяснит себя сам, без логов.
async function describeStuckPage(page) {
  return page.evaluate(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const clean = (t) => String(t || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const marks = [...document.querySelectorAll('[data-qa]')]
      .filter((el) => /relocation|warning|response|modal|popup|dialog|confirm/i.test(el.getAttribute('data-qa')) && visible(el))
      .map((el) => `${el.getAttribute('data-qa')}${clean(el.innerText) ? `=«${clean(el.innerText)}»` : ''}`);
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
    const shown = dialogs.filter(visible).map((d) => `«${clean(d.innerText)}»`);
    return [
      `окон: ${dialogs.length} (видно ${shown.length}${shown.length ? `: ${shown.join(' ')}` : ''})`,
      marks.length ? `элементы: ${[...new Set(marks)].slice(0, 6).join(', ')}` : '',
      /\/vacancy\//.test(location.pathname) ? '' : `адрес: ${location.href.slice(0, 120)}`,
    ].filter(Boolean).join('; ');
  }).catch(() => '');
}

// Возвращает { success, reason } — reason заполнен только при success:false.
async function applyToVacancy(browserCtx, vacancyUrl, resumeId, coverLetterText) {
  const { browser, page } = await browserCtx.getPage();
  try {
    await page.goto(vacancyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (!(await browserCtx.isLoggedIn(page))) {
      return { success: false, reason: 'LOGGED_OUT' };
    }

    const bodyTextBefore = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (SUCCESS_TEXT.test(bodyTextBefore)) {
      return { success: false, reason: 'ALREADY_APPLIED' };
    }

    let clickedApply = await clickFirstMatch(page, APPLY_BUTTON_SELECTORS);
    if (!clickedApply) {
      // Самолечение: known-селекторы могли устареть (hh.ru регулярно меняет вёрстку —
      // ровно так сломался и композер чата). Ищем ЛЮБУЮ видимую кликабельную «Откликнуться»
      // эвристически, а не по конкретному data-qa/тегу.
      try {
        const heuristic = page
          .locator('button, a')
          .filter({ hasText: /^\s*Откликнуться\s*$/i })
          .first();
        await heuristic.waitFor({ state: 'visible', timeout: 4000 });
        await heuristic.click();
        clickedApply = true;
      } catch { /* эвристика тоже не нашла — ниже разбираемся, почему */ }
    }
    if (!clickedApply) {
      const bodyTextNow = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (CLOSED_VACANCY_RE.test(bodyTextNow)) {
        return { success: false, reason: 'VACANCY_CLOSED' };
      }
      return { success: false, reason: 'APPLY_BUTTON_NOT_FOUND' };
    }

    // Ждём ИСХОД клика, а не фиксированную паузу. Здесь стояли 1.5 секунды и сразу
    // проверка наличия модалки: если hh.ru отвечал медленнее, окно отклика ещё не
    // успевало появиться и вакансия помечалась MODAL_NOT_FOUND. Причина терминальная —
    // к такой вакансии автопилот больше не возвращается, так что каждая «недождавшаяся»
    // это безвозвратно потерянный отклик, а не отложенный.
    const dialog = page.locator('[role="dialog"]');
    const relocationBtn = page.locator(RELOCATION_CONFIRM).first();
    const waitOutcome = () => Promise.race([
      dialog.first().waitFor({ state: 'visible', timeout: MODAL_TIMEOUT_MS }).then(() => 'modal', () => null),
      // Часть вакансий вместо модалки уводит на страницу с анкетой работодателя —
      // отдельный сценарий, здесь не реализован (не путать с настоящей ошибкой).
      page.waitForURL(/\/applicant\/vacancy_response/, { timeout: MODAL_TIMEOUT_MS }).then(() => 'screening', () => null),
      page.getByText(SUCCESS_TEXT).first().waitFor({ state: 'visible', timeout: MODAL_TIMEOUT_MS }).then(() => 'success', () => null),
      relocationBtn.waitFor({ state: 'visible', timeout: MODAL_TIMEOUT_MS }).then(() => 'relocation', () => null),
    ]);

    let outcome = await waitOutcome();
    // Проверяем кнопку и при исходе 'modal': если предупреждение само оформлено окном,
    // гонку мог выиграть его role="dialog", и дальше мы искали бы поле письма не там.
    let relocation = false;
    if (outcome === 'relocation' || (await relocationBtn.isVisible().catch(() => false))) {
      relocation = true;
      await relocationBtn.click({ timeout: 5000 }).catch(() => {});
      // Ждём, пока предупреждение уйдёт: иначе его же закрывающееся окно выиграло бы
      // следующую гонку как «окно отклика».
      await relocationBtn.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      outcome = await waitOutcome();
    }

    if (outcome === 'success') return { success: true, relocation };
    // Адрес анкеты отдаём наверх: дальше её может пройти агент форм — это тот же
    // скрининг, просто на отдельной странице.
    if (outcome === 'screening') {
      return { success: false, reason: 'REQUIRES_SCREENING_QUESTIONS', formUrl: page.url(), relocation };
    }

    let bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (outcome !== 'modal') {
      // Ничего из трёх исходов не дождались — последняя проверка по факту страницы:
      // окно могло отрисоваться без role="dialog", а отклик — уже уйти.
      if (SUCCESS_TEXT.test(bodyText)) return { success: true, relocation };
      if (/\/applicant\/vacancy_response/.test(page.url())) {
        return { success: false, reason: 'REQUIRES_SCREENING_QUESTIONS', formUrl: page.url(), relocation };
      }
      // Окно отклика не появилось — обычно это значит, что отклик уходит на сайт
      // работодателя. Отдаём адрес: там почти всегда обычная форма, которую агент
      // умеет заполнять.
      return {
        success: false, reason: 'MODAL_NOT_FOUND', formUrl: page.url(), relocation,
        detail: await describeStuckPage(page),
      };
    }

    await selectResumeIfNeeded(page, dialog, resumeId);

    const addLetterBtn = dialog.locator('[data-qa="add-cover-letter"]');
    if ((await addLetterBtn.count()) > 0) {
      await addLetterBtn.click();
      await page.waitForTimeout(700);
    }

    const filledLetter = await fillFirstMatch(dialog, LETTER_TEXTAREA_SELECTORS, coverLetterText);
    if (!filledLetter) {
      return { success: false, reason: 'LETTER_FORM_NOT_FOUND', relocation, detail: await describeStuckPage(page) };
    }

    const submitted = await clickFirstMatch(dialog, SUBMIT_SELECTORS);
    if (!submitted) {
      return { success: false, reason: 'SUBMIT_BUTTON_NOT_FOUND' };
    }

    // hh подтверждает отклик по-разному: текстом, исчезновением окна, сменой кнопки
    // на «Отклик отправлен». Две секунды и один шаблон текста давали ложное
    // SUBMIT_NOT_CONFIRMED — отклик уходил, а мы считали его неудачей и заваливали
    // человека уведомлениями «5 вакансий подряд».
    const confirmed = await Promise.race([
      page.getByText(SUCCESS_TEXT).first().waitFor({ state: 'visible', timeout: 12000 })
        .then(() => true, () => null),
      dialog.first().waitFor({ state: 'detached', timeout: 12000 }).then(() => true, () => null),
      page.locator('[data-qa="vacancy-response-link-view-topic"], [data-qa*="response-sent"]')
        .first().waitFor({ state: 'visible', timeout: 12000 }).then(() => true, () => null),
    ]);

    if (confirmed) return { success: true, relocation };

    bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (SUCCESS_TEXT.test(bodyText)) return { success: true, relocation };

    return { success: false, reason: 'SUBMIT_NOT_CONFIRMED' };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = { applyToVacancy };
