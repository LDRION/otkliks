const { SignJWT, jwtVerify } = require('jose');
const bcrypt = require('bcryptjs');

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET не задан в окружении core-api.');
  return new TextEncoder().encode(secret);
}

// Проверка адреса была всего лишь `email.includes('@')`. Через неё проходило
// что угодно с собакой внутри — в том числе строка с переводом строки, которая
// потом уходила в поле `to` при отправке письма. Это путь к подстановке чужих
// получателей (заголовок Bcc после \r\n) и к рассылке с нашего SMTP от нашего
// же домена: репутацию отправителя такое сжигает за один заход.
//
// Здесь намеренно строгая, а не «идеально полная по RFC» проверка: почтовые
// адреса с экзотикой (кавычки, пробелы, юникод в локальной части) в реальной
// регистрации не встречаются, а каждая допущенная вольность — это то, что потом
// попадёт в SMTP-конверт.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const EMAIL_MAX = 254; // предел длины адреса по RFC 5321

function isValidEmail(value) {
  const email = String(value ?? '');
  if (email.length < 6 || email.length > EMAIL_MAX) return false;
  // Управляющие символы (в первую очередь \r и \n) отсекаем отдельно и явно —
  // это ровно то, чем разделяются заголовки письма.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(email)) return false;
  return EMAIL_RE.test(email);
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Токен возвращается в теле ответа (не cookie) — им пользуется и local-agent (Electron,
// хранит локально), и marketing-site как BFF (хранит в своей httpOnly cookie и
// подставляет как Bearer при проксировании запросов в core-api). См. ARCHITECTURE.md.
async function signTenantToken(tenant) {
  // fullName — чтобы шапка кабинета могла показать имя человека, а не рыться
  // за ним в базе на каждой навигации (сессия и задумана самодостаточной).
  // fullName сейчас не редактируется пользователем после создания аккаунта,
  // так что «протухание» в токене на 30 дней не проблема; появится редактирование
  // — надо будет либо перевыпускать токен при сохранении, либо смириться с
  // задержкой до следующего входа.
  return new SignJWT({ tenantId: String(tenant._id), email: tenant.email, fullName: tenant.fullName || '' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecret());
}

async function verifyTenantToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.tenantId === 'string') return payload;
    return null;
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signTenantToken, verifyTenantToken, isValidEmail };
