const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

// Токен устройства = `${deviceId}.${secret}`. deviceId — публичный, индексируемый
// (быстрый lookup нужного Tenant.devices элемента); secret хешируется (bcrypt) и
// сверяется только после того, как нашли нужную запись по deviceId — так не нужен
// полный скан всех тенантов на каждый запрос local-agent (а он ходит часто).
function generateDeviceToken() {
  const deviceId = crypto.randomBytes(9).toString('base64url');
  const secret = crypto.randomBytes(24).toString('base64url');
  return { deviceId, secret, token: `${deviceId}.${secret}` };
}

function parseDeviceToken(token) {
  if (typeof token !== 'string') return null;
  const idx = token.indexOf('.');
  if (idx < 0) return null;
  return { deviceId: token.slice(0, idx), secret: token.slice(idx + 1) };
}

async function hashDeviceSecret(secret) {
  return bcrypt.hash(secret, 10);
}

async function verifyDeviceSecret(secret, hash) {
  return bcrypt.compare(secret, hash);
}

module.exports = { generateDeviceToken, parseDeviceToken, hashDeviceSecret, verifyDeviceSecret };
