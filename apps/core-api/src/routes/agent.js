const express = require('express');
const { requireDevice } = require('../middleware/requireDevice');
const { askSiberi } = require('../lib/siberiClient');
const Clarification = require('../models/Clarification');
const Tenant = require('../models/Tenant');
const { FREE_DAILY_CAP, TASK_EXEMPT_KINDS, QUOTA_METERED_KINDS } = require('../lib/planLimits');
const freeTasks = require('../lib/freeTasks');
const aiQueue = require('../lib/aiQueue');
const { signTenantToken } = require('../lib/auth');

const router = express.Router();

// Новая сессия для лаунчера по токену устройства. Сессия (JWT) живёт 30 дней, токен
// устройства — пока устройство не отвязано. Раньше по истечении сессии лаунчер
// продолжал показывать «вошли» по сохранённым данным, а любое сохранение падало с
// «Сессия недействительна»; теперь он сам берёт свежую сессию здесь и повторяет запрос.
router.post('/session', requireDevice, async (req, res) => {
  res.json({ token: await signTenantToken(req.tenant) });
});

// Контракт совпадает с packages/automation-core/src/llm/coreApiProxyClient.js — тело
// {system, user, kind}, ответ {text}. local-agent никогда не видит реальный
// SIBERI_API_KEY — он остаётся только здесь, на сервере (см. ARCHITECTURE.md,
// "LLM-proxy security boundary").
router.post('/generate', requireDevice, async (req, res) => {
  const system = String(req.body?.system || '');
  const user = String(req.body?.user || '');
  if (!system || !user) return res.status(400).json({ error: 'Нужны system и user' });

  // kind не пришёл (старый клиент/забыли проставить) — по умолчанию считаем самым
  // строгим вариантом, обычным откликом, а не самым свободным: тогда пропуск поля
  // по ошибке максимум лишний раз спишет квоту, а не тихо откроет платную фичу.
  const kind = String(req.body?.kind || 'cover_letter');
  const isPaid = req.tenant.isSubscriptionActive();

  // freeTierBlocked (см. routes/profile.js, claimResumesOrBlockFreeTier) — резюме уже
  // числится за ДРУГИМ бесплатным аккаунтом, этому бесплатный тариф не положен вовсе.
  // Платных это не касается (freeTierBlocked никогда не ставится, пока активна оплата).
  // health_check исключён и здесь — это просто пинг живости провайдера, а не действие.
  if (!isPaid && req.tenant.freeTierBlocked && kind !== 'health_check') {
    return res.status(403).json({
      error: 'Бесплатный тариф на этом аккаунте недоступен — резюме уже подключено на другом аккаунте. Оформите платный тариф или используйте исходный аккаунт.',
    });
  }

  // Бесплатный тариф полный, но пока не выполнено задание дня — автопилот на паузе.
  // Служебные вызовы (проверка живости и т.п.) задание не останавливает.
  if (!isPaid && !TASK_EXEMPT_KINDS.has(kind)) {
    await freeTasks.ensureStarted(req.tenant);
    const state = freeTasks.tasksState(req.tenant);
    if (state?.pending) {
      return res.status(402).json({
        error: `Бесплатный автопилот на паузе до задания дня: «${state.pending.title}». `
          + 'Откройте лаунчер или личный кабинет на otkliks.ru — это пара секунд.',
        code: 'TASK_REQUIRED',
        task: { id: state.pending.id, title: state.pending.title, url: state.pending.url },
      });
    }
  }

  if (QUOTA_METERED_KINDS.has(kind)) {
    const cap = isPaid ? (req.tenant.dailyCap || 200) : FREE_DAILY_CAP;
    const { ok } = await Tenant.tryConsumeDailyResponse(req.tenant._id, cap);
    if (!ok) {
      return res.status(402).json({
        error: isPaid
          ? `Дневной лимит откликов исчерпан (${cap} в день) — вернётся завтра`
          : `Бесплатный лимит — ${cap} откликов в день — исчерпан. Обновится завтра или оформите платный тариф`,
        limit: cap,
        isPaid,
      });
    }
  }

  // Платные и проверка живости — в приоритете, бесплатные — следом (lib/aiQueue.js).
  // Клиент ушёл, пока ждал очереди, — место не занимаем.
  const job = aiQueue.enqueue(isPaid || kind === 'health_check' ? 'high' : 'normal',
    () => askSiberi(system, user, { timeoutMs: 240000 }));
  res.on('close', () => { if (!res.writableEnded) job.cancel(); });
  try {
    const text = await job.promise;
    res.json({ text });
  } catch (e) {
    if (e.code === 'QUEUE_TIMEOUT') {
      return res.status(503).json({ error: e.message, code: 'QUEUE_TIMEOUT' });
    }
    console.error('agent.generate:', e.message);
    res.status(502).json({ error: 'Генерация не удалась', detail: e.message });
  }
});

// Человек мог ответить на уточняющий вопрос в кабинете на сайте, а не в лаунчере —
// лаунчер забирает такие ответы отсюда на каждом круге чатов и доставляет их работодателю
// (нужен живой браузер с сессией hh.ru, которого у сайта нет). См. scheduler.js.
router.get('/clarification-answers', requireDevice, async (req, res) => {
  const items = await Clarification.find({ tenantId: req.tenant._id, status: 'answered' }).lean();
  res.json({
    answers: items.map((c) => ({
      negotiationId: c.negotiationId, question: c.question,
      answerText: c.answerText, aiImprove: c.aiImprove,
    })),
  });
});

// Ключ — (negotiationId, question), не Mongo _id: лаунчер знает только СВОЙ локальный
// id этой записи, а сюда сверяется тем, что одинаково в обеих базах.
router.post('/clarification-answers/delivered', requireDevice, async (req, res) => {
  const { negotiationId, question, sentText } = req.body || {};
  if (!negotiationId || !question) return res.status(400).json({ error: 'Нужны negotiationId и question' });
  await Clarification.updateOne(
    { tenantId: req.tenant._id, negotiationId, question },
    { status: 'delivered', sentText, deliveredAt: new Date() },
  );
  res.status(204).end();
});

module.exports = { router };
