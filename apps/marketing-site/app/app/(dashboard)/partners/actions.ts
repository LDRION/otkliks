'use server';

import { revalidatePath } from 'next/cache';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { coreApiFetch, CoreApiError } from '@/lib/coreApi';

export type PartnerState = { error?: string; ok?: string } | undefined;

export async function joinPartnerProgram(): Promise<void> {
  const session = await getCustomerSession();
  if (!session) return;
  await coreApiFetch('/api/affiliate/join', { method: 'POST', token: session.coreApiToken });
  revalidatePath('/app/partners');
}

export async function requestPartnerPayout(_prev: PartnerState, formData: FormData): Promise<PartnerState> {
  const session = await getCustomerSession();
  if (!session) return { error: 'Сессия истекла — войдите заново' };
  try {
    await coreApiFetch('/api/affiliate/payout', {
      method: 'POST',
      token: session.coreApiToken,
      body: { amount: Number(formData.get('amount')), details: String(formData.get('details') || '') },
    });
  } catch (e) {
    return { error: e instanceof CoreApiError ? e.message : 'Сервис временно недоступен' };
  }
  revalidatePath('/app/partners');
  return { ok: 'Запрос на вывод отправлен. Обычно обрабатываем в течение трёх рабочих дней.' };
}
