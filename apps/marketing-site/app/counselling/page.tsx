// Страница поддержки: единственная страница сайта, где речь не про автоматизацию,
// поэтому и тон другой — спокойный, без «продающих» обещаний. Ни одно утверждение
// здесь не выходит за то, что известно про услугу: заявка доходит до Марии, она
// отвечает лично, остальное (формат, условия) обсуждается уже с ней. Ничего про
// «гарантированный результат», сроки и цены на странице нет и быть не должно.
//
// Фото: положить файл в public/images/counselling (maria.jpg|webp|png) — и вместо
// монограммы появится фотография, см. photoOf ниже.

import fs from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import { SITE_URL, SITE_NAME, buildBreadcrumbJsonLd } from '@/lib/site';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { coreApiFetch } from '@/lib/coreApi';
import { isSyntheticOAuthEmail } from '@/lib/tenantDisplay';
import { RequestForm } from './RequestForm';

const TITLE = 'Не получается найти работу? Поддержка психолога при долгом поиске работы';
// Короткое имя страницы — для хлебных крошек, там длинный заголовок не нужен.
const CRUMB = 'Поддержка во время поиска работы';
const DESCRIPTION =
  'Долгий поиск работы, отказы и тишина после откликов выматывают. Мария — врач-психотерапевт и консультирующий психолог — помогает справиться с тревогой, выгоранием и обесцениванием себя. Напишите в Telegram или оставьте заявку.';
