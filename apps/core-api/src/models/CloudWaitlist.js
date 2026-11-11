const mongoose = require('mongoose');

// Лист ожидания облачного тарифа: кто хочет, чтобы автопилот работал 24/7 без
// включённого компьютера. Нужен, чтобы решить, строить ли облако вообще, — это
// проверка спроса до вложений. Почта используется только для письма о запуске.
const cloudWaitlistSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  // Если человек записался из-под своего аккаунта — видно, платит ли он уже за
  // локальный тариф (самый ценный сигнал: такие перейдут первыми).
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
  source: { type: String, default: '', maxlength: 40 },         // landing | pricing
  referrerSource: { type: String, default: '', maxlength: 80 }, // откуда пришёл на сайт (utm/сайт)
  notifiedAt: { type: Date, default: null },                    // когда отправили письмо о запуске
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model('CloudWaitlist', cloudWaitlistSchema);
