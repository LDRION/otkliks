/**
 * reportingStore.js — оборачивает локальный SQLite-store (store.js): пишет локально
 * (как и раньше, синхронно, это остаётся источником правды — см. store.js), и ДОПОЛНИТЕЛЬНО
 * лучше репортит на core-api (для веб-дашборда), best-effort — если core-api недоступен,
 * локальная работа лаунчера не прерывается.
 */

function wrapStoreWithReporting(store, { coreApi, getDeviceToken, classifyOutcome, llmClient }) {
  // Исход определяем по последнему сообщению работодателя ОДИН раз. Раньше — на каждом
  // круге для каждого треда: лишний вызов ИИ, а ответ скакал «вопрос» ↔ «другое», и сервер
  // на каждое возвращение заводил новое событие «Вопрос» (14 по одному треду).
  const classified = new Map(); // negotiationId → { text, outcome }
  async function classifyOutcomeIfNeeded(negotiationId, messages) {
    const last = messages[messages.length - 1];
    // Только когда последнее сообщение от работодателя (не наш же исходящий ответ).
    if (!last || last.from !== 'employer') return undefined;
    const memo = classified.get(negotiationId);
    if (memo && memo.text === last.text) return memo.outcome;
    const outcome = await classifyOutcome(last.text, llmClient).catch(() => null);
    // ИИ не ответил — исход неизвестен: не сообщаем ничего и спросим на следующем круге.
    if (!outcome) return undefined;
    classified.set(negotiationId, { text: last.text, outcome });
    return outcome;
  }

  async function saveVacancy(tenantId, vacancyId, resumeProfile, fields) {
    store.saveVacancy(tenantId, vacancyId, resumeProfile, fields);
    const token = getDeviceToken();
    if (!token) return;
    await coreApi.reportVacancy(token, { vacancyId, resumeProfile, ...fields });
  }

  async function saveNegotiation(tenantId, negotiationId, fields) {
    store.saveNegotiation(tenantId, negotiationId, fields);
    const token = getDeviceToken();
    if (!token) return;

    // ВАЖНО: "новый ответ ИИ" сюда НЕ угадываем по последнему элементу fields.messages —
    // saveNegotiation вызывается на КАЖДОМ круге для КАЖДОГО треда, в том числе просто
    // чтобы синхронизировать историю уже давно отвеченного чата (там последнее сообщение
    // в массиве тоже от ИИ, просто не новое). Раньше это создавало на сайте новое событие
    // «Ответили в чате» для месяцами закрытого диалога на каждом круге. Настоящий момент
    // отправки однозначен и репортится явно из notifier.notifyReply (см. notifier.js) —
    // здесь только классификация исхода входящего сообщения, если оно ещё не отвечено.
    // Исход, который знает сам наблюдатель (отказ, приглашение), главнее классификатора.
    let outcome;
    if (!fields.outcome && Array.isArray(fields.messages) && fields.messages.length) {
      outcome = await classifyOutcomeIfNeeded(negotiationId, fields.messages);
    }

    await coreApi.reportNegotiation(token, {
      negotiationId,
      ...fields,
      ...(outcome ? { outcome } : {}),
    });
  }

  return { ...store, saveVacancy, saveNegotiation };
}

module.exports = { wrapStoreWithReporting };
