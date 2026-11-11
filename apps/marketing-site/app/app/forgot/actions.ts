'use server';

import { coreApiFetch } from '@/lib/coreApi';

export type ForgotState = { sent?: boolean; error?: string } | undefined;

export async function requestPasswordReset(
  _prevState: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return { error: 'Введите адрес, на который зарегистрирован аккаунт' };

  try {
    await coreApiFetch('/api/auth/forgot-password', { method: 'POST', body: { email } });
  } catch {
    // core-api на этот запрос отвечает 204 в любом случае — сюда попадаем, только
    // если он вовсе недоступен. Показываем это честно, а не «письмо отправлено».
    return { error: 'Сервис временно недоступен, попробуйте ещё раз через минуту' };
  }

  // Намеренно не сообщаем, нашёлся аккаунт или нет: иначе форму можно использовать
  // как проверку «зарегистрирован ли этот человек в Откликс».
  return { sent: true };
}
