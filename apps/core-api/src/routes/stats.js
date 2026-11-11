const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const Vacancy = require('../models/Vacancy');
const Negotiation = require('../models/Negotiation');

const router = express.Router();

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

router.get('/', requireAuth, async (req, res) => {
  const tenantId = req.tenant._id;
  const today = startOfDay(new Date());

  const [totalApplied, appliedToday, interviews, rejections, pendingNegotiations, byDayRaw] = await Promise.all([
    Vacancy.countDocuments({ tenantId, status: 'applied' }),
    Vacancy.countDocuments({ tenantId, status: 'applied', appliedAt: { $gte: today } }),
    Negotiation.countDocuments({ tenantId, outcome: 'interview' }),
    Negotiation.countDocuments({ tenantId, outcome: 'rejection' }),
    Negotiation.countDocuments({ tenantId, outcome: { $in: ['pending', 'question'] }, status: 'active' }),
    Vacancy.aggregate([
      {
        $match: {
          tenantId,
          status: 'applied',
          appliedAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        },
      },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$appliedAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  res.json({
    applied: { total: totalApplied, today: appliedToday },
    // Приглашения на собеседование берём из точного счётчика hh (его присылает
    // лаунчер, см. POST /api/events/stats), а на классификацию по чатам падаем
    // только пока hh-число ещё не пришло.
    interviews: (req.tenant.hhInterviews != null ? req.tenant.hhInterviews : interviews),
    rejections,
    pending: pendingNegotiations,
    byDay: byDayRaw.map((d) => ({ date: d._id, count: d.count })),
  });
});

module.exports = { router };
