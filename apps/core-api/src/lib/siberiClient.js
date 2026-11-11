// Клиент Siberi AI — тот же контракт ask(system, user, opts), что и
// packages/automation-core/src/llm/siberiClient.js. Своя копия, не workspace-зависимость
// от automation-core: core-api не запускает браузер и не должен тащить playwright ради
// одного HTTP-клиента (см. apps/marketing-site/lib/siberiClient.ts — тот же приём).

function getEnv() {
  const apiKey = process.env.SIBERI_API_KEY;
  const baseUrl = process.env.SIBERI_BASE_URL || 'http://127.0.0.1:5005/api/v1/ai';
  return { apiKey, baseUrl };
}

// Siberi AI генерирует, снимая ответ со страницы Mistral (Le Chat). Когда Mistral под
// нагрузкой падает, его интерфейс показывает «Что-то пошло не так. Искусственному
// интеллекту не удалось создать ответ.» — и эта строка возвращается как РЕЗУЛЬТАТ задачи.
// Мы такое НИКОГДА не должны слать работодателю: распознаём как сбой генерации и бросаем.
// Копия packages/automation-core/src/llm/aiErrorText.js (там подробности) — менять
// синхронно. Кроме сбоя Mistral ловит сообщения провайдеров о квоте: «Вы исчерпали лимит
// на ответы от ИИ. Повторите попытку позже.» пришло как «выполненная» задача и ушло
// работодателю в чат.
function isAiErrorText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/не удалось (?:создать|сгенерировать|получить) ответ/i.test(t)) return true;
  if (/Искусственному интеллекту не удалось/i.test(t)) return true;
  if (/лимит\s+на\s+(?:ответы|запросы|сообщения)\s+(?:от\s+)?(?:ии|ai|нейросети)/i.test(t)) return true;
  if (t.length > 300) return false;
  if (/(?:^|[\s—-])Что-то пошло не так/i.test(t)) return true;
  if (/исчерпал[аи]?\s+(?:[а-яё]+\s+)?лимит/i.test(t)) return true;
  if (/повторите попытку позже/i.test(t)) return true;
  if (/you(?:'ve| have) (?:reached|exceeded|hit) (?:your|the)[^.]{0,30}limit|quota (?:exceeded|reached)|too many requests|try again later/i.test(t)) return true;
  return false;
}

async function startTask(system, user, attempt = 1) {
  const { apiKey, baseUrl } = getEnv();
  if (!apiKey) throw new Error('SIBERI_API_KEY не задан');

  const res = await fetch(`${baseUrl}/generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: user, system, wait: false }),
  });

  if (res.status === 429 && attempt <= 3) {
    await new Promise((r) => setTimeout(r, 5000 * attempt));
    return startTask(system, user, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Siberi ${res.status} ${body.slice(0, 200)}`);
  }
  const started = await res.json();
  if (!started.taskId) throw new Error('Siberi: нет taskId в ответе /generate');
  return started.taskId;
}

async function askSiberi(system, user, { timeoutMs = 180000 } = {}) {
  const { apiKey, baseUrl } = getEnv();
  if (!apiKey) throw new Error('SIBERI_API_KEY не задан');

  const taskId = await startTask(system, user);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${baseUrl}/result/${taskId}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) continue;
    const data = await res.json();
    if (data.status === 'completed') {
      const result = (data.result || '').trim();
      // Провайдер вернул текст-ошибку вместо ответа — это СБОЙ, а не ответ. Бросаем, чтобы
      // вызывающий (agent.generate → лаунчер) повторил/пропустил, а НЕ отправил это в чат.
      if (isAiErrorText(result)) throw new Error('Siberi: провайдер вернул ошибку генерации');
      return result;
    }
    if (data.status === 'error') throw new Error(`Siberi: ошибка задачи — ${data.error || 'неизвестно'}`);
  }
  throw new Error('Siberi: таймаут ожидания результата');
}

async function isSiberiHealthy(timeoutMs = 45000) {
  try {
    await askSiberi('Отвечай ровно одним словом.', 'Скажи слово "да".', { timeoutMs });
    return true;
  } catch {
    return false;
  }
}

module.exports = { askSiberi, isSiberiHealthy };
