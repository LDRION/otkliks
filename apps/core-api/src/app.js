const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { router: authRouter } = require('./routes/auth');
const { router: oauthRouter } = require('./routes/oauth');
const { promoRouter, affiliateRouter } = require('./routes/growth');
const { router: adminRouter } = require('./routes/admin');
const { router: profileRouter } = require('./routes/profile');
const { router: subscriptionRouter } = require('./routes/subscription');
const { router: paymentRouter } = require('./routes/payment');
const { router: devicesRouter } = require('./routes/devices');
const { router: agentRouter } = require('./routes/agent');
const { router: eventsRouter } = require('./routes/events');
const { router: statsRouter } = require('./routes/stats');
const { router: activityRouter } = require('./routes/activity');

/**
 * Убирает из тела и параметров запроса ключи, начинающиеся с `$` или содержащие
 * точку — операторы MongoDB. Без этого поле вида {"email": {"$ne": null}} может
 * превратить findOne в «найди кого угодно».
 *
 * Сейчас во всех роутах ввод и так приводится к строке (`String(req.body?...)`),
 * так что это защита на будущее: достаточно один раз забыть про приведение в
 * новом обработчике, и дыра появится. Здесь она закрыта в одном месте и для всех.
 */
function stripMongoOperators(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => stripMongoOperators(v, depth + 1));
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) delete value[key];
    else stripMongoOperators(value[key], depth + 1);
  }
  return value;
}

function createApp() {
  const app = express();

  // За nginx: без этого req.ip — всегда 127.0.0.1, и любая проверка по адресу
  // (в том числе будущая) считала бы всех клиентов одним.
  app.set('trust proxy', 1);

  // Заголовки безопасности. Основные их ставит nginx для сайта целиком, но API
  // отвечает и в обход (лаунчер, вебхук), плюс helmet убирает X-Powered-By,
  // которым Express сообщает всем свою версию. CSP отключён намеренно: это
  // JSON-API, страниц он не отдаёт, а на сайте своя политика в nginx.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.use(cors({ origin: (process.env.CORS_ORIGIN || '').split(',').filter(Boolean), credentials: false }));
  app.use(express.json({ limit: '2mb' }));

  app.use((req, _res, next) => {
    if (req.body) stripMongoOperators(req.body);
    if (req.query) stripMongoOperators(req.query);
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Вход через провайдеров — тоже под /api/auth (nginx уже проксирует этот
  // префикс сюда). Монтируется ПЕРЕД authRouter: у того в конце стоит обработчик
  // 404 на свои пути, и порядок здесь имеет значение.
  app.use('/api/auth', oauthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/profile/tasks', require('./routes/tasks').router);
  app.use('/api/profile', profileRouter);
  // Промокоды и партнёрка (кабинет) и админ-API. Наружу через nginx не выставлены:
  // зовёт только сервер сайта. Админ-API вдобавок закрыт отдельным ключом.
  app.use('/api/promo', promoRouter);
  app.use('/api/affiliate', affiliateRouter);
  app.use('/api/waitlist', require('./routes/waitlist'));
  app.use('/api/email', require('./routes/email'));
  app.use('/api/admin', adminRouter);
  app.use('/api/subscription', subscriptionRouter);
  app.use('/api/payment', paymentRouter);
  app.use('/api/devices', devicesRouter);
  app.use('/api/agent', agentRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/activity', activityRouter);

  app.use((req, res) => res.status(404).json({ error: 'Не найдено' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  return app;
}

module.exports = { createApp };
