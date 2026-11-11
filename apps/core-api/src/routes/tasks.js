const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const freeTasks = require('../lib/freeTasks');

// Задания бесплатного тарифа — для кабинета на сайте и лаунчера. Живут под
// /api/profile/tasks: этот префикс nginx уже отдаёт наружу.
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  await freeTasks.ensureStarted(req.tenant);
  res.json({ tasks: freeTasks.tasksState(req.tenant) });
});

router.post('/:id/open', requireAuth, async (req, res) => {
  await freeTasks.ensureStarted(req.tenant);
  const r = await freeTasks.markOpened(req.tenant, req.params.id);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json({ ok: true });
});

router.post('/:id/done', requireAuth, async (req, res) => {
  await freeTasks.ensureStarted(req.tenant);
  const r = await freeTasks.markDone(req.tenant, req.params.id);
  if (r.error) return res.status(r.status).json({ error: r.error });
  const fresh = await req.tenant.constructor.findById(req.tenant._id);
  res.json({ tasks: freeTasks.tasksState(fresh) });
});

module.exports = { router };
