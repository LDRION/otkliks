const crypto = require('crypto');
const express = require('express');
const { wrapAsyncRouter } = require('../lib/asyncRouter');
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const PromoCode = require('../models/PromoCode');
const Affiliate = require('../models/Affiliate');
const Commission = require('../models/Commission');
const Payout = require('../models/Payout');
const CloudWaitlist = require('../models/CloudWaitlist');
const CloudReveal = require('../models/CloudReveal');
const Vacancy = require('../models/Vacancy');
const Negotiation = require('../models/Negotiation');
const ActivityEvent = require('../models/ActivityEvent');
const AdminMark = require('../models/AdminMark');
const { generateCode } = require('../lib/promo');
const aff = require('../lib/affiliate');
const { accountLabel } = require('../lib/oauthTenant');

// Админские операции: промокоды, партнёры, выплаты, сводка.
//
// Три слоя защиты, и каждый работает сам по себе:
//   1. nginx не проксирует /api/admin наружу — из интернета сюда не попасть;
//   2. core-api слушает только 127.0.0.1;
//   3. каждый запрос несёт X-Admin-Key = ADMIN_API_SECRET. Ключ знает только
//      сервер сайта; он же проверяет админскую сессию и роль, прежде чем звать.
// Без заданного ADMIN_API_SECRET всё закрыто (fail-closed).
const router = express.Router();

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

router.use((req, res, next) => {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret || secret.length < 32) return res.status(503).json({ error: 'Админ-API не настроен' });
  if (!safeEqual(req.headers['x-admin-key'], secret)) return res.status(401).json({ error: 'Нет доступа' });
  req.actor = String(req.headers['x-admin-actor'] || '').slice(0, 200);
  req.actorRole = String(req.headers['x-admin-role'] || '');
  next();
});

const requireOwner = (req, res, next) =>
  req.actorRole === 'owner' ? next() : res.status(403).json({ error: 'Только для владельца' });

