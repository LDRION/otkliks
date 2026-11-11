'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Script from 'next/script';

// Яндекс Метрика и Google Analytics 4.
//
// Идентификаторы счётчиков приходят с сервера (layout читает их из окружения при
// каждом запросе), поэтому подключить или сменить счётчик можно без пересборки.
// Пока идентификатор пуст — соответствующий скрипт не грузится вовсе.
//
// Что сознательно НЕ отслеживается:
//   — админка (/admin): там служебные данные и чужие заявки — счётчиков нет совсем;
//   — содержимое кабинета: Вебвизор записывал бы переписку с работодателями и
//     резюме. На кабинете висит класс ym-hide-content (см. layout кабинета),
//     и Вебвизор видит только каркас страницы, без текста.
// Поля ввода Вебвизор 2.0 по умолчанию не записывает (пароли — никогда).

declare global {
  interface Window {
    ym?: (id: number, method: string, ...args: unknown[]) => void;
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

type Ids = { ymId?: string; gaId?: string };
let IDS: Ids = {};

const isAdmin = (p: string | null) => !!p && p.startsWith('/admin');

export function Analytics({ ymId, gaId }: Ids) {
  const pathname = usePathname();
  const first = useRef(true);
  IDS = { ymId, gaId };

  // Переходы внутри сайта без перезагрузки — отдельный «хит» в обе системы.
  useEffect(() => {
    if (isAdmin(pathname)) return;
    if (first.current) { first.current = false; return; } // первый хит считает сам init
    const url = window.location.href;
    if (ymId && window.ym) window.ym(Number(ymId), 'hit', url, { referer: document.referrer });
    if (gaId && window.gtag) window.gtag('event', 'page_view', { page_location: url, page_title: document.title });
  }, [pathname, ymId, gaId]);

  if (isAdmin(pathname)) return null;
  const ym = ymId && /^\d{5,12}$/.test(ymId) ? ymId : null;
  const ga = gaId && /^G-[A-Z0-9]{4,16}$/.test(gaId) ? gaId : null;

  return (
    <>
      {ym && (
        <Script id="ym-init" strategy="afterInteractive">{`
          (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
          m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}
          k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
          (window,document,'script','https://mc.yandex.ru/metrika/tag.js?id=${ym}','ym');
          ym(${ym},'init',{ssr:true,webvisor:true,clickmap:true,accurateTrackBounce:true,trackLinks:true});
        `}</Script>
      )}
      {ga && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${ga}`} strategy="afterInteractive" />
          <Script id="ga-init" strategy="afterInteractive">{`
            window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;
            gtag('js',new Date());gtag('config','${ga}',{anonymize_ip:true});
          `}</Script>
        </>
      )}
    </>
  );
}

/** Цель в обе системы. Безопасно звать, даже если счётчики не подключены. */
export function reachGoal(goal: string, gaEvent?: string, params?: Record<string, unknown>) {
  try {
    if (IDS.ymId && window.ym) window.ym(Number(IDS.ymId), 'reachGoal', goal, params);
    if (IDS.gaId && window.gtag) window.gtag('event', gaEvent || goal, params || {});
  } catch { /* аналитика никогда не должна ломать страницу */ }
}

/**
 * Цели на странице кабинета после редиректа: регистрация, активация промо,
 * возврат с оплаты. Счётчик грузится асинхронно — ждём его до ~6 секунд.
 */
export function AnalyticsGoals({ welcome, paid, promo }: { welcome?: boolean; paid?: boolean; promo?: boolean }) {
  useEffect(() => {
    const goals: [string, string][] = [];
    if (welcome) goals.push(['registration', 'sign_up']);
    if (promo) goals.push(['promo_activated', 'promo_activated']);
    if (paid) goals.push(['payment', 'payment']);
    if (!goals.length) return;
    let tries = 0;
    const t = setInterval(() => {
      const ready = (!IDS.ymId || window.ym) && (!IDS.gaId || window.gtag);
      if (ready || ++tries > 30) {
        clearInterval(t);
        goals.forEach(([g, e]) => reachGoal(g, e));
        // Убираем флаг из адреса: обновление страницы не должно засчитать цель ещё раз.
        const url = new URL(window.location.href);
        ['welcome', 'paid', 'promo'].forEach((k) => url.searchParams.delete(k));
        window.history.replaceState(null, '', url.pathname + (url.search || ''));
      }
    }, 200);
    return () => clearInterval(t);
  }, [welcome, paid, promo]);
  return null;
}
