/**
 * browser.js — залогиненный hh.ru через реальный Edge (Playwright CDP), портировано из
 * личного hhorosho (src/services/hh/browser.js). Отличие от однопользовательской версии:
 * это ФАБРИКА, не singleton-модуль с портом/профилем из process.env — cdpPort/profileDir
 * приходят параметром, чтобы cloud-worker мог поднимать изолированный браузер на каждого
 * арендатора, а local-agent — на единственного локального пользователя, одним и тем же кодом.
 */

const { exec } = require('child_process');
const fs = require('fs');
const net = require('net');
const { chromium } = require('playwright');

const IS_WINDOWS = process.platform === 'win32';
const HH_URL = 'https://hh.ru/';

async function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { socket.destroy(); } catch { /* ignore */ } resolve(v); } };
    const socket = net.createConnection({ port, host }, () => finish(true));
    socket.on('error', () => finish(false));
    // РАНЬШЕ: setTimeout стоял, но обработчика 'timeout' не было — и на «залипшем»
    // порту (Edge открыл порт, но не отвечает; фаервол дропает пакеты) сокет не
    // коннектился и не падал, а Promise не резолвился НИКОГДА. Отсюда бесконечные
    // зависания круга: автопилот замирал на час и «иногда не оживал». Теперь таймаут
    // сам закрывает сокет и возвращает false.
    socket.setTimeout(2000);
    socket.on('timeout', () => finish(false));
  });
}

