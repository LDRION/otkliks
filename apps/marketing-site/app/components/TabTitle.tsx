'use client';

// Заголовок вкладки «как у ChatGPT»: сначала браузер показывает длинный заголовок
// страницы — тот, что сервер отдаёт в <title> и что индексируют поисковики, — а через
// секунду после загрузки вкладка сворачивается до короткого бренда.
//
// Поисковым роботам подмену НЕ делаем. Google и Яндекс рендерят страницы с JS и
// берут заголовок уже из отрендеренного DOM — без этой проверки в выдачу могло бы
// попасть голое «Откликс» вместо заголовка с ключевыми словами. HTML при этом у всех
// одинаковый: меняется только подпись вкладки уже после загрузки.

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { SITE_NAME } from '@/lib/site';

const SHORT_TITLE = SITE_NAME;
const DELAY_MS = 1000;
const BOT_UA = /bot|crawl|spider|slurp|mediapartners|inspectiontool|lighthouse|headlesschrome|prerender/i;

export function TabTitle() {
  const pathname = usePathname();

  useEffect(() => {
    // В админке длинные заголовки полезнее: там несколько вкладок одновременно.
    if (pathname?.startsWith('/admin')) return undefined;
    if (navigator.webdriver || BOT_UA.test(navigator.userAgent)) return undefined;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { document.title = SHORT_TITLE; }, DELAY_MS);
    };

    // При переходе внутри сайта Next пишет заголовок новой страницы уже после смены
    // адреса (метаданные могут приехать потоком чуть позже), поэтому следим за самим
    // <title>: как только там снова длинный заголовок — через секунду сворачиваем.
    const observer = new MutationObserver(() => {
      if (document.title !== SHORT_TITLE) schedule();
    });
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });

    const start = () => { if (document.title !== SHORT_TITLE) schedule(); };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });

    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('load', start);
    };
  }, [pathname]);

  return null;
}
