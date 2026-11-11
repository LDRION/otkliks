const crypto = require('crypto');
const express = require('express');
const { signTenantToken } = require('../lib/auth');
const { findOrCreateOAuthTenant, issueExchangeCode, consumeExchangeCode } = require('../lib/oauthTenant');
const { sendMail } = require('../lib/mailer');
const { welcomeEmail } = require('../lib/emailTemplates');
const { applyAcquisition, readCookies } = require('../lib/acquisition');
const { redeemPromo } = require('../lib/promo');

const router = express.Router();

// Вход через Яндекс и VK. Схема перенесена из Siberi (server/routes/oauth.js) —
// она отлажена на живых пользователях, и переписывать её с нуля значило бы
// заново собрать те же грабли. Отличия от оригинала только там, где отличается
// сама архитектура: Siberi отдаёт клиенту apiKey прямо в адресной строке, а у
// нас cookie ставит marketing-site, поэтому в URL уходит одноразовый код.

const SITE_URL = process.env.SITE_URL || 'https://otkliks.ru';
// Свой секрет, а не AUTH_SECRET: подпись state — отдельная задача, и если однажды
// придётся менять секрет сессий, вход через провайдера от этого ломаться не должен.
const STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.AUTH_SECRET || 'dev-oauth-state';

const STATE_TTL_MS = 10 * 60 * 1000;
const PKCE_TTL_MS = 5 * 60 * 1000;

// ── state: защита от CSRF ───────────────────────────────────────────────────
// Подписанная HMAC строка, внутри — провайдер, время и адрес возврата. Адрес
// кодируется base64url: в нём есть двоеточия, а разделитель тоже двоеточие.
function makeState(provider, returnTo = '') {
  const ts = Date.now().toString();
  const rd = Buffer.from(returnTo).toString('base64url');
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(`${provider}:${ts}:${rd}`).digest('hex').slice(0, 16);
  return Buffer.from(`${provider}:${ts}:${rd}:${sig}`).toString('base64url');
}

function verifyState(state, provider) {
  try {
    const parts = Buffer.from(String(state), 'base64url').toString().split(':');
    if (parts.length < 4) return null;
    const [p, ts, rd, sig] = parts;
    if (p !== provider) return null;
    if (Date.now() - Number(ts) > STATE_TTL_MS) return null;
    const expected = crypto.createHmac('sha256', STATE_SECRET).update(`${p}:${ts}:${rd}`).digest('hex').slice(0, 16);
    // timingSafeEqual на строках разной длины бросает — длину проверяем отдельно.
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return { returnTo: Buffer.from(rd, 'base64url').toString() };
  } catch {
    return null;
  }
}

/**
 * Куда возвращать человека после входа. Принимаем ТОЛЬКО относительные пути
 * внутри сайта: иначе параметр превращается в открытый редирект, которым удобно
 * маскировать фишинг под наш домен. `//evil.com` тоже отсекаем — браузер читает
 * это как внешний адрес.
 */
function safeReturnTo(value) {
  const v = String(value || '');
  if (!v.startsWith('/') || v.startsWith('//')) return '/app';
  return v;
}

function fail(res, message, returnTo = '/app/login') {
  const base = `${SITE_URL}${safeReturnTo(returnTo === '/app' ? '/app/login' : returnTo)}`;
  return res.redirect(`${base}?oauthError=${encodeURIComponent(message)}`);
}

/** Успех: одноразовый код на страницу сайта, которая поставит cookie. */
async function succeed(res, tenant, isNew, returnTo, req) {
  let promoActivated = false;
  if (req) {
    const c = readCookies(req.headers.cookie);
    if (isNew) {
      await applyAcquisition(tenant, { ref: c.otkliks_ref, promo: c.otkliks_promo, src: c.otkliks_src });
    } else if (c.otkliks_promo) {
      // Уже есть аккаунт, но пришёл по промо-ссылке и просто вошёл — подарок не
      // должен потеряться. Партнёра существующему аккаунту не меняем никогда.
      const r = await redeemPromo(tenant, c.otkliks_promo).catch(() => null);
      promoActivated = !!r?.ok;
    }
    // Использованные метки больше не нужны — стираем тем же доменом и путём.
    const gone = { path: '/', httpOnly: true, sameSite: 'lax', secure: true };
    res.clearCookie('otkliks_promo', gone);
    if (isNew) res.clearCookie('otkliks_ref', gone);
  }
  const token = await signTenantToken(tenant);
  const code = issueExchangeCode({ token, tenantId: String(tenant._id) });
  // Флаги для кабинета — как после обычной регистрации/входа: кабинет покажет
  // приветствие или «предложение активировано» и отметит цель в метриках.
  const next = isNew ? '/app?welcome=1' : promoActivated ? '/app?promo=activated' : safeReturnTo(returnTo || '/app');
  const params = new URLSearchParams({ code, next });
  if (isNew) sendMail({ to: tenant.email, ...welcomeEmail(tenant) }).catch(() => {});
  return res.redirect(`${SITE_URL}/app/oauth?${params}`);
}

// ── PKCE для VK ─────────────────────────────────────────────────────────────
// VK ID работает по OAuth 2.1, где PKCE обязателен. Verifier живёт в памяти
// процесса: он нужен ровно между двумя запросами одного человека и переживать
// перезапуск не обязан.
const pkceStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pkceStore) if (v.expiresAt < now) pkceStore.delete(k);
}, 60_000).unref();

