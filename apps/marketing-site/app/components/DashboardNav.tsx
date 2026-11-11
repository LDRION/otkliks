'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DownloadLink } from './DownloadLink';

const LINKS = [
  { href: '/app', label: 'Панель управления' },
  { href: '/app/profile', label: 'Резюме и профиль' },
  { href: '/app/devices', label: 'Устройства' },
  { href: '/app/partners', label: 'Партнёрам' },
];

export function DashboardNav() {
  const pathname = usePathname();

  // /app сам по себе — точное совпадение (иначе он подсвечивался бы активным
  // и на /app/profile, и на /app/devices, раз это тоже пути, начинающиеся с /app).
  const isActive = (href: string) =>
    href === '/app' ? pathname === '/app' : pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <nav className="admin-nav">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={isActive(link.href) ? 'is-active' : ''}
          aria-current={isActive(link.href) ? 'page' : undefined}
        >
          {link.label}
        </Link>
      ))}
      {/* Скачать доступно из кабинета всегда — независимо от того, считается
          ли лаунчер установленным: запись об устройстве в базе остаётся
          навсегда, даже если папку с программой удалили. */}
      <DownloadLink>Скачать лаунчер</DownloadLink>
      {/* Из кабинета всегда можно вернуться на публичный сайт и в блог — раньше
          залогиненный человек оказывался «заперт» в /app без единой ссылки туда. */}
      <Link href="/">На сайт</Link>
      <Link href="/blog">Блог</Link>
    </nav>
  );
}
