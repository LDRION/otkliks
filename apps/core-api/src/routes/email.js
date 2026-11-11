const express = require('express');
const mongoose = require('mongoose');
const { wrapAsyncRouter } = require('../lib/asyncRouter');
const Tenant = require('../models/Tenant');
const { verifyUnsubToken } = require('../lib/activationEmails');

// Отписка от писем-подсказок по ссылке из письма (подписанной HMAC — подобрать чужую
// нельзя). Снаружи не выставлен: зовёт сайт (/unsubscribe) со своей стороны.
const router = express.Router();

router.post('/unsubscribe', async (req, res) => {
  const { u, t } = req.body || {};
  if (!mongoose.isValidObjectId(u) || !verifyUnsubToken(u, t)) return res.status(400).json({ error: 'Ссылка недействительна' });
  await Tenant.updateOne({ _id: u }, { $set: { 'emailPrefs.tips': false } });
  res.json({ ok: true });
});

wrapAsyncRouter(router);
module.exports = router;
