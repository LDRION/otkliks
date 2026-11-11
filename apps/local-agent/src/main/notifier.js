/**
 * notifier.js — Notifier для automation-core (notifyApplied/notifyReply/notifyAlert):
 * событие в рендерер (для живой ленты в лаунчере). Репорт на core-api
 * (для веб-дашборда) идёт отдельно, через reportingStore.js — notifyApplied не получает
 * vacancyId в payload (см. applyJob.js), а storage.saveVacancy получает его всегда, поэтому
 * репортинг туда и вынесен, а не сюда.
 */

// Системные toast'ы Windows отсюда убраны намеренно. Автопилот работает часами и
// отправляет десятки откликов — каждый из них всплывал отдельным окном поверх всего,
// со звуком, и за день это превращалось в шум, который хочется отключить вместе с
// программой. Всё то же самое уходит в ленту внутри лаунчера: тихо, в одном месте,
// с историей, которую можно пролистать.
function createNotifier({ onEvent, coreApi, getDeviceToken }) {
  // В событиях теперь не только «что произошло», но и «что именно мы написали». Человек
  // отдал автопилоту переписку от своего имени и вправе видеть каждое слово, ушедшее
  // работодателю: текст письма, текст ответа, ответы в анкете.
  async function notifyApplied({ title, company, url, coverLetterText }) {
    onEvent?.({ type: 'applied', title, company, url, details: coverLetterText, at: Date.now() });
  }

  async function notifyReply({ negotiationId, vacancyTitle, company, replyText, incomingText, url }) {
    onEvent?.({
      type: 'reply',
      title: vacancyTitle,
      company,
      url,
      message: replyText,
      incoming: incomingText,
      details: replyText,
      at: Date.now(),
    });

    // Явный, однозначный сигнал "ответ реально только что ушёл" — этот код вызывается
    // РОВНО один раз, сразу после успешной отправки (см. negotiationsWatcher.js). Раньше
    // сервер узнавал о новом ответе через reportingStore.js, который гадал по тому, что
    // ПОСЛЕДНЕЕ сообщение в массиве — от ИИ; но saveNegotiation вызывается на КАЖДОМ
    // круге и для уже давно отвеченных тредов (просто синхронизирует историю), и там
    // последнее сообщение тоже от ИИ — просто не новое. Каждый такой круг создавал в
    // кабинете на сайте новое событие «Ответили в чате» для месяцами закрытого диалога.
    const token = getDeviceToken?.();
    if (token && coreApi?.reportNegotiation) {
      await coreApi.reportNegotiation(token, {
        negotiationId, vacancyTitle, company, url,
        newAiMessage: replyText, incoming: incomingText,
      }).catch(() => {});
    }
  }

  async function notifyFormFilled({ vacancyTitle, company, formTitle, url, fields }) {
    // title — вакансия (как у всех событий ленты), formTitle — сама анкета. Раньше в
    // title шло название формы, а вакансия терялась.
    onEvent?.({
      type: 'form',
      title: vacancyTitle || formTitle || 'Анкета работодателя',
      formTitle: formTitle || 'Анкета работодателя',
      company,
      url,
      fields: fields || [],
      at: Date.now(),
    });

    // И на сервер: кабинет на сайте должен показывать то же самое, что лента в
    // лаунчере — человек смотрит туда, где ему удобнее.
    const token = getDeviceToken?.();
    if (token && coreApi?.reportForm) {
      await coreApi.reportForm(token, {
        title: vacancyTitle || formTitle || 'Анкета работодателя',
        formTitle: formTitle || 'Анкета работодателя',
        company,
        url,
        fields: fields || [],
      }).catch(() => {});
    }
  }

  async function notifyAlert(message) {
    onEvent?.({ type: 'alert', message, at: Date.now() });
  }

  // 🎉 Приглашение на созвон/собеседование, подтверждённое в ЧАТЕ — «победа» первичного
  // этапа. В ленту (зелёным, отдельно) и на сервер, чтобы кабинет на сайте показал то же.
  async function notifyInterviewInvite({ vacancyTitle, company, url, incomingText }) {
    onEvent?.({
      type: 'interview_invite', title: vacancyTitle, company, url,
      incoming: incomingText, at: Date.now(),
    });
    const token = getDeviceToken?.();
    if (token && coreApi?.reportInterviewInvite) {
      await coreApi.reportInterviewInvite(token, {
        title: vacancyTitle, company, url, incoming: incomingText,
      }).catch(() => {});
    }
  }

  // 🙋 Вопрос, на который ИИ честно не может ответить сам — важный факт вне резюме/стека.
  // В ленту (чтобы было видно, что диалог не брошен) и на сервер, чтобы кабинет на сайте
  // тоже показал «нужен ваш ответ» — сам список с полным контекстом лаунчер/сайт читают
  // из своего хранилища (store.getOpenClarifications / GET /api/activity/clarifications).
  async function notifyClarificationNeeded({ negotiationId, vacancyTitle, company, question, url }) {
    onEvent?.({ type: 'clarification_needed', title: vacancyTitle, company, url, message: question, at: Date.now() });
    const token = getDeviceToken?.();
    if (token && coreApi?.reportClarificationNeeded) {
      await coreApi.reportClarificationNeeded(token, { negotiationId, title: vacancyTitle, company, url, question }).catch(() => {});
    }
  }

  // Ответ на уточнение реально ушёл работодателю — отмечаем на сервере, чтобы кабинет на
  // сайте (если человек ответил там) не показывал вопрос как всё ещё открытый.
  async function notifyClarificationDelivered({ negotiationId, question, sentText }) {
    const token = getDeviceToken?.();
    if (token && coreApi?.markClarificationDelivered) {
      await coreApi.markClarificationDelivered(token, { negotiationId, question, sentText }).catch(() => {});
    }
  }

  return {
    notifyApplied, notifyReply, notifyFormFilled, notifyAlert, notifyInterviewInvite,
    notifyClarificationNeeded, notifyClarificationDelivered,
  };
}

module.exports = { createNotifier };
