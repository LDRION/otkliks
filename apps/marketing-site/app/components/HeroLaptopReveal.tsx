'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Макбук с реальными приглашениями на собеседование — с кнопкой-приглашением
// прямо на экране мокапа и полноэкранным «наездом камеры» на клик: показываем
// тот же скрин без углового искажения макета (otkliks-otkliki-i-priglasheniya-
// polnyi-ekran.webp), крупно и ровно, как будто камера выровнялась и приблизилась.
//
// Техника — FLIP (First-Last-Invert-Play): картинка сразу лежит в СВОЁМ финальном
// положении (крупно, по центру экрана, обычным CSS), а «старт с экрана макбука»
// получается через transform (сдвиг+масштаб+перекос), посчитанный в JS по
// реальным координатам экрана мокапа на момент клика. Анимируется только
// transform — ничего не пересчитывает layout на каждый кадр, поэтому плавно
// в любом браузере независимо от того, как сложно устроен переход.
type Phase = 'idle' | 'entering' | 'shown' | 'exiting';

const TARGET_MAX_WIDTH = 1100;
const TARGET_VW_RATIO = 0.88;
const IMG_ASPECT = 934 / 1629; // высота/ширина реального скрина
const ZOOM_IMG_SRC = '/images/otkliks-otkliki-i-priglasheniya-polnyi-ekran.webp';
const ZOOM_IMG_RETRY_LIMIT = 3;

// perspective(900px) rotateX(-10.7deg) в globals.css (.laptop-zoom__img) не только
// наклоняет прямоугольник — сама проекция ещё и слегка ужимает его по вертикали
// (верх и низ съезжаются к центру сильнее, чем середина), примерно на 1.3% при
// целевой высоте ~630px (см. вывод: 2·h·cosθ·d² / (d² − (h·sinθ)²) при h=315.3,
// θ=10.7°, d=900 даёт ≈622.3 вместо 630.6). Без поправки нижний край картинки
// на старте анимации не дотягивался до реального нижнего края экрана в мокапе —
// ровно то расхождение в нижних углах, которое было заметно на глаз.
const VERTICAL_FORESHORTEN_COMPENSATION = 1.0134;

// Сколько идёт обратный «наезд» (сжатие картинки к экрану макбука) — должно
// совпадать с transition у .laptop-zoom__img в globals.css, иначе DOM-узел
// уберётся раньше, чем анимация доиграет, и всё резко исчезнет на полпути.
const EXIT_SHRINK_MS = 1100;
// Финальное плавное угасание всего оверлея целиком (после того как картинка уже
// доехала обратно до макбука) — чтобы конец не был обрывом, а был затуханием.
const EXIT_FADE_MS = 300;

