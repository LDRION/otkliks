/**
 * coreApiProxyClient.js — для local-agent: НЕ зовёт LLM-провайдера напрямую (ключ не должен
 * уезжать в собранный установщик — asar не защита, см. план), а ходит на наш же core-api,
 * который уже знает реальный ключ и тариф/лимиты арендатора. Тот же интерфейс ask(), что и
 * у siberiClient — coverLetter.js/replyAgent.js не знают, с каким клиентом работают.
 */

// Провайдер (Siberi AI ← Mistral) под нагрузкой возвращает текст-ошибку вместо ответа —
// «Что-то пошло не так. Искусственному интеллекту не удалось создать ответ.». Это СБОЙ,
// его нельзя отдавать наружу (уйдёт в чат работодателю). Распознаём и лечим как сбой.
const { isAiErrorText } = require('./aiErrorText');

function createCoreApiProxyClient({ baseUrl, deviceToken }) {
  if (!baseUrl || !deviceToken) {
    throw new Error('createCoreApiProxyClient: обязательны baseUrl и deviceToken');
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ВАЖНО: раньше ask() при ПУСТОМ ответе модели молча возвращал {text:''} и не
  // повторял транзиентные сбои. Из-за этого при перегрузке AI-провайдера в чат
  // работодателю уходил один дисклеймер без текста ответа, а фильтр вакансий тихо
  // отключался («совпадение ?» → откликались вслепую). Теперь: повтор на транзиенте
  // (сеть/таймаут/429/5xx) и на пустом ответе, а если так и не вышло — бросаем ошибку,
  // чтобы вызывающий НЕ отправил пустышку, а честно пропустил круг. На 4xx (402 «нет
  // подписки», 400) не повторяем — ответ не изменится, гейт должен сработать сразу.
  // kind — какое именно действие просит сгенерировать текст (см. допустимые значения
  // в apps/core-api/src/routes/agent.js). По нему сервер решает, доступно ли это на
  // бесплатном тарифе (только 'cover_letter', 'vacancy_match', 'outcome_classify') и
  // считать ли вызов в дневной лимит откликов (только 'cover_letter' — письмо ровно
  // на один отклик). Без kind сервер считает его 'cover_letter' — так старые вызовы
  // (если где-то забыли проставить) не проваливаются молча, а просто гейтятся как
  // обычный отклик.
  async function ask(system, user, { timeoutMs = 180000, retries = 2, kind } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await sleep(attempt === 1 ? 1500 : 4000);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl}/api/agent/generate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${deviceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ system, user, kind }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const err = new Error(`core-api /generate ${res.status} ${body.slice(0, 200)}`);
          if (res.status < 500 && res.status !== 429) throw err; // окончательный (напр. 402/403)
          lastErr = err; // 429/5xx — транзиент, повторяем
          continue;
        }
        const data = await res.json();
        const text = (data.text || '').trim();
        // Текст-ошибка провайдера («Что-то пошло не так. Искусственному интеллекту не
        // удалось создать ответ.») — это СБОЙ, а не ответ: повторяем, но НИКОГДА не отдаём
        // его вызывающему (иначе уйдёт работодателю). core-api это уже ловит, здесь — щит.
        if (text && isAiErrorText(text)) { lastErr = new Error('AI вернул текст-ошибку'); continue; }
        if (text) return { text, chatId: null };
        lastErr = new Error('AI вернул пустой ответ'); // повторяем
      } catch (e) {
        // Не транзиент (наш throw про 4xx и прочее) — наружу сразу, без повторов.
        if (e.name !== 'AbortError' && !/network|fetch failed|ECONN|socket|terminated|empty|пуст/i.test(e.message)) {
          throw e;
        }
        lastErr = e; // таймаут/сеть — повторяем
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr || new Error('AI не ответил после повторов');
  }

  async function isHealthy(timeoutMs = 45000) {
    try {
      // Проверка живости — одна лишняя попытка максимум: цель быстро отличить
      // «провайдер прилёг» от «подписка кончилась» (та бросит 402 без повтора).
      // kind:'health_check' — не тратит дневной лимит откликов и разрешён на любом
      // тарифе (см. agent.js): это просто пинг, а не реальное действие пользователя.
      await ask('Отвечай ровно одним словом.', 'Скажи слово "да".', { timeoutMs, retries: 1, kind: 'health_check' });
      return true;
    } catch {
      return false;
    }
  }

  return { ask, isHealthy };
}

module.exports = { createCoreApiProxyClient };