const isId = (v) => mongoose.isValidObjectId(v);
const int = (v, def, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

// ── Источник регистрации — для отчёта по каналам, в том числе соцсетям ──────
const HOSTS = [
  [/(^|\.)t\.me$|telegram/i, 'Telegram'],
  [/(^|\.)vk\.(com|ru)$/i, 'VK'],
  [/youtube\.com$|youtu\.be$/i, 'YouTube'],
  [/google\./i, 'Google (поиск)'],
  [/yandex\.|ya\.ru$/i, 'Яндекс (поиск)'],
];
const UTM = { telegram: 'Telegram', tg: 'Telegram', vk: 'VK', youtube: 'YouTube', yt: 'YouTube', partner: 'Партнёры' };

function sourceOf(t) {
  if (t.referredBy) return 'Партнёры';
  if (t.promo?.code) return 'Промо-ссылки';
  const s = String(t.acquisition?.source || '').toLowerCase();
  if (s) return UTM[s] || t.acquisition.source;
  const host = String(t.acquisition?.referrerHost || '');
  for (const [re, name] of HOSTS) if (re.test(host)) return name;
  return host ? host : 'Прямые заходы';
}

const paidSum = (t, since) => (t.paymentHistory || [])
  .filter((p) => !since || new Date(p.paidAt) >= since)
  .reduce((s, p) => s + (Number(p.amount) || 0), 0);

// Тестовые адреса: e2e-прогоны и выдуманные домены. Аккаунты, помеченные в админке как
// «наш» (AdminMark.internal), тоже не реальные пользователи.
const TEST_EMAIL_RE = /@otkliks-e2e\.local$|@example\.(com|org|net)$|@test\.[a-z]+$/i;
const isTestEmail = (e) => TEST_EMAIL_RE.test(String(e || ''));
async function internalIds() {
  return new Set((await AdminMark.find({ internal: true }).select('tenantId').lean()).map((m) => String(m.tenantId)));
}

// ── Сводка ─────────────────────────────────────────────────────────────────
router.get('/overview', async (_req, res) => {
  const now = Date.now();
  const d7 = new Date(now - 7 * 864e5);
  const d30 = new Date(now - 30 * 864e5);
  const internal = await internalIds();
  const tenants = (await Tenant.find({ email: { $not: /@otkliks-e2e\.local$/ } })
    .select('email createdAt subscription paymentHistory referredBy promo acquisition').lean())
    .filter((t) => !isTestEmail(t.email) && !internal.has(String(t._id)));

  const bySource = {};
  let revenueTotal = 0; let revenue30 = 0; let paying = 0; let trials = 0;
  for (const t of tenants) {
    const total = paidSum(t);
    revenueTotal += total;
    revenue30 += paidSum(t, d30);
    const end = t.subscription?.currentPeriodEnd ? new Date(t.subscription.currentPeriodEnd).getTime() : 0;
    const live = end > now;
    if (live && t.subscription?.status === 'active') paying++;
    if (live && t.subscription?.status === 'trialing') trials++;

    const src = sourceOf(t);
    const row = bySource[src] || (bySource[src] = { source: src, registrations: 0, registrations30: 0, paid: 0, revenue: 0 });
    row.registrations++;
    if (t.createdAt && new Date(t.createdAt) >= d30) row.registrations30++;
    if (total > 0) row.paid++;
    row.revenue += total;
  }

  const [promoTotal, promoRedeemed, affiliates, pendingPayouts, cloudTotal, cloud7, cloudReveals] = await Promise.all([
    PromoCode.countDocuments(),
    PromoCode.countDocuments({ redemptions: { $gt: 0 } }),
    Affiliate.countDocuments(),
    Payout.countDocuments({ status: 'pending' }),
    CloudWaitlist.countDocuments(),
    CloudWaitlist.countDocuments({ createdAt: { $gte: d7 } }),
    CloudReveal.countDocuments(),
  ]);

  res.json({
    users: tenants.length,
    new7: tenants.filter((t) => t.createdAt && new Date(t.createdAt) >= d7).length,
    new30: tenants.filter((t) => t.createdAt && new Date(t.createdAt) >= d30).length,
    paying, trials, revenueTotal, revenue30,
    sources: Object.values(bySource).sort((a, b) => b.registrations - a.registrations),
    promo: { total: promoTotal, redeemed: promoRedeemed },
    affiliates, pendingPayouts,
    cloudWaitlist: { total: cloudTotal, new7: cloud7, reveals: cloudReveals },
    service: await serviceStats(tenants.map((t) => t._id)),
  });
});

// Статистика работы сервиса — те же показатели, что были на главной («Статистика
// Откликс в этом году»), но посчитанные по базе. На лендинг вернём, когда цифры
// станут убедительными; пока смотрим здесь. Тестовые аккаунты не считаются.
// Часы — ОЦЕНКА: ~5 минут ручной работы на отклик (найти вакансию, прочитать,
// написать письмо). Офферы не отслеживаются — у hh нет такого сигнала.
const MINUTES_PER_APPLY = 5;
async function serviceStats(tenantIds) {
  const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  const scope = (extra = {}) => ({ tenantId: { $in: tenantIds }, ...extra });
  const count = async (since) => {
    const [applied, invitesChats, invitedUsers, forms] = await Promise.all([
      Vacancy.countDocuments(scope({ status: 'applied', ...(since ? { appliedAt: { $gte: since } } : {}) })),
      Negotiation.countDocuments(scope({ outcome: 'interview', ...(since ? { updatedAt: { $gte: since } } : {}) })),
      Negotiation.distinct('tenantId', scope({ outcome: 'interview', ...(since ? { updatedAt: { $gte: since } } : {}) })).then((a) => a.length),
      ActivityEvent.countDocuments(scope({ type: 'form', ...(since ? { createdAt: { $gte: since } } : {}) })),
    ]);
    return { applied, invites: invitesChats, invitedUsers, forms, hoursSaved: Math.round((applied * MINUTES_PER_APPLY) / 60) };
  };
  const [year, total] = await Promise.all([count(yearStart), count(null)]);
  return { year, total, yearLabel: yearStart.getUTCFullYear(), minutesPerApply: MINUTES_PER_APPLY };
}

// ── Пользователи по одному ─────────────────────────────────────────────────
// Кто зарегистрировался, как и откуда, и дошёл ли до дела: резюме → лаунчер → отклики →
// приглашения → оплата. Отдаём только то, что нужно админке: никаких хешей паролей,
// токенов устройств и ссылок сброса.

// Как зарегистрировался: способ входа и где (сайт / лаунчер). consent.source пишется с
// 28.09.2026 — у более ранних аккаунтов «где» неизвестно.
function signupOf(t) {
  const via = t.yandexId ? 'Яндекс ID' : t.vkId ? 'VK ID' : 'Почта и пароль';
  const src = t.consent?.source;
  const where = src === 'launcher' ? 'в лаунчере' : src === 'site' || src === 'oauth' || t.yandexId || t.vkId ? 'на сайте' : '';
  return { via, where };
}

// Этап — докуда человек дошёл.
function stageOf(t, s) {
  if ((t.paymentHistory || []).some((p) => Number(p.amount) > 0)) return 'paid';
  if (s.invites > 0) return 'invited';
  if (s.applied > 0) return 'applying';
  if ((t.devices || []).length) return 'launcher';
  if ((t.resumeProfiles || []).length) return 'resume';
  return 'registered';
}

const SAFE_FIELDS = 'email fullName createdAt consent yandexId vkId devices resumeProfiles subscription paymentHistory referredBy referredAt promo acquisition';

async function statsByTenant(ids, since7) {
  const by = (rows) => new Map(rows.map((r) => [String(r._id), r]));
  const [applied, invites, events] = await Promise.all([
    Vacancy.aggregate([
      { $match: { tenantId: { $in: ids }, status: 'applied' } },
      { $group: { _id: '$tenantId', n: { $sum: 1 }, last: { $max: '$appliedAt' }, n7: { $sum: { $cond: [{ $gte: ['$appliedAt', since7] }, 1, 0] } } } },
    ]).then(by),
    Negotiation.aggregate([
      { $match: { tenantId: { $in: ids }, outcome: 'interview' } },
      { $group: { _id: '$tenantId', n: { $sum: 1 } } },
    ]).then(by),
    ActivityEvent.aggregate([
      { $match: { tenantId: { $in: ids } } },
      { $group: { _id: '$tenantId', n: { $sum: 1 }, last: { $max: '$createdAt' } } },
    ]).then(by),
  ]);
  return (id) => {
    const k = String(id);
    return {
      applied: applied.get(k)?.n || 0, applied7: applied.get(k)?.n7 || 0, lastAppliedAt: applied.get(k)?.last || null,
      invites: invites.get(k)?.n || 0, events: events.get(k)?.n || 0, lastEventAt: events.get(k)?.last || null,
    };
  };
}

function userRow(t, s, mark, affiliates) {
  const lastSeen = (t.devices || []).map((d) => d.lastSeenAt).filter(Boolean).map((d) => new Date(d).getTime());
  const lastActivity = Math.max(0, ...lastSeen, s.lastEventAt ? new Date(s.lastEventAt).getTime() : 0, s.lastAppliedAt ? new Date(s.lastAppliedAt).getTime() : 0);
  const aff = t.referredBy ? affiliates.get(String(t.referredBy)) : null;
  return {
    id: String(t._id),
    email: t.email,
    noEmail: /@oauth\.otkliks\.local$/.test(t.email || ''),
    fullName: t.fullName || '',
    createdAt: t.createdAt,
    signup: signupOf(t),
    source: sourceOf(t),
    acquisition: t.acquisition || null,
    partner: aff ? { code: aff.code, email: aff.email } : null,
    promo: t.promo?.code || null,
    devices: (t.devices || []).length,
    resumes: (t.resumeProfiles || []).length,
    subscription: t.subscription?.status || 'none',
    paid: paidSum(t),
    ...s,
    lastActivityAt: lastActivity ? new Date(lastActivity) : null,
    stage: stageOf(t, s),
    test: isTestEmail(t.email),
    internal: !!mark?.internal,
    note: mark?.note || '',
  };
}

async function affiliatesById(tenants) {
  const ids = [...new Set(tenants.map((t) => t.referredBy).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const list = await Affiliate.find({ _id: { $in: ids } }).select('code tenantId').lean();
  const owners = new Map((await Tenant.find({ _id: { $in: list.map((a) => a.tenantId) } }).select('email').lean())
    .map((o) => [String(o._id), o.email]));
  return new Map(list.map((a) => [String(a._id), { code: a.code, email: owners.get(String(a.tenantId)) || '' }]));
}

router.get('/users', async (_req, res) => {
  const tenants = await Tenant.find({}).select(SAFE_FIELDS).sort({ createdAt: -1 }).lean();
  const since7 = new Date(Date.now() - 7 * 864e5);
  const [stats, marks, affiliates] = await Promise.all([
    statsByTenant(tenants.map((t) => t._id), since7),
    AdminMark.find({ tenantId: { $in: tenants.map((t) => t._id) } }).lean().then((m) => new Map(m.map((x) => [String(x.tenantId), x]))),
    affiliatesById(tenants),
  ]);
  res.json({ users: tenants.map((t) => userRow(t, stats(t._id), marks.get(String(t._id)), affiliates)) });
});

router.get('/users/:id', async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Неверный id' });
  const t = await Tenant.findById(req.params.id).select(SAFE_FIELDS).lean();
  if (!t) return res.status(404).json({ error: 'Нет такого пользователя' });
  const since7 = new Date(Date.now() - 7 * 864e5);
  const [stats, mark, affiliates, outcomes, events] = await Promise.all([
    statsByTenant([t._id], since7),
    AdminMark.findOne({ tenantId: t._id }).lean(),
    affiliatesById([t]),
    Negotiation.aggregate([{ $match: { tenantId: t._id } }, { $group: { _id: '$outcome', n: { $sum: 1 } } }]),
    ActivityEvent.find({ tenantId: t._id }).sort({ createdAt: -1 }).limit(40)
      .select('type title company outcome createdAt url').lean(),
  ]);
  res.json({
    user: userRow(t, stats(t._id), mark, affiliates),
    consent: t.consent || null,
    devices: (t.devices || []).map((d) => ({ label: d.label, pairedAt: d.pairedAt, lastSeenAt: d.lastSeenAt })),
    resumes: (t.resumeProfiles || []).map((r) => ({ label: r.label, key: r.key })),
    payments: (t.paymentHistory || []).map((p) => ({ plan: p.plan, amount: p.amount, paidAt: p.paidAt, provider: p.provider })),
    subscription: t.subscription || null,
    promo: t.promo?.code ? { code: t.promo.code, redeemedAt: t.promo.redeemedAt, discountPercent: t.promo.discountPercent } : null,
    referredAt: t.referredAt || null,
    chats: Object.fromEntries(outcomes.map((o) => [o._id || 'pending', o.n])),
    events: events.map((e) => ({ type: e.type, title: e.title, company: e.company, outcome: e.outcome, at: e.createdAt, url: e.url })),
  });
});

// «Это наш аккаунт» и заметка «кто это».
router.post('/users/:id/mark', async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Неверный id' });
  if (!(await Tenant.exists({ _id: req.params.id }))) return res.status(404).json({ error: 'Нет такого пользователя' });
  const set = { by: req.actor };
  if (typeof req.body?.internal === 'boolean') set.internal = req.body.internal;
  if (typeof req.body?.note === 'string') set.note = req.body.note.slice(0, 500);
  const mark = await AdminMark.findOneAndUpdate({ tenantId: req.params.id }, { $set: set }, { upsert: true, new: true }).lean();
  res.json({ internal: mark.internal, note: mark.note });
});

// ── Лист ожидания облачного тарифа ─────────────────────────────────────────
// Проверка спроса: сколько людей хотят облако, откуда, и — главное — сколько из
// них уже платят за локальный тариф (эти перейдут первыми).
router.get('/waitlist', async (_req, res) => {
  const now = Date.now();
  const d7 = new Date(now - 7 * 864e5);
  const d30 = new Date(now - 30 * 864e5);
  const [list, reveals] = await Promise.all([
    CloudWaitlist.find().sort({ createdAt: -1 }).limit(1000).lean(),
    CloudReveal.find().select('createdAt referrerSource tenantId').lean(),
  ]);
  const ids = list.map((w) => w.tenantId).filter(Boolean);
  const byEmail = list.map((w) => w.email);
  // Аккаунт ищем и по tenantId, и по почте: записался без входа, но аккаунт у него есть.
  const tenants = await Tenant.find({ $or: [{ _id: { $in: ids } }, { email: { $in: byEmail } }] })
    .select('email fullName subscription paymentHistory').lean();
  const tById = new Map(tenants.map((t) => [String(t._id), t]));
  const tByEmail = new Map(tenants.map((t) => [t.email, t]));

  let registered = 0; let paying = 0; let everPaid = 0;
  const bySource = {};
  const entries = list.map((w) => {
    const t = (w.tenantId && tById.get(String(w.tenantId))) || tByEmail.get(w.email);
    const paid = t ? paidSum(t) : 0;
    const live = t?.subscription?.status === 'active' && new Date(t.subscription.currentPeriodEnd || 0).getTime() > now;
    if (t) registered++;
    if (live) paying++;
    if (paid > 0) everPaid++;
    const key = w.source === 'pricing' ? 'Страница тарифов' : w.source === 'landing' ? 'Главная' : w.source === 'dashboard' ? 'Кабинет' : 'Другое';
    bySource[key] = (bySource[key] || 0) + 1;
    return {
      email: w.email, name: t?.fullName || '', at: w.createdAt, source: key,
      referrer: w.referrerSource || '', account: !!t, paying: !!live, paid,
    };
  });

  // По неделям — видно, растёт интерес или затух: открыли описание и оставили почту.
  const inWeek = (arr, from, to) => arr.filter((x) => { const t = new Date(x.createdAt).getTime(); return t >= from && t < to; }).length;
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const from = now - (i + 1) * 7 * 864e5; const to = now - i * 7 * 864e5;
    weeks.push({ from: new Date(from), count: inWeek(list, from, to), reveals: inWeek(reveals, from, to) });
  }
  const revealSources = {};
  for (const r of reveals) { const k = r.referrerSource || 'Прямые заходы'; revealSources[k] = (revealSources[k] || 0) + 1; }

  res.json({
    total: list.length,
    new7: list.filter((w) => new Date(w.createdAt) >= d7).length,
    new30: list.filter((w) => new Date(w.createdAt) >= d30).length,
    registered, paying, everPaid,
    reveals: {
      total: reveals.length,
      new7: reveals.filter((r) => new Date(r.createdAt) >= d7).length,
      new30: reveals.filter((r) => new Date(r.createdAt) >= d30).length,
      withAccount: reveals.filter((r) => r.tenantId).length,
      bySource: Object.entries(revealSources).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    },
    bySource: Object.entries(bySource).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    weeks,
    entries,
  });
});

