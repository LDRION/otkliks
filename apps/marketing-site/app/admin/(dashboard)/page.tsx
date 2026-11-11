import type { Metadata } from 'next';
import { listPosts } from '@/lib/blog';
import { getViewCount } from '@/lib/views';
import { getSession } from '@/lib/session';
import { changeMyPasswordAction } from './actions';

export const metadata: Metadata = {
  title: 'Дашборд',
  robots: { index: false, follow: false },
};

const PW_MSG: Record<string, { text: string; ok: boolean }> = {
  ok: { text: 'Пароль изменён.', ok: true },
  wrong: { text: 'Неверный текущий пароль.', ok: false },
  short: { text: 'Новый пароль должен быть не короче 8 символов.', ok: false },
};

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<{ pw?: string }> }) {
  const { pw } = await searchParams;
  const pwMsg = pw ? PW_MSG[pw] : null;
  const session = await getSession();
  const dbPosts = listPosts();
  const stats = dbPosts.map((p) => ({ title: p.title, slug: p.slug, views: getViewCount(p.slug) }));
  const totalViews = stats.reduce((sum, p) => sum + p.views, 0);

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Дашборд</h1>
      <p className="muted" style={{ marginTop: 8 }}>С возвращением, {session?.email}.</p>

      <div className="grid grid--3" style={{ marginTop: 32 }}>
        <div className="card">
          <span className="tag">Всего</span>
          <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: 10 }}>
            {totalViews.toLocaleString('ru-RU')}
          </div>
          <p className="muted" style={{ marginTop: 6 }}>уникальных просмотров блога</p>
        </div>
        <div className="card">
          <span className="tag">Постов</span>
          <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: 10 }}>{dbPosts.length}</div>
          <p className="muted" style={{ marginTop: 6 }}>опубликовано в блоге</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 24, maxWidth: 460 }}>
        <div className="section-title" style={{ marginBottom: 6 }}>Сменить пароль</div>
        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 12 }}>
          Ваш вход в админку: {session?.email}
        </p>
        {pwMsg && (
          <p style={{ marginBottom: 12, fontWeight: 600, color: pwMsg.ok ? 'var(--success)' : 'var(--danger)' }}>
            {pwMsg.text}
          </p>
        )}
        <form action={changeMyPasswordAction} style={{ display: 'grid', gap: 10 }}>
          <input name="current" type="password" required placeholder="Текущий пароль" autoComplete="current-password" />
          <input name="next" type="password" required minLength={8} placeholder="Новый пароль (мин. 8 символов)" autoComplete="new-password" />
          <button className="btn btn--primary btn--sm" type="submit" style={{ justifySelf: 'start' }}>Сменить пароль</button>
        </form>
      </div>

      <h2 style={{ fontSize: '1.1rem', marginTop: 40, marginBottom: 16 }}>Просмотры по постам</h2>
      <div style={{ display: 'grid', gap: 12 }}>
        {stats.map((p) => (
          <div
            key={p.slug}
            className="card"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 20 }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{p.title}</div>
              <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
                /blog/{p.slug}
              </div>
            </div>
            <div style={{ fontWeight: 800, fontSize: '1.2rem' }}>{p.views.toLocaleString('ru-RU')}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
