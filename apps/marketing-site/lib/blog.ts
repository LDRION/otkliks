// Блог в БД: посты создаёт админ через /admin/blog (текст в Markdown + обложка).
// Хранилище — тот же SQLite, что и остальное (data/ симлинкнут в стабильный
// /var/www/hhpilot/data, переживает пересборку). Обложки кладём BLOB-ом прямо в базу —
// так они не зависят от эфемерной ФС standalone-бандла и раздаются отдельным route.
import { db } from './db';

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tag TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    cover_mime TEXT,
    cover_data BLOB,
    published INTEGER NOT NULL DEFAULT 0,
    published_at INTEGER,
    updated_at INTEGER NOT NULL,
    author_email TEXT
  );
`);

// Точка кадрирования обложки (object-position, «x% y%»), которую редактор задаёт
// перетаскиванием. Колонку добавляем миграцией — таблица могла быть создана раньше.
try { db.exec("ALTER TABLE posts ADD COLUMN cover_pos TEXT NOT NULL DEFAULT '50% 50%'"); }
catch { /* колонка уже есть */ }

export type DbPost = {
  id: number;
  slug: string;
  title: string;
  description: string;
  tag: string;
  body: string;
  hasCover: boolean;
  coverPos: string;
  published: boolean;
  publishedAt: number | null;
  updatedAt: number;
  authorEmail: string | null;
};

type Row = {
  id: number; slug: string; title: string; description: string; tag: string; body: string;
  cover_mime: string | null; cover_pos: string | null; published: number; published_at: number | null;
  updated_at: number; author_email: string | null;
};

function toPost(r: Row): DbPost {
  return {
    id: r.id, slug: r.slug, title: r.title, description: r.description, tag: r.tag, body: r.body,
    hasCover: !!r.cover_mime, coverPos: r.cover_pos || '50% 50%',
    published: !!r.published, publishedAt: r.published_at,
    updatedAt: r.updated_at, authorEmail: r.author_email,
  };
}

// Транслитерация кириллицы для человекочитаемого slug.
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugify(input: string): string {
  return String(input || '')
    .toLowerCase()
    .split('')
    .map((ch) => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `post-${Date.now()}`;
}

export function uniqueSlug(base: string, excludeId?: number): string {
  const root = slugify(base);
  let slug = root;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const row = db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug) as { id: number } | undefined;
    if (!row || row.id === excludeId) return slug;
    slug = `${root}-${n}`;
    n += 1;
  }
}

const LIST_COLS = 'id, slug, title, description, tag, body, cover_mime, cover_pos, published, published_at, updated_at, author_email';

export function listPosts(opts: { publishedOnly?: boolean } = {}): DbPost[] {
  const where = opts.publishedOnly ? 'WHERE published = 1' : '';
  const rows = db
    .prepare(`SELECT ${LIST_COLS} FROM posts ${where} ORDER BY COALESCE(published_at, updated_at) DESC`)
    .all() as Row[];
  return rows.map(toPost);
}

export function getPostBySlug(slug: string): DbPost | null {
  const r = db.prepare(`SELECT ${LIST_COLS} FROM posts WHERE slug = ?`).get(slug) as Row | undefined;
  return r ? toPost(r) : null;
}

export function getPostById(id: number): DbPost | null {
  const r = db.prepare(`SELECT ${LIST_COLS} FROM posts WHERE id = ?`).get(id) as Row | undefined;
  return r ? toPost(r) : null;
}

export function createPost(data: {
  title: string; description: string; tag: string; body: string; published: boolean;
  coverPos?: string; authorEmail?: string;
}): number {
  const now = Date.now();
  const slug = uniqueSlug(data.title);
  const res = db
    .prepare(
      `INSERT INTO posts (slug, title, description, tag, body, cover_pos, published, published_at, updated_at, author_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      slug, data.title, data.description, data.tag, data.body, data.coverPos || '50% 50%',
      data.published ? 1 : 0, data.published ? now : null, now, data.authorEmail ?? null,
    );
  return Number(res.lastInsertRowid);
}

export function updatePost(id: number, data: {
  title: string; description: string; tag: string; body: string; published: boolean; coverPos?: string;
}): void {
  const now = Date.now();
  const cur = getPostById(id);
  if (!cur) return;
  // slug менять при правке названия не будем автоматически — ссылки должны быть стабильны.
  const publishedAt = data.published ? (cur.publishedAt ?? now) : cur.publishedAt;
  db.prepare(
    `UPDATE posts SET title = ?, description = ?, tag = ?, body = ?, cover_pos = ?, published = ?, published_at = ?, updated_at = ? WHERE id = ?`,
  ).run(data.title, data.description, data.tag, data.body, data.coverPos || cur.coverPos, data.published ? 1 : 0, publishedAt, now, id);
}

export function deletePost(id: number): void {
  db.prepare('DELETE FROM posts WHERE id = ?').run(id);
}

export function setCover(id: number, mime: string, buffer: Buffer): void {
  db.prepare('UPDATE posts SET cover_mime = ?, cover_data = ?, updated_at = ? WHERE id = ?')
    .run(mime, buffer, Date.now(), id);
}

export function getCover(slug: string): { mime: string; data: Buffer } | null {
  const r = db.prepare('SELECT cover_mime, cover_data FROM posts WHERE slug = ?').get(slug) as
    | { cover_mime: string | null; cover_data: Uint8Array | null }
    | undefined;
  if (!r || !r.cover_mime || !r.cover_data) return null;
  return { mime: r.cover_mime, data: Buffer.from(r.cover_data) };
}
