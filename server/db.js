import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'app.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const TABLES = ['settings', 'users', 'accounts', 'bookings', 'audit_logs'];

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      login TEXT NOT NULL,
      password TEXT NOT NULL,
      remark TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      renter_name TEXT NOT NULL,
      renter_contact TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('reserved', 'active', 'completed', 'ended_early', 'cancelled')),
      operator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      remark TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const defaults = [
    ['siteName', '甜排班'],
    ['timezone', 'Asia/Shanghai'],
    ['defaultView', 'day'],
    ['exportVersion', '1']
  ];
  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  defaults.forEach((row) => stmt.run(row));
}

export function isSetupComplete() {
  const row = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get();
  return row.count > 0;
}

export function allRows(table) {
  return db.prepare(`SELECT * FROM ${table}`).all();
}

export function replaceAllData(payload) {
  const transaction = db.transaction(() => {
    db.exec('PRAGMA foreign_keys = OFF;');
    for (const table of [...TABLES].reverse()) {
      db.prepare(`DELETE FROM ${table}`).run();
    }

    insertRows('settings', payload.settings);
    insertRows('users', payload.users);
    insertRows('accounts', payload.accounts);
    insertRows('bookings', payload.bookings);
    insertRows('audit_logs', payload.audit_logs);
    db.exec('PRAGMA foreign_keys = ON;');
  });
  transaction();
}

function insertRows(table, rows = []) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const placeholders = keys.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`);
  for (const row of rows) {
    stmt.run(keys.map((key) => row[key]));
  }
}