// ── Промокоды ──────────────────────────────────────────────────────────────
// Невыданные ссылки из запаса в списке не показываем — только их количество.
const STOCK_FREE = () => ({
  stock: true, issuedAt: null, active: true, redemptions: 0,
  $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
});

router.get('/promos', async (_req, res) => {
  const [promos, stockFree] = await Promise.all([
    PromoCode.find({ $or: [{ stock: { $ne: true } }, { issuedAt: { $ne: null } }] }).sort({ issuedAt: -1, createdAt: -1 }).limit(300).lean(),
    PromoCode.countDocuments(STOCK_FREE()),
  ]);
  const ids = promos.flatMap((p) => p.redeemedBy.map((r) => r.tenantId));
  const people = await Tenant.find({ _id: { $in: ids } }).select('email fullName paymentHistory').lean();
  const byId = new Map(people.map((t) => [String(t._id), t]));
  res.json({
    promos: promos.map((p) => ({
      id: p._id, code: p.code, note: p.note, active: p.active,
      trialDays: p.trialDays, trialDailyCap: p.trialDailyCap,
      discountPercent: p.discountPercent, discountValidDays: p.discountValidDays,
      maxRedemptions: p.maxRedemptions, redemptions: p.redemptions,
      expiresAt: p.expiresAt, createdAt: p.issuedAt || p.createdAt, createdBy: p.issuedBy || p.createdBy,
      redeemed: p.redeemedBy.map((r) => {
        const t = byId.get(String(r.tenantId));
        return { email: accountLabel(t), at: r.at, paid: t ? paidSum(t) : 0 };
      }),
    })),
    stockFree,
  });
});

