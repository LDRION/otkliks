/**
 * coreApiClient.js — HTTP-клиент core-api для главного процесса Electron: логин/пейринг
 * (один раз, интерактивно) и репорт событий (постоянно, в фоне).
 */

// onSessionToken(old, fresh) — сервер продлил сессию (заголовок X-Session-Token):
// сохранить свежий токен вместо старого.
function createCoreApiClient({ baseUrl, onSessionToken = null }) {
  async function request(path, { method = 'GET', token, body, timeoutMs = 20000 } = {}) {
    // fetch без таймаута = ещё один источник вечных зависаний: refreshTenant зовётся в
    // начале КАЖДОГО круга, а report* — во время него. Стоит сети подвиснуть (типично
    // сразу после выхода ноутбука из сна), и запрос висел бы бесконечно, морозя весь
    // автопилот. AbortSignal.timeout закрывает его максимум за timeoutMs.
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const fresh = res.headers.get('x-session-token');
    if (fresh && token && onSessionToken) onSessionToken(token, fresh);
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `core-api ${method} ${path} → ${res.status}`);
      err.status = res.status;
      err.code = data.code || null;
      throw err;
    }
    return data;
  }

  return {
    login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
    reportForm: (token, payload) =>
      request('/api/events/form', { method: 'POST', token, body: payload }),
    // 🎉 Приглашение на созвон/собеседование — для кабинета на сайте. best-effort.
    reportInterviewInvite: (token, payload) =>
      request('/api/events/interview-invite', { method: 'POST', token, body: payload }).catch((e) =>
        console.warn('coreApiClient.reportInterviewInvite:', e.message),
      ),
    // 🙋 Вопрос, на который ИИ честно не может ответить сам — для кабинета на сайте.
    reportClarificationNeeded: (token, payload) =>
      request('/api/events/clarification-needed', { method: 'POST', token, body: payload }).catch((e) =>
        console.warn('coreApiClient.reportClarificationNeeded:', e.message),
      ),
    // Человек мог ответить прямо в кабинете на сайте, а не в лаунчере — забираем такие
    // ответы на каждом круге чатов и доставляем их работодателю тем же кодом, что и
    // ответы, данные в самом лаунчере (см. negotiationsWatcher.deliverPendingClarifications).
    getPendingClarificationAnswers: (token) =>
      request('/api/agent/clarification-answers', { token })
        .then((d) => (d && Array.isArray(d.answers) ? d.answers : []))
        .catch(() => []),
    markClarificationDelivered: (token, { negotiationId, question, sentText }) =>
      request('/api/agent/clarification-answers/delivered', { method: 'POST', token, body: { negotiationId, question, sentText } })
        .catch((e) => console.warn('coreApiClient.markClarificationDelivered:', e.message)),

    register: (email, password, fullName, consent) =>
      request('/api/auth/register', {
        method: 'POST',
        body: { email, password, fullName, consent: consent === true, consentSource: 'launcher' },
      }),
    me: (token) => request('/api/auth/me', { token }),
    // Свежая сессия по токену устройства — когда 30-дневная сессия истекла.
    deviceSession: (deviceToken) => request('/api/agent/session', { method: 'POST', token: deviceToken }),
    changePassword: (token, currentPassword, newPassword) =>
      request('/api/auth/change-password', { method: 'POST', token, body: { currentPassword, newPassword } }),
    updateProfile: (token, fields) => request('/api/profile', { method: 'PUT', token, body: fields }),
    // Задания бесплатного тарифа (core-api lib/freeTasks.js).
    taskOpen: (token, id) => request(`/api/profile/tasks/${encodeURIComponent(id)}/open`, { method: 'POST', token }),
    taskDone: (token, id) => request(`/api/profile/tasks/${encodeURIComponent(id)}/done`, { method: 'POST', token }),
    registerDevice: (token, label) =>
      request('/api/devices/register', { method: 'POST', token, body: { label } }),

    // Недавняя лента событий для окна «Что происходит» — чтобы после запуска/обновления
    // оно не было пустым. Тихо возвращаем [], если сеть/сервер недоступны: пустая лента
    // не повод пугать человека.
    recentEvents: (deviceToken, limit = 100) =>
      request(`/api/events/recent?limit=${limit}`, { token: deviceToken })
        .then((d) => (d && Array.isArray(d.events) ? d.events : []))
        .catch(() => []),

    // Устройство (deviceToken), не сессия — вызывается постоянно в фоновых циклах.
    reportVacancy: (deviceToken, fields) =>
      request('/api/events/vacancy', { method: 'POST', token: deviceToken, body: fields }).catch((e) =>
        console.warn('coreApiClient.reportVacancy:', e.message),
      ),
    reportNegotiation: (deviceToken, fields) =>
      request('/api/events/negotiation', { method: 'POST', token: deviceToken, body: fields }).catch((e) =>
        console.warn('coreApiClient.reportNegotiation:', e.message),
      ),
    reportAlert: (deviceToken, message) =>
      request('/api/events/alert', { method: 'POST', token: deviceToken, body: { message } }).catch((e) =>
        console.warn('coreApiClient.reportAlert:', e.message),
      ),
    // Точные метрики со стороны hh (число приглашений на собеседование) — чтобы
    // веб-кабинет показывал ровно то же, что и лаунчер.
    reportStats: (deviceToken, stats) =>
      request('/api/events/stats', { method: 'POST', token: deviceToken, body: stats }).catch((e) =>
        console.warn('coreApiClient.reportStats:', e.message),
      ),
  };
}

module.exports = { createCoreApiClient };
