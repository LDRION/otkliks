const express = require('express');
const { wrapAsyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../middleware/requireAuth');
const Tenant = require('../models/Tenant');
const Affiliate = require('../models/Affiliate');
const Commission = require('../models/Commission');
const Payout = require('../models/Payout');
const { describePromo, redeemPromo } = require('../lib/promo');
const aff = require('../lib/affiliate');
const { isSyntheticEmail } = require('../lib/oauthTenant');

// Промокоды и партнёрская программа — со стороны КЛИЕНТА (кабинет). Админские
// операции — отдельно, в routes/admin.js, за другим ключом.
//
// Браузер сюда напрямую не ходит: nginx проксирует в core-api только перечисленные
// префиксы, и /api/promo, /api/affiliate среди них нет. Зовёт сайт со своей
// стороны, подставляя токен сессии.

const promoRouter = express.Router();

// Условия по коду — для баннера «вам доступно…». Отдаёт только публичные поля,
// заметку админа («кому и почему выдан») — никогда.
promoRouter.get('/:code', async (req, res) => {
  const offer = await describePromo(req.params.code);
  if (!offer) return res.status(404).json({ error: 'Предложение недоступно' });
  res.json({ offer });
});

promoRouter.post('/redeem', requireAuth, async (req, res) => {
  const r = await redeemPromo(req.tenant, req.body?.code);
  if (!r.ok) {
    const msg = {
      invalid: 'Код не распознан',
      unavailable: 'Это предложение уже использовано или больше не действует',
      'already-has-promo': 'На аккаунте уже есть активированное предложение',
    }[r.reason] || 'Не удалось активировать предложение';
    return res.status(400).json({ error: msg, reason: r.reason });
  }
  res.json({ offer: r.offer, trialGranted: r.trialGranted });
});

const affiliateRouter = express.Router();

// Переход по партнёрской ссылке — зовёт только сайт со своей стороны (снаружи
// /api/affiliate в nginx не выставлен). Без авторизации: это до регистрации.
// Счётчик чисто статистический, деньги от него не зависят.
affiliateRouter.post('/click', async (req, res) => {
  const code = String(req.body?.code || '').toUpperCase();
  if (/^[A-Z0-9]{4,32}$/.test(code)) await Affiliate.updateOne({ code }, { $inc: { clicks: 1 } });
  res.json({ ok: true });
});

affiliateRouter.use(requireAuth);

affiliateRouter.get('/me', async (req, res) => {
  const a = await Affiliate.findOne({ tenantId: req.tenant._id }).lean();
  const terms = { rate: aff.RATE, holdDays: aff.HOLD_DAYS, minPayout: aff.MIN_PAYOUT };
  if (!a) return res.json({ joined: false, terms });

  const [referrals, commissions, payouts] = await Promise.all([
    Tenant.find({ referredBy: a._id }).select('email referredAt paymentHistory').sort({ referredAt: -1 }).limit(100).lean(),
    Commission.find({ affiliateId: a._id }).sort({ createdAt: -1 }).limit(100).lean(),
    Payout.find({ affiliateId: a._id }).sort({ requestedAt: -1 }).limit(50).lean(),
  ]);

  res.json({
    joined: true,
    terms,
    // Почты нет (вход через VK/Яндекс по телефону) — связь по выплате только через реквизиты.
    noEmail: isSyntheticEmail(req.tenant.email),
    code: a.code,
    blocked: a.blocked,
    held: a.held,
    balance: a.balance,
    reserved: a.reserved,
    totalEarned: a.totalEarned,
    totalWithdrawn: a.totalWithdrawn,
    referralsCount: a.referralsCount,
    clicks: a.clicks || 0,
    // Партнёр видит, что человек пришёл и платит ли, — но не его почту целиком.
    referrals: referrals.map((t) => ({
      who: aff.maskEmail(t.email),
      at: t.referredAt,
      paid: (t.paymentHistory || []).length > 0,
    })),
    commissions: commissions.map((c) => ({
      amount: c.amount, paymentAmount: c.paymentAmount, status: c.status, availableAt: c.availableAt, at: c.createdAt,
    })),
    payouts: payouts.map((p) => ({
      amount: p.amount, status: p.status, requestedAt: p.requestedAt, processedAt: p.processedAt, note: p.adminNote || '',
    })),
  });
});

affiliateRouter.post('/join', async (req, res) => {
  const a = await aff.joinProgram(req.tenant._id);
  res.json({ code: a.code });
});

affiliateRouter.post('/payout', async (req, res) => {
  const r = await aff.requestPayout(req.tenant._id, { amount: req.body?.amount, details: req.body?.details });
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

wrapAsyncRouter(promoRouter);
wrapAsyncRouter(affiliateRouter);

module.exports = { promoRouter, affiliateRouter };
