'use client';

// Фон «потоки»: длинные плавные линии с растворяющимися концами, квадратики-узлы на них
// и парящие рядом, и изредка — светящаяся точка, которая пробегает по линии и по пути
// зажигает узлы, как домино. Стиль — как на референсной иллюстрации: воздух, бирюза,
// тонкие кривые.
//
// Главное правило — НИКОГДА не заходить на контент. Один раз (после загрузки, при смене
// размеров или заметном изменении высоты страницы) собираем геометрию всего, что
// считается содержимым: строки текста, картинки, кнопки, ссылки, карточки и любые
// элементы со своим фоном, рамкой или тенью. Раскладываем это в сетку занятости по
// всей странице с запасом вокруг и прокладываем кривые только по свободным клеткам —
// каждую проверяем по всей длине. Блоки с плавным появлением (.reveal), которые ещё не
// выехали, резервируются на своём будущем месте.
//
// Ничего не сдвигается: слой абсолютный и вне потока. Нагрузка: линии и квадратики
// статичны, «прорисовка» — один раз, точка едет CSS-анимацией по offset-path; карта
// занятости строится в простое браузера. Выключено уже 1024px, в кабинете и админке.
// При prefers-reduced-motion линии просто стоят нарисованными, без движения.

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const CELL = 16;            // шаг сетки занятости, px
const MARGIN = 30;          // свободное поле вокруг контента, px
const SPACING = 90;         // минимум между двумя линиями, px
const MAX_CURVES = 18;
const TRIES = 2600;         // только арифметика по сетке — быстро
const PULSE_MIN_MS = 2400;
const PULSE_MAX_MS = 4600;
// Россыпь квадратиков: страница делится на участки, и в каждом свободном ставится один
// квадратик — так заполняются и узкие полосы (под шапкой, слева от текста), а не только
// большие пустоты. SQ_SKIP — доля участков, которые нарочно оставляем пустыми, чтобы
// это осталось россыпью, а не обоями.
const SQ_TILE = 160;
const SQ_SKIP = 0.42;
const SQ_GAP = 100;
// Потолок — от высоты страницы, а не фиксированный: при общем лимите раскладка сверху
// вниз успевала израсходовать его до низа, и внизу (например, слева от финального
// блока) квадратиков не оставалось вовсе.
const SQ_PER_1000 = 24;
const SQ_MAX_ABS = 340;

const CONTENT = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'button', 'img', 'svg', 'picture', 'video',
  'canvas', 'iframe', 'input', 'textarea', 'select', 'label', 'li', 'dt', 'dd', 'figure',
  'blockquote', 'table', 'pre', 'code', 'form', 'nav', 'header', 'footer', 'summary', 'details',
  '[role="button"]', '.card', '.btn', '.eyebrow', '.tag', '.consultant',
].join(',');
// Фон страницы — сами секции и обёртки страницы, их не помечаем (внутрь спускаемся).
const LAYOUT = new Set(['HTML', 'BODY', 'MAIN', 'SECTION']);
// Невидимое вовсе — не заходим.
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META']);

type Pt = { x: number; y: number };
type Grid = { w: number; h: number; cells: Uint8Array; docW: number; docH: number };
type Curve = {
  kind: 'wave' | 'ripple' | 'sweep' | 'vertical';
  ctrl: Pt[];               // опорные точки волны — через них идёт гладкая кривая
  samples: Pt[];            // плотная выборка по кривой — для проверки и узлов
  cum: number[];            // накопленная длина по выборке — для долей пути
  twin: number;             // сдвиг второй, бледной «нити» по вертикали; 0 — без неё
  tone: 'teal' | 'soft';
};

// ——— карта занятости ———

function transparent(color: string) {
  return !color || color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color.replace(/\s+/g, ' '));
}

function isSurface(cs: CSSStyleDeclaration) {
  if (!transparent(cs.backgroundColor) || cs.backgroundImage !== 'none') return true;
  if (cs.boxShadow !== 'none') return true;
  return ['top', 'right', 'bottom', 'left'].some(
    (s) => parseFloat(cs.getPropertyValue(`border-${s}-width`)) > 0
      && !transparent(cs.getPropertyValue(`border-${s}-color`)),
  );
}

