'use server';

import { revalidatePath } from 'next/cache';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { coreApiFetch } from '@/lib/coreApi';

// Задания бесплатного тарифа (core-api lib/freeTasks.js). «Открыть» фиксирует переход
// по ссылке задания, «Готово» засчитывается только после него и через несколько секунд.
export async function openTaskAction(id: string): Promise<{ error?: string }> {
  const session = await getCustomerSession();
  if (!session) return { error: 'Сессия истекла, войдите заново' };
  try {
    await coreApiFetch(`/api/profile/tasks/${encodeURIComponent(id)}/open`, { method: 'POST', token: session.coreApiToken });
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Не получилось' };
  }
}

export async function doneTaskAction(id: string): Promise<{ error?: string; ok?: boolean }> {
  const session = await getCustomerSession();
  if (!session) return { error: 'Сессия истекла, войдите заново' };
  try {
    await coreApiFetch(`/api/profile/tasks/${encodeURIComponent(id)}/done`, { method: 'POST', token: session.coreApiToken });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Не получилось' };
  }
  revalidatePath('/app');
  return { ok: true };
}
