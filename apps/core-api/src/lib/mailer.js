const nodemailer = require('nodemailer');

// Транзакционные письма Откликс — НЕ используем SMTP-ящик Siberi (noreply@siberi.online):
// разные продукты, разный домен, чужая репутация отправителя. Нужен свой ящик на otkliks.ru.
// Пока SMTP_HOST не задан — просто логируем и не роняем вызывающий код (тот же паттерн,
// что и YOOMONEY_WALLET/SIBERI_API_KEY до заполнения).
//
// ── Почему здесь ретраи и откат на текст ────────────────────────────────────
// Замерено на живом ящике 23.09.2026: исходящий антиспам Яндекса отбраковывает
// ЧАСТЬ наших HTML-писем кодом «554 5.7.1 Message rejected under suspicion of
// SPAM», причём непредсказуемо. Проверено и исключено: размер письма (отказное
// на 4966 байт меньше прошедшего на 5763), отдельные формулировки, картинка-
// логотип, скрытая строка предпросмотра и репутация отправителя (письмо,
// прошедшее ранее, проходит и после серии отказов). При этом ТО ЖЕ САМОЕ
// содержимое простым текстом уходит всегда.
//
// Гадать, какое слово не понравится фильтру в следующий раз, бессмысленно —
// это чёрный ящик, и любая правка шаблона может тихо сломать доставку. Поэтому:
// не прошёл HTML — отправляем то же письмо текстом. Для ссылки восстановления
// пароля это разница между «человек вернул доступ» и «человек потерял аккаунт».
//
// Правильное решение — отдельный сервис транзакционных рассылок (Яндекс 360 это
// почтовые ЯЩИКИ, а не рассылочная платформа, и её фильтры настроены на живую
// переписку). Пока его нет, работает этот откат.

let cachedTransport = null;

function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  if (cachedTransport) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return cachedTransport;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Код ответа SMTP из ошибки nodemailer: 554, 451 и т.п. */
function smtpCode(err) {
  return err?.responseCode || Number(String(err?.message || '').match(/\b([45]\d\d)\b/)?.[1]) || 0;
}

/** Отказ по подозрению в спаме — HTML не понравился фильтру. */
function isSpamRejection(err) {
  return /5\.7\.1|suspicion of SPAM/i.test(String(err?.message || ''));
}

/** Временная ошибка (4xx): очередь занята, лимит отправки — имеет смысл повторить. */
function isTemporary(err) {
  const code = smtpCode(err);
  return code >= 400 && code < 500;
}

async function sendMail({ to, subject, html, text, headers }) {
  // Адрес-заглушка аккаунта из VK без почты (vk_…@oauth.otkliks.local). Домена
  // .local нет в DNS: Яндекс отбивает такое письмо дважды (HTML и текстовый
  // откат), и каждый отказ портит репутацию отправителя. Проверка здесь, а не у
  // вызывающих: так она покрывает сразу всё — приветствие, чек, напоминание.
  if (/@oauth\.otkliks\.local$/i.test(String(to || ''))) {
    return { sent: false, reason: 'no-real-email' };
  }
  // Зарезервированные домены (RFC 2606/6761/6762): писем туда не существует, а
  // попытка — это отказ, который портит репутацию отправителя. На них живут
  // тестовые аккаунты сквозных проверок.
  if (/@([^@]+\.)?(local|test|invalid|example|localhost)$|@example\.(com|org|net)$/i.test(String(to || ''))) {
    return { sent: false, reason: 'reserved-domain' };
  }
  const transport = getTransport();
  if (!transport) {
    console.warn(`⚠️ SMTP не настроен — письмо «${subject}» для ${to} не отправлено`);
    return { sent: false, reason: 'smtp-not-configured' };
  }

  const from = process.env.SMTP_FROM || 'Откликс <noreply@otkliks.ru>';
  // Текстовую версию шаблоны пишут руками. Вырезание тегов регулярками —
  // аварийный откат для писем без неё: слепляет слова, но лучше пустоты.
  const plain = text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const attempt = (payload) => transport.sendMail({ from, to, subject, ...(headers ? { headers } : {}), ...payload });

  try {
    const info = await attempt({ html, text: plain });
    return { sent: true, format: 'html', accepted: info.accepted, rejected: info.rejected, response: info.response };
  } catch (e) {
    // Временная ошибка — ждём и пробуем ещё раз тем же составом.
    if (isTemporary(e)) {
      console.warn(`✉️ Временный отказ (${smtpCode(e)}) для «${subject}» → ${to}, повтор через 5 с`);
      await delay(5000);
      try {
        const info = await attempt({ html, text: plain });
        return { sent: true, format: 'html', retried: true, accepted: info.accepted, response: info.response };
      } catch (e2) {
        if (!isSpamRejection(e2)) {
          console.error(`✉️ ПИСЬМО НЕ ДОСТАВЛЕНО «${subject}» → ${to}: ${e2.message}`);
          return { sent: false, error: e2.message };
        }
        e = e2;
      }
    }

    // Фильтр забраковал HTML — то же содержимое уходит простым текстом.
    if (isSpamRejection(e)) {
      console.warn(`✉️ HTML-версия «${subject}» отклонена антиспамом Яндекса → отправляем текстом`);
      try {
        const info = await attempt({ text: plain });
        return { sent: true, format: 'text', degraded: true, accepted: info.accepted, response: info.response };
      } catch (e2) {
        console.error(`✉️ ПИСЬМО НЕ ДОСТАВЛЕНО «${subject}» → ${to}: ${e2.message}`);
        return { sent: false, error: e2.message };
      }
    }

    console.error(`✉️ ПИСЬМО НЕ ДОСТАВЛЕНО «${subject}» → ${to}: ${e.message}`);
    return { sent: false, error: e.message };
  }
}

module.exports = { sendMail };
