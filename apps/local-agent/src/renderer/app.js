const $ = (id) => document.getElementById(id);

let tenant = null;
let resumeRows = [];

// На «Панели управления» прокручивается только лента (каждая вкладка — своя:
// #feed, #log-feed, #invites, #clarifications), всё выше неё стоит на месте.
// Любая вставка/удаление карточки ВЫШЕ того места, куда сейчас смотрит человек
// (новый отклик, новое приглашение), сдвигает содержимое под ней — открытая
// карточка «Переписка» визуально уезжает, и выглядит это как «всё закрылось».
// Поэтому каждую такую мутацию оборачиваем: меряем высоту прокручиваемых лент до
// и после и компенсируем scrollTop на разницу. Если лента не прокручена
// (scrollTop === 0, самый верх) — не трогаем: там новому контенту нечего заслонять.
// С 1.0.9 прокручивается одна рабочая область (#main-scroll) — ленты внутри неё.
const STABLE_SCROLLERS = ['main-scroll'];
function withStableScroll(mutate) {
  const before = STABLE_SCROLLERS.map((id) => {
    const el = $(id);
    return el ? { el, top: el.scrollTop, height: el.scrollHeight } : null;
  }).filter(Boolean);
  const result = mutate();
  for (const s of before) {
    if (s.top > 0) s.el.scrollTop = s.top + (s.el.scrollHeight - s.height);
  }
  return result;
}

function fmt(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

function showAuth() {
  $('auth-screen').classList.remove('hidden');
  $('app-shell').classList.add('hidden');
}

function showApp() {
  $('auth-screen').classList.add('hidden');
  $('app-shell').classList.remove('hidden');
  refreshAutoLaunch();
}

// --- Auth screen ---

$('switch-to-register').addEventListener('click', () => {
  $('auth-title').textContent = 'Регистрация';
  $('auth-sub').textContent = 'Бесплатно, 100 откликов в день';
  $('login-form').classList.add('hidden');
  $('register-form').classList.remove('hidden');
  $('switch-to-register-wrap').classList.add('hidden');
  $('switch-to-login-wrap').classList.remove('hidden');
});

$('switch-to-login').addEventListener('click', () => {
  $('auth-title').textContent = 'Вход в Откликс';
  $('auth-sub').textContent = 'Автопилот поиска работы на hh.ru';
  $('register-form').classList.add('hidden');
  $('login-form').classList.remove('hidden');
  $('switch-to-login-wrap').classList.add('hidden');
  $('switch-to-register-wrap').classList.remove('hidden');
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').classList.add('hidden');
  $('login-submit').disabled = true;
  try {
    tenant = await window.otkliks.login($('login-email').value, $('login-password').value);
    await afterAuth();
  } catch (err) {
    $('login-error').textContent = err.message || 'Не получилось войти';
    $('login-error').classList.remove('hidden');
  } finally {
    $('login-submit').disabled = false;
  }
});

document.querySelectorAll('#register-form [data-external]').forEach((a) => {
  a.addEventListener('click', (ev) => { ev.preventDefault(); window.otkliks.openExternal(a.dataset.external); });
});

$('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('register-error').classList.add('hidden');
  // Согласие на обработку ПД — отдельная обязательная галочка (152-ФЗ); сервер без
  // неё аккаунт не создаст.
  if (!$('register-consent').checked) {
    $('register-error').textContent = 'Отметьте согласие на обработку персональных данных';
    $('register-error').classList.remove('hidden');
    return;
  }
  $('register-submit').disabled = true;
  try {
    tenant = await window.otkliks.register(
      $('register-email').value,
      $('register-password').value,
      $('register-name').value,
      true,
    );
    await afterAuth();
  } catch (err) {
    $('register-error').textContent = err.message || 'Не получилось создать аккаунт';
    $('register-error').classList.remove('hidden');
  } finally {
    $('register-submit').disabled = false;
  }
});

async function afterAuth() {
  // Первый вход — сразу пейрим это устройство (лаунчер = устройство), дальше пароль не нужен.
  try {
    await window.otkliks.pairDevice();
  } catch {
    /* уже спарено раньше — не критично */
  }
  renderAll();
  showApp();
  switchPanel('overview');
  refreshStats();
}

$('logout-btn').addEventListener('click', async () => {
  await window.otkliks.logout();
  tenant = null;
  profileBase = null;
  showAuth();
});

// --- Кнопки своей рамки окна ---
// --- Подсказки к значкам без подписи ---
// Системный title появляется секунды через полторы серым прямоугольником. Свои — через
// 0,5 с, тёмной плашкой с мягким появлением. Любой элемент с title (и созданный позже)
// подхватывается при наведении: title переезжает в data-tip, чтобы системная подсказка
// не всплывала поверх. Поля ввода не трогаем.
const ttip = document.createElement('div');
ttip.className = 'ttip';
ttip.setAttribute('role', 'tooltip');
document.body.appendChild(ttip);
let tipEl = null;
let tipTimer = 0;
function hideTip() { clearTimeout(tipTimer); tipEl = null; ttip.classList.remove('is-on'); }
function showTip(el) {
  if (!el.isConnected || !el.dataset.tip) return;
  ttip.textContent = el.dataset.tip;
  const r = el.getBoundingClientRect();
  const w = ttip.offsetWidth, h = ttip.offsetHeight, gap = 8;
  let x, y, tx = '0px', ty = '4px';
  if (el.closest('.rail')) { x = r.right + gap; y = r.top + r.height / 2 - h / 2; tx = '-4px'; ty = '0px'; }
  else if (r.bottom + gap + h < innerHeight) { x = r.left + r.width / 2 - w / 2; y = r.bottom + gap; ty = '-4px'; }
  else { x = r.left + r.width / 2 - w / 2; y = r.top - gap - h; }
  x = Math.max(6, Math.min(innerWidth - w - 6, x));
  y = Math.max(6, Math.min(innerHeight - h - 6, y));
  ttip.style.left = `${x}px`; ttip.style.top = `${y}px`;
  ttip.style.setProperty('--tx', tx); ttip.style.setProperty('--ty', ty);
  ttip.classList.add('is-on');
}
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest?.('[title], [data-tip]');
  if (!el || el.matches('input, textarea, select') || el === tipEl) return;
  if (el.hasAttribute('title')) {
    el.dataset.tip = el.getAttribute('title');
    el.removeAttribute('title');
    if (!el.textContent.trim() && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', el.dataset.tip);
  }
  hideTip();
  tipEl = el;
  tipTimer = setTimeout(() => showTip(el), 500);
});
document.addEventListener('mouseout', (e) => { if (tipEl && !tipEl.contains(e.relatedTarget)) hideTip(); });
document.addEventListener('mousedown', hideTip, true);
addEventListener('blur', hideTip);

$('win-min')?.addEventListener('click', () => window.otkliks.windowMinimize());
$('win-close')?.addEventListener('click', () => window.otkliks.windowClose());

// --- Свой выпадающий список ---
// Системный <select> раскрывается списком в стиле Windows и выбивается из интерфейса.
// Сам <select> остаётся (прозрачный, под кнопкой) — его value читает и пишет остальной
// код как раньше, а кнопка и меню лишь показывают и меняют это значение.
function enhanceSelect(select) {
  const wrap = document.createElement('div');
  wrap.className = 'sel';
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sel__btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span');
  btn.append(label, svgUse('i-chev'));
  const menu = document.createElement('div');
  menu.className = 'sel__menu';
  menu.setAttribute('role', 'listbox');
  wrap.append(btn, menu);

  let active = null;
  const setActive = (b) => { opts.forEach((x) => x.classList.toggle('is-active', x === b)); active = b; };
  const sync = () => {
    const o = select.options[select.selectedIndex];
    label.textContent = o ? o.textContent : '';
    opts.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.value === select.value)));
  };
  const choose = (value) => {
    if (select.value === value) return;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  function open() {
    // Внизу окна места нет — раскрываемся вверх.
    const r = btn.getBoundingClientRect();
    wrap.classList.toggle('sel--up', r.bottom + opts.length * 34 + 24 > innerHeight);
    wrap.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    setActive(opts.find((b) => b.dataset.value === select.value) || opts[0]);
    document.addEventListener('pointerdown', outside, true);
  }
  function close() {
    wrap.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
  }
  const opts = [...select.options].map((o) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sel__opt';
    b.tabIndex = -1;
    b.setAttribute('role', 'option');
    b.dataset.value = o.value;
    const t = document.createElement('span');
    t.textContent = o.textContent;
    b.append(t, svgUse('i-check'));
    b.addEventListener('click', () => { choose(o.value); close(); btn.focus(); });
    b.addEventListener('mouseenter', () => setActive(b));
    menu.appendChild(b);
    return b;
  });

  btn.addEventListener('click', () => (wrap.classList.contains('is-open') ? close() : open()));
  btn.addEventListener('keydown', (e) => {
    const isOpen = wrap.classList.contains('is-open');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) { open(); return; }
      const i = opts.indexOf(active) + (e.key === 'ArrowDown' ? 1 : -1);
      setActive(opts[(i + opts.length) % opts.length]);
    } else if ((e.key === 'Enter' || e.key === ' ') && isOpen) {
      e.preventDefault();
      if (active) choose(active.dataset.value);
      close();
    } else if (e.key === 'Escape' || e.key === 'Tab') close();
  });

  // Значение могут выставить из кода (профиль пришёл с сервера) — подпись следует за ним.
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); sync(); },
  });
  select.addEventListener('change', sync);
  sync();
}
document.querySelectorAll('select').forEach(enhanceSelect);

// --- Разделы (колонка слева) и пункты боковой панели ---
// Раздел — «Автопилот», «Резюме и профиль», «Настройки». У каждого своя боковая
// панель: у автопилота — экраны (обзор, лента, приглашения…), у профиля и настроек —
// переходы к секциям той же страницы.
const PANEL_TITLES = {
  overview: 'Обзор', feed: 'Что происходит', invites: 'Приглашения на созвон',
  clarifications: 'Нужен ваш ответ', exclusions: 'Исключения', blacklist: 'Чёрный список', log: 'Журнал работы',
};
const VIEW_TITLES = { profile: 'Резюме и профиль', settings: 'Настройки' };
let currentView = 'dashboard';
let currentPanel = 'overview';

function setHead(title, actions) {
  $('main-title').textContent = title;
  const box = $('main-actions');
  box.textContent = '';
  (actions || []).forEach((a) => box.appendChild(a));
}
function chip(text) { const c = document.createElement('span'); c.className = 'chip'; c.textContent = text; return c; }

function switchView(view) {
  if (view === 'settings') refreshHhState();
  if (view === 'profile') refreshProfileFromServer();
  currentView = view;
  document.querySelectorAll('.rail__btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.side__nav').forEach((n) => n.classList.toggle('hidden', n.dataset.for !== view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
  $('main-scroll').scrollTop = 0;
  if (view === 'dashboard') switchPanel(currentPanel);
  else setHead(VIEW_TITLES[view] || '');
}
document.querySelectorAll('.rail__btn[data-view]').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.goto)));

// Экраны автопилота: id панели в разметке.
const PANEL_EL = { overview: 'overview', feed: 'feed-panel', invites: 'invites', clarifications: 'clarifications', exclusions: 'exclusions', blacklist: 'blacklist', log: 'log-panel' };
function panelElId(panel) { return PANEL_EL[panel] || panel; }

