const { app, BrowserWindow, Menu, ipcMain, shell, Notification } = require('electron');
const path = require('node:path');

const { createSettings } = require('./settings');
const { createCoreApiClient } = require('./coreApiClient');
const { createScheduler } = require('./scheduler');
const { createTray, isQuitting, setQuitting, destroyTray } = require('./tray');

// Собранный лаунчер уезжает на чужой компьютер, где никакого localhost нет — там
// адреса по умолчанию обязаны быть боевыми. В dev (запуск через `electron .`)
// остаются локальные, как и было. Переменные окружения перебивают и то, и другое.
const PROD_SITE_URL = 'https://otkliks.ru';
const packaged = app.isPackaged;
const CORE_API_URL = process.env.CORE_API_URL || (packaged ? PROD_SITE_URL : 'http://localhost:4000');
const SITE_URL = process.env.SITE_URL || (packaged ? PROD_SITE_URL : 'http://localhost:3000');
const CDP_PORT = 9333;

// --- Автозапуск вместе с Windows ---
// Включённый переключатель «Автозапуск» прописывает лаунчер в автозагрузку с флагом
// --autostart. Такой запуск идёт без окна (только значок у часов) и сам включает
// автопилот — как если бы человек открыл лаунчер и нажал «Запустить».
const AUTOSTART_ARG = '--autostart';
const launchedAtLogin = process.argv.includes(AUTOSTART_ARG);
// Сеть и антивирус в первые секунды после входа в Windows ещё просыпаются — даём
// им время, чтобы первый круг не упал на пустом месте.
const AUTOSTART_DELAY_MS = 20000;

// Вторая копия лаунчера — это второй автопилот в том же профиле браузера: они
// дрались бы за одну сессию hh.ru. С автозапуском это стало реальным сценарием
// (лаунчер уже работает в трее, человек открывает его ярлыком ещё раз), поэтому
// вторая копия просто показывает окно первой и выходит.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

let mainWindow = null;
let settings = null;
let coreApi = null;
let scheduler = null;
let cachedTenant = null;

function log(line) {
  console.log(line);
  mainWindow?.webContents.send('agent:log', { line, at: Date.now() });
}

function onSchedulerEvent(event) {
  mainWindow?.webContents.send('agent:event', event);
}

// Страховка: непойманная ошибка в фоне (обновление, сеть, диск) уходит в технический
// журнал, а не модальным окном Electron «A JavaScript error occurred» поверх экрана.
// Живой случай 29.09.2026 — EBUSY при скачивании обновления у первого пользователя:
// ошибка некритичная, а выглядела как поломка всей программы.
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
  try { log(`⚠️ Внутренняя ошибка, работа продолжается: ${err?.message || err}`); } catch { /* окна ещё нет */ }
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
  try { log(`⚠️ Внутренняя ошибка, работа продолжается: ${reason?.message || reason}`); } catch { /* окна ещё нет */ }
});

