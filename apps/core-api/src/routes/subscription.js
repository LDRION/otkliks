const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// Пробного периода больше нет — по умолчанию (subscription.status:'none') tenant
// постоянно на бесплатном тарифе (см. routes/agent.js, lib/planLimits.js), а не во
// временном льготном окне. Отдельного "активировать триал" эндпоинта тоже нет.
router.get('/', requireAuth, async (req, res) => {
  res.json({ subscription: req.tenant.subscription, isActive: req.tenant.isSubscriptionActive() });
});

module.exports = { router };