function switchPanel(panel) {
  currentPanel = panel;
  document.querySelectorAll('.nav-i[data-panel]').forEach((b) => {
    const on = b.dataset.panel === panel;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  Object.values(PANEL_EL).forEach((id) => $(id)?.classList.add('hidden'));
  $(panelElId(panel))?.classList.remove('hidden');
  const actions = [];
  if (panel === 'overview') actions.push(chip('Последние 14 дней'));
  if (panel === 'feed') actions.push(chip('Свежее сверху'));
  setHead(PANEL_TITLES[panel] || '', actions);
  $('main-scroll').scrollTop = 0;
  // Открыли экран — считаем всё в нём прочитанным, гасим счётчик.
  if (panel === 'invites' || panel === 'clarifications') markSeen(panel);
  if (panel === 'exclusions') renderExclusions();
  if (panel === 'blacklist') renderBlacklist();
}
document.querySelectorAll('.nav-i[data-panel]').forEach((btn) => btn.addEventListener('click', () => {
  if (currentView !== 'dashboard') switchView('dashboard');
  switchPanel(btn.dataset.panel);
}));

// Профиль и настройки: пункты боковой панели ведут к секциям, а подсветка следует за
// прокруткой — видно, где вы сейчас.
let jumpLock = 0;
document.querySelectorAll('.nav-i[data-jump]').forEach((btn) => btn.addEventListener('click', () => {
  // Пока идёт плавная прокрутка, подсветку не трогаем — иначе она пробежит по всем секциям.
  jumpLock = Date.now() + 700;
  btn.parentElement.querySelectorAll('.nav-i[data-jump]').forEach((b) => b.classList.toggle('active', b === btn));
  const sec = $(btn.dataset.jump);
  if (!sec) return;
  sec.scrollIntoView({ block: 'start' });
  // Секция может быть уже на экране (или последняя — до верха не доедет), и прокрутки
  // не случится. Поэтому всегда показываем, куда пришли: карточка мягко вспыхивает,
  // а курсор встаёт в её первое поле — сразу понятно, где это заполнять.
  sec.classList.remove('is-flash');
  void sec.offsetWidth; // перезапуск анимации при повторном клике
  sec.classList.add('is-flash');
  clearTimeout(sec._flashT);
  sec._flashT = setTimeout(() => sec.classList.remove('is-flash'), 1800);
  const field = sec.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([disabled]), textarea:not([disabled])');
  if (field) setTimeout(() => field.focus({ preventScroll: true }), 420);
}));
$('main-scroll').addEventListener('scroll', () => {
  if (currentView === 'dashboard' || Date.now() < jumpLock) return;
  const nav = document.querySelector(`.side__nav[data-for="${currentView}"]`);
  if (!nav) return;
  const box = $('main-scroll').getBoundingClientRect();
  let active = null;
  nav.querySelectorAll('.nav-i[data-jump]').forEach((b) => {
    const sec = $(b.dataset.jump);
    if (sec && sec.getBoundingClientRect().top - box.top < 80) active = b;
  });
  const sc = $('main-scroll');
  // Докрутили до конца — последняя секция короче окна и до верха не доедет никогда.
  if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) active = [...nav.querySelectorAll('.nav-i[data-jump]')].pop();
  active = active || nav.querySelector('.nav-i[data-jump]');
  nav.querySelectorAll('.nav-i[data-jump]').forEach((b) => b.classList.toggle('active', b === active));
}, { passive: true });

// --- Счётчики непрочитанного (по id элементов, что человек ещё не открывал) ---
// Храним «увиденные» id в localStorage per-вкладка. Непрочитанные = то, чего там нет.
function seenSet(panel) {
  try { return new Set(JSON.parse(localStorage.getItem(`otkliks:seen:${panel}`) || '[]')); }
  catch { return new Set(); }
}
function saveSeen(panel, set) {
  try { localStorage.setItem(`otkliks:seen:${panel}`, JSON.stringify([...set].slice(-500))); } catch { /* приватный режим */ }
}
function isPanelActive(panel) {
  return !$(panelElId(panel))?.classList.contains('hidden');
}
// Пометить все текущие элементы вкладки прочитанными и обнулить бейдж.
function markSeen(panel) {
  const ids = (panel === 'invites' ? lastInviteIds : lastClarIds);
  const set = seenSet(panel);
  ids.forEach((id) => set.add(id));
  saveSeen(panel, set);
  setBadge(panel, 0);
}
function setBadge(panel, count) {
  const el = $(panel === 'invites' ? 'badge-invites' : 'badge-clar');
  if (!el) return;
  el.textContent = count > 99 ? '99+' : String(count);
  el.classList.toggle('hidden', count <= 0);
}
// Пересчитать бейдж вкладки: сколько её элементов ещё не «увидены». Если вкладка сейчас
// открыта — сразу отмечаем прочитанным (человек их видит).
function refreshBadge(panel, ids) {
  if (panel === 'invites') lastInviteIds = ids; else lastClarIds = ids;
  renderTasks();
  if (isPanelActive(panel)) { markSeen(panel); return; }
  const set = seenSet(panel);
  setBadge(panel, ids.filter((id) => !set.has(id)).length);
}
let lastInviteIds = [];
let lastClarIds = [];

// «СтаниславСобеседованиеДобрый день» → «Станислав Собеседование Добрый день»: hh
// склеивает автора/тему/тело сообщения без пробелов. Разрываем ТОЛЬКО на кириллической
// границе строчная→заглавная (латиницу вроде «TypeScript» не трогаем).
function humanizeMessageText(text) {
  return String(text || '').replace(/([а-яё])([А-ЯЁ])/g, '$1 $2').trim();
}

// --- Rendering ---

function renderAll() {
  if (!tenant) return;
  window.otkliks.appVersion?.().then((v) => {
    $('settings-version').textContent = v;
  }).catch(() => {});

  initConsent();
  setupAccounts();
  initUpdates();
  initNotifications();
  initPasswordChange();
  const billingBtn = $('settings-billing-btn');
  if (billingBtn) billingBtn.onclick = () => window.otkliks.openBilling?.();
  renderTenant();
}

// Всё, что зависит только от данных аккаунта, — без навешивания обработчиков, поэтому
// её можно звать сколько угодно раз (обновление профиля с сервера, см. ниже).
function renderTenant() {
  if (!tenant) return;
  $('user-email').textContent = tenant.email;
  $('settings-email').textContent = tenant.email;
  $('user-ava').textContent = (String(tenant.fullName || tenant.email || 'О').trim()[0] || 'О').toUpperCase();

  const sub = tenant.subscription;
  const badge = $('sub-badge');
  if (tenant.isSubscriptionActive) {
    badge.textContent = sub.status === 'trialing' ? 'Пробный период' : 'Приоритет';
    badge.className = 'plan';
    $('trial-banner').classList.add('hidden');
  } else {
    // Раньше "Нет подписки" читалось как «автопилот не работает» — а он работает,
    // на бесплатном тарифе (с 1.0.8 — полном: 100 откликов, переписка, анкеты).
    badge.textContent = 'Бесплатный тариф';
    badge.className = 'plan plan--free';
    $('trial-banner').classList.toggle('hidden', !!tenant.freeTasks?.pending);
  }
  renderTask(tenant.isSubscriptionActive ? null : tenant.freeTasks);
  // Раньше активная ПЛАТНАЯ подписка показывала голое "активна" — ни тарифа, ни даты
  // окончания, хотя оба поля уже приходят с сервера (sub.plan/priceRub/currentPeriodEnd).
  const planLabel = { weekly: 'неделя', monthly: 'месяц' }[sub.plan] || sub.plan || '';
  const untilText = sub.currentPeriodEnd
    ? ` до ${new Date(sub.currentPeriodEnd).toLocaleDateString('ru-RU')}`
    : '';
  $('settings-sub-status').textContent = tenant.isSubscriptionActive
    ? (sub.status === 'trialing'
      ? `пробный период${untilText}`
      : `активна${planLabel ? ` (${planLabel}, ${sub.priceRub} ₽)` : ''}${untilText}`)
    : `бесплатный тариф — ${tenant.dailyUsed ?? 0}/${tenant.dailyCap ?? 10} откликов сегодня`;

  applyServerProfile(tenant);
  renderOverviewResumes();
  renderTasks();
}

// --- Обзор: резюме и задачи ---
function svgUse(id) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#${id}`);
  svg.appendChild(use);
  return svg;
}