// Взять следующую невыданную ссылку из запаса. Атомарно: два одновременных
// нажатия получат две РАЗНЫЕ ссылки.
router.post('/promos/take', async (req, res) => {
  const p = await PromoCode.findOneAndUpdate(
    STOCK_FREE(),
    { $set: { issuedAt: new Date(), issuedBy: req.actor, note: String(req.body?.note || '').slice(0, 500) } },
    { sort: { createdAt: 1 }, new: true },
  );
  if (!p) return res.status(409).json({ error: 'Запас закончился — пополните его' });
  res.json({ id: p._id, code: p.code });
});

// Пополнить запас: count одноразовых ссылок с условиями по умолчанию.
router.post('/promos/stock', requireOwner, async (req, res) => {
  const count = int(req.body?.count, 100, 1, 200);
  const expiresAt = new Date(Date.now() + 365 * 864e5);
  const docs = [];
  const seen = new Set();
  while (docs.length < count) {
    const code = generateCode(10);
    if (seen.has(code)) continue;
    seen.add(code);
    docs.push({ code, stock: true, note: '', expiresAt, createdBy: req.actor });
  }
  // ordered:false — редкий дубль с уже существующим кодом просто пропускается.
  const r = await PromoCode.insertMany(docs, { ordered: false }).catch((e) => e.insertedDocs || []);
  res.status(201).json({ created: Array.isArray(r) ? r.length : 0 });
});

