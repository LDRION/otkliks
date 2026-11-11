const express = require('express');
const { requireDevice } = require('../middleware/requireDevice');
const Vacancy = require('../models/Vacancy');
const Negotiation = require('../models/Negotiation');
const ActivityEvent = require('../models/ActivityEvent');
const Clarification = require('../models/Clarification');

const router = express.Router();

// local-agent — источник правды по своим локальным данным (SQLite); эти эндпоинты просто
// зеркалят события на сервер для дашборда/уведомлений (см. events.js в комментарии моделей).

router.post('/vacancy', requireDevice, async (req, res) => {
  const {
    vacancyId, resumeProfile, title, company, url, description, status, skipReason, skipDetail, coverLetterText,
  } = req.body || {};
  if (!vacancyId || !resumeProfile || !status) {
    return res.status(400).json({ error: 'Нужны vacancyId, resumeProfile, status' });
  }

  const fields = {
    title,
    company,
    url,
    description,
    status,
    skipReason,
    skipDetail: skipDetail ? String(skipDetail).slice(0, 1000) : undefined,
    coverLetterText,
    ...(status === 'applied' ? { appliedAt: new Date() } : {}),
  };

  await Vacancy.findOneAndUpdate(
    { tenantId: req.tenant._id, vacancyId, resumeProfile },
    { $set: fields, $setOnInsert: { tenantId: req.tenant._id, vacancyId, resumeProfile } },
    { upsert: true },
  );

  if (status === 'applied') {
    await ActivityEvent.create({
      tenantId: req.tenant._id, type: 'applied', title, company, url,
      details: coverLetterText,
    });
  }

  res.status(204).end();
});

router.post('/negotiation', requireDevice, async (req, res) => {
  const {
    negotiationId, vacancyId, resumeProfile, vacancyTitle, company,
    messages, disclosureSent, lastRepliedAt, status, loopDetected, outcome, newAiMessage, incoming: incomingBody,
  } = req.body || {};
  if (!negotiationId) return res.status(400).json({ error: 'Нужен negotiationId' });

  const prev = await Negotiation.findOne({ tenantId: req.tenant._id, negotiationId });

  const fields = {
    vacancyId, resumeProfile, vacancyTitle, company,
    ...(messages ? { messages } : {}),
    ...(typeof disclosureSent === 'boolean' ? { disclosureSent } : {}),
    ...(lastRepliedAt ? { lastRepliedAt } : {}),
    ...(status ? { status } : {}),
    ...(typeof loopDetected === 'boolean' ? { loopDetected } : {}),
    ...(outcome ? { outcome } : {}),
  };

  await Negotiation.findOneAndUpdate(
    { tenantId: req.tenant._id, negotiationId },
    { $set: fields, $setOnInsert: { tenantId: req.tenant._id, negotiationId } },
    { upsert: true },
  );

  if (newAiMessage) {
    // Кроме нашего ответа сохраняем и входящее сообщение: без него в кабинете видно
    // только реплику автопилота, и непонятно, на что он вообще отвечал. Предпочитаем
    // incoming, присланный явно (см. notifier.js:notifyReply — там это тот самый текст,
    // на который отвечали), деривация из messages — только для обратной совместимости.
    const incoming = incomingBody || (Array.isArray(messages)
      ? [...messages].reverse().find((m) => m && m.from === 'employer')?.text
      : undefined);

    await ActivityEvent.create({
      tenantId: req.tenant._id,
      type: 'reply',
      title: vacancyTitle,
      company,
      // Ссылка на переписку, а не на вакансию: вакансия часто архивируется работодателем
      // ПОСЛЕ того, как переписка уже идёт — тогда ссылка на неё превращается в мёртвую
      // страницу «в архиве», хотя сам чат (отдельный поддомен chatik.hh.ru) архивирование
      // вакансии не трогает и остаётся читаемым.
      url: `https://chatik.hh.ru/chat/${negotiationId}`,
      message: newAiMessage,
      details: newAiMessage,
      incoming: incoming ? String(incoming).slice(0, 4000) : undefined,
    });
  }

  // Событие об исходе — это «исход ИЗМЕНИЛСЯ», а не «мы впервые увидели тред».
  // Раньше сюда входил и случай !prev, и при первичной синхронизации в ленте всплывали
  // отказы полумесячной давности с сегодняшним временем: стоит лаунчеру переустановиться
  // и потерять локальную базу, как все старые переписки уезжают на сервер как новые.
  // Настоящий свежий отказ приходит в тред, который на сервере уже есть (его завёл
  // отклик или наш ответ), поэтому prev у него будет.
  if (outcome && outcome !== 'pending' && outcome !== 'other' && prev && prev.outcome !== outcome) {
    // Та же причина, что и у 'reply' выше: ссылка на вакансию дохнет при архивации,
    // ссылка на чат — нет.
    const url = `https://chatik.hh.ru/chat/${negotiationId}`;
    // Текст сообщения, по которому определён исход: без него «Вопрос» в ленте нечем
    // раскрыть — не видно, о чём спросили (жалоба 06.10.2026).
    const lastIncoming = Array.isArray(messages)
      ? [...messages].reverse().find((m) => m && m.from === 'employer')?.text
      : undefined;
    const incoming = lastIncoming ? String(lastIncoming).slice(0, 4000) : undefined;
    // Исход по одному и тому же сообщению — одно событие. Лаунчер до 1.0.21 заново
    // классифицировал последнее сообщение на каждом круге, ответ скакал между «вопрос» и
    // «другое», и каждое возвращение давало новый «Вопрос»: 14 штук по одному треду.
    // У старых событий текста нет — их считаем тем же сообщением.
    const last = await ActivityEvent.findOne({ tenantId: req.tenant._id, type: 'outcome', url })
      .sort({ createdAt: -1 }).lean();
    const repeat = last && last.outcome === outcome && (!last.incoming || !incoming || last.incoming === incoming);
    if (!repeat) {
      await ActivityEvent.create({
        tenantId: req.tenant._id,
        type: 'outcome',
        title: vacancyTitle,
        company,
        url,
        outcome,
        incoming,
      });
    }
  }

  res.status(204).end();
});

