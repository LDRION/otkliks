'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { coreApiFetch, CoreApiError } from '@/lib/coreApi';
import { customerSessionCookieOptions, CUSTOMER_SESSION_COOKIE } from '@/lib/customer-session';

export type ResetState = { error?: string } | undefined;

type ResetResponse = { token: string; tenant: { id: string; email: string } };

export async function resetPassword(_prevState: ResetState, formData: FormData): Promise<ResetState> {
  const token = String(formData.get('token') || '');
  const password = String(formData.get('password') || '');
  const confirm = String(formData.get('confirm') || '');

  if (password.length < 8) return { error: 'Пароль — минимум 8 символов' };
  if (password !== confirm) return { error: 'Пароли не совпадают' };

  let res: ResetResponse;
  try {
    res = await coreApiFetch<ResetResponse>('/api/auth/reset-password', {
      method: 'POST',
      body: { token, password },
    });
  } catch (e) {
    if (e instanceof CoreApiError) return { error: e.message };
    return { error: 'Сервис временно недоступен, попробуйте ещё раз' };
  }

  // core-api сразу возвращает токен сессии: человек только что подтвердил владение
  // почтой, просить его тут же войти заново — лишний шаг.
  const cookieStore = await cookies();
  cookieStore.set(CUSTOMER_SESSION_COOKIE, res.token, customerSessionCookieOptions);

  redirect('/app');
}