router.post('/promos', async (req, res) => {
  const b = req.body || {};
  const expiresInDays = int(b.expiresInDays, 0, 0, 365);
  for (let i = 0; i < 6; i++) {
    try {
      const p = await PromoCode.create({
        code: generateCode(10),
        note: String(b.note || '').slice(0, 500),
        trialDays: int(b.trialDays, 3, 0, 30),
        trialDailyCap: int(b.trialDailyCap, 200, 10, 200),
        discountPercent: int(b.discountPercent, 50, 0, 90),
        discountValidDays: int(b.discountValidDays, 14, 1, 90),
        maxRedemptions: int(b.maxRedemptions, 1, 1, 10000),
        expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 864e5) : null,
        createdBy: req.actor,
      });
      return res.status(201).json({ id: p._id, code: p.code });
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
  }
  res.status(500).json({ error: 'Не удалось сгенерировать код' });
});

router.post('/promos/:id/active', async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Неверный id' });
  await PromoCode.updateOne({ _id: req.params.id }, { $set: { active: !!req.body?.active } });
  res.json({ ok: true });
});

// ── Партнёры и выплаты ─────────────────────────────────────────────────────
router.get('/affiliates', async (_req, res) => {
  const list = await Affiliate.find().sort({ totalEarned: -1 }).limit(500).lean();
  const owners = await Tenant.find({ _id: { $in: list.map((a) => a.tenantId) } }).select('email fullName').lean();
  const email = new Map(owners.map((t) => [String(t._id), accountLabel(t)]));
  // Сколько приглашённых платят и сколько они принесли (тестовые аккаунты не в счёт).
  const paidRefs = await Tenant.aggregate([
    { $match: { referredBy: { $in: list.map((a) => a._id) }, 'paymentHistory.0': { $exists: true }, email: { $not: /@otkliks-e2e\.local$/ } } },
    { $project: { referredBy: 1, sum: { $sum: '$paymentHistory.amount' } } },
    { $group: { _id: '$referredBy', n: { $sum: 1 }, revenue: { $sum: '$sum' } } },
  ]);
  const paid = new Map(paidRefs.map((r) => [String(r._id), r]));
  res.json({
    affiliates: list.map((a) => ({
      id: a._id, email: email.get(String(a.tenantId)) || '—', code: a.code, blocked: a.blocked,
      clicks: a.clicks || 0,
      referrals: a.referralsCount, paidReferrals: paid.get(String(a._id))?.n || 0,
      revenue: paid.get(String(a._id))?.revenue || 0,
      held: a.held, balance: a.balance, reserved: a.reserved,
      totalEarned: a.totalEarned, totalWithdrawn: a.totalWithdrawn, createdAt: a.createdAt,
    })),
    terms: { rate: aff.RATE, holdDays: aff.HOLD_DAYS, minPayout: aff.MIN_PAYOUT },
  });
});