router.post('/alert', requireDevice, async (req, res) => {
  const message = String(req.body?.message || '').slice(0, 2000);
  if (!message) return res.status(400).json({ error: 'Нужен message' });
  await ActivityEvent.create({ tenantId: req.tenant._id, type: 'alert', message });
  res.status(204).end();
});

// Анкета, которую автопилот заполнил и отправил за человека. Содержимое сохраняем
// целиком: человек вправе видеть каждый ответ, ушедший работодателю от его имени.
// 🎉 Приглашение на созвон/собеседование, подтверждённое в чате. Идемпотентно по url:
// лаунчер шлёт его один раз на тред, но при сбросе локальной БД мог бы прислать повторно —
// не плодим дубли «победы» в кабинете.
router.post('/interview-invite', requireDevice, async (req, res) => {
  const { title, company, url, incoming } = req.body || {};
  const query = { tenantId: req.tenant._id, type: 'interview_invite' };
  if (url) query.url = url;
  const existing = url ? await ActivityEvent.findOne(query) : null;
  if (!existing) {
    await ActivityEvent.create({
      tenantId: req.tenant._id,
      type: 'interview_invite',
      title: title || 'Приглашение на созвон',
      company,
      url,
      incoming: incoming ? String(incoming).slice(0, 4000) : undefined,
      outcome: 'interview',
    });
  }
  res.status(204).end();
});

router.post('/form', requireDevice, async (req, res) => {
  const { title, company, url, fields, formTitle } = req.body || {};
  await ActivityEvent.create({
    tenantId: req.tenant._id,
    type: 'form',
    title: title || 'Анкета работодателя',
    formTitle: formTitle ? String(formTitle).slice(0, 300) : undefined,
    company,
    url,
    fields: Array.isArray(fields)
      ? fields.slice(0, 60).map((f) => ({
        question: String(f.question || '').slice(0, 400),
        answer: String(f.answer || '').slice(0, 2000),
      }))
      : [],
  });
  res.status(204).end();
});

// Недавняя лента для лаунчера. Окно «Что происходит» жило только на живых событиях и
// после каждого перезапуска (в т.ч. авто-обновления) было ПУСТЫМ, пока не случится
// новое действие — хотя за день их десятки. Сервер и так хранит их для веб-дашборда,
// поэтому лаунчер при старте просто подтягивает последние отсюда. Формат — ровно тот,
// что рисует лента (renderer/app.js → describeEvent): type/title/company/url/…/at.
// Точные метрики со стороны hh (пока — число приглашений на собеседование), чтобы
// веб-кабинет показывал ровно то же, что и лаунчер.
router.post('/stats', requireDevice, async (req, res) => {
  const { interviews } = req.body || {};
  if (typeof interviews === 'number' && interviews >= 0) {
    req.tenant.hhInterviews = interviews;
    await req.tenant.save();
  }
  res.status(204).end();
});

router.get('/recent', requireDevice, async (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const rows = await ActivityEvent.find({ tenantId: req.tenant._id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  // Отдаём в хронологическом порядке (старые → новые): лента добавляет снизу вверх,
  // как живые события, поэтому свежие окажутся сверху.
  const events = rows.reverse().map((e) => ({
    id: String(e._id),
    type: e.type,
    title: e.title,
    company: e.company,
    url: e.url,
    message: e.message,
    details: e.details,
    incoming: e.incoming,
    fields: e.fields,
    formTitle: e.formTitle,
    outcome: e.outcome,
    at: new Date(e.createdAt).getTime(),
  }));

  res.json({ events });
});

// 🙋 Вопрос, на который ИИ честно не может ответить сам (важный факт вне резюме/стека) —
// идемпотентно по (negotiationId, question): unique index на модели.
router.post('/clarification-needed', requireDevice, async (req, res) => {
  const { negotiationId, title, company, url, question } = req.body || {};
  if (!negotiationId || !question) return res.status(400).json({ error: 'Нужны negotiationId и question' });
  await Clarification.findOneAndUpdate(
    { tenantId: req.tenant._id, negotiationId, question },
    { $setOnInsert: { vacancyTitle: title, company, url, status: 'pending' } },
    { upsert: true },
  );
  res.status(204).end();
});

module.exports = { router };
