'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adminFetch, requireAdmin, AdminApiError } from '@/lib/adminApi';

const ID = /^[a-f0-9]{24}$/;

// Ошибку возвращаем на страницу кодом, а не текстом из query — чтобы ссылкой
// нельзя было подсунуть админу произвольную «системную» надпись.
function back(aff: string | null, err?: 'conflict' | 'failed'): never {
  const q = new URLSearchParams();
  if (aff && ID.test(aff)) q.set('aff', aff);
  if (err) q.set('err', err);
  revalidatePath('/admin/partners');
  redirect(`/admin/partners${q.size ? `?${q}` : ''}`);
}

async function call(path: string, body?: unknown): Promise<'conflict' | 'failed' | undefined> {
  const session = await requireAdmin('owner');
  try {
    await adminFetch(session, path, { method: 'POST', body });
    return undefined;
  } catch (e) {
    return e instanceof AdminApiError && (e.status === 409 || e.status === 400) ? 'conflict' : 'failed';
  }
}

// Всё, что двигает деньги, — только владелец. Проверка и здесь, и в core-api.
export async function resolvePayoutAction(fd: FormData): Promise<void> {
  const id = String(fd.get('id') || '');
  if (!ID.test(id)) back(null, 'failed');
  const err = await call(`/payouts/${id}/resolve`, {
    approve: fd.get('approve') === '1',
    note: String(fd.get('note') || '').slice(0, 200),
  });
  back(null, err);
}

export async function blockAffiliateAction(fd: FormData): Promise<void> {
  const id = String(fd.get('id') || '');
  if (!ID.test(id)) back(null, 'failed');
  back(id, await call(`/affiliates/${id}/block`, { blocked: fd.get('blocked') === '1' }));
}

export async function reverseCommissionAction(fd: FormData): Promise<void> {
  const id = String(fd.get('id') || '');
  const aff = String(fd.get('aff') || '');
  if (!ID.test(id)) back(aff, 'failed');
  back(aff, await call(`/commissions/${id}/reverse`));
}
