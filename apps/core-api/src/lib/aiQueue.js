// Очередь генерации ИИ. Бесплатный тариф теперь полный, поэтому платный отличается
// приоритетом: его запросы (письма, ответы работодателям, анкеты) идут к провайдеру
// первыми, а бесплатные ждут свободного места. Пока нагрузка маленькая, очереди нет
// вовсе — разница проявляется в часы пик.
//
// Приоритеты: 'high' — платные и служебная проверка живости провайдера (её нельзя
// держать в хвосте: иначе лаунчер решит, что провайдер лежит); 'normal' — бесплатные.

const MAX_CONCURRENT = Math.max(1, Number(process.env.AI_MAX_CONCURRENT) || 6);
// Дольше ждать в очереди нет смысла: лаунчер всё равно повторит запрос позже.
const MAX_WAIT_MS = { high: 5 * 60 * 1000, normal: 3 * 60 * 1000 };

let active = 0;
const queues = { high: [], normal: [] };
const counters = { served: { high: 0, normal: 0 }, expired: 0, maxWaitMs: { high: 0, normal: 0 } };

class QueueTimeoutError extends Error {
  constructor() { super('Очередь генерации переполнена — повторим чуть позже'); this.code = 'QUEUE_TIMEOUT'; }
}

function pump() {
  while (active < MAX_CONCURRENT) {
    const job = queues.high.shift() || queues.normal.shift();
    if (!job) return;
    if (job.cancelled) continue;
    const waited = Date.now() - job.at;
    if (waited > MAX_WAIT_MS[job.priority]) {
      counters.expired += 1;
      job.reject(new QueueTimeoutError());
      continue;
    }
    counters.maxWaitMs[job.priority] = Math.max(counters.maxWaitMs[job.priority], waited);
    counters.served[job.priority] += 1;
    active += 1;
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => { active -= 1; pump(); });
  }
}

/**
 * Поставить генерацию в очередь.
 * @returns {{ promise: Promise<any>, cancel: () => void }} cancel — клиент ушёл, пока ждал.
 */
function enqueue(priority, fn) {
  const p = priority === 'high' ? 'high' : 'normal';
  let job;
  const promise = new Promise((resolve, reject) => {
    job = { priority: p, fn, resolve, reject, at: Date.now(), cancelled: false };
    queues[p].push(job);
  });
  pump();
  return { promise, cancel: () => { job.cancelled = true; } };
}

function stats() {
  return {
    maxConcurrent: MAX_CONCURRENT, active,
    queued: { high: queues.high.filter((j) => !j.cancelled).length, normal: queues.normal.filter((j) => !j.cancelled).length },
    ...counters,
  };
}

module.exports = { enqueue, stats, QueueTimeoutError, MAX_CONCURRENT };
