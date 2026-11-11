const crypto = require('crypto');
const PromoCode = require('../models/PromoCode');
const Tenant = require('../models/Tenant');

const DAY = 24 * 60 * 60 * 1000;

// Алфавит без похожих символов (0/O, 1/I/L) — код могут продиктовать голосом.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Криптостойкий код: 10 символов из 31 — перебрать ~8·10^14 вариантов нереально. */
function generateCode(len = 10) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const CODE_RE = /^[A-Z0-9]{4,32}$/;
function normalizeCode(v) {
  const c = String(v || '').trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

function isUsable(p, now = new Date()) {
  return p && p.active && p.redemptions < p.maxRedemptions && (!p.expiresAt || p.expiresAt > now);
}

/** Что увидит человек до активации: только условия, без заметок админа. */
function publicOffer(p) {
  return {
    code: p.code,
    trialDays: p.trialDays,
    trialDailyCap: p.trialDailyCap,
    discountPercent: p.discountPercent,
    discountValidDays: p.discountValidDays,
  };
}

async function describePromo(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const p = await PromoCode.findOne({ code }).lean();
  return isUsable(p) ? publicOffer(p) : null;
}

/**
 * Активация промокода арендатором. Возвращает { ok, reason, offer }.
 *
 * Гонку «одну одноразовую ссылку открыли двое одновременно» закрывает сам запрос:
 * счётчик увеличивается атомарно и ТОЛЬКО если redemptions < maxRedemptions.
 * Проверка «прочитать и потом записать» пропустила бы обоих.
 */
async function redeemPromo(tenant, rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: 'invalid' };
  if (tenant.promo?.code) return { ok: false, reason: 'already-has-promo' };

  // Пробный период поверх уже оплаченной подписки бессмыслен и испортил бы её
  // статус — такой человек получает только скидку на следующую оплату.
  const hasPaid = tenant.subscription?.status === 'active' && tenant.isSubscriptionActive();

  const now = new Date();
  const p = await PromoCode.findOneAndUpdate(
    {
      code,
      active: true,
      $expr: { $lt: ['$redemptions', '$maxRedemptions'] },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      'redeemedBy.tenantId': { $ne: tenant._id },
    },
    { $inc: { redemptions: 1 }, $push: { redeemedBy: { tenantId: tenant._id, at: now } } },
    { new: true },
  );
  if (!p) return { ok: false, reason: 'unavailable' };

  // Атомарно пишем промо арендатору — и только если промо у него ещё нет. Если
  // между проверкой выше и этой записью он успел активировать другой код, откатываем
  // счётчик: ссылка не должна «сгорать» впустую.
  const set = {
    'promo.code': p.code,
    'promo.redeemedAt': now,
    'promo.discountPercent': p.discountPercent,
    'promo.discountExpiresAt': new Date(now.getTime() + p.discountValidDays * DAY),
  };
  if (!hasPaid && p.trialDays > 0) {
    set['subscription.status'] = 'trialing';
    set['subscription.currentPeriodEnd'] = new Date(now.getTime() + p.trialDays * DAY);
    set['subscription.reminderSentAt'] = null;
    set.dailyCap = p.trialDailyCap;
  }
  const upd = await Tenant.updateOne({ _id: tenant._id, 'promo.code': { $in: [null] } }, { $set: set });
  if (!upd.modifiedCount) {
    await PromoCode.updateOne({ _id: p._id }, { $inc: { redemptions: -1 }, $pull: { redeemedBy: { tenantId: tenant._id } } });
    return { ok: false, reason: 'already-has-promo' };
  }
  return { ok: true, offer: publicOffer(p), trialGranted: !hasPaid && p.trialDays > 0 };
}

/** Скидка, которая действует сейчас: не использована и не истекла. */
function activeDiscount(tenant, now = new Date()) {
  const pr = tenant.promo || {};
  if (!pr.discountPercent || pr.discountUsedAt) return 0;
  if (pr.discountExpiresAt && pr.discountExpiresAt < now) return 0;
  return Math.min(90, Math.max(0, pr.discountPercent));
}

module.exports = { generateCode, normalizeCode, describePromo, redeemPromo, activeDiscount, publicOffer, isUsable };