function renderOverviewResumes() {
  const box = $('ov-resumes');
  if (!box || !tenant) return;
  box.textContent = '';
  const list = tenant.resumeProfiles || [];
  if (!list.length) {
    const e = document.createElement('div'); e.className = 'empty';
    e.textContent = 'Резюме не подключено — без него искать нечего.';
    box.appendChild(e); return;
  }
  list.forEach((r) => {
    // Каждое резюме — кнопка: открывает его страницу на hh.ru во внешнем браузере
    // (обычный переход увёл бы окно лаунчера на hh.ru).
    const url = String(r.similarVacanciesUrl || '').trim();
    const ok = /^https?:\/\//i.test(url);
    const row = document.createElement(ok ? 'button' : 'div');
    row.className = 'rres';
    if (ok) {
      row.type = 'button';
      row.title = 'Открыть резюме на hh.ru';
      row.addEventListener('click', () => window.otkliks.openExternal(url));
    }
    const ico = document.createElement('span'); ico.className = 'rres__ico'; ico.appendChild(svgUse('i-resume'));
    const t = document.createElement('div');
    const b = document.createElement('b'); b.textContent = r.label || 'Резюме';
    const sm = document.createElement('small'); sm.textContent = url.replace(/^https?:\/\//, '');
    t.append(b, sm); row.append(ico, t);
    if (ok) { const go = document.createElement('span'); go.className = 'rres__go'; go.appendChild(svgUse('i-ext')); row.appendChild(go); }
    box.appendChild(row);
  });
}

// «Задачи» — то, что ждёт человека прямо сейчас, с переходом в нужное место.
function renderTasks() {
  const box = $('tasks');
  if (!box) return;
  const rows = [];
  const seenClar = seenSet('clarifications');
  rows.push({ ico: 'i-ask', text: 'Ответить работодателям', n: lastClarIds.length, tone: lastClarIds.some((id) => !seenClar.has(id)) ? 'warn' : '', go: () => switchPanel('clarifications') });
  rows.push({ ico: 'i-invite', text: 'Приглашения на созвон', n: lastInviteIds.length, tone: 'teal', go: () => switchPanel('invites') });
  if (!(tenant?.resumeProfiles || []).length) rows.push({ ico: 'i-resume', text: 'Подключить резюме', n: '1', tone: 'warn', go: () => switchView('profile') });
  if (!automationRunning) rows.push({ ico: 'i-pilot', text: 'Запустить автопилот', n: '→', tone: '', go: () => $('toggle-automation-btn').click() });
  box.textContent = '';
  rows.forEach((r) => {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'trow' + (r.n === 0 ? ' trow--done' : '');
    const ico = document.createElement('span'); ico.className = 'trow__ico'; ico.appendChild(svgUse(r.ico));
    const t = document.createElement('span'); t.textContent = r.text;
    const n = document.createElement('span'); n.className = `trow__n${r.n === 0 ? ' trow__n--ok' : r.tone ? ` trow__n--${r.tone}` : ''}`; n.textContent = r.n === 0 ? '0' : String(r.n);
    b.append(ico, t, n); b.addEventListener('click', r.go); box.appendChild(b);
  });
}

// --- Задание дня бесплатного тарифа ---
// Пока оно не выполнено, сервер ставит бесплатный автопилот на паузу (core-api
// lib/freeTasks.js), а планировщик ждёт. «Готово» засчитывается только после
// перехода по ссылке и нескольких секунд — кнопка открывается сама.
let shownTaskId = null;
let taskDoneTimer = null;
function renderTask(ft) {
  const task = ft?.pending || null;
  $('task-card').classList.toggle('hidden', !task);
  const trial = $('trial-text');
  if (trial) {
    trial.dataset.base = trial.dataset.base || trial.textContent;
    let extra = '';
    if (ft && !ft.allDone && ft.next && !task) {
      const when = ft.nextAt ? new Date(ft.nextAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'завтра';
      extra = ` Следующее задание (${ft.next.day} из ${ft.total}) — ${when}.`;
    }
    trial.textContent = trial.dataset.base + extra;
  }
  if (!task) { shownTaskId = null; return; }
  if (shownTaskId === task.id) return;
  shownTaskId = task.id;
  $('task-step').textContent = `Задание ${task.day} из ${ft.total}`;
  $('task-title').textContent = task.title;
  $('task-text').textContent = task.text;
  $('task-open-btn').textContent = task.action;
  $('task-done-btn').disabled = !task.openedAt;
  $('task-msg').textContent = '';
}

const cleanIpcError = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

$('task-open-btn').addEventListener('click', async () => {
  const task = tenant?.freeTasks?.pending;
  if (!task) return;
  $('task-msg').textContent = '';
  try {
    await window.otkliks.taskOpen(task.id, task.url);
  } catch (err) {
    $('task-msg').textContent = cleanIpcError(err);
    return;
  }
  clearTimeout(taskDoneTimer);
  $('task-msg').textContent = 'Выполните задание и вернитесь — «Готово» откроется через пару секунд.';
  taskDoneTimer = setTimeout(() => { $('task-done-btn').disabled = false; }, (task.minOpenSec || 8) * 1000);
});

$('task-done-btn').addEventListener('click', async () => {
  const task = tenant?.freeTasks?.pending;
  if (!task) return;
  $('task-done-btn').disabled = true;
  try {
    tenant = await window.otkliks.taskDone(task.id);
    renderTenant();
  } catch (err) {
    $('task-msg').textContent = cleanIpcError(err);
    $('task-done-btn').disabled = false;
  }
});

// --- Профиль: синхронизация с сайтом ---
// Профиль один на аккаунт и живёт на сервере; кабинет на сайте и эта вкладка — два
// окна в одни и те же данные. Раньше форма заполнялась один раз при запуске: правки,
// сделанные на сайте, здесь не появлялись, а «Сохранить» в лаунчере отправлял ВСЕ поля
// целиком и молча затирал сайтовые. Теперь:
//  1) при сохранении уходят только поля, которые человек поменял здесь (сверка с
//     profileBase — последней версией, пришедшей с сервера);
//  2) свежий профиль подтягивается при фокусе окна, открытии вкладки и раз в минуту;
//     поле, которое человек сейчас правит, не трогаем — обновляются только нетронутые.
let profileBase = null;
let profileEpoch = 0;

const PROFILE_INPUTS = {
  fullName: 'full-name',
  strongStack: 'strong-stack',
  honestGaps: 'honest-gaps',
  portfolio: 'portfolio-canonical',
  contactTelegram: 'contact-telegram',
  salaryAmount: 'min-salary-amount',
  salaryCurrency: 'min-salary-currency',
};

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const splitList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const resumeShape = (r) => ({ key: r.key || '', label: r.label || '', similarVacanciesUrl: r.similarVacanciesUrl || '' });

function profileFromTenant(t) {
  const p = t?.profile || {};
  return {
    fullName: t?.fullName || '',
    strongStack: (p.strongStack || []).join(', '),
    honestGaps: (p.honestGaps || []).join(', '),
    portfolio: p.portfolioLink?.canonical || '',
    contactTelegram: p.contactTelegram || '',
    salaryAmount: p.minSalary?.amount ? String(p.minSalary.amount) : '',
    salaryCurrency: p.minSalary?.currency || 'RUB',
    resumes: (t?.resumeProfiles || []).map(resumeShape),
  };
}

function readProfileForm() {
  const v = {};
  for (const [k, id] of Object.entries(PROFILE_INPUTS)) v[k] = $(id).value;
  v.resumes = resumeRows.map(resumeShape);
  return v;
}

// Трёхсторонняя сверка: если поле в форме совпадает с прошлой серверной версией
// (человек его не трогал) — берём новое значение с сервера; если человек его уже
// поменял — оставляем как есть, оно уйдёт при сохранении. profileBase = null значит
// «заполнить форму целиком» (вход, сразу после сохранения).
function applyServerProfile(t) {
  const incoming = profileFromTenant(t);
  const current = profileBase ? readProfileForm() : null;
  for (const [k, id] of Object.entries(PROFILE_INPUTS)) {
    if (!current || sameValue(current[k], profileBase[k])) $(id).value = incoming[k];
  }
  if (!current || sameValue(current.resumes, profileBase.resumes)) {
    resumeRows = incoming.resumes.map((r) => ({ ...r }));
    renderResumeRows();
  }
  profileBase = incoming;
}

let profileSyncBusy = false;
async function refreshProfileFromServer() {
  if (!tenant || profileSyncBusy) return;
  profileSyncBusy = true;
  const epoch = profileEpoch;
  try {
    const fresh = await window.otkliks.session();
    // Пока ждали ответа, человек успел сохранить — этот ответ уже старше сохранённого.
    if (!fresh || epoch !== profileEpoch || !tenant) return;
    tenant = fresh;
    renderTenant();
  } catch {
    // сеть моргнула — обновимся в следующий раз
  } finally {
    profileSyncBusy = false;
  }
}

window.addEventListener('focus', refreshProfileFromServer);
setInterval(() => {
  if (document.visibilityState === 'visible') refreshProfileFromServer();
}, 60000);

function renderResumeRows() {
  const list = $('resume-list');
  list.innerHTML = '';
  resumeRows.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'resume-row';
    row.innerHTML = `
      <input placeholder="Название: Frontend" data-field="label" />
      <input placeholder="https://hh.ru/resume/…" data-field="similarVacanciesUrl" />
      <button class="btn btn--ghost" type="button" data-remove="${i}" title="Убрать резюме" aria-label="Убрать резюме"><svg><use href="#i-x"/></svg></button>
    `;
    // Значения — через свойство, а не в разметку: кавычка в названии ломала поле.
    row.querySelectorAll('input').forEach((input) => {
      input.value = r[input.dataset.field] || '';
      input.addEventListener('input', () => {
        resumeRows[i][input.dataset.field] = input.value;
      });
    });
    row.querySelector('[data-remove]').addEventListener('click', () => {
      resumeRows.splice(i, 1);
      renderResumeRows();
    });
    list.appendChild(row);
  });
}

$('add-resume-btn').addEventListener('click', () => {
  resumeRows.push({ key: '', label: '', similarVacanciesUrl: '' });
  renderResumeRows();
});

/**
 * Внутренний ключ профиля резюме.
 *
 * Раньше его вводил человек, и пустое поле «ключ» приводило к тому, что строка молча
 * выпадала при сохранении: добавить второе резюме было невозможно, хотя автопилот
 * умеет вести несколько параллельно. Теперь ключ берём из идентификатора резюме в
 * ссылке — он уникален и стабилен.
 */
function resumeKeyFor(row, index) {
  if (row.key) return row.key;
  const fromUrl = /\/resume\/([a-f0-9]+)/i.exec(row.similarVacanciesUrl || '')
    || /[?&]resume=([a-f0-9]+)/i.exec(row.similarVacanciesUrl || '');
  if (fromUrl) return fromUrl[1].slice(0, 12);
  return `resume${index + 1}`;
}

$('save-profile-btn').addEventListener('click', async () => {
  const form = readProfileForm();
  const filled = form.resumes.filter((r) => r.similarVacanciesUrl.trim());
  if (!filled.length) {
    $('profile-error')?.classList.remove('hidden');
    return;
  }
  $('profile-error')?.classList.add('hidden');

  // Только то, что поменяли здесь: остальное могли за это время поправить на сайте.
  const base = profileBase || profileFromTenant(null);
  const changed = (k) => !sameValue(form[k], base[k]);
  const body = {};
  const profile = {};
  if (changed('fullName')) body.fullName = form.fullName.trim();
  if (changed('strongStack')) profile.strongStack = splitList(form.strongStack);
  if (changed('honestGaps')) profile.honestGaps = splitList(form.honestGaps);
  // Пустое поле = убрать ссылку. Раньше пустое значение вообще не уходило на сервер,
  // и стереть портфолио было невозможно.
  if (changed('portfolio')) profile.portfolioLink = parsePortfolioLink(form.portfolio) || { domain: '', canonical: '' };
  if (changed('contactTelegram')) profile.contactTelegram = form.contactTelegram.trim();
  if (changed('salaryAmount') || changed('salaryCurrency')) {
    profile.minSalary = {
      amount: Math.max(0, Math.round(Number(form.salaryAmount) || 0)),
      currency: form.salaryCurrency || 'RUB',
    };
  }
  if (Object.keys(profile).length) body.profile = profile;
  if (changed('resumes')) {
    body.resumeProfiles = filled.map((r, i) => ({
      key: resumeKeyFor(r, i),
      label: r.label.trim() || `Резюме ${i + 1}`,
      similarVacanciesUrl: r.similarVacanciesUrl.trim(),
    }));
  }

  // Сервер проверяет Telegram-ник и отвечает 400 на кривой — без catch ошибка
  // терялась бы молча, а человек думал бы, что всё сохранилось.
  profileEpoch += 1;
  try {
    tenant = await window.otkliks.updateProfile(body);
  } catch (err) {
    const msg = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    $('profile-save-error').textContent = msg || 'Не удалось сохранить — попробуйте ещё раз.';
    $('profile-save-error').classList.remove('hidden');
    return;
  }
  $('profile-save-error').classList.add('hidden');
  // Форму — целиком по ответу сервера: он нормализует значения (ldrion → @ldrion).
  profileBase = null;
  renderTenant();
  $('profile-saved').classList.remove('hidden');
  setTimeout(() => $('profile-saved').classList.add('hidden'), 2000);
});

$('open-billing-btn').addEventListener('click', () => window.otkliks.openBilling());

// --- Сессия hh.ru ---
// Кнопка входа раньше просто открывала браузер и молчала. Теперь состояние сессии
// проверяется по-настоящему (в hh.ru ищется меню аккаунта) и показывается.
let hhPollTimer = null;

function renderHhState(state, text) {
  const dot = $('hh-dot');
  dot.classList.toggle('on', state === 'in');
  dot.classList.toggle('off', state === 'out');
  $('hh-state-text').textContent = text;
}

async function refreshHhState({ quiet = false } = {}) {
  if (!quiet) renderHhState('unknown', 'Проверяем вход…');
  try {
    const res = await window.otkliks.hhStatus();
    renderHhState(
      res?.loggedIn ? 'in' : 'out',
      res?.loggedIn ? 'Вход выполнен — автопилот сможет работать' : 'Вход не выполнен',
    );
    return !!res?.loggedIn;
  } catch {
    renderHhState('out', 'Не удалось проверить вход');
    return false;
  }
}

$('hh-login-btn').addEventListener('click', async () => {
  renderHhState('unknown', 'Открываем браузер — войдите в hh.ru в нём');
  await window.otkliks.hhLogin();
  // Человек логинится в открывшемся окне сколько-то минут, и момент, когда он
  // закончил, нам никто не сообщит — поэтому опрашиваем сами, пока не увидим вход.
  clearInterval(hhPollTimer);
  const until = Date.now() + 5 * 60 * 1000;
  hhPollTimer = setInterval(async () => {
    if (Date.now() > until) { clearInterval(hhPollTimer); return; }
    if (!(await refreshHhState({ quiet: true }))) return;

    clearInterval(hhPollTimer);
    // Вход есть — гасим видимое окно браузера. Иначе автопилот подключится именно к
    // нему и будет открывать вкладки прямо на экране вместо фоновой работы.
    renderHhState('in', 'Вход выполнен — закрываем окно браузера…');
    await window.otkliks.hhFinishLogin();
    renderHhState('in', 'Вход выполнен — автопилот работает в фоне');
  }, 15000);
});

