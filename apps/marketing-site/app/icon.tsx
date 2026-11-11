import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

// Точная трассировка public/brand/logo-mark.svg (см. app/components/Logo.tsx).
const NAVY_D =
  'M 135.738 103.947 A 87.891 87.891 0 1 0 171.98 147.006 L 147.486 170.711 A 57.939 57.939 0 1 1 113.074 125.88 Z M 105.87 188.371 L 171.535 124.824 A 11.967 11.967 0 0 0 154.892 107.626 L 89.227 171.172 A 11.967 11.967 0 0 0 105.87 188.371 Z';
// Пиктограмму-сообщение (лазурное облачко) из значка убрали — во вкладке браузера
// остаётся только росчерк-«О». viewBox тянем по самому росчерку, чтобы «О» заполняла
// все 32×32, а не висела в углу с пустым местом от бывшего облачка.
export default function Icon() {
  return new ImageResponse(
    (
      <svg width={32} height={32} viewBox="-8 83 192 192">
        <path d={NAVY_D} fill="#212D4E" fillRule="evenodd" />
      </svg>
    ),
    { ...size }
  );
}
