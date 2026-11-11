// Знак «О» — геометрический контур (10.2026). Раньше был обводкой картинки
// (potrace по public/brand/logo-source.png): прямые отрезки вместо дуг, и на мелких
// размерах край выглядел пиксельным. Теперь по замерам той обводки: кольцо — две
// настоящие дуги (R 87.89, r 57.94, центр 90.16 / 179.09), вырез — полоса вдоль оси
// «стрелки», «стрелка» — отрезок со скруглёнными концами (толщина 23.93). Силуэт
// совпадает с прежним на 97.8% площади.
const ICON_NAVY_D =
  'M 135.738 103.947 A 87.891 87.891 0 1 0 171.98 147.006 L 147.486 170.711 A 57.939 57.939 0 1 1 113.074 125.88 Z M 105.87 188.371 L 171.535 124.824 A 11.967 11.967 0 0 0 154.892 107.626 L 89.227 171.172 A 11.967 11.967 0 0 0 105.87 188.371 Z';

// Пиктограмму-сообщение (лазурное облачко) убрали из логотипа — остаётся только
// росчерк-«О». viewBox тянем по самому росчерку, чтобы значок не висел в левом углу
// с пустым местом там, где раньше было облачко. Значения — из bbox навигационного
// пути ICON_NAVY_D: x[-1.3, 178], y[90.7, 267], квадрат со скромными полями.
const O_VIEWBOX = '-8 83 192 192';

export function LogoMark({ size = 30, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={O_VIEWBOX}
      aria-hidden="true"
      className={animated ? 'logo-mark logo-mark--animated' : 'logo-mark'}
    >
      <path d={ICON_NAVY_D} fill="var(--logo-ink)" fillRule="evenodd" />
    </svg>
  );
}

// Подтягиваем «ткликс» вплотную к росчерку, чтобы он читался как недостающая «О»
// (пиктограмма = буква), а не как отдельная пара «значок + подпись». Теперь значок —
// квадратный кроп по самому росчерку (облачко убрано), «О» заполняет почти всю рамку и
// отцентрована в ней, поэтому по вертикали хватает выравнивания по центру (align-items:
// center у обёртки Logo), а по горизонтали лишь слегка утягиваем текст к правому краю
// «О». Отступ пропорционален размеру значка — «О» масштабируется вместе с ним.
export function Wordmark({ size = 30 }: { size?: number }) {
  return (
    <span
      className="wordmark"
      aria-hidden="true"
      // Размер словомарки привязан к значку (а не фиксированные 1.15rem, как было):
      // так «ткликс» по высоте совпадает с росчерком «О» и читается как единое слово,
      // одинаково во всех локапах — nav, вход, подвал, админка.
      style={{ fontSize: size * 0.72, marginLeft: size * 0.065 }}
    >
      ткл<span className="logo-accent">икс</span>
    </span>
  );
}

// Combined lockup with the accessible name centralized here ("Откликс" is split
// visually across the icon + two text spans, so screen readers need the label
// once, on the wrapper, rather than reading the literal partial text).
export function Logo({ size = 30, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <span role="img" aria-label="Откликс" style={{ display: 'inline-flex', alignItems: 'center' }}>
      <LogoMark size={size} animated={animated} />
      <Wordmark size={size} />
    </span>
  );
}