$('hh-check-btn').addEventListener('click', () => refreshHhState());

// --- Automation control ---

let automationRunning = false;

async function refreshAutomationStatus() {
  const { running } = await window.otkliks.automationStatus();
  automationRunning = running;
  $('status-dot').classList.toggle('on', running);
  $('status-text').textContent = running ? 'Автопилот работает' : 'Автопилот выключен';
  $('status-text').title = running ? 'Ищет вакансии, откликается и отвечает в чатах на этом компьютере' : '';
  const toggle = $('toggle-automation-btn');
  toggle.textContent = running ? 'Остановить' : 'Запустить';
  // Пока автопилот выключен, «Запустить» — главное действие экрана и выглядит как
  // главное. Когда работает, тёмная кнопка «Остановить» тянула внимание на себя,
  // хотя останавливать обычно ничего не нужно.
  toggle.classList.toggle('btn--dark', !running);
  toggle.classList.toggle('btn--line', running);
  renderTasks();
}

// Автопилот запустил сам лаунчер (автозапуск при включении компьютера) — кнопка
// «Запустить/Остановить» должна это показать.
window.otkliks.onAutomationChanged?.(() => refreshAutomationStatus());

// --- Автозапуск вместе с компьютером ---
function renderAutoLaunch(enabled) {
  const btn = $('autostart-toggle');
  btn.setAttribute('aria-checked', String(enabled));
  btn.classList.toggle('is-on', enabled);
  $('autostart-tip-state').textContent = enabled
    ? 'Сейчас включено.'
    : 'Сейчас выключено.';
}

async function refreshAutoLaunch() {
  const state = await window.otkliks.autoLaunchGet?.().catch(() => null);
  // Нет поддержки (запуск из исходников) — переключатель не показываем вовсе.
  $('autostart-wrap').classList.toggle('hidden', !state || !state.supported);
  if (state) renderAutoLaunch(state.enabled);
}

$('autostart-toggle').addEventListener('click', async () => {
  const next = $('autostart-toggle').getAttribute('aria-checked') !== 'true';
  renderAutoLaunch(next);
  const state = await window.otkliks.autoLaunchSet?.(next).catch(() => null);
  renderAutoLaunch(state ? state.enabled : !next);
});

$('toggle-automation-btn').addEventListener('click', async () => {
  if (automationRunning) await window.otkliks.stopAutomation();
  else await window.otkliks.startAutomation();
  await refreshAutomationStatus();
});

async function refreshStats() {
  refreshChart(); // график — из своей выборки, рисуем даже без общей статистики
  const stats = await window.otkliks.localStats();
  if (!stats) return;
  // Цветом подсвечиваем только то, что реально случилось: ноль приглашений — не
  // успех, ноль отказов — не беда, а раньше оба нуля горели зелёным и красным.
  const put = (id, value) => {
    const el = $(id);
    el.textContent = fmt(value);
    const card = el.closest('.stat-card');
    if (card) card.classList.toggle('has-value', Number(value) > 0);
  };
  put('stat-applied', stats.applied);
  put('stat-today', stats.appliedToday);
  put('stat-msgs-today', stats.messagesToday);
  put('stat-interviews', stats.interviews);
  put('stat-rejections', stats.rejections);
}

// График «Отклики за 14 дней»: дни без откликов — нулём, наведение показывает число.
async function refreshChart() {
  const days = await window.otkliks.dailyStats?.(14).catch(() => null);
  if (!Array.isArray(days)) return;
  lastDays = days;
  drawChart();
}
let lastDays = [];
function drawChart() {
  const box = $('chart');
  if (!box) return;
  const days = lastDays;
  const total = days.reduce((s, d) => s + d.count, 0);
  $('chart-total').textContent = fmt(total);
  box.textContent = '';
  if (!box.clientWidth) return; // экран скрыт — нарисуем, когда покажется
  const W = Math.max(280, box.clientWidth), H = Math.max(160, box.clientHeight || 196);
  const padL = 30, padR = 8, padT = 10, padB = 22;
  const max = Math.max(4, ...days.map((d) => d.count));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const x = (i) => padL + (i * (W - padL - padR)) / Math.max(1, days.length - 1);
  const y = (v) => padT + (1 - v / top) * (H - padT - padB);
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' });
  const defs = el('defs', {});
  const grad = el('linearGradient', { id: 'chartFill', x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(el('stop', { offset: '0', 'stop-color': '#12edcf', 'stop-opacity': '.28' }), el('stop', { offset: '1', 'stop-color': '#12edcf', 'stop-opacity': '0' }));
  defs.appendChild(grad); svg.appendChild(defs);
  const grid = el('g', { class: 'grid' });
  for (let k = 0; k <= 4; k += 1) {
    const v = step * k;
    grid.appendChild(el('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v) }));
    const t = el('text', { x: padL - 6, y: y(v) + 3, 'text-anchor': 'end', class: 'ax' }); t.textContent = v; svg.appendChild(t);
  }
  svg.insertBefore(grid, svg.firstChild.nextSibling);
  if (days.length) {
    const pts = days.map((d, i) => [x(i), y(d.count)]);
    // Плавная линия: кривые Безье через середины отрезков.
    let dLine = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i += 1) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], mx = (x0 + x1) / 2;
      dLine += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
    }
    svg.appendChild(el('path', { d: `${dLine} L ${pts[pts.length - 1][0]} ${y(0)} L ${pts[0][0]} ${y(0)} Z`, class: 'area' }));
    svg.appendChild(el('path', { d: dLine, class: 'lineP' }));
    const fmtDay = (ms) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
    [0, days.length - 1].forEach((i, k) => {
      const t = el('text', { x: x(i), y: H - 4, 'text-anchor': k ? 'end' : 'start', class: 'ax' }); t.textContent = fmtDay(days[i].date); svg.appendChild(t);
    });
    const last = pts[pts.length - 1];
    svg.appendChild(el('circle', { cx: last[0], cy: last[1], r: 3.5, class: 'dotP' }));
    // Наведение: вертикальная линия и подсказка ближайшего дня.
    const hov = el('line', { y1: padT, y2: H - padB, class: 'hov', visibility: 'hidden' });
    const hdot = el('circle', { r: 3.5, class: 'dotP', visibility: 'hidden' });
    svg.append(hov, hdot);
    const tip = document.createElement('div'); tip.className = 'chart__tip hidden';
    box.append(svg, tip);
    svg.addEventListener('mousemove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(days.length - 1, Math.round(((px - padL) / (W - padL - padR)) * (days.length - 1))));
      hov.setAttribute('x1', pts[i][0]); hov.setAttribute('x2', pts[i][0]); hov.setAttribute('visibility', 'visible');
      hdot.setAttribute('cx', pts[i][0]); hdot.setAttribute('cy', pts[i][1]); hdot.setAttribute('visibility', 'visible');
      tip.textContent = ''; const b = document.createElement('b'); b.textContent = fmt(days[i].count);
      tip.append(b, document.createTextNode(` · ${fmtDay(days[i].date)}`));
      tip.style.left = `${(pts[i][0] / W) * 100}%`; tip.style.top = `${(pts[i][1] / H) * 100}%`;
      tip.classList.remove('hidden');
    });
    svg.addEventListener('mouseleave', () => { hov.setAttribute('visibility', 'hidden'); hdot.setAttribute('visibility', 'hidden'); tip.classList.add('hidden'); });
  } else box.appendChild(svg);
  if (!total) {
    const e = document.createElement('div'); e.className = 'chart__empty';
    e.textContent = 'Здесь появится график, как только автопилот отправит первые отклики.';
    box.appendChild(e);
  }
}
// Высота графика тянется вслед за соседней колонкой — перерисовываем по размеру блока.
new ResizeObserver(() => { if (lastDays.length) drawChart(); }).observe($('chart'));

// Домен портфолио выводим из ссылки, а не спрашиваем вторым полем: он нужен только
// внутри, как ключ для починки ссылки в готовом письме. Копия разбора из
// packages/automation-core/src/portfolioLink.js — рендерер изолирован от Node.
function parsePortfolioLink(input) {
  const raw = String(input || '').trim();
  if (!raw) return undefined;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try { url = new URL(withScheme); } catch { return undefined; }
  if (!url.hostname.includes('.')) return undefined;
  const domain = url.hostname.replace(/^www\./i, '');
  return { domain, canonical: domain + url.pathname.replace(/\/+$/, '') };
}

// Свежие строки — сверху, как во всех вкладках ленты. Раньше журнал рос вниз и
// прокручивался к последней строке. Если человек пролистал вниз и читает старое,
// withStableScroll держит его место. Время у строки — иначе в обратном порядке
// непонятно, где «сейчас». Журнал не бесконечный: старые строки уходят снизу.
const LOG_MAX_LINES = 1500;
function appendLog(line, at) {
  const feed = $('log-feed');
  $('log-empty')?.remove();
  const el = document.createElement('div');
  el.className = 'log-line';
  const time = document.createElement('span');
  time.className = 'log-line__time';
  time.textContent = new Date(at || Date.now()).toLocaleTimeString('ru-RU');
  el.append(time, document.createTextNode(line));
  withStableScroll(() => {
    feed.prepend(el);
    while (feed.children.length > LOG_MAX_LINES) feed.lastElementChild.remove();
  });
}

// Карточки — в порядке, в каком их отдала база: свежие сверху. Новые раньше
// дописывались в конец списка. Переставляем, только если порядок разошёлся:
// лишний перенос узла сбил бы фокус в поле ответа.
function orderCards(list, cards) {
  const current = [...list.children].filter((el) => cards.includes(el));
  if (current.length === cards.length && current.every((el, i) => el === cards[i])) return;
  for (const card of cards) list.appendChild(card);
}

// «Сменить пользователя» в трее — тот же результат, что и кнопка выхода в окне.
window.otkliks.onSignedOut((reason) => {
  tenant = null;
  profileBase = null;
  showAuth();
  // Выкинуло не по кнопке «Выйти», а потому что сессию не вернуть, — говорим почему.
  if (reason) { $('login-error').textContent = reason; $('login-error').classList.remove('hidden'); }
});
// --- Лента событий ---
// Раньше события автопилота вообще не показывались: onEvent только обновлял цифры,
// а в «Журнале» шли сырые технические строки. Теперь каждое событие — понятная
// карточка, а системные окна Windows больше не всплывают (см. main/notifier.js).
const OUTCOME_TEXT = {
  interview: { title: 'Пригласили на собеседование', pill: 'Собеседование', kind: 'win' },
  rejection: { title: 'Отказ', pill: 'Отказ', kind: 'bad' },
  question: { title: 'Уточняющий вопрос от работодателя', pill: 'Вопрос', kind: 'reply' },
  other: { title: 'Ответ работодателя', pill: 'Ответ работодателя', kind: 'reply' },
};

