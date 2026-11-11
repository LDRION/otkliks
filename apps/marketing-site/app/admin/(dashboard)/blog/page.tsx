import Link from 'next/link';
import { listPosts } from '@/lib/blog';
import { deletePostAction } from './actions';

export const dynamic = 'force-dynamic';

const fmt = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function AdminBlogPage() {
  const posts = listPosts(); // все, включая черновики

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem' }}>Блог</h1>
          <p className="muted" style={{ marginTop: 4 }}>Статьи сайта. Создавайте и редактируйте прямо здесь.</p>
        </div>
        <Link href="/admin/blog/new" className="btn btn--primary" style={{ flex: 'none' }}>+ Новая статья</Link>
      </div>

      <div className="card" style={{ marginTop: 20, padding: 0, overflow: 'hidden' }}>
        {posts.length === 0 ? (
          <p className="muted" style={{ padding: 20 }}>Пока нет ни одной статьи. Нажмите «Новая статья».</p>
        ) : (
          <div className="admin-list">
            {posts.map((p) => (
              <div key={p.id} className="admin-list-row">
                <div className="admin-list-main">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Link href={`/admin/blog/${p.id}`} style={{ fontWeight: 600 }}>{p.title || '(без названия)'}</Link>
                    <span className={`tag ${p.published ? 'tag--accent' : ''}`}>{p.published ? 'опубликовано' : 'черновик'}</span>
                    {p.hasCover && <span className="tag">с обложкой</span>}
                  </div>
                  <div className="muted" style={{ fontSize: '0.82rem', marginTop: 4 }}>
                    /{p.slug} · {fmt(p.publishedAt ?? p.updatedAt)}{p.tag ? ` · ${p.tag}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
                  {p.published && (
                    <a className="btn btn--ghost btn--sm" href={`/blog/${p.slug}`} target="_blank" rel="noreferrer">Открыть</a>
                  )}
                  <Link className="btn btn--ghost btn--sm" href={`/admin/blog/${p.id}`}>Изменить</Link>
                  <form action={deletePostAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="btn btn--ghost btn--sm admin-danger" type="submit">Удалить</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
