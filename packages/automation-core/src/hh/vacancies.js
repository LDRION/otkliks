/**
 * vacancies.js — список "подходящих вакансий" под резюме + карточка вакансии.
 * Портировано из личного hhorosho, browserCtx параметром.
 */

const { extractWithFallback } = require('../dom');

// Сколько ждём одну страницу выдачи целиком. Здоровая отдаётся за секунды.
const PAGE_DEADLINE_MS = 60 * 1000;

/** Падает с TIMEOUT, если промис не уложился — чтобы зависшая вкладка не съела круг. */
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Ссылка на вакансию в выдаче. Первый селектор — нынешний заголовок карточки,
// второй — страховка на случай очередной смены data-qa: адрес вида /vacancy/<id>
// у hh не меняется, в отличие от обёрток и классов вокруг него.
const LINK_SELECTOR = 'a[data-qa="serp-item__title"], a[data-qa*="vacancy-serp__vacancy-title"], a[href*="/vacancy/"]';

/**
 * Список подобранных вакансий. Обходит несколько страниц выдачи: одной страницы
 * (20 карточек) хватало ровно на первый прогон, дальше автопилот простаивал, хотя
 * дневной лимит был выбран едва на треть. Идём, пока страницы отдают НОВЫЕ карточки:
 * hh.ru за последней страницей начинает повторять предыдущую, а не отдавать пустоту.
 */
// hh.ru отдаёт свои 20 карточек на страницу и параметр items_on_page не уважает:
// на живой выдаче при items_on_page=20 приходит 20 карточек, при 50 — семнадцать.
// Раньше здесь стояло 50, и обход страниц ломался на первом же шаге — см. STOP_WHEN
// ниже: условие «страница неполная» срабатывало всегда, пагинация не работала вовсе,
// и весь пул сводился к одной странице на источник. Отсюда и паузы: вакансии
// кончались за первые прогоны.
const PAGE_SIZE = 20;

// Курсор глубины по каждому источнику: докуда дочитали в прошлых кругах. Живёт, пока
// открыт лаунчер; после перезапуска первый круг просто пройдёт от начала.
const depthState = new Map(); // ключ источника → { cursor, restUntil }
const TOP_PAGES = 3;               // верх выдачи — каждый круг
const DEEP_PAGES_PER_ROUND = 12;   // вглубь за один круг, не больше
const MAX_PAGE = 100;              // hh отдаёт не дальше 2000 результатов (100 стр. по 20)
const RESWEEP_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * Пул вакансий на прогон: подобранные под резюме ПЛЮС обычный поиск по ключевым
 * словам.
 *
 * Зачем второй источник. Подборка «похожие на резюме» конечна: автопилот
 * разбирает её за первые прогоны, дальше в каждом круге оказывается одна-две
 * новые карточки, между откликами повисают паузы, а дневной лимит остаётся
 * невыбранным. Обычный поиск по названию профессии и стеку добирает то, что hh
 * в подборку не положил — свежие вакансии там появляются постоянно.
 *
 * Дедупликация по vacancyId: одна и та же вакансия приходит из обоих источников,
 * и отклик по ней нужен ровно один.
 */