function describeEvent(e) {
  // Собираем только из непустого: пустая компания раньше давала «— null» прямо в ленте.
  const where = [e.title, e.company]
    .map((s) => (s === null || s === undefined ? '' : String(s).trim()))
    .filter((s) => s && s !== 'null' && s !== 'undefined')
    .join(' — ');
  if (e.type === 'applied') {
    return {
      kind: 'applied', title: 'Отклик отправлен', sub: where, url: e.url,
      // Письмо прячем под раскрытие: в ленте важен факт, а текст нужен, когда человек
      // захочет проверить, что именно ушло от его имени.
      detail: e.details ? { label: 'Сопроводительное письмо', text: e.details } : null,
    };
  }
  if (e.type === 'reply') {
    return {
      kind: 'reply', title: 'Ответили в чате', sub: where, url: e.url,
      detail: {
        label: 'Переписка',
        text: [e.incoming ? `Работодатель:\n${humanizeMessageText(e.incoming)}` : '', e.message ? `Мы:\n${humanizeMessageText(e.message)}` : '']
          .filter(Boolean).join('\n\n'),
      },
    };
  }
  if (e.type === 'form') {
    const n = (e.fields || []).length;
    // Новые события: title — вакансия, formTitle — анкета. Старые: в title лежало
    // название анкеты, вакансии не было — показываем анкету и компанию, без дублей.
    const formName = e.formTitle || e.title || 'Анкета работодателя';
    const vacancy = e.formTitle ? where : String(e.company || '').trim();
    return {
      kind: 'good',
      tag: 'Заполнение формы',
      title: 'Форма заполнена и отправлена',
      sub: [formName, vacancy].filter(Boolean).join(' · '),
      url: e.url,
      linkLabel: 'Открыть форму',
      // Статус 100% достоверный: событие приходит ТОЛЬКО когда движок увидел
      // подтверждение отправки формы («Ответ записан»). Не подтвердилось = события нет.
      status: 'Отправлено',
      detail: {
        label: n ? `Вопросы и ответы (${n})` : 'Анкета отправлена',
        fields: e.fields || [],
        // Раскрыто по умолчанию — все вопросы-ответы сразу на виду, от начала до конца.
        open: true,
      },
    };
  }
  if (e.type === 'interview_invite') {
    return {
      kind: 'win',
      tag: '🎉 Приглашение',
      title: 'Приглашают на созвон / собеседование',
      sub: where,
      url: e.url,
      linkLabel: 'Открыть переписку',
      status: 'Слово за вами',
      detail: e.incoming ? { label: 'Что написал работодатель', text: humanizeMessageText(e.incoming) } : null,
    };
  }
  if (e.type === 'outcome') {
    const o = OUTCOME_TEXT[e.outcome] || OUTCOME_TEXT.other;
    // Раньше без url — название вакансии у исходов не было кликабельным, хотя у
    // остальных событий (отклик/ответ/приглашение) ссылка уже подставляется ниже.
    // Раскрывается перепиской: что написал работодатель и что мы ответили. Ответ — из
    // локальной базы при раскрытии (см. negotiation:tail): в событии его нет.
    const chatId = (String(e.url || '').match(/\/chat\/(\d+)/) || [])[1];
    return {
      kind: o.kind, title: o.title, sub: where, url: e.url, linkLabel: 'Открыть переписку',
      detail: chatId || e.incoming ? { label: 'Переписка', text: e.incoming || ' ', chatId } : null,
    };
  }
  return { kind: 'alert', title: 'Требуется внимание', sub: e.message || '' };
}

// Машинное имя поля вместо вопроса («task_380806266_text») — так записаны анкеты до
// 1.0.8, когда подпись поля не находилась. Текста вопроса в них нет — хотя бы по-людски.
function humanQuestion(q, i) {
  const s = String(q || '').trim();
  // До 1.0.23 подписью поля анкеты hh бывала подсказка из самого поля («Писать тут») —
  // вопроса в таких записях нет.
  const generic = /^(?:писать тут|пишите тут|ваш ответ|ответ|введите(?: текст| ответ| значение)?|напишите(?: ответ| здесь| тут)?|текст|комментарий|сообщение)[.…:]*$/i;
  return !s || generic.test(s) || (/^[\w-]+$/.test(s) && /\d{4,}/.test(s)) ? `Вопрос анкеты ${i + 1}` : s;
}

// Наружу — чтобы проверочный прогон мог отрисовать ленту теми же карточками, что и
// живое приложение, а не собственной копией разметки.
window.__pushEvent = (e) => pushEvent(e);

// Настройки → Уведомления. Приглашения на созвон и вопросы, требующие ответа, всегда
// видны отдельным закреплённым блоком (см. renderInvites/renderClarifications) — эти
// два тумблера управляют только обычной лентой «Что происходит».
let notificationPrefs = { alerts: true, forms: true };

// Короткие подписи для «пилюли» статуса в таблице.
const PILL_TEXT = {
  applied: 'Отклик отправлен', reply: 'Ответили в чате', good: 'Анкета заполнена',
  win: 'Приглашение', bad: 'Отказ', alert: 'Внимание',
};

function pushEvent(e) {
  if (e.type === 'alert' && !notificationPrefs.alerts) return;
  if (e.type === 'form' && !notificationPrefs.forms) return;

  const feed = $('feed');
  $('feed-empty')?.remove();

  const { kind, title, url, detail, linkLabel } = describeEvent(e);
  const row = document.createElement('div');
  row.className = 'ev ev--row is-new';
  row.tabIndex = 0;

  const time = document.createElement('time');
  time.textContent = new Date(e.at || Date.now()).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  const pill = document.createElement('span');
  pill.className = `pill pill--${kind}`;
  pill.textContent = e.type === 'outcome' ? (OUTCOME_TEXT[e.outcome] || OUTCOME_TEXT.other).pill : (PILL_TEXT[kind] || title);
  pill.title = title;

  // Что и где: вакансия — компания. Название кликабельно, если есть ссылка (откроется
  // во внешнем браузере — обычный переход увёл бы окно лаунчера на hh.ru).
  const what = document.createElement('div');
  what.className = 'ev__what';
  const clean = (v) => { const t = v === null || v === undefined ? '' : String(v).trim(); return t === 'null' || t === 'undefined' ? '' : t; };
  let head = clean(e.title) || title;
  let tail = clean(e.company);
  if (e.type === 'form') {
    // Новые события: title — вакансия, formTitle — анкета; старые — только анкета.
    const formName = clean(e.formTitle) || clean(e.title) || 'Анкета работодателя';
    head = e.formTitle ? (clean(e.title) || formName) : formName;
    tail = [clean(e.company), e.formTitle ? formName : ''].filter(Boolean).join(' · ');
  } else if (e.type === 'alert') { head = clean(e.message) || title; tail = ''; }
  const b = document.createElement('b'); b.textContent = head;
  const sm = document.createElement('small'); sm.textContent = tail;
  if (url) {
    const a = document.createElement('a'); a.href = '#'; a.title = 'Открыть на hh.ru';
    a.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); window.otkliks.openExternal(url); });
    a.append(b, sm); what.appendChild(a);
  } else what.append(b, sm);

  const chev = document.createElement('span');
  chev.className = 'ev__chev';
  const hasDetail = detail && (detail.text || (detail.fields && detail.fields.length));
  if (hasDetail) chev.appendChild(svgUse('i-chev'));

  row.append(time, pill, what, chev);

  // Подробности — письмо, переписка, ответы анкеты — раскрываются по клику на строку.
  let det = null;
  if (hasDetail) {
    det = document.createElement('div');
    det.className = 'detail hidden';
    const label = document.createElement('div'); label.className = 'detail__label'; label.textContent = detail.label;
    det.appendChild(label);
    if (detail.fields) {
      const list = document.createElement('div'); list.className = 'qa-list';
      detail.fields.forEach((f, i) => {
        const r = document.createElement('div'); r.className = 'qa-row';
        const q = document.createElement('div'); q.className = 'qa-q'; q.textContent = humanQuestion(f.question, i);
        const a = document.createElement('div'); a.className = 'qa-a'; a.textContent = f.answer;
        r.append(q, a); list.appendChild(r);
      });
      det.appendChild(list);
    } else if (e.type === 'reply') {
      // Переписка — пузырями, как в мессенджере: сразу видно, кто что сказал.
      const chat = document.createElement('div'); chat.className = 'detail__chat';
      if (e.incoming) chat.appendChild(messageBlock('employer', e.incoming));
      if (e.message) chat.appendChild(messageBlock('me', e.message));
      det.appendChild(chat);
    } else if (e.type === 'outcome') {
      const chat = document.createElement('div'); chat.className = 'detail__chat';
      chat.appendChild(Object.assign(document.createElement('div'), { className: 'detail__note', textContent: 'Загружаю переписку…' }));
      det.appendChild(chat);
      det.dataset.lazy = '1';
      det.__fill = async () => {
        const tail = await window.otkliks.negotiationTail(detail.chatId, e.incoming || null).catch(() => null);
        chat.textContent = '';
        const employer = tail && tail.employer.length ? tail.employer : (e.incoming ? [{ text: e.incoming, author: '' }] : []);
        splitHistory(employer.map((m) => ({ ...m, from: 'employer' })))
          .forEach((m) => chat.appendChild(messageBlock('employer', m.text, m.author)));
        if (tail && tail.reply) chat.appendChild(messageBlock('me', tail.reply));
        const note = !employer.length ? 'Текста сообщения в локальной переписке нет — откройте её на hh.ru.'
          : tail && tail.reply ? ''
            : tail && tail.waiting ? 'Мы не ответили: вопрос ждёт вас в «Нужен ваш ответ».'
              : 'Ответа в переписке пока нет.';
        if (note) chat.appendChild(Object.assign(document.createElement('div'), { className: 'detail__note', textContent: note }));
      };
    } else {
      const t = document.createElement('div'); t.className = 'detail__text'; t.textContent = detail.text;
      det.appendChild(t);
    }
    if (url && linkLabel) {
      const l = document.createElement('button'); l.type = 'button'; l.className = 'btn btn--line btn--xs detail__link';
      l.textContent = linkLabel; l.addEventListener('click', () => window.otkliks.openExternal(url));
      det.appendChild(l);
    }
    const toggle = () => {
      const open = det.classList.toggle('hidden') === false;
      row.classList.toggle('is-open', open);
      if (open && det.dataset.lazy === '1') { det.dataset.lazy = ''; det.__fill(); }
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
    if (detail.open && e.type === 'form') { /* анкеты раскрываем по клику, как остальное */ }
  }

  // Свежее сверху; withStableScroll — чтобы вставка не сдвигала то, что человек читает.
  withStableScroll(() => {
    if (det) feed.prepend(det);
    feed.prepend(row);
    // Больше двух сотен строк держать незачем — история есть на сайте.
    while (feed.querySelectorAll('.ev--row').length > 200) {
      const lastRow = [...feed.querySelectorAll('.ev--row')].pop();
      if (lastRow.nextElementSibling?.classList.contains('detail')) lastRow.nextElementSibling.remove();
      lastRow.remove();
    }
  });
  setTimeout(() => row.classList.remove('is-new'), 1200);
}

window.otkliks.onLog(({ line, at }) => appendLog(line, at));
// Живой push оставляем как «мгновенный» путь, НО фид синхронизируется ещё и опросом
// сервера (см. syncFeed) — это и есть надёжный «стриминг». Push иногда не доезжает
// (главный процесс мог отправить в невидимый/пересозданный webContents), а опрос идёт
// по тому же каналу, что и история, который работает всегда. Дедуп по id не даёт
// задвоения, если push всё-таки сработал (у live-события своего id нет — оно получит
// синтетический ключ, а серверная копия придёт со своим id уже как «новая», поэтому
// от push к ленте НЕ добавляем, только обновляем цифры; ленту ведёт syncFeed).
window.otkliks.onEvent(() => { refreshStats(); });

// --- Init ---

