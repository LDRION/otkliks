import Link from 'next/link';
import { PRICE_CLAIM, PRICE_CLAIM_NOTE } from '@/lib/priceClaim';
import { CloudWaitlist } from './components/cloud/CloudWaitlist';
import { CloudRevealTracker } from './components/cloud/CloudRevealTracker';
import type { Metadata } from 'next';
import { ResponseCalculator } from './components/ResponseCalculator';
import { HeroLaptopReveal } from './components/HeroLaptopReveal';
import { FormsTabletReveal } from './components/FormsTabletReveal';
import { FormSources } from './components/FormSources';
import { SecuritySection } from './components/SecuritySection';
import { Testimonials } from './components/Testimonials';
import { PricingPhoneReveal } from './components/PricingPhoneReveal';
import { listPosts } from '@/lib/blog';
import { SITE_URL, SITE_NAME, HOME_TITLE, HOME_DESCRIPTION, SOCIAL_TITLE } from '@/lib/site';

// Тексты — в lib/site.ts: их же берёт корневой layout как заголовок по умолчанию.
const TITLE = HOME_TITLE;
const DESCRIPTION = HOME_DESCRIPTION;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    siteName: SITE_NAME,
    url: SITE_URL,
    title: SOCIAL_TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: SOCIAL_TITLE,
    description: DESCRIPTION,
  },
};

const faq = [
  {
    q: 'За это не банят на hh.ru?',
    a: 'Мы намеренно ведём себя как живой человек — паузы между откликами, дневные лимиты, ни одного действия без реальной проверки на капчу/разлогин. За всё время разработки и полноценной работы Откликс не зафиксировано ни единого случая наложения ограничений на наших пользователей. Мы строим сервис так, чтобы риск стремился к нулю, а не игнорируем его ради скорости.',
  },
  {
    q: 'Вы видите мой пароль от hh.ru?',
    a: 'В приватном тарифе — нет, никогда: агент работает на вашем компьютере с вашей собственной сессией браузера, наши серверы её не видят. В облачном тарифе — да, сессия хранится и работает у нас, это и есть разница между тарифами. Мы говорим об этом прямо, а не прячем в EULA.',
  },
  {
    q: 'Почему AI пишет ответы в чате с работодателем?',
    a: 'В каждом ответе Откликс остаётся на вашей стороне: главная наша задача — избавить вас от головной боли невыносимо длительного поиска работы. Именно благодаря автоматическим ответам нашего ИИ вы вольны тратить своё время с пользой, перешагивая рутину и ожидая полноценных созвонов с работодателем или эйчарами. Если какой-то вопрос требует именно вашего решения, Откликс ничего не придумывает от себя — вы получите уведомление и ответите сами, когда будете готовы.',
  },
  {
    q: 'А если работодатель присылает ссылку и просит заполнить форму?',
    a: 'Заполняем и её. Автопилот открывает такую форму, сопоставляет поля с вашим резюме и отвечает по существу — так же, как в чате, а не наугад. Часть форм требует входа в Google или Яндекс: один раз войдите в аккаунт через лаунчер, дальше такие формы мы будем проходить сами. Функция включается по вашему согласию — при первом запуске лаунчер прямо спросит, можно ли ему это делать.',
  },
  {
    q: 'Чем локальный тариф отличается от облачного?',
    a: 'Локальный агент работает только пока включён ваш компьютер — зато мы физически не можем видеть вашу сессию hh.ru. Облачный тариф работает 24/7 даже при выключенном компьютере — но сессия при этом крутится на наших серверах. Это реальный компромисс, не маркетинговая уловка — выбирайте то, что важнее вам: неоспоримая безопасность или удобство.',
  },
  {
    q: 'Резюме нужно создавать заново на вашей стороне?',
    a: 'Нет. Вы просто указываете ссылку на своё уже существующее резюме на hh.ru — сервис читает его текст живьём перед каждой генерацией письма. Поменяли резюме на hh.ru — AI сразу это увидит, ничего синхронизировать вручную не нужно.',
  },
];

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faq.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
};

