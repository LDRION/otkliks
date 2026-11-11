import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { hasAtLeastRole } from '@/lib/session-token';
import { listCounsellingRequests } from '@/lib/counsellingRequests';

export const metadata: Metadata = {
  title: 'Заявки на консультацию',
  robots: { index: false, follow: false },
};

export default async function AdminCounsellingPage() {
  const session = await getSession();
  if (!session || !hasAtLeastRole(session.role, 'admin')) redirect('/admin');

  const requests = listCounsellingRequests();

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Заявки на консультацию</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        С формы на /counselling. Видно только ролям admin и owner.
      </p>

      <div style={{ display: 'grid', gap: 12, marginTop: 28 }}>
        {requests.length === 0 && <p className="muted">Заявок пока нет.</p>}
        {requests.map((r) => (
          <div key={r.id} className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <b>{r.name}</b>
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                {new Date(r.created_at).toLocaleString('ru-RU')}
              </span>
            </div>
            <div className="muted" style={{ marginTop: 4, fontSize: '0.9rem' }}>
              {r.contact}
            </div>
            <p style={{ marginTop: 10 }}>{r.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
