import type { Metadata } from 'next';
import Link from 'next/link';
import { getCustomerSession } from '@/lib/customerAuthSession';

// Единая страница «не найдено» на весь сайт: Next отдаёт её и на любой
// несуществующий URL, и на явный notFound() (см. app/blog/[slug]/page.tsx —
// удалённая или ещё не опубликованная статья). Рендерится ВНУТРИ layout.tsx,
// так что шапка, подвал и фоновая анимация уже на месте — здесь только контент.
//
// Показывать залогиненному ссылку на регистрацию было бы той же ошибкой, что
// правили в register/page.tsx: спрашиваем сессию и меняем «Начать бесплатно»
// на прямой путь в кабинет.

export const metadata: Metadata = {
  title: 'Страница не найдена',
  description: 'Такой страницы не существует или она была перемещена — но остальной сайт Откликс работает как обычно.',
  robots: { index: false, follow: true },
};

export default async function NotFound() {
  const session = await getCustomerSession();

  return (
    <main>
      <section className="section notfound">
        <div className="container notfound-inner">
          <span className="notfound-digits" aria-hidden="true">404</span>
          <h1>Такой страницы не нашлось</h1>
          <p className="lead">
            Ссылка могла устареть или в адресе — опечатка. Сам сервис работает исправно,
            вот куда точно можно попасть:
          </p>
          <div className="notfound-actions">
            <Link href="/" className="btn btn--primary">На главную</Link>
            {session ? (
              <Link href="/app" className="btn btn--ghost">Личный кабинет</Link>
            ) : (
              <Link href="/app/register" className="btn btn--ghost">Начать бесплатно</Link>
            )}
          </div>
          <nav className="notfound-links" aria-label="Разделы сайта">
            <Link href="/pricing">Тарифы</Link>
            <Link href="/blog">Блог о поиске работы</Link>
            <Link href="/#faq">Частые вопросы</Link>
            <Link href="/counselling">Поддержка психолога</Link>
            <a href="mailto:support@otkliks.ru">Написать в поддержку</a>
          </nav>
        </div>
      </section>
    </main>
  );
}