function buildGrid(layer: Element): Grid {
  const sx = window.scrollX;
  const sy = window.scrollY;
  const docW = document.documentElement.clientWidth;
  const docH = document.documentElement.scrollHeight;
  const w = Math.ceil(docW / CELL);
  const h = Math.ceil(docH / CELL);
  const cells = new Uint8Array(w * h);

  const mark = (r: DOMRect, lift: number, pad = MARGIN) => {
    if (!r.width || !r.height) return;
    const x0 = Math.max(0, Math.floor((r.left + sx - pad) / CELL));
    const x1 = Math.min(w - 1, Math.floor((r.right + sx + pad) / CELL));
    const y0 = Math.max(0, Math.floor((r.top + sy - lift - pad) / CELL));
    const y1 = Math.min(h - 1, Math.floor((r.bottom + sy + pad) / CELL));
    for (let y = y0; y <= y1; y++) cells.fill(1, y * w + x0, y * w + x1 + 1);
  };
  // Ещё не выехавший .reveal стоит на 24px ниже своего места — резервируем и его будущее.
  const liftOf = (el: Element | null) => (el && el.closest('.reveal:not(.in)') ? 32 : 0);

  // Один проход по дереву. Элемент-содержимое (абзац, кнопка, карточка…) помечаем
  // целиком и внутрь не спускаемся — всё внутри лежит в его же прямоугольнике (мелкие
  // вылеты вроде ярлыка над карточкой покрывает запас MARGIN). Стили считаем только у
  // остальных — контейнеров и обёрток: это «плашка» со своим фоном или рамкой? Текст,
  // лежащий прямо в обёртках, помечаем точными прямоугольниками строк. Раньше каждый
  // элемент страницы проходил через getComputedStyle, и раскладка шла куском ~300 мс.
  // Свёрнутые <details> (вопросы-ответы): ответ под вопросом развернётся вниз, и
  // весь список подрастёт на его высоту. Резервируем место под ВСЕ ответы сразу:
  // считаем, насколько может вырасти каждый родитель таких блоков.
  const growth = new Map<Element, number>();
  const range = document.createRange();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const el = node as Element;
      if (el === layer || SKIP.has(el.tagName)) return NodeFilter.FILTER_REJECT;
      if (LAYOUT.has(el.tagName)) return NodeFilter.FILTER_SKIP;
      if (el.matches(CONTENT)) {
        // Шапка липкая и полупрозрачная: всё, что под ней, она собой закрывает —
        // большое поле вокруг неё только съедало бы свободную полосу сверху страницы.
        mark(el.getBoundingClientRect(), liftOf(el), el.classList.contains('topbar') ? 12 : MARGIN);
        if (el.tagName === 'DETAILS' && !(el as HTMLDetailsElement).open && el.parentElement) {
          let extra = 0;
          for (const child of Array.from(el.children)) {
            if (child.tagName !== 'SUMMARY') extra += child.getBoundingClientRect().height;
          }
          growth.set(el.parentElement, (growth.get(el.parentElement) || 0) + extra);
        }
        return NodeFilter.FILTER_REJECT;
      }
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return NodeFilter.FILTER_REJECT;
      if (cs.visibility !== 'hidden' && isSurface(cs)) mark(el.getBoundingClientRect(), liftOf(el));
      return NodeFilter.FILTER_SKIP;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent || !n.textContent.trim()) continue;
    range.selectNodeContents(n);
    const lift = liftOf(n.parentElement);
    for (const r of Array.from(range.getClientRects())) mark(r, lift);
  }
  growth.forEach((extra, parent) => {
    const r = parent.getBoundingClientRect();
    mark(new DOMRect(r.left, r.top, r.width, r.height + extra), 0);
  });
  return { w, h, cells, docW, docH };
}

const freeAt = (g: Grid, used: Uint8Array, p: Pt) => {
  if (p.x < 0 || p.y < 0 || p.x >= g.docW || p.y >= g.docH) return false;
  const i = Math.floor(p.y / CELL) * g.w + Math.floor(p.x / CELL);
  return g.cells[i] === 0 && used[i] === 0;
};

// ——— кривые ———
//
// Линия — это всегда волна: гладкая кривая через опорные точки (Catmull-Rom → кубические
// Безье). Одиночная дуга с маленьким размахом на полутора тысячах пикселей выглядела
// почти прямой — владельцу нравятся именно волнистые, поэтому прямые отсеиваются.

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// Горизонтальная волна: несколько колебаний, к концам размах плавно затухает.
function waveCtrl(g: Grid, seed: Pt): Pt[] {
  const len = rnd(620, 1750);
  const amp = rnd(24, 52);
  const wl = rnd(340, 620);
  const x0 = Math.max(-90, seed.x - rnd(0, len * 0.7));
  const y0 = seed.y;
  const tilt = rnd(-0.07, 0.07);
  const phase = rnd(0, Math.PI * 2);
  const step = wl / 4;
  const pts: Pt[] = [];
  for (let x = 0; x <= len + 0.1; x += step) {
    const env = Math.sin(Math.PI * Math.min(1, x / len)) ** 0.6; // затухание к концам
    pts.push({ x: x0 + x, y: y0 + tilt * x + amp * env * Math.sin((2 * Math.PI * x) / wl + phase) });
  }
  return pts;
}

