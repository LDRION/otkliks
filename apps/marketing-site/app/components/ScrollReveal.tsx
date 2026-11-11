'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// Плавное появление блоков при прокрутке — перенесено 1:1 с telegrambot.online
// (assets/site.js): IntersectionObserver добавляет класс .in каждому .reveal-
// элементу, как только он показался в кадре, дальше сам не следит (unobserve) —
// повторно скроллить вверх-вниз и переигрывать анимацию не нужно. Шаг задержки
// (i % 4 * 70ms) — та самая волна, а не одновременная вспышка всех карточек сразу.
export function ScrollReveal() {
  // Компонент живёт в корневом layout, который между страницами не перемонтируется
  // (App Router меняет только children) — без pathname в зависимостях эффект
  // отработал бы один раз для самой первой открытой страницы, а .reveal-блоки
  // на всех следующих так и остались бы невидимыми навсегда.
  const pathname = usePathname();

  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
    if (!els.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0, rootMargin: '0px 0px -12% 0px' },
    );

    els.forEach((el, i) => {
      el.style.transitionDelay = `${(i % 4) * 70}ms`;
      io.observe(el);
    });

    return () => io.disconnect();
    // pathname обязателен в зависимостях, а не []: компонент живёт в корневом
    // layout и между страницами не перемонтируется, поэтому без него эффект
    // отработал бы только один раз, на самом первом открытии сайта — реальный
    // репро (Playwright): полные page.goto() на каждую страницу пересоздавали
    // React-дерево заново (эффект честно перезапускался), а вот один клик по
    // логотипу — настоящий SPA-переход в том же React-дереве — эффект молчал,
    // и все .reveal на вернувшейся главной так и оставались opacity:0 навсегда
    // (once-observed IntersectionObserver уже один раз их не дождался и снят).
  }, [pathname]);

  return null;
}
