const Tenant = require('../models/Tenant');
const { sendMail } = require('./mailer');
const { subscriptionExpiringEmail, trialEndingEmail } = require('./emailTemplates');
const { activeDiscount } = require('./promo');

const REMIND_WINDOW_HOURS = 48;

// Раз в тик планировщика: подписки, которые истекают в ближайшие REMIND_WINDOW_HOURS часов
// и ещё не получали напоминание за ЭТОТ период (reminderSentAt сбрасывается в null при
// каждом продлении — см. subscription.js/payment.js). Нет автопродления (кошелёк ЮMoney
// p2p так не умеет) — единственный способ не потерять клиента молча — напомнить заранее.
async function checkExpiringSubscriptions() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMIND_WINDOW_HOURS * 60 * 60 * 1000);

  const tenants = await Tenant.find({
    'subscription.status': { $in: ['trialing', 'active'] },
    'subscription.currentPeriodEnd': { $gt: now, $lte: windowEnd },
    'subscription.reminderSentAt': null,
  });

  for (const tenant of tenants) {
    // Пробный период по промокоду — своё письмо, про скидку на первую оплату.
    const mail = tenant.subscription.status === 'trialing'
      ? trialEndingEmail(tenant, { periodEnd: tenant.subscription.currentPeriodEnd, discountPercent: activeDiscount(tenant) })
      : subscriptionExpiringEmail(tenant, { periodEnd: tenant.subscription.currentPeriodEnd });
    const result = await sendMail({ to: tenant.email, ...mail });
    if (result.sent) {
      tenant.subscription.reminderSentAt = now;
      await tenant.save();
    }
  }

  if (tenants.length) console.log(`⏰ Напоминания об окончании подписки: ${tenants.length}`);
}

module.exports = { checkExpiringSubscriptions, REMIND_WINDOW_HOURS };
