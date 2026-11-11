import { getCover } from '@/lib/blog';

// Обложка поста раздаётся из БД (BLOB), а не с диска — чтобы переживать пересборку
// standalone-бандла. Кэшируем на час: картинка у поста меняется редко.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cover = getCover(slug);
  if (!cover) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(cover.data), {
    headers: {
      'Content-Type': cover.mime,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
