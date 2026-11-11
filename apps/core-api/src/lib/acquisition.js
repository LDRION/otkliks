const Tenant = require('../models/Tenant');
const { redeemPromo } = require('./promo');
const { attachReferral } = require('./affiliate');

// Всё, что происходит с НОВЫМ аккаунтом в момент регистрации: промокод, партнёр,
// источник. Одна функция для обоих путей регистрации (почта и Яндекс/VK), чтобы
// они не расходились.
//
// Входные данные приходят из cookie браузера — то есть от самого человека, и
// доверять им нельзя. Поэтому каждое значение проверяется: код — по базе,
// utm-метки — обрезаются и чистятся от всего, кроме безопасных символов.

const clean = (v, max = 80) =>
  String(v || '').slice(0, max).replace(/[^\p{L}\p{N}._\-+ /:]/gu, '').trim() || undefined;

function parseSource(raw) {
  if (!raw) return null;
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || typeof o !== 'object') return null;
    const src = {
      source: clean(o.s),
      medium: clean(o.m),
      campaign: clean(o.c),
      content: clean(o.ct),
      referrerHost: clean(o.r, 120),
      landingPath: clean(o.l, 200),
      firstSeenAt: Number.isFinite(o.t) ? new Date(o.t) : undefined,
    };
    return Object.values(src).some(Boolean) ? src : null;
  } catch {
    return null;
  }
}

/** Разбор заголовка Cookie без зависимостей. */
function readCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* битое значение — пропускаем */ }
  });
  return out;
}

async function applyAcquisition(tenant, { ref, promo, src } = {}) {
  const result = { referral: false, promo: null };
  try {
    if (ref) result.referral = await attachReferral(tenant, ref);
  } catch (e) { console.error('acquisition/ref:', e.message); }
  try {
    const parsed = parseSource(src);
    if (parsed) await Tenant.updateOne({ _id: tenant._id, 'acquisition.source': { $in: [null] } }, { $set: { acquisition: parsed } });
  } catch (e) { console.error('acquisition/src:', e.message); }
  try {
    if (promo) {
      const fresh = await Tenant.findById(tenant._id);
      result.promo = await redeemPromo(fresh, promo);
    }
  } catch (e) { console.error('acquisition/promo:', e.message); }
  return result;
}

module.exports = { applyAcquisition, readCookies, parseSource };
