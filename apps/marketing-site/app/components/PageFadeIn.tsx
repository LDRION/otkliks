'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

// Плавное появление всей страницы целиком на свежей загрузке (F5 или первое
// открытие сайта) — шапка, текст, картинки, всё сразу одним движением, а не
// врозь. Плюс то же появление на КАЖДОМ переходе внутри сайта (эффект по
// pathname ниже).
//
// Картинку показываем, только когда точно знаем, что она догрузилась —
// img.complete для уже закешированных, иначе слушаем load/error. Пока не
// готовы ВСЕ картинки в границах самого первого экрана (getBoundingClientRect
// сразу после гидратации — верстка от SSR уже на месте), страница остаётся
// скрытой через .js body{opacity:0} в globals.css. Предохранитель на 3s —
// если какая-то картинка так и не догрузится (плохая сеть, битая ссылка),
// страница всё равно не останется невидимой навсегда.
export function PageFadeIn() {
  const pathname = usePathname();
  const firstRender = useRef(true);

  // Появление на переходах внутри сайта. Через CSS-анимацию, а не через снятие
  // .page-ready: снять класс — значит на кадр показать пустую страницу, а анимация
  // стартует сразу с прозрачного, без мигания. Анимируем ТОЛЬКО прозрачность:
  // transform на body сделал бы его точкой отсчёта для fixed-элементов, и шапка с
  // виджетом консультанта прыгали бы на время анимации.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;   // первую загрузку ведёт эффект ниже
      return undefined;
    }
    const { body } = document;
    body.classList.remove('page-enter');
    void body.offsetWidth;           // перезапуск анимации, если переход быстрее неё
    body.classList.add('page-enter');
    const done = setTimeout(() => body.classList.remove('page-enter'), 500);
    return () => clearTimeout(done);
  }, [pathname]);

  useEffect(() => {
    let revealed = false;
    function reveal() {
      if (revealed) return;
      revealed = true;
      document.body.classList.add('page-ready');
    }

    const vh = window.innerHeight;
    const heroImages = Array.from(document.querySelectorAll('img')).filter((img) => {
      const r = img.getBoundingClientRect();
      return r.bottom > 0 && r.top < vh;
    });

    if (heroImages.length === 0) {
      requestAnimationFrame(reveal);
      return;
    }

    let remaining = heroImages.length;
    function onSettle() {
      remaining -= 1;
      if (remaining <= 0) reveal();
    }
    heroImages.forEach((img) => {
      if (img.complete) {
        onSettle();
        return;
      }
      img.addEventListener('load', onSettle, { once: true });
      img.addEventListener('error', onSettle, { once: true });
    });

    const safety = setTimeout(reveal, 3000);
    return () => clearTimeout(safety);
  }, []);

  return null;
}
