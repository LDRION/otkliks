'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { findAdminByEmail } from '@/lib/admins';
import { verifyPassword } from '@/lib/password';
import { signSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/session-token';

export type LoginState = { error?: string } | undefined;

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');

  if (!email || !password) {
    return { error: 'Введите email и пароль' };
  }

  const admin = findAdminByEmail(email);
  const valid = admin ? await verifyPassword(password, admin.password_hash) : false;

  if (!admin || !valid) {
    return { error: 'Неверный email или пароль' };
  }

  const token = await signSession({ id: admin.id, email: admin.email, role: admin.role });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions);

  redirect('/admin');
}
