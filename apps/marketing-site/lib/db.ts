import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'otkliks.sqlite3');

function createDb(): DatabaseSync {
  const instance = new DatabaseSync(DB_PATH);
  // next build spawns several worker processes in parallel to collect page data — on a
  // fresh checkout (no data/ yet) they race to create+init this same file, and SQLite's
  // default mode throws "database is locked" instead of waiting. busy_timeout makes it
  // retry for up to 5s before giving up, which is enough for the CREATE TABLE below to
  // finish in whichever worker gets there first.
  instance.exec('PRAGMA busy_timeout = 5000;');
  instance.exec(`
    CREATE TABLE IF NOT EXISTS post_views (
      slug TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      viewed_at INTEGER NOT NULL,
      PRIMARY KEY (slug, visitor_id)
    );

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor')),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS counselling_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return instance;
}

// Next.js dev/HMR can re-evaluate this module multiple times in the same process —
// cache the connection on globalThis so we don't reopen the file (and leak handles)
// on every edit, same pattern as the usual Prisma-in-dev singleton trick.
const globalForDb = globalThis as unknown as { __otkliksDb?: DatabaseSync };

export const db = globalForDb.__otkliksDb ?? createDb();

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__otkliksDb = db;
}
