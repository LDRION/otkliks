const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { generateDeviceToken, hashDeviceSecret } = require('../lib/deviceToken');

const router = express.Router();

// local-agent логинится один раз обычным email+паролем (requireAuth через POST /auth/login),
// затем сразу меняет эту сессию на долгоживущий токен устройства — дальше пароль ему не
// нужен и не хранится. Токен возвращается ОДИН раз в момент регистрации, дальше видно
// только deviceId/label (см. GET) — как обычный API-key флоу.
router.post('/register', requireAuth, async (req, res) => {
  const label = String(req.body?.label || 'Локальный агент').slice(0, 100);
  const { deviceId, secret, token } = generateDeviceToken();

  req.tenant.devices.push({
    deviceId,
    label,
    tokenHash: await hashDeviceSecret(secret),
    pairedAt: new Date(),
  });
  await req.tenant.save();

  res.status(201).json({ token, deviceId, label });
});

router.get('/', requireAuth, async (req, res) => {
  res.json({
    devices: req.tenant.devices.map((d) => ({
      deviceId: d.deviceId,
      label: d.label,
      pairedAt: d.pairedAt,
      lastSeenAt: d.lastSeenAt,
    })),
  });
});

router.delete('/:deviceId', requireAuth, async (req, res) => {
  const before = req.tenant.devices.length;
  req.tenant.devices = req.tenant.devices.filter((d) => d.deviceId !== req.params.deviceId);
  if (req.tenant.devices.length === before) return res.status(404).json({ error: 'Устройство не найдено' });
  await req.tenant.save();
  res.status(204).end();
});

module.exports = { router };
