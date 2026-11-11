const mongoose = require('mongoose');

// Вопрос, на который ИИ честно не может ответить сам (важный факт вне резюме/стека) —
// зеркало локальной таблицы clarifications в apps/local-agent/src/main/store.js. Нужен
// ОТДЕЛЬНОЙ моделью (не ActivityEvent): у записи есть жизненный цикл (задан → ответил
// человек → доставлено работодателю), а не разовое событие для ленты.
const clarificationSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    negotiationId: { type: String, required: true },
    vacancyTitle: String,
    company: String,
    url: String,
    question: { type: String, required: true },
    status: { type: String, enum: ['pending', 'answered', 'delivered'], default: 'pending' },
    answerText: String,
    aiImprove: { type: Boolean, default: true },
    sentText: String,
    answeredAt: Date,
    deliveredAt: Date,
  },
  { timestamps: true },
);

// Идемпотентность репорта — тот же вопрос по тому же треду не плодит дубли, если
// лаунчер сообщил о нём повторно (например, после перезапуска до следующего круга).
clarificationSchema.index({ tenantId: 1, negotiationId: 1, question: 1 }, { unique: true });

module.exports = mongoose.model('Clarification', clarificationSchema);
