import { ImageResponse } from 'next/og';
import { getPostBySlug } from '@/lib/blog';
import { getViewCount } from '@/lib/views';

// Next.js не сканирует конвенцию opengraph-image.tsx внутри route group'ов
// (проверено: /blog/(post)/<slug>/opengraph-image.tsx стабильно даёт 404),
// поэтому картинки постов рендерим через обычный динамический route handler.
const size = { width: 1200, height: 630 };

// Точная трассировка public/brand/logo-mark.svg (см. app/components/Logo.tsx).
const ICON_NAVY_D =
  'M 135.738 103.947 A 87.891 87.891 0 1 0 171.98 147.006 L 147.486 170.711 A 57.939 57.939 0 1 1 113.074 125.88 Z M 105.87 188.371 L 171.535 124.824 A 11.967 11.967 0 0 0 154.892 107.626 L 89.227 171.172 A 11.967 11.967 0 0 0 105.87 188.371 Z';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    return new Response('Not found', { status: 404 });
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '76px',
          background: '#ffffff',
          backgroundImage:
            'radial-gradient(circle at 85% 15%, #eef1f6 0%, rgba(238,241,246,0) 55%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <svg width={42} height={42} viewBox="-8 83 192 192">
            <path d={ICON_NAVY_D} fill="#212D4E" fillRule="evenodd" />
          </svg>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, color: '#212D4E', marginLeft: -3 }}>
            ткл<span style={{ color: '#12EDCF' }}>икс</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              display: 'flex',
              fontSize: 22,
              fontWeight: 700,
              color: '#212D4E',
              background: '#eef1f6',
              borderRadius: 999,
              padding: '8px 20px',
              alignSelf: 'flex-start',
            }}
          >
            {post.tag}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 54,
              fontWeight: 800,
              color: '#14141f',
              lineHeight: 1.15,
              maxWidth: 980,
            }}
          >
            {post.title}
          </div>
          <div style={{ display: 'flex', fontSize: 26, color: '#5b5f73' }}>
            {getViewCount(slug).toLocaleString('ru-RU')} просмотров · Блог Откликс
          </div>
        </div>
      </div>
    ),
    size
  );
}
