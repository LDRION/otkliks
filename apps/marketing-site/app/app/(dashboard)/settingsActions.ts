'use server';

import { getCustomerSession } from '@/lib/customerAuthSession';
import { coreApiFetch, CoreApiError } from '@/lib/coreApi';

export type SecurityState = { error?: string; success?: boolean } | undefined;

export async function changePasswordAction(
  _prev: SecurityState,
  formData: FormData,
): Promise<SecurityState> {
  const session = await getCustomerSession();
  if (!session) return { error: 'Сессия истекла, войдите заново' };

  const currentPassword = String(formData.get('currentPassword') || '');
  const newPassword = String(formData.get('newPassword') || '');
  if (newPassword.length < 8) return { error: 'Новый пароль — минимум 8 символов' };

  try {
    await coreApiFetch('/api/auth/change-password', {
      method: 'POST',
      token: session.coreApiToken,
      body: { currentPassword, newPassword },
    });
  } catch (e) {
    return { error: e instanceof CoreApiError ? e.message : 'Не получилось сменить пароль' };
  }

  return { success: true };
}
