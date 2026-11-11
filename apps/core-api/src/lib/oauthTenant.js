const crypto = require('crypto');
const Tenant = require('../models/Tenant');

// Поиск или создание арендатора по личности у внешнего провайдера (Яндекс, VK).
// Порт логики из Siberi (server/helpers/oauthUser.js) — там она обкатана на живых
// пользователях, включая случаи, о которых на бумаге не догадаешься.
//
// Порядок поиска важен и менять его нельзя:
//   1. по id провайдера — человек уже входил этим способом;
//   2. по почте — у него уже есть аккаунт с паролем, и вход через Яндекс нужно
//      ПРИВЯЗАТЬ к нему, а не заводить второй аккаунт на ту же почту (иначе
//      человек «теряет» свои отклики и не понимает, куда они делись);
//   3. только потом создаём нового.

/**
 * VK часто не отдаёт почту: пользователь мог не привязать её или не дать доступ.
 * Аккаунт всё равно нужен, поэтому подставляем техническую — по ней никто не
 * пишет, зато уникальность соблюдена и профиль работает. Человек потом укажет
 * настоящую почту в настройках.
 */
const SYNTHETIC_EMAIL_RE = /@oauth\.otkliks\.local$/i;

function syntheticEmail(provider, providerId) {
  return `${provider}_${providerId}@oauth.otkliks.local`;
}

/**
 * Адрес-заглушка, а не настоящая почта. Писать на него нельзя: домен .local
 * не существует в DNS, и каждая попытка — это отбитая отправка, которая портит
 * репутацию нашего отправителя у почтовых провайдеров. Проверено: Яндекс
 * отвергает такое письмо дважды (и HTML, и текстовый откат).
 */
function isSyntheticEmail(email) {
  return SYNTHETIC_EMAIL_RE.test(String(email || ''));
}

/** Через кого вошёл аккаунт без почты: 'VK' / 'Яндекс' — по префиксу заглушки. */
function syntheticProvider(email) {
  return /^yandex_/i.test(String(email || '')) ? 'Яндекс' : 'VK';
}

/**
 * Подпись аккаунта для админки: настоящая почта — как есть; заглушка — имя и
 * способ входа, чтобы вместо «vk_123@oauth.otkliks.local» было понятно, кто это.
 */
function accountLabel(t) {
  if (!t) return '—';
  if (!isSyntheticEmail(t.email)) return t.email || '—';
  return `${(t.fullName || '').trim() || 'Без имени'} · ${syntheticProvider(t.email)}, без почты`;
}

/**
 * Пароль у такого аккаунта не задан. Кладём в поле метку вместо хеша: логин по
 * паролю её никогда не примет (bcrypt.compare вернёт false на не-хеш), а по
 * префиксу видно, что аккаунт заведён через провайдера — на этом строится
 * подсказка «войдите через Яндекс» в форме входа.
 */
function oauthPasswordMarker(provider, providerId) {
  return `oauth:${provider}:${providerId}`;
}

function isOAuthOnly(passwordHash) {
  return typeof passwordHash === 'string' && passwordHash.startsWith('oauth:');
}

async function findOrCreateOAuthTenant({ provider, providerId, email, displayName }) {
  const field = `${provider}Id`;
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;

  // 1. Уже входил этим провайдером.
  let tenant = await Tenant.findOne({ [field]: providerId });
  if (tenant) {
    if (displayName && !tenant.fullName) {
      tenant.fullName = displayName;
      await tenant.save();
    }
    return { tenant, isNew: false };
  }

  // 2. Есть аккаунт с такой почтой — привязываем провайдера к нему.
  if (normalizedEmail) {
    tenant = await Tenant.findOne({ email: normalizedEmail });
    if (tenant) {
      tenant[field] = providerId;
      if (displayName && !tenant.fullName) tenant.fullName = displayName;
      await tenant.save();
      return { tenant, isNew: false };
    }
  }

  // 3. Новый.
  tenant = await Tenant.create({
    email: normalizedEmail || syntheticEmail(provider, providerId),
    passwordHash: oauthPasswordMarker(provider, providerId),
    fullName: displayName || '',
    [field]: providerId,
    // Согласие — нажатием «Войти через Яндекс/VK»: под кнопками прямо написано, что
    // это согласие на обработку ПД (ссылка на /consent). Редакция — та же, что в auth.js.
    consent: { at: new Date(), source: 'oauth', version: '2026-09-27' },
  });
  return { tenant, isNew: true };
}

// ── Одноразовый код для передачи сессии на сайт ─────────────────────────────
// Браузер после провайдера возвращается в core-api, а cookie сессии ставит
// marketing-site (он BFF и держит httpOnly-cookie). Гнать JWT через адресную
// строку нельзя: он осядет в истории браузера, в логах nginx и в заголовке
// Referer у любой внешней картинки на странице. Поэтому в URL уходит короткий
// одноразовый код, а сайт меняет его на токен server-to-server.
// ВАЖНО про масштабирование: и этот словарь, и PKCE-хранилище в routes/oauth.js
// живут в памяти ОДНОГО процесса. Сейчас core-api запущен в pm2 в режиме fork
// (один экземпляр), и это верно. Если когда-нибудь включить cluster/несколько
// инстансов, вход через провайдера начнёт ломаться через раз: колбэк обработает
// один воркер, а обмен кода придёт в другой, где записи нет. Тогда состояние
// нужно вынести в Redis или в отдельную коллекцию Mongo с TTL-индексом.
const exchangeCodes = new Map();
const CODE_TTL_MS = 2 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [code, rec] of exchangeCodes) if (rec.expiresAt < now) exchangeCodes.delete(code);
}, 30_000).unref();

function issueExchangeCode(payload) {
  const code = crypto.randomBytes(32).toString('base64url');
  exchangeCodes.set(code, { ...payload, expiresAt: Date.now() + CODE_TTL_MS });
  return code;
}

/** Код одноразовый: забрали — удалили, повторно тот же не сработает. */
function consumeExchangeCode(code) {
  const rec = exchangeCodes.get(code);
  if (!rec) return null;
  exchangeCodes.delete(code);
  if (rec.expiresAt < Date.now()) return null;
  return rec;
}

module.exports = {
  findOrCreateOAuthTenant,
  isOAuthOnly,
  isSyntheticEmail,
  syntheticProvider,
  accountLabel,
  issueExchangeCode,
  consumeExchangeCode,
};
