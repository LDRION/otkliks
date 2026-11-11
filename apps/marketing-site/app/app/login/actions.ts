'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { coreApiFetch, CoreApiError } from '@/lib/coreApi';
import { customerSessionCookieOptions, CUSTOMER_SESSION_COOKIE } from '@/lib/customer-session';
import { PROMO_COOKIE } from '@/lib/attribution';

export type LoginState = { error?: string } | undefined;

type LoginResponse = { token: string; tenant: { id: string; email: string } };

export async function loginCustomer(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');

  if (!email || !password) return { error: 'Введите email и пароль' };

  let res: LoginResponse;
  try {
    res = await coreApiFetch<LoginResponse>('/api/auth/login', { method: 'POST', body: { email, password } });
  } catch (e) {
    if (e instanceof CoreApiError) return { error: e.message };
    return { error: 'Сервис временно недоступен, попробуйте ещё раз' };
  }

  const cookieStore = await cookies();
  cookieStore.set(CUSTOMER_SESSION_COOKIE, res.token, customerSessionCookieOptions);

  // Пришёл по промо-ссылке, но аккаунт уже был — активируем подарок при входе,
  // иначе он потерялся бы. Не вышло (ссылка использована) — просто входим.
  const promo = cookieStore.get(PROMO_COOKIE)?.value;
  let flag = '';
  if (promo) {
    try {
      await coreApiFetch('/api/promo/redeem', { method: 'POST', token: res.token, body: { code: promo } });
      flag = '?promo=activated';
    } catch {
      flag = '?promo=unavailable';
    }
    cookieStore.delete(PROMO_COOKIE);
  }

  redirect(`/app${flag}`);
}