function createWindow({ show = true } = {}) {
  mainWindow = new BrowserWindow({
    show,
    width: 1040,
    height: 720,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: '#f6f7fb',
    // Без системной рамки: белая полоса заголовка Windows выбивалась из светлого
    // минималистичного интерфейса и делала окно «бетой». Свою мы рисуем прямо в
    // шапке (кнопки свернуть/закрыть + перетаскивание за неё). На Win11 у окна без
    // рамки остаются скруглённые углы и рабочие границы для ресайза.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Крестик прячет окно в трей, а не закрывает программу: автопилот должен
  // продолжать работать. Настоящий выход — только через меню значка (там
  // выставляется quitting) или при установке обновления.
  mainWindow.on('close', (e) => {
    if (isQuitting()) return;
    e.preventDefault();
    mainWindow.hide();
  });
}

// Показать окно из трея: создать заново, если его уже нет, поднять из свёрнутого
// состояния и вынести поверх остальных окон.
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function registerIpc() {
  ipcMain.handle('auth:login', async (_e, { email, password }) => {
    const res = await coreApi.login(email, password);
    settings.set('token', res.token);
    settings.set('tenant', res.tenant);
    cachedTenant = res.tenant;
    return res.tenant;
  });

  ipcMain.handle('app:version', () => app.getVersion());

  // Согласие на автопрохождение внешних анкет. null = ещё не спрашивали: renderer
  // покажет окно с объяснением при первом запуске.
  ipcMain.handle('consent:get', () => ({
    decided: typeof settings.get('externalStageConsent') === 'boolean',
    enabled: settings.get('externalStageConsent') === true,
  }));

  ipcMain.handle('consent:set', (_e, enabled) => {
    settings.set('externalStageConsent', !!enabled);
    log(enabled
      ? '✅ Автозаполнение внешних анкет включено.'
      : '⏹ Автозаполнение внешних анкет выключено — ссылки буду просто показывать.');
    return { decided: true, enabled: !!enabled };
  });

  ipcMain.handle('auth:changePassword', async (_e, { currentPassword, newPassword }) => {
    if (!settings.get('token')) return { ok: false, error: 'Сессия истекла, войдите заново' };
    try {
      await withSession((t) => coreApi.changePassword(t, currentPassword, newPassword));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Что дополнительно показывать в «Что происходит» — победы (созвон/уточнения) видны
  // всегда, это управляет только предупреждениями и заполненными анкетами.
  ipcMain.handle('notifications:get', () => ({
    alerts: settings.get('notifyAlerts') !== false,
    forms: settings.get('notifyForms') !== false,
  }));
  ipcMain.handle('notifications:set', (_e, { alerts, forms }) => {
    if (typeof alerts === 'boolean') settings.set('notifyAlerts', alerts);
    if (typeof forms === 'boolean') settings.set('notifyForms', forms);
    return { alerts: settings.get('notifyAlerts') !== false, forms: settings.get('notifyForms') !== false };
  });

  ipcMain.handle('auth:register', async (_e, { email, password, fullName, consent }) => {
    const res = await coreApi.register(email, password, fullName, consent === true);
    settings.set('token', res.token);
    settings.set('tenant', res.tenant);
    cachedTenant = res.tenant;
    return res.tenant;
  });

  ipcMain.handle('auth:session', async () => {
    if (!settings.get('token')) return null;
    try {
      const res = await withSession((t) => coreApi.me(t));
      settings.set('tenant', res.tenant);
      cachedTenant = res.tenant;
      return res.tenant;
    } catch (e) {
      // Сессию не вернуть (устройство отвязали) — withSession уже разлогинил, показываем вход.
      if (isSessionError(e)) return null;
      return settings.get('tenant') || null; // офлайн — работаем с последним известным состоянием
    }
  });

  ipcMain.handle('auth:logout', async () => {
    scheduler?.stop();
    settings.clear();
    cachedTenant = null;
    return true;
  });

  ipcMain.handle('profile:update', async (_e, fields) => {
    const res = await withSession((t) => coreApi.updateProfile(t, fields));
    settings.set('tenant', res.tenant);
    cachedTenant = res.tenant;
    return res.tenant;
  });

  ipcMain.handle('device:pair', async () => {
    const token = settings.get('token');
    const res = await coreApi.registerDevice(token, `${require('node:os').hostname()}`);
    settings.set('deviceToken', res.token);
    return { deviceId: res.deviceId, label: res.label };
  });

  ipcMain.handle('hh:login', async () => {
    // Разовый видимый вход в hh.ru — тот же приём, что hhorosho/scripts/hh-login.js.
    const browserDir = path.join(app.getPath('userData'), 'hh-profile');
    const { createBrowserContext } = require('@hhpilot/automation-core');
    const { closeBrowser } = require('./hhSession');
    const { chromium } = require('playwright');

    // Сначала гасим любой уже запущенный Edge на нашем порту и ДОЖИДАЕМСЯ, пока порт
    // освободится. Без этого видимое окно не откроется вообще: launchBrowser первым
    // делом смотрит на порт и, если тот занят (фоновым браузером автопилота или
    // проверки сессии), молча возвращается — человек жмёт «Войти» и не видит ничего.
    if (!(await closeBrowser({ cdpPort: CDP_PORT, chromium }))) {
      log('Не удалось освободить порт браузера — закройте окна Edge вручную и попробуйте снова.');
      return false;
    }

    const ctx = createBrowserContext({ cdpPort: CDP_PORT, profileDir: browserDir, headless: false });
    await ctx.launchBrowser({ visible: true });
    return true;
  });

  /**
   * Разовый вход в сторонний сервис (Google, Яндекс) — тем же профилем браузера, в
   * котором работает автопилот.
   *
   * Зачем: работодатели присылают анкеты, которые требуют входа в аккаунт («форма
   * доступна только авторизованным в Google»). Автопилот ходит своим профилем Edge,
   * где этих сессий нет, и такие анкеты уходили человеку. Логика ровно та же, что с
   * hh.ru: человек один раз входит сам, куки остаются в профиле, дальше формы
   * открываются уже авторизованными.
   *
   * Чужие пароли мы не трогаем и никуда не передаём — вход происходит в обычном окне
   * браузера руками владельца.
   */
  ipcMain.handle('account:login', async (_e, service) => {
    const urls = {
      google: 'https://accounts.google.com/',
      yandex: 'https://passport.yandex.ru/auth',
      telegram: 'https://web.telegram.org/',
    };
    const url = urls[service];
    if (!url) return false;

    const browserDir = path.join(app.getPath('userData'), 'hh-profile');
    const { createBrowserContext } = require('@hhpilot/automation-core');
    const { closeBrowser } = require('./hhSession');
    const { chromium } = require('playwright');

    if (!(await closeBrowser({ cdpPort: CDP_PORT, chromium }))) {
      log('Не удалось освободить порт браузера — закройте окна Edge вручную и попробуйте снова.');
      return false;
    }

    const ctx = createBrowserContext({ cdpPort: CDP_PORT, profileDir: browserDir, headless: false });
    await ctx.launchBrowser({ visible: true });
    const { browser, page } = await ctx.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await browser.close?.().catch(() => {});
    log(`Откроется окно браузера — войдите в ${service === 'google' ? 'Google' : service === 'yandex' ? 'Яндекс' : 'Telegram'}, затем нажмите «Готово».`);
    return true;
  });

  /** Проверка: есть ли сохранённая сессия сервиса в профиле автопилота. */
  ipcMain.handle('account:status', async (_e, service) => {
    // Определяем вход по РЕДИРЕКТУ, а не по тексту страницы. Раньше искали слова
    // «выйти/профиль» в body — но паспорт Яндекса и Google рисуются скриптами, и за
    // секунду этих слов в тексте нет, отсюда ложное «вход не выполнен» при живой
    // сессии. Надёжный признак: если НЕ вошёл, сервис перекидывает на свою страницу
    // входа. Остались на странице профиля — значит вошли.
    const probes = {
      google: {
        url: 'https://myaccount.google.com/',
        loginUrl: /accounts\.google\.[a-z.]+\/[^?#]*(signin|servicelogin|accountchooser)/i,
      },
      yandex: {
        url: 'https://passport.yandex.ru/profile',
        loginUrl: /passport\.yandex\.[a-z.]+\/[^?#]*(auth|registration)/i,
      },
      telegram: {
        url: 'https://web.telegram.org/a/',
        loginUrl: /web\.telegram\.org\/(a\/)?#?\/?login/i,
      },
    };
    const probe = probes[service];
    if (!probe) return { loggedIn: false };

    const { createBrowserContext } = require('@hhpilot/automation-core');
    const ctx = createBrowserContext({
      cdpPort: CDP_PORT,
      profileDir: path.join(app.getPath('userData'), 'hh-profile'),
      headless: true,
    });

    try {
      const { browser, page } = await ctx.getPage();
      try {
        await page.goto(probe.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        // Редирект на страницу входа может случиться уже ПОСЛЕ загрузки документа —
        // ждём, пока сеть успокоится, и только потом смотрим итоговый адрес.
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(800);

        const finalUrl = page.url();
        const atLogin = probe.loginUrl.test(finalUrl);
        return { loggedIn: !atLogin, url: finalUrl };
      } finally {
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
      }
    } catch {
      return { loggedIn: false };
    }
  });

  ipcMain.handle('hh:status', async () => {
    const { checkSession } = require('./hhSession');
    const { chromium } = require('playwright');
    const { createBrowserContext } = require('@hhpilot/automation-core');
    const browserCtx = createBrowserContext({
      cdpPort: CDP_PORT,
      profileDir: path.join(app.getPath('userData'), 'hh-profile'),
      headless: true,
    });
    return checkSession({ cdpPort: CDP_PORT, browserCtx, chromium });
  });

  // Вход подтверждён — закрываем видимое окно, чтобы автопилот продолжил в фоне.
  // Без этого он подключается к оставшемуся видимому Edge и гоняет вкладки прямо
  // на экране (см. комментарий в hhSession.js).
  ipcMain.handle('hh:finishLogin', async () => {
    const { closeBrowser } = require('./hhSession');
    const { chromium } = require('playwright');
    const closed = await closeBrowser({ cdpPort: CDP_PORT, chromium });
    if (closed) log('Вход в hh.ru сохранён — окно браузера закрыто, дальше автопилот работает в фоне.');
    return closed;
  });

  ipcMain.handle('automation:start', async () => {
    startAutomation();
    return true;
  });

  // Задание бесплатного тарифа: «Открыть» — ссылка в браузере + отметка о переходе,
  // «Готово» — засчитать и сразу перечитать аккаунт, чтобы пауза снялась.
  ipcMain.handle('tasks:open', async (_e, { id, url }) => {
    if (/^https:\/\//.test(String(url || ''))) shell.openExternal(url);
    await withSession((t) => coreApi.taskOpen(t, id));
    return true;
  });
  ipcMain.handle('tasks:done', async (_e, id) => {
    await withSession((t) => coreApi.taskDone(t, id));
    const res = await withSession((t) => coreApi.me(t));
    settings.set('tenant', res.tenant);
    cachedTenant = res.tenant;
    log('✅ Задание дня выполнено — бесплатный автопилот продолжит работу в течение минуты.');
    return res.tenant;
  });

  ipcMain.handle('autolaunch:get', async () => ({ enabled: isAutoLaunchEnabled(), supported: autoLaunchSupported() }));
  ipcMain.handle('autolaunch:set', async (_e, enabled) => {
    settings.set('autoLaunch', enabled === true);
    applyAutoLaunch(enabled === true);
    log(enabled === true
      ? 'Автозапуск включён: при включении компьютера Откликс запустится сам и начнёт работу.'
      : 'Автозапуск выключен.');
    return { enabled: isAutoLaunchEnabled(), supported: autoLaunchSupported() };
  });

  ipcMain.handle('automation:stop', async () => {
    scheduler?.stop();
    return true;
  });

  ipcMain.handle('automation:status', async () => ({ running: scheduler?.isRunning() || false }));

  // Обновления: обработчики есть всегда (в разработке updater не создаётся — раньше
  // окно получало «No handler registered for 'update:state'»).
  ipcMain.handle('update:check', () => { updater?.check({ auto: false }); return updater?.getState() || { phase: 'idle' }; });
  ipcMain.handle('update:state', () => updater?.getState() || { phase: 'idle' });
  ipcMain.handle('update:apply', () => updater?.apply() || false);

  ipcMain.handle('stats:daily', async (_e, days) => {
    if (!cachedTenant) return [];
    const { createStore } = require('./store');
    const store = createStore(app.getPath('userData'));
    return store.getDailyApplied(cachedTenant.id, Math.min(60, Math.max(7, Number(days) || 14)));
  });

  ipcMain.handle('stats:local', async () => {
    if (!cachedTenant) return null;
    const { createStore } = require('./store');
    const store = createStore(app.getPath('userData'));
    return store.getLocalStats(cachedTenant.id);
  });

  // 🎉 Приглашения на созвон/собеседование — из локальной БД (переживают перезапуск).
  ipcMain.handle('interviews:list', async () => {
    if (!cachedTenant) return [];
    const { createStore } = require('./store');
    const store = createStore(app.getPath('userData'));
    return store.getInterviewInvites(cachedTenant.id);
  });

  // 🙋 Вопросы, на которые ИИ честно не может ответить сам — ждут ответа человека.
  ipcMain.handle('clarifications:list', async () => {
    if (!cachedTenant) return [];
    const { createStore } = require('./store');
    const store = createStore(app.getPath('userData'));
    const closed = store.closeChatChromeClarifications(cachedTenant.id);
    const token = settings.get('deviceToken');
    if (token) {
      for (const c of closed) coreApi.markClarificationDelivered(token, { ...c, sentText: '' });
    }
    return store.getOpenClarifications(cachedTenant.id);
  });

  // Корзины в «Приглашениях» и «Нужен ваш ответ» (подтверждение — в окне).
  ipcMain.handle('interviews:hide', async (_e, negotiationId) => {
    if (!cachedTenant || !negotiationId) return { ok: false };
    const { createStore } = require('./store');
    createStore(app.getPath('userData')).hideInterviewInvite(cachedTenant.id, String(negotiationId));
    return { ok: true };
  });
  ipcMain.handle('clarifications:dismiss', async (_e, id) => {
    if (!cachedTenant || !id) return { ok: false };
    const { createStore } = require('./store');
    const closed = createStore(app.getPath('userData')).dismissClarification(cachedTenant.id, id);
    // На сайте вопрос тоже должен уйти из «Нужен ваш ответ».
    const token = settings.get('deviceToken');
    if (closed && token) coreApi.markClarificationDelivered(token, { ...closed, sentText: '' });
    return { ok: !!closed };
  });

  // «Исключения»: переписки и вакансии, которые человек ведёт сам (см. exclusions.js).
  ipcMain.handle('exclusions:list', async () => {
    if (!cachedTenant) return [];
    const { createStore } = require('./store');
    return createStore(app.getPath('userData')).getExclusions(cachedTenant.id);
  });
  // Из «Приглашений» / «Нужен ваш ответ» — по треду; во вкладке — ссылкой: на вакансию
  // (hh.ru/vacancy/123, любой региональный домен) или на переписку (chatik.hh.ru/chat/123,
  // …/negotiations/…?topicId=123). Откликались на вакансию или нет — неважно.
  ipcMain.handle('exclusions:add', async (_e, { negotiationId, link } = {}) => {
    if (!cachedTenant) return { ok: false, error: 'Нет входа в аккаунт' };
    let vacancyId = null;
    let nid = negotiationId ? String(negotiationId) : null;
    const url = String(link || '').trim();
    if (!nid) {
      if (!/(^|\.|\/\/)hh\.(ru|kz|uz|by)(\/|$)|chatik\.hh\.ru/i.test(url)) {
        return { ok: false, error: 'Нужна ссылка с hh.ru — на вакансию или на переписку.' };
      }
      vacancyId = (url.match(/\/vacancy\/(\d+)/) || [])[1] || null;
      nid = (url.match(/\/chat\/(\d+)/) || url.match(/[?&](?:topicId|chatId|nid)=(\d+)/) || [])[1] || null;
      if (!vacancyId && !nid) return { ok: false, error: 'Не нашёл в ссылке номер вакансии или переписки.' };
    }
    const { createStore } = require('./store');
    const { exclusion, closed } = createStore(app.getPath('userData'))
      .addExclusion(cachedTenant.id, { negotiationId: nid, vacancyId, url: nid || vacancyId ? '' : url });
    const token = settings.get('deviceToken');
    if (token) for (const c of closed) coreApi.markClarificationDelivered(token, { ...c, sentText: '' });
    return { ok: true, exclusion };
  });
  // «Чёрный список»: с карточки — по треду; во вкладке — названием или ссылкой на
  // работодателя (hh.ru/employer/123) или вакансию (hh.ru/vacancy/123). Название по ссылке
  // берём из своей базы, иначе из открытого API hh (без входа). broad — «и всё связанное
  // по названию»: тогда блокируем по главному слову (brandWord).
  ipcMain.handle('blacklist:list', async () => {
    if (!cachedTenant) return [];
    const { createStore } = require('./store');
    return createStore(app.getPath('userData')).getBlacklist(cachedTenant.id);
  });
  ipcMain.handle('blacklist:add', async (_e, { negotiationId, text, broad } = {}) => {
    if (!cachedTenant) return { ok: false, error: 'Нет входа в аккаунт' };
    const { createStore } = require('./store');
    const store = createStore(app.getPath('userData'));
    const { brandWord } = require('@hhpilot/automation-core/src/exclusions');
    // Название по ссылке: со страницы hh (элемент с названием компании), запасной путь —
    // открытое API (с серверов дата-центров оно отвечает «forbidden», с домашних — обычно да).
    const get = async (u, json) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      try {
        const r = await fetch(u, { signal: ctrl.signal, headers: json
          ? { 'HH-User-Agent': 'Otkliks/1.0 (support@otkliks.ru)', 'User-Agent': 'Otkliks/1.0 (support@otkliks.ru)' }
          : { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'ru' } });
        if (!r.ok) return null;
        return json ? await r.json() : await r.text();
      } catch { return null; } finally { clearTimeout(timer); }
    };
    const decode = (x) => String(x || '').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;|\u00a0/g, ' ').trim();
    const hhName = async (kind, id) => {
      const html = await get(`https://hh.ru/${kind === 'employers' ? 'employer' : 'vacancy'}/${id}`, false);
      const m = html && (kind === 'employers'
        ? html.match(/data-qa="company-header-title-name"[^>]*>([^<]+)</) || html.match(/og:title" content="Работа в компании (.+?) в /)
        : html.match(/data-qa="vacancy-company-name"[^>]*>(?:<[^>]+>)*([^<]+)</) || html.match(/"hiringOrganization":\{[^}]*?"name":"([^"]+)"/));
      if (m && decode(m[1])) return decode(m[1]);
      const d = await get(`https://api.hh.ru/${kind}/${id}`, true);
      return decode(kind === 'employers' ? d?.name : d?.employer?.name);
    };
    let company = '';
    let url = '';
    if (negotiationId) {
      company = store.companyOfNegotiation(cachedTenant.id, negotiationId);
      url = `https://chatik.hh.ru/chat/${negotiationId}`;
      if (!company) return { ok: false, error: 'Не знаю, что это за компания, — добавьте её во вкладке «Чёрный список» названием.' };
    } else {
      const t = String(text || '').trim();
      if (!t) return { ok: false, error: 'Впишите название компании или ссылку.' };
      if (/^https?:\/\/|(^|\.)hh\.(ru|kz|uz|by)\//i.test(t)) {
        const vacancyId = (t.match(/\/vacancy\/(\d+)/) || [])[1];
        const employerId = (t.match(/\/employer\/(\d+)/) || [])[1];
        if (vacancyId) company = store.companyOfVacancy(cachedTenant.id, vacancyId) || await hhName('vacancies', vacancyId);
        else if (employerId) company = await hhName('employers', employerId);
        else return { ok: false, error: 'Нужна ссылка на работодателя или вакансию hh.ru — или просто название.' };
        if (!company) return { ok: false, error: 'Не получилось узнать название по ссылке — впишите название компании.' };
        url = t;
      } else company = t;
    }
    const entry = store.addBlacklist(cachedTenant.id, { company, word: brandWord(company), broad: !!broad, url });
    const closed = negotiationId ? store.releaseThread(cachedTenant.id, negotiationId) : [];
    const token = settings.get('deviceToken');
    if (token) for (const c of closed) coreApi.markClarificationDelivered(token, { ...c, sentText: '' });
    return { ok: true, entry };
  });
  ipcMain.handle('blacklist:remove', async (_e, id) => {
    if (!cachedTenant || !id) return { ok: false };
    const { createStore } = require('./store');
    createStore(app.getPath('userData')).removeBlacklist(cachedTenant.id, String(id));
    return { ok: true };
  });
  // Главное слово для «и всё связанное по названию» — подсказка под полем ввода.
  ipcMain.handle('blacklist:word', async (_e, text) => require('@hhpilot/automation-core/src/exclusions').brandWord(String(text || '')));
  // Что именно заблокирует запись — показать в окне до добавления.
  ipcMain.handle('blacklist:preview', async (_e, { negotiationId } = {}) => {
    if (!cachedTenant || !negotiationId) return null;
    const { createStore } = require('./store');
    const company = createStore(app.getPath('userData')).companyOfNegotiation(cachedTenant.id, negotiationId);
    if (!company) return null;
    return { company, word: require('@hhpilot/automation-core/src/exclusions').brandWord(company) };
  });
  ipcMain.handle('exclusions:remove', async (_e, id) => {
    if (!cachedTenant || !id) return { ok: false };
    const { createStore } = require('./store');
    createStore(app.getPath('userData')).removeExclusion(cachedTenant.id, String(id));
    return { ok: true };
  });

  // Событие исхода («Вопрос», «Отказ»…) в ленте: что написал работодатель и что мы ему
  // ответили — из локальной переписки. Сервер хранит в событии только текст сообщения
  // (и то с 1.0.21), а ответ знает только локальная база.
  ipcMain.handle('negotiation:tail', async (_e, { negotiationId, incoming }) => {
    if (!cachedTenant || !negotiationId) return null;
    const { createStore } = require('./store');
    const store = createStore(app.getPath('userData'));
    const doc = store.getNegotiation(cachedTenant.id, String(negotiationId));
    // В переписках, сохранённых до 1.0.17, ещё лежат даты и «Непрочитанные сообщения».
    const { isChatChrome } = require('@hhpilot/automation-core/src/hh/negotiations');
    const msgs = ((doc && doc.messages) || []).filter((m) => m && !isChatChrome(m.text));
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    let at = -1;
    for (let i = msgs.length - 1; i >= 0 && at === -1; i -= 1) {
      if (msgs[i].from === 'employer' && (!incoming || norm(msgs[i].text) === norm(incoming))) at = i;
    }
    if (at === -1 && incoming) {
      for (let i = msgs.length - 1; i >= 0 && at === -1; i -= 1) if (msgs[i].from === 'employer') at = i;
    }
    if (at === -1) return { employer: [], reply: null, waiting: false };
    // Подряд идущие сообщения работодателя — одна реплика: вопрос часто идёт вторым.
    let from = at;
    while (from > 0 && msgs[from - 1].from === 'employer' && at - from < 2) from -= 1;
    const reply = msgs.slice(at + 1).find((m) => m.from !== 'employer');
    const waiting = store.getOpenClarifications(cachedTenant.id).some((c) => c.negotiationId === String(negotiationId));
    return { employer: msgs.slice(from, at + 1).map((m) => ({ text: m.text, author: m.author || '' })), reply: reply ? reply.text : null, waiting };
  });

  // Сама доставка работодателю — на следующем круге чатов (нужен реальный браузер с
  // живой сессией hh.ru, см. negotiationsWatcher.deliverPendingClarifications). Здесь
  // только фиксируем ответ человека.
  ipcMain.handle('clarifications:answer', async (_e, { id, answerText, aiImprove }) => {
    if (!cachedTenant || !id || !String(answerText || '').trim()) return { ok: false };
    const { createStore } = require('./store');
    const store = createStore(app.getPath('userData'));
    store.answerClarification(cachedTenant.id, id, { answerText: String(answerText).trim(), aiImprove: aiImprove !== false });
    return { ok: true };
  });

  // Недавняя лента для окна «Что происходит»: тянем с сервера, чтобы после
  // запуска/обновления оно не было пустым, хотя за день десятки событий.
  //
  // Раньше отдавали ВСЕ последние 100 событий на КАЖДЫЙ вызов (в т.ч. на каждый
  // перезапуск лаунчера) — дедуп в рендерере (shownFeedIds) живёт только в памяти
  // вкладки и обнуляется при рестарте, так что отклик недельной давности при
  // перезапуске лаунчера снова падал в ленту и выглядел как только что случившийся
  // ("почему это всплыло только сейчас, я же откликался 11 сентября?"). Метка
  // «докуда уже показано» теперь переживает рестарт (settings, не сбрасывается) —
  // отдаём только то, что случилось ПОСЛЕ прошлой выдачи. На первом вызове вообще
  // (метки ещё нет) отдаём всё как раньше — ради исходной цели «не было пустым».
  ipcMain.handle('feed:history', async () => {
    const token = settings.get('deviceToken');
    if (!token) return [];
    const events = await coreApi.recentEvents(token, 100);
    const lastSeenAt = settings.get('lastSeenFeedAt') || 0;
    const fresh = events.filter((e) => new Date(e.at || 0).getTime() > lastSeenAt);
    const newestAt = events.reduce((max, e) => Math.max(max, new Date(e.at || 0).getTime()), lastSeenAt);
    settings.set('lastSeenFeedAt', newestAt);
    return fresh;
  });

  ipcMain.handle('shell:openExternal', async (_e, url) => {
    if (/^https?:\/\//.test(url)) await shell.openExternal(url);
  });

  ipcMain.handle('shell:openBilling', async () => {
    await shell.openExternal(`${SITE_URL}/app`);
  });

  // Кнопки своей рамки (окно без системной). «Закрыть» = спрятать в трей, ровно как
  // делал системный крестик: автопилот должен продолжать работать в фоне.
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:close', () => mainWindow?.hide());
}

// --- Пользовательская сессия ---
// Сессия (JWT) живёт 30 дней. Раньше по её истечении лаунчер продолжал показывать
// «вошли» по сохранённым данным, а любое сохранение падало с «Сессия недействительна».
// Теперь: отказ сессии → свежая по токену устройства и повтор запроса; устройство
// отвязано → честный выход на экран входа. Сеть пропала — ничего не трогаем.
function isSessionError(e) { return e?.status === 401 && e?.code === 'SESSION_INVALID'; }

async function restoreSession() {
  const deviceToken = settings.get('deviceToken');
  if (!deviceToken) return { revoked: true };
  try {
    const { token } = await coreApi.deviceSession(deviceToken);
    settings.set('token', token);
    return { token };
  } catch (e) {
    return e?.status === 401 ? { revoked: true } : { offline: true };
  }
}

let restoring = null; // несколько запросов упали разом — восстанавливаем один раз
async function withSession(call) {
  try {
    return await call(settings.get('token'));
  } catch (e) {
    if (!isSessionError(e)) throw e;
    if (!restoring) restoring = restoreSession().finally(() => { restoring = null; });
    const r = await restoring;
    if (r.token) return call(r.token);
    if (r.revoked) signOut('Сессия истекла — войдите снова');
    throw e;
  }
}

function signOut(reason = null) {
  scheduler?.stop();
  settings.clear();
  cachedTenant = null;
  mainWindow?.webContents.send('auth:signed-out', reason);
}

function startAutomation() {
  if (!scheduler) {
    const browserDir = path.join(app.getPath('userData'), 'hh-profile');
    scheduler = createScheduler({
      tenantGetter: () => cachedTenant,
      externalStageEnabledGetter: () => settings.get('externalStageConsent') === true,
      // Аккаунт перечитывается перед каждым кругом. Раньше он брался один раз при
      // входе, и любые изменения на сервере — тариф, дневной лимит, профиль —
      // доезжали только после перезапуска лаунчера. Именно поэтому автопилот
      // упирался в прежний лимит 40, хотя на сервере уже стояло 200.
      refreshTenant: async () => {
        if (!settings.get('token')) return cachedTenant;
        const res = await withSession((t) => coreApi.me(t));
        settings.set('tenant', res.tenant);
        cachedTenant = res.tenant;
        return res.tenant;
      },
      deviceTokenGetter: () => settings.get('deviceToken'),
      coreApiBaseUrl: CORE_API_URL,
      browserDir,
      cdpPort: CDP_PORT,
      onEvent: onSchedulerEvent,
      log,
    });
  }
  scheduler.start(app.getPath('userData'));
  mainWindow?.webContents.send('automation:changed');
}

function autoLaunchSupported() {
  // В разработке (electron .) в автозагрузку попал бы голый electron.exe.
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin');
}

function isAutoLaunchEnabled() {
  return settings?.get('autoLaunch') === true;
}

function applyAutoLaunch(enabled) {
  if (!autoLaunchSupported()) return;
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [AUTOSTART_ARG] });
  } catch (e) {
    log(`Автозапуск: не удалось ${enabled ? 'включить' : 'выключить'} — ${e.message}`);
  }
}

// Запуск вместе с Windows: окно не показываем, автопилот включаем сами. Если в
// лаунчере никто не вошёл (вышли из аккаунта), работать нечему — показываем окно входа.
// Сколько секунд компьютер включён. OTKLIKS_TEST_UPTIME — только для e2e-проверки
// перехода со старых версий (на сервере проверок аптайм — сутки).
function systemUptimeSec() {
  return Number(process.env.OTKLIKS_TEST_UPTIME) || require('node:os').uptime();
}

// После автообновления: автопилот работал — запускаем его снова, без задержки
// автозапуска (сеть уже поднята, компьютер не только что включён).
function resumeAfterUpdate() {
  setTimeout(() => {
    if (scheduler?.isRunning()) return;
    log(`Обновление ${app.getVersion()} установлено — автопилот продолжает работу.`);
    startAutomation();
  }, 3000);
}

function handleLoginLaunch() {
  if (!settings.get('token')) {
    showWindow();
    return;
  }
  setTimeout(() => {
    if (scheduler?.isRunning()) return;
    log('Компьютер включён — автопилот запускается сам (автозапуск).');
    startAutomation();
    if (Notification.isSupported()) {
      new Notification({
        title: 'Откликс работает',
        body: 'Автопилот запустился сам и ищет вакансии в фоне. Окно — по значку у часов.',
        silent: true,
      }).show();
    }
  }, AUTOSTART_DELAY_MS);
}


// С 1.0.0 лицензии Electron/Chromium лежат в подпапке licenses. При переходе со
// старых версий их подменщик копирует новое поверх и ничего не удаляет — в корне
// папки остаются старые копии. Убираем их, если новые уже на месте. Ошибки не
// важны: это только порядок в папке, на работу не влияет.
function tidyInstallDir() {
  if (!app.isPackaged) return;
  const fs = require('node:fs');
  const dir = path.dirname(process.execPath);
  if (!fs.existsSync(path.join(dir, 'licenses', 'LICENSES.chromium.html'))) return;
  for (const f of ['LICENSE.electron.txt', 'LICENSES.chromium.html']) {
    try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* не важно */ }
  }
}

app.on('second-instance', () => showWindow());

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  tidyInstallDir();
  settings = createSettings(app.getPath('userData'));
  coreApi = createCoreApiClient({
    baseUrl: CORE_API_URL,
    // Сервер продлил сессию — сохраняем, только если за это время не вошли заново.
    onSessionToken: (old, fresh) => { if (settings.get('token') === old) settings.set('token', fresh); },
  });
  cachedTenant = settings.get('tenant') || null;
  // Путь к exe мог поменяться (папку перенесли, обновление) — перепрописываем
  // автозагрузку при каждом старте, чтобы она не указывала в пустоту.
  if (isAutoLaunchEnabled()) applyAutoLaunch(true);

  Menu.setApplicationMenu(null);
  registerIpc();
  // Только что обновились сами (см. quitAndRelaunch) — продолжаем так же, как работали
  // до обновления: окно скрыто, если было скрыто; автопилот — если работал. Флаг
  // разовый и не старше 10 минут, чтобы случайно не сработать через неделю.
  const resume = settings.get('resumeAfterUpdate');
  if (resume) settings.set('resumeAfterUpdate', null);
  const resumeFresh = resume && Date.now() - (resume.at || 0) < 10 * 60 * 1000;
  // Переход со старых версий (до 1.0.11), которые этот флаг ещё не ставили: первый
  // запуск новой версии сразу после включения компьютера при включённом автозапуске
  // почти наверняка и есть автозапуск, перезапущенный обновлением. Ведём себя так же.
  const lastVersion = settings.get('lastVersion');
  settings.set('lastVersion', app.getVersion());
  const justUpdated = !!lastVersion && lastVersion !== app.getVersion();
  const bootLaunch = launchedAtLogin
    || (justUpdated && !resume && systemUptimeSec() < 15 * 60 && !!settings.get('token'));
  const startHidden = (bootLaunch && isAutoLaunchEnabled()) || !!(resumeFresh && resume.hidden && settings.get('token'));
  createWindow({ show: !startHidden });
  createTray({
    getWindow: () => mainWindow,
    showWindow,
    // Тот же разлогин, что и по кнопке в интерфейсе: гасим автопилот, чистим
    // сохранённую сессию и возвращаем окно входа.
    logout: async () => signOut(),
  });
  checkForUpdates();
  if (resumeFresh && resume.automation && settings.get('token')) resumeAfterUpdate();
  else if (bootLaunch && isAutoLaunchEnabled()) handleLoginLaunch();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Проверка обновлений для архивной поставки. Установщика больше нет (его убивали
// антивирусы), а electron-updater умеет обновлять только NSIS — поэтому просто
// сверяем версию и зовём скачать. См. updateCheck.js.
let updater = null;

// Фоновое автообновление: скачивает новую версию, проверяет её и предлагает подмену
// одним нажатием — вместо ручного перекачивания архива (см. autoUpdate.js).
function checkForUpdates() {
  if (!app.isPackaged) return;
  const { createUpdater } = require('./autoUpdate');

  updater = createUpdater({
    currentVersion: app.getVersion(),
    installDir: path.dirname(process.execPath),
    exeName: path.basename(process.execPath),
    log,
    onEvent: (e) => mainWindow?.webContents.send('update:state', e),
    // Ставим само, но не посреди работы: если автопилот сейчас крутит отклики —
    // не рвём сессию, обновление применится при следующем запуске (а при старте
    // автопилот ещё не запущен, значит обычный сценарий «запустил → обновился»).
    shouldAutoApply: () => !(scheduler && scheduler.isRunning()),
    quitAndRelaunch: () => {
      // Запоминаем, как лаунчер работал: подменщик запускает новую версию обычным
      // стартом, без --autostart. Раньше после автообновления при автозапуске новая
      // версия просто открывала окно, а автопилот оставался выключенным.
      settings.set('resumeAfterUpdate', {
        automation: !!(scheduler && scheduler.isRunning()) || (launchedAtLogin && isAutoLaunchEnabled()),
        hidden: !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible(),
        at: Date.now(),
      });
      // КРИТИЧНО: close-обработчик окна проверяет tray-флаг isQuitting(), а не
      // app.isQuitting. Без setQuitting(true) app.quit() ловит preventDefault, окно
      // просто прячется в трей, процесс НЕ выходит — и скрипт подмены висит в
      // waitloop, ожидая смерти нашего PID (то самое чёрное окно «find <pid>»).
      setQuitting(true);
      app.isQuitting = true;
      app.quit();
      // Подстраховка: если что-то ещё удержало окно от закрытия — выходим жёстко,
      // чтобы освободить файлы для подмены.
      setTimeout(() => { try { app.exit(0); } catch { /* уже вышли */ } }, 1500);
    },
  });
  updater.start();
}

// НЕ выходим по закрытию последнего окна: окно теперь прячется в трей, и выход
// по этому событию убивал бы автопилот ровно тогда, когда его сворачивают.
app.on('window-all-closed', () => {});

// Единственная точка настоящего выхода — здесь останавливаем автопилот и убираем
// значок, чтобы он не завис в трее «призраком» до наведения мышью.
app.on('before-quit', () => {
  setQuitting(true);
  scheduler?.stop();
  destroyTray();
});

process.on('unhandledRejection', (r) => console.error('unhandledRejection:', r?.message || r));