// Совпадает 1:1 с текстом секции «Как это работает» ниже — держим оба места
// в синхроне вручную, разметка не должна расходиться с тем, что видит человек.
const howToJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'Как настроить автоотклик на вакансии hh.ru через Откликс',
  description: 'Три шага, чтобы Откликс начал сам находить вакансии, писать письма и отвечать в чате на hh.ru.',
  step: [
    {
      '@type': 'HowToStep',
      name: 'Дайте ссылку на резюме',
      text: 'Резюме уже готово на hh.ru — вы просто указываете ссылку. Сервис ничего не создаёт заново и не хранит копию: читает актуальный текст перед каждым письмом.',
    },
    {
      '@type': 'HowToStep',
      name: 'AI подбирает и пишет',
      text: 'Сервис проверяет подходящие вакансии по расписанию и пишет сопроводительное письмо под конкретные требования каждой — без шаблонов.',
    },
    {
      '@type': 'HowToStep',
      name: 'Вы получаете приглашения',
      text: 'Каждый отклик и ответ в чате — в истории личного кабинета. Если вопрос требует вашего решения, сервис не отвечает сам и ждёт вас.',
    },
  ],
};

export default function HomePage() {
  // Читает БД при каждом заходе, без отдельного revalidate/dynamic-экспорта — корневой
  // layout уже проверяет cookie сессии через cookies() (см. isCustomerAuthed в
  // app/layout.tsx), а это само по себе делает динамическим весь сайт: новая статья
  // из админки появится в блоке ниже сразу, без пересборки.
  const latestPosts = listPosts({ publishedOnly: true }).slice(0, 3);

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }}
      />

      <main>
        {/* HERO — фото (job-img) кандидата на созвоне бьётся о левый край экрана (см.
            .hero-visual, флекс-элемент без контейнера — без процентных margin-трюков,
            которые раньше в связке с гридом давали горизонтальный скролл), текст справа.
            Макбук с реальными приглашениями на собеседование «подрастает» из нижней
            границы секции, сдвинут вправо — левее оставлено место под будущую анимацию. */}
        <section className="section hero">
          <div className="hero-row">
            <div className="hero-visual">
              {/* Транформ (сдвиг вправо на hover) висит на самом .hero-visual — двигается
                  весь блок целиком (рамка со скруглением и всё содержимое внутри как
                  единое целое), а не картинка внутри неподвижной рамки. */}
              <img
                className="hero-visual__photo"
                src="/images/otkliks-video-sobesedovanie.webp"
                alt="Кандидат проводит видеосозвон с работодателем после отклика через Откликс"
                width={1024}
                height={1024}
                // eslint-disable-next-line react/no-unknown-property
                fetchPriority="high"
              />
              {/* Появляется при наведении на весь hero, не только на саму картинку
                  (см. .hero-row:hover), декоративная — не дублирует alt. */}
              <div className="hero-visual__scrim" aria-hidden="true" />
              <p className="hero-visual__caption" aria-hidden="true">С нами найти работу просто.</p>
            </div>
            <div className="hero-copy-wrap">
              <div className="hero-copy">
                <span className="eyebrow">AI-автопилот соискателя для hh.ru</span>
                <h1 style={{ marginTop: 20 }}>
                  <span className="hero-h1-line">Работодатели уже автоматизировали отбор.</span>
                  <span className="hero-h1-line hero-h1-line--second">Пора ответить тем же.</span>
                </h1>
                <p className="lead" style={{ marginTop: 20 }}>
                  Поиск работы — это самая нудная работа. Откликс выполняет рутинные действия
                  подбора вакансий вместо вас: больше не нужно тратить часы напролёт для поиска
                  подходящих предложений, написания сопроводительных писем и ответов на вопросы
                  эйчаров. Скрипты, AI-ассистенты со стороны нанимателя — всё это больше вас не
                  беспокоит. Уделите время себе и близким, пока Откликс без устали ведёт вас к
                  созвонам, собеседованиям и техническим интервью.
                </p>
                <div style={{ display: 'flex', gap: 14, marginTop: 32, flexWrap: 'wrap' }}>
                  <Link href="#pricing" className="btn btn--primary">Выбрать тариф</Link>
                  <a href="#how" className="btn btn--ghost">Как это работает</a>
                </div>
                <a href="#pricing" className="price-claim price-claim--hero">
                  <span><b>{PRICE_CLAIM}</b> — от 99 ₽ в неделю<sup>*</sup></span>
                </a>
              </div>
            </div>
          </div>
          <HeroLaptopReveal />
          {/* Блок «Статистика Откликс в этом году» (HeroStats) снят 28.09.2026: цифры в нём
              были не настоящими, а недостоверные цифры в рекламе — нарушение закона о
              рекламе. Реальные считаются в админке («Рост» → «Статистика сервиса»).
              Вернуть, когда станут убедительными: <HeroStats /> сюда, после зоны макбука
              (уезжает по её :hover через соседний селектор), и подставить в него
              реальные значения вместо зашитых. */}
        </section>

        {/* HOW IT WORKS — та же вёрстка и анимации, что у hero-visual в hero (фото
            бьётся о край экрана, на hover едет на 5px, приоткрывая лазурную полосу
            у самого края, плюс тёмная растяжка и подпись снизу) — только зеркально:
            там фото слева и едет вправо, здесь фото справа и едет влево. */}
        <section id="how" className="section section--subtle">
          <div className="how-row">
            <div className="how-copy-wrap">
              <div className="how-copy">
                <span className="eyebrow">Как это работает</span>
                <h2 style={{ marginTop: 16, marginBottom: 44 }}>
                  Три шага — дальше сервис работает сам
                </h2>
                <div className="steps-list">
                  <div className="step reveal">
                    <div className="step-num" aria-hidden="true" />
                    <div>
                      <h3 style={{ fontSize: '1.05rem' }}>Зарегистрируйтесь и скачайте лаунчер</h3>
                      <p className="muted" style={{ marginTop: 8 }}>
                        Создайте аккаунт на сайте и скачайте лаунчер — установка в одну кнопку, без
                        терминала. При первом запуске единожды войдите в свой hh.ru через лаунчер
                        — дальше сервис работает сам. Без оплаты доступно 10 бесплатных
                        откликов в день — этого достаточно, чтобы оценить качество сопроводительных
                        писем на практике.
                      </p>
                    </div>
                  </div>
                  <div className="step reveal">
                    <div className="step-num" aria-hidden="true" />
                    <div>
                      <h3 style={{ fontSize: '1.05rem' }}>Укажите ссылку на ваше резюме на hh.ru</h3>
                      <p className="muted" style={{ marginTop: 8 }}>
                        Просто укажите URL-ссылку на ваше резюме — мы не храним копию, а читаем
                        актуальное содержание перед каждым действием. С этого момента AI начинает
                        работу сразу же: подбирает подходящие вакансии, пишет уникальные
                        сопроводительные письма, отвечает на вопросы работодателей в чате и
                        заполняет анкеты с опросами.
                      </p>
                    </div>
                  </div>
                  <div className="step reveal">
                    <div className="step-num" aria-hidden="true" />
                    <div>
                      <h3 style={{ fontSize: '1.05rem' }}>Получайте приглашения</h3>
                      <p className="muted" style={{ marginTop: 8 }}>
                        Вы полностью контролируете Откликс — на сайте или внутри лаунчера видите
                        все совершаемые действия. Если вопрос требует именно вашего решения, сервис
                        не отвечает сам, отправляет вам уведомление и ожидает вашего решения.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="how-visual">
              <img
                className="how-visual__photo"
                src="/images/otkliks-kak-eto-rabotaet.webp"
                alt="AI-автопилот Откликс работает самостоятельно, пока вы занимаетесь своими делами"
                width={1248}
                height={832}
                loading="lazy"
              />
              <div className="how-visual__scrim" aria-hidden="true" />
              <p className="how-visual__caption" aria-hidden="true">
                Сэкономьте нервы и сотни часов поиска оффера.
              </p>
            </div>
          </div>
        </section>

        {/* CALCULATOR */}
        <section id="calc" className="section section--subtle">
          <div className="container">
            <span className="eyebrow">Прочувствуйте результат</span>
            <h2 style={{ marginTop: 16, marginBottom: 12 }}>
              Подвиньте ползунок — увидьте изменения
            </h2>
            <p className="lead" style={{ marginBottom: 44 }}>
              Это не гипотетический прогноз, а средние показатели живого использования Откликс.
              Видно, как метрики меняются день за днём: приглашений становится больше, а быстрых
              отказов — меньше.
            </p>
            <div className="card calc-card reveal">
              <ResponseCalculator />
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="section">
          <div className="container">
            <div className="pricing-layout">
              {/* Тот же реальный чат hh.ru, что раньше плавал поверх фото в hero —
                  здесь ему намного просторнее, а тарифам по соседству нужен живой пример
                  переписки, которую они и оплачивают. Отдельная колонка грида — специально
                  ВНЕ .pricing-content: телефон не участвует в центрировании остального
                  блока, просто стоит слева от него. */}
              <div className="pricing-phone reveal">
                <PricingPhoneReveal />
              </div>
              <div className="pricing-content">
                <span className="eyebrow">Тарифы</span>
                {/* Две строки заданы явно: при обычном переносе вторая строка получалась
                    из двух слов («полный автопилот»), и заголовок выглядел оборванным.
                    Блочные span, а не <br>: внутри каждой части перенос по-прежнему
                    свободный, поэтому на узком экране ничего не ломается. */}
                <h2 style={{ marginTop: 16, marginBottom: 44, maxWidth: 760 }}>
                  <span style={{ display: 'block' }}>Полный автопилот — бесплатно.</span>
                  <span style={{ display: 'block' }}>Платите только за приоритет</span>
                </h2>
                {/* Цены здесь должны совпадать с /pricing — это одна и та же подписка,
                    просто короткой карточкой. Меняем в одном месте — правим и во втором. */}
                <div className="grid grid--3 pricing-cards">
                  <div className="card pricing-card reveal">
                    <span className="tag">Бесплатно</span>
                    <h3 className="pricing-card__name">Бесплатный тариф</h3>
                    <div className="pricing-price">
                      <span className="pricing-price__value">0 ₽</span>
                      <span className="pricing-price__period">навсегда</span>
                    </div>
                    <p className="pricing-price__alt">Без карты и без даты окончания</p>
                    <p className="muted pricing-card__desc">
                      Полный автопилот без оплаты: письмо под каждую вакансию, переписка с
                      работодателями и анкеты — до 100 откликов в день. Взамен — четыре
                      простых задания в первые дни.
                    </p>
                    <ul className="pricing-check-list">
                      <li><i>✓</i> 100 откликов в день с письмом под каждую вакансию</li>
                      <li><i>✓</i> Переписка с работодателями в чате</li>
                      <li><i>✓</i> Заполнение анкет и опросов</li>
                      <li><i>✓</i> 4 задания в первые дни: подписки и отзыв</li>
                    </ul>
                    <div className="pricing-card-cta">
                      <Link href="/app/register" className="btn btn--ghost" style={{ width: '100%' }}>
                        Начать бесплатно
                      </Link>
                    </div>
                  </div>
                  <div className="card pricing-card pricing-card--featured reveal">
                    <span className="pricing-card__ribbon">Приоритет</span>
                    <span className="tag">Приватный</span>
                    <h3 className="pricing-card__name">Локальный агент</h3>
                    <a href="#price-note" className="price-claim"><span>{PRICE_CLAIM}<sup>*</sup></span></a>
                    <div className="pricing-price">
                      <span className="pricing-price__value">199 ₽</span>
                      <span className="pricing-price__period">в месяц</span>
                    </div>
                    <p className="pricing-price__alt">Или 99 ₽ за неделю</p>
                    <p className="muted pricing-card__desc">
                      Всё из бесплатного — плюс приоритет: в часы пик ваши отклики и ответы
                      работодателям обрабатываются первыми. И никаких заданий.
                    </p>
                    <ul className="pricing-check-list">
                      <li><i>✓</i> До 200 откликов в день</li>
                      <li><i>✓</i> Приоритетная обработка</li>
                      <li><i>✓</i> Без заданий</li>
                      <li><i>✓</i> Сессия hh.ru не покидает ваш компьютер</li>
                    </ul>
                    <div className="pricing-card-cta">
                      <Link href="/pricing#local" className="btn btn--ghost" style={{ width: '100%' }}>
                        Подробнее о тарифе
                      </Link>
                    </div>
                  </div>
                  <div className="card pricing-card pricing-card--locked reveal">
                    <input type="checkbox" id="cloud-reveal" className="pricing-lock-toggle" />
                    <CloudRevealTracker />
                    <label htmlFor="cloud-reveal" className="pricing-lock-overlay">
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                      <strong>Облачный тариф в разработке</strong>
                      <span>Нажмите, чтобы посмотреть описание</span>
                    </label>
                    <div className="pricing-lock-body">
                      <span className="tag tag--accent">24/7 · скоро</span>
                      <h3 className="pricing-card__name">Облачный тариф</h3>
                      <div className="pricing-price">
                        <span className="pricing-price__value pricing-price__value--soon pricing-price__value--note">Цену объявим позже</span>
                      </div>
                      <p className="muted pricing-card__desc">
                        Работает на наших серверах круглосуточно — даже если ваш компьютер
                        выключен. Сессия hh.ru при этом хранится и работает у нас.
                      </p>
                      <ul className="pricing-check-list">
                        <li><i>✓</i> Круглосуточно</li>
                        <li><i>✓</i> Не нужно держать компьютер включённым</li>
                        <li><i>✓</i> Более частые проверки новых вакансий</li>
                        <li><i>✓</i> Отдельный выделенный IP на аккаунт</li>
                        <li className="is-excluded"><i>—</i> Сессия hh.ru хранится у нас</li>
                      </ul>
                      <div className="pricing-card-cta">
                        <CloudWaitlist source="landing" />
                        <Link href="/pricing#cloud" className="cloud-waitlist__more">Подробнее о тарифе</Link>
                      </div>
                    </div>
                  </div>
                </div>
                <p id="price-note" className="price-claim-note">* {PRICE_CLAIM_NOTE}</p>
              </div>
            </div>
          </div>
        </section>

        {/* FORMS — автозаполнение анкет, ключевое отличие от большинства конкурентов:
            те останавливаются на письме в чате, мы проходим форму работодателя целиком. */}
        <section id="forms" className="section">
          <div className="container">
            <div className="grid grid--2" style={{ alignItems: 'center' }}>
              <div className="reveal">
                <span className="eyebrow">Не только ответы в чате hh</span>
                <h2 style={{ marginTop: 16 }}>
                  <span style={{ display: 'block' }}>Работодатель прислал анкету —</span>
                  {/* Ключевое слово отдельной строкой и крупнее: именно оно отличает
                      сервис от конкурентов, которые на анкете и останавливаются.
                      Подчёркивание дорисовывается, когда блок доезжает до экрана
                      (ScrollReveal вешает .in на родителя). */}
                  <span className="fill-word">заполняем</span>
                </h2>
                <p className="muted" style={{ marginTop: 16 }}>
                  Другие сервисы автоотклика останавливаются на сопроводительном письме, как
                  только работодатель просит перейти по ссылке и заполнить анкету (Google-форму,
                  Яндекс.Форму или опрос на своём сайте) — Откликс справляется самостоятельно,
                  используя предоставленные вами в резюме данные.
                </p>
                <FormSources />
              </div>
              <FormsTabletReveal />
            </div>
          </div>
        </section>

        <SecuritySection />

        {/* BLOG TEASER — живые ссылки на статьи блога прямо с лендинга: до этого
            единственная страница сайта с реальной посещаемостью никак не ссылалась
            на статьи, только через шапку/подвал. */}
        {latestPosts.length > 0 && (
          <section className="section section--subtle">
            <div className="container">
              <span className="eyebrow">Из блога</span>
              <h2 style={{ marginTop: 16, marginBottom: 32, maxWidth: 640 }}>
                Разборы поиска работы и найма
              </h2>
              <div className="grid grid--3">
                {latestPosts.map((post) => (
                  <Link key={post.slug} href={`/blog/${post.slug}`} className="card blog-teaser-card reveal" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <span className="tag tag--accent">{post.tag}</span>
                    <h3 style={{ fontSize: '1.05rem', marginTop: 12 }}>{post.title}</h3>
                    <p className="muted" style={{ marginTop: 8, fontSize: '0.9rem' }}>{post.description}</p>
                  </Link>
                ))}
              </div>
              <Link href="/blog" className="btn btn--ghost" style={{ marginTop: 28 }}>Все статьи →</Link>
            </div>
          </section>
        )}

        <Testimonials />

        {/* FAQ */}
        <section id="faq" className="section">
          <div className="container">
            <span className="eyebrow">Вопросы</span>
            {/* maxWidth убран намеренно: при 640px заголовок ломался на две строки,
                хотя фраза короткая и в одну помещается. nowrap не ставим — на узком
                экране перенос всё-таки нужен. */}
            <h2 style={{ marginTop: 16, marginBottom: 40 }}>
              Отвечаем прямо, без юридической воды
            </h2>
            <div style={{ display: 'grid', gap: 20, maxWidth: 760 }}>
              {faq.map((item) => (
                <div key={item.q} className="card reveal">
                  <h3 style={{ fontSize: '1.05rem' }}>{item.q}</h3>
                  <p className="muted" style={{ marginTop: 10 }}>{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA — текст по центру экрана, как и был; фотография стоит отдельным слоем
            у правого края секции и может слегка уходить под заголовок. */}
        <section className="section section--subtle cta-final">
          <div className="container reveal cta-final__copy">
            <h2>Хватит откликаться вручную по вечерам</h2>
            <p className="lead" style={{ margin: '16px auto 0' }}>
              Подключите резюме — дальше Откликс будет работать за вас.
            </p>
            <Link href="#pricing" className="btn btn--primary" style={{ marginTop: 28 }}>
              Выбрать тариф
            </Link>
          </div>

          <div className="cta-final__art reveal">
            <span className="cta-final__glow" aria-hidden="true" />
            <img
              className="cta-final__photo"
              src="/images/otkliks-soiskatel-nashel-rabotu.webp"
              alt="Улыбающийся соискатель, за которого откликается Откликс"
              width={1064}
              height={1400}
              loading="lazy"
            />
            {/* Подписи лежат на фотографии ниже лица и ниже кнопки — так они не
                наезжают ни на центрированный текст, ни на самого человека. Формулировки
                намеренно без «все» и «любые»: на вопросы про время созвона автопилот
                отвечает не сам, а форму с файлом или капчей передаёт пользователю. */}
            <span className="cta-final__chip cta-final__chip--1">До 200 откликов в день</span>
            <span className="cta-final__chip cta-final__chip--2">Ответы на сообщения эйчаров в чате</span>
            <span className="cta-final__chip cta-final__chip--3">Письмо под каждую вакансию</span>
            <span className="cta-final__chip cta-final__chip--4">Заполнение форм и опросов по ссылкам</span>
          </div>
        </section>

      </main>
    </>
  );
}
