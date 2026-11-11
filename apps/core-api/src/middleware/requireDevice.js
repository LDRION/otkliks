const { parseDeviceToken, verifyDeviceSecret } = require('../lib/deviceToken');
const Tenant = require('../models/Tenant');

// Bearer <deviceId.secret> — local-agent после пейринга. Отдельно от requireAuth: девайс-
// токен долгоживущий и привязан к конкретной установке лаунчера, не к веб-сессии.
async function requireDevice(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const parsed = parseDeviceToken(token);
  if (!parsed) return res.status(401).json({ error: 'Не авторизовано (нет токена устройства)' });

  const tenant = await Tenant.findOne({ 'devices.deviceId': parsed.deviceId });
  if (!tenant) return res.status(401).json({ error: 'Устройство не привязано' });

  const device = tenant.devices.find((d) => d.deviceId === parsed.deviceId);
  const valid = device && (await verifyDeviceSecret(parsed.secret, device.tokenHash));
  if (!valid) return res.status(401).json({ error: 'Токен устройства недействителен' });

  device.lastSeenAt = new Date();
  await tenant.save();

  req.tenant = tenant;
  req.device = device;
  next();
}

module.exports = { requireDevice };
