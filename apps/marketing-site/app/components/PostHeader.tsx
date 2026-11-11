import { ViewBadge } from './ViewBadge';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });

export function PostHeader({
  tag,
  title,
  publishedAt,
  viewCount,
}: {
  tag: string;
  title: string;
  publishedAt: string;
  viewCount: number;
}) {
  return (
    <header className="post-header">
      <span className="eyebrow">{tag}</span>
      <h1 style={{ marginTop: 18, maxWidth: 760 }}>{title}</h1>
      <div className="post-meta">
        <time dateTime={publishedAt}>{formatDate(publishedAt)}</time>
        <span className="post-meta-dot" aria-hidden="true">
          ·
        </span>
        <ViewBadge count={viewCount} />
      </div>
    </header>
  );
}
