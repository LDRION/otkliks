// Простой in-memory sliding-window лимитер для Route Handlers. Годится только для
// одного процесса — otkliks-site в ecosystem.config.js запущен в fork-режиме без
// кластера (один инстанс), поэтому счётчик в памяти процесса не расходится с реальностью.
// Понадобится несколько инстансов — переносить в общее хранилище (Redis и т.п.).

const buckets = new Map<string, number[]>();

/** true — запрос разрешён и учтён в счётчике; false — лимит на это окно исчерпан. */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const fresh = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (fresh.length >= limit) {
    buckets.set(key, fresh);
    return false;
  }
  fresh.push(now);
  buckets.set(key, fresh);
  return true;
}

// Разовые посетители иначе копятся в Map навсегда. Раз в 5 минут выкидываем всё, что
// старше 10 минут — этого хватает с большим запасом для любых окон лимитов в проекте.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, bucket] of buckets) {
      const fresh = bucket.filter((t) => t > cutoff);
      if (fresh.length === 0) buckets.delete(key);
      else buckets.set(key, fresh);
    }
  }, 5 * 60 * 1000).unref();
}
