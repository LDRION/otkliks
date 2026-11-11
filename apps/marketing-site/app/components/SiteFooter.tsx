'use client';

// Подвал сайта. Раньше это были две «кучки» — логотип с подписью слева и ряд из семи
// разнородных ссылок справа: продуктовые, юридические и скачивание были свалены в один
// список без всякой логики. Теперь колонки по смыслу (продукт / материалы / контакты),
// живые адреса почты и отдельная нижняя строка с копирайтом и правовыми документами.
//
// Публикуем только те ящики, которые реально читает человек: support@ и partners@.
// noreply@ сознательно не указан — он только для отправки системных писем, входящие
// туда никто не разбирает, и печатать его как контакт значит обещать ответ, которого
// не будет.

import Link from 'next/link';
import { SOCIALS } from '@/lib/socials';
import { SocialLinks } from './SocialLinks';
import { usePathname } from 'next/navigation';
import { DownloadLink } from './DownloadLink';
import { LogoMark } from './Logo';
import { SITE_URL, SITE_NAME } from '@/lib/site';

const YEAR_FROM = 2026;

// Соцсети. Список один — из него же и подвал, и разметка sameAs для поисковиков:
// так Яндекс и Google связывают сайт с официальными аккаунтами бренда.
// Список соцсетей — lib/socials.ts (общий с шапкой).

// Организация с контактными точками — этим поисковик связывает сайт, бренд и адреса
// поддержки. Указаны только существующие ящики.
const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE_NAME,
  alternateName: 'Otkliks',
  url: SITE_URL,
  logo: `${SITE_URL}/icon`,
  email: 'support@otkliks.ru',
  sameAs: SOCIALS.map((x) => x.href),
  contactPoint: [
    {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'support@otkliks.ru',
      availableLanguage: ['Russian'],
      areaServed: 'RU',
    },
    {
      '@type': 'ContactPoint',
      contactType: 'sales',
      email: 'partners@otkliks.ru',
      availableLanguage: ['Russian'],
      areaServed: 'RU',
    },
  ],
};

export function SiteFooter() {
  const pathname = usePathname();
  if (pathname?.startsWith('/admin') || pathname?.startsWith('/app')) return null;

  const year = new Date().getFullYear();
  const years = year > YEAR_FROM ? `${YEAR_FROM}—${year}` : `${year}`;

  return (
    <footer className="site-footer">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />

      <div className="container">
        <div className="footer-top">
          <div className="footer-brand">
            <Link href="/" className="logo footer-logo" aria-label="Откликс — на главную">
              <LogoMark size={38} />
            </Link>
            <p className="footer-tagline">
              AI-автопилот поиска работы: сам находит подходящие вакансии на hh.ru, пишет
              сопроводительное письмо под каждую и ведёт переписку с работодателями.
            </p>
            <DownloadLink className="btn btn--ghost btn--sm footer-download">
              Скачать лаунчер
            </DownloadLink>
            <SocialLinks className="footer-socials" />
          </div>

          <nav className="footer-col" aria-labelledby="footer-product">
            <h2 className="footer-col__title" id="footer-product">Продукт</h2>
            <ul>
              <li><Link href="/#how">Как это работает</Link></li>
              <li><Link href="/#forms">Заполнение анкет</Link></li>
              <li><Link href="/#calc">Калькулятор откликов</Link></li>
              <li><Link href="/#security">Безопасность</Link></li>
              <li><Link href="/pricing">Тарифы и цены</Link></li>
            </ul>
          </nav>

          <nav className="footer-col" aria-labelledby="footer-learn">
            <h2 className="footer-col__title" id="footer-learn">Полезное</h2>
            <ul>
              <li><Link href="/blog">Блог о поиске работы</Link></li>
              <li><Link href="/#faq">Частые вопросы</Link></li>
              <li><Link href="/#reviews">Отзывы соискателей</Link></li>
              <li><Link href="/counselling">Поддержка психолога</Link></li>
              <li><Link href="/partners">Партнёрская программа</Link></li>
            </ul>
          </nav>

          <div className="footer-col footer-col--contacts" aria-labelledby="footer-contacts">
            <h2 className="footer-col__title" id="footer-contacts">Контакты</h2>
            <ul>
              <li>
                <a href="mailto:support@otkliks.ru">support@otkliks.ru</a>
                <span className="footer-note">вопросы по сервису и оплате</span>
              </li>
              <li>
                <a href="mailto:partners@otkliks.ru">partners@otkliks.ru</a>
                <span className="footer-note">сотрудничество и реклама</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <p className="footer-copy">© {years} {SITE_NAME}. Все права защищены.</p>
          <nav className="footer-legal" aria-label="Правовые документы">
            <Link href="/oferta">Публичная оферта</Link>
            <Link href="/privacy">Политика конфиденциальности</Link>
            <Link href="/consent">Согласие на обработку данных</Link>
          </nav>
        </div>

        <p className="footer-disclaimer">
          Откликс — независимый сервис. Не является продуктом, партнёром или официальным
          представителем hh.ru; названия и товарные знаки принадлежат их правообладателям.
        </p>
      </div>
    </footer>
  );
}
