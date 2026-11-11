// Раздел «Безопасно». Каждое утверждение здесь — проверяемый факт о продукте, а не
// общие слова: лаунчер распространяется zip-архивом без установщика и прав
// администратора, вход в hh.ru идёт в собственном браузере пользователя, лаунчер ходит
// на сервер только по HTTPS, пароли кабинета — bcrypt, оплата — на стороне ЮMoney,
// время созвона и переезд автопилот не решает (см. negotiationsWatcher / replyAgent).
// Проверку антивирусом Kaspersky подтвердил владелец. Про 152-ФЗ здесь намеренно
// ничего нет: база пока не в РФ, политика конфиденциальности — черновик; заявлять
// соответствие, которого нет, нельзя. Логотип Kaspersky не ставим — только название:
// чужой логотип на коммерческом сайте читается как официальное партнёрство.

import { IconCarousel, type CarouselItem } from './IconCarousel';

const glyph = (d: string) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d={d} />
  </svg>
);

const ITEMS: CarouselItem[] = [
  {
    id: 'kaspersky',
    name: 'Проверено Kaspersky',
    text: 'Файлы лаунчера проверены антивирусом Kaspersky. Это обычный zip-архив: без установщика, '
      + 'прав администратора, служб и драйверов — распаковали и запустили.',
    icon: glyph('M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5zm-1.2 13.4l6-6-1.4-1.4-4.6 4.6-2.2-2.2-1.4 1.4z'),
  },
  {
    id: 'password',
    name: 'Пароль от hh.ru остаётся у вас',
    text: 'Вы входите в hh.ru сами, в обычном окне браузера. Пароль и сессия хранятся только на '
      + 'вашем компьютере — мы их не видим и не получаем.',
    icon: glyph('M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3zm3 4a2 2 0 0 1 1 3.73V19h-2v-1.27A2 2 0 0 1 12 14z'),
  },
  {
    id: 'data',
    name: 'Данные — по минимуму',
    text: 'На сервере только то, что нужно для личного кабинета: email, настройки и история '
      + 'откликов и переписки. Используем их только для работы сервиса и никому не продаём.',
    icon: glyph('M12 2C7 2 4 3.8 4 6v12c0 2.2 3 4 8 4s8-1.8 8-4V6c0-2.2-3-4-8-4zm0 2c3.9 0 6 1.3 6 2s-2.1 2-6 2-6-1.3-6-2 2.1-2 6-2zm-6 4.7C7.5 9.5 9.6 10 12 10s4.5-.5 6-1.3V12c0 .7-2.1 2-6 2s-6-1.3-6-2zm0 5.3c1.5.8 3.6 1.3 6 1.3s4.5-.5 6-1.3V18c0 .7-2.1 2-6 2s-6-1.3-6-2z'),
  },
  {
    id: 'crypto',
    name: 'Шифрование и хеши',
    text: 'Лаунчер и кабинет обмениваются данными только по HTTPS. Пароль от аккаунта Откликс '
      + 'хранится в виде хеша bcrypt — прочитать его из базы нельзя даже нам.',
    // Цифровой ключ: контурная пиктограмма в том же currentColor и том же
    // viewBox 24×24, что у остальных, — размер задаёт .fs-item__medal svg.
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {/* Сам ключ — заливкой, как остальные пиктограммы набора; дорожки и
            контакты — линиями, иначе на 68px они слипаются в пятно. */}
        {/* Ключ сдвинут на 0.6 влево — к центру масс: бородка справа иначе «тянула»
            его вбок, и значок выглядел кривым. Дорожки с обеих сторон отстоят от ключа
            одинаково — раньше справа они упирались прямо в бородку. */}
        <g transform="translate(-0.6 0)">
          <path
            fill="currentColor"
            stroke="none"
            d="M12 2a4.1 4.1 0 0 0-1.35 7.98V20.6c0 .33.27.6.6.6h1.5c.33 0 .6-.27.6-.6v-1.35h1.25c.3 0 .55-.25.55-.55v-.9c0-.3-.25-.55-.55-.55H13.35v-1.3h1.6c.3 0 .55-.25.55-.55v-.9c0-.3-.25-.55-.55-.55h-1.6V9.98A4.1 4.1 0 0 0 12 2zm0 2.25a1.85 1.85 0 1 1 0 3.7 1.85 1.85 0 0 1 0-3.7z"
          />
        </g>
        <path d="M4.5 9.6h1.8l1.3 1.3" />
        <path d="M19.5 9.6h-1.9l-1.3 1.3" />
        <path d="M4.5 14.3h3" />
        <path d="M19.5 14.3h-2.1" />
        <path d="M4.5 19.6h1.8l1.3-1.3" />
        <path d="M19.5 19.6h-1.5l-1.1-1.1" />
        <g fill="currentColor" stroke="none">
          <circle cx="3.3" cy="9.6" r="1.15" />
          <circle cx="20.7" cy="9.6" r="1.15" />
          <circle cx="3.3" cy="14.3" r="1.15" />
          <circle cx="20.7" cy="14.3" r="1.15" />
          <circle cx="3.3" cy="19.6" r="1.15" />
          <circle cx="20.7" cy="19.6" r="1.15" />
        </g>
      </svg>
    ),
  },
  {
    id: 'payment',
    name: 'Оплата на стороне ЮMoney',
    text: 'Данные карты вы вводите на защищённой странице ЮMoney — к нам они не попадают '
      + 'ни в каком виде.',
    icon: glyph('M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H4v-6h16zm0-10H4V6h16zM6 15h5v1.5H6z'),
  },
  {
    id: 'decisions',
    name: 'Главное решаете вы',
    text: 'Время созвона, переезд, готовность к командировкам и прочие вопросы, на которые '
      + 'нельзя ответить без вашего участия, автопилот не решает сам: такие ситуации '
      + 'уведомлениями приходят вам в лаунчер и на сайт.',
    icon: glyph('M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12zm0 2c-4.4 0-8 2.4-8 5.4V21h16v-1.6c0-3-3.6-5.4-8-5.4z'),
  },
];

