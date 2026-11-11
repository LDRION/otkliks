'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Тот же приём FLIP, что и в HeroLaptopReveal.tsx (см. подробные комментарии там —
// не дублируем их целиком здесь). Отличия от макбука:
// 1. Триггер — НАВЕДЕНИЕ, а не клик: попросили именно так.
// 2. Не нужна подмена на отдельный «плоский» скриншот — сам мокап телефона снят
//    прямо, без перспективы, а лёгкий наклон (-3deg) — чисто CSS transform на
//    той же картинке. Наезд просто увеличивает и выпрямляет (rotate → 0) ЕЁ ЖЕ,
//    без второго изображения и без rotateX/perspective.
// 3. Нет промежуточной стадии «наполовину проехал при hover» (как у макбука) —
//    сразу полноэкранный наезд с затемнением и подсказкой.
type Phase = 'idle' | 'entering' | 'shown' | 'exiting';

const IMG_SRC = '/images/otkliks-chat-s-rabotodatelem.webp';
// Попросили увеличить полноэкранный наезд ещё в полтора раза сверх прежнего —
// раньше было 460/0.5/0.8. VH-ограничение — это предохранитель от переполнения
// на невысоких экранах, а не целевой размер, поэтому его подняли не буквально
// в 1.5 раза (0.8×1.5=1.2 от высоты вьюпорта попросту невозможно), а скромно.
const TARGET_MAX_WIDTH = 690;
const TARGET_VW_RATIO = 0.75;
const TARGET_VH_RATIO = 0.85;
const IMG_ASPECT = 1; // 768x768
const BASE_ROTATE_DEG = -3; // тот же наклон, что у .pricing-phone__img в покое
const EXIT_SHRINK_MS = 1100;
const EXIT_FADE_MS = 300;

