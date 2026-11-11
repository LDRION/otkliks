'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Навигация админки с подсветкой текущего раздела (раньше её не было: layout —
// серверный компонент и не знает адреса). Подписи короткие намеренно: длинные
// («Промо-ссылки», «Заявки на консультацию») переносились на две строки и
// разваливали шапку по высоте.
type Item = { href: string; label: string; title?: string };

export function AdminNav({ isAdmin, isOwner }: { isAdmin: boolean; isOwner: boolean }) {
  const pathname = usePathname();
  const items: Item[] = [
    { href: '/admin', label: 'Дашборд' },
    { href: '/admin/blog', label: 'Блог' },
    ...(isAdmin ? [
      { href: '/admin/clients', label: 'Пользователи', title: 'Кто зарегистрировался, как и откуда' },
      { href: '/admin/growth', label: 'Рост' },
      { href: '/admin/promo', label: 'Промо', title: 'Промо-ссылки' },
      { href: '/admin/partners', label: 'Партнёры' },
      { href: '/admin/waitlist', label: 'Облако', title: 'Спрос на облачный тариф' },
      { href: '/admin/seo', label: 'SEO', title: 'Что ищут люди и какие страницы отвечают' },
      { href: '/admin/competitors', label: 'Конкуренты', title: 'Разбор конкурентов и стратегия' },
      { href: '/admin/counselling', label: 'Консультации', title: 'Заявки на консультацию психолога' },
    ] : []),
    ...(isOwner ? [{ href: '/admin/users', label: 'Админы', title: 'Администраторы' }] : []),
  ];
  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <nav className="admin-nav">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          title={it.title}
          className={isActive(it.href) ? 'is-active' : ''}
          aria-current={isActive(it.href) ? 'page' : undefined}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