(async function init() {
  tenant = await window.otkliks.session();
  if (tenant) {
    renderAll();
    showApp();
    switchPanel('overview');
    refreshStats();
    refreshAutomationStatus();
    syncFeed();
    renderInvites();
    renderClarifications();
    renderExclusions();
    renderBlacklist();
    // Живой «стриминг» ленты: тем же надёжным каналом, что и история, опрашиваем
    // сервер каждые 8 секунд и дорисовываем новые события. Так «Что происходит»
    // обновляется во время работы, а не только после перезапуска.
    setInterval(syncFeed, 8000);
    // Блок приглашений берём из локальной БиД (переживает перезапуск) — обновляем реже.
    setInterval(renderInvites, 20000);
    setInterval(renderClarifications, 20000);
  } else {
    showAuth();
  }
  setInterval(refreshStats, 30000);
})();

function buildInviteCard(inv) {
  const row = document.createElement('div');
  row.className = 'inv';
  // Название вакансии — тоже ссылка на переписку (та же цель, что и у кнопки).
  const chatUrl = inv.negotiationId ? `https://chatik.hh.ru/chat/${inv.negotiationId}` : null;
  const what = document.createElement('div');
  what.className = 'inv__what';
  const b = document.createElement('b'); b.textContent = inv.vacancyTitle || 'Приглашение на созвон';
  const sm = document.createElement('small'); sm.textContent = inv.company || '';
  if (chatUrl) {
    const a = document.createElement('a'); a.href = '#'; a.title = 'Открыть переписку на hh.ru';
    a.addEventListener('click', (ev) => { ev.preventDefault(); window.otkliks.openExternal(chatUrl); });
    a.append(b, sm); what.appendChild(a);
  } else what.append(b, sm);
  const d = document.createElement('time');
  d.textContent = inv.at ? new Date(inv.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const open = document.createElement('button');
  open.className = 'btn btn--line btn--xs';
  open.type = 'button';
  open.textContent = 'Открыть переписку';
  open.addEventListener('click', () => { if (chatUrl) window.otkliks.openExternal?.(chatUrl); });
  const acts = document.createElement('div');
  acts.className = 'row-acts';
  acts.appendChild(threadMenu(inv.negotiationId, {
    gone: () => removeInviteCard(inv),
    remove: async () => {
      const ok = await confirmDialog({ title: 'Вы действительно хотите удалить?', text: 'Приглашение пропадёт из списка. Переписка на hh.ru останется как есть.' });
      if (!ok) return;
      await window.otkliks.interviewHide?.(inv.negotiationId);
      removeInviteCard(inv);
    },
  }));
  row.append(what, d, open, acts);
  return row;
}

function removeInviteCard(inv) {
  const key = inviteKey(inv);
  const card = inviteCards.get(key);
  if (card) withStableScroll(() => card.remove());
  inviteCards.delete(key);
  const empty = $('invites-empty');
  if (empty && !inviteCards.size) empty.hidden = false;
  refreshBadge('invites', [...inviteCards.keys()]);
}

// --- Кнопки-значки и подтверждение ---
function iconButton(icon, title, onClick, tone = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `icon-btn${tone ? ` icon-btn--${tone}` : ''}`;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.appendChild(svgUse(icon));
  b.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
  return b;
}

// Меню «⋯» у приглашения и вопроса работодателя: в исключения, в чёрный список, удалить.
function threadMenu(negotiationId, { gone, remove }) {
  const items = [];
  if (negotiationId) {
    items.push({ icon: 'i-chatoff', label: 'В исключения', hint: 'Переписку ведёте сами', onClick: () => excludeThread(negotiationId, gone) });
    items.push({ icon: 'i-ban', label: 'В чёрный список', hint: 'Компании больше не откликаемся', onClick: () => blacklistThread(negotiationId, gone) });
  }
  items.push({ icon: 'i-trash', label: 'Удалить', tone: 'danger', sep: items.length > 0, onClick: remove });
  return actionsMenu(items);
}

function refreshPinned() {
  renderInvites();
  renderClarifications();
  renderExclusions();
  renderBlacklist();
}

async function excludeThread(negotiationId, onDone) {
  const ok = await confirmDialog({
    title: 'Добавить в исключения?',
    text: 'Автопилот больше ничего не напишет этому работодателю: ни в эту переписку, ни откликом на его вакансии, ни анкетой. Дальше общаетесь вы сами. Убрать из исключений можно в любой момент.',
    ok: 'В исключения', tone: 'dark', icon: 'i-chatoff',
  });
  if (!ok) return;
  const res = await window.otkliks.exclusionAdd?.({ negotiationId });
  if (!res || !res.ok) return;
  onDone?.();
  refreshPinned();
}

async function blacklistThread(negotiationId, onDone) {
  const pv = await window.otkliks.blacklistPreview?.(negotiationId).catch(() => null);
  if (!pv) {
    await confirmDialog({ title: 'Не знаю, что это за компания', text: 'Добавьте её во вкладке «Чёрный список» — названием или ссылкой на работодателя.', ok: 'Понятно', tone: 'dark', icon: 'i-ban', cancel: false });
    return;
  }
  const r = await confirmDialog({
    title: `Добавить «${pv.company}» в чёрный список?`,
    text: 'Автопилот больше не откликается на вакансии этой компании и ничего не пишет ей в чатах.',
    ok: 'В чёрный список', tone: 'dark', icon: 'i-ban',
    check: { label: `И все компании со словом «${pv.word}» в названии` },
  });
  if (!r) return;
  const res = await window.otkliks.blacklistAdd?.({ negotiationId, broad: r.checked });
  if (!res || !res.ok) return;
  onDone?.();
  refreshPinned();
}

// Выпадающее меню действий. Позиция — fixed от кнопки: таблицы обрезают выпадающее по краю.
function actionsMenu(items) {
  const wrap = document.createElement('div');
  wrap.className = 'amenu';
  const list = document.createElement('div');
  list.className = 'amenu__list';
  list.setAttribute('role', 'menu');
  list.hidden = true;
  const outside = (ev) => { if (!wrap.contains(ev.target) && !list.contains(ev.target)) close(); };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  function close() {
    if (list.hidden) return;
    list.hidden = true;
    list.remove();
    wrap.classList.remove('is-open');
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
  }
  function open() {
    document.body.appendChild(list);
    list.hidden = false;
    const r = btn.getBoundingClientRect();
    const w = list.offsetWidth; const h = list.offsetHeight;
    const below = r.bottom + 6 + h <= window.innerHeight - 8;
    list.style.left = `${Math.max(8, r.right - w)}px`;
    list.style.top = `${below ? r.bottom + 6 : r.top - 6 - h}px`;
    list.classList.toggle('is-up', !below);
    wrap.classList.add('is-open');
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    list.querySelector('button')?.focus();
  }
  const btn = iconButton('i-more', 'Действия', () => (list.hidden ? open() : close()));
  btn.setAttribute('aria-haspopup', 'menu');
  for (const it of items) {
    if (it.sep) list.appendChild(Object.assign(document.createElement('div'), { className: 'amenu__sep' }));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `amenu__item${it.tone ? ` amenu__item--${it.tone}` : ''}`;
    b.setAttribute('role', 'menuitem');
    const text = document.createElement('span');
    text.className = 'amenu__text';
    text.append(Object.assign(document.createElement('b'), { textContent: it.label }));
    if (it.hint) text.append(Object.assign(document.createElement('small'), { textContent: it.hint }));
    b.append(svgUse(it.icon), text);
    b.addEventListener('click', (ev) => { ev.stopPropagation(); close(); it.onClick(); });
    list.appendChild(b);
  }
  wrap.appendChild(btn);
  return wrap;
}

// Окно «Вы действительно…?» поверх интерфейса. Фокус — на «Отмена»: случайный Enter не
// удалит; Esc и клик мимо окна — тоже отмена.
function confirmDialog({ title, text, ok = 'Удалить', tone = 'danger', icon = 'i-trash', check = null, cancel: withCancel = true }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    const m = document.createElement('div');
    m.className = 'modal modal--confirm';
    m.setAttribute('role', 'alertdialog');
    m.setAttribute('aria-modal', 'true');
    const ico = document.createElement('span');
    ico.className = `modal__ico${tone === 'danger' ? ' modal__ico--danger' : ''}`;
    ico.appendChild(svgUse(icon));
    const h = document.createElement('h2'); h.textContent = title;
    const p = document.createElement('p'); p.textContent = text;
    const actions = document.createElement('div'); actions.className = 'modal__actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn--line'; cancel.textContent = 'Отмена';
    const yes = document.createElement('button'); yes.type = 'button'; yes.className = `btn ${tone === 'danger' ? 'btn--danger' : 'btn--dark'}`; yes.textContent = ok;
    if (withCancel) actions.append(cancel);
    actions.append(yes);
    m.append(ico, h, p);
    // Галочка в окне (чёрный список: «и всё связанное по названию») — по умолчанию выключена.
    let box = null;
    if (check) {
      const label = document.createElement('label'); label.className = 'check modal__check';
      box = document.createElement('input'); box.type = 'checkbox'; box.checked = !!check.checked;
      label.append(box, Object.assign(document.createElement('span'), { textContent: check.label }));
      m.appendChild(label);
    }
    m.appendChild(actions);
    back.appendChild(m);
    const onKey = (ev) => { if (ev.key === 'Escape') close(false); };
    function close(v) { document.removeEventListener('keydown', onKey); back.remove(); resolve(v); }
    cancel.addEventListener('click', () => close(false));
    yes.addEventListener('click', () => close(check ? { checked: !!box?.checked } : true));
    back.addEventListener('mousedown', (ev) => { if (ev.target === back) close(false); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    (withCancel ? cancel : yes).focus();
  });
}

// --- Чёрный список ---
async function renderBlacklist() {
  const list = $('bl-list');
  if (!list) return;
  let items = [];
  try { items = (await window.otkliks.blacklistList?.()) || []; } catch { items = []; }
  const badge = $('badge-bl');
  if (badge) { badge.textContent = String(items.length); badge.classList.toggle('hidden', !items.length); }
  $('bl-empty').hidden = items.length > 0;
  list.textContent = '';
  for (const x of items) {
    const row = document.createElement('div');
    row.className = 'excl';
    const what = document.createElement('div'); what.className = 'inv__what';
    const b = document.createElement('b'); b.textContent = x.company;
    const sm = document.createElement('small');
    sm.textContent = x.broad ? `Все компании со словом «${x.word}»` : 'Только эта компания';
    if (x.url) {
      const a = document.createElement('a'); a.href = '#'; a.title = 'Открыть на hh.ru';
      a.addEventListener('click', (ev) => { ev.preventDefault(); window.otkliks.openExternal(x.url); });
      a.append(b, sm); what.appendChild(a);
    } else what.append(b, sm);
    const d = document.createElement('time');
    d.textContent = new Date(x.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const acts = document.createElement('div'); acts.className = 'row-acts';
    acts.appendChild(iconButton('i-trash', 'Убрать из чёрного списка', async () => {
      const ok = await confirmDialog({
        title: 'Убрать из чёрного списка?',
        text: `Автопилот снова сможет откликаться на вакансии «${x.company}» и отвечать ей в чатах.`,
        ok: 'Убрать',
      });
      if (!ok) return;
      await window.otkliks.blacklistRemove?.(x.id);
      renderBlacklist();
    }, 'danger'));
    row.append(what, d, acts);
    list.appendChild(row);
  }
}

// Подсказка под полем: по какому слову будет искать «всё связанное».
async function updateBlacklistWord() {
  const t = $('bl-text')?.value.trim() || '';
  const el = $('bl-word');
  if (!el) return;
  if (!t || /^https?:|hh\.(ru|kz|uz|by)\//i.test(t) || !$('bl-broad').checked) { el.textContent = ''; return; }
  const w = await window.otkliks.blacklistWord?.(t).catch(() => '');
  el.textContent = w ? `— всё со словом «${w}»` : '';
}
$('bl-text')?.addEventListener('input', updateBlacklistWord);
$('bl-broad')?.addEventListener('change', updateBlacklistWord);

$('bl-form')?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = $('bl-text');
  const msg = $('bl-msg');
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  const btn = ev.submitter || $('bl-form').querySelector('button');
  btn.disabled = true;
  const res = await window.otkliks.blacklistAdd?.({ text, broad: $('bl-broad').checked }).catch(() => null);
  btn.disabled = false;
  msg.classList.remove('hidden', 'is-error', 'is-ok');
  if (res && res.ok) {
    const x = res.entry || {};
    msg.classList.add('is-ok');
    msg.textContent = x.broad ? `Готово: «${x.company}» и все компании со словом «${x.word}» — в чёрном списке.` : `Готово: «${x.company}» в чёрном списке.`;
    input.value = '';
    $('bl-broad').checked = false;
    updateBlacklistWord();
    renderBlacklist();
  } else {
    msg.classList.add('is-error');
    msg.textContent = (res && res.error) || 'Не получилось добавить — проверьте название или ссылку.';
  }
});

// --- Исключения ---
async function renderExclusions() {
  const list = $('excl-list');
  if (!list) return;
  let items = [];
  try { items = (await window.otkliks.exclusionsList?.()) || []; } catch { items = []; }
  const badge = $('badge-excl');
  if (badge) { badge.textContent = String(items.length); badge.classList.toggle('hidden', !items.length); }
  $('excl-empty').hidden = items.length > 0;
  list.textContent = '';
  for (const x of items) {
    const row = document.createElement('div');
    row.className = 'excl';
    const what = document.createElement('div'); what.className = 'inv__what';
    const b = document.createElement('b');
    b.textContent = x.company || x.title || (x.vacancyId ? `Вакансия ${x.vacancyId}` : `Переписка ${x.negotiationId}`);
    const sm = document.createElement('small');
    sm.textContent = x.company ? (x.title || '') : (x.title ? '' : 'Работодатель неизвестен — исключена вакансия и её переписка');
    if (x.url) {
      const a = document.createElement('a'); a.href = '#'; a.title = 'Открыть на hh.ru';
      a.addEventListener('click', (ev) => { ev.preventDefault(); window.otkliks.openExternal(x.url); });
      a.append(b, sm); what.appendChild(a);
    } else what.append(b, sm);
    const d = document.createElement('time');
    d.textContent = new Date(x.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const acts = document.createElement('div'); acts.className = 'row-acts';
    acts.appendChild(iconButton('i-trash', 'Убрать из исключений', async () => {
      const ok = await confirmDialog({
        title: 'Убрать из исключений?',
        text: 'Автопилот снова сможет писать этому работодателю: отвечать в переписке и откликаться на его вакансии.',
        ok: 'Убрать',
      });
      if (!ok) return;
      await window.otkliks.exclusionRemove?.(x.id);
      renderExclusions();
    }, 'danger'));
    row.append(what, d, acts);
    list.appendChild(row);
  }
}

$('excl-form')?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = $('excl-link');
  const msg = $('excl-msg');
  const link = input.value.trim();
  if (!link) { input.focus(); return; }
  const res = await window.otkliks.exclusionAdd?.({ link }).catch(() => null);
  msg.classList.remove('hidden', 'is-error', 'is-ok');
  if (res && res.ok) {
    const x = res.exclusion || {};
    msg.classList.add('is-ok');
    msg.textContent = `Готово: ${x.company || x.title || 'вакансия'} — автопилот сюда больше не пишет.`;
    input.value = '';
    refreshPinned();
  } else {
    msg.classList.add('is-error');
    msg.textContent = (res && res.error) || 'Не получилось добавить — проверьте ссылку.';
  }
});

