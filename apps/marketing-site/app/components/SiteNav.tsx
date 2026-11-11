'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SocialLinks } from './SocialLinks';
import { usePathname } from 'next/navigation';
import { Logo } from './Logo';
import { DownloadLink } from './DownloadLink';

// Порядок = порядок в шапке. `optional` уезжает первым, когда десктопной ширины
// перестаёт хватать (≤1100px); ниже 1024px строка целиком заменяется меню-панелью,
// поэтому в самой панели показываем все пункты без исключений.
const NAV_LINKS = [
  { href: '/#how', label: 'Как это работает' },
  { href: '/#forms', label: 'Анкеты', optional: true },
  { href: '/#calc', label: 'Калькулятор' },
  { href: '/#security', label: 'Безопасность', optional: true },
  { href: '/#faq', label: 'Вопросы', optional: true },
  { href: '/pricing', label: 'Тарифы' },
  { href: '/blog', label: 'Блог' },
];

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2v8m0 0 3-3m-3 3L5 7M3 12.5h10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SiteNav({ authed = false }: { authed?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Пока страница вверху, шапка сливается с фоном; стоит прокрутить — под ней
  // проявляются граница и тень, чтобы контент не «протекал» сквозь blur.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Панель закрывается при переходе, по Esc и когда экран дорос до десктопного:
  // иначе она осталась бы висеть поверх уже видимого меню.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const desktop = window.matchMedia('(min-width: 1024px)');
    const onWidth = (e: MediaQueryListEvent) => e.matches && setOpen(false);
    document.addEventListener('keydown', onKey);
    desktop.addEventListener('change', onWidth);
    return () => {
      document.removeEventListener('keydown', onKey);
      desktop.removeEventListener('change', onWidth);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (pathname?.startsWith('/admin') || pathname?.startsWith('/app')) return null;

  // Подсвечиваем только настоящие страницы: якоря ведут в секции главной и были бы
  // «активными» всё время, пока человек на ней.
  const isActive = (href: string) =>
    !href.includes('#') && (pathname === href || pathname?.startsWith(`${href}/`));

  return (
    <nav className={`topbar${scrolled ? ' is-scrolled' : ''}`}>
      {/* У самого левого края экрана, вне контейнера шапки — только там, где слева
          от логотипа есть свободное поле (≥1600px), см. .topbar-socials. */}
      <SocialLinks className="topbar-socials" />
      <div className="topbar-inner">
        <Link
          href="/"
          className="logo logo--link"
          aria-label="Откликс — наверх"
          onClick={(e) => {
            // Уже на главной — не перезагружаем маршрут, а плавно «улетаем» камерой
            // наверх (частый приём: клик по логотипу возвращает к исходному экрану).
            if (pathname === '/') {
              e.preventDefault();
              const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
              // Через сам Lenis, если он живой: нативный scrollTo он считает чужим
              // прыжком и, пока не погасла инерция прошлого скролла колесом, на
              // следующем кадре утаскивает страницу обратно — первый клик по логотипу
              // визуально не делал ничего, работал только второй. Ровно та же история,
              // что с якорями, — см. onAnchorClick в SmoothScroll.tsx.
              if (!reduce && window.__lenis) window.__lenis.scrollTo(0);
              else window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
            }
          }}
        >
          <Logo />
        </Link>

        <div className="nav-links">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={[
                'nav-link',
                link.optional ? 'nav-link--optional' : '',
                isActive(link.href) ? 'is-active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-current={isActive(link.href) ? 'page' : undefined}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="nav-actions">
          {/* Скачать можно всегда и отовсюду: раньше ссылка жила только внутри
              кабинета и пропадала, как только лаунчер считался установленным. */}
          <DownloadLink className="btn btn--ghost btn--sm nav-download">
            <DownloadIcon />
            Скачать лаунчер
          </DownloadLink>
          {/* Залогиненному клиенту — прямая ссылка в кабинет, а не «Войти / Начать»
              (иначе на публичных страницах казалось, что авторизация «спала»). */}
          {authed ? (
            <Link href="/app" className="btn btn--primary btn--sm nav-cta">Личный кабинет</Link>
          ) : (
            <>
              <Link href="/app/login" className="nav-login">Войти</Link>
              <Link href="/app/register" className="btn btn--primary btn--sm nav-cta">
                <span className="nav-cta-full">Начать бесплатно</span>
                <span className="nav-cta-short">Начать</span>
              </Link>
            </>
          )}
          <button
            type="button"
            className={`nav-burger${open ? ' is-open' : ''}`}
            aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
            aria-expanded={open}
            aria-controls="nav-panel"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="nav-burger-box" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>
      </div>

      {open && (
        <>
          <div className="nav-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="nav-panel" id="nav-panel">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`nav-panel-link${isActive(link.href) ? ' is-active' : ''}`}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <SocialLinks className="nav-panel-socials" />
            <div className="nav-panel-actions">
              <DownloadLink className="btn btn--ghost nav-panel-download">
                <DownloadIcon />
                Скачать лаунчер
              </DownloadLink>
              {authed ? (
                <Link href="/app" className="btn btn--primary" onClick={() => setOpen(false)}>Личный кабинет</Link>
              ) : (
                <Link href="/app/login" className="btn btn--ghost" onClick={() => setOpen(false)}>Войти</Link>
              )}
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
