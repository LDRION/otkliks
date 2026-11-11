'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Планшет с анкетой работодателя и тот же «наезд камеры» по клику, что у макбука в
// hero (HeroLaptopReveal.tsx — подробные комментарии про блокировку скролла, Lenis,
// портал и всплытие клика там; здесь не дублируем).
//
// Отличие в геометрии. Экран макбука снят с чистым наклоном вперёд — его хватило
// описать одним rotateX. Экран планшета повёрнут сразу по нескольким осям: это
// произвольная трапеция, и набором CSS-функций её точно не выразить. Поэтому
// стартовый кадр — точная проекция (matrix3d), посчитанная по четырём углам экрана,
// а анимация идёт покадрово: каждый угол едет по прямой от экрана планшета к центру,
// и картинка на любом кадре остаётся корректной проекцией, без переломов.
type Phase = 'idle' | 'entering' | 'shown' | 'exiting';
type Pt = [number, number];

const MOCK_SRC = '/images/otkliks-zapolnenie-anket-rabotodatelya.webp';
const ZOOM_SRC = '/images/otkliks-zapolnenie-anket-rabotodatelya-polnyi-ekran.webp';

// Углы дисплея на мокапе в долях его размеров: лев-верх, прав-верх, прав-низ,
// лев-низ. Не на глаз — найдены сопоставлением плоского скрина с экраном на мокапе
// (ORB по уменьшенному скрину, затем попиксельное уточнение ECC, корреляция 0.965).
// Если мокап заменят или обрежут иначе — пересчитать.
const SCREEN_QUAD: [Pt, Pt, Pt, Pt] = [
  [0.38435, 0.04196],
  [0.86957, 0.07279],
  [0.67582, 0.80913],
  [0.20693, 0.6295],
];

const IMG_W = 920;
const IMG_H = 587;
// Исходник шириной 920px: крупнее тысячи его уже заметно растягивает, текст мылится.
const TARGET_MAX_WIDTH = 1000;
const TARGET_VW_RATIO = 0.88;
const TARGET_VH_RATIO = 0.78;

const ENTER_MS = 1100;
const EXIT_SHRINK_MS = 1100;
const EXIT_FADE_MS = 300;

// cubic-bezier(0.22, 1, 0.36, 1) — та же кривая, что у transition макбука и телефона.
function easeOut(t: number) {
  const bx = (s: number) => 3 * (1 - s) * (1 - s) * s * 0.22 + 3 * (1 - s) * s * s * 0.36 + s * s * s;
  const by = (s: number) => 3 * (1 - s) * (1 - s) * s * 1 + 3 * (1 - s) * s * s * 1 + s * s * s;
  let lo = 0;
  let hi = 1;
  let s = t;
  for (let i = 0; i < 24; i += 1) {
    const x = bx(s);
    if (Math.abs(x - t) < 1e-5) break;
    if (x < t) lo = s; else hi = s;
    s = (lo + hi) / 2;
  }
  return by(s);
}

// Проекция прямоугольника w×h в четырёхугольник q (порядок углов как у SCREEN_QUAD),
// в виде CSS matrix3d при transform-origin 0 0.
function quadToMatrix3d(w: number, h: number, q: [Pt, Pt, Pt, Pt]) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  let g = 0;
  let hh = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    hh = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + hh * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + hh * y3;
  // Из единичного квадрата — в пиксели элемента.
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, x0, y0, 0, 1];
  return `matrix3d(${m.join(',')})`;
}

const lerpQuad = (from: Pt[], to: Pt[], k: number) =>
  from.map(([x, y], i) => [x + (to[i][0] - x) * k, y + (to[i][1] - y) * k]) as [Pt, Pt, Pt, Pt];

