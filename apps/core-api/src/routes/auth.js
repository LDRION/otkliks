const crypto = require('crypto');
const express = require('express');
const Tenant = require('../models/Tenant');
const { hashPassword, verifyPassword, signTenantToken, isValidEmail } = require('../lib/auth');
const { requireAuth } = require('../middleware/requireAuth');
const { sendMail } = require('../lib/mailer');
const { welcomeEmail, passwordResetEmail, passwordChangedEmail, confirmEmailEmail } = require('../lib/emailTemplates');
const { isOAuthOnly, isSyntheticEmail } = require('../lib/oauthTenant');
const { effectiveDailyCap } = require('../lib/planLimits');
const { tasksState } = require('../lib/freeTasks');
const { applyAcquisition } = require('../lib/acquisition');
const { activeDiscount } = require('../lib/promo');

const router = express.Router();

const SITE_URL = process.env.SITE_URL || 'https://otkliks.ru';
const RESET_TTL_MINUTES = 60;
// Повторный запрос на ту же почту не чаще, чем раз в минуту: иначе форму
// восстановления можно использовать как бесплатную рассылку по чужому адресу.
const RESET_RESEND_COOLDOWN_MS = 60 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function publicTenant(tenant) {
  // Не tenant.dailyCap напрямую — это ЦИФРА ПЛАТНОГО тарифа (схемный default 200) и
  // хранится на арендаторе независимо от того, активна ли у него подписка. Без
  // subscription (бесплатный тариф) реальный лимит — FREE_DAILY_CAP (10), лаунчер и
  // кабинет должны видеть именно его, а не 200, которые в этом случае не применяются.
  const dailyCap = effectiveDailyCap(tenant);
  const today = Tenant.mskDateKey();
  const usedToday = tenant.dailyUsage?.date === today ? tenant.dailyUsage.count : 0;
  return {
    id: tenant._id,
    email: tenant.email,
    // У аккаунтов из VK без почты email — техническая заглушка. Кабинет по этому
    // флагу просит указать настоящий адрес, а не показывает заглушку как почту.
    emailIsPlaceholder: isSyntheticEmail(tenant.email),
    // Адрес, ожидающий подтверждения — чтобы кабинет показал «письмо отправлено
    // на …», а не снова пустую форму.
    pendingEmail: tenant.pendingEmail?.address && tenant.pendingEmail.expiresAt > new Date()
      ? tenant.pendingEmail.address : null,
    fullName: tenant.fullName,
    // Промо: действующая скидка на первую оплату и срок пробного периода.
    promo: tenant.promo?.code ? {
      discountPercent: activeDiscount(tenant),
      discountExpiresAt: tenant.promo.discountExpiresAt || null,
      trialEndsAt: tenant.subscription?.status === 'trialing' ? tenant.subscription.currentPeriodEnd : null,
    } : null,
    profile: tenant.profile,
    resumeProfiles: tenant.resumeProfiles,
    subscription: tenant.subscription,
    isSubscriptionActive: tenant.isSubscriptionActive(),
    // Без этого поля лаунчер не знал дневного лимита и молча брал своё значение по
    // умолчанию — сорок. Лимит можно было поднять в базе сколько угодно раз, автопилот
    // всё равно останавливался на сороковом отклике.
    dailyCap,
    dailyUsed: usedToday,
    freeTierBlocked: !!tenant.freeTierBlocked,
    // Задания бесплатного тарифа: лаунчер по pending ставит автопилот на паузу и
    // показывает карточку задания, кабинет — то же самое. null — у платных.
    freeTasks: tasksState(tenant),
    devices: tenant.devices.map((d) => ({
      deviceId: d.deviceId,
      label: d.label,
      pairedAt: d.pairedAt,
      lastSeenAt: d.lastSeenAt,
    })),
  };
}

// Редакция документа otkliks.ru/consent — меняется вместе с его текстом.
const CONSENT_VERSION = '2026-09-27';

