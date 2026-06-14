import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'app.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const TABLES = ['settings', 'users', 'accounts', 'mailboxes', 'account_names', 'bookings', 'audit_logs'];

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
      mailbox_id TEXT,
      sort_order INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mailboxes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      client_id TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_names (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
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

  const accountColumns = db.prepare('PRAGMA table_info(accounts)').all().map((column) => column.name);
  if (!accountColumns.includes('sort_order')) {
    db.exec('ALTER TABLE accounts ADD COLUMN sort_order INTEGER;');
  }
  if (!accountColumns.includes('mailbox_id')) {
    db.exec('ALTER TABLE accounts ADD COLUMN mailbox_id TEXT;');
  }
  const mailboxColumns = db.prepare('PRAGMA table_info(mailboxes)').all().map((column) => column.name);
  if (!mailboxColumns.includes('remark')) {
    db.exec("ALTER TABLE mailboxes ADD COLUMN remark TEXT DEFAULT '';");
  }
  ensureAccountSortOrder();

  const defaults = [
    ['siteName', '甜排班'],
    ['timezone', 'Asia/Shanghai'],
    ['defaultView', 'day'],
    ['exportVersion', '1']
  ];
  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  defaults.forEach((row) => stmt.run(row));

  const existingNames = db.prepare('SELECT COUNT(*) as count FROM account_names').get();
  if (existingNames.count === 0) {
    const insertName = db.prepare('INSERT OR IGNORE INTO account_names (id, name, created_at) VALUES (?, ?, ?)');
    const names = db.prepare("SELECT DISTINCT name FROM accounts WHERE TRIM(name) != '' ORDER BY created_at ASC").all();
    for (const item of names) {
      insertName.run(cryptoRandomId(), item.name, new Date().toISOString());
    }
  }
}

function cryptoRandomId() {
  return `name-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
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
    insertRows('mailboxes', payload.mailboxes);
    insertRows('account_names', payload.account_names);
    insertRows('bookings', payload.bookings);
    insertRows('audit_logs', payload.audit_logs);
    db.exec('PRAGMA foreign_keys = ON;');
  });
  transaction();
  ensureAccountSortOrder();
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

function ensureAccountSortOrder() {
  const rows = db.prepare('SELECT id FROM accounts WHERE sort_order IS NULL ORDER BY created_at ASC').all();
  if (!rows.length) return;
  const current = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as value FROM accounts WHERE sort_order IS NOT NULL').get();
  const update = db.prepare('UPDATE accounts SET sort_order = ? WHERE id = ?');
  rows.forEach((row, index) => update.run(Number(current.value || 0) + (index + 1) * 10, row.id));
}