export function HeroLaptopReveal() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [running, setRunning] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const [flip, setFlip] = useState<{ dx: number; dy: number; sx: number; sy: number; w: number; h: number } | null>(null);
  const [zoomImgCacheBust, setZoomImgCacheBust] = useState(0);
  const screenRef = useRef<HTMLDivElement>(null);
  const zoomImgRef = useRef<HTMLImageElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomImgRetries = useRef(0);

  // Прогреваем кеш браузера этой картинкой сразу при монтировании — пользователь
  // почти наверняка кликнет на макбук уже спустя секунды-минуты после захода на
  // сайт, а не в первые же миллисекунды, так что к моменту клика файл (~58KB)
  // почти всегда уже долетит и осядет в кеше. Заметили вживую: если открыть
  // полноэкранный наезд прямо во время интенсивного скролла (резко вверх-вниз),
  // картинка иногда успевала показаться «битой» (браузер не успел её догрузить
  // к моменту клика) — без прогрева на это шансов было куда больше.
  useEffect(() => {
    const img = new window.Image();
    img.src = ZOOM_IMG_SRC;
  }, []);

  function open() {
    const el = screenRef.current;
    if (!el) return;
    const start = el.getBoundingClientRect();
    zoomImgRetries.current = 0;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const targetW = Math.min(TARGET_MAX_WIDTH, vw * TARGET_VW_RATIO);
    const targetH = targetW * IMG_ASPECT;

    const startCenterX = start.left + start.width / 2;
    const startCenterY = start.top + start.height / 2;

    setFlip({
      dx: startCenterX - vw / 2,
      dy: startCenterY - vh / 2,
      sx: start.width / targetW,
      sy: (start.height / targetH) * VERTICAL_FORESHORTEN_COMPENSATION,
      w: targetW,
      h: targetH,
    });
    setRunning(false);
    setFadingOut(false);
    setPhase('entering');
    // Пауза в два кадра: сначала браузер должен отрисовать «перекошенный старт»
    // (phase уже 'entering', но running всё ещё false), и только потом включаем
    // running — иначе браузер схлопнул бы старт и конец в один кадр без transition.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setRunning(true);
        setPhase('shown');
      });
    });
  }

  function close() {
    if (phase !== 'shown') return;
    setRunning(false);
    setPhase('exiting');
    if (exitTimer.current) clearTimeout(exitTimer.current);
    // Сначала даём картинке доехать обратно до макбука (EXIT_SHRINK_MS, как её
    // собственный transition), и только потом плавно гасим весь оверлей разом
    // (EXIT_FADE_MS) — раньше DOM-узел убирался сразу по истечении укороченного
    // таймера, картинка обрывалась на середине сжатия, а подсказка внизу вообще
    // не успевала начать гаснуть (у неё своя transition-delay) — оба резко
    // пропадали одним кадром.
    exitTimer.current = setTimeout(() => {
      setFadingOut(true);
      exitTimer.current = setTimeout(() => setPhase('idle'), EXIT_FADE_MS);
    }, EXIT_SHRINK_MS);
  }

  // Пока развёрнуто — клик куда угодно или попытка скролла (колесо/тач) закрывает
  // и возвращает страницу как было. capture:true — перехватываем ДО плавного
  // скролла (Lenis слушает те же события на document), иначе страница успела бы
  // проскроллить прежде, чем мы её остановим.
  //
  // Блокировка снимается СРАЗУ, как только начинается 'exiting' (не ждём, пока
  // доиграет обратная анимация) — специально попросили: если пользователь уже
  // начал скроллить (тем самым и закрыв оверлей), он должен продолжить катиться
  // по странице немедленно, а не упираться в блок ещё почти полторы секунды,
  // пока картинка визуально доезжает обратно до макбука. Сама обратная анимация
  // при этом никуда не торопится — она просто доигрывает по CSS в фоне, уже не
  // блокируя ничего.
  //
  // preventDefault() на wheel останавливает только нативный скролл браузера —
  // Lenis слушает те же события отдельно и крутит страницу через собственный
  // window.scrollTo(), который overflow:hidden и preventDefault() не блокируют
  // (проверено: со всем этим страница всё равно уезжала на реальную дельту
  // колеса). Единственный надёжный способ — явно поставить сам Lenis на паузу.
  useEffect(() => {
    if (phase !== 'shown') return;

    // Скрывая скролл через overflow:hidden, убираем полосу прокрутки — страница
    // резко «расширяется» на её ширину, и весь сайт (включая шапку) дёргается.
    // Компенсируем ровно этой шириной через padding-right, чтобы итоговая
    // доступная ширина не менялась ни на пиксель. Этого достаточно для контента
    // в потоке, но НЕ для position:fixed элементов с отступом от края (виджет
    // консультанта, right:20px) — у них при этом всё равно дёргается видимый
    // отступ, ведь сам край viewport физически сдвигается вместе с пропавшей
    // полосой. Кладём ту же ширину в CSS-переменную — .consultant подмешивает
    // её в свой right через calc(), у остальных fixed-элементов (во всю ширину,
    // nav-scrim/laptop-zoom) сдвиг на глаз не заметен, им переменная не нужна.
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

  // Пока едет обратный наезд, скролл уже разблокирован (см. эффект выше) — значит
  // пользователь может прокручивать страницу ПРЯМО во время сжатия картинки. Цель
  // сжатия (--zoom-dx/dy) — координаты экрана мокапа НА МОМЕНТ КЛИКА, снятые один
  // раз в open(); без пересчёта они мгновенно устаревают при любом скролле — макбук
  // на странице уезжает вместе с прокруткой, а картинка едет к СТАРОЙ, уже неверной
  // точке viewport'а и в итоге промахивается мимо реального макбука. Переизмеряем
  // экран-разметку на каждый скролл, пока идёт возврат, и обновляем координаты
  // прямо в DOM (минуя re-render — на каждый тик скролла состояние дёргать незачем).
  // CSS transition на transform сам плавно перенацеливается на новое значение —
  // никакого скачка не видно, просто цель едет вместе с макбуком.
  useEffect(() => {
    if (phase !== 'exiting') return;

    function retarget() {
      const el = screenRef.current;
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
    // hero-laptop-zone — кликабельна/наводима ВСЯ горизонтальная полоса секции на
    // высоте макбука (не только сам мокап): пусто слева от него, пусто справа —
    // тоже считается. hero-laptop-zone--pinned держит макбук в наведённом (центр
    // экрана) положении, пока открыт оверлей: сам оверлей — position:fixed поверх
    // всего, значит физически перекрывает макбук, а браузер не считает элемент
    // :hover, если он перекрыт другим — реального наведения там больше нет, хотя
    // курсор мыши не двигался. Без этого класса макбук на глазах уезжал бы обратно
    // в состояние покоя сразу же при открытии полноэкранного режима. Как только
    // оверлей исчезает, класс снимается — а :hover к этому моменту уже сам
    // восстановится (курсор ведь не двигался), поэтому макбук просто останется на
    // месте до реального ухода мыши.
    <div
      className={`hero-laptop-zone${overlayVisible ? ' hero-laptop-zone--pinned' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="Показать Откликс на весь экран"
      onClick={(e) => {
        e.stopPropagation();
        // phase==='idle' — критично: оверлей рендерится через createPortal прямо в
        // document.body, но React пробрасывает синтетические события ПО ДЕРЕВУ
        // КОМПОНЕНТОВ, а не по реальному DOM — клик по бэкдропу/картинке оверлея
        // (React-потомок этой самой зоны) всплывает СЮДА ЖЕ, в этот же onClick.
        // Без проверки открытие «переоткрывалось» в том же клике, которым только
        // что закрылось (глобальный document-слушатель уже вызвал close(), а этот
        // обработчик тут же вызывал бы open() поверх него) — оверлей не закрывался
        // вовсе, просто мгновенно перезапускался.
        if (phase === 'idle') open();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && phase === 'idle') {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="hero-laptop">
        <img
          className="hero-laptop__img"
          src="/images/otkliks-priglasheniya-na-sobesedovanie.webp"
          alt="Экран откликов на hh.ru с приглашениями на собеседование, полученными через Откликс"
          width={1414}
          height={910}
          loading="lazy"
        />
        {/* Чисто разметка «экрана» мокапа — координаты для старта анимации наезда
            (getBoundingClientRect), сама невидима и некликабельна: реальные
            hover/клик/фокус теперь на всей .hero-laptop-zone целиком (см. выше). */}
        <div ref={screenRef} className="hero-laptop__screen" aria-hidden="true" />
        {/* Подпись — просто визуальная плашка (pointer-events:none): проявляется
            при наведении на зону, см. .shot-cta в globals.css. */}
        <span className="hero-laptop__cta shot-cta">Нажмите сюда</span>

        {overlayVisible && flip && typeof document !== 'undefined' && createPortal(
          // Портал прямо в <body> — критично: пока курсор ещё над зоной (кнопка
          // внутри неё), у .hero-laptop-zone активен transform на потомке (сдвиг
          // .hero-laptop на hover), а transform на предке делает его containing
          // block для position:fixed потомков. Если оверлей лежит ВНУТРИ дерева
          // зоны, «fixed» перестаёт значить «во весь экран» и схлопывается в
          // рамки самого макбука (760px). Портал выносит оверлей из-под этого
          // предка — fixed снова считается от viewport, как и задумано.
          <div
            className={`laptop-zoom laptop-zoom--${phase}${running ? ' laptop-zoom--run' : ''}${fadingOut ? ' laptop-zoom--fading' : ''}`}
          >
            <div className="laptop-zoom__backdrop" />
            <img
              key={zoomImgCacheBust}
              ref={zoomImgRef}
              className="laptop-zoom__img"
              style={{
                '--zoom-w': `${flip.w}px`,
                '--zoom-h': `${flip.h}px`,
                '--zoom-dx': `${flip.dx}px`,
                '--zoom-dy': `${flip.dy}px`,
                '--zoom-sx': flip.sx,
                '--zoom-sy': flip.sy,
              } as React.CSSProperties}
              src={zoomImgCacheBust === 0 ? ZOOM_IMG_SRC : `${ZOOM_IMG_SRC}?retry=${zoomImgCacheBust}`}
              alt="Полный экран Откликс: отклики и приглашения на собеседование без искажения макета"
              width={1629}
              height={934}
              onError={() => {
                // Живьём наблюдалось при резком скролле вверх-вниз прямо перед
                // кликом: картинка иногда «мигает» битой — сеть/браузер не
                // успели её догрузить именно к этому моменту. Вместо того чтобы
                // оставлять пользователя смотреть на битую иконку — пробуем
                // перезапросить (смена key размонтирует и создаёт img заново,
                // ?retry= обходит закешированный ответ об ошибке), а если и
                // после нескольких попыток не вышло — тихо закрываем оверлей,
                // не понимая мигом сломанной картинки во весь экран.
                zoomImgRetries.current += 1;
                if (zoomImgRetries.current <= ZOOM_IMG_RETRY_LIMIT) {
                  setZoomImgCacheBust((n) => n + 1);
                } else {
                  // close() тут не подходит — она требует phase==='shown', а
                  // ошибка загрузки вполне может случиться ещё на 'entering'
                  // (картинка не успела не то что показаться, а даже дойти до
                  // видимого состояния) — сбрасываем сразу и безусловно, без
                  // обратной анимации: анимировать возврат нечего, показать
                  // толком ничего и не успели.
                  if (exitTimer.current) clearTimeout(exitTimer.current);
                  setRunning(false);
                  setFadingOut(false);
                  setPhase('idle');
                }
              }}
            />
            <p className="laptop-zoom__hint">Нажмите ещё раз, чтобы продолжить</p>
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}
