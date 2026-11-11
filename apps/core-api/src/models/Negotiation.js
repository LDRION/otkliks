const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    from: { type: String, enum: ['employer', 'ai'], required: true },
    text: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

// Тенант-версия hhorosho/src/models/Negotiation.js + outcome — классификация последнего
// сообщения работодателя (см. packages/automation-core/src/outcomeClassifier.js), нужна
// для статистики дашборда ("сколько отказов, сколько приглашений на собеседование"),
// которой в личном hhorosho не было (там только сырой Telegram-лог).
const negotiationSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    negotiationId: { type: String, required: true },
    vacancyId: String,
    resumeProfile: String,
    vacancyTitle: String,
    company: String,
    messages: { type: [messageSchema], default: [] },
    disclosureSent: { type: Boolean, default: false },
    lastRepliedAt: Date,
    status: { type: String, enum: ['active', 'closed', 'error'], default: 'active' },
    loopDetected: { type: Boolean, default: false },
    outcome: {
      type: String,
      enum: ['pending', 'interview', 'rejection', 'question', 'other', 'stack_mismatch', 'vacancy_closed'],
      default: 'pending',
    },
  },
  { timestamps: true },
);

negotiationSchema.index({ tenantId: 1, negotiationId: 1 }, { unique: true });
negotiationSchema.index({ tenantId: 1, outcome: 1 });

module.exports = mongoose.model('Negotiation', negotiationSchema);
