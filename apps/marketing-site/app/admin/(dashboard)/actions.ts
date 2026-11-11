'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@/lib/session-token';
import { getSession } from '@/lib/session';
import { findAdminById, updateAdminPassword } from '@/lib/admins';
import { verifyPassword, hashPassword } from '@/lib/password';

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect('/admin/login');
}

// Смена собственного пароля админом: требует текущий пароль (чтобы перехваченная
// сессия не могла сменить его молча) и новый ≥ 8 символов.
export async function changeMyPasswordAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect('/admin/login');
  const current = String(formData.get('current') || '');
  const next = String(formData.get('next') || '');
  if (next.length < 8) redirect('/admin?pw=short');
  const admin = findAdminById(session.id);
  if (!admin || !(await verifyPassword(current, admin.password_hash))) redirect('/admin?pw=wrong');
  await updateAdminPassword(admin.id, await hashPassword(next));
  redirect('/admin?pw=ok');
}