// 🎉 Закреплённый блок приглашений на созвон. Источник — ЛОКАЛЬНАЯ БД лаунчера
// (store.getInterviewInvites), поэтому блок не пропадает при перезапуске и не зависит
// от того, доехало ли событие до сервера. Решение о времени — за человеком; отсюда
// только переход в переписку.
//
// Раньше list.innerHTML='' + пересборка ВСЕХ карточек на каждый опрос (каждые 20с) —
// пока список не пуст, это стабильно приводило к тому, что скролл внутри блока
// прыгал в начало на каждый тик (высота контейнера на миг схлопывалась до нуля).
// Теперь — по id: существующие карточки не трогаем вообще, добавляем/убираем только
// реально изменившиеся.
const inviteCards = new Map(); // key -> card element
function inviteKey(inv) { return String(inv.negotiationId || inv.at); }
async function renderInvites() {
  const list = $('invites-list');
  const empty = $('invites-empty');
  if (!list) return;
  let invites = [];
  try { invites = (await window.otkliks.interviewInvites?.()) || []; } catch { invites = []; }
  if (empty) empty.hidden = invites.length > 0;

  // withStableScroll — приглашения стоят ВЫШЕ ленты на той же общей прокрутке
  // дашборда: появление новой карточки здесь иначе сдвигало бы вниз всё, что человек
  // читает в ленте под ними.
  withStableScroll(() => {
    const seenKeys = new Set(invites.map(inviteKey));
    for (const [key, card] of inviteCards) {
      if (!seenKeys.has(key)) { card.remove(); inviteCards.delete(key); }
    }
    for (const inv of invites) {
      const key = inviteKey(inv);
      if (inviteCards.has(key)) continue;
      const card = buildInviteCard(inv);
      inviteCards.set(key, card);
      list.appendChild(card);
    }
    orderCards(list, invites.map((inv) => inviteCards.get(inviteKey(inv))).filter(Boolean));
  });

  refreshBadge('invites', invites.map((i) => String(i.negotiationId || i.at)));
}

// 🙋 Закреплённый блок «нужен ваш ответ». Источник — ЛОКАЛЬНАЯ БД (как и приглашения):
// работодателю уже ушла честная фраза-мостик, диалог не брошен, но для содержательного
// ответа нужен факт, которого нет и не может быть в резюме. Ответ человека уходит через
// IPC, доставку работодателю берёт на себя следующий круг наблюдателя чатов (нужен живой
// браузер) — см. negotiationsWatcher.deliverPendingClarifications.
// Одна реплика переписки плашкой: метка отправителя + текст (с починкой склеенных слов).
// Имя отправителя. С 1.0.22 оно приходит отдельным полем author; в старых записях — и в
// событиях с сервера — приклеено к тексту: «НаталияТимофей Игоревич, здравствуйте!».
// Отрезаем его и пишем в шапке пузыря вместо «Работодатель». Известные имена из той же
// переписки отрезают и склейку со строчной буквой («Викторотлично»).
const BOT_AUTHORS = ['ИИ-помощник', 'Робот-рекрутер'];
const NOT_AUTHOR = /^(?:Здравствуйте|Добрый|Доброе|Привет|Спасибо|Благодарю|Благодарим|Уважаемый|Уважаемая|Коллеги|Хорошо|Отлично|Понял|Поняла|Понятно|Супер|Отказ|Собеседование|Приглашение|Отклик|Сегодня|Вчера|Подскажите|Скажите|Напишите|Расскажите)$/i;
function splitAuthor(text, author = '', known = []) {
  const t = String(text || '');
  if (author) return { author, text: t.startsWith(author) ? t.slice(author.length).trim() : t };
  for (const name of [...known, ...BOT_AUTHORS]) {
    if (name && t.length > name.length && t.startsWith(name)) return { author: name, text: t.slice(name.length).trim() };
  }
  const m = t.match(/^([А-ЯЁ][а-яё]{2,14})(?=[А-ЯЁ][а-яё])/);
  const self = String(tenant?.fullName || '').split(/\s+/).filter(Boolean);
  if (m && !NOT_AUTHOR.test(m[1]) && !self.includes(m[1])) return { author: m[1], text: t.slice(m[1].length) };
  return { author: '', text: t };
}
// Вся переписка разом: имена, найденные в одних сообщениях, отрезаются и в других.
function splitHistory(messages) {
  const first = (messages || []).map((m) => (m.from === 'employer' ? splitAuthor(m.text, m.author) : { author: '', text: m.text }));
  const known = [...new Set(first.map((x) => x.author).filter(Boolean))];
  return (messages || []).map((m, i) => (m.from === 'employer' && !first[i].author ? splitAuthor(m.text, '', known) : first[i]));
}

function messageBlock(from, text, author) {
  const mine = from !== 'employer';
  const split = mine ? { author: '', text } : (author === undefined ? splitAuthor(text) : { author, text });
  const block = document.createElement('div');
  block.className = `msg ${mine ? 'msg--me' : 'msg--employer'}`;
  const who = document.createElement('div');
  who.className = 'msg__who';
  who.textContent = mine ? 'Вы' : (split.author || 'Работодатель');
  const body = document.createElement('div');
  body.className = 'msg__text';
  // Метка статуса hh, приклеенная к письму («ОтказТимофей…»), — отдельной строкой.
  body.textContent = humanizeMessageText(String(split.text || '').replace(/^(Отказ|Собеседование|Приглашение)(?=[А-ЯЁ])/, '$1\n'));
  block.appendChild(who);
  block.appendChild(body);
  return block;
}

function buildClarificationCard(c, { onAnswered }) {
  const card = document.createElement('div');
  card.className = 'clarification';

  // Название вакансии — ссылка на переписку на hh.ru (c.url — адрес именно этого
  // треда, см. negotiationsWatcher.js/createClarification): попросили, чтобы можно
  // было сразу открыть чат и ответить самому, а не искать вручную среди вакансий.
  const title = document.createElement(c.url ? 'a' : 'div');
  title.className = c.url ? 'clarification__title clarification__title--link' : 'clarification__title';
  title.textContent = [c.vacancyTitle, c.company].filter(Boolean).join(' — ') || 'Вопрос от работодателя';
  if (c.url) {
    title.href = '#';
    title.title = 'Открыть переписку на hh.ru';
    title.addEventListener('click', (ev) => { ev.preventDefault(); window.otkliks.openExternal(c.url); });
  }
  const head = document.createElement('div');
  head.className = 'clarification__head';
  const acts = document.createElement('div');
  acts.className = 'row-acts';
  acts.appendChild(threadMenu(c.negotiationId, {
    gone: onAnswered,
    remove: async () => {
      const ok = await confirmDialog({
        title: 'Вы действительно хотите удалить?',
        text: 'Вопрос пропадёт из «Нужен ваш ответ», работодателю ничего не уйдёт. По этому сообщению автопилот его больше не задаст.',
      });
      if (!ok) return;
      const res = await window.otkliks.clarificationDismiss?.(c.id);
      if (res && res.ok) onAnswered();
    },
  }));
  head.append(title, acts);
  card.appendChild(head);

  const question = document.createElement('div');
  question.className = 'clarification__question';
  // Старые вопросы (до 06.10.2026) несут приписку «Ответьте сами — …» — не показываем её.
  question.textContent = humanizeMessageText(String(c.question || '')
    .replace(/\s*Ответьте сами — здесь или прямо в чате hh\.?\s*$/, '')
    // В цитате сообщения («…: «НаталияТимофей…») — то же приклеенное имя.
    .replace(/«([^»]*)/, (all, q) => `«${splitAuthor(q).text}`));
  card.appendChild(question);

  // Полный контекст — вся переписка плашками (Работодатель / Вы), а не слитный текст.
  const history = document.createElement('div');
  history.className = 'clarification__history';
  const split = splitHistory(c.history || []);
  (c.history || []).forEach((m, i) => history.appendChild(messageBlock(m.from, split[i].text, split[i].author)));
  card.appendChild(history);

  const textarea = document.createElement('textarea');
  textarea.className = 'clarification__answer';
  textarea.placeholder = 'Ваш ответ';
  textarea.title = 'С галочкой ниже ИИ оформит ответ естественным сообщением; без неё уйдёт как есть';
  card.appendChild(textarea);

  const row = document.createElement('div');
  row.className = 'clarification__row';
  const improveLabel = document.createElement('label');
  improveLabel.className = 'clarification__improve';
  const improveCheckbox = document.createElement('input');
  improveCheckbox.type = 'checkbox';
  improveCheckbox.checked = true;
  const spark = svgUse('i-spark');
  spark.classList.add('improve__spark');
  improveLabel.append(improveCheckbox, spark, document.createTextNode('Улучшить ответ при помощи AI'));
  improveLabel.title = 'ИИ оформит ваш ответ естественным сообщением; без галочки уйдёт как есть';
  const submit = document.createElement('button');
  submit.className = 'btn btn--dark clarification__submit';
  submit.type = 'button';
  submit.textContent = 'Отправить работодателю';
  submit.addEventListener('click', async () => {
    const answerText = textarea.value.trim();
    if (!answerText) { textarea.focus(); return; }
    submit.disabled = true;
    submit.textContent = 'Отправляю…';
    try {
      await window.otkliks.clarificationsAnswer?.(c.id, answerText, improveCheckbox.checked);
      onAnswered();
    } catch {
      submit.disabled = false;
      submit.textContent = 'Отправить работодателю';
    }
  });
  row.appendChild(improveLabel);
  row.appendChild(submit);
  card.appendChild(row);

  return card;
}

