const mongoose = require('mongoose');

// Персональные промо-ссылки: владелец находит человека с конкретной болью и даёт
// ему уникальное предложение — например, 3 дня полного автопилота бесплатно
// (200 откликов в день, как на платном) и потом скидку 50% на первую оплату.
//
// По умолчанию ссылка ОДНОРАЗОВАЯ (maxRedemptions = 1): она персональная, и если
// её перешлют дальше, второй человек подарок уже не получит.
const promoCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  // Заметка только для админки: кому выдана и почему. Наружу не отдаётся никогда.
  note: { type: String, default: '', maxlength: 500 },

  trialDays: { type: Number, default: 3, min: 0, max: 30 },
  trialDailyCap: { type: Number, default: 200, min: 10, max: 200 },
  discountPercent: { type: Number, default: 50, min: 0, max: 90 },
  // Сколько дней после активации действует скидка на первую оплату.
  discountValidDays: { type: Number, default: 14, min: 1, max: 90 },

  maxRedemptions: { type: Number, default: 1, min: 1, max: 10000 },
  redemptions: { type: Number, default: 0 },
  redeemedBy: {
    type: [{
      tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
      at: { type: Date, default: Date.now },
      _id: false,
    }],
    default: [],
  },

  // Запас для ручной раздачи: заранее созданные ссылки. Кнопка «Взять ссылку»
  // выдаёт следующую ещё не выданную и ставит issuedAt — одну и ту же ссылку
  // нельзя случайно отдать двум людям.
  stock: { type: Boolean, default: false },
  issuedAt: { type: Date, default: null },
  issuedBy: { type: String, default: '' },

  active: { type: Boolean, default: true },
  expiresAt: { type: Date, default: null },
  createdBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

promoCodeSchema.index({ stock: 1, issuedAt: 1, createdAt: 1 });

module.exports = mongoose.model('PromoCode', promoCodeSchema);
