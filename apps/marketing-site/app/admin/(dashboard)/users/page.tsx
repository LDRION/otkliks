import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { listAdmins } from '@/lib/admins';
import { createAdminAction, updateRoleAction, deleteAdminAction } from './actions';

export const metadata: Metadata = {
  title: 'Администраторы',
  robots: { index: false, follow: false },
};

export default async function AdminUsersPage() {
  const session = await getSession();
  if (session?.role !== 'owner') redirect('/admin');

  const admins = listAdmins();

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Администраторы</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        Иерархия доступа: <b>owner</b> → <b>admin</b> → <b>editor</b>. Управлять аккаунтами может
        только owner.
      </p>

      <div className="card" style={{ marginTop: 28, maxWidth: 460 }}>
        <h2 style={{ fontSize: '1.05rem', marginBottom: 16 }}>Добавить администратора</h2>
        <form action={createAdminAction} style={{ display: 'grid', gap: 12 }}>
          <input name="email" type="email" required placeholder="email" />
          <input name="password" type="password" required minLength={8} placeholder="временный пароль (мин. 8 символов)" />
          <select name="role" defaultValue="editor">
            <option value="editor">editor</option>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
          </select>
          <button type="submit" className="btn btn--primary">Создать</button>
        </form>
      </div>

      <div style={{ display: 'grid', gap: 12, marginTop: 28 }}>
        {admins.map((admin) => (
          <div
            key={admin.id}
            className="card"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap',
              padding: 20,
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>
                {admin.email} {admin.id === session.id && <span className="muted">(вы)</span>}
              </div>
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                с {new Date(admin.created_at).toLocaleDateString('ru-RU')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <form action={updateRoleAction} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="hidden" name="id" value={admin.id} />
                <select name="role" defaultValue={admin.role}>
                  <option value="editor">editor</option>
                  <option value="admin">admin</option>
                  <option value="owner">owner</option>
                </select>
                <button type="submit" className="btn btn--ghost" style={{ padding: '6px 14px' }}>
                  Сохранить
                </button>
              </form>
              {admin.id !== session.id && (
                <form action={deleteAdminAction}>
                  <input type="hidden" name="id" value={admin.id} />
                  <button
                    type="submit"
                    className="btn btn--ghost"
                    style={{ padding: '6px 14px', color: 'var(--danger)' }}
                  >
                    Удалить
                  </button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
