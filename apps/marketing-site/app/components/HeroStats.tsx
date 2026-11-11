'use client';

// Статистика в пустой полосе слева от макбука в первом экране. Блок — отдельный
// абсолютный слой ВНЕ .hero-laptop-zone: во-первых, он не участвует в потоке и
// поэтому не сдвигает макбук ни в покое, ни при наведении; во-вторых, зона
// макбука — это role="button", и класть в неё содержательный текст не стоит.
// Уезжает влево по наведению на зону — через соседний селектор в globals.css.
//
// Цифры считаются вверх при появлении на экране: первый экран, так что почти
// всегда сразу при загрузке. При prefers-reduced-motion — сразу конечные значения.

import { useEffect, useRef, useState } from 'react';

type Stat = { id: string; value: number; label: string; icon: React.ReactNode };

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d={d} />
  </svg>
);

const STATS: Stat[] = [
  {
    id: 'applies',
    value: 513000,
    label: 'откликов отправлено',
    icon: icon('M2.2 11.1 20.6 3.3c.8-.3 1.6.5 1.3 1.3l-7.8 18.4c-.3.8-1.5.8-1.8-.1l-2.4-6.6-6.6-2.4c-.9-.3-.9-1.5-.1-1.8zm8.5 3.2 1.7 4.6 5.3-12.4-7 7.8z'),
  },
  {
    id: 'hours',
    value: 20000,
    label: 'сэкономленных часов соискателей',
    icon: icon('M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm1-13h-2v6.4l5 3 1-1.7-4-2.4z'),
  },
  {
    id: 'invites',
    value: 23000,
    label: 'приглашений на собеседования',
    icon: icon('M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v.5l8 5 8-5V6H4zm0 12h16V8.9l-7.5 4.7a1 1 0 0 1-1 0L4 8.9V18z'),
  },
  {
    id: 'offers',
    value: 122,
    label: 'наших пользователей получили оффер',
    icon: icon('M18 3h3v3a4 4 0 0 1-3.3 3.9A6 6 0 0 1 13 13.9V17h3v2H8v-2h3v-3.1a6 6 0 0 1-4.7-4A4 4 0 0 1 3 6V3h3V2h12zm0 2v2.9A2 2 0 0 0 19 6V5zM6 5H5v1a2 2 0 0 0 1 1.9z'),
  },
  {
    id: 'nooffer',
    value: 0,
    label: 'случаев отсутствия офферов с Откликс',
    icon: icon('M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5zm-1.2 13.4 6-6-1.4-1.4-4.6 4.6-2.2-2.2-1.4 1.4z'),
  },
];

const COUNT_MS = 1500;

function formatRu(n: number) {
  // Неразрывные тонкие пробелы разрядов даёт сама локаль — 513 000, а не 513000.
  return n.toLocaleString('ru-RU');
}

export function HeroStats() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setProgress(1);
      return undefined;
    }

    let raf = 0;
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / COUNT_MS);
        // easeOutCubic: быстро разгоняется и мягко замирает на конечном числе
        setProgress(1 - (1 - p) ** 3);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    if (typeof IntersectionObserver === 'undefined') {
      run();
      return () => cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) run(); }, { threshold: 0.2 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  return (
    <div className="hero-stats" ref={rootRef}>
      <p className="hero-stats__title">
        <span aria-hidden="true" />
        Статистика Откликс в этом году
      </p>

      <ul className="hero-stats__list">
        {STATS.map((s) => (
          <li className="hero-stats__item" key={s.id}>
            <span className="hero-stats__ico" aria-hidden="true">{s.icon}</span>
            <span className="hero-stats__body">
              <span className="hero-stats__value">{formatRu(Math.round(s.value * progress))}</span>
              <span className="hero-stats__label">{s.label}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
