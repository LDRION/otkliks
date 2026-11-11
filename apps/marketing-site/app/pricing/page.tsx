import Link from 'next/link';
import type { Metadata } from 'next';
import { SITE_URL, SITE_NAME, buildBreadcrumbJsonLd } from '@/lib/site';
import { PricingPlans } from './PricingPlans';

// Страница тарифов. Все утверждения сверены с кодом: лимиты — core-api/src/lib/planLimits.js
// (100 откликов в день бесплатно со всеми функциями, до 200 и приоритет на платном), цены — routes/payment.js (99 ₽ / 7 дней,
// 199 ₽ / 30 дней, ЮMoney), автопродления нет — lib/subscriptionReminders.js (за 48 часов
// до конца периода уходит письмо-напоминание). После окончания периода аккаунт сам
// возвращается на бесплатный тариф (effectiveDailyCap). Облачный тариф — в разработке.

const TITLE = 'Тарифы: автоотклик на hh.ru бесплатно или от 99 ₽ в неделю';
const DESCRIPTION =
  'Сравните тарифы Откликс: бесплатно — до 100 откликов в день с письмом под каждую вакансию, перепиской с работодателями и анкетами; платный за 99 ₽ в неделю или 199 ₽ в месяц — приоритетная обработка и до 200 откликов.';
const PATH = '/pricing';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}${PATH}` },
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    siteName: SITE_NAME,
    url: `${SITE_URL}${PATH}`,
    title: 'Тарифы Откликс — полный автопилот поиска работы дешевле чашки кофе в день',
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Тарифы Откликс — полный автопилот поиска работы дешевле чашки кофе в день',
    description: DESCRIPTION,
  },
};

const breadcrumbJsonLd = buildBreadcrumbJsonLd([
  { name: 'Главная', path: '/' },
  { name: 'Тарифы', path: PATH },
]);

const offersJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Откликс — автоотклик на вакансии hh.ru',
  brand: { '@type': 'Brand', name: SITE_NAME },
  description: DESCRIPTION,
  offers: [
    { '@type': 'Offer', name: 'Бесплатный тариф', price: '0', priceCurrency: 'RUB', url: `${SITE_URL}${PATH}#free` },
    { '@type': 'Offer', name: 'Локальный агент — 7 дней', price: '99', priceCurrency: 'RUB', url: `${SITE_URL}${PATH}#local` },
    { '@type': 'Offer', name: 'Локальный агент — 30 дней', price: '199', priceCurrency: 'RUB', url: `${SITE_URL}${PATH}#local` },
  ],
};

type Mark = 'yes' | 'no' | string;
const ROWS: { label: string; free: Mark; local: Mark; cloud: Mark }[] = [
  { label: 'Цена', free: '0 ₽', local: '99 ₽ / 7 дней или 199 ₽ / 30 дней', cloud: 'объявим позже' },
  { label: 'Откликов в день', free: '10', local: 'до 200', cloud: '—' },
  { label: 'Письмо под каждую вакансию', free: 'yes', local: 'yes', cloud: 'yes' },
  { label: 'Подбор вакансий по резюме', free: 'yes', local: 'yes', cloud: 'yes' },
  { label: 'Переписка с работодателями в чате', free: 'no', local: 'yes', cloud: 'yes' },
  { label: 'Заполнение анкет и опросов', free: 'no', local: 'yes', cloud: 'yes' },
  { label: 'Где работает', free: 'ваш компьютер', local: 'ваш компьютер', cloud: 'серверы Откликс' },
  { label: 'Пароль и сессия hh.ru', free: 'остаются у вас', local: 'остаются у вас', cloud: 'у нас, в зашифрованном виде' },
  { label: 'Работает при выключенном компьютере', free: 'no', local: 'no', cloud: 'yes' },
];

const TRUST = [
  {
    id: 'no-auto',
    title: 'Без автосписаний',
    text: 'Оплатили неделю или месяц — и всё. Продлеваете, только когда решите сами; за двое суток до конца периода напомним на почту.',
    icon: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 2a8 8 0 0 1 6.3 12.9L7.1 5.7A8 8 0 0 1 12 4zM5.7 7.1l11.2 11.2A8 8 0 0 1 5.7 7.1z',
  },
  {
    id: 'forever',
    title: 'Бесплатный — полный и навсегда',
    text: '100 откликов в день со всеми функциями, без карты и без даты окончания. Взамен — четыре простых задания в первые дни.',
    icon: 'M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z',
  },
  {
    id: 'yoomoney',
    title: 'Оплата через ЮMoney',
    text: 'Данные карты вы вводите на защищённой странице ЮMoney — к нам они не попадают ни в каком виде.',
    icon: 'M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H4v-6h16zm0-10H4V6h16zM6 15h5v1.5H6z',
  },
  {
    id: 'instant',
    title: 'Сразу после оплаты',
    text: 'Лимит вырастает до 200 откликов в день, ваши запросы встают в приоритетную очередь, а задания больше не нужны.',
    icon: 'M13 2 4 14h7l-1 8 9-12h-7z',
  },
];

