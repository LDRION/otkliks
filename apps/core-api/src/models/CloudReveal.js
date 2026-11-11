const mongoose = require('mongoose');

// «Открыл описание облачного тарифа» на главной: карточка там размыта до клика, и сам
// клик — сигнал интереса, более мягкий, чем запись в лист ожидания. Считаем
// УНИКАЛЬНЫХ посетителей: visitor — случайный id из браузера (localStorage), с
// человеком не связан и персональных данных не содержит.
const cloudRevealSchema = new mongoose.Schema({
  visitor: { type: String, required: true, unique: true, maxlength: 64 },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null },
  referrerSource: { type: String, default: '', maxlength: 80 },
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model('CloudReveal', cloudRevealSchema);