async function fetchVacancyPool(browserCtx, {
  resumeInputUrl,
  queries = [],
  topPages = TOP_PAGES,
  deepPagesPerRound = DEEP_PAGES_PER_ROUND,
  // Сколько необработанных вакансий достаточно на круг. 50 растягивали круг минут на
  // двадцать (оценка каждой — ~15 с плюс письма и отклики), и всё это время чаты ждали.
  enough = 30,
  filterFresh,
  log = console.log,
}) {
  const { toSearchUrl } = require('./resumeInput');
  const seen = new Set();
  const pool = [];

  // Источники по порядку: сначала подборка под резюме (там точнее попадание), затем
  // поиск по названию профессии и стеку. У каждого — ключ для курсора глубины.
  const sources = [
    { key: `resume:${resumeInputUrl}`, type: 'подборка под резюме',
      urlFor: (pageNum) => toSearchUrl(resumeInputUrl, { page: pageNum, itemsOnPage: PAGE_SIZE }) },
    ...queries.filter(Boolean).map((query) => ({
      key: `q:${String(query).toLowerCase()}`, type: `поиск «${String(query).slice(0, 40)}»`,
      urlFor: (pageNum) => searchUrl(query, pageNum),
    })),
  ];

  log(`🔍 Сбор вакансий: ${sources.length} источников (подборка + ${sources.length - 1} поисков)`);

  const enoughNow = async () => Boolean(filterFresh) && (await filterFresh(pool)).length >= enough;
  // Есть ли источник, который ещё не дочитан вглубь. Планировщик по этому флагу не уходит
  // на десятиминутную паузу после «пустого» круга: после перезапуска лаунчера курсор
  // начинается сверху, и первый круг может пройти только уже разобранные страницы.
  const markPending = () => { pool.deepPending = sources.some((s) => {
    const st = depthState.get(s.key);
    return !st || Date.now() >= st.restUntil;
  }); };

  for (const src of sources) {
    const st = depthState.get(src.key) || { cursor: topPages, restUntil: 0 };
    const stat = { top: 0, deepFrom: 0, deepTo: 0, cards: 0, added: 0 };
    let prevIds = null;
    let ended = false;
    let failed = false;
    let satisfied = false;

    // 'ok' | 'end' | 'error'. За последней страницей hh не отдаёт пустоту, а повторяет
    // последнюю — это тоже конец выдачи.
    const take = async (pageNum) => {
      let batch;
      try {
        // Свой предел на страницу. Внутри goto и ожидание карточек таймауты имеют, а
        // page.evaluate и закрытие вкладки — нет: на «полудохлом» CDP они висят молча.
        batch = await withTimeout(fetchCardsFromUrl(browserCtx, src.urlFor(pageNum)), PAGE_DEADLINE_MS);
      } catch (e) {
        if (e.message === 'LOGGED_OUT') throw e;
        log(`  ❌ ${src.type}, стр.${pageNum + 1}: ОШИБКА — ${e.message}`);
        return 'error';
      }
      if (pageNum === 0 && !batch.length && batch.diagnostic) {
        log(`  ⚠️ ${src.type}: на первой странице 0 карточек — ${batch.diagnostic}`);
      }
      const ids = batch.map((v) => v.vacancyId);
      if (!batch.length || (prevIds && ids.every((id) => prevIds.has(id)))) return 'end';
      prevIds = new Set(ids);
      stat.cards += batch.length;
      for (const v of batch) {
        if (seen.has(v.vacancyId)) continue;
        seen.add(v.vacancyId);
        pool.push(v);
        stat.added += 1;
      }
      return 'ok';
    };

    // Верх — каждый круг: там появляется новое.
    for (let pageNum = 0; pageNum < topPages; pageNum += 1) {
      const r = await take(pageNum);
      if (r !== 'ok') { ended = r === 'end'; failed = r === 'error'; break; }
      stat.top += 1;
      if (await enoughNow()) { satisfied = true; break; }
    }

    // Вглубь — с места, где остановился прошлый круг. Раньше каждый круг перечитывал одни
    // и те же 15 страниц с начала и дальше не заглядывал: подборка на ~1300 вакансий
    // выдавала 300, остальные автопилот не видел ни разу, выдача «кончалась», и он по
    // двадцать минут перебирал разобранное, не делая ни одного отклика.
    const resting = Date.now() < st.restUntil;
    if (!ended && !failed && !satisfied && !resting) {
      prevIds = null; // прыжок: сравнивать с верхней страницей бессмысленно
      let pageNum = Math.max(st.cursor, topPages);
      stat.deepFrom = pageNum + 1;
      for (let read = 0; read < deepPagesPerRound; read += 1) {
        if (pageNum >= MAX_PAGE) { ended = true; break; }
        const r = await take(pageNum);
        if (r !== 'ok') { ended = r === 'end'; failed = r === 'error'; break; }
        pageNum += 1;
        stat.deepTo = pageNum;
        if (await enoughNow()) { satisfied = true; break; }
      }
      st.cursor = pageNum;
    }
    // Источник пройден до конца: курсор в начало и отдых — перебирать заново всё
    // разобранное каждые пару минут дорого и заметно для hh. Верх при этом читаем как обычно.
    if (ended) {
      st.cursor = topPages;
      st.restUntil = Date.now() + RESWEEP_AFTER_MS;
    }
    depthState.set(src.key, st);

    const deep = stat.deepTo ? ` + вглубь стр.${stat.deepFrom}–${stat.deepTo}` : '';
    const note = ended ? ' — пройден до конца, вглубь снова через 3 ч'
      : (resting ? ' (вглубь — позже, отдыхает после полного прохода)' : '');
    log(`  ${src.type}: стр.1–${stat.top}${deep}, карточек ${stat.cards}, в пул +${stat.added}${note}`);

    if (satisfied) {
      const freshCount = (await filterFresh(pool)).length;
      log(`✅ Собрано ${pool.length} вакансий (${freshCount} новых, ${enough} достаточно) — переход к выбору.`);
      markPending();
      return pool;
    }
  }

  if (filterFresh) {
    const fresh = (await filterFresh(pool));
    log(`✅ Полный сбор: ${pool.length} вакансий, ${fresh.length} новых`);
  }

  markPending();
  return pool;
}

