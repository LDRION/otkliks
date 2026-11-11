'use server';

import { revalidatePath } from 'next/cache';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { coreApiFetch, CoreApiError } from '@/lib/coreApi';

export type EmailState = { error?: string; sentTo?: string } | undefined;

export async function requestEmailAction(_prev: EmailState, formData: FormData): Promise<EmailState> {
  const session = await getCustomerSession();
  if (!session) return { error: 'Сессия истекла — войдите заново' };

  const email = String(formData.get('email') || '').trim();
  if (!email) return { error: 'Укажите адрес почты' };

  try {
    const res = await coreApiFetch<{ pendingEmail: string }>('/api/auth/email', {
      method: 'POST',
      token: session.coreApiToken,
      body: { email },
    });
    revalidatePath('/app');
    return { sentTo: res.pendingEmail };
  } catch (e) {
    if (e instanceof CoreApiError) return { error: e.message };
    return { error: 'Сервис временно недоступен, попробуйте ещё раз' };
  }
}
