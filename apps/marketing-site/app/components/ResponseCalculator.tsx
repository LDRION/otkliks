'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

// Модель НЕ линейная: со временем автопилот работает лучше — точнее подбирает
// вакансии и конкретнее пишет письма под каждую, — поэтому доля приглашений
// растёт, а доля быстрых отказов снижается. Но отказов на любом дне ощутимо
// больше приглашений (в реальности так и есть — по порядку 3-4 раза, никогда
// не наоборот): это не сигнал плохого резюме, а нормальная статистика рынка
// труда. Ключевое отличие от прежней версии — приглашения НИКОГДА не обгоняют
// отказы, только сокращают разрыв.
const MIN_DAYS = 1;
const MAX_DAYS = 30;
const DEFAULT_DAYS = 14;

type Day = { applies: number; interviews: number; rejections: number; waiting: number };

// Детерминированный «шум» в [-1,1] по дню: числа выглядят живыми, как настоящая
// статистика (слегка скачут), но seed фиксированный — при перерисовке не мерцают.
function noise(d: number, seed: number) {
  const x = Math.sin(d * 12.9898 + seed * 4.1414) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function perDay(d: number): Day {
  const applies = Math.round(150 + 16 * (1 - Math.exp(-(d - 1) / 12)) + noise(d, 7) * 4);
  // Доля быстрых отказов среди всех откликов постепенно снижается (19% → 13%),
  // доля приглашений растёт (3% → 5.5%) — но даже в лучший день приглашений
  // заметно меньше отказов (около 2.4 раза), а в первые дни — в 5-6 раз.
  const rejectionRate = 0.13 + 0.06 * Math.exp(-(d - 1) / 10);
  const interviewRate = 0.055 - 0.025 * Math.exp(-(d - 1) / 10);
  const rejections = Math.max(0, Math.round(applies * rejectionRate + noise(d, 2) * 1.6));
  const interviews = Math.max(0, Math.round(applies * interviewRate + noise(d, 1) * 1));
  const waiting = Math.max(0, applies - interviews - rejections);
  return { applies, interviews, rejections, waiting };
}

// Сэкономленные часы — ОТДЕЛЬНАЯ от заявок модель, не «заявки × 8 минут»: при
// ~150 откликах в день такая линейная формула давала ~20 часов ЗА ОДИН ДЕНЬ —
// больше суток разумной активности, никто столько на поиск работы не тратит.
// Вместо этого — реалистичный дневной бюджет самостоятельного поиска, который
// АВТОПИЛОТ заменяет: 6 часов в первый день, дальше день ото дня случайно
// (детерминированно, тот же noise()) от 5 до 8 часов — ровно тот разброс,
// который был бы у живого человека, ищущего работу вручную.
function hoursForDay(d: number) {
  if (d === 1) return 6;
  return Math.round(5 + ((noise(d, 99) + 1) / 2) * 3);
}

// Считаем 30 дней один раз — и посуточные ряды (для графика), и накопленные суммы.
const SERIES: Day[] = Array.from({ length: MAX_DAYS }, (_, i) => perDay(i + 1));
const HOURS_SERIES: number[] = Array.from({ length: MAX_DAYS }, (_, i) => hoursForDay(i + 1));
const HOURS_CUM: number[] = (() => {
  let acc = 0;
  return HOURS_SERIES.map((h) => (acc += h));
})();
const CUM: Day[] = (() => {
  const out: Day[] = [];
  const acc: Day = { applies: 0, interviews: 0, rejections: 0, waiting: 0 };
  for (const s of SERIES) {
    acc.applies += s.applies;
    acc.interviews += s.interviews;
    acc.rejections += s.rejections;
    acc.waiting += s.waiting;
    out.push({ ...acc });
  }
  return out;
})();

// --- геометрия графиков посуточной динамики ---
// Два отдельных мини-графика (приглашения / отказы), а не один общий — на общей
// шкале отказы (в разы больше) визуально «давят» приглашения, читается как
// «всё плохо», хотя оба показателя на самом деле улучшаются. У каждого своя
// шкала (Y_MAX считается от СВОИХ значений) — рост приглашений и спад отказов
// одинаково заметны, а честное соотношение видно в подписях/тултипе, не в
// высоте линий друг относительно друга.
const CH_W = 660;
const PAD_X = { l: 18, r: 96 };
const PLOT_W = CH_W - PAD_X.l - PAD_X.r;
const xForDay = (d: number) => PAD_X.l + ((d - 1) / (MAX_DAYS - 1)) * PLOT_W;

const MINI_H = 132;
const MINI_PAD_Y = { t: 20, b: 14 };
const MINI_PLOT_H = MINI_H - MINI_PAD_Y.t - MINI_PAD_Y.b;

type Pt = { x: number; y: number };
// Гладкая кривая (Catmull-Rom → кубические безье) — линии текут, а не ступеньками.
function smooth(pts: Pt[]) {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function buildMiniChart(values: number[]) {
  const max = Math.max(...values) * 1.2;
  const yFor = (v: number) => MINI_PAD_Y.t + (1 - v / max) * MINI_PLOT_H;
  const pts = values.map((v, i) => ({ x: xForDay(i + 1), y: yFor(v) }));
  const line = smooth(pts);
  const area = `${line} L${xForDay(MAX_DAYS).toFixed(1)} ${yFor(0).toFixed(1)} L${xForDay(1).toFixed(1)} ${yFor(0).toFixed(1)} Z`;
  return { yFor, line, area };
}

const GOOD_VALUES = SERIES.map((s) => s.interviews);
const BAD_VALUES = SERIES.map((s) => s.rejections);
const GOOD_CHART = buildMiniChart(GOOD_VALUES);
const BAD_CHART = buildMiniChart(BAD_VALUES);

const FIRST = SERIES[0];

function useAnimatedNumber(target: number, duration = 550) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);
  return value;
}