/** Адрес обычного поиска: свежие вперёд, поиск по всей вакансии, а не только по названию. */
function searchUrl(query, pageNum = 0) {
  const params = new URLSearchParams({
    text: query,
    items_on_page: String(PAGE_SIZE),
    order_by: 'publication_time',
  });
  if (pageNum > 0) params.set('page', String(pageNum));
  return `https://hh.ru/search/vacancy?${params.toString()}`;
}

/** Обычный поиск hh по строке запроса, свежие сверху. */
async function fetchSearchVacancies(browserCtx, query, { maxPages = 3 } = {}) {
  const seen = new Set();
  const all = [];

  for (let pageNum = 0; pageNum < maxPages; pageNum += 1) {
    const batch = await fetchCardsFromUrl(browserCtx, searchUrl(query, pageNum));
    const fresh = batch.filter((v) => !seen.has(v.vacancyId));
    if (!fresh.length) break;
    for (const v of fresh) {
      seen.add(v.vacancyId);
      all.push(v);
    }
    if (!batch.length) break;
  }

  return all;
}

async function fetchSimilarVacancies(browserCtx, resumeInputUrl, { maxPages = 4 } = {}) {
  const seen = new Set();
  const all = [];

  for (let pageNum = 0; pageNum < maxPages; pageNum += 1) {
    const batch = await fetchVacancyPage(browserCtx, resumeInputUrl, pageNum);
    const fresh = batch.filter((v) => !seen.has(v.vacancyId));
    if (!fresh.length) break;
    for (const v of fresh) {
      seen.add(v.vacancyId);
      all.push(v);
    }
    // Пустая страница = выдача закончилась. На «неполную» больше не смотрим: hh
    // регулярно отдаёт меньше карточек, чем помещается, и обход обрывался зря.
    if (!batch.length) break;
  }

  if (!all.length) {
    console.warn('⚠️ hh/vacancies: карточек не найдено — верстка hh.ru могла измениться либо список пуст.');
  }
  return all;
}

async function fetchVacancyPage(browserCtx, resumeInputUrl, pageNum) {
  const { toSearchUrl } = require('./resumeInput');
  // В настройках может лежать и ссылка на само резюме, и старый адрес «похожих
  // вакансий» — приводим к рабочему виду здесь, а не требуем нужный формат от
  // человека (см. resumeInput.js).
  return fetchCardsFromUrl(browserCtx, toSearchUrl(resumeInputUrl, { page: pageNum, itemsOnPage: PAGE_SIZE }));
}

/**
 * Карточки вакансий с любой страницы выдачи hh.
 *
 * Разбор идёт ОТ ССЫЛКИ на вакансию, а не от контейнера карточки: hh переставляет
 * обёртки и классы (magritte) чуть ли не каждый релиз, а ссылка с id в адресе есть
 * всегда. Отсюда же две поломки, из-за которых выдача месяцами приходила пустой и
 * автопилот сообщал «новых вакансий нет» при полутора тысячах открытых вакансий:
 *
 *  1. Ссылки на выдаче раньше были `/search/vacancy/123`, теперь `https://hh.ru/vacancy/123`.
 *     Регулярка ждала старый вид и отбраковывала КАЖДУЮ карточку в null.
 *  2. Внутри $$eval вызывался extractWithFallback из dom.js. Код $$eval выполняется
 *     в браузере, где модулей Node нет вовсе (да и сигнатура там совсем другая —
 *     async-хелпер над Playwright page). Сработало бы сразу после починки п.1.
 *
 * Поэтому здесь ничего не замыкается на внешние функции: весь разбор инлайн.
 */
