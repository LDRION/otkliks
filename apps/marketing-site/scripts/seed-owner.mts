// One-off CLI to create the first owner admin account — there is no public signup,
// so this is how the very first login gets created. Run: pnpm seed:owner
// (reads SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD from the environment).
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';

const email = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_OWNER_PASSWORD;

if (!email || !password) {
  console.error('Задайте SEED_OWNER_EMAIL и SEED_OWNER_PASSWORD в окружении перед запуском.');
  process.exit(1);
}

if (password.length < 8) {
  console.error('SEED_OWNER_PASSWORD должен быть не короче 8 символов.');
  process.exit(1);
}

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'otkliks.sqlite3'));

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor')),
    created_at INTEGER NOT NULL
  );
`);

const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(email);
if (existing) {
  console.log(`Аккаунт ${email} уже существует — пропускаю.`);
  process.exit(0);
}

const passwordHash = bcrypt.hashSync(password, 12);
db.prepare(
  'INSERT INTO admins (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)'
).run(email, passwordHash, 'owner', Date.now());

console.log(`Создан owner-аккаунт: ${email}`);