router.post('/register', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  // Предел длины: без него в имя можно было положить мегабайты (тело запроса до 2 МБ).
  const fullName = String(req.body?.fullName || '').trim().slice(0, 100);

  if (!isValidEmail(email) || password.length < 8) {
    return res.status(400).json({ error: 'Некорректный email или пароль (минимум 8 символов)' });
  }
  // Длина пароля сверху тоже нужна: bcrypt считает хеш тем дольше, чем длиннее
  // вход, и мегабайтный «пароль» превращается в способ занять процессор.
  if (password.length > 200) {
    return res.status(400).json({ error: 'Пароль слишком длинный (максимум 200 символов)' });
  }

  // Согласие на обработку ПД (152-ФЗ) — обязательно и отдельной галочкой. Сайт и
  // лаунчер с 1.0.1 присылают consent:true; старый лаунчер без галочки получит
  // понятную просьбу обновиться (он и так обновляется сам при запуске).
  if (req.body?.consent !== true) {
    return res.status(400).json({
      error: 'Отметьте согласие на обработку персональных данных. Если регистрируетесь в лаунчере — обновите его или зарегистрируйтесь на сайте otkliks.ru',
      reason: 'CONSENT_REQUIRED',
    });
  }

  const existing = await Tenant.findOne({ email });
  if (existing) return res.status(409).json({ error: 'Аккаунт с таким email уже существует' });

  // Раньше здесь выдавался «пробный период» — 24 часа status:'trialing', после которых
  // автопилот полностью блокировался (402 на любое действие). Теперь пробного периода
  // как отдельного статуса нет: subscription остаётся дефолтным ('none'), и это
  // нормальное постоянное состояние — routes/agent.js уже не требует активной подписки
  // для работы автопилота вообще, а просто даёт ей бесплатный тариф (10 откликов в
  // день, только отклик+сопроводительное, без переписки и форм) вместо платного.
  const tenant = await Tenant.create({
    email,
    passwordHash: await hashPassword(password),
    fullName,
    consent: {
      at: new Date(),
      source: req.body?.consentSource === 'launcher' ? 'launcher' : 'site',
      version: CONSENT_VERSION,
    },
  });

  // Партнёр, промокод и источник — из cookie, которые сайт передаёт вместе с
  // формой. Все значения проверяются внутри applyAcquisition.
  await applyAcquisition(tenant, {
    ref: req.body?.ref, promo: req.body?.promo, src: req.body?.src,
  });
  const fresh = await Tenant.findById(tenant._id);

  const token = await signTenantToken(fresh);
  res.status(201).json({ token, tenant: publicTenant(fresh) });

  // Спред, а не {subject, html}: у шаблонов есть ещё и написанная руками text-версия,
  // при выборочной распаковке она терялась и подставлялась регулярками из HTML.
  sendMail({ to: tenant.email, ...welcomeEmail(tenant) }).catch(() => {});
});

router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  const tenant = await Tenant.findOne({ email });

  // Аккаунт заведён через Яндекс или VK — пароля у него нет вовсе. Без этой
  // ветки человек получал бы «неверный email или пароль» и не понимал, почему:
  // он-то уверен, что аккаунт есть. Подсказываем, чем входить.
  // Раскрытием чужих аккаунтов это не является: сюда попадает только тот, кто
  // уже назвал существующую почту, а сам факт регистрации он и так видит.
  if (tenant && isOAuthOnly(tenant.passwordHash)) {
    const provider = tenant.passwordHash.split(':')[1] === 'vk' ? 'VK' : 'Яндекс';
    return res.status(401).json({
      error: `Этот аккаунт создан через ${provider} — войдите той же кнопкой. Если нужен вход по паролю, задайте его через «Забыли пароль?».`,
      oauthProvider: provider,
    });
  }

  const valid = tenant ? await verifyPassword(password, tenant.passwordHash) : false;
  if (!tenant || !valid) return res.status(401).json({ error: 'Неверный email или пароль' });

  const token = await signTenantToken(tenant);
  res.json({ token, tenant: publicTenant(tenant) });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ tenant: publicTenant(req.tenant) });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < 8 || newPassword.length > 200) {
    return res.status(400).json({ error: 'Новый пароль — от 8 до 200 символов' });
  }
  const valid = await verifyPassword(currentPassword, req.tenant.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Текущий пароль неверен' });

  req.tenant.passwordHash = await hashPassword(newPassword);
  await req.tenant.save();
  res.status(204).end();

  const changed = passwordChangedEmail(req.tenant);
  sendMail({ to: req.tenant.email, ...changed }).catch(() => {});
});

// ── Забыли пароль: запрос ссылки ────────────────────────────────────────────
// Отвечаем 204 ВСЕГДА, даже если такой почты нет. Иначе форма превращается в
// проверялку «есть ли у вас аккаунт в Откликс» — по ней можно перебрать список
// адресов и узнать, кто из них ищет работу. Для человека разницы нет: он и так
// видит «если аккаунт есть, письмо придёт».
router.post('/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  res.status(204).end();

  if (!isValidEmail(email)) return;

  try {
    const tenant = await Tenant.findOne({ email });
    if (!tenant) return;

    const lastRequest = tenant.passwordReset?.requestedAt;
    if (lastRequest && Date.now() - new Date(lastRequest).getTime() < RESET_RESEND_COOLDOWN_MS) return;

    // Сам токен уходит только в письмо, в базу кладём его хеш.
    const token = crypto.randomBytes(32).toString('hex');
    tenant.passwordReset = {
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
      usedAt: null,
      requestedAt: new Date(),
    };
    await tenant.save();

    const resetUrl = `${SITE_URL}/app/reset?token=${token}`;
    const mail = passwordResetEmail(tenant, { resetUrl, ttlMinutes: RESET_TTL_MINUTES });
    await sendMail({ to: tenant.email, ...mail });
  } catch (e) {
    console.error('auth.forgot-password:', e.message);
  }
});

