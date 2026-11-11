require('dotenv').config();

const { connectDb } = require('./db');
const { createApp } = require('./app');
const { checkExpiringSubscriptions } = require('./lib/subscriptionReminders');
const { checkActivationEmails } = require('./lib/activationEmails');
const { releaseHeldCommissions } = require('./lib/affiliate');

const PORT = process.env.PORT || 4000;
// Слушаем только петлю. Наружу API попадает исключительно через nginx (там же
// стоят TLS и лимиты частоты) — открытый порт на всех интерфейсах давал бы
// способ обойти и то, и другое, если файрвол когда-нибудь окажется выключен.
const HOST = process.env.HOST || '127.0.0.1';
const REMINDER_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function main() {
  await connectDb();
  const app = createApp();
  app.listen(PORT, HOST, () => console.log(`core-api слушает на ${HOST}:${PORT}`));

  // Партнёрские комиссии переходят из удержания в доступные к выводу.
  const release = () => releaseHeldCommissions()
    .then((n) => n && console.log(`Партнёрские комиссии доступны к выводу: ${n}`))
    .catch((e) => console.error('releaseHeldCommissions:', e.message));
  release();
  setInterval(release, 60 * 60 * 1000);

  setInterval(() => {
    checkExpiringSubscriptions().catch((e) => console.error('checkExpiringSubscriptions:', e.message));
  }, REMINDER_INTERVAL_MS);

  // Подсказки «что осталось до запуска» — раз в час, днём по Москве (8–22),
  // чтобы письмо не приходило ночью.
  setInterval(() => {
    const mskHour = (new Date().getUTCHours() + 3) % 24;
    if (mskHour < 8 || mskHour >= 22) return;
    checkActivationEmails().catch((e) => console.error('checkActivationEmails:', e.message));
  }, 60 * 60 * 1000);
}

process.on('unhandledRejection', (r) => console.error('unhandledRejection:', r?.message || r));

main().catch((err) => {
  console.error('Критическая ошибка запуска core-api:', err.message);
  process.exit(1);
});
