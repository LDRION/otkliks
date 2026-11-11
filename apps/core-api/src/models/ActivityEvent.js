const mongoose = require('mongoose');

// Лента событий для дашборда/уведомлений — веб-эквивалент того, что в hhorosho шло только
// в Telegram (см. hhorosho/src/services/telegramBot.js). local-agent репортит сюда события
// через POST /api/events после каждого действия; сам он остаётся источником правды по
// своим локальным данным (SQLite) — это только лог для отображения на сайте/в лаунчере.
const activityEventSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    type: {
      type: String,
      enum: ['applied', 'reply', 'outcome', 'alert', 'form', 'interview_invite'],
      required: true,
    },
    title: String,
    company: String,
    // Для анкет: title — вакансия, formTitle — название самой формы. Раньше в title
    // шло название формы, и вакансия терялась («Анкета работодателя — Леста Игры»).
    formTitle: String,
    url: String,
    message: String,
    // Что именно автопилот написал от имени человека: текст сопроводительного или
    // ответа в чате. Раньше на сайте был виден только факт действия — «отклик
    // отправлен», — и проверить содержание было негде.
    details: String,
    incoming: String,
    // Заполненная анкета: вопрос → ответ.
    fields: [{ question: String, answer: String, _id: false }],
    outcome: { type: String, enum: ['interview', 'rejection', 'question', 'other'] },
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
);

activityEventSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('ActivityEvent', activityEventSchema);