// ── Забыли пароль: установка нового ─────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');

  if (password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: 'Пароль — от 8 до 200 символов' });
  }
  if (!token) return res.status(400).json({ error: 'Ссылка неполная — откройте её из письма целиком' });

  // Ищем по хешу: в базе открытого токена нет, поэтому сравнивать не с чем иначе.
  const tenant = await Tenant.findOne({
    'passwordReset.tokenHash': hashToken(token),
    'passwordReset.expiresAt': { $gt: new Date() },
    'passwordReset.usedAt': null,
  });

  if (!tenant) {
    return res.status(400).json({
      error: 'Ссылка недействительна или устарела. Запросите восстановление пароля заново.',
    });
  }

  tenant.passwordHash = await hashPassword(password);
  tenant.passwordReset.usedAt = new Date();
  tenant.passwordReset.tokenHash = null;
  await tenant.save();

  // Сразу пускаем в кабинет: человек только что доказал, что владеет почтой,
  // заставлять его после этого ещё раз вводить пароль — лишний шаг на ровном месте.
  const authToken = await signTenantToken(tenant);
  res.json({ token: authToken, tenant: publicTenant(tenant) });

  const changed = passwordChangedEmail(tenant);
  sendMail({ to: tenant.email, ...changed }).catch(() => {});
});

// ── Указать / сменить почту ─────────────────────────────────────────────────
// Главный случай — вход через VK без почты: у такого аккаунта вместо адреса
// заглушка, и мы не можем прислать ни чек об оплате, ни ссылку восстановления.
// Адрес сразу в email НЕ пишем: при опечатке письма (включая сброс пароля)
// уходили бы постороннему. Сначала подтверждение по ссылке из письма.
const EMAIL_CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_RESEND_COOLDOWN_MS = 60 * 1000;

router.post('/email', requireAuth, async (req, res) => {
  const address = String(req.body?.email || '').trim().toLowerCase();
  if (!isValidEmail(address)) return res.status(400).json({ error: 'Проверьте адрес — похоже, в нём опечатка' });
  if (address === req.tenant.email) return res.status(400).json({ error: 'Это уже ваш адрес' });

  const taken = await Tenant.exists({ email: address });
  if (taken) {
    return res.status(409).json({
      error: 'На этот адрес уже зарегистрирован другой аккаунт. Войдите в него или укажите другую почту.',
    });
  }

  const last = req.tenant.pendingEmail?.requestedAt;
  if (last && Date.now() - new Date(last).getTime() < EMAIL_RESEND_COOLDOWN_MS) {
    return res.status(429).json({ error: 'Письмо только что отправлено — подождите минуту перед повтором' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  req.tenant.pendingEmail = {
    address,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + EMAIL_CONFIRM_TTL_MS),
    requestedAt: new Date(),
  };
  await req.tenant.save();

  const confirmUrl = `${SITE_URL}/api/auth/email/confirm?token=${token}`;
  const result = await sendMail({ to: address, ...confirmEmailEmail(req.tenant, { confirmUrl }) });
  if (!result.sent) {
    return res.status(502).json({ error: 'Не удалось отправить письмо — попробуйте ещё раз чуть позже' });
  }
  res.json({ pendingEmail: address });
});

// Переход по ссылке из письма. Браузер приходит сюда напрямую, поэтому ответ —
// редирект на кабинет с пометкой, а не JSON.
router.get('/email/confirm', async (req, res) => {
  const token = String(req.query?.token || '');
  const back = (flag) => res.redirect(`${SITE_URL}/app?email=${flag}`);
  if (!token) return back('invalid');

  const tenant = await Tenant.findOne({
    'pendingEmail.tokenHash': hashToken(token),
    'pendingEmail.expiresAt': { $gt: new Date() },
  });
  if (!tenant) return back('invalid');

  const address = tenant.pendingEmail.address;
  // Пока письмо шло, адрес мог занять кто-то другой — проверяем ещё раз.
  const takenBy = await Tenant.findOne({ email: address, _id: { $ne: tenant._id } }).select('_id');
  if (takenBy) return back('taken');

  const wasPlaceholder = isSyntheticEmail(tenant.email);
  tenant.email = address;
  tenant.pendingEmail = undefined;
  await tenant.save();

  // Человек из VK без почты до этой минуты не получил ни одного письма — в том
  // числе приветственного. Теперь, когда адрес есть, отправляем его.
  if (wasPlaceholder) sendMail({ to: address, ...welcomeEmail(tenant) }).catch(() => {});

  back('confirmed');
});

module.exports = { router, publicTenant };
