'use client';

import { useEffect, useRef } from 'react';
import Script from 'next/script';

// Плавный инерционный скролл — та же фишка (библиотека Lenis), что и на
// telegrambot.online (apps/telegrambot/assets/lenis.min.js + init в site.js),
// перенесённая сюда как есть, тем же вендорным файлом (public/lenis.min.js).
// Ставим один раз в корневом layout — App Router не размонтирует layout между
// страницами, поэтому один и тот же экземпляр «плывёт» на всех страницах сайта,
// включая кабинет и админку.
//
// Условия запуска — те же, что и у оригинала:
//  - reduced-motion — колесо остаётся нативным, ничего не переопределяем;
//  - только точный указатель с ховером (мышь/трекпад на десктопе, min-width 900px) —
//    на телефоне/планшете нативный тач-скролл и так плавный, а Lenis поверх тача
//    только конфликтует с pull-to-refresh и другими системными жестами.
interface LenisInstance {
  raf: (time: number) => void;
  destroy: () => void;
  stop: () => void;
  start: () => void;
  scrollTo: (target: number | string | HTMLElement, options?: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    Lenis?: new (options?: Record<string, unknown>) => LenisInstance;
    // Ссылка на живой экземпляр — чтобы другие компоненты (например, полноэкранный
    // наезд камеры в HeroLaptopReveal) могли поставить Lenis на паузу на время
    // своего оверлея: preventDefault() на wheel останавливает только нативный
    // скролл браузера, а Lenis перехватывает те же события и крутит страницу
    // сам — его нужно явно попросить остановиться через .stop().
    __lenis?: LenisInstance;
  }
}

export function SmoothScroll() {
  const cleanupRef = useRef<(() => void) | null>(null);

  // Размонтируется только при закрытии вкладки/полной перезагрузке — но на всякий
  // случай останавливаем rAF-цикл и сам Lenis, а не оставляем его висеть.
  useEffect(() => () => cleanupRef.current?.(), []);

  return (
    <Script
      src="/lenis.min.js"
      strategy="afterInteractive"
      onReady={() => {
        if (cleanupRef.current || !window.Lenis) return;

        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const desktopPointer = window.matchMedia(
          '(min-width: 900px) and (hover: hover) and (pointer: fine)',
        ).matches;
        if (reduceMotion || !desktopPointer) return;

        const lenis = new window.Lenis({ duration: 1.1, smoothWheel: true, touchMultiplier: 1.6 });
        window.__lenis = lenis;
        let rafId = requestAnimationFrame(function raf(time) {
          lenis.raf(time);
          rafId = requestAnimationFrame(raf);
        });

        // Якорные ссылки (навигация, «Как это работает», «Выбрать тариф») по
        // умолчанию прыгают нативно — браузер мгновенно ставит scrollTop в новое
        // значение мимо Lenis. Пока Lenis ещё «доезжает» инерцией после недавнего
        // скролла колесом (isScrolling===true), он не считает этот нативный прыжок
        // авторитетным и на следующем кадре тащит scroll обратно к своей ещё не
        // остановившейся анимации — клик визуально ничего не делает. На втором
        // клике инерция уже погасла, и нативный прыжок остаётся в силе. Чиним
        // штатно: сами перехватываем клик по якорю и просим Lenis доехать через
        // его собственный scrollTo — тогда он не спорит сам с собой.
        const onAnchorClick = (e: MouseEvent) => {
          if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          const anchor = (e.target as HTMLElement | null)?.closest('a[href]') as HTMLAnchorElement | null;
          if (!anchor) return;
          const url = new URL(anchor.href, window.location.href);
          if (url.pathname !== window.location.pathname || !url.hash) return;
          const el = document.getElementById(decodeURIComponent(url.hash.slice(1)));
          if (!el) return;
          e.preventDefault();
          lenis.scrollTo(el);
        };
        document.addEventListener('click', onAnchorClick, true);

        cleanupRef.current = () => {
          cancelAnimationFrame(rafId);
          lenis.destroy();
          window.__lenis = undefined;
          document.removeEventListener('click', onAnchorClick, true);
        };
      }}
    />
  );
}
