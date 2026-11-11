// Вызовы админ-API core-api (промокоды, партнёры, выплаты, сводка).
//
// ТОЛЬКО для серверного кода: ключ ADMIN_API_SECRET не имеет префикса
// NEXT_PUBLIC_, поэтому в браузерную сборку не попадает никогда — там это
// undefined. Но и звать отсюда из клиента нечего: каждая функция сначала сама
// проверяет админскую сессию и роль, а уж потом подставляет ключ.
//
// Роль передаётся в core-api заголовком: там по ней закрыты операции только для
// владельца (выплаты, отмена комиссий, блокировка партнёра). Подделать заголовок
// снаружи нельзя — без ключа core-api не ответит вовсе.
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { hasAtLeastRole, type AdminRole, type SessionPayload } from '@/lib/session-token';

const CORE_API_URL = process.env.CORE_API_URL || 'http://localhost:4000';

export class AdminApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Сессия с нужной ролью — или выход на логин/дашборд. */
export async function requireAdmin(min: AdminRole = 'admin'): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect('/admin/login');
  if (!hasAtLeastRole(session.role, min)) redirect('/admin');
  return session;
}

export async function adminFetch<T = unknown>(
  session: SessionPayload,
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const key = process.env.ADMIN_API_SECRET;
  if (!key) throw new AdminApiError('ADMIN_API_SECRET не задан', 503);
  const res = await fetch(`${CORE_API_URL}/api/admin${path}`, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': key,
      'X-Admin-Actor': session.email,
      'X-Admin-Role': session.role,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AdminApiError(data.error || `admin ${path} → ${res.status}`, res.status);
  return data as T;
}
