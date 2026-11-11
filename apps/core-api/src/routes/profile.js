const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { publicTenant } = require('./auth');
const ResumeTrialUsage = require('../models/ResumeTrialUsage');
const { extractResumeId } = require('../lib/resumeId');

const router = express.Router();

// Бесплатный тариф даётся один раз НА РЕЗЮМЕ hh.ru, не на email — иначе один и тот же
// человек плодил бы новые бесплатные аккаунты под одно резюме и получал 10 откликов в
// день с КАЖДОГО, а не 10 суммарно. Первый tenant, подключивший резюме, «занимает» его;
// если резюме уже занято ДРУГИМ tenant — этому tenant бесплатный тариф не положен
// (freeTierBlocked=true), даже если сам он никогда не подключал платную подписку.
// Раньше проверялось только состояние status==='trialing' — имело смысл, пока
// бесплатный доступ был врéменным 24-часовым триалом. Теперь бесплатный тариф —
// постоянное состояние по умолчанию (status:'none'), поэтому проверяем именно
// ОТСУТСТВИЕ активной ПЛАТНОЙ подписки, а не конкретный старый статус — иначе эта
// проверка была бы мёртвым кодом для всех новых аккаунтов (они и так уже 'none').
// Платных подписчиков не трогаем совсем — они уже платят, значит для абузящих
// бесплатный тариф ботов это неинтересно, банить их незачем.
async function claimResumesOrBlockFreeTier(tenant, resumeProfiles) {
  if (tenant.isSubscriptionActive()) return false;

  for (const resume of resumeProfiles) {
    const resumeId = extractResumeId(resume.similarVacanciesUrl);
    if (!resumeId) continue;

    const existing = await ResumeTrialUsage.findOne({ resumeId });
    if (!existing) {
      await ResumeTrialUsage.create({ resumeId, tenantId: tenant._id }).catch(() => {});
    } else if (String(existing.tenantId) !== String(tenant._id)) {
      tenant.freeTierBlocked = true;
      return true;
    }
  }
  return false;
}

router.put('/', requireAuth, async (req, res) => {
  const { fullName, profile, resumeProfiles } = req.body || {};
  const tenant = req.tenant;

  if (typeof fullName === 'string') tenant.fullName = fullName.trim();

  if (profile && typeof profile === 'object') {
    if (Array.isArray(profile.strongStack)) tenant.profile.strongStack = profile.strongStack.map(String);
    if (Array.isArray(profile.honestGaps)) tenant.profile.honestGaps = profile.honestGaps.map(String);
    if (profile.minSalary && typeof profile.minSalary === 'object') {
      const amount = Math.max(0, Math.round(Number(profile.minSalary.amount) || 0));
      const currency = ['RUB', 'USD', 'EUR'].includes(profile.minSalary.currency)
        ? profile.minSalary.currency
        : 'RUB';
      tenant.profile.minSalary = { amount, currency };
    }
    if (typeof profile.contactTelegram === 'string') {
      const raw = profile.contactTelegram.trim().replace(/^https?:\/\/(?:t|telegram)\.me\//i, '').replace(/^@/, '');
      if (raw && !/^[A-Za-z0-9_]{5,32}$/.test(raw)) {
        return res.status(400).json({ error: 'Telegram указан неверно: нужен ник вида @username (5–32 латинских буквы, цифры или _)' });
      }
      tenant.profile.contactTelegram = raw ? `@${raw}` : '';
    }
    if (profile.portfolioLink && typeof profile.portfolioLink === 'object') {
      tenant.profile.portfolioLink = {
        domain: String(profile.portfolioLink.domain || ''),
        canonical: String(profile.portfolioLink.canonical || ''),
      };
    }
  }

  let trialRevoked = false;
  if (Array.isArray(resumeProfiles)) {
    const cleaned = resumeProfiles
      .filter((p) => p && p.key && p.similarVacanciesUrl)
      .map((p) => ({
        key: String(p.key),
        label: String(p.label || p.key),
        similarVacanciesUrl: String(p.similarVacanciesUrl),
      }));
    trialRevoked = await claimResumesOrBlockFreeTier(tenant, cleaned);
    tenant.resumeProfiles = cleaned;
  }

  await tenant.save();
  res.json({ tenant: publicTenant(tenant), trialRevoked });
});

module.exports = { router };
