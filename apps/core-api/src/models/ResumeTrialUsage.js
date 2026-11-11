const mongoose = require('mongoose');

// Один документ на hh.ru-резюме, когда-либо использованное для пробного периода — не
// per-tenant. Первый tenant, подключивший это резюме, "занимает" его; любой другой
// tenant, подключивший то же резюме, теряет пробный период (см. routes/profile.js) —
// иначе один и тот же резюме-профиль можно продвигать бесконечным потоком email-ов.
const resumeTrialUsageSchema = new mongoose.Schema(
  {
    resumeId: { type: String, required: true, unique: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('ResumeTrialUsage', resumeTrialUsageSchema);
