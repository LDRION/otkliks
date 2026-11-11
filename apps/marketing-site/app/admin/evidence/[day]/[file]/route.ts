// Скриншоты-доказательства цен конкурентов (см. lib/priceClaim.ts) — только для
// вошедших админов. Лежат вне сайта, в evidence/prices/<дата>/ корня репозитория.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getSession } from '@/lib/session';
import { EVIDENCE_DIR } from '@/lib/evidence';

export async function GET(_req: Request, { params }: { params: Promise<{ day: string; file: string }> }) {
  if (!(await getSession())) return new Response('Not found', { status: 404 });
  const { day, file } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^[a-z0-9-]+\.jpg$/.test(file)) return new Response('Not found', { status: 404 });
  try {
    const buf = await readFile(path.join(EVIDENCE_DIR, day, file));
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
