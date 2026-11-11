const mongoose = require('mongoose');

// Запрос партнёра на вывод. Сумма РЕЗЕРВИРУЕТСЯ с баланса в момент запроса (см.
// lib/affiliate.js) — поэтому одновременные запросы не могут вывести больше, чем
// есть. Одобрение и отказ — только вручную владельцем в админке.
const payoutSchema = new mongoose.Schema({
  affiliateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Affiliate', required: true, index: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  amount: { type: Number, required: true, min: 1 },
  details: { type: String, required: true, maxlength: 300 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  requestedAt: { type: Date, default: Date.now },
  processedAt: Date,
  processedBy: String,
  adminNote: { type: String, maxlength: 500 },
});

module.exports = mongoose.model('Payout', payoutSchema);
