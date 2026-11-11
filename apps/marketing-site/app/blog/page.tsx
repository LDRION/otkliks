import Link from 'next/link';
import type { Metadata } from 'next';
import { listPosts } from '@/lib/blog';
import { SITE_URL, SITE_NAME, buildBreadcrumbJsonLd } from '@/lib/site';
import { getViewCount } from '@/lib/views';
import { ViewBadge } from '@/app/components/ViewBadge';
import { BrandedCover } from '@/app/components/BrandedCover';
import { getSession } from '@/lib/session';
import { hasAtLeastRole } from '@/lib/session-token';

// Читаем БД на каждый запрос — новые посты из админки появляются сразу.
export const dynamic = 'force-dynamic';

// id есть только у постов из БД (их можно редактировать в админке); у старых
// MDX-постов его нет.
type Card = { id?: number; slug: string; title: string; description: string; tag: string; date: number; hasCover: boolean; pos: string };

// Лента блога — из БД (единый источник; посты создаются и правятся в админке).
function allCards(): Card[] {
  return listPosts({ publishedOnly: true }).map((p) => ({
    id: p.id, slug: p.slug, title: p.title, description: p.description, tag: p.tag,
    date: p.publishedAt ?? p.updatedAt, hasCover: p.hasCover, pos: p.coverPos,
  }));
}

// Заголовок целиком свой (absolute), без шаблона «— Откликс»: бренд уже стоит в начале.
const TITLE = 'Блог Откликс — как найти работу: советы по резюме, откликам на hh.ru и собеседованиям';
const DESCRIPTION =
  'Что делать, если не получается найти работу: разборы резюме и сопроводительных писем, стратегии откликов на hh.ru и подготовка к собеседованиям — по шагам, без воды.';
const PATH = '/blog';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}${PATH}` },
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    siteName: SITE_NAME,
    url: `${SITE_URL}${PATH}`,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });

const breadcrumbJsonLd = buildBreadcrumbJsonLd([
  { name: 'Главная', path: '/' },
  { name: TITLE, path: PATH },
]);

function buildBlogJsonLd() {
  return {
  '@context': 'https://schema.org',
  '@type': 'Blog',
  name: `${TITLE} — Откликс`,
  description: DESCRIPTION,
  url: `${SITE_URL}${PATH}`,
  blogPost: listPosts({ publishedOnly: true }).map((post) => ({
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: new Date(post.publishedAt ?? post.updatedAt).toISOString(),
    dateModified: new Date(post.updatedAt).toISOString(),
    url: `${SITE_URL}/blog/${post.slug}`,
  })),
  };
}

export default async function BlogIndexPage() {
  const [featured, ...rest] = allCards();
  const blogJsonLd = buildBlogJsonLd();
  const session = await getSession();
  const isAdmin = !!session && hasAtLeastRole(session.role, 'editor');

  return (
    <main>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogJsonLd) }}
      />
      <section className="section">
        <div className="container">
          <span className="eyebrow">Блог</span>
          <h1 style={{ marginTop: 16, maxWidth: 640 }}>
            Как устроен наём, когда обе стороны используют AI
          </h1>
          <p className="lead" style={{ marginTop: 16 }}>
            Разборы автоматизации поиска работы и HR-скрининга — на реальных примерах, без
            воды и без страха признать, что по обе стороны чата всё чаще сидит не человек.
          </p>

          {/* Панель админа: видна только вошедшему в /admin редактору. Отсюда — сразу
              создать статью или уйти в управление; у каждой карточки ниже — «Изменить». */}
          {isAdmin && (
            <div className="blog-admin-bar">
              <span className="blog-admin-bar__you">Режим редактора · {session!.email}</span>
              <div className="blog-admin-bar__actions">
                <Link href="/admin/blog/new" className="btn btn--primary btn--sm">＋ Новая статья</Link>
                <Link href="/admin/blog" className="btn btn--ghost btn--sm">Управление блогом</Link>
              </div>
            </div>
          )}

          {featured && (
            <div className="post-card-wrap">
              <Link href={`/blog/${featured.slug}`} className="post-card post-card--featured">
                {featured.hasCover && (
                  <BrandedCover variant="card" src={`/blog/cover/${featured.slug}`} title={featured.title} pos={featured.pos} />
                )}
                <span className="tag tag--accent">{featured.tag}</span>
                <h2><span className="post-card__title">{featured.title}</span></h2>
                <p className="muted">{featured.description}</p>
                <div className="post-card-meta">
                  <time dateTime={new Date(featured.date).toISOString()}>{formatDate(featured.date)}</time>
                  <span className="post-meta-dot" aria-hidden="true">·</span>
                  <ViewBadge count={getViewCount(featured.slug)} />
                  <span className="post-card-arrow">Читать →</span>
                </div>
              </Link>
              {isAdmin && featured.id && (
                <Link href={`/admin/blog/${featured.id}`} className="post-edit-badge">✎ Изменить</Link>
              )}
            </div>
          )}

          {rest.length > 0 && (
            <div className="post-grid">
              {rest.map((post) => (
                <div className="post-card-wrap" key={post.slug}>
                  <Link href={`/blog/${post.slug}`} className="post-card">
                    {post.hasCover && (
                      <BrandedCover variant="card" src={`/blog/cover/${post.slug}`} title={post.title} pos={post.pos} />
                    )}
                    <span className="tag tag--accent">{post.tag}</span>
                    <h3><span className="post-card__title">{post.title}</span></h3>
                    <p className="muted">{post.description}</p>
                    <div className="post-card-meta">
                      <time dateTime={new Date(post.date).toISOString()}>{formatDate(post.date)}</time>
                      <span className="post-meta-dot" aria-hidden="true">·</span>
                      <ViewBadge count={getViewCount(post.slug)} />
                    </div>
                  </Link>
                  {isAdmin && post.id && (
                    <Link href={`/admin/blog/${post.id}`} className="post-edit-badge">✎ Изменить</Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
