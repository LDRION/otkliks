const SITE_URL = process.env.SITE_URL || 'https://otkliks.ru';
const SUPPORT_EMAIL = 'support@otkliks.ru';

// Транзакционные письма Откликс.
//
// Почему вёрстка таблицами, а не div-ами, как было раньше: Outlook на Windows
// рисует письма движком Word, который не понимает ни flex, ни нормальные отступы у
// блочных элементов — макет расползался. Таблицы с role="presentation" (чтобы
// скринридер не читал их как таблицу данных) — единственный способ получить
// одинаковый результат в Gmail, Яндекс.Почте, Mail.ru и Outlook разом.
//
// Стили только инлайновые: Gmail вырезает <style> из <head> в мобильных клиентах,
// поэтому всё, что должно выжить обязательно, пишется в атрибут style на элементе.
// Блок <style> оставлен лишь для необязательных улучшений (шрифт, адаптив).
//
// Логотип — PNG, а не SVG: Gmail, Outlook и Яндекс.Почта вырезают <svg> целиком.
// Файл лежит в marketing-site/public/brand/logo-email.png (рендер logo-full.svg,
// 300×87 = двойная плотность к показу на 150px, белая подложка вместо альфы —
// на случай клиента, который решит перекрасить фон).
//
// Цвета взяты из globals.css сайта один в один: тот же навy, та же лазурь,
// те же границы и скругления — письмо должно выглядеть продолжением сайта.
const C = {
  navy: '#212d4e',
  teal: '#12edcf',
  text: '#14141f',
  muted: '#5b5f73',
  border: '#e6e8f0',
  bg: '#f6f7fb',
  white: '#ffffff',
  accentSoft: '#eef1f6',
};

const FONT = "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** Экранируем всё, что пришло от пользователя (имя вводится при регистрации). */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** «Здравствуйте, Имя!» — или просто «Здравствуйте!», если имя не указывали. */
function greeting(tenant) {
  const name = String(tenant?.fullName || '').trim();
  return name ? `Здравствуйте, ${esc(name)}!` : 'Здравствуйте!';
}

function greetingText(tenant) {
  const name = String(tenant?.fullName || '').trim();
  return name ? `Здравствуйте, ${name}!` : 'Здравствуйте!';
}

function p(html, { size = 15, top = 0, color = C.text } = {}) {
  return `<p style="margin:${top}px 0 0;font-family:${FONT};font-size:${size}px;line-height:1.65;color:${color};">${html}</p>`;
}

/**
 * Кнопка. Без VML-обёртки для Outlook: там скругление не поддерживается и кнопка
 * получится прямоугольной — выглядит нормально и намеренно, а дублировать ради
 * этого текст кнопки в двух местах (частый источник расхождений) смысла нет.
 */
function button(href, label) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
    <tr>
      <td align="center" bgcolor="${C.navy}" style="border-radius:999px;">
        <a href="${href}" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

/** Строка «ключ — значение» для чеков и сводок. */
function row(label, value, { strong = false } = {}) {
  return `
  <tr>
    <td style="padding:9px 0;border-bottom:1px solid ${C.border};font-family:${FONT};font-size:14px;color:${C.muted};">${label}</td>
    <td style="padding:9px 0;border-bottom:1px solid ${C.border};font-family:${FONT};font-size:14px;color:${C.text};text-align:right;${strong ? 'font-weight:700;' : ''}">${value}</td>
  </tr>`;
}

function table(rowsHtml) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;border-collapse:collapse;">${rowsHtml}</table>`;
}

