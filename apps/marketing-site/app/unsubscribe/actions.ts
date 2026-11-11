'use server';

import { coreApiFetch } from '@/lib/coreApi';

export type UnsubState = { ok?: boolean; error?: string } | undefined;

export async function unsubscribeAction(_prev: UnsubState, fd: FormData): Promise<UnsubState> {
  const u = String(fd.get('u') || '').slice(0, 40);
  const t = String(fd.get('t') || '').slice(0, 64);
  try {
    await coreApiFetch('/api/email/unsubscribe', { method: 'POST', body: { u, t } });
    return { ok: true };
  } catch {
    return { error: 'Ссылка устарела или повреждена. Напишите на support@otkliks.ru — отпишем вручную.' };
  }
}
