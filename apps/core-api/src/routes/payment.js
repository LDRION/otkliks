const express = require('express');
const crypto = require('crypto');
const { wrapAsyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../middleware/requireAuth');
const Tenant = require('../models/Tenant');
const { sendMail } = require('../lib/mailer');
const { paymentReceiptEmail } = require('../lib/emailTemplates');
const PendingPayment = require('../models/PendingPayment');
const { activeDiscount } = require('../lib/promo');
const { creditCommission } = require('../lib/affiliate');

const SITE_URL = process.env.SITE_URL || 'https://otkliks.ru';

// ЮMoney берёт комиссию с получателя (при оплате картой — около 3%), поэтому в
// подписанном поле amount приходит чуть меньше, чем заплатил человек. Допуск 5%
// покрывает комиссию, а оплату «2 ₽ вместо 899» — нет.
const AMOUNT_TOLERANCE = 0.95;

function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

const router = express.Router();

// Тарифы — подписка на неделю или на месяц, продлевается тем же способом (повторная
// оплата продлевает currentPeriodEnd, а не создаёт отдельную сущность).
const PLANS = {
  weekly: { priceRub: 99, days: 7, label: 'Неделя' },
  monthly: { priceRub: 199, days: 30, label: 'Месяц' },
};

// ЮMoney quickpay + HTTP-уведомления — тот же паттерн и тот же аккаунт ЮMoney, что и в
// siberiai-v5/server/routes/payment.js (см. .env — YOOMONEY_WALLET/YOOMONEY_WEBHOOK_SECRET).

router.get('/plans', (_req, res) => {
  res.json({ plans: Object.entries(PLANS).map(([key, v]) => ({ key, ...v })) });
});

router.post('/create', requireAuth, async (req, res) => {
  const planKey = req.body?.plan;
  const plan = PLANS[planKey];
  if (!plan) return res.status(400).json({ error: 'Неверный тариф' });

  const wallet = process.env.YOOMONEY_WALLET;
  if (!wallet) return res.status(503).json({ error: 'Оплата временно недоступна. Обратитесь к поддержке.' });

  // Скидка по промокоду — на первую оплату, пока не истекла.
  const discount = activeDiscount(req.tenant);
  const amount = Math.max(1, Math.round(plan.priceRub * (100 - discount) / 100));

  // Случайная часть в метке: метку не угадать и не собрать под чужой аккаунт.
  const label = `${req.tenant._id}_${planKey}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  await PendingPayment.create({
    label,
    tenantId: req.tenant._id,
    plan: planKey,
    basePrice: plan.priceRub,
    expectedAmount: amount,
    discountPercent: discount,
    promoCode: discount ? req.tenant.promo?.code || null : null,
  });

  const paymentUrl =
    `https://yoomoney.ru/quickpay/confirm?receiver=${wallet}&quickpay-form=shop` +
    `&targets=${encodeURIComponent(`Откликс — ${plan.label}`)}` +
    `&paymentType=AC&sum=${amount}&label=${encodeURIComponent(label)}` +
    // Возврат в кабинет после оплаты — там же фиксируется цель «оплата» в метриках.
    `&successURL=${encodeURIComponent(`${SITE_URL}/app?paid=1`)}`;

  res.json({ paymentUrl, plan: planKey, amount, discountPercent: discount });
});

// POST /api/payment/webhook — YooMoney HTTP-notification (form-urlencoded, не JSON).
router.post('/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const body = req.body;
    const secret = process.env.YOOMONEY_WEBHOOK_SECRET;
    if (!secret) {
      console.error('YOOMONEY_WEBHOOK_SECRET не задан');
      return res.status(500).send('Payment service misconfigured');
    }

    // Устойчиво к обеим схемам подписи ЮMoney (кошелёк шлёт sha1_hash; часть интеграций —
    // HMAC-SHA256 sign) — см. тот же гейт в siberiai-v5, там раньше терялись реальные оплаты,
    // когда проверялась только одна схема.
    let verified = false;
    if (body.sha1_hash) {
      const s = [
        body.notification_type, body.operation_id, body.amount, body.currency,
        body.datetime, body.sender, body.codepro, secret, body.label,
      ].join('&');
      if (safeEqualHex(crypto.createHash('sha1').update(s).digest('hex'), body.sha1_hash)) verified = true;
    }
    if (!verified && body.sign) {
      const { sign: _omit, ...params } = body;
      const signString = Object.keys(params).sort()
        .map((k) => `${k}=${encodeURIComponent(params[k] ?? '')}`)
        .join('&');
      if (safeEqualHex(crypto.createHmac('sha256', secret).update(signString).digest('hex'), body.sign)) verified = true;
    }
    if (!verified) {
      console.warn('YooMoney webhook: подпись не прошла', { hasSha1: !!body.sha1_hash, hasSign: !!body.sign });
      return res.status(401).send('Invalid signature');
    }

    if (body.notification_type !== 'p2p-incoming' && body.notification_type !== 'card-incoming') {
      return res.status(200).send('OK');
    }

    const label = String(body.label || '');
    // Сначала — ожидаемый платёж, созданный при нажатии «Оплатить». Если его нет
    // (метка выдана до этой правки), ждём полную цену тарифа из метки.
    const pending = await PendingPayment.findOne({ label });
    const [labelTenantId, labelPlan] = label.split('_');
    const tenantId = pending ? String(pending.tenantId) : labelTenantId;
    const planKey = pending ? pending.plan : labelPlan;
    const plan = PLANS[planKey];
    if (!tenantId || !plan) {
      console.warn('YooMoney webhook: нераспознанный label', label);
      return res.status(200).send('OK');
    }
    const expected = pending ? pending.expectedAmount : plan.priceRub;

    // Сверка суммы — по ПОДПИСАННОМУ полю amount (withdraw_amount в подпись не
    // входит). Недоплата — подписку не выдаём, пишем в лог для ручного возврата.
    const received = parseFloat(body.amount || 0);
    if (!(received >= expected * AMOUNT_TOLERANCE)) {
      console.error(`⚠ YooMoney: НЕДОПЛАТА по ${label}: пришло ${received} ₽ при ожидаемых ${expected} ₽ — подписка не выдана`);
      return res.status(200).send('OK');
    }

    const paymentId = String(body.operation_id || '');
    const tenant = await Tenant.findById(tenantId).catch(() => null);
    if (!tenant) return res.status(200).send('OK');

    // Идемпотентность — повторное уведомление о том же платеже не продлевает подписку дважды.
    if (paymentId && tenant.paymentHistory.some((p) => p.paymentId === paymentId)) {
      console.log(`Платёж ${paymentId} уже обработан — пропускаем`);
      return res.status(200).send('OK');
    }

    const now = new Date();
    // Скидка разовая. Если человек открыл оплату со скидкой в двух вкладках и
    // оплатил обе, вторая пришла уже после того, как скидка израсходована: деньги
    // не теряем, но и полный срок за полцены не даём — дни пропорционально сумме.
    let days = plan.days;
    if (pending?.discountPercent && tenant.promo?.discountUsedAt) {
      days = Math.max(1, Math.floor((plan.days * received) / plan.priceRub));
      console.warn(`⚠ YooMoney: повторная оплата со скидкой по ${label} — выдано ${days} дн. вместо ${plan.days}`);
    }
    const stillActive = tenant.isSubscriptionActive() && tenant.subscription.currentPeriodEnd > now;
    const base = stillActive ? tenant.subscription.currentPeriodEnd : now;

    tenant.subscription.status = 'active';
    tenant.subscription.plan = planKey;
    tenant.subscription.priceRub = plan.priceRub;
    tenant.subscription.startedAt = tenant.subscription.startedAt || now;
    tenant.subscription.currentPeriodEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
    tenant.subscription.reminderSentAt = null;
    // Пробный период по промокоду мог выставить свой дневной лимит — оплаченный
    // тариф всегда даёт полные 200.
    if (!tenant.dailyCap || tenant.dailyCap < 200) tenant.dailyCap = 200;
    // Скидка одноразовая: оплатил со скидкой — она израсходована.
    if (pending?.discountPercent && tenant.promo && !tenant.promo.discountUsedAt) tenant.promo.discountUsedAt = now;
    tenant.paymentHistory.push({
      paymentId,
      provider: 'yoomoney',
      plan: planKey,
      amount: received,
      paidAt: now,
    });
    await tenant.save();
    if (pending) await PendingPayment.updateOne({ _id: pending._id }, { $set: { consumedAt: now } });

    // 30% партнёру, если человек пришёл по партнёрской ссылке. Считается от суммы,
    // которую заплатил человек (со скидкой), а не от полной цены тарифа. Ошибка
    // здесь не должна ронять выдачу подписки — она уже выдана.
    // Начисляем ДО ответа ЮMoney: если процесс упадёт после ответа, партнёр не
    // должен потерять деньги. Повтор уведомления безопасен — начисление идемпотентно.
    try {
      await creditCommission(tenant, { paymentId, paidAmount: expected });
    } catch (e) {
      console.error('Комиссия партнёру не начислена:', e.message);
    }

    console.log(`Подписка продлена: ${tenantId} (${planKey}, ${expected}₽) до ${tenant.subscription.currentPeriodEnd.toISOString()}`);
    res.status(200).send('OK');

    const receipt = paymentReceiptEmail(tenant, {
      plan: planKey,
      amount: expected,
      periodEnd: tenant.subscription.currentPeriodEnd,
    });
    sendMail({ to: tenant.email, ...receipt }).catch(() => {});
  } catch (err) {
    console.error('Payment webhook error:', err);
    res.status(500).send('Error');
  }
});

wrapAsyncRouter(router);

module.exports = { router, PLANS };
