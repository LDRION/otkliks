import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { SiteNav } from './components/SiteNav';
import { SiteFooter } from './components/SiteFooter';
import { ConsultantWidget } from './components/ConsultantWidget';
import { SmoothScroll } from './components/SmoothScroll';
import { ScrollReveal } from './components/ScrollReveal';
import { PageFadeIn } from './components/PageFadeIn';
import { TabTitle } from './components/TabTitle';
import { AmbientFlow } from './components/AmbientFlow';
import { ImageGuard } from './components/ImageGuard';
import { Analytics } from './components/Analytics';
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, HOME_TITLE, HOME_DESCRIPTION, SOCIAL_TITLE } from '@/lib/site';
import { CUSTOMER_SESSION_COOKIE, verifyCustomerSession } from '@/lib/customer-session';

// Залогинен ли клиент — чтобы публичная шапка показывала «Личный кабинет», а не
// «Войти». Безопасно проглатываем ошибки: любая заминка = просто гость.
async function isCustomerAuthed(): Promise<boolean> {
  try {
    const token = (await cookies()).get(CUSTOMER_SESSION_COOKIE)?.value;
    return token ? !!(await verifyCustomerSession(token)) : false;
  } catch {
    return false;
  }
}

const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-manrope',
  display: 'swap',
});

export const viewport: Viewport = {
  themeColor: '#212d4e',
};

// Подтверждение прав на сайт в Яндекс Вебмастере, Bing Webmaster и Google Search
// Console — коды приходят из .env.local, пустые не выводятся. Это важно не только
// для поиска: Алиса/Нейро отвечают по индексу Яндекса, ChatGPT ищет через Bing,
// Gemini — через Google.
const VERIFY = {
  yandex: process.env.YANDEX_VERIFICATION,
  google: process.env.GOOGLE_SITE_VERIFICATION,
  bing: process.env.BING_SITE_VERIFICATION,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  verification: {
    ...(VERIFY.yandex ? { yandex: VERIFY.yandex } : {}),
    ...(VERIFY.google ? { google: VERIFY.google } : {}),
    ...(VERIFY.bing ? { other: { 'msvalidate.01': VERIFY.bing } } : {}),
  },
  title: {
    default: HOME_TITLE,
    template: `%s — ${SITE_NAME}`,
  },
  description: HOME_DESCRIPTION,
  keywords: [
    'автоотклик hh.ru',
    'автоматизация отклика на вакансии',
    'AI сопроводительное письмо',
    'бот для hh.ru',
    'поиск работы автоматизация',
    'как найти работу',
    'не могу найти работу',
    'поиск работы',
    'отклик на вакансию hh.ru',
    'что делать если не могу найти работу',
    'как быстро найти работу',
    'не получается найти работу',
    'автоотклик на вакансии',
    'автоматический отклик hh',
    'сопроводительное письмо нейросеть',
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SOCIAL_TITLE,
    description: HOME_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: SOCIAL_TITLE,
    description: HOME_DESCRIPTION,
  },
  alternates: { canonical: SITE_URL },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
};

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: SITE_NAME,
  alternateName: 'Otkliks',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Windows',
  description: SITE_DESCRIPTION,
  image: `${SITE_URL}/opengraph-image`,
  offers: {
    '@type': 'AggregateOffer',
    priceCurrency: 'RUB',
    lowPrice: '0',
    highPrice: '199',
    offerCount: '2',
  },
  url: SITE_URL,
};

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  url: SITE_URL,
  inLanguage: 'ru-RU',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const authed = await isCustomerAuthed();
  return (
    <html lang="ru" className={manrope.variable}>
      <body>
        {/* Синхронный инлайн-скрипт, а не useEffect — должен отработать ДО того, как
            браузер отрисует .reveal-элементы и саму <body> ниже по странице.
            classList.add, а не className='js' — иначе стёрли бы класс шрифта Manrope,
            который React уже поставил на <html>. Без JS (или пока скрипт не
            выполнился) класса js нет — и по правилам «.js .reveal» / «.js body»
            контент остаётся обычным, видимым сразу (а не скрытым навсегда). */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }}
        />
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <PageFadeIn />
        <TabTitle />
        <ImageGuard />
        {/* Счётчики: идентификаторы читаются из окружения при каждом запросе — их
            можно подключить или сменить без пересборки. Пустые — не грузится ничего. */}
        <Analytics ymId={process.env.YANDEX_METRIKA_ID} gaId={process.env.GA_MEASUREMENT_ID} />
        <AmbientFlow />
        <SmoothScroll />
        <ScrollReveal />
        <SiteNav authed={authed} />
        {children}
        <SiteFooter />
        <ConsultantWidget />
      </body>
    </html>
  );
}