export function SecuritySection() {
  return (
    <section id="security" className="section section--subtle">
      <div className="container">
        <div className="security-head">
          <div className="reveal">
            <span className="eyebrow">Безопасно</span>
            <h2 style={{ marginTop: 16 }}>Лаунчер Откликс проверен антивирусом Kaspersky</h2>
            <p className="muted" style={{ marginTop: 16 }}>
              Откликс не просит пароль от hh.ru и никуда его не отправляет. Лаунчер работает на
              вашем компьютере и ходит в hh.ru через ваш собственный браузер — так же, как если бы
              вы откликались сами. А то немногое, что хранится у нас, защищено по-взрослому.
            </p>
          </div>

          <div className="security-visual reveal" aria-hidden="true">
            <div className="security-visual__glow" />
            <div className="security-visual__blob"><span /></div>
            <svg className="security-visual__shield" viewBox="0 0 120 140">
              <defs>
                <linearGradient id="sec-shield-fill" x1="20" y1="8" x2="100" y2="134" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#ffffff" stopOpacity="0.97" />
                  <stop offset="1" stopColor="#e4fbf6" stopOpacity="0.84" />
                </linearGradient>
              </defs>
              <path
                d="M60 6l46 17.5V64c0 31-19.6 54.6-46 66C33.6 118.6 14 95 14 64V23.5z"
                fill="url(#sec-shield-fill)"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth="1.5"
              />
              <path className="security-visual__check" d="M40 70l14.5 14.5L82 56" />
            </svg>
          </div>
        </div>

        <div className="security-carousel reveal">
          <IconCarousel items={ITEMS} label="Что именно защищено в Откликс" />
        </div>
      </div>
    </section>
  );
}