function pluralDays(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return many;
  if (m10 === 1) return one;
  if (m10 >= 2 && m10 <= 4) return few;
  return many;
}
const fmt = (n: number) => n.toLocaleString('ru-RU');

export function ResponseCalculator() {
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const goodSvgRef = useRef<SVGSVGElement | null>(null);

  const c = CUM[days - 1];
  const current = SERIES[days - 1];
  const hoursSaved = HOURS_CUM[days - 1];
  const workWeeks = Math.max(1, Math.round(hoursSaved / 40));

  // Раньше считались один раз от дня 1 к дню 30 (module-level константы) — не
  // менялись при движении ползунка. Теперь честно от дня 1 к ВЫБРАННОМУ дню:
  // и подпись-процент, и значение на конце линии реагируют на ползунок.
  const goodTrend = Math.round(((current.interviews - FIRST.interviews) / FIRST.interviews) * 100);
  const badTrend = Math.round(((current.rejections - FIRST.rejections) / FIRST.rejections) * 100);

  const aResponses = useAnimatedNumber(c.applies);
  const aInterviews = useAnimatedNumber(c.interviews);
  const aRejections = useAnimatedNumber(c.rejections);
  const aPending = useAnimatedNumber(c.waiting);
  const aHours = useAnimatedNumber(hoursSaved);

  const pct = ((days - MIN_DAYS) / (MAX_DAYS - MIN_DAYS)) * 100;

  // Позиция каретки «где вы сейчас» — скользит по кривым к выбранному дню.
  const nowX = xForDay(days);

  const tip = hoverDay ? SERIES[hoverDay - 1] : null;

  // Позиция подсказки зажата 10-90%: она центрируется по курсору (translateX(-50%)
  // в CSS), и у самого края её половина уезжала бы за пределы карточки. Пока предел
  // по ползунку стоял, это всплывало только на дне 30 — теперь курсор доходит туда
  // при любом положении ползунка.
  const tipLeftPct = hoverDay
    ? Math.min(90, Math.max(10, (xForDay(hoverDay) / CH_W) * 100))
    : 0;

  // Общий для обоих мини-графиков — у них одна и та же горизонтальная шкала
  // (PAD_X/PLOT_W/xForDay), так что курсор над любым из двух двигает общий
  // тултип и общую вертикаль на обоих сразу.
  function onMove(e: PointerEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const xUser = ((e.clientX - rect.left) / rect.width) * CH_W;
    const d = Math.round(((xUser - PAD_X.l) / PLOT_W) * (MAX_DAYS - 1)) + 1;
    // Предел — вся шкала, а НЕ выбранный на ползунке день. Раньше стояло
    // Math.min(days, …): правее каретки подсказка залипала на выбранном дне и
    // переставала следовать за курсором, будто график там мёртвый. Кривые
    // отрисованы на все 30 дней, и данные по ним есть — показывать их честно.
    setHoverDay(Math.min(MAX_DAYS, Math.max(MIN_DAYS, d)));
  }

  return (
    <div className="calc">
      {/* --- Ползунок --- */}
      <div className="calc-slider-row">
        <div className="calc-slider-label">
          <span>Сколько дней Откликс работает на вас</span>
          <span className="calc-slider-value">
            {days}&nbsp;<span className="calc-slider-value-unit">{pluralDays(days)}</span>
          </span>
        </div>
        <div className="calc-range-wrap" style={{ '--pct': `${pct}%` } as CSSProperties}>
          <input
            type="range"
            min={MIN_DAYS}
            max={MAX_DAYS}
            step={1}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="calc-range"
            aria-label="Количество дней использования Откликс"
          />
        </div>
        <div className="calc-slider-ticks">
          <span>1 день</span>
          <span>2 недели</span>
          <span>30 дней</span>
        </div>
      </div>

      {/* --- Герой: сэкономленное время как первоклассный показатель --- */}
      <div className="calc-hero">
        <div className="calc-hero-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="13" r="8" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 9v4l2.5 2M9 2h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
        <div className="calc-hero-body">
          <div className="calc-hero-num">
            ~{fmt(aHours)}&nbsp;<span className="calc-hero-unit">часов</span>
          </div>
          <div className="calc-hero-sub">
            ручной работы, которую вы не потратили на поиск вакансий и письма — это как{' '}
            <b>{workWeeks}&nbsp;{plural(workWeeks, 'рабочая неделя', 'рабочих недели', 'рабочих недель')}</b>,{' '}
            {plural(workWeeks, 'прожитая, а не просиженная', 'прожитые, а не просиженные', 'прожитых, а не просиженных')} на hh.ru.
          </div>
        </div>
      </div>

      {/* --- Накопленные показатели --- */}
      <div className="calc-stats">
        <div className="calc-stat">
          <span className="calc-stat-label">Всего откликов</span>
          <span className="calc-stat-num">{fmt(aResponses)}</span>
        </div>
        <div className="calc-stat calc-stat--good">
          <span className="calc-stat-label">Приглашений на собеседование</span>
          <span className="calc-stat-num">{fmt(aInterviews)}</span>
        </div>
        <div className="calc-stat calc-stat--bad">
          <span className="calc-stat-label">Быстрых отказов</span>
          <span className="calc-stat-num">{fmt(aRejections)}</span>
        </div>
        <div className="calc-stat calc-stat--neutral">
          <span className="calc-stat-label">Ждут ответа</span>
          <span className="calc-stat-num">{fmt(aPending)}</span>
        </div>
      </div>

      {/* --- Графики посуточной динамики --- */}
      <div className="calc-chart">
        <div className="calc-chart-head">
          <div className="calc-chart-title">Как меняется каждый день</div>
        </div>
        <p className="calc-chart-hint">
          Поначалу может показаться, что много отказов — это дурной знак. Мы взялись за
          создание Откликс именно поэтому: нам довелось на собственных примерах
          столкнуться с теми же вызовами, какие встречаете и вы. Все наши исследования
          подтверждают, что даже лучшие специалисты с идеальным портфолио и трудовой
          книжкой ударяются об эту стену. Откликс поможет преодолеть барьер сомнений и
          отказов. Главное — не останавливаться, и это мы возьмём на себя.
        </p>

        <div className="calc-mini-charts">
          <div className="calc-mini-chart calc-mini-chart--good">
            <div className="calc-mini-chart-head">
              <span className="calc-legend-item calc-legend-item--good"><i />Приглашения / день</span>
              <span className="calc-mini-chart-trend">+{goodTrend}%</span>
            </div>
            <svg
              ref={goodSvgRef}
              className="calc-chart-svg"
              viewBox={`0 0 ${CH_W} ${MINI_H}`}
              role="img"
              aria-label="График: приглашений на собеседование в день становится больше"
              onPointerMove={onMove}
              onPointerLeave={() => setHoverDay(null)}
            >
              <defs>
                <linearGradient id="calc-grad-good" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--success)" stopOpacity="0.26" />
                  <stop offset="100%" stopColor="var(--success)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0.4, 0.8].map((g) => (
                <line key={g} className="calc-grid" x1={PAD_X.l} x2={CH_W - PAD_X.r}
                  y1={MINI_PAD_Y.t + g * MINI_PLOT_H} y2={MINI_PAD_Y.t + g * MINI_PLOT_H} />
              ))}
              <path d={GOOD_CHART.area} fill="url(#calc-grad-good)" />
              <path d={GOOD_CHART.line} className="calc-line calc-line--good" fill="none" stroke="var(--success)" />
              {tip && (
                <g className="calc-hover" style={{ transform: `translateX(${xForDay(hoverDay!)}px)` } as CSSProperties}>
                  <line className="calc-hover-line" y1={MINI_PAD_Y.t} y2={MINI_PAD_Y.t + MINI_PLOT_H} />
                  <circle cx="0" cy={GOOD_CHART.yFor(tip.interviews)} r="4" className="calc-dot--good" />
                </g>
              )}
              <g className="calc-now" style={{ transform: `translateX(${nowX}px)`, transition: 'transform 0.45s cubic-bezier(0.22,1,0.36,1)' } as CSSProperties}>
                <line className="calc-now-line" y1={MINI_PAD_Y.t} y2={MINI_PAD_Y.t + MINI_PLOT_H} />
                <circle className="calc-dot calc-dot--good calc-dot--now" cx="0" r="5" style={{ cy: GOOD_CHART.yFor(current.interviews) } as CSSProperties} />
                {/* Подпись едет вместе с точкой «сейчас» (локальный x=12 внутри уже
                    сдвинутой группы), а не висит фиксированно у дня 30 — раньше
                    показывала значение LAST (день 30) всегда, не реагируя на ползунок. */}
                <text className="calc-endlabel calc-endlabel--good" x={12} y={GOOD_CHART.yFor(current.interviews) + 4}>
                  {current.interviews}/день
                </text>
              </g>
            </svg>
          </div>

          <div className="calc-mini-chart calc-mini-chart--bad">
            <div className="calc-mini-chart-head">
              <span className="calc-legend-item calc-legend-item--bad"><i />Отказы / день</span>
              <span className="calc-mini-chart-trend">{badTrend}%</span>
            </div>
            <svg
              className="calc-chart-svg"
              viewBox={`0 0 ${CH_W} ${MINI_H}`}
              role="img"
              aria-label="График: быстрых отказов в день становится меньше"
              onPointerMove={onMove}
              onPointerLeave={() => setHoverDay(null)}
            >
              <defs>
                <linearGradient id="calc-grad-bad-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--danger)" stopOpacity="0.16" />
                  <stop offset="100%" stopColor="var(--danger)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0.4, 0.8].map((g) => (
                <line key={g} className="calc-grid" x1={PAD_X.l} x2={CH_W - PAD_X.r}
                  y1={MINI_PAD_Y.t + g * MINI_PLOT_H} y2={MINI_PAD_Y.t + g * MINI_PLOT_H} />
              ))}
              <path d={BAD_CHART.area} fill="url(#calc-grad-bad-fill)" />
              <path d={BAD_CHART.line} className="calc-line calc-line--bad" fill="none" stroke="var(--danger)" />
              {tip && (
                <g className="calc-hover" style={{ transform: `translateX(${xForDay(hoverDay!)}px)` } as CSSProperties}>
                  <line className="calc-hover-line" y1={MINI_PAD_Y.t} y2={MINI_PAD_Y.t + MINI_PLOT_H} />
                  <circle cx="0" cy={BAD_CHART.yFor(tip.rejections)} r="4" className="calc-dot--bad" />
                </g>
              )}
              <g className="calc-now" style={{ transform: `translateX(${nowX}px)`, transition: 'transform 0.45s cubic-bezier(0.22,1,0.36,1)' } as CSSProperties}>
                <line className="calc-now-line" y1={MINI_PAD_Y.t} y2={MINI_PAD_Y.t + MINI_PLOT_H} />
                <circle className="calc-dot calc-dot--bad calc-dot--now" cx="0" r="5" style={{ cy: BAD_CHART.yFor(current.rejections) } as CSSProperties} />
                <text className="calc-endlabel calc-endlabel--bad" x={12} y={BAD_CHART.yFor(current.rejections) + 4}>
                  {current.rejections}/день
                </text>
              </g>
            </svg>
          </div>

          {tip && (
            <div className="calc-tip" style={{ left: `${tipLeftPct}%` }}>
              <div className="calc-tip-day">День {hoverDay}</div>
              <div className="calc-tip-row calc-tip-row--good"><i />{tip.interviews} {plural(tip.interviews, 'приглашение', 'приглашения', 'приглашений')}</div>
              <div className="calc-tip-row calc-tip-row--bad"><i />{tip.rejections} {plural(tip.rejections, 'отказ', 'отказа', 'отказов')}</div>
            </div>
          )}
        </div>
      </div>

      {/* Раньше жалась в узкую левую колонку после плиток (grid авто-размещал её
          туда же, в column:1) — при том что справа, рядом с графиком, оставалось
          много пустого места. Теперь — последним элементом на всю ширину блока
          (см. .calc-stats-hint в globals.css, grid-column:1/-1). */}
      <p className="calc-stats-hint">
        Больше всего откликов «ждут ответа» — и это нормально: чаще всего работодатель уже
        нашёл кандидата и просто не закрыл оставшиеся диалоги на hh.ru, а вовсе не
        игнорирует именно вас. А рост приглашений на собеседования со временем объясняется
        тем, что часть работодателей разбирает отклики с опозданием — чем дольше работает
        автопилот, тем выше вероятность попасть в число приглашённых.
      </p>
    </div>
  );
}