async function fetchCardsFromUrl(browserCtx, url) {
  const { browser, page } = await browserCtx.getPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Выдача приходит уже в HTML, но на медленном ответе карточки появляются чуть
    // позже — короткое ожидание дешевле, чем пустой круг и пауза на десять минут.
    await page.locator(LINK_SELECTOR).first()
      .waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});

    const cards = await page.evaluate((linkSel) => {
      const out = [];
      const seen = new Set();
      for (const link of document.querySelectorAll(linkSel)) {
        const href = link.getAttribute('href') || '';
        // И новый вид (`/vacancy/123`), и старый (`/search/vacancy/123`) — на случай,
        // если hh где-то ещё отдаёт прежний формат.
        const match = href.match(/\/(?:search\/)?vacancy\/(\d+)/);
        if (!match) continue;
        const vacancyId = match[1];
        if (seen.has(vacancyId)) continue;
        seen.add(vacancyId);

        // Контейнер карточки ищем подъёмом от ссылки до первого предка, где есть
        // работодатель. Не находим — работаем без компании, карточку не теряем.
        let root = link;
        for (let i = 0; i < 8 && root.parentElement; i += 1) {
          if (root.querySelector('[data-qa*="employer"]')) break;
          root = root.parentElement;
        }
        const pick = (sel) => {
          const el = root.querySelector(sel);
          const text = el && el.textContent ? el.textContent.trim() : '';
          return text || null;
        };

        out.push({
          vacancyId,
          title: (link.textContent || '').trim() || 'untitled',
          company: pick('[data-qa="vacancy-serp__vacancy-employer"]')
            || pick('[data-qa*="employer-text"]')
            || pick('[data-qa*="employer"]')
            || 'unknown',
          // Зарплату на выдаче hh показывает далеко не всегда — недостающую всё равно
          // добираем со страницы вакансии, поэтому null здесь не потеря.
          salaryRaw: pick('[data-qa*="compensation"]') || pick('[data-qa*="salary"]'),
          url: href.startsWith('http') ? href : `https://hh.ru${href}`,
        });
      }
      return out;
    }, LINK_SELECTOR);

    if (!cards.length) {
      // Молчаливый ноль — худший исход: именно так баг и прожил столько времени.
      // Пусть страница сама скажет, что с ней не так.
      const diag = await page.evaluate(() => ({
        title: document.title || '',
        url: location.href,
        body: (document.body?.innerText || '').slice(0, 400),
      })).catch(() => null);
      if (diag) {
        const reason = /не робот|captcha|подтвердите/i.test(diag.body) ? 'капча hh.ru'
          : /войти|вход|авториз/i.test(diag.title) ? 'страница входа'
          : /ничего не найдено|не найдено ни одной/i.test(diag.body) ? 'выдача пуста (0 результатов)'
          : 'вёрстка не распознана';
        cards.diagnostic = `${reason} — "${diag.title.slice(0, 60)}"`;
      }
    }
    return cards;
  } finally {
    // Закрываем и вкладку, и CDP-соединение: getPage() на каждый вызов открывает
    // новое, и без закрытия они копятся за круг — так и «копилось что-то за час».
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * Описание вакансии, признак «уже откликнулись» и зарплата с её страницы.
 *
 * Функция потерялась при правке пагинации (коммит f2ba32a) — файл переписывался
 * кусками, и её просто не стало, хотя applyJob.js и index.js продолжали её
 * импортировать. Отсюда «8 вакансий подряд не удалось обработать
 * (fetchVacancyDescription is not a function)»: пул собирался, а на разборе
 * каждой вакансии круг падал.
 */
async function fetchVacancyDescription(browserCtx, vacancyUrl) {
  const { browser, page } = await browserCtx.getPage();
  try {
    await page.goto(vacancyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (!(await browserCtx.isLoggedIn(page))) {
      throw new Error('LOGGED_OUT');
    }

    const description = await extractWithFallback(
      page,
      ['[data-qa="vacancy-description"]'],
      { label: `описание вакансии ${vacancyUrl}` },
    );

    const alreadyApplied = await page.locator('[data-qa="vacancy-response-link-top"][disabled], :text("Отклик отправлен")').count() > 0;

    // Зарплата со страницы вакансии — второй, надёжный источник для карточек, где
    // её не было в выдаче: тут выделенный элемент, а не свободный текст описания.
    const salaryRaw = await page
      .locator('[data-qa="vacancy-salary"], [data-qa*="vacancy-salary-compensation"]')
      .first()
      .textContent({ timeout: 1500 })
      .then((t) => (t || '').trim())
      .catch(() => '');

    return { description, alreadyApplied, salaryRaw };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = {
  fetchVacancyPool,
  fetchSearchVacancies,
  fetchSimilarVacancies,
  fetchCardsFromUrl,
  fetchVacancyDescription,
};
