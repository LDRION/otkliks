/**
 * hhSession.js — работа с сессией hh.ru со стороны лаунчера.
 *
 * Почему это отдельный модуль, а не пара строк в index.js: здесь лежит развязка
 * неприятного узла. Автоматизация и разовый вход делят ОДИН профиль Edge и один
 * CDP-порт, а launchBrowser в automation-core устроен так:
 *
 *     if (isPortOpen(cdpPort) && isBrowserRunning(cdpPort)) return true;
 *
 * То есть если браузер уже поднят — к нему просто подключаются, какие бы флаги ни
 * просили. После разового входа видимое окно Edge остаётся жить, и весь автопилот
 * начинает работать В НЁМ: вкладки открываются и закрываются прямо на экране,
 * страница за страницей. Со стороны это выглядит как бесконечная перезагрузка
 * hh.ru — собственно, на это и жаловались.
 *
 * Отсюда два правила, которые этот модуль соблюдает:
 *   1. Проверка сессии не создаёт вкладок, если есть уже открытая на hh.ru, и
 *      никогда не перезагружает чужую — человек может в этот момент вводить пароль.
 *   2. Как только вход подтверждён, видимое окно закрывается. Профиль с куками
 *      остаётся на диске, и следующий запуск автопилота поднимает СВОЙ Edge уже
 *      с --headless=new, как и задумано: «дальше работает в фоне».
 */
const CDP_TIMEOUT_MS = 4000;

function endpointFor(cdpPort) {
  return `http://127.0.0.1:${cdpPort}`;
}

async function isBrowserUp(cdpPort) {
  try {
    const res = await fetch(`${endpointFor(cdpPort)}/json/version`, {
      signal: AbortSignal.timeout(CDP_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function isHhPage(page) {
  try {
    return /(^|\.)hh\.ru$/i.test(new URL(page.url()).hostname);
  } catch {
    return false; // about:blank и прочее без хоста
  }
}

/**
 * Проверяет, жива ли сессия hh.ru.
 * @returns {Promise<{ loggedIn: boolean, visible: boolean, error?: string }>}
 *   visible — браузер был уже запущен до проверки (значит, скорее всего, видимый).
 */
async function checkSession({ cdpPort, browserCtx, chromium }) {
  const wasUp = await isBrowserUp(cdpPort);

  let browser = null;
  let tempPage = null;
  try {
    if (!wasUp) {
      // Своего браузера нет — поднимаем фоновый (headless), проверяем и гасим.
      await browserCtx.launchBrowser({ visible: false });
    }
    browser = await chromium.connectOverCDP(endpointFor(cdpPort));
    const ctx = browser.contexts()[0];
    if (!ctx) return { loggedIn: false, visible: wasUp };

    // Сначала ищем уже открытую вкладку hh.ru и проверяем ЕЁ, ничего не трогая.
    let page = ctx.pages().find(isHhPage);
    if (!page) {
      tempPage = await ctx.newPage();
      await tempPage.goto(browserCtx.HH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      page = tempPage;
    }

    return { loggedIn: await browserCtx.isLoggedIn(page), visible: wasUp };
  } catch (e) {
    return { loggedIn: false, visible: wasUp, error: e.message };
  } finally {
    await tempPage?.close().catch(() => {});
    // close() у CDP-подключения только отключается, браузер не гасит — проверено.
    await browser?.close().catch(() => {});
    // Браузер подняли мы сами ради проверки — за собой убираем, чтобы после захода
    // на вкладку «Настройки» на машине не оставался лишний процесс Edge.
    if (!wasUp) await closeBrowser({ cdpPort, chromium }).catch(() => {});
  }
}

/**
 * Действительно гасит браузер на нашем порту и ждёт, пока порт освободится.
 *
 * Способ выбран не наугад, обе альтернативы проверены опытом:
 *   • browser.close() у Playwright на CDP-подключении только отсоединяется — Edge
 *     остаётся жить, порт занят;
 *   • закрытие всех вкладок тоже не гарантирует выход: браузер, поднятый с
 *     --no-startup-window (а именно так стартует фоновый), спокойно живёт без окон.
 * Работает CDP-команда Browser.close — она и используется.
 *
 * Ожидание порта здесь обязательно: launchBrowser в automation-core первым делом
 * смотрит, занят ли порт, и если да — молча возвращается, ничего не открыв. Без
 * ожидания кнопка «Войти в hh.ru» не показывала окно вообще.
 */
async function closeBrowser({ cdpPort, chromium, waitMs = 12000 }) {
  if (!(await isBrowserUp(cdpPort))) return true;

  let browser = null;
  try {
    browser = await chromium.connectOverCDP(endpointFor(cdpPort));
    const session = await browser.newBrowserCDPSession();
    await session.send('Browser.close').catch(() => {});
  } catch {
    /* не подключились — возможно, браузер уже умирает; проверим порт ниже */
  } finally {
    await browser?.close().catch(() => {});
  }

  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if (!(await isBrowserUp(cdpPort))) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false; // порт так и не освободился — вызывающий код должен это учесть
}

module.exports = { checkSession, closeBrowser, isBrowserUp };
