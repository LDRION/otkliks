// TS-клиент Siberi AI API для консультанта на сайте. Тот же контракт: ask(system, user).
//
// ВАЖНО про скорость: раньше здесь был асинхронный флоу — POST /generate {wait:false},
// а затем клиентский поллинг GET /result/:taskId КАЖДЫЕ 2 секунды, причём первый опрос
// шёл ПОСЛЕ 2-секундного сна. Даже когда ИИ отвечал за секунду, ответ доходил за ~2с, а
// при обычной генерации 3–4с набегало ~8–10с. Ровно на это жаловались: на siberi.online
// тот же API отвечает за 1–3с.
//
// Причина: у Siberi AI API есть СИНХРОННЫЙ режим — POST /generate {wait:true} (по
// умолчанию). Сервер сам поллит задачу каждые 700мс и возвращает результат В ОДНОМ
// запросе, как только он готов. Именно так ходит быстрый виджет на самом siberi.online.
// Переходим на него: один запрос, никакого клиентского поллинга с секундными паузами.

type AskOptions = { timeoutMs?: number };

function getEnv() {
  const apiKey = process.env.SIBERI_API_KEY;
  const baseUrl = process.env.SIBERI_BASE_URL || 'https://siberi.online/api/v1/ai';
  return { apiKey, baseUrl };
}

// Провайдер (Siberi AI ← Mistral) под нагрузкой отдаёт текст-ошибку вместо ответа
// («Что-то пошло не так. Искусственному интеллекту не удалось создать ответ.»). Это сбой —
// не показываем его как ответ консультанта, а бросаем (виджет покажет вежливую ошибку).
// Копия packages/automation-core/src/llm/aiErrorText.js (там подробности) — менять
// синхронно. Кроме сбоя Mistral ловит сообщения провайдеров о квоте: «Вы исчерпали лимит
// на ответы от ИИ. Повторите попытку позже.» пришло как «выполненная» задача и ушло
// работодателю в чат.
function isAiErrorText(text: string): boolean {
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

export async function askSiberi(
  system: string,
  user: string,
  { timeoutMs = 45000 }: AskOptions = {}
): Promise<string> {
  const { apiKey, baseUrl } = getEnv();
  if (!apiKey) throw new Error('SIBERI_API_KEY не задан');

  // На 429 (rate limit) — короткий бэкофф и повтор, до 3 попыток.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // Свой предохранитель по времени: чуть больше серверного timeoutMs (сервер ждёт
    // результат до timeoutMs и лишь потом отдаёт 504) — на сетевые зависания.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs + 5000);
    try {
      const res = await fetch(`${baseUrl}/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        // wait:true — синхронно; сервер вернёт { success, result } как только готово.
        body: JSON.stringify({ prompt: user, system, wait: true, timeoutMs }),
        signal: controller.signal,
      });

      if (res.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Siberi ${res.status} ${body.slice(0, 200)}`);
      }

      const data = (await res.json()) as { success?: boolean; result?: string; error?: string };
      if (data.error) throw new Error(`Siberi: ${data.error}`);
      const result = (data.result || '').trim();
      if (isAiErrorText(result)) throw new Error('Siberi: провайдер вернул ошибку генерации');
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Siberi: превышен лимит запросов, попробуйте ещё раз');
}

// СТРИМИНГ (как виджет на siberi.online): запускаем задачу (wait:false) и часто опрашиваем
// /result, отдавая ПРИРОСТ текста (partialResult растёт по мере генерации, первые буквы
// появляются за ~2с вместо ожидания всего ответа за ~6с). Возвращаем дельты по мере роста.
export async function* askSiberiStream(
  system: string,
  user: string,
  { timeoutMs = 45000 }: AskOptions = {}
): AsyncGenerator<string> {
  const { apiKey, baseUrl } = getEnv();
  if (!apiKey) throw new Error('SIBERI_API_KEY не задан');

  const startRes = await fetch(`${baseUrl}/generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: user, system, wait: false }),
  });
  if (!startRes.ok) {
    const body = await startRes.text().catch(() => '');
    throw new Error(`Siberi ${startRes.status} ${body.slice(0, 200)}`);
  }
  const started = (await startRes.json()) as { taskId?: string };
  if (!started.taskId) throw new Error('Siberi: нет taskId');
  const taskId = started.taskId;

  const deadline = Date.now() + timeoutMs;
  let sent = 0;
  // 500мс — компромисс: поток плавный (partialResult и так приходит крупными кусками), но
  // не жжём общий лимит Siberi (120 req/мин на IP, делится с автопилотом). На 429 — бэкофф.
  let pollMs = 500;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const res = await fetch(`${baseUrl}/result/${taskId}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.status === 429) { pollMs = 2000; continue; } // притормаживаем, не считаем ошибкой
    pollMs = 500;
    if (!res.ok) continue;
    const data = (await res.json()) as { status?: string; result?: string; partialResult?: string; error?: string };

    const full = String(data.result ?? data.partialResult ?? '');
    // Не стримим текст-ошибку провайдера; если задача им и завершилась — бросаем.
    if (isAiErrorText(full)) {
      if (data.status === 'completed' || data.status === 'error') throw new Error('Siberi: провайдер вернул ошибку генерации');
      continue;
    }
    if (full.length > sent) {
      yield full.slice(sent);
      sent = full.length;
    }
    if (data.status === 'completed') {
      const finalText = String(data.result ?? full);
      if (finalText.length > sent) yield finalText.slice(sent);
      return;
    }
    if (data.status === 'error') throw new Error(`Siberi: ${data.error || 'ошибка задачи'}`);
  }
  throw new Error('Siberi: таймаут ожидания результата');
}
