'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { createAdmin, updateAdminRole, deleteAdmin } from '@/lib/admins';
import { hashPassword } from '@/lib/password';
import type { AdminRole } from '@/lib/session-token';

const ROLES: AdminRole[] = ['editor', 'admin', 'owner'];

async function requireOwner() {
  const session = await getSession();
  if (session?.role !== 'owner') {
    throw new Error('Forbidden: требуется роль owner');
  }
  return session;
}

export async function createAdminAction(formData: FormData) {
  await requireOwner();

  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const roleInput = String(formData.get('role') || 'editor');
  const role = ROLES.includes(roleInput as AdminRole) ? (roleInput as AdminRole) : 'editor';

  if (!email || password.length < 8) {
    throw new Error('Email обязателен, пароль — минимум 8 символов');
  }

  const passwordHash = await hashPassword(password);
  createAdmin({ email, passwordHash, role });
  revalidatePath('/admin/users');
}

export async function updateRoleAction(formData: FormData) {
  const session = await requireOwner();

  const id = Number(formData.get('id'));
  const roleInput = String(formData.get('role'));
  if (!ROLES.includes(roleInput as AdminRole)) {
    throw new Error('Некорректная роль');
  }
  const role = roleInput as AdminRole;

  if (id === session.id && role !== 'owner') {
    throw new Error('Нельзя понизить собственную роль');
  }

  updateAdminRole(id, role);
  revalidatePath('/admin/users');
}

export async function deleteAdminAction(formData: FormData) {
  const session = await requireOwner();
  const id = Number(formData.get('id'));

  if (id === session.id) {
    throw new Error('Нельзя удалить собственный аккаунт');
  }

  deleteAdmin(id);
  revalidatePath('/admin/users');
}