/** Мягкая врезка — для примечаний, которые не должны теряться в тексте. */
function note(html) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">
    <tr>
      <td style="background:${C.accentSoft};border-radius:12px;padding:16px 18px;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.muted};">${html}</td>
    </tr>
  </table>`;
}

function layout({ title, preheader, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<!-- Явно объявляем светлую схему: иначе Apple Mail и Outlook сами инвертируют
     письмо в тёмной теме, и тёмно-синий логотип пропадает на тёмном фоне. -->
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&display=swap');
  body { margin:0 !important; padding:0 !important; width:100% !important; }
  @media screen and (max-width:600px) {
    .card { padding:26px 22px !important; }
    .h1 { font-size:21px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
  <!-- Строка предпросмотра в списке писем: видна в инбоксе, но не в самом письме. -->
  <div style="display:none;font-size:1px;color:${C.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:100%;max-width:560px;">
          <tr>
            <td class="card" bgcolor="${C.white}" style="background:${C.white};border:1px solid ${C.border};border-radius:14px;padding:34px 34px 36px;">
              <a href="${SITE_URL}" style="text-decoration:none;">
                <img src="${SITE_URL}/brand/logo-email.png" width="150" height="43" alt="Откликс"
                     style="display:block;border:0;outline:none;text-decoration:none;margin:0 0 26px;">
              </a>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:22px 6px 0;font-family:${FONT};font-size:12.5px;line-height:1.7;color:${C.muted};">
              Письмо отправлено автоматически, на этот адрес отвечать не нужно — по любым
              вопросам пишите на <a href="mailto:${SUPPORT_EMAIL}" style="color:${C.navy};">${SUPPORT_EMAIL}</a>.
              <br>
              <a href="${SITE_URL}" style="color:${C.muted};">otkliks.ru</a> ·
              <a href="${SITE_URL}/pricing" style="color:${C.muted};">Тарифы</a> ·
              <a href="${SITE_URL}/oferta" style="color:${C.muted};">Оферта</a> ·
              <a href="${SITE_URL}/privacy" style="color:${C.muted};">Политика конфиденциальности</a>
              <br>
              Откликс — независимый сервис, не связан с hh.ru.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Текстовая версия. Пишется руками для каждого письма, а не вырезается регулярками
 * из HTML (так было раньше — получалась каша из слипшихся слов). Нужна и ради
 * почтовых клиентов без HTML, и ради спам-фильтров: письмо без text-части
 * выглядит подозрительнее.
 */
function textLayout(lines) {
  return [
    ...lines,
    '',
    '—',
    'Письмо отправлено автоматически, отвечать на этот адрес не нужно.',
    `Вопросы: ${SUPPORT_EMAIL}`,
    SITE_URL,
    'Откликс — независимый сервис, не связан с hh.ru.',
  ].join('\n');
}

// ── Регистрация ─────────────────────────────────────────────────────────────
function welcomeEmail(tenant) {
  const title = 'Аккаунт в Откликс создан';
  return {
    subject: title,
    html: layout({
      title,
      preheader: 'Осталось два шага: заполнить профиль и установить лаунчер.',
      bodyHtml: `
        <h1 class="h1" style="margin:0;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:700;color:${C.navy};">Аккаунт создан</h1>
        ${p(greeting(tenant), { top: 18 })}
        ${p('Регистрация в Откликс прошла успешно. Чтобы автопилот заработал, осталось два шага: заполнить профиль в кабинете и установить лаунчер на компьютер.', { top: 14 })}
        ${p('В профиле нужна ссылка на ваше резюме и пара деталей о себе — из них сервис пишет сопроводительные письма под каждую вакансию.', { top: 14 })}
        ${button(`${SITE_URL}/app/profile`, 'Заполнить профиль')}
        ${p(`Если аккаунт создавали не вы — напишите нам на <a href="mailto:${SUPPORT_EMAIL}" style="color:${C.navy};">${SUPPORT_EMAIL}</a>, и мы его удалим.`, { top: 24, size: 13.5, color: C.muted })}
      `,
    }),
    text: textLayout([
      'Аккаунт создан',
      '',
      greetingText(tenant),
      '',
      'Регистрация в Откликс прошла успешно. Чтобы автопилот заработал, осталось два шага:',
      'заполнить профиль в кабинете и установить лаунчер на компьютер.',
      '',
      'В профиле нужна ссылка на ваше резюме и пара деталей о себе — из них сервис пишет',
      'сопроводительные письма под каждую вакансию.',
      '',
      `Заполнить профиль: ${SITE_URL}/app/profile`,
      '',
      `Если аккаунт создавали не вы — напишите на ${SUPPORT_EMAIL}, и мы его удалим.`,
    ]),
  };
}

// ── Восстановление пароля ───────────────────────────────────────────────────
function passwordResetEmail(tenant, { resetUrl, ttlMinutes }) {
  const title = 'Восстановление пароля';
  // «1 ч» в письме читается как строка из расписания — пишем словами.
  const hours = Math.round(ttlMinutes / 60);
  const ttl = ttlMinutes < 60
    ? `${ttlMinutes} минут`
    : hours === 1
      ? 'час'
      : `${hours} ${hours < 5 ? 'часа' : 'часов'}`;
  return {
    subject: 'Восстановление пароля в Откликс',
    html: layout({
      title,
      preheader: `Ссылка для смены пароля действует ${ttl}. Если это были не вы — письмо можно удалить.`,
      bodyHtml: `
        <h1 class="h1" style="margin:0;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:700;color:${C.navy};">Восстановление пароля</h1>
        ${p(greeting(tenant), { top: 18 })}
        ${p('Мы получили запрос на смену пароля от вашего аккаунта в Откликс. Нажмите кнопку — откроется страница, где можно задать новый пароль.', { top: 14 })}
        ${button(resetUrl, 'Задать новый пароль')}
        ${p(`Ссылка действует ${ttl} и сработает только один раз.`, { top: 22, size: 13.5, color: C.muted })}
        ${p(`Если кнопка не нажимается, скопируйте адрес в браузер:<br><a href="${resetUrl}" style="color:${C.navy};word-break:break-all;">${resetUrl}</a>`, { top: 12, size: 13.5, color: C.muted })}
        ${note(`<strong style="color:${C.navy};">Если пароль менять не собирались</strong> — ничего делать не нужно. Просто удалите это письмо: текущий пароль останется в силе, а ссылка сама перестанет работать. Доступ к аккаунту никто не получил.`)}
      `,
    }),
    text: textLayout([
      'Восстановление пароля в Откликс',
      '',
      greetingText(tenant),
      '',
      'Мы получили запрос на смену пароля от вашего аккаунта. Откройте ссылку,',
      'чтобы задать новый пароль:',
      '',
      resetUrl,
      '',
      `Ссылка действует ${ttl} и сработает только один раз.`,
      '',
      'Если пароль менять не собирались — просто удалите это письмо. Текущий пароль',
      'останется в силе, ссылка сама перестанет работать, доступ к аккаунту никто не получил.',
    ]),
  };
}

// ── Пароль изменён ──────────────────────────────────────────────────────────
// Отправляется и после смены пароля в кабинете, и после восстановления по ссылке.
// Это не формальность: если пароль сменил не владелец, единственный шанс заметить
// это вовремя — письмо на почту, к которой у чужого человека доступа нет.
function passwordChangedEmail(tenant) {
  const title = 'Пароль изменён';
  const when = new Date().toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
  });
  return {
    subject: 'Пароль от аккаунта Откликс изменён',
    html: layout({
      title,
      preheader: 'Если это были не вы — сразу напишите нам.',
      bodyHtml: `
        <h1 class="h1" style="margin:0;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:700;color:${C.navy};">Пароль изменён</h1>
        ${p(greeting(tenant), { top: 18 })}
        ${p(`Пароль от вашего аккаунта в Откликс был изменён ${when} (по Москве). Входить в кабинет и в лаунчер теперь нужно с новым паролем.`, { top: 14 })}
        ${note(`<strong style="color:${C.navy};">Если пароль меняли не вы</strong> — немедленно напишите на <a href="mailto:${SUPPORT_EMAIL}" style="color:${C.navy};">${SUPPORT_EMAIL}</a> с этого адреса. Мы поможем вернуть доступ.`)}
        ${button(`${SITE_URL}/app`, 'Открыть личный кабинет')}
      `,
    }),
    text: textLayout([
      'Пароль от аккаунта Откликс изменён',
      '',
      greetingText(tenant),
      '',
      `Пароль от вашего аккаунта был изменён ${when} (по Москве).`,
      'Входить в кабинет и в лаунчер теперь нужно с новым паролем.',
      '',
      `Если пароль меняли не вы — немедленно напишите на ${SUPPORT_EMAIL} с этого адреса.`,
    ]),
  };
}

// ── Пробный период по промокоду заканчивается ───────────────────────────────
function trialEndingEmail(tenant, { periodEnd, discountPercent }) {
  const until = new Date(periodEnd).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
  const title = 'Пробный период заканчивается';
  const disc = discountPercent > 0;
  return {
    subject: disc ? `Пробный период заканчивается — скидка ${discountPercent}% ещё действует` : 'Пробный период Откликс заканчивается',
    html: layout({
      title,
      preheader: disc ? `Продлите полный автопилот со скидкой ${discountPercent}% на первую оплату.` : 'После него вернётся бесплатный тариф.',
      bodyHtml: `
        <h1 class="h1" style="margin:0;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:700;color:${C.navy};">Пробный период заканчивается</h1>
        ${p(greeting(tenant), { top: 18 })}
        ${p(`Полный автопилот работает у вас до <strong style="color:${C.navy};">${until}</strong> (по Москве). После этого аккаунт вернётся на бесплатный тариф — до 100 откликов в день со всеми функциями, но без приоритета.`, { top: 14 })}
        ${disc ? p(`Для вас действует скидка <strong style="color:${C.navy};">${discountPercent}%</strong> на первую оплату — она применится автоматически.`, { top: 14 }) : ''}
        ${button(`${SITE_URL}/app`, disc ? `Продлить со скидкой ${discountPercent}%` : 'Продлить автопилот')}
      `,
    }),
    text: textLayout([
      'Пробный период Откликс заканчивается',
      '',
      greetingText(tenant),
      '',
      `Полный автопилот работает у вас до ${until} (по Москве). После этого вернётся`,
      'бесплатный тариф — до 100 откликов в день со всеми функциями, но без приоритета.',
      ...(disc ? ['', `Для вас действует скидка ${discountPercent}% на первую оплату — применится автоматически.`] : []),
      '',
      `Продлить: ${SITE_URL}/app`,
    ]),
  };
}

// ── Подтверждение почты ─────────────────────────────────────────────────────
// Нужно тем, кто вошёл через VK без почты: пока адрес не подтверждён, мы не
// можем прислать ни чек об оплате, ни ссылку восстановления доступа.
function confirmEmailEmail(tenant, { confirmUrl }) {
  const title = 'Подтвердите почту';
  return {
    subject: 'Подтвердите почту для Откликс',
    html: layout({
      title,
      preheader: 'Один клик — и уведомления, чеки и восстановление доступа будут приходить сюда.',
      bodyHtml: `
        <h1 class="h1" style="margin:0;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:700;color:${C.navy};">Подтвердите почту</h1>
        ${p(greeting(tenant), { top: 18 })}
        ${p('Вы указали этот адрес в личном кабинете Откликс. Подтвердите его — и сюда будут приходить уведомления, чеки об оплате и ссылки для восстановления доступа.', { top: 14 })}
        ${button(confirmUrl, 'Подтвердить почту')}
        ${p('Ссылка действует сутки.', { top: 22, size: 13.5, color: C.muted })}
        ${p(`Если кнопка не нажимается, скопируйте адрес в браузер:<br><a href="${confirmUrl}" style="color:${C.navy};word-break:break-all;">${confirmUrl}</a>`, { top: 12, size: 13.5, color: C.muted })}
        ${note('Если вы ничего не указывали — просто удалите письмо. Без подтверждения адрес к аккаунту не привяжется.')}
      `,
    }),
    text: textLayout([
      'Подтвердите почту для Откликс',
      '',
      greetingText(tenant),
      '',
      'Вы указали этот адрес в личном кабинете Откликс. Подтвердите его — и сюда будут',
      'приходить уведомления, чеки об оплате и ссылки для восстановления доступа.',
      '',
      confirmUrl,
      '',
      'Ссылка действует сутки. Если вы ничего не указывали — удалите письмо,',
      'без подтверждения адрес к аккаунту не привяжется.',
    ]),
  };
}

// ── Оплата получена ─────────────────────────────────────────────────────────
function paymentReceiptEmail(tenant, { plan, amount, periodEnd }) {
  const planLabel = plan === 'weekly' ? 'Локальный агент, 7 дней' : 'Локальный агент, 30 дней';
  const until = new Date(periodEnd).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const title = 'Оплата получена';
  return {
    subject: `Оплата получена — ${amount} ₽`,
    html: layout({
      title,
      preheader: `Подписка активна до ${until}. Лимит поднят до 200 откликов в день.`,
      bodyHtml: `
        <h1 class="h1" style="margin:0;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:700;color:${C.navy};">Оплата получена</h1>
        ${p(greeting(tenant), { top: 18 })}
        ${p('Спасибо — платёж прошёл, платный тариф уже активен на вашем аккаунте.', { top: 14 })}
        ${table(`
          ${row('Тариф', planLabel)}
          ${row('Сумма', `${amount} ₽`)}
          ${row('Действует до', until, { strong: true })}
        `)}
        ${p('Теперь доступно до 200 откликов в день, переписка с работодателями в чате и заполнение анкет. Подписка не продлевается сама — за двое суток до окончания мы напомним.', { top: 22 })}
        ${button(`${SITE_URL}/app`, 'Открыть личный кабинет')}
      `,
    }),
    text: textLayout([
      'Оплата получена',
      '',
      greetingText(tenant),
      '',
      'Спасибо — платёж прошёл, платный тариф активен на вашем аккаунте.',
      '',
      `Тариф: ${planLabel}`,
      `Сумма: ${amount} ₽`,
      `Действует до: ${until}`,
      '',
      'Теперь доступно до 200 откликов в день, переписка с работодателями в чате',
      'и заполнение анкет. Подписка не продлевается сама — за двое суток до окончания',
      'мы напомним.',
      '',
      `Личный кабинет: ${SITE_URL}/app`,
    ]),
  };
}

// ── Подписка скоро закончится ───────────────────────────────────────────────
function subscriptionExpiringEmail(tenant, { periodEnd }) {
  const until = new Date(periodEnd).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  // В теме — без года и «г.»: подписка истекает через двое суток, год очевиден,
  // а «23 октября 2026 г.» в строке темы читается как справка из бухгалтерии.
  const untilShort = new Date(periodEnd).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const title = 'Подписка скоро закончится';
  return {
    subject: `Подписка Откликс заканчивается ${untilShort}`,
    html: layout({
      title,
      preheader: 'Автопродления нет — если хотите продолжить, продлите вручную.',
      bodyHtml: `
        <h1 class="h1" style="margin:0;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:700;color:${C.navy};">Подписка скоро закончится</h1>
        ${p(greeting(tenant), { top: 18 })}
        ${p(`Ваш платный тариф действует до <strong style="color:${C.navy};">${until}</strong>. Мы не списываем деньги автоматически, поэтому предупреждаем заранее — если хотите продолжить, продлите подписку вручную.`, { top: 14 })}
        ${button(`${SITE_URL}/app`, 'Продлить подписку')}
        ${note('Если не продлевать — ничего страшного не произойдёт: аккаунт останется на месте вместе со всей историей откликов и переписки, просто вернётся бесплатный тариф: до 100 откликов в день, без приоритета.')}
      `,
    }),
    text: textLayout([
      'Подписка Откликс скоро закончится',
      '',
      greetingText(tenant),
      '',
      `Ваш платный тариф действует до ${until}. Деньги автоматически мы не списываем,`,
      'поэтому предупреждаем заранее — если хотите продолжить, продлите подписку вручную.',
      '',
      `Продлить: ${SITE_URL}/app`,
      '',
      'Если не продлевать — аккаунт останется на месте вместе со всей историей откликов',
      'и переписки, просто вернётся бесплатный тариф: до 100 откликов в день, без приоритета.',
    ]),
  };
}


// ── Подсказки «что осталось до запуска» (lib/activationEmails.js) ──────────────
// Только помощь с запуском — без рекламы и скидок: на рекламную рассылку по закону
// нужно отдельное согласие. В каждом письме — ссылка «отписаться» (только от этих
// подсказок; служебные письма остаются).
function unsubscribeNote(unsubUrl) {
  return p(`Это подсказка о том, что осталось до запуска. Больше не присылать такие письма —
    <a href="${esc(unsubUrl)}" style="color:${C.muted};">отписаться</a>.`, { top: 28, size: 12.5, color: C.muted });
}

function activationStepsEmail(tenant, { needResume, needLauncher, again, unsubUrl }) {
  const steps = [];
  if (needResume) steps.push(['Добавьте ссылку на резюме hh.ru', 'Из него автопилот пишет письмо под каждую вакансию — отдельно ничего заполнять не нужно.', `${SITE_URL}/app/profile`, 'Добавить резюме']);
  if (needLauncher) steps.push(['Скачайте лаунчер', 'Программа для Windows работает в вашем же браузере: пароль от hh.ru никуда не передаётся. Распакуйте архив и запустите Otkliks.exe.', `${SITE_URL}/app/devices`, 'Скачать лаунчер']);
  const title = again ? 'Автопилот всё ещё ждёт запуска' : 'До первых откликов — пара минут';
  const lead = again
    ? 'Аккаунт в Откликс есть, а откликов пока нет — автопилоту не хватает пары деталей.'
    : 'Вы зарегистрировались в Откликс — осталось совсем немного, чтобы автопилот начал откликаться на вакансии за вас.';
  const stepsHtml = steps.map(([h, d], i) => p(`<b>${i + 1}. ${esc(h)}</b><br>${esc(d)}`, { top: 14 })).join('');
  const [, , href, label] = steps[0];
  return {
    subject: title,
    html: layout({
      title,
      preheader: steps.map((x) => x[0]).join(' · '),
      bodyHtml: `
        <h1 class="h1" style="margin:0;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:700;color:${C.navy};">${esc(title)}</h1>
        ${p(greeting(tenant), { top: 18 })}
        ${p(esc(lead), { top: 14 })}
        ${stepsHtml}
        ${button(href, label)}
        ${p('Бесплатно — до 100 откликов в день с письмом, перепиской и анкетами, без карты.', { top: 18, size: 14, color: C.muted })}
        ${p(`Что-то не получается — напишите на <a href="mailto:${SUPPORT_EMAIL}" style="color:${C.navy};">${SUPPORT_EMAIL}</a>.`, { top: 14, size: 14 })}
        ${unsubscribeNote(unsubUrl)}
      `,
    }),
    text: textLayout([
      title, '', greetingText(tenant), '', lead, '',
      ...steps.flatMap(([h, d, u], i) => [`${i + 1}. ${h}`, d, u, '']),
      'Бесплатно — до 100 откликов в день с письмом, перепиской и анкетами, без карты.',
      `Что-то не получается — напишите на ${SUPPORT_EMAIL}.`,
      '', `Отписаться от подсказок: ${unsubUrl}`,
    ]),
  };
}

function activationFirstRunEmail(tenant, { unsubUrl }) {
  const title = 'Лаунчер установлен — осталось нажать «Запустить»';
  return {
    subject: title,
    html: layout({
      title,
      preheader: 'Автопилот ещё не отправил ни одного отклика.',
      bodyHtml: `
        <h1 class="h1" style="margin:0;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:700;color:${C.navy};">Осталось нажать «Запустить»</h1>
        ${p(greeting(tenant), { top: 18 })}
        ${p('Лаунчер Откликса подключён к вашему аккаунту, но автопилот пока не отправил ни одного отклика.', { top: 14 })}
        ${p('<b>Что сделать:</b> откройте лаунчер, при первом запуске войдите в свой hh.ru прямо в его окне браузера и нажмите «Запустить» на панели управления. Дальше он сам подберёт вакансии и напишет письма.', { top: 14 })}
        ${p(`Если лаунчер пишет об ошибке или вход в hh.ru не проходит — напишите на <a href="mailto:${SUPPORT_EMAIL}" style="color:${C.navy};">${SUPPORT_EMAIL}</a>, разберёмся.`, { top: 14 })}
        ${button(`${SITE_URL}/app`, 'Открыть кабинет')}
        ${unsubscribeNote(unsubUrl)}
      `,
    }),
    text: textLayout([
      title, '', greetingText(tenant), '',
      'Лаунчер подключён к вашему аккаунту, но автопилот пока не отправил ни одного отклика.',
      'Откройте лаунчер, войдите в hh.ru в его окне браузера и нажмите «Запустить».',
      `Если что-то не получается — напишите на ${SUPPORT_EMAIL}.`,
      '', `Кабинет: ${SITE_URL}/app`, '', `Отписаться от подсказок: ${unsubUrl}`,
    ]),
  };
}

module.exports = {
  activationStepsEmail,
  activationFirstRunEmail,
  welcomeEmail,
  passwordResetEmail,
  passwordChangedEmail,
  confirmEmailEmail,
  trialEndingEmail,
  paymentReceiptEmail,
  subscriptionExpiringEmail,
};
