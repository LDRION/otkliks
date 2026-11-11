import { db } from './db';

export function getViewCount(slug: string): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM post_views WHERE slug = ?').get(slug) as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
}

export function recordView(slug: string, visitorId: string): number {
  db.prepare(
    'INSERT OR IGNORE INTO post_views (slug, visitor_id, viewed_at) VALUES (?, ?, ?)'
  ).run(slug, visitorId, Date.now());
  return getViewCount(slug);
}
