const mongoose = require('mongoose');

// Пометки админа об аккаунте: «это наш» (команда, свои тестовые входы) и заметка
// «кто это». Отдельно от Tenant, чтобы не трогать схему аккаунта ради админки.
// internal = true — аккаунт не считается в «реальных» пользователях и в сводке «Рост».
const adminMarkSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    internal: { type: Boolean, default: false },
    note: { type: String, default: '' },
    by: { type: String, default: '' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('AdminMark', adminMarkSchema);