// «Рябь» — тугая волна с малым размахом: влезает в узкие полосы (например, под шапкой),
// и при короткой длине волны всё равно читается волнистой, а не прямой.
function rippleCtrl(g: Grid, seed: Pt): Pt[] {
  const len = rnd(420, 1100);
  const amp = rnd(13, 21);
  const wl = rnd(170, 290);
  const x0 = Math.max(-60, seed.x - rnd(0, len * 0.6));
  const y0 = seed.y;
  const phase = rnd(0, Math.PI * 2);
  const pts: Pt[] = [];
  for (let x = 0; x <= len + 0.1; x += wl / 4) {
    const env = Math.sin(Math.PI * Math.min(1, x / len)) ** 0.6;
    pts.push({ x: x0 + x, y: y0 + amp * env * Math.sin((2 * Math.PI * x) / wl + phase) });
  }
  return pts;
}

// Намеренная линия первого экрана: начинается под шапкой чуть выше бейджа
// «AI-автопилот соискателя для hh.ru» и плавно уходит вниз-вправо за край экрана. Единственная
// линия, которую ставим вручную, а не случайным перебором, — у неё осмысленное начало,
// и она всегда двойная. Всё остальное — те же проверки свободного места.
function heroCurve(g: Grid, headerBottom: number): Curve | null {
  const badge = document.querySelector('.hero .eyebrow');
  if (!badge) return null;
  const r = badge.getBoundingClientRect();
  const startX = r.left + window.scrollX - 24;
  const endX = g.docW + 40;
  if (endX - startX < 420) return null;
  const top = headerBottom + window.scrollY;
  const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  for (let i = 0; i < 60; i++) {
    // Волна идёт по полосе под шапкой (над бейджем), а ближе к правому краю плавно
    // уходит вниз — по диагонали через весь экран она упиралась бы в заголовок.
    const bandY = top + rnd(24, 40);
    const endY = bandY + rnd(220, 520);
    const turn = startX + (endX - startX) * rnd(0.5, 0.8);
    const amp = rnd(11, 19);
    const wl = rnd(280, 460);
    const phase = rnd(0, Math.PI * 2);
    const len = endX - startX;
    const ctrl: Pt[] = [];
    for (let x = 0; x <= len + 0.1; x += wl / 4) {
      const px = startX + x;
      const drop = (endY - bandY) * smooth((px - turn) / (endX - turn));
      const env = Math.sin(Math.PI * Math.min(1, x / len)) ** 0.5;
      ctrl.push({ x: px, y: bandY + drop + amp * env * Math.sin((2 * Math.PI * x) / wl + phase) });
    }
    const { samples, cum } = sampleCurve(ctrl);
    if (waviness(samples) < 14) continue;
    const c: Curve = { kind: 'wave', ctrl, samples, cum, twin: 13, tone: 'teal' };
    if (fits(g, new Uint8Array(g.w * g.h), c)) return c;
  }
  return null;
}

// Крупная S-дуга, как на референсе — для больших свободных мест.
function sweepCtrl(g: Grid, seed: Pt): Pt[] {
  const len = rnd(420, 1000);
  const x0 = Math.max(-60, seed.x - rnd(0, len * 0.6));
  const y0 = seed.y;
  const rise = rnd(-240, 240);
  const bulge = rnd(90, 190) * (Math.random() < 0.5 ? -1 : 1);
  return [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    x: x0 + len * t,
    y: y0 + rise * t + bulge * Math.sin(Math.PI * 2 * t),
  }));
}

// Вертикальная волна — вьётся по боковым полям широких экранов.
function verticalCtrl(g: Grid, seed: Pt): Pt[] {
  const len = rnd(420, 950);
  const amp = rnd(24, 72);
  const wl = rnd(360, 700);
  const x0 = seed.x;
  const y0 = Math.max(80, seed.y - rnd(0, len * 0.6));
  const phase = rnd(0, Math.PI * 2);
  const pts: Pt[] = [];
  for (let y = 0; y <= len + 0.1; y += wl / 4) {
    const env = Math.sin(Math.PI * Math.min(1, y / len)) ** 0.6;
    pts.push({ x: x0 + amp * env * Math.sin((2 * Math.PI * y) / wl + phase), y: y0 + y });
  }
  return pts;
}

