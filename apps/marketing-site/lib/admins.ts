import { db } from './db';
import type { AdminRole } from './session-token';

export type AdminRow = {
  id: number;
  email: string;
  password_hash: string;
  role: AdminRole;
  created_at: number;
};

export function findAdminByEmail(email: string): AdminRow | undefined {
  return db.prepare('SELECT * FROM admins WHERE email = ?').get(email) as AdminRow | undefined;
}

export function findAdminById(id: number): AdminRow | undefined {
  return db.prepare('SELECT * FROM admins WHERE id = ?').get(id) as AdminRow | undefined;
}

export function listAdmins(): AdminRow[] {
  return db.prepare('SELECT * FROM admins ORDER BY created_at ASC').all() as AdminRow[];
}

export function countAdmins(): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number };
  return row.count;
}

export function createAdmin(input: { email: string; passwordHash: string; role: AdminRole }): AdminRow {
  const info = db
    .prepare('INSERT INTO admins (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
    .run(input.email.toLowerCase(), input.passwordHash, input.role, Date.now());
  return findAdminById(Number(info.lastInsertRowid))!;
}

export function updateAdminRole(id: number, role: AdminRole): void {
  db.prepare('UPDATE admins SET role = ? WHERE id = ?').run(role, id);
}

export function deleteAdmin(id: number): void {
  db.prepare('DELETE FROM admins WHERE id = ?').run(id);
}

export function updateAdminPassword(id: number, passwordHash: string): void {
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}
