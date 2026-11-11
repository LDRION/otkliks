'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { coreApiFetch, CoreApiError } from '@/lib/coreApi';
import { customerSessionCookieOptions, CUSTOMER_SESSION_COOKIE } from '@/lib/customer-session';
import { REF_COOKIE, PROMO_COOKIE, SRC_COOKIE } from '@/lib/attribution';

export type RegisterState = { error?: string } | undefined;

type RegisterResponse = { token: string; tenant: { id: string; email: string } };

export async function registerCustomer(_prevState: RegisterState, formData: FormData): Promise<RegisterState> {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const fullName = String(formData.get('fullName') || '').trim();

  if (!email || password.length < 8) {
    return { error: 'Email обязателен, пароль — минимум 8 символов' };
  }
  // Согласие на обработку ПД — отдельная обязательная галочка (152-ФЗ).
  if (formData.get('consent') !== 'on') {
    return { error: 'Отметьте согласие на обработку персональных данных' };
  }

  // Партнёр, промокод и источник — из cookie. Проверяет их core-api, здесь они
  // просто передаются дальше.
  const cookieStore = await cookies();
  const ref = cookieStore.get(REF_COOKIE)?.value;
  const promo = cookieStore.get(PROMO_COOKIE)?.value;
  const src = cookieStore.get(SRC_COOKIE)?.value;

  let res: RegisterResponse;
  try {
    res = await coreApiFetch<RegisterResponse>('/api/auth/register', {
      method: 'POST',
      body: { email, password, fullName, ref, promo, src, consent: true, consentSource: 'site' },
    });
  } catch (e) {
    if (e instanceof CoreApiError) return { error: e.message };
    return { error: 'Сервис временно недоступен, попробуйте ещё раз' };
  }

  cookieStore.set(CUSTOMER_SESSION_COOKIE, res.token, customerSessionCookieOptions);
  // Промокод одноразовый и уже применён — cookie больше не нужна. Партнёрскую
  // тоже убираем: человек закреплён за партнёром в базе навсегда.
  cookieStore.delete(PROMO_COOKIE);
  cookieStore.delete(REF_COOKIE);

  // welcome=1 — страница кабинета отметит цель «регистрация» в метриках.
  redirect('/app?welcome=1');
}
