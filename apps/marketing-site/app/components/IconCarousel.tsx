'use client';

// Карусель пиктограмм с пояснением под ней. Выбранная плавно выезжает в центр и
// увеличивается, соседние стоят по бокам мельче и бледнее, дальние уезжают за кадр.
// Листается сама; наведение останавливает листание и выбирает пиктограмму под курсором.
//
// Пояснение — ПОД каруселью, прямо на странице. Раньше оно было затемнением низа экрана,
// но большой плавный тёмный градиент на старых (6-битных) матрицах неизбежно ложится
// полосами: дизеринг там на стороне монитора, со стороны сайта это не лечится.
//
// IntersectionObserver: листаем только пока блок на экране — не гоняем таймер и
// перерисовку впустую.

import { useEffect, useRef, useState, type ReactNode } from 'react';

export type CarouselItem = {
  id: string;
  name: string;
  text: string;
  icon: ReactNode;
  /** Цвет подсветки выбранной пиктограммы; по умолчанию — акцент сайта. */
  brand?: string;
};

const AUTOPLAY_MS = 4600;
// Пока пиктограммы едут, под курсором оказывается соседняя. Её mouseenter выбрал бы её,
// та уехала бы в центр, под курсор въехала бы следующая — карусель крутилась бы сама.
const MOVE_MS = 750;

export function IconCarousel({ items, label }: { items: CarouselItem[]; label: string }) {
  const [active, setActive] = useState(0);
  const [inView, setInView] = useState(false);
  const [paused, setPaused] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const movingUntil = useRef(0);

  const select = (i: number) => {
    setActive(i);
    movingUntil.current = Date.now() + MOVE_MS;
  };

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || paused) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = setInterval(() => {
      setActive((i) => (i + 1) % items.length);
      movingUntil.current = Date.now() + MOVE_MS;
    }, AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [inView, paused, items.length]);

  // Смещение от центра со знаком: 0 — центр, ±1 — бока, дальше — за кадром.
  const offsetOf = (i: number) => {
    const rel = (i - active + items.length) % items.length;
    return rel > items.length / 2 ? rel - items.length : rel;
  };

  const current = items[active];

  return (
    <div className="fs-carousel">
      <div
        className="fs-stage"
        ref={stageRef}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        role="group"
        aria-label={label}
      >
        {items.map((item, i) => {
          const offset = offsetOf(i);
          const far = Math.abs(offset) > 1;
          return (
            <button
              key={item.id}
              type="button"
              className="fs-item"
              style={{
                '--fs-offset': Math.max(-2, Math.min(2, offset)),
                ...(item.brand ? { '--brand': item.brand } : {}),
              } as React.CSSProperties}
              data-slot={offset === 0 ? 'center' : (far ? 'far' : 'side')}
              aria-label={`${item.name}. ${item.text}`}
              aria-current={i === active}
              aria-hidden={far}
              tabIndex={far ? -1 : 0}
              onMouseEnter={() => { if (Date.now() > movingUntil.current) select(i); }}
              onFocus={() => { select(i); setPaused(true); }}
              onBlur={() => setPaused(false)}
              onClick={() => select(i)}
            >
              <span className="fs-item__medal">{item.icon}</span>
            </button>
          );
        })}
      </div>

      <div className={`fs-dots${paused || !inView ? ' is-paused' : ''}`} aria-hidden="true">
        {items.map((item, i) => (
          <span key={item.id} className={`fs-dot${i === active ? ' is-active' : ''}`}>
            {/* Полоска заполняется до следующего переключения; key — чтобы отсчёт
                начинался заново на каждой смене, а не продолжал прошлый. */}
            {i === active ? <i key={active} /> : null}
          </span>
        ))}
      </div>

      <div className="fs-panel" aria-live="polite">
        <div className="fs-panel__text" key={current.id}>
          <strong>{current.name}</strong>
          <span>{current.text}</span>
        </div>
      </div>
    </div>
  );
}
