const mongoose = require('mongoose');

// Ожидаемый платёж: создаётся в момент, когда человек нажимает «Оплатить», и
// хранит, СКОЛЬКО он должен заплатить. Вебхук сверяет пришедшую сумму с этой
// записью, а не верит цене из ссылки.
//
// Зачем: сумма в ссылке ЮMoney (sum=899) — обычный параметр адреса, его можно
// поправить руками. До этой модели вебхук суммы не сверял вовсе: оплата 2 ₽ с
// нашей меткой приходила честно подписанной — и давала месяц подписки. Подпись
// тут не защищает: уведомление настоящее, просто на копейки.
const pendingPaymentSchema = new mongoose.Schema({
  label: { type: String, required: true, unique: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  plan: { type: String, enum: ['weekly', 'monthly'], required: true },
  basePrice: { type: Number, required: true },
  // Столько человек должен заплатить с учётом скидки по промокоду.
  expectedAmount: { type: Number, required: true },
  discountPercent: { type: Number, default: 0 },
  promoCode: { type: String, default: null },
  consumedAt: { type: Date, default: null },
  // Незавершённые оплаты сами исчезают через 30 дней (TTL-индекс).
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
});

module.exports = mongoose.model('PendingPayment', pendingPaymentSchema);
