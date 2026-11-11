const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const ActivityEvent = require('../models/ActivityEvent');
const Clarification = require('../models/Clarification');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const events = await ActivityEvent.find({ tenantId: req.tenant._id }).sort({ createdAt: -1 }).limit(limit);
  res.json({ events });
});

// Приглашения на созвон/собеседование — отдельно и ВСЕ (не только недавние): «победный»
// блок в кабинете не должен терять приглашение, когда лента наполнится другими событиями.
router.get('/interviews', requireAuth, async (req, res) => {
  const events = await ActivityEvent.find({ tenantId: req.tenant._id, type: 'interview_invite' })
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({ events });
});

// 🙋 Вопросы, на которые ИИ честно не может ответить сам — ждут ответа человека. Отдельно
// от общей ленты по той же причине, что и интервью: не должны потеряться среди событий.
router.get('/clarifications', requireAuth, async (req, res) => {
  const items = await Clarification.find({ tenantId: req.tenant._id, status: 'pending' })
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({ clarifications: items });
});

// Ответ дан в кабинете на сайте — саму доставку работодателю берёт на себя лаунчер на
// следующем круге чатов (нужен живой браузер с сессией hh.ru, см. GET /api/agent/clarification-answers).
router.post('/clarifications/:id/answer', requireAuth, async (req, res) => {
  const answerText = String(req.body?.answerText || '').trim();
  if (!answerText) return res.status(400).json({ error: 'Нужен текст ответа' });
  const aiImprove = req.body?.aiImprove !== false;
  const updated = await Clarification.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.tenant._id, status: 'pending' },
    { status: 'answered', answerText, aiImprove, answeredAt: new Date() },
  );
  if (!updated) return res.status(404).json({ error: 'Вопрос не найден или уже отвечен' });
  res.status(204).end();
});

module.exports = { router };
