import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { hasAtLeastRole } from '@/lib/session-token';
import { logout } from './actions';
import { Logo } from '@/app/components/Logo';
import { AdminNav } from './AdminNav';

export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/admin/login');

  return (
    <div className="admin-shell">
      <header className="admin-topbar admin-topbar--admin">
        <div className="admin-topbar-inner">
          <Link href="/admin" className="logo logo--link" aria-label="Откликс — в админку">
            <Logo size={24} />
          </Link>
          <AdminNav isAdmin={hasAtLeastRole(session.role, 'admin')} isOwner={session.role === 'owner'} />
          <div className="admin-topbar-user">
            <span className="tag">{session.role}</span>
            <span className="muted admin-topbar-email" title={session.email}>{session.email}</span>
            <form action={logout}>
              <button type="submit" className="btn-quiet">
                Выйти
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="admin-main">{children}</main>
    </div>
  );
}
