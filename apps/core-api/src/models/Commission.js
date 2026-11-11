const mongoose = require('mongoose');

// Одна комиссия партнёру за одну оплату приглашённого. Отдельной коллекцией, а не
// массивом внутри партнёра (как было в Siberi): так каждая копейка прослеживается
// до конкретного платежа, а уникальный paymentId делает начисление идемпотентным —
// повторное уведомление ЮMoney о той же оплате физически не создаст вторую комиссию.
const commissionSchema = new mongoose.Schema({
  affiliateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Affiliate', required: true, index: true },
  referredTenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  paymentId: { type: String, required: true, unique: true },
  paymentAmount: { type: Number, required: true },
  rate: { type: Number, required: true },
  amount: { type: Number, required: true },
  // held → available по истечении удержания; reversed — если оплату вернули.
  status: { type: String, enum: ['held', 'available', 'reversed'], default: 'held', index: true },
  availableAt: { type: Date, required: true, index: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Commission', commissionSchema);
