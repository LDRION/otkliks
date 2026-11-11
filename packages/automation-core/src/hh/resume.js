/**
 * resume.js — живое чтение текста резюме со страницы hh.ru перед каждой генерацией
 * (правишь резюме на hh.ru руками — бот сразу видит, без ручной синхронизации).
 * Портировано из личного hhorosho, browserCtx теперь параметром (не singleton-импорт).
 */

// Разбор ссылки вынесен в resumeInput.js: прежняя версия понимала только адрес
// «похожих вакансий» (?resume=<id>) и спотыкалась о ссылку на само резюме, которую
// человек и вставляет.
const { extractResumeId } = require('./resumeInput');

// На странице резюме нет отдельного контейнера "просто текст резюме" — это личный кабинет
// владельца целиком: виджет "дозаполните резюме", кнопки "поднять"/видимость, рекламный
// баннер — вперемешку с реальным содержимым. Вычитаем ИЗВЕСТНЫЙ мусор из main и берём всё,
// что осталось — переживает больше вариаций содержимого между резюме, чем перечисление
// "хороших" секций.
const NOISE_SELECTORS = [
  '[data-qa="suitable-vacancies-suggest-card"]',
  '[data-qa="resume-update-button"]',
  '[data-qa="resume-visibility-card"]',
  '[data-qa^="cp-entrypoint__banner"]',
  '[data-qa="resume-avatar"]',
  '[data-qa*="resume-photo-proxy"]',
  '[data-qa="resume-download-button"]',
  '[data-qa="skills-methods_motivation-banner"]',
  '[data-qa="resume-contacts-phone"]',
  '[data-qa="resume-contact-email"]',
  'form',
];

async function fetchResumeText(browserCtx, resumeInputUrl) {
  const resumeId = extractResumeId(resumeInputUrl);
  const { browser, page } = await browserCtx.getPage();
  try {
    await page.goto(`https://hh.ru/resume/${resumeId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (!(await browserCtx.isLoggedIn(page))) {
      throw new Error('LOGGED_OUT');
    }

    // Удаляем шум прямо в живом DOM (не cloneNode) — на отсоединённом от документа клоне
    // innerText перестаёт учитывать CSS-рендеринг и включает содержимое <script>/скрытых
    // элементов. Страница одноразовая, мутировать её ничем не грозит.
    const text = await page.evaluate((noiseSelectors) => {
      const root = document.querySelector('main') || document.body;
      noiseSelectors.forEach((sel) => root.querySelectorAll(sel).forEach((el) => el.remove()));
      return root.innerText.trim();
    }, NOISE_SELECTORS);

    if (!text) {
      console.warn(`⚠️ hh/resume: пустой текст резюме ${resumeId} после чистки — проверь вручную.`);
    }
    return text;
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = { fetchResumeText, extractResumeId };