// ════════════════════════════════════════════════════════════════════════════
// ЯНДЕКС — обычный OAuth 2.0
// ════════════════════════════════════════════════════════════════════════════
router.get('/yandex', (req, res) => {
  const returnTo = safeReturnTo(req.query.next);
  if (!process.env.YANDEX_CLIENT_ID) return fail(res, 'Вход через Яндекс пока не настроен');

  const params = new URLSearchParams({
    client_id: process.env.YANDEX_CLIENT_ID,
    redirect_uri: `${SITE_URL}/api/auth/yandex/callback`,
    response_type: 'code',
    state: makeState('yandex', returnTo),
  });
  res.redirect(`https://oauth.yandex.ru/authorize?${params}`);
});

router.get('/yandex/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const sv = verifyState(state, 'yandex');
  if (error || !code) return fail(res, 'Вход через Яндекс отменён', sv?.returnTo);
  if (!sv) return fail(res, 'Ссылка входа устарела, попробуйте ещё раз');

  try {
    const tokenRes = await fetch('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Яндекс ждёт client_id/secret именно в Basic-заголовке.
        Authorization: `Basic ${Buffer.from(`${process.env.YANDEX_CLIENT_ID}:${process.env.YANDEX_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: `${SITE_URL}/api/auth/yandex/callback`,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      console.error('Yandex OAuth: токен не получен', tokens);
      return fail(res, 'Яндекс не выдал доступ, попробуйте ещё раз', sv.returnTo);
    }

    const profileRes = await fetch('https://login.yandex.ru/info?format=json', {
      // Именно OAuth, не Bearer — у Яндекса свой префикс.
      headers: { Authorization: `OAuth ${tokens.access_token}` },
    });
    const profile = await profileRes.json();

    const { tenant, isNew } = await findOrCreateOAuthTenant({
      provider: 'yandex',
      providerId: String(profile.id),
      email: profile.default_email || profile.emails?.[0] || null,
      displayName: profile.real_name || profile.display_name || profile.login || null,
    });
    return succeed(res, tenant, isNew, sv.returnTo, req);
  } catch (e) {
    console.error('Yandex OAuth:', e.message);
    return fail(res, 'Не удалось войти через Яндекс', sv?.returnTo);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// VK ID — OAuth 2.1 + PKCE (id.vk.com, не старый oauth.vk.com)
// ════════════════════════════════════════════════════════════════════════════
router.get('/vk', (req, res) => {
  const returnTo = safeReturnTo(req.query.next);
  if (!process.env.VK_CLIENT_ID) return fail(res, 'Вход через VK пока не настроен');

  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const deviceId = crypto.randomBytes(16).toString('hex');
  const state = makeState('vk', returnTo);

  pkceStore.set(state, { codeVerifier, deviceId, expiresAt: Date.now() + PKCE_TTL_MS });

  const params = new URLSearchParams({
    client_id: process.env.VK_CLIENT_ID,
    redirect_uri: `${SITE_URL}/api/auth/vk/callback`,
    response_type: 'code',
    scope: 'email',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  res.redirect(`https://id.vk.com/authorize?${params}`);
});

router.get('/vk/callback', async (req, res) => {
  const { code, state, error, device_id: callbackDeviceId } = req.query;
  const sv = verifyState(state, 'vk');
  if (error || !code) return fail(res, 'Вход через VK отменён', sv?.returnTo);
  if (!sv) return fail(res, 'Ссылка входа устарела, попробуйте ещё раз');

  const pkce = pkceStore.get(state);
  if (!pkce) return fail(res, 'Сессия входа истекла, попробуйте ещё раз', sv.returnTo);
  pkceStore.delete(state);

  try {
    // ВНИМАНИЕ, это не описка и не небрежность: у VK ID параметры обмена идут
    // в QUERY STRING, а сам code — в ТЕЛЕ запроса. Если положить всё в тело,
    // как принято в OAuth, VK отвечает ошибкой без внятного текста.
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      redirect_uri: `${SITE_URL}/api/auth/vk/callback`,
      client_id: process.env.VK_CLIENT_ID,
      code_verifier: pkce.codeVerifier,
      state: String(state),
      // device_id VK присылает в колбэке, и вернуть нужно именно его. Свой —
      // только на случай, если провайдер его не прислал.
      device_id: callbackDeviceId || pkce.deviceId,
      scope: 'email',
    });
    const tokenRes = await fetch(`https://id.vk.com/oauth2/auth?${tokenParams}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: String(code) }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      console.error('VK OAuth: токен не получен', tokens);
      return fail(res, 'VK не выдал доступ, попробуйте ещё раз', sv.returnTo);
    }

    // Профиль тоже POST-ом: client_id в query, access_token в теле.
    const userInfoRes = await fetch(
      `https://id.vk.com/oauth2/user_info?${new URLSearchParams({ client_id: process.env.VK_CLIENT_ID })}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: tokens.access_token }),
      },
    );
    const userInfo = await userInfoRes.json();
    const u = userInfo.user || {};

    const { tenant, isNew } = await findOrCreateOAuthTenant({
      provider: 'vk',
      providerId: String(u.user_id || u.id || tokens.user_id),
      // Почты может не быть вовсе — это нормальный случай для VK.
      email: u.email || tokens.email || null,
      displayName: [u.first_name, u.last_name].filter(Boolean).join(' ') || null,
    });
    return succeed(res, tenant, isNew, sv.returnTo, req);
  } catch (e) {
    console.error('VK OAuth:', e.message);
    return fail(res, 'Не удалось войти через VK', sv?.returnTo);
  }
});

// ── Обмен одноразового кода на токен сессии ─────────────────────────────────
// Зовёт marketing-site со своей стороны (server-to-server), браузер сюда не ходит.
router.post('/oauth/exchange', (req, res) => {
  const rec = consumeExchangeCode(String(req.body?.code || ''));
  if (!rec) return res.status(400).json({ error: 'Код входа недействителен или уже использован' });
  res.json({ token: rec.token });
});

module.exports = { router };
