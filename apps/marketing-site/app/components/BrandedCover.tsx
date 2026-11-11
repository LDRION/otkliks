'use client';

import { useEffect, useRef } from 'react';

// Брендовая обложка в стиле новостной карточки: фото + надпись «ОТКЛИКС» в углу +
// лазурный контур с округлыми углами, который САМ прорисовывается, когда обложка
// появляется на экране. Всё из готовых данных поста (картинка/заголовок/тег) —
// вручную ничего собирать не нужно.
//
// Контур рисуем SVG-штрихом (stroke-dashoffset). pathLength=1 нормализует длину,
// поэтому анимация не зависит от размеров. viewBox совпадает по пропорции с
// контейнером (16:9) + preserveAspectRatio="none" → масштаб равномерный, скругления
// не «эллипсятся», а non-scaling-stroke держит толщину линии постоянной.
// Крупный заголовок на обложке не должен обрываться на коротком предлоге или союзе
// («Как найти работу быстро в / 2026 году»): приклеиваем его к следующему слову
// неразрывным пробелом. Только для отображения — сам заголовок в базе не меняется.
const SHORT_WORDS = /(^|[\s(«—-])(в|во|и|а|с|со|к|ко|на|по|до|от|за|из|у|о|об|не|но|для|без|при|про|что|как|или)\s+/giu;
function typograph(text: string): string {
  // Дважды — чтобы цепочки вроде «и в» тоже склеились.
  return text.replace(SHORT_WORDS, '$1$2\u00a0').replace(SHORT_WORDS, '$1$2\u00a0');
}

export function BrandedCover({
  src,
  title,
  tag,
  pos,
  variant = 'card',
}: {
  src?: string | null;
  title: string;
  tag?: string;
  pos?: string; // object-position, «x% y%» — выбранная в редакторе точка кадрирования
  variant?: 'card' | 'hero';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Анимация — при появлении в кадре (для ленты — на скролле, для статьи — сразу).
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            el.classList.add('bc--in');
            io.disconnect();
          }
        });
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`bc bc--${variant}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="bc-img" src={src} alt="" style={pos ? { objectPosition: pos } : undefined} />
      ) : (
        <div className="bc-img bc-img--ph" />
      )}
      <div className="bc-shade" />

      {(() => {
        // Рамка-петля, повторяющая скруглённый прямоугольник самого блока: угол по
        // радиусу как у контейнера (--radius ≈ 14px), линия близко к краю. viewBox
        // берём под пропорцию варианта (card 16:9, hero 16:8), иначе при
        // preserveAspectRatio="none" углы «эллипсятся». Старт у правого края верхней
        // грани, рисуем влево — как просили (сначала верх, потом углы по кругу).
        const vbW = 1600;
        const vbH = variant === 'hero' ? 800 : 900;
        const m = variant === 'hero' ? 13 : 15; // отступ от края (~10px на экране)
        const r = variant === 'hero' ? 20 : 24; // радиус угла (~14px), как у контейнера
        const L = m;
        const T = m;
        const RX = vbW - m;
        const BY = vbH - m;
        const d = `M ${RX - r} ${T} L ${L + r} ${T} Q ${L} ${T} ${L} ${T + r} L ${L} ${BY - r} Q ${L} ${BY} ${L + r} ${BY} L ${RX - r} ${BY} Q ${RX} ${BY} ${RX} ${BY - r} L ${RX} ${T + r} Q ${RX} ${T} ${RX - r} ${T} Z`;
        return (
          <svg className="bc-frame" viewBox={`0 0 ${vbW} ${vbH}`} preserveAspectRatio="none" aria-hidden="true">
            <path
              pathLength={1}
              d={d}
              fill="none"
              stroke="var(--teal)"
              strokeWidth={variant === 'hero' ? 4.5 : 4}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        );
      })()}

      <div className="bc-overlay">
        <span className="bc-brand" aria-label="Откликс">
          ОТКЛИК<span className="bc-brand-x">С</span>
        </span>
        {variant === 'hero' && (
          <div className="bc-heading">
            {tag && <span className="bc-tag">{tag}</span>}
            <h1 className="bc-title">{typograph(title)}</h1>
          </div>
        )}
      </div>
    </div>
  );
}