router.post('/affiliates/:id/block', requireOwner, async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Неверный id' });
  await Affiliate.updateOne({ _id: req.params.id }, { $set: { blocked: !!req.body?.blocked } });
  res.json({ ok: true });
});

router.get('/payouts', async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const list = await Payout.find({ status }).sort({ requestedAt: status === 'pending' ? 1 : -1 }).limit(200).lean();
  const affs = await Affiliate.find({ _id: { $in: list.map((p) => p.affiliateId) } }).lean();
  const owners = await Tenant.find({ _id: { $in: list.map((p) => p.tenantId) } }).select('email fullName').lean();
  const aMap = new Map(affs.map((a) => [String(a._id), a]));
  const eMap = new Map(owners.map((t) => [String(t._id), accountLabel(t)]));
  res.json({
    payouts: list.map((p) => {
      const a = aMap.get(String(p.affiliateId));
      return {
        id: p._id, amount: p.amount, details: p.details, status: p.status,
        requestedAt: p.requestedAt, processedAt: p.processedAt, processedBy: p.processedBy, note: p.adminNote,
        email: eMap.get(String(p.tenantId)) || '—', code: a?.code, blocked: a?.blocked,
        referrals: a?.referralsCount || 0, totalEarned: a?.totalEarned || 0,
      };
    }),
  });
});