// Catmull-Rom через опорные точки → последовательность кубических сегментов.
function segments(ctrl: Pt[]): [Pt, Pt, Pt, Pt][] {
  const out: [Pt, Pt, Pt, Pt][] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[i - 1] || ctrl[i];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[i + 2] || p2;
    out.push([
      p1,
      { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p2,
    ]);
  }
  return out;
}

function bezier([a, b, c, d]: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}

function sampleCurve(ctrl: Pt[]) {
  const samples: Pt[] = [];
  for (const seg of segments(ctrl)) {
    for (let k = samples.length ? 1 : 0; k <= 12; k++) samples.push(bezier(seg, k / 12));
  }
  const cum = [0];
  for (let i = 1; i < samples.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
  }
  return { samples, cum };
}

// Насколько линия отходит от прямой между концами — отсев «почти прямых».
function waviness(samples: Pt[]) {
  const a = samples[0];
  const b = samples[samples.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let best = 0;
  for (const p of samples) best = Math.max(best, Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len);
  return best;
}

// Свободные клетки с запасом вокруг — из них берём начало линии. Случайная точка по
// всей странице почти никогда не попадала в узкие полосы (под шапкой, слева от текста),
// и там фон оставался пустым.
function seeds(g: Grid): Pt[] {
  const out: Pt[] = [];
  for (let cy = 2; cy < g.h - 2; cy++) {
    for (let cx = 1; cx < g.w - 1; cx++) {
      const i = cy * g.w + cx;
      if (g.cells[i]) continue;
      if (g.cells[i - 1] || g.cells[i + 1] || g.cells[i - g.w] || g.cells[i + g.w]) continue;
      out.push({ x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });
    }
  }
  return out;
}

function candidate(g: Grid, seed: Pt): Curve | null {
  const kind = Math.random();
  // Больше вертикальных: именно они живут в узких колонках слева от текста и по краям.
  const name: Curve['kind'] = kind < 0.4 ? 'wave' : kind < 0.55 ? 'ripple' : kind < 0.68 ? 'sweep' : 'vertical';
  const ctrl = name === 'wave' ? waveCtrl(g, seed)
    : name === 'ripple' ? rippleCtrl(g, seed)
      : name === 'sweep' ? sweepCtrl(g, seed)
        : verticalCtrl(g, seed);
  const { samples, cum } = sampleCurve(ctrl);
  // У «ряби» размах маленький по замыслу — с неё спрос меньше, у остальных строже.
  if (waviness(samples) < (name === 'ripple' ? 11 : 22)) return null;
  const horizontal = name !== 'vertical';
  return {
    kind: name,
    ctrl, samples, cum,
    twin: horizontal && Math.random() < 0.35 ? rnd(11, 15) * (Math.random() < 0.5 ? -1 : 1) : 0,
    tone: Math.random() < 0.65 ? 'teal' : 'soft',
  };
}

const freeLine = (g: Grid, used: Uint8Array, samples: Pt[], dy = 0) =>
  samples.every((p) => p.x < 0 || p.x >= g.docW || freeAt(g, used, { x: p.x, y: p.y + dy }));

// Линия годится, если свободна по всей длине (выборка каждые ~8–15px) вместе со своей
// второй «нитью», если она есть; концы разрешено уводить за край экрана.
function fits(g: Grid, used: Uint8Array, c: Curve) {
  if (c.cum[c.cum.length - 1] < 360) return false;
  return freeLine(g, used, c.samples) && (!c.twin || freeLine(g, used, c.samples, c.twin));
}

function reserve(g: Grid, used: Uint8Array, pts: Pt[], radius: number) {
  const r = Math.ceil(radius / CELL);
  for (const p of pts) {
    const cx = Math.floor(p.x / CELL);
    const cy = Math.floor(p.y / CELL);
    for (let y = cy - r; y <= cy + r; y++) {
      if (y < 0 || y >= g.h) continue;
      for (let x = cx - r; x <= cx + r; x++) if (x >= 0 && x < g.w) used[y * g.w + x] = 1;
    }
  }
}

function pathD(ctrl: Pt[], ox: number, oy: number, dy = 0) {
  const f = (p: Pt) => `${(p.x - ox).toFixed(1)} ${(p.y - oy + dy).toFixed(1)}`;
  const segs = segments(ctrl);
  return `M${f(segs[0][0])}` + segs.map(([, b, c, d]) => `C${f(b)} ${f(c)} ${f(d)}`).join('');
}

// ——— россыпь квадратиков ———

type Sq = { x: number; y: number; size: number; rot: number; tone: string; drift: number; live: boolean };

function scatter(g: Grid, lines: Uint8Array): Sq[] {
  const out: Sq[] = [];
  const SQ_MAX = Math.min(SQ_MAX_ABS, Math.round((g.docH / 1000) * SQ_PER_1000));
  const cols = Math.ceil(g.docW / SQ_TILE);
  const rows = Math.ceil(g.docH / SQ_TILE);
  const angles = [0, 12, -14, 22, -26, 45, 33, -38];
  for (let ty = 0; ty < rows && out.length < SQ_MAX; ty++) {
    for (let tx = 0; tx < cols && out.length < SQ_MAX; tx++) {
      if (Math.random() < SQ_SKIP) continue;
      for (let attempt = 0; attempt < 7; attempt++) {
        // Размеры: чаще мелкие, реже средние и крупные. Меньше 10px квадратик читается
        // как пылинка, а не как деталь, — такие остаются только яркими акцентами.
        const r = Math.random();
        const size = r < 0.12 ? rnd(7, 9) : r < 0.5 ? rnd(10, 14) : r < 0.85 ? rnd(15, 21) : rnd(22, 32);
        const x = rnd(tx * SQ_TILE, (tx + 1) * SQ_TILE);
        const y = rnd(ty * SQ_TILE, (ty + 1) * SQ_TILE);
        if (y < 84 || y > g.docH - 40) break;
        // Повёрнутый квадрат занимает до size·√2 — с запасом на покачивание.
        const half = size * 0.72 + 8;
        const probe = [[0, 0], [-half, -half], [half, -half], [-half, half], [half, half]];
        const free = probe.every(([dx, dy]) => {
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= g.docW || py >= g.docH) return false;
          const k = Math.floor(py / CELL) * g.w + Math.floor(px / CELL);
          return g.cells[k] === 0 && lines[k] === 0;
        });
        if (!free) continue;
        if (out.some((q) => Math.hypot(q.x - x, q.y - y) < SQ_GAP)) continue;
        const t = Math.random();
        const tone = size < 10 ? 'dot' : t < 0.5 ? 'mint' : t < 0.78 ? 'light' : 'lav';
        out.push({
          x, y, size, rot: angles[Math.floor(Math.random() * angles.length)] + rnd(-4, 4), tone, drift: rnd(10, 18),
          // Покачиваются немногие — каждый восьмой и не мельче 12px; остальные стоят.
          live: size >= 12 && Math.random() < 0.13,
        });
        break;
      }
    }
  }
  return out;
}