// Раньше list.innerHTML='' + пересборка ВСЕХ карточек на каждый опрос (каждые 20с) —
// САМАЯ важная жалоба: если в этот момент человек печатал ответ в textarea, фокус и
// набранный текст стирались (textarea физически заменялась новым узлом), а скролл
// блока прыгал в начало (высота на миг схлопывалась до нуля при очистке). Теперь —
// по id: существующие карточки не трогаем вообще (в том числе ту, где сейчас курсор),
// добавляем/убираем только реально изменившиеся.
const clarificationCards = new Map(); // id -> card element
async function renderClarifications() {
  const list = $('clarifications-list');
  const empty = $('clar-empty');
  if (!list) return;
  let items = [];
  try { items = (await window.otkliks.clarificationsList?.()) || []; } catch { items = []; }
  if (empty) empty.hidden = items.length > 0;

  // withStableScroll — тот же резон, что и у приглашений: блок выше ленты на общей
  // прокрутке дашборда, появление/уход карточки не должно дёргать то, что ниже.
  withStableScroll(() => {
    const seenIds = new Set(items.map((c) => String(c.id)));
    for (const [id, card] of clarificationCards) {
      if (!seenIds.has(id)) { card.remove(); clarificationCards.delete(id); }
    }
    for (const c of items) {
      const id = String(c.id);
      if (clarificationCards.has(id)) continue;
      const card = buildClarificationCard(c, {
        onAnswered: () => {
          withStableScroll(() => card.remove());
          clarificationCards.delete(id);
          if (empty && !list.children.length) empty.hidden = false;
          // Отвеченное больше не «непрочитанное».
          markSeen('clarifications');
        },
      });
      clarificationCards.set(id, card);
      list.appendChild(card);
    }
    orderCards(list, items.map((c) => clarificationCards.get(String(c.id))).filter(Boolean));
  });

  refreshBadge('clarifications', items.map((c) => String(c.id)));
}

// «Что происходит» ведём опросом сервера: он источник правды и по истории, и по
// новым событиям. Дедуп по id — одно и то же событие не добавляется дважды.
const shownFeedIds = new Set();
async function syncFeed() {
  try {
    const events = await window.otkliks.feedHistory?.();
    if (!Array.isArray(events) || !events.length) return;
    let added = 0;
    // Приходят старые → новые; pushEvent добавляет сверху, поэтому свежие окажутся
    // наверху. На первом проходе рисуем всё, дальше — только ещё не показанные.
    // Ключ дедупа — id события, а если его вдруг нет — состав события, чтобы одно и
    // то же не подрисовывалось на каждом тике.
    for (const e of events) {
      const key = e.id || `${e.type}|${e.title || ''}|${e.company || ''}|${e.at}`;
      if (shownFeedIds.has(key)) continue;
      shownFeedIds.add(key);
      pushEvent(e);
      added += 1;
    }
    if (added) refreshStats();
  } catch { /* сеть моргнула — попробуем на следующем тике */ }
}

/**
 * Согласие на автозаполнение внешних анкет.
 *
 * Спрашиваем один раз и явным окном: автопилот будет действовать от имени человека
 * на чужих сайтах, и включать такое молча нельзя. Ответ хранится в настройках
 * лаунчера, переключатель на вкладке «Настройки» меняет его в любой момент.
 */
async function initConsent() {
  const modal = $('consent-modal');
  const toggle = $('consent-toggle');
  if (!modal || !toggle || !window.otkliks.getConsent) return;

  const state = await window.otkliks.getConsent().catch(() => null);
  if (!state) return;

  toggle.checked = state.enabled;
  if (!state.decided) modal.classList.remove('hidden');

  const decide = async (enabled) => {
    modal.classList.add('hidden');
    toggle.checked = enabled;
    await window.otkliks.setConsent(enabled).catch(() => {});
  };

  $('consent-yes').onclick = () => decide(true);
  $('consent-no').onclick = () => decide(false);
  toggle.onchange = () => window.otkliks.setConsent(toggle.checked).catch(() => {});
}

async function initNotifications() {
  const alertsToggle = $('notify-alerts-toggle');
  const formsToggle = $('notify-forms-toggle');
  if (!alertsToggle || !formsToggle || !window.otkliks.getNotificationPrefs) return;

  const prefs = await window.otkliks.getNotificationPrefs().catch(() => null);
  if (prefs) {
    notificationPrefs = prefs;
    alertsToggle.checked = prefs.alerts;
    formsToggle.checked = prefs.forms;
  }

  const save = async () => {
    notificationPrefs = await window.otkliks.setNotificationPrefs({
      alerts: alertsToggle.checked, forms: formsToggle.checked,
    }).catch(() => notificationPrefs);
  };
  alertsToggle.onchange = save;
  formsToggle.onchange = save;
}

function initPasswordChange() {
  const btn = $('password-submit-btn');
  const status = $('password-status');
  if (!btn || !window.otkliks.changePassword) return;

  btn.onclick = async () => {
    const currentPassword = $('password-current').value;
    const newPassword = $('password-new').value;
    if (newPassword.length < 8) {
      status.textContent = 'Новый пароль — минимум 8 символов.';
      status.style.color = 'var(--danger)';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Меняю…';
    status.style.color = '';
    const res = await window.otkliks.changePassword(currentPassword, newPassword).catch((e) => ({ ok: false, error: e.message }));
    btn.disabled = false;
    if (res.ok) {
      status.textContent = 'Пароль изменён.';
      status.style.color = 'var(--success)';
      $('password-current').value = '';
      $('password-new').value = '';
    } else {
      status.textContent = res.error || 'Не получилось сменить пароль.';
      status.style.color = 'var(--danger)';
    }
  };
}

/**
 * Аккаунты для анкет (Google, Яндекс).
 *
 * Часть форм работодателей открывается только авторизованным. Автопилот работает своим
 * профилем браузера, поэтому такие анкеты уходили человеку с пометкой «требует входа».
 * Здесь тот же приём, что и с hh.ru: разовый вход руками в видимом окне, дальше сессия
 * живёт в профиле и анкеты заполняются автоматически.
 */
let refreshAccounts = () => {};

function setupAccounts() {
  const services = [
    { key: 'google', label: 'Google' },
    { key: 'yandex', label: 'Яндекс' },
  ];

  const refreshers = [];
  for (const { key, label } of services) {
    const dot = $(`${key}-dot`);
    const state = $(`${key}-state`);
    const loginBtn = $(`${key}-login-btn`);
    const checkBtn = $(`${key}-check-btn`);
    if (!dot || !state || !loginBtn || !checkBtn) continue;

    const refresh = async () => {
      state.textContent = `${label} — проверяем…`;
      const res = await window.otkliks.accountStatus?.(key).catch(() => null);
      const ok = !!res?.loggedIn;
      dot.classList.toggle('on', ok);
      dot.classList.toggle('off', !ok);
      // Коротко в строке, подробности — по наведению.
      state.textContent = ok ? `${label} — подключён` : `${label} — не подключён`;
      state.title = ok ? 'Анкеты «для вошедших» заполним сами' : 'Анкеты, требующие входа, придут вам';
    };

    loginBtn.addEventListener('click', async () => {
      state.textContent = `${label} — войдите в открывшемся окне`;
      await window.otkliks.accountLogin?.(key).catch(() => {});
    });

    checkBtn.addEventListener('click', refresh);
    refreshers.push(refresh);
    refresh();
  }

  refreshAccounts = () => refreshers.forEach((fn) => fn());
}

/**
 * Автообновление в интерфейсе.
 *
 * Загрузка идёт в фоне (main-процесс), сюда прилетают события состояния. Пока качается —
 * показываем прогресс; когда готово — кнопку «Обновить и перезапустить». Ничего
 * скачивать руками человеку не нужно.
 */
function initUpdates() {
  const modal = $('update-modal');
  const bar = $('update-bar');
  const title = $('update-title');
  const sub = $('update-sub');
  const actions = $('update-actions');
  if (!modal || !window.otkliks.onUpdateState) return;

  let hiddenByUser = false;
  const render = (s) => {
    if (!s) return;
    if (s.phase === 'downloading') {
      if (hiddenByUser) return; // скрыли плашку — не возвращаем её на каждый процент
      modal.classList.remove('hidden');
      actions.style.display = 'none';
      title.textContent = `Обновление ${s.version || ''}`;
      sub.textContent = s.progress > 0 ? `Скачиваем в фоне — ${s.progress}%` : 'Скачиваем в фоне — работать это не мешает.';
      if (s.progress > 0) {
        bar.classList.remove('indeterminate');
        bar.style.width = `${s.progress}%`;
      } else {
        bar.classList.add('indeterminate');
      }
    } else if (s.phase === 'ready') {
      modal.classList.remove('hidden');
      bar.classList.remove('indeterminate');
      bar.style.width = '100%';
      title.textContent = `Версия ${s.version || ''} готова`;
      sub.textContent = 'Перезапуск займёт пару секунд — автопилот продолжит сам.';
      actions.style.display = 'flex';
    } else if (s.phase === 'error') {
      // Тихо прячем: обновление не критично, автопилот продолжает работать.
      modal.classList.add('hidden');
    }
  };

  window.otkliks.onUpdateState(render);
  window.otkliks.updateState?.().then(render).catch(() => {});

  $('update-apply-btn')?.addEventListener('click', () => {
    title.textContent = 'Устанавливаем…';
    sub.textContent = 'Лаунчер закроется и откроется уже обновлённым.';
    actions.style.display = 'none';
    bar.classList.add('indeterminate');
    window.otkliks.updateApply?.();
  });

  $('update-later-btn')?.addEventListener('click', () => modal.classList.add('hidden'));
  $('update-hide-btn')?.addEventListener('click', () => { hiddenByUser = true; modal.classList.add('hidden'); });
}
