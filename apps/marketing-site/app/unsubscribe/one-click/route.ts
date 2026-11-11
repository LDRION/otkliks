import { NextRequest, NextResponse } from 'next/server';
import { coreApiFetch } from '@/lib/coreApi';

// Отписка в один клик из интерфейса почтовика (RFC 8058: Gmail/Яндекс шлют сюда POST
// с телом List-Unsubscribe=One-Click). Подпись ссылки проверяет core-api.
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const u = (searchParams.get('u') || '').slice(0, 40);
  const t = (searchParams.get('t') || '').slice(0, 64);
  try {
    await coreApiFetch('/api/email/unsubscribe', { method: 'POST', body: { u, t } });
    return new NextResponse(null, { status: 200 });
  } catch {
    return new NextResponse(null, { status: 400 });
  }
}
