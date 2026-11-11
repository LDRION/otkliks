/**
 * siberiClient.js — клиент Siberi AI (siberi.online), портирован из личного hhorosho.
 * Теперь ФАБРИКА (apiKey/baseUrl параметром, не process.env) — так и cloud-worker может
 * завести клиента на ключ конкретного тенанта (или на общий, пока нет своего биллинга
 * провайдера), и local-agent в принципе мог бы (хотя по плану он вызывает core-api
 * прокси, а не Siberi напрямую — ключ не должен уезжать в установщик).
 *
 * Асинхронный флоу (POST /generate {wait:false} → GET /result/:taskId), не синхронный
 * /chat/completions — синхронный ограничен ~120с.
 */

function createSiberiClient({ apiKey, baseUrl = 'https://siberi.online/api/v1/ai' }) {
  if (!apiKey) throw new Error('createSiberiClient: apiKey обязателен');

  // Rate-limit (429) — не долбим сразу повторно, ждём и пробуем ещё пару раз.
  async function startTask(system, user, attempt = 1) {
    const startRes = await fetch(`${baseUrl}/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: user, system, wait: false }),
    });

    if (startRes.status === 429 && attempt <= 3) {
      const waitMs = 20000 * attempt;
      console.warn(`⚠️ Siberi 429 (rate limit) — жду ${waitMs / 1000}с, попытка ${attempt}/3`);
      await new Promise((r) => setTimeout(r, waitMs));
      return startTask(system, user, attempt + 1);
    }

    if (!startRes.ok) {
      const body = await startRes.text().catch(() => '');
      throw new Error(`Siberi ${startRes.status} ${body.slice(0, 200)}`);
    }

    const started = await startRes.json();
    if (!started.taskId) throw new Error('Siberi: нет taskId в ответе /generate');
    return started;
  }

  async function ask(system, user, { onProgress = null, timeoutMs = 180000 } = {}) {
    const started = await startTask(system, user);

    const deadline = Date.now() + timeoutMs;
    const pollIntervalMs = 3000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));

      const res = await fetch(`${baseUrl}/result/${started.taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) continue;

      const data = await res.json();
      if (onProgress && data.partialResult) {
        try { onProgress(data.partialResult); } catch {}
      }
      if (data.status === 'completed') return { text: (data.result || '').trim(), chatId: null };
      if (data.status === 'error') throw new Error(`Siberi: ошибка задачи — ${data.error || 'неизвестно'}`);
    }

    throw new Error('Siberi: таймаут ожидания результата');
  }

  async function warmup() {
    const res = await fetch(`${baseUrl}/ping`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`Siberi ping ${res.status}`);
  }

  // /ping проверяет только веб-слой, не сам обработчик задач (поймано вживую: /generate
  // отвечал 202 мгновенно, задача вечно висела в 'pending', воркер её не подхватывал).
  // Реальная проверка — короткий ask() с урезанным таймаутом; false вместо throw.
  async function isHealthy(timeoutMs = 45000) {
    try {
      await ask('Отвечай ровно одним словом.', 'Скажи слово "да".', { timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  return { ask, warmup, isHealthy };
}

module.exports = { createSiberiClient };
