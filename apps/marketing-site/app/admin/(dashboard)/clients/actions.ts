'use server';

import { revalidatePath } from 'next/cache';
import { adminFetch, requireAdmin, AdminApiError } from '@/lib/adminApi';

export type MarkState = { error?: string; saved?: boolean } | undefined;

// «Это наш аккаунт» и заметка «кто это» — см. core-api AdminMark.
export async function markUserAction(_prev: MarkState, fd: FormData): Promise<MarkState> {
  const session = await requireAdmin('admin');
  const id = String(fd.get('id') || '');
  if (!/^[a-f0-9]{24}$/.test(id)) return { error: 'Неверный пользователь' };
  try {
    await adminFetch(session, `/users/${id}/mark`, {
      method: 'POST',
      body: { internal: fd.get('internal') === 'on', note: String(fd.get('note') || '') },
    });
    revalidatePath('/admin/clients');
    revalidatePath(`/admin/clients/${id}`);
    revalidatePath('/admin/growth');
    return { saved: true };
  } catch (e) {
    return { error: e instanceof AdminApiError ? e.message : 'Не удалось сохранить' };
  }
}