export function PricingPhoneReveal() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [running, setRunning] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const [flip, setFlip] = useState<{ dx: number; dy: number; sx: number; sy: number; w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const zoomImgRef = useRef<HTMLImageElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef<Phase>('idle');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  // Раньше открытие/закрытие держалось на mouseenter/mouseleave — и срабатывало
  // странно: как только наезд открывается, портал (position:fixed на весь экран)
  // визуально перекрывает исходную зону, браузер тут же считает это уходом
  // курсора и шлёт настоящий mouseleave — хотя реальный курсор мыши никуда не
  // двигался. Это «взводило» открытие заново ещё до того, как пользователь
  // физически убрал курсор, и клик для закрытия иногда тут же переоткрывал наезд.
  // Вместо DOM-событий hover — следим за РЕАЛЬНЫМИ координатами курсора одним
  // общим mousemove и сверяем их с текущим прямоугольником картинки: открытие
  // происходит только в момент, когда курсор физически впервые оказался внутри
  // этого прямоугольника, а повторно открыть можно только после того, как он
  // действительно вышел за его пределы — что бы в это время ни было отрисовано
  // поверх зоны.
  const pointerInsideRef = useRef(false);
  const armedRef = useRef(true);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const el = imgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (inside) {
        pointerInsideRef.current = true;
        // Прямоугольник картинки — не то же самое, что её РЕАЛЬНО видимая
        // область: телефон сдвинут вправо и частично уходит ПОД карточку
        // бесплатного тарифа (выше по z-index). Курсор может физически
        // находиться внутри прямоугольника телефона, но визуально указывать
        // на карточку, которая его там перекрывает — наводить в этом месте
        // не должно открывать наезд. Проверяем на каждый тик (не только на
        // «только что зашёл»): при движении из-под карточки на видимую часть
        // телефона курсор всё это время остаётся «inside» одного и того же
        // прямоугольника, без отдельного события входа.
        if (armedRef.current && phaseRef.current === 'idle') {
          const topEl = document.elementFromPoint(e.clientX, e.clientY);
          if (topEl === el) open();
        }
      } else if (pointerInsideRef.current) {
        pointerInsideRef.current = false;
        armedRef.current = true;
      }
    }
    document.addEventListener('mousemove', onMove, { passive: true });
    return () => document.removeEventListener('mousemove', onMove);
  }, []);

  function open() {
    const el = imgRef.current;
    if (!el) return;
    const start = el.getBoundingClientRect();

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const targetW = Math.min(TARGET_MAX_WIDTH, vw * TARGET_VW_RATIO, vh * TARGET_VH_RATIO);
    const targetH = targetW * IMG_ASPECT;

    const startCenterX = start.left + start.width / 2;
    const startCenterY = start.top + start.height / 2;

    setFlip({
      dx: startCenterX - vw / 2,
      dy: startCenterY - vh / 2,
      sx: start.width / targetW,
      sy: start.height / targetH,
      w: targetW,
      h: targetH,
    });
    setRunning(false);
    setFadingOut(false);
    setPhase('entering');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setRunning(true);
        setPhase('shown');
      });
    });
  }

  function close() {
    if (phase !== 'shown') return;
    armedRef.current = false;
    setRunning(false);
    setPhase('exiting');
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => {
      setFadingOut(true);
      exitTimer.current = setTimeout(() => setPhase('idle'), EXIT_FADE_MS);
    }, EXIT_SHRINK_MS);
  }

  // Блокировка скролла + пауза Lenis, пока показан полноэкранный наезд — 1:1 с
  // HeroLaptopReveal.tsx (см. комментарии там). Снимается сразу с началом
  // 'exiting', не дожидаясь конца обратной анимации.
  useEffect(() => {
    if (phase !== 'shown') return;

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.documentElement.style.overflow;
    const prevPaddingRight = document.documentElement.style.paddingRight;
    document.documentElement.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.documentElement.style.paddingRight = `${scrollbarWidth}px`;
      document.documentElement.style.setProperty('--scrollbar-comp', `${scrollbarWidth}px`);
    }
    window.__lenis?.stop();

    const onClick = () => close();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      close();
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    document.addEventListener('keydown', onKey, true);

    return () => {
      document.documentElement.style.overflow = prevOverflow;
      document.documentElement.style.paddingRight = prevPaddingRight;
      document.documentElement.style.removeProperty('--scrollbar-comp');
      window.__lenis?.start();
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('wheel', onWheel, true);
      document.removeEventListener('touchmove', onTouchMove, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [phase]);

  // Живое перенацеливание во время обратного наезда при скролле — та же логика,
  // что и у макбука (см. HeroLaptopReveal.tsx): координаты старта пересчитываются
  // на каждый скролл, чтобы уменьшающаяся картинка ехала к РЕАЛЬНОМУ текущему
  // положению телефона, а не к устаревшей точке, снятой один раз в open().
  useEffect(() => {
    if (phase !== 'exiting') return;

    function retarget() {
      const el = imgRef.current;
      const img = zoomImgRef.current;
      if (!el || !img) return;
      const start = el.getBoundingClientRect();
      const dx = start.left + start.width / 2 - window.innerWidth / 2;
      const dy = start.top + start.height / 2 - window.innerHeight / 2;
      img.style.setProperty('--zoom-dx', `${dx}px`);
      img.style.setProperty('--zoom-dy', `${dy}px`);
    }

    window.addEventListener('scroll', retarget, { passive: true });
    return () => window.removeEventListener('scroll', retarget);
  }, [phase]);

  useEffect(() => () => { if (exitTimer.current) clearTimeout(exitTimer.current); }, []);

  const overlayVisible = phase === 'entering' || phase === 'shown' || phase === 'exiting';

  return (
    <div
      className="pricing-phone-zone"
      role="button"
      tabIndex={0}
      aria-label="Показать телефон крупнее"
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && phase === 'idle') {
          e.preventDefault();
          open();
        }
      }}
    >
      <img
        ref={imgRef}
        className="pricing-phone__img"
        src={IMG_SRC}
        alt="Автопилот отвечает работодателю в чате hh.ru от первого лица кандидата"
        width={768}
        height={768}
        loading="lazy"
      />

      {overlayVisible && flip && typeof document !== 'undefined' && createPortal(
        <div className={`phone-zoom phone-zoom--${phase}${running ? ' phone-zoom--run' : ''}${fadingOut ? ' phone-zoom--fading' : ''}`}>
          <div className="phone-zoom__backdrop" />
          <img
            ref={zoomImgRef}
            className="phone-zoom__img"
            style={{
              '--zoom-w': `${flip.w}px`,
              '--zoom-h': `${flip.h}px`,
              '--zoom-dx': `${flip.dx}px`,
              '--zoom-dy': `${flip.dy}px`,
              '--zoom-sx': flip.sx,
              '--zoom-sy': flip.sy,
              '--zoom-rot': `${BASE_ROTATE_DEG}deg`,
            } as React.CSSProperties}
            src={IMG_SRC}
            alt="Автопилот отвечает работодателю в чате hh.ru от первого лица кандидата"
            width={768}
            height={768}
          />
          <p className="phone-zoom__hint">Нажмите ещё раз, чтобы продолжить</p>
        </div>,
        document.body,
      )}
    </div>
  );
}
