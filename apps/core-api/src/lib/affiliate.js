const crypto = require('crypto');
const Affiliate = require('../models/Affiliate');
const Commission = require('../models/Commission');
const Payout = require('../models/Payout');
const Tenant = require('../models/Tenant');

// Партнёрская программа. Условия владельца: 30% с каждой оплаты приглашённого,
// человек закрепляется за партнёром навсегда (как в Siberi).
const RATE = Number(process.env.AFFILIATE_RATE || 0.30);
// Удержание: комиссия становится доступной к выводу не сразу. За это время оплату
// могут вернуть (оферта разрешает возврат), и выплачивать партнёру деньги за
// вернувшийся платёж нельзя. В Siberi комиссия была доступна мгновенно.
const HOLD_DAYS = Number(process.env.AFFILIATE_HOLD_DAYS || 14);
const MIN_PAYOUT = Number(process.env.AFFILIATE_MIN_PAYOUT || 1000);

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateCode(len = 8) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

async function joinProgram(tenantId) {
  const existing = await Affiliate.findOne({ tenantId });
  if (existing) return existing;
  for (let i = 0; i < 8; i++) {
    try {
      return await Affiliate.create({ tenantId, code: generateCode() });
    } catch (e) {
      // Коллизия кода — пробуем другой; коллизия по tenantId — параллельный join.
      if (e.code !== 11000) throw e;
      const again = await Affiliate.findOne({ tenantId });
      if (again) return again;
    }
  }
  throw new Error('Не удалось выдать код партнёра');
}

/**
 * Закрепить нового арендатора за партнёром. Только при регистрации и только один
 * раз: referredBy ставится атомарно при условии, что его ещё нет.
 */
async function attachReferral(tenant, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,32}$/.test(code)) return false;
  const aff = await Affiliate.findOne({ code, blocked: false });
  if (!aff) return false;
  // Себя по своей же ссылке не привести.
  if (String(aff.tenantId) === String(tenant._id)) return false;

  const upd = await Tenant.updateOne(
    { _id: tenant._id, referredBy: null },
    { $set: { referredBy: aff._id, referredAt: new Date() } },
  );
  if (upd.modifiedCount) await Affiliate.updateOne({ _id: aff._id }, { $inc: { referralsCount: 1 } });
  return !!upd.modifiedCount;
}

/**
 * Начислить комиссию за оплату приглашённого. Идемпотентно: уникальный paymentId
 * в Commission не даст начислить дважды за одно уведомление ЮMoney.
 */
async function creditCommission(tenant, { paymentId, paidAmount }) {
  if (!tenant.referredBy || !paymentId || !(paidAmount > 0)) return null;
  const aff = await Affiliate.findById(tenant.referredBy);
  if (!aff || aff.blocked) return null;

  const amount = Math.floor(paidAmount * RATE);
  if (amount <= 0) return null;
  try {
    const c = await Commission.create({
      affiliateId: aff._id,
      referredTenantId: tenant._id,
      paymentId,
      paymentAmount: paidAmount,
      rate: RATE,
      amount,
      availableAt: new Date(Date.now() + HOLD_DAYS * 24 * 60 * 60 * 1000),
    });
    await Affiliate.updateOne({ _id: aff._id }, { $inc: { held: amount, totalEarned: amount } });
    return c;
  } catch (e) {
    if (e.code === 11000) return null; // уже начислено за этот платёж
    throw e;
  }
}

/** Перевести созревшие комиссии из удержания в доступные. Идемпотентно. */
async function releaseHeldCommissions() {
  const due = await Commission.find({ status: 'held', availableAt: { $lte: new Date() } }).limit(500);
  let released = 0;
  for (const c of due) {
    // Статус меняется, только если он всё ещё held — второй параллельный запуск
    // эту же комиссию не переведёт повторно.
    const r = await Commission.updateOne({ _id: c._id, status: 'held' }, { $set: { status: 'available' } });
    if (r.modifiedCount) {
      await Affiliate.updateOne({ _id: c.affiliateId }, { $inc: { held: -c.amount, balance: c.amount } });
      released++;
    }
  }
  return released;
}

/**
 * Запрос на вывод. Сумма резервируется ОДНИМ атомарным запросом при условии, что
 * на балансе её хватает, — два одновременных запроса не выведут больше, чем есть.
 * Один незакрытый запрос за раз.
 */
async function requestPayout(tenantId, { amount, details }) {
  const sum = Math.floor(Number(amount));
  const det = String(details || '').trim().slice(0, 300);
  if (!Number.isFinite(sum) || sum < MIN_PAYOUT) return { ok: false, error: `Минимальная сумма вывода — ${MIN_PAYOUT.toLocaleString('ru-RU')} ₽` };
  if (det.length < 6) return { ok: false, error: 'Укажите реквизиты для выплаты' };

  const aff = await Affiliate.findOne({ tenantId });
  if (!aff) return { ok: false, error: 'Вы не участник партнёрской программы' };
  if (aff.blocked) return { ok: false, error: 'Выплаты по вашему аккаунту приостановлены — напишите в поддержку' };
  if (await Payout.exists({ affiliateId: aff._id, status: 'pending' })) {
    return { ok: false, error: 'У вас уже есть запрос на вывод — дождитесь его обработки' };
  }

  const reserved = await Affiliate.findOneAndUpdate(
    { _id: aff._id, balance: { $gte: sum } },
    { $inc: { balance: -sum, reserved: sum } },
    { new: true },
  );
  if (!reserved) return { ok: false, error: 'Недостаточно средств, доступных к выводу' };

  const payout = await Payout.create({ affiliateId: aff._id, tenantId, amount: sum, details: det });
  return { ok: true, payout };
}

/** Решение по выводу — только владелец, через админку. Идемпотентно по статусу. */
async function resolvePayout(payoutId, { approve, actor, note }) {
  const p = await Payout.findOneAndUpdate(
    { _id: payoutId, status: 'pending' },
    { $set: { status: approve ? 'approved' : 'rejected', processedAt: new Date(), processedBy: actor, adminNote: String(note || '').slice(0, 500) } },
    { new: true },
  );
  if (!p) return { ok: false, error: 'Запрос не найден или уже обработан' };
  const inc = approve
    ? { reserved: -p.amount, totalWithdrawn: p.amount }
    : { reserved: -p.amount, balance: p.amount }; // отказ — деньги возвращаются на баланс
  await Affiliate.updateOne({ _id: p.affiliateId }, { $inc: inc });
  return { ok: true, payout: p };
}

/** Замаскированная почта для партнёра: видно, что человек есть, но не кто он. */
function maskEmail(email) {
  const e = String(email || '');
  if (/@oauth\.otkliks\.local$/i.test(e)) return /^yandex_/i.test(e) ? 'вход через Яндекс' : 'вход через VK';
  const [u, d] = e.split('@');
  if (!d) return '***';
  return `${u.slice(0, 2)}***@${d}`;
}

module.exports = {
  RATE, HOLD_DAYS, MIN_PAYOUT,
  joinProgram, attachReferral, creditCommission, releaseHeldCommissions,
  requestPayout, resolvePayout, maskEmail,
};