const FAQ = [
  {
    q: 'Бесплатный тариф правда бесплатный навсегда?',
    a: 'Да. До 100 откликов в день с письмом под каждую вакансию, переписка с работодателями и заполнение анкет — без карты и без даты окончания. В первые четыре дня — по одному простому заданию: подписаться на наш Telegram, ВКонтакте, YouTube и оставить отзыв. Пока задание дня не выполнено, автопилот ждёт; после четвёртого заданий больше нет.',
  },
  {
    q: 'Зачем тогда платить?',
    a: 'За приоритет. В часы пик запросы платных пользователей — отклики, письма, ответы работодателям — обрабатываются первыми, а бесплатные ждут своей очереди. Плюс до 200 откликов в день вместо 100 и никаких заданий.',
  },
  {
    q: 'Чем неделя отличается от месяца?',
    a: 'Только сроком — возможности одинаковые. Месяц выгоднее: 199 ₽ за 30 дней против примерно 424 ₽, если платить по неделям. Неделя за 99 ₽ — чтобы попробовать полный автопилот без обязательств.',
  },
  {
    q: 'Будут ли автоматические списания?',
    a: 'Нет. Оплата разовая за выбранный период. За двое суток до его окончания мы пришлём письмо — продлить или нет, решаете вы.',
  },
  {
    q: 'Что будет, когда оплаченный период закончится?',
    a: 'Аккаунт сам вернётся на бесплатный тариф: до 100 откликов в день со всеми функциями продолжат уходить, только без приоритета в очереди.',
  },
  {
    q: 'Чем локальный агент отличается от облачного тарифа?',
    a: 'Движок один и тот же. Локальный агент работает на вашем компьютере и в вашем браузере — пароль и сессия hh.ru не покидают его, но компьютер должен быть включён. Облачный тариф будет работать круглосуточно на наших серверах; он в разработке.',
  },
];

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
};

function Cell({ v }: { v: Mark }) {
  if (v === 'yes') return <span className="pr-mark pr-mark--yes" aria-label="есть">✓</span>;
  if (v === 'no') return <span className="pr-mark pr-mark--no" aria-label="нет">—</span>;
  return <>{v}</>;
}