const PATH = '/counselling';
const TELEGRAM_URL = 'https://t.me/laskinrow';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}${PATH}` },
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    siteName: SITE_NAME,
    url: `${SITE_URL}${PATH}`,
    title: `${TITLE} — Откликс`,
    description: DESCRIPTION,
  },
};

const breadcrumbJsonLd = buildBreadcrumbJsonLd([
  { name: 'Главная', path: '/' },
  { name: CRUMB, path: PATH },
]);

const PHOTO_DIR = path.join(process.cwd(), 'public', 'images', 'counselling');

function photoOf(name: string): string | null {
  for (const ext of ['webp', 'jpg', 'jpeg', 'png']) {
    try {
      if (fs.existsSync(path.join(PHOTO_DIR, `${name}.${ext}`))) return `/images/counselling/${name}.${ext}`;
    } catch { /* папки нет — значит, фото просто ещё не добавили */ }
  }
  return null;
}

const glyph = (d: string) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d={d} />
  </svg>
);

// Признаки сформулированы как узнаваемые ситуации, а не как диагнозы: это страница
// про «поговорить», а не про постановку диагноза по чек-листу.
const SIGNALS = [
  {
    id: 'self',
    title: 'Отказы бьют по самооценке',
    text: 'После очередного «нет» мысль «дело во мне» звучит громче, чем факты о рынке и конкурсе на место.',
    icon: glyph('M12 21s-7.5-4.6-9.3-9.1C1.3 8.2 3.4 5 6.7 5c2 0 3.4 1.1 4.3 2.3l1 1.3 1-1.3C13.9 6.1 15.3 5 17.3 5c3.3 0 5.4 3.2 4 6.9C19.5 16.4 12 21 12 21z'),
  },
  {
    id: 'delay',
    title: 'Откликаться тяжелее, чем кажется',
    text: 'Открыть сайт вакансий становится сложнее, чем сделать сам отклик, и день снова уходит впустую.',
    icon: glyph('M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 10.6l3.5 2.1-.8 1.3L11 13V6.5h2z'),
  },
  {
    id: 'energy',
    title: 'Поиск съедает сон и силы',
    text: 'Месяцы ожидания ответа выматывают не меньше самой работы, а восстановиться между ними негде.',
    icon: glyph('M9.4 2.2a8 8 0 0 0 10.4 10.4 8.5 8.5 0 1 1-10.4-10.4z'),
  },
  {
    id: 'alone',
    title: 'Кажется, что просить помощи — слабость',
    text: 'Хотя разговор со специалистом — такой же рабочий инструмент, как резюме или сопроводительное письмо.',
    icon: glyph('M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.7 0-8 1.3-8 4v3h9.5v-2.2c0-1.1.5-2.2 1.4-3.1A14 14 0 0 0 8 13zm8 0c-.6 0-1.3.1-2 .2 1.4.9 2 2 2 3.1V19h8v-3c0-2.7-5.3-3-8-3z'),
  },
];

const STEPS = [
  {
    id: 'write',
    title: 'Пишете первым — как удобнее',
    text: 'В Telegram напрямую или через форму ниже. Двух-трёх фраз о ситуации достаточно, подбирать «правильные» слова не нужно.',
  },
  {
    id: 'answer',
    title: 'Мария отвечает лично',
    text: 'Не бот и не оператор поддержки: заявку читает сама Мария и пишет вам на тот контакт, который вы оставили.',
  },
  {
    id: 'talk',
    title: 'Дальше — как договоритесь',
    text: 'Формат и условия вы обсуждаете напрямую с Марией. Откликс здесь только знакомит вас и ничего не решает за вас.',
  },
];

export default async function CounsellingPage() {
  const session = await getCustomerSession();
  let defaultName = '';
  let defaultContact = '';
  if (session) {
    // При входе через VK email часто отсутствует — вместо него в аккаунте лежит
    // техническая заглушка вида vk_123456789@oauth.otkliks.local. Подставлять
    // её в контакт для Марии бессмысленно: писать по такому адресу нельзя,
    // человек это не заметит и заявка потеряется. Лучше пустое поле, которое
    // видно, что надо заполнить, чем нерабочий адрес, который выглядит заполненным.
    if (!isSyntheticOAuthEmail(session.email)) defaultContact = session.email;
    try {
      const { tenant } = await coreApiFetch<{ tenant: { fullName?: string } }>('/api/auth/me', {
        token: session.coreApiToken,
      });
      defaultName = tenant.fullName || '';
    } catch {
      // core-api недоступен — просто не подставляем имя, форма остаётся рабочей
    }
  }

  const photo = photoOf('maria');

  return (
    <main>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <section className="section counselling-hero">
        <div className="container cn-hero">
          <div className="cn-hero__copy reveal">
            <span className="eyebrow">Не только автопилот</span>
            <h1 className="cn-hero__title">
              Поиск работы иногда давит сильнее, чем кажется со стороны
            </h1>
            <p className="lead cn-hero__lead">
              Отказы подряд, тишина после откликов, ощущение, что что-то не так именно с вами —
              это частая и понятная реакция на долгий безрезультатный поиск, а не признак слабости.
              Иногда лучший следующий шаг — не ещё один отклик, а разговор со специалистом.
            </p>
            <div className="cn-hero__actions">
              <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="btn btn--primary">
                Написать Марии в Telegram
              </a>
              <a href="#request" className="btn btn--ghost">Оставить заявку</a>
            </div>
            <p className="cn-hero__note">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5zm-1.2 13.4l6-6-1.4-1.4-4.6 4.6-2.2-2.2-1.4 1.4z" fill="currentColor" />
              </svg>
              Заявку видит только Мария
            </p>
          </div>

          {/* Декоративная сцена: мысли, знакомые почти каждому в затянувшемся поиске,
              кружат вокруг спокойного центра — «есть с кем поговорить». */}
          <div className="cn-hero__art reveal" aria-hidden="true">
            <span className="cn-aura" />
            <span className="cn-orbit cn-orbit--1" />
            <span className="cn-orbit cn-orbit--2" />
            <span className="cn-core">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3c5 0 9 3.4 9 7.6 0 4.2-4 7.6-9 7.6a10.7 10.7 0 0 1-2.6-.3L4 20.5l1.2-3.4C3.2 15.7 3 13.3 3 10.6 3 6.4 7 3 12 3z" fill="currentColor" />
              </svg>
            </span>
            <span className="cn-thought cn-thought--a">«Уже третий месяц»</span>
            <span className="cn-thought cn-thought--b">«Снова тишина в ответ»</span>
            <span className="cn-thought cn-thought--c">«Может, дело во мне»</span>
          </div>
        </div>
      </section>

      <section className="section section--subtle">
        <div className="container">
          <span className="eyebrow reveal">Знакомо?</span>
          <h2 className="cn-h2 reveal">Когда разговор помогает больше, чем ещё сто откликов</h2>
          <div className="grid grid--2 cn-signals">
            {SIGNALS.map((s) => (
              <article className="card cn-signal reveal" key={s.id}>
                <span className="cn-signal__ico" aria-hidden="true">{s.icon}</span>
                <h3 className="cn-signal__title">{s.title}</h3>
                <p className="muted cn-signal__text">{s.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="card cn-profile reveal">
            <div className="cn-profile__side">
              <span className="cn-profile__avatar">
                {photo
                  ? <img src={photo} alt="Мария, врач-психотерапевт" width={128} height={128} />
                  : <span aria-hidden="true">М</span>}
              </span>
              <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="btn btn--primary cn-profile__btn">
                Написать в Telegram
              </a>
            </div>

            <div className="cn-profile__body">
              <span className="eyebrow">С вами работает</span>
              <h2 className="cn-profile__name">Мария</h2>
              <ul className="cn-creds">
                <li>Психиатр</li>
                <li>Врач-психотерапевт</li>
                <li>Консультирующий психолог</li>
              </ul>
              <p className="cn-profile__text">
                Мария работает с тревогой, выгоранием и обесцениванием себя — в том числе с тем,
                что накапливается за месяцы поиска работы: с усталостью от постоянного ожидания
                ответа, с внутренним голосом, который после каждого отказа говорит «дело в тебе».
                Она помогает распознать эти мыслительные ловушки и найти опору, пока поиск
                продолжается.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--subtle">
        <div className="container">
          <span className="eyebrow reveal">Как это устроено</span>
          <h2 className="cn-h2 reveal">Три шага, и ни одного лишнего</h2>
          <div className="steps-list cn-steps">
            {STEPS.map((s) => (
              <div className="step reveal" key={s.id}>
                <span className="step-num" aria-hidden="true" />
                <div>
                  <h3 style={{ fontSize: '1.15rem' }}>{s.title}</h3>
                  <p className="muted" style={{ marginTop: 8 }}>{s.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="request">
        <div className="container cn-request">
          <div className="cn-request__copy reveal">
            <span className="eyebrow">Или оставьте заявку</span>
            <h2 className="cn-h2" style={{ marginTop: 16 }}>Мария свяжется с вами сама</h2>
            <p className="muted" style={{ marginTop: 14 }}>
              Оставьте контакт и пару слов о ситуации — этого достаточно, чтобы начать разговор.
            </p>
            <ul className="cn-request__list">
              <li>Заявку видит только Мария</li>
              <li>Ответ придёт на тот контакт, который вы указали</li>
              <li>Писать красиво и подробно не нужно — можно в двух словах</li>
            </ul>
            <p className="cn-emergency">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2l10 18H2zm0 6.5a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1zm0 8a1.2 1.2 0 1 0 1.2 1.2 1.2 1.2 0 0 0-1.2-1.2z" fill="currentColor" />
              </svg>
              <span>
                Если ситуация острая и небезопасная прямо сейчас — пожалуйста, обратитесь
                к экстренным службам или очно к психиатру, не дожидаясь ответа через форму.
              </span>
            </p>
          </div>

          <div className="card cn-request__card reveal">
            <RequestForm defaultName={defaultName} defaultContact={defaultContact} />
          </div>
        </div>
      </section>
    </main>
  );
}
