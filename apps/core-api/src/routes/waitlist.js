const express = require('express');
const mongoose = require('mongoose');
const { wrapAsyncRouter } = require('../lib/asyncRouter');
const CloudWaitlist = require('../models/CloudWaitlist');
const CloudReveal = require('../models/CloudReveal');
const { parseSource } = require('../lib/acquisition');

// Запись в лист ожидания облачного тарифа. Снаружи не доступен: nginx проксирует в
// core-api только перечисленные префиксы, /api/waitlist среди них нет — зовёт сайт
// со своей стороны (там же лимит частоты по IP).
const router = express.Router();

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const SOURCES = new Set(['landing', 'pricing', 'dashboard']);

router.post('/cloud', async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || /@oauth\.otkliks\.local$/.test(email)) {
    return res.status(400).json({ error: 'Проверьте адрес почты' });
  }
  const tenantId = mongoose.isValidObjectId(b.tenantId) ? b.tenantId : null;
  const source = SOURCES.has(b.source) ? b.source : '';
  const src = parseSource(b.src);
  const referrerSource = String(src?.source || src?.referrerHost || '').slice(0, 80);

  // Идемпотентно: повторная запись не создаёт дубль и не считается второй раз.
  const r = await CloudWaitlist.updateOne(
    { email },
    {
      $setOnInsert: { email, source, referrerSource, createdAt: new Date() },
      ...(tenantId ? { $set: { tenantId } } : {}),
    },
    { upsert: true },
  );
  res.json({ ok: true, already: !r.upsertedCount });
});

// Записан ли уже этот адрес — чтобы вошедшему сразу показать «вы уже в списке».
router.post('/cloud/status', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.json({ joined: false });
  res.json({ joined: !!(await CloudWaitlist.exists({ email })) });
});

// Открыл размытую карточку облака на главной. Один посетитель — одна запись.
router.post('/reveal', async (req, res) => {
  const b = req.body || {};
  const visitor = String(b.visitor || '');
  if (!/^[a-f0-9-]{16,64}$/i.test(visitor)) return res.status(400).json({ error: 'bad visitor' });
  const tenantId = mongoose.isValidObjectId(b.tenantId) ? b.tenantId : null;
  const src = parseSource(b.src);
  const r = await CloudReveal.updateOne(
    { visitor },
    {
      $setOnInsert: { visitor, referrerSource: String(src?.source || src?.referrerHost || '').slice(0, 80), createdAt: new Date() },
      ...(tenantId ? { $set: { tenantId } } : {}),
    },
    { upsert: true },
  );
  res.json({ ok: true, first: !!r.upsertedCount });
});

wrapAsyncRouter(router);
module.exports = router;