async function isBrowserRunning(port) {
  try {
    // fetch без таймаута — вторая дыра: если Edge принял соединение, но CDP-эндпоинт
    // завис (частое состояние после сна/обновления Edge), запрос висел вечно и морозил
    // весь автопилот. AbortSignal.timeout гарантирует ответ максимум за 3 секунды.
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch { return false; }
}

/**
 * Создаёт контекст браузера для одного арендатора/профиля.
 * @param {{ cdpPort: number, profileDir: string, headless?: boolean }} config
 */
function createBrowserContext({ cdpPort, profileDir, headless = true }) {
  if (!cdpPort || !profileDir) {
    throw new Error('createBrowserContext: обязательны cdpPort и profileDir');
  }
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

  // Мьютекс запуска. Планировщик крутит ДВА параллельных цикла (отклики и чаты) и оба
  // зовут getPage. Из холодного старта они одновременно видели «порта нет» и запускали
  // ПО Edge КАЖДЫЙ на один и тот же профиль. Второй экземпляр упирался в блокировку
  // профиля, висел/плодил зомби-процессы — вот оно, «что-то копится за час». Теперь
  // запуск один на всех: пока один идёт, остальные ждут его же промис.
  let launching = null;

  // visible=true → видимое окно (для разового логина). false → фоновый режим (джобы).
  function launchBrowser(opts = {}) {
    if (launching) return launching;
    launching = doLaunch(opts).finally(() => { launching = null; });
    return launching;
  }

  async function doLaunch({ visible = false } = {}) {
    if ((await isPortOpen(cdpPort)) && (await isBrowserRunning(cdpPort))) return true;

    const flags = [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      // Без --headless фоновые прогоны реально всплывают окном на экране (см. историю
      // личного hhorosho) — "работает в фоне" значит буквально без видимого окна.
      ...(visible ? [HH_URL] : (headless ? ['--headless=new', '--no-startup-window'] : ['--no-startup-window'])),
      ...(IS_WINDOWS ? [] : ['--no-sandbox', '--disable-dev-shm-usage']),
    ].join(' ');

    const edgePaths = IS_WINDOWS
      ? ['"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"', '"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"', 'msedge']
      : ['/usr/bin/microsoft-edge-stable', '/usr/bin/microsoft-edge', '/opt/microsoft/msedge/msedge', 'microsoft-edge-stable', 'microsoft-edge'];

    let launched = false;
    for (const edgePath of edgePaths) {
      try {
        const cmd = IS_WINDOWS ? `start "" ${edgePath} ${flags}` : `${edgePath} ${flags} > /dev/null 2>&1 &`;
        exec(cmd, { detached: true }, () => {});
        launched = true;
        break;
      } catch { /* пробуем следующий путь */ }
    }
    if (!launched) throw new Error('Не удалось найти Edge для hh.ru-автоматизации.');

    for (let i = 0; i < 60; i++) {
      if ((await isPortOpen(cdpPort)) && (await isBrowserRunning(cdpPort))) {
        await new Promise((r) => setTimeout(r, 1500));
        return true;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Таймаут запуска Edge на порту ${cdpPort}.`);
  }

  async function getPage() {
    await launchBrowser({ visible: false });
    // connectOverCDP по умолчанию ждёт 30 c — ставим явно, чтобы «полудохлый» Edge
    // (порт открыт, CDP не отвечает) не держал круг дольше нужного: пусть падает и
    // круг рециклит браузер через watchdog планировщика.
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: 30000 });
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();

    // Сайты работодателей и hh иногда открывают popup/новую вкладку (window.open,
    // target=_blank). Мы такие не ведём и не закрываем — за час они копились
    // «осиротевшими» вкладками и топили браузер. Закрываем их сразу, как появятся:
    // автопилот всё равно ходит только через page.goto, popup ему не нужен.
    page.on('popup', (p) => p.close().catch(() => {}));

    return { browser, page };
  }

  /**
   * Принудительно гасит ТОЛЬКО наш фоновый Edge (по нашему порту отладки в командной
   * строке процесса) — видимый браузер пользователя не трогаем. Нужен планировщику,
   * когда круг завис: убиваем залипший процесс, следующий круг поднимет свежий.
   * Best-effort: любые ошибки проглатываем, это аварийная уборка.
   */
  async function killBrowser() {
    return new Promise((resolve) => {
      const marker = `remote-debugging-port=${cdpPort}`;
      let cmd;
      if (IS_WINDOWS) {
        // PowerShell: гасим msedge, в чьей командной строке есть наш порт отладки.
        const ps = `Get-CimInstance Win32_Process -Filter \\"name='msedge.exe'\\" | `
          + `Where-Object { $_.CommandLine -like '*${marker}*' } | `
          + `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
        cmd = `powershell -NoProfile -Command "${ps}"`;
      } else {
        cmd = `pkill -f "${marker}"`;
      }
      try {
        exec(cmd, { windowsHide: true, timeout: 10000 }, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  /**
   * МЯГКОЕ закрытие фонового Edge через CDP Browser.close: Chromium завершается ЧИСТО и
   * успевает сбросить куки/сессии на диск. В отличие от killBrowser (жёсткий pkill/Force),
   * НЕ теряет свежие авторизации (hh.ru, Google, Яндекс) — их персистентные куки Chromium
   * пишет на диск не мгновенно, и жёсткое убийство сразу после логина/по таймеру их
   * теряло (пользователь оказывался разлогинен везде). Используем на ЗДОРОВОМ браузере
   * (старт, уход в фон). Возвращает true, если процесс реально завершился и порт свободен;
   * false — если CDP не отозвался (браузер завис): тогда вызывающий добьёт killBrowser'ом.
   */
  async function closeBrowser(waitMs = 12000) {
    try {
      if (!(await isPortOpen(cdpPort))) return true; // уже закрыт
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: 5000 });
      const session = await browser.newBrowserCDPSession();
      await session.send('Browser.close').catch(() => {});
      await browser.close().catch(() => {});
    } catch {
      return false; // CDP недоступен — не смогли закрыть мягко
    }
    for (let i = 0; i < Math.ceil(waitMs / 500); i += 1) {
      if (!(await isPortOpen(cdpPort))) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return !(await isPortOpen(cdpPort));
  }

  // Наличие блока личного кабинета в шапке — признак того, что сессия жива и hh.ru не
  // подсунул капчу/страницу логина. false → вызывающий код останавливается и не пытается
  // продавливать automation через капчу (см. applyJob.js/negotiationsWatcher.js).
  /**
   * Состояние сессии: 'ok' | 'captcha' | 'logged_out'.
   *
   * Раньше оба плохих случая сводились к одному false, и человек получал «сессия
   * слетела, войдите заново» даже когда hh просто показывал проверку «я не робот» —
   * а это совсем другое действие.
   */
  const ACCOUNT_MENU = [
    '[data-qa="mainmenu_myResumes"]',
    '[data-qa="mainmenu_applicantProfile"]',
    '[data-qa="mainmenu_applicantNegotiations"]',
    '[data-qa="mainmenu-user-profile"]',
    'a[href*="/applicant/resumes"]',
    'a[href*="/applicant/negotiations"]',
    '[data-qa="mainmenu_logoff"]',
  ].join(', ');

  const LOGIN_MARKERS = [
    '[data-qa="login"]',
    'a[href*="/account/login"]',
    'button[data-qa="expand-login-by-password"]',
  ].join(', ');

  /**
   * Состояние сессии: 'ok' | 'captcha' | 'logged_out' | 'unknown'.
   *
   * Здесь было две ошибки, из-за которых автопилот объявлял «сессия закончилась»,
   * хотя человек был залогинен.
   *
   * Первая: меню аккаунта искалось сразу после domcontentloaded — hh дорисовывает
   * шапку скриптом, и на медленной загрузке её просто ещё не было. Теперь ждём
   * появления до восьми секунд.
   *
   * Вторая, важнее: проверка вызывалась на ЛЮБОЙ открытой странице. После перехода
   * на сайт работодателя или на анкету hh-меню там нет по определению — и мы считали
   * это разлогином. Теперь чужие домены отвечают 'unknown': по ним о сессии hh судить
   * нельзя. И отдельно: если на странице есть кнопка входа — это точно разлогин, а не
   * догадка по отсутствию меню.
   */
  async function sessionState(page) {
    try {
      const url = page.url() || '';
      if (!/^https?:\/\/([a-z0-9-]+\.)?hh\.(ru|kz|by|uz)\b/i.test(url)
        && !/chatik\.hh\.ru/i.test(url)) {
        return 'unknown';
      }

      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

      // Ждём шапку: она появляется скриптом уже после загрузки документа.
      const menu = await page.locator(ACCOUNT_MENU).first()
        .waitFor({ state: 'attached', timeout: 8000 })
        .then(() => true, () => false);
      if (menu) return 'ok';

      const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (/подтвердите,?\s*что вы не робот|captcha|не робот/i.test(bodyText)) return 'captcha';

      const loginVisible = await page.locator(LOGIN_MARKERS).first().count().catch(() => 0);
      if (loginVisible > 0) return 'logged_out';

      // Ни меню, ни формы входа: страница могла не догрузиться или отдать ошибку.
      // Объявлять разлогин по такому признаку нельзя — именно так и появлялись
      // ложные «сессия hh.ru закончилась».
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async function isLoggedIn(page) {
    // 'unknown' — это «не смогли определить», а не «вышел». Считать его разлогином
    // означало бы ронять весь круг из-за одной недогруженной страницы.
    return (await sessionState(page)) !== 'logged_out';
  }

  return { launchBrowser, getPage, killBrowser, closeBrowser, isLoggedIn, sessionState, cdpPort, profileDir, HH_URL };
}

// isPortOpen/isBrowserRunning экспортируем и для тестов: именно их зависание морозило
// автопилот, поэтому важно проверять, что они всегда возвращаются в срок.
module.exports = { createBrowserContext, HH_URL, isPortOpen, isBrowserRunning };