router.post('/payouts/:id/resolve', requireOwner, async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Неверный id' });
  const r = await aff.resolvePayout(req.params.id, { approve: !!req.body?.approve, actor: req.actor, note: req.body?.note });
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

// Комиссии конкретного партнёра — чтобы перед выплатой видеть, за кого начислено.
router.get('/affiliates/:id/commissions', async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Неверный id' });
  const list = await Commission.find({ affiliateId: req.params.id }).sort({ createdAt: -1 }).limit(200).lean();
  const people = await Tenant.find({ _id: { $in: list.map((c) => c.referredTenantId) } }).select('email fullName').lean();
  const e = new Map(people.map((t) => [String(t._id), accountLabel(t)]));
  res.json({ commissions: list.map((c) => ({ ...c, email: e.get(String(c.referredTenantId)) || '—' })) });
});

// Отмена комиссии — когда оплату приглашённого вернули. Только владелец.
// Снимается из той корзины, где комиссия лежит сейчас; уже выведенную отменить
// нельзя (деньги ушли) — это видно по ответу, и решается вручную.
router.post('/commissions/:id/reverse', requireOwner, async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'Неверный id' });
  const c = await Commission.findById(req.params.id);
  if (!c || c.status === 'reversed') return res.status(400).json({ error: 'Комиссия не найдена или уже отменена' });

  if (c.status === 'held') {
    const r = await Commission.updateOne({ _id: c._id, status: 'held' }, { $set: { status: 'reversed' } });
    if (!r.modifiedCount) return res.status(409).json({ error: 'Статус изменился — обновите страницу' });
    await Affiliate.updateOne({ _id: c.affiliateId }, { $inc: { held: -c.amount, totalEarned: -c.amount } });
    return res.json({ ok: true });
  }
  // available: сначала атомарно забираем комиссию себе (второй параллельный
  // клик сюда не пройдёт), потом снимаем с баланса, только если деньги ещё на нём.
  const own = await Commission.updateOne({ _id: c._id, status: 'available' }, { $set: { status: 'reversed' } });
  if (!own.modifiedCount) return res.status(409).json({ error: 'Статус изменился — обновите страницу' });
  const a = await Affiliate.findOneAndUpdate(
    { _id: c.affiliateId, balance: { $gte: c.amount } },
    { $inc: { balance: -c.amount, totalEarned: -c.amount } },
  );
  if (!a) {
    await Commission.updateOne({ _id: c._id, status: 'reversed' }, { $set: { status: 'available' } });
    return res.status(409).json({ error: 'Комиссия уже выведена или зарезервирована к выводу — отменить автоматически нельзя' });
  }
  res.json({ ok: true });
});

wrapAsyncRouter(router);

module.exports = { router };
