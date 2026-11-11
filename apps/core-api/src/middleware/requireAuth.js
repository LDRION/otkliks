const { verifyTenantToken, signTenantToken } = require('../lib/auth');

// Сессия живёт 30 дней от выдачи. Чтобы тех, кто пользуется сервисом, не выкидывало на
// 31-й день посреди работы, токен старше суток тихо перевыпускаем и отдаём в заголовке —
// лаунчер подхватывает его сам (coreApiClient). Веб-кабинет заголовок не читает и живёт
// по своей cookie, как раньше.
const RENEW_AFTER_SEC = 24 * 3600;
const Tenant = require('../models/Tenant');

// Bearer <JWT> — сессия клиента (веб-дашборд через BFF-прокси marketing-site, или сам
// local-agent, если решит работать без пейринга устройства — обычно нет, см. requireDevice).
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  // code — чтобы клиент отличал «сессия кончилась» от других 401 (например, «Текущий
  // пароль неверен» при смене пароля) и не разлогинивал человека из-за опечатки.
  if (!token) return res.status(401).json({ error: 'Не авторизован', code: 'SESSION_INVALID' });

  const payload = await verifyTenantToken(token);
  if (!payload) return res.status(401).json({ error: 'Сессия недействительна', code: 'SESSION_INVALID' });

  const tenant = await Tenant.findById(payload.tenantId);
  if (!tenant) return res.status(401).json({ error: 'Аккаунт не найден', code: 'SESSION_INVALID' });

  req.tenant = tenant;
  if (payload.iat && Date.now() / 1000 - payload.iat > RENEW_AFTER_SEC) {
    try { res.set('X-Session-Token', await signTenantToken(tenant)); } catch { /* продлим в другой раз */ }
  }
  next();
}

module.exports = { requireAuth };