export default function PricingPage() {
  return (
    <main>
      {[breadcrumbJsonLd, offersJsonLd, faqJsonLd].map((ld, i) => (
        <script
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
        />
      ))}

      {/* ——— Первый экран ——— */}
      <section className="section pr-hero">
        <div className="container pr-hero__row">
          <div className="pr-hero__copy reveal">
            <span className="eyebrow">Тарифы</span>
            <h1 className="pr-hero__title">
              Полный автопилот поиска работы — <span className="pr-accent">дешевле чашки кофе</span>{'\u00a0'}в{'\u00a0'}день
            </h1>
            <p className="lead pr-hero__lead">
              100 откликов в день с письмом под каждую вакансию, переписка с эйчарами и
              заполнение анкет — бесплатно и навсегда. Нужно больше и быстрее: до 200 откликов
              в день с приоритетной обработкой — за 199 ₽ в месяц.
            </p>
            <div className="pr-hero__actions">
              <Link href="/app/register" className="btn btn--primary">Начать бесплатно</Link>
              <a href="#compare" className="btn btn--ghost">Сравнить тарифы</a>
            </div>
            <ul className="pr-chips">
              <li>Без карты</li>
              <li>Без автосписаний</li>
              <li>Оплата через ЮMoney</li>
            </ul>
          </div>

          {/* «Чек» полного автопилота: цена за день, что в неё входит и сколько выходит
              за отклик при полной загрузке (199 ₽ / 30 дней / 200 откликов ≈ 3 коп.). */}
          <div className="pr-receipt-wrap reveal" aria-hidden="true">
            <span className="pr-receipt__glow" />
            <div className="pr-receipt">
              <div className="pr-receipt__head">
                <span className="pr-receipt__plan">Полный автопилот</span>
                <span className="pr-receipt__tag">Локальный агент</span>
              </div>
              <div className="pr-receipt__price">
                <span className="pr-receipt__approx">≈</span>7 ₽<small>в день</small>
              </div>
              <ul className="pr-receipt__lines">
                <li><span>Откликов в день</span><b>до 200</b></li>
                <li><span>Письмо под каждую вакансию</span><b>✓</b></li>
                <li><span>Переписка с работодателями</span><b>✓</b></li>
                <li><span>Анкеты и опросы по ссылкам</span><b>✓</b></li>
              </ul>
              <div className="pr-receipt__total">
                <span>Итого за 30 дней</span>
                <b>199 ₽</b>
              </div>
            </div>
            <span className="pr-float pr-float--a">≈ 3 коп. за отклик</span>
            <span className="pr-float pr-float--b">до 6 000 откликов в месяц</span>
          </div>
        </div>
      </section>

      {/* ——— Тарифы ——— */}
      <section id="compare" className="section section--subtle pr-plans">
        <div className="container">
          <div className="pr-plans__head reveal">
            <span className="eyebrow">Выберите темп</span>
            <h2 className="pr-h2">Три тарифа — один и тот же движок</h2>
            <p className="muted pr-plans__sub">
              Письма одинаково хорошие на любом тарифе. Разница — в объёме, в переписке с
              работодателями и в том, где работает ваша сессия hh.ru.
            </p>
          </div>
          <PricingPlans />
        </div>
      </section>

      {/* ——— Цифры ——— */}
      <section className="section pr-math">
        <div className="container">
          <span className="eyebrow reveal">Посчитали за вас</span>
          <h2 className="pr-h2 reveal">Во что на самом деле обходится автопилот</h2>
          <div className="pr-math__grid">
            <div className="pr-stat reveal">
              <span className="pr-stat__value">≈ 7 ₽</span>
              <span className="pr-stat__label">в день на месячном тарифе — меньше, чем кофе навынос</span>
            </div>
            <div className="pr-stat reveal">
              <span className="pr-stat__value">≈ 3 коп.</span>
              <span className="pr-stat__label">за отклик с письмом, если автопилот работает на полную — 200 в день</span>
            </div>
            <div className="pr-stat reveal">
              <span className="pr-stat__value">до 6 000</span>
              <span className="pr-stat__label">откликов за 30 дней — вручную, с письмом под каждую, на это ушли бы месяцы</span>
            </div>
          </div>
        </div>
      </section>

      {/* ——— Сравнение ——— */}
      <section className="section section--subtle">
        <div className="container">
          <span className="eyebrow reveal">Без мелкого шрифта</span>
          <h2 className="pr-h2 reveal">Что входит в каждый тариф</h2>
          <div className="pr-table-wrap reveal">
            <table className="pr-table">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">Возможность</span></th>
                  <th scope="col">Бесплатный</th>
                  <th scope="col" className="is-featured">Локальный агент</th>
                  <th scope="col">Облачный <span className="pr-soon">скоро</span></th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    <td><Cell v={r.free} /></td>
                    <td className="is-featured"><Cell v={r.local} /></td>
                    <td><Cell v={r.cloud} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ——— Доверие ——— */}
      <section className="section">
        <div className="container">
          <span className="eyebrow reveal">Почему платить не страшно</span>
          <h2 className="pr-h2 reveal">Честные условия — без ловушек</h2>
          <div className="pr-trust">
            {TRUST.map((t) => (
              <div className="card pr-trust__item reveal" key={t.id}>
                <span className="pr-trust__ico" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d={t.icon} /></svg>
                </span>
                <h3 className="pr-trust__title">{t.title}</h3>
                <p className="muted">{t.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ——— Вопросы ——— */}
      <section className="section section--subtle">
        <div className="container pr-faq">
          <div className="reveal">
            <span className="eyebrow">Вопросы про оплату</span>
            <h2 className="pr-h2">Коротко о главном</h2>
          </div>
          <div className="pr-faq__list">
            {FAQ.map((f) => (
              <details className="pr-faq__item reveal" key={f.q}>
                <summary>{f.q}</summary>
                <p className="muted">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ——— Финал ——— */}
      <section className="section pr-final">
        <div className="container reveal" style={{ textAlign: 'center' }}>
          <h2>Начните сегодня — бесплатно</h2>
          <p className="lead" style={{ margin: '16px auto 0' }}>
            Подключите резюме — и Откликс начнёт откликаться за вас. Полный автопилот можно
            включить в любой момент из личного кабинета.
          </p>
          <div className="pr-hero__actions" style={{ justifyContent: 'center' }}>
            <Link href="/app/register" className="btn btn--primary">Начать бесплатно</Link>
            <a href="#compare" className="btn btn--ghost">Ещё раз к тарифам</a>
          </div>
        </div>
      </section>
    </main>
  );
}