// Неподвижные квадратики полосы — одной SVG-картинкой в фоне полосы. Браузер
// растеризует её один раз и дальше просто копирует; сотня отдельных элементов (да ещё
// со своими слоями) замером обходилась в ~2.8 с работы основного потока за 15 с даже
// без анимации — плавный скролл сайта перерисовывает кадры постоянно. Цвета в картинку
// подставляются готовыми: CSS-переменные внутри data-URI не работают.
function bandImage(list: Sq[], top: number, width: number, teal: string) {
  const lav = '#c3bfe6';
  const fill: Record<string, string> = {
    mint: 'url(#m)', light: teal, lav: 'url(#l)', dot: teal,
  };
  const alpha: Record<string, string> = { mint: '1', light: '0.15', lav: '1', dot: '0.58' };
  const rects = list.map((q) => {
    const x = q.x;
    const y = q.y - top;
    const h = q.size / 2;
    return `<rect x="${(x - h).toFixed(1)}" y="${(y - h).toFixed(1)}" width="${q.size.toFixed(1)}" height="${q.size.toFixed(1)}" rx="${(q.size * 0.28).toFixed(1)}" fill="${fill[q.tone]}" fill-opacity="${alpha[q.tone]}" transform="rotate(${q.rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BAND}"><defs>`
    + `<linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${teal}" stop-opacity=".38"/><stop offset="1" stop-color="${teal}" stop-opacity=".2"/></linearGradient>`
    + `<linearGradient id="l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lav}" stop-opacity=".6"/><stop offset="1" stop-color="${lav}" stop-opacity=".32"/></linearGradient>`
    + `</defs>${rects}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// ——— компонент ———

let uid = 0;
const BAND = 1000; // квадратики живут в полосах по высоте — видимость следим по полосам

export function AmbientFlow() {
  const pathname = usePathname();
  const layerRef = useRef<HTMLDivElement>(null);
  const enabled = !(pathname?.startsWith('/app') || pathname?.startsWith('/admin'));

  useEffect(() => {
    const layer = layerRef.current;
    if (!enabled || !layer) return undefined;
    const wide = window.matchMedia('(min-width: 1024px)');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let io: IntersectionObserver | null = null;
    const visible = new Set<HTMLElement>();
    let pulseTimer: ReturnType<typeof setTimeout> | undefined;
    let buildTimer: ReturnType<typeof setTimeout> | undefined;
    let lastH = 0;
    let lastW = 0;

    // Слой по высоте равен странице и обрезает всё, что вылезает за её края (концы
    // линий нарочно уходят за край экрана) — иначе появилась бы прокрутка вбок. Перед
    // замером высоту сбрасываем: иначе старая высота слоя сама растягивала бы страницу.
    const clear = () => {
      io?.disconnect();
      visible.clear();
      layer.replaceChildren();
      layer.style.height = '0px';
    };

    const renderCurve = (c: Curve) => {
      const all = c.twin ? [...c.samples, ...c.samples.map((p) => ({ x: p.x, y: p.y + c.twin }))] : c.samples;
      const xs = all.map((p) => p.x);
      const ys = all.map((p) => p.y);
      const pad = 24;
      const ox = Math.min(...xs) - pad;
      const oy = Math.min(...ys) - pad;
      const bw = Math.max(...xs) - ox + pad;
      const bh = Math.max(...ys) - oy + pad;
      const d = pathD(c.ctrl, ox, oy);
      const a = c.samples[0];
      const b = c.samples[c.samples.length - 1];
      const id = `af-g${uid++}`;

      const wrap = document.createElement('div');
      wrap.className = `af-curve af-curve--${c.tone}`;
      wrap.dataset.kind = c.kind;
      wrap.style.left = `${ox}px`;
      wrap.style.top = `${oy}px`;
      wrap.style.width = `${bw}px`;
      wrap.style.height = `${bh}px`;
      // Градиент вдоль линии: концы растворяются, середина — цветная.
      wrap.innerHTML = `<svg width="${bw}" height="${bh}" viewBox="0 0 ${bw} ${bh}" aria-hidden="true">
        <defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${(a.x - ox).toFixed(1)}" y1="${(a.y - oy).toFixed(1)}" x2="${(b.x - ox).toFixed(1)}" y2="${(b.y - oy).toFixed(1)}">
          <stop offset="0" class="af-stop" stop-opacity="0"/>
          <stop offset="0.18" class="af-stop"/>
          <stop offset="0.82" class="af-stop"/>
          <stop offset="1" class="af-stop" stop-opacity="0"/>
        </linearGradient></defs>
        ${c.twin ? `<path class="af-twin" d="${pathD(c.ctrl, ox, oy, c.twin)}" stroke="url(#${id})"/>` : ''}
        <path class="af-main" d="${d}" stroke="url(#${id})"/>
      </svg>`;
      layer.appendChild(wrap);
      wrap.querySelectorAll('path').forEach((pth) => {
        (pth as SVGPathElement).style.setProperty('--len', `${Math.ceil((pth as SVGPathElement).getTotalLength())}`);
      });
      const main = wrap.querySelector('.af-main') as SVGPathElement;
      wrap.dataset.len = String(Math.ceil(main.getTotalLength()));

      // Узлы на линии — там, где их видно: не у растворяющихся концов.
      const total = c.cum[c.cum.length - 1];
      for (const share of [0.28, 0.5, 0.72].map((v) => v + rnd(-0.05, 0.05))) {
        const i = c.cum.findIndex((v) => v >= share * total);
        const p = c.samples[Math.max(0, i)];
        if (p.x < 8 || p.x > document.documentElement.clientWidth - 8) continue;
        const el = document.createElement('span');
        el.className = 'af-node';
        el.style.left = `${p.x - ox}px`;
        el.style.top = `${p.y - oy}px`;
        el.style.setProperty('--share', share.toFixed(3));
        wrap.appendChild(el);
      }
      return wrap;
    };

    const build = () => {
      clear();
      if (!wide.matches) return;
      lastH = document.documentElement.scrollHeight;
      lastW = document.documentElement.clientWidth;
      const g = buildGrid(layer);
      layer.style.height = `${g.docH}px`;
      layer.classList.remove('is-rebuilding');

      // Сначала собираем подходящие волны, потом берём самые длинные — с зазором.
      const pool: Curve[] = [];
      const none = new Uint8Array(g.w * g.h);
      const spots = seeds(g);
      for (let i = 0; i < TRIES && spots.length; i++) {
        const c = candidate(g, spots[Math.floor(Math.random() * spots.length)]);
        if (c && fits(g, none, c)) pool.push(c);
      }
      // Отбор по видам, а не «самые длинные вообще»: горизонтальные всегда длиннее
      // вертикальных, и при общем списке вертикальные в набор не попадали совсем.
      const len = (c: Curve) => c.cum[c.cum.length - 1];
      const byKind = new Map<Curve['kind'], Curve[]>();
      for (const c of pool) {
        if (!byKind.has(c.kind)) byKind.set(c.kind, []);
        byKind.get(c.kind)!.push(c);
      }
      byKind.forEach((list) => list.sort((a, b) => len(b) - len(a)));
      const quota: [Curve['kind'], number][] = [
        ['wave', Math.round(MAX_CURVES * 0.34)],
        ['vertical', Math.round(MAX_CURVES * 0.34)],
        ['ripple', Math.round(MAX_CURVES * 0.18)],
        ['sweep', Math.round(MAX_CURVES * 0.14)],
      ];
      const used = new Uint8Array(g.w * g.h);
      const lines = new Uint8Array(g.w * g.h);   // рядом с линиями квадратики не садим
      const curves: Curve[] = [];
      const take = (c: Curve) => {
        if (!fits(g, used, c)) return false;
        curves.push(c);
        reserve(g, used, c.samples, SPACING);
        reserve(g, lines, c.samples, 26);
        if (c.twin) reserve(g, lines, c.samples.map((p) => ({ x: p.x, y: p.y + c.twin })), 26);
        return true;
      };
      const headerBottom = Math.max(0, ...Array.from(document.querySelectorAll('.topbar'))
        .map((el) => el.getBoundingClientRect().bottom));
      const hero = heroCurve(g, headerBottom);
      if (hero) take(hero);
      // Случайным линиям к шапке подходить нельзя: липкая полупрозрачная шапка режет
      // такую линию по краю, и выглядит это так, будто линия входит в кнопку и выходит
      // из неё. Квадратикам эта полоса по-прежнему доступна — они мелкие и не тянутся.
      const ban = Math.floor((headerBottom + window.scrollY + 34) / CELL);
      for (let y = 0; y <= Math.min(g.h - 1, ban); y++) used.fill(1, y * g.w, (y + 1) * g.w);

      for (const [kind, n] of quota) {
        let got = 0;
        for (const c of byKind.get(kind) || []) {
          if (got >= n || curves.length >= MAX_CURVES) break;
          if (take(c)) got++;
        }
      }
      // Если какой-то вид не набрался (мало места), добираем остальными.
      for (const c of pool) {
        if (curves.length >= MAX_CURVES) break;
        if (!curves.includes(c)) take(c);
      }

      const observer = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          // is-visible — чтобы то, что вне экрана, не качалось впустую (CSS ставит
          // анимацию на паузу).
          el.classList.toggle('is-visible', e.isIntersecting);
          if (e.isIntersecting) el.classList.add('is-seen');
          if (!el.classList.contains('af-curve')) continue;
          if (e.isIntersecting) {
            visible.add(el);
            el.classList.add('is-drawn');
          } else {
            visible.delete(el);
          }
        }
      }, { threshold: 0 });
      io = observer;

      // Россыпь квадратиков — первой, чтобы линии лежали поверх неё. Неподвижные —
      // картинкой в фоне полосы, живые — отдельными элементами поверх.
      const squares = scatter(g, lines);
      const teal = getComputedStyle(document.documentElement).getPropertyValue('--teal').trim() || '#12edcf';
      const bands = new Map<number, HTMLDivElement>();
      const byBand = new Map<number, Sq[]>();
      for (const q of squares) {
        const bi = Math.floor(q.y / BAND);
        if (!byBand.has(bi)) byBand.set(bi, []);
        byBand.get(bi)!.push(q);
      }
      byBand.forEach((list, bi) => {
        const band = document.createElement('div');
        band.className = 'af-band';
        band.style.top = `${bi * BAND}px`;
        band.style.height = `${BAND}px`;
        const statics = list.filter((q) => !q.live);
        if (statics.length) {
          band.style.backgroundImage = bandImage(statics, bi * BAND, g.docW, teal);
          band.style.backgroundSize = `${g.docW}px ${BAND}px`;
        }
        bands.set(bi, band);
        layer.appendChild(band);
        observer.observe(band);
      });
      for (const q of squares.filter((sq) => sq.live)) {
        const bi = Math.floor(q.y / BAND);
        const band = bands.get(bi)!;
        // Два слоя: внешний стоит неподвижно и задаёт поворот, внутренний качается.
        // Если угол подставлять переменной прямо в ключевые кадры, Chrome не отдаёт
        // такую анимацию компоновщику и пересчитывает каждый квадратик каждый кадр —
        // замер показал ~3.6 с работы основного потока за 20 с.
        const el = document.createElement('span');
        el.className = `af-sq af-sq--${q.tone}`;
        el.style.left = `${q.x}px`;
        el.style.top = `${q.y - bi * BAND}px`;
        el.style.width = `${q.size.toFixed(1)}px`;
        el.style.height = `${q.size.toFixed(1)}px`;
        el.style.transform = `translate(-50%, -50%) rotate(${q.rot.toFixed(1)}deg)`;
        const inner = document.createElement('i');
        inner.style.animationDuration = `${q.drift.toFixed(1)}s`;
        inner.style.animationDelay = `${-rnd(0, q.drift).toFixed(2)}s`;
        el.appendChild(inner);
        band.appendChild(el);
      }

      for (const c of curves) {
        const wrap = renderCurve(c);
        observer.observe(wrap);
        if (still) wrap.classList.add('is-drawn', 'is-still');
      }
      if (still) layer.classList.add('is-still');
    };

    // Точка пробегает по одной из видимых линий; узлы вспыхивают, когда она до них доезжает.
    const pulse = () => {
      pulseTimer = setTimeout(pulse, rnd(PULSE_MIN_MS, PULSE_MAX_MS));
      if (still || document.hidden || !visible.size) return;
      const list = Array.from(visible).filter((w) => w.classList.contains('is-drawn'));
      if (!list.length) return;
      const wrap = list[Math.floor(Math.random() * list.length)];
      const len = Number(wrap.dataset.len) || 600;
      const dur = Math.max(1700, Math.min(3800, len * 2.6));
      wrap.querySelector('.af-pulse')?.remove();
      const dot = document.createElement('span');
      dot.className = 'af-pulse';
      wrap.appendChild(dot);
      // Точка едет по точкам, снятым с самой кривой, анимацией transform/opacity — её
      // крутит компоновщик (offset-path считался на основном потоке каждый кадр).
      const path = wrap.querySelector('.af-main') as SVGPathElement;
      const total = path.getTotalLength();
      const n = Math.max(24, Math.round(total / 40));
      const frames: Keyframe[] = [];
      for (let i = 0; i <= n; i++) {
        const q = path.getPointAtLength((total * i) / n);
        frames.push({
          transform: `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px)`,
          opacity: Math.min(1, i / (n * 0.1), (n - i) / (n * 0.1)),
          offset: i / n,
        });
      }
      dot.animate(frames, { duration: dur, easing: 'linear', fill: 'both' })
        .finished.then(() => dot.remove(), () => dot.remove());
      wrap.querySelectorAll<HTMLElement>('.af-node').forEach((nd) => {
        nd.classList.remove('is-flash');
        void nd.offsetWidth; // перезапуск анимации вспышки
        nd.style.setProperty('--flash-delay', `${Math.round(dur * Number(nd.style.getPropertyValue('--share')))}ms`);
        nd.classList.add('is-flash');
      });
    };

    // Раскладка строится в простое браузера после загрузки и перестраивается, если
    // поменялись размеры окна или заметно — высота страницы.
    const schedule = (delay: number) => {
      clearTimeout(buildTimer);
      buildTimer = setTimeout(() => {
        const run = () => build();
        const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
        if (ric) ric(run, { timeout: 1500 }); else run();
      }, delay);
    };
    const onResize = () => {
      if (document.documentElement.clientWidth !== lastW) schedule(450);
    };
    // Высота страницы заметно поменялась (раскрыли ответ, догрузилась картинка) —
    // контент ниже сдвинулся, а линии привязаны к странице. Слой сразу гасим, чтобы
    // ни на мгновение не оказаться поверх сдвинутого текста, и раскладываем заново.
    const ro = new ResizeObserver(() => {
      const h = document.documentElement.scrollHeight;
      if (Math.abs(h - lastH) > 24) {
        layer.classList.add('is-rebuilding');
        schedule(450);
      }
    });

    const start = () => schedule(900);
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    window.addEventListener('resize', onResize);
    ro.observe(document.body);
    pulseTimer = setTimeout(pulse, 3000);

    return () => {
      clearTimeout(pulseTimer);
      clearTimeout(buildTimer);
      window.removeEventListener('load', start);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      clear();
    };
  }, [enabled, pathname]);

  if (!enabled) return null;
  return <div ref={layerRef} className="ambient-flow" aria-hidden="true" />;
}
