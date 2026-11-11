const crypto = require('crypto');
const Tenant = require('../models/Tenant');
const Vacancy = require('../models/Vacancy');
const { sendMail } = require('./mailer');
const { activationStepsEmail, activationFirstRunEmail } = require('./emailTemplates');

// Письма-подсказки тем, кто зарегистрировался, но не дошёл до первых откликов.
// Большинство регистраций без них так и остаются пустыми: человек отвлёкся и забыл.
//
//   • через сутки после регистрации — «осталось: резюме / лаунчер» (что не сделано);
//   • на 4-й день — одно повторное, если всё ещё не сделано;
//   • лаунчер подключён больше двух суток, а откликов 0 — «нажмите Запустить».
//
// Каждое письмо — один раз (отметки в tenant.activationMail). Не больше трёх за всю
// жизнь аккаунта. Только аккаунты не старше 30 дней: будить давно ушедших — спам.
// Отписка — emailPrefs.tips=false (служебные письма это не выключает).

const SITE_URL = process.env.SITE_URL || 'https://otkliks.ru';
const H = 60 * 60 * 1000;
const MAX_AGE = 30 * 24 * H;

function unsubToken(tenantId) {
  return crypto.createHmac('sha256', String(process.env.AUTH_SECRET || ''))
    .update(`unsub:${tenantId}`).digest('base64url').slice(0, 32);
}

function verifyUnsubToken(tenantId, token) {
  const a = Buffer.from(unsubToken(tenantId));
  const b = Buffer.from(String(token || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function unsubUrl(tenantId) {
  return `${SITE_URL}/unsubscribe?u=${tenantId}&t=${unsubToken(tenantId)}`;
}

// Заголовки «Отписаться» для почтовиков (RFC 8058): Gmail/Яндекс показывают кнопку
// прямо в письме, и такие рассылки реже попадают в спам.
function unsubHeaders(tenantId) {
  return {
    'List-Unsubscribe': `<${SITE_URL}/unsubscribe/one-click?u=${tenantId}&t=${unsubToken(tenantId)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

async function send(tenant, mail, mark) {
  const r = await sendMail({ to: tenant.email, ...mail, headers: unsubHeaders(tenant._id) });
  // Отметку ставим и когда письмо не ушло по «вечной» причине (нет настоящей почты),
  // иначе такой аккаунт перебирался бы на каждом тике.
  if (r.sent || r.reason === 'no-real-email' || r.reason === 'reserved-domain') {
    await Tenant.updateOne({ _id: tenant._id }, { $set: { [`activationMail.${mark}`]: new Date() } });
  }
  return r.sent;
}

async function checkActivationEmails(now = new Date()) {
  const since = new Date(now.getTime() - MAX_AGE);
  const tenants = await Tenant.find({
    createdAt: { $gte: since, $lte: new Date(now.getTime() - 24 * H) },
    'emailPrefs.tips': { $ne: false },
    email: { $not: /@oauth\.otkliks\.local$/ },
  }).select('email fullName createdAt resumeProfiles devices activationMail').lean();

  let sent = 0;
  for (const t of tenants) {
    const am = t.activationMail || {};
    const needResume = !(t.resumeProfiles || []).length;
    const needLauncher = !(t.devices || []).length;
    const age = now.getTime() - new Date(t.createdAt).getTime();

    if (needResume || needLauncher) {
      if (!am.stepsAt) {
        if (await send(t, activationStepsEmail(t, { needResume, needLauncher, again: false, unsubUrl: unsubUrl(t._id) }), 'stepsAt')) sent++;
      } else if (!am.stepsAgainAt && age >= 4 * 24 * H && now.getTime() - new Date(am.stepsAt).getTime() >= 48 * H) {
        if (await send(t, activationStepsEmail(t, { needResume, needLauncher, again: true, unsubUrl: unsubUrl(t._id) }), 'stepsAgainAt')) sent++;
      }
      continue;
    }

    // Всё подключено — но отправлен ли хоть один отклик?
    if (am.firstRunAt) continue;
    const pairedAt = Math.min(...t.devices.map((d) => new Date(d.pairedAt || t.createdAt).getTime()));
    if (now.getTime() - pairedAt < 48 * H) continue;
    const applied = await Vacancy.exists({ tenantId: t._id, status: 'applied' });
    if (applied) {
      // Уже работает — письмо не нужно, помечаем, чтобы больше не проверять.
      await Tenant.updateOne({ _id: t._id }, { $set: { 'activationMail.firstRunAt': new Date(0) } });
      continue;
    }
    if (await send(t, activationFirstRunEmail(t, { unsubUrl: unsubUrl(t._id) }), 'firstRunAt')) sent++;
  }
  if (sent) console.log(`📬 Подсказки о запуске: отправлено ${sent}`);
  return sent;
}

module.exports = { checkActivationEmails, verifyUnsubToken, unsubToken, unsubUrl };
