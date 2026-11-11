'use server';

import { revalidatePath } from 'next/cache';
import { adminFetch, requireAdmin, AdminApiError } from '@/lib/adminApi';

export type PromoState = { error?: string; created?: string } | undefined;

export async function createPromoAction(_prev: PromoState, fd: FormData): Promise<PromoState> {
  const session = await requireAdmin('admin');
  const n = (k: string) => Number(fd.get(k));
  try {
    const r = await adminFetch<{ code: string }>(session, '/promos', {
      method: 'POST',
      body: {
        note: String(fd.get('note') || ''),
        trialDays: n('trialDays'),
        trialDailyCap: n('trialDailyCap'),
        discountPercent: n('discountPercent'),
        discountValidDays: n('discountValidDays'),
        maxRedemptions: n('maxRedemptions'),
        expiresInDays: n('expiresInDays'),
      },
    });
    revalidatePath('/admin/promo');
    return { created: r.code };
  } catch (e) {
    return { error: e instanceof AdminApiError ? e.message : 'Не удалось создать ссылку' };
  }
}

export async function togglePromoAction(fd: FormData): Promise<void> {
  const session = await requireAdmin('admin');
  const id = String(fd.get('id') || '');
  if (!/^[a-f0-9]{24}$/.test(id)) return;
  await adminFetch(session, `/promos/${id}/active`, { method: 'POST', body: { active: fd.get('active') === '1' } });
  revalidatePath('/admin/promo');
}

export type TakeState = { error?: string; code?: string } | undefined;

// Следующая невыданная ссылка из запаса — сразу помечается выданной.
export async function takePromoAction(_prev: TakeState, fd: FormData): Promise<TakeState> {
  const session = await requireAdmin('admin');
  try {
    const r = await adminFetch<{ code: string }>(session, '/promos/take', {
      method: 'POST',
      body: { note: String(fd.get('note') || '').slice(0, 500) },
    });
    revalidatePath('/admin/promo');
    return { code: r.code };
  } catch (e) {
    return { error: e instanceof AdminApiError ? e.message : 'Не удалось взять ссылку' };
  }
}

export async function refillStockAction(): Promise<void> {
  const session = await requireAdmin('owner');
  await adminFetch(session, '/promos/stock', { method: 'POST', body: { count: 100 } }).catch(() => null);
  revalidatePath('/admin/promo');
}