export function FormsTabletReveal() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [running, setRunning] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const mockRef = useRef<HTMLImageElement>(null);
  const zoomRef = useRef<HTMLImageElement>(null);
  const rafRef = useRef<number | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Текущие углы картинки на экране — чтобы закрытие посреди наезда поехало назад
  // с того места, где она сейчас, а не прыгнуло в конечную точку.
  const cornersRef = useRef<[Pt, Pt, Pt, Pt] | null>(null);

  useEffect(() => {
    const img = new window.Image();
    img.src = ZOOM_SRC;
  }, []);

  // Экран планшета в координатах окна — снимается на КАЖДОМ кадре, а не один раз при
  // клике: пока идёт обратный наезд, скролл уже разблокирован, и планшет на странице
  // уезжает вместе с прокруткой. Без пересчёта картинка промахивалась бы мимо него.
  function screenQuad(): [Pt, Pt, Pt, Pt] | null {
    const el = mockRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return SCREEN_QUAD.map(([fx, fy]) => [r.left + fx * r.width, r.top + fy * r.height]) as [Pt, Pt, Pt, Pt];
  }

  function targetQuad(w: number, h: number): [Pt, Pt, Pt, Pt] {
    const x = (window.innerWidth - w) / 2;
    const y = (window.innerHeight - h) / 2;
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }

  function paint(q: [Pt, Pt, Pt, Pt], w: number, h: number) {
    cornersRef.current = q;
    const img = zoomRef.current;
    if (img) img.style.transform = quadToMatrix3d(w, h, q);
  }

  function animate(ms: number, frame: (k: number) => void, done?: () => void) {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      frame(easeOut(t));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else {
        rafRef.current = null;
        done?.();
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }

  function open() {
    if (!screenQuad()) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(TARGET_MAX_WIDTH, vw * TARGET_VW_RATIO, (vh * TARGET_VH_RATIO * IMG_W) / IMG_H);
    const h = (w * IMG_H) / IMG_W;
    setSize({ w, h });
    setRunning(false);
    setFadingOut(false);
    setPhase('entering');
  }

  // Оверлей смонтирован — ставим картинку ровно на экран планшета и едем в центр.
  // Layout-, а не обычный эффект: тот срабатывает уже ПОСЛЕ отрисовки, и на один кадр
  // картинка мелькала бы в левом верхнем углу во весь размер, ещё без проекции.
  useLayoutEffect(() => {
    if (phase !== 'entering' || !size) return;
    const start = screenQuad();
    if (!start) return;
    paint(start, size.w, size.h);
    requestAnimationFrame(() => {
      setRunning(true);
      setPhase('shown');
      const end = targetQuad(size.w, size.h);
      animate(ENTER_MS, (k) => paint(lerpQuad(start, end, k), size.w, size.h));
    });
  }, [phase, size]);

  function close() {
    if (phase !== 'shown' || !size) return;
    setRunning(false);
    setPhase('exiting');
    const from = cornersRef.current ?? targetQuad(size.w, size.h);
    animate(
      EXIT_SHRINK_MS,
      (k) => {
        const to = screenQuad();
        if (to) paint(lerpQuad(from, to, k), size.w, size.h);
      },
      () => {
        setFadingOut(true);
        exitTimer.current = setTimeout(() => setPhase('idle'), EXIT_FADE_MS);
      },
    );
  }

  // Блокировка скролла и пауза Lenis на время показа — 1:1 с HeroLaptopReveal.tsx.
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

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, []);

  const overlayVisible = phase !== 'idle';

  return (
    // reveal — на отдельной статичной обёртке, НЕ на зоне. ScrollReveal добавляет ему
    // класс in через classList, а className зоны React переписывает при каждом клике
    // (--pinned): in затирался, и планшет в момент наезда откатывался в «ещё не
    // появился» — прозрачность 0 и сдвиг вниз, прямо из-под стартового кадра.
    <div className="reveal">
    <div
      className={`forms-tablet-zone${overlayVisible ? ' forms-tablet-zone--pinned' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="Показать анкету на весь экран"
      onClick={(e) => {
        e.stopPropagation();
        // Клик по оверлею (он в портале, но React-потомок этой зоны) всплывает сюда
        // же — без проверки закрытие тут же переоткрывало бы наезд.
        if (phase === 'idle') open();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && phase === 'idle') {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="forms-tablet">
        <img
          ref={mockRef}
          className="forms-tablet__img"
          src={MOCK_SRC}
          alt="Планшет с анкетой работодателя на вакансию — Откликс заполняет такие анкеты за кандидата"
          width={771}
          height={537}
          loading="lazy"
        />
        <span className="forms-tablet__cta shot-cta">Нажмите сюда</span>
      </div>

      {overlayVisible && size && typeof document !== 'undefined' && createPortal(
        <div className={`tablet-zoom${running ? ' tablet-zoom--run' : ''}${fadingOut ? ' tablet-zoom--fading' : ''}`}>
          <div className="tablet-zoom__backdrop" />
          <img
            ref={zoomRef}
            className="tablet-zoom__img"
            style={{ width: `${size.w}px`, height: `${size.h}px` }}
            src={ZOOM_SRC}
            alt="Анкета работодателя на вакансию крупно, без искажения макета"
            width={IMG_W}
            height={IMG_H}
            onError={() => {
              // Битую картинку на весь экран не показываем — тихо сворачиваемся.
              if (rafRef.current) cancelAnimationFrame(rafRef.current);
              if (exitTimer.current) clearTimeout(exitTimer.current);
              setRunning(false);
              setFadingOut(false);
              setPhase('idle');
            }}
          />
          <p className="tablet-zoom__hint">Нажмите ещё раз, чтобы продолжить</p>
        </div>,
        document.body,
      )}
    </div>
    </div>
  );
}
