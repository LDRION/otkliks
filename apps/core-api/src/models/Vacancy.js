const mongoose = require('mongoose');

// Тенант-версия hhorosho/src/models/Vacancy.js — тот же контракт (см. AutomationStorage
// в packages/automation-core/src/applyJob.js), плюс tenantId и не-enum resumeProfile
// (у каждого тенанта свои ключи профилей резюме, не фиксированные 'fullstack'/'ai_llm').
const vacancySchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    vacancyId: { type: String, required: true },
    resumeProfile: { type: String, required: true },
    title: String,
    company: String,
    companyKey: String,
    url: String,
    description: String,
    status: { type: String, enum: ['seen', 'applied', 'skipped', 'error'], default: 'seen' },
    skipReason: String,
    // Подробности к skipReason: что именно было на странице, когда отклик не прошёл
    // (кнопки, ответ агента форм). Без этого «вакансия подошла, но не откликнулись»
    // приходилось разбирать по логам с компьютера пользователя.
    skipDetail: String,
    coverLetterText: String,
    appliedAt: Date,
  },
  { timestamps: true },
);

vacancySchema.index({ tenantId: 1, vacancyId: 1, resumeProfile: 1 }, { unique: true });
vacancySchema.index({ tenantId: 1, companyKey: 1, status: 1 });
vacancySchema.index({ tenantId: 1, status: 1, appliedAt: -1 });

module.exports = mongoose.model('Vacancy', vacancySchema);
