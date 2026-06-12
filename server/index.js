import express from 'express';
import session from 'express-session';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import AdmZip from 'adm-zip';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'node:url';
import { allRows, db, isSetupComplete, migrate, replaceAllData, TABLES } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const port = Number(process.env.PORT || 8080);
const dataDir = path.dirname(process.env.DB_PATH || path.join(process.cwd(), 'data', 'app.sqlite'));
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const appVersion = packageJson.version || '0.0.0';
const githubRepo = process.env.GITHUB_REPO || 'hmbbser/paibanbiao';
const githubBranch = process.env.GITHUB_BRANCH || 'main';
const appDir = process.env.APP_DIR || '/opt/cute-schedule';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

migrate();

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(
  session({
    name: 'schedule.sid',
    secret: process.env.SESSION_SECRET || 'dev-schedule-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { sameSite: 'lax', httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }
  })
);

function now() {
  return new Date().toISOString();
}

function audit(actorId, action, entityType, entityId, summary) {
  db.prepare(
    'INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(nanoid(), actorId || null, action, entityType, entityId || null, summary, now());
}

function auditRetentionDays() {
  const settings = Object.fromEntries(allRows('settings').map((item) => [item.key, item.value]));
  const raw = settings.auditRetentionDays === 'custom' ? settings.auditRetentionCustomDays : settings.auditRetentionDays;
  const days = Number(raw || 7);
  return Number.isFinite(days) && days > 0 ? days : 7;
}

function pruneAuditLogs() {
  const cutoff = new Date(Date.now() - auditRetentionDays() * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(cutoff);
}

function publicUser(user, canSwitch = false) {
  if (!user) return null;
  return { id: user.id, username: user.username, role: user.role, enabled: Boolean(user.enabled), created_at: user.created_at, can_switch: canSwitch };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '请先登录' });
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND enabled = 1').get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: '登录已失效' });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '仅管理员可操作' });
  next();
}

function assertBookingInput(input) {
  const start = new Date(input.starts_at);
  const end = new Date(input.ends_at);
  if (!input.account_id || !input.renter_name?.trim() || !input.renter_contact?.trim()) {
    return '请填写账号、租客姓名和联系方式';
  }
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return '结束时间必须晚于开始时间';
  }
  return null;
}

function accountStatusError(accountId) {
  const account = db.prepare('SELECT id, status FROM accounts WHERE id = ?').get(accountId);
  if (!account) return '账号不存在';
  if (account.status !== 'active') return '账号已停用，不能安排出租';
  return null;
}

function autoStatusForBooking(booking, current = new Date()) {
  if (booking.status === 'cancelled' || booking.status === 'ended_early') return booking.status;
  const start = new Date(booking.starts_at);
  const end = new Date(booking.ends_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return booking.status;
  if (current >= end) return 'completed';
  if (current >= start) return 'active';
  return 'reserved';
}

function refreshBookingStatuses() {
  const bookings = db.prepare("SELECT id, starts_at, ends_at, status FROM bookings WHERE status NOT IN ('cancelled', 'ended_early')").all();
  const update = db.prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ? AND status != ?');
  const timestamp = now();
  for (const booking of bookings) {
    const nextStatus = autoStatusForBooking(booking);
    if (nextStatus !== booking.status) update.run(nextStatus, timestamp, booking.id, nextStatus);
  }
}

function findConflicts({ account_id, starts_at, ends_at, excludeId }) {
  refreshBookingStatuses();
  return db
    .prepare(
      `SELECT b.*, a.name as account_name, u.username as operator_name
       FROM bookings b
       JOIN accounts a ON a.id = b.account_id
       LEFT JOIN users u ON u.id = b.operator_id
       WHERE b.account_id = ?
         AND b.status != 'cancelled'
         AND b.starts_at < ?
         AND b.ends_at > ?
         AND (? IS NULL OR b.id != ?)
       ORDER BY b.starts_at ASC`
    )
    .all(account_id, ends_at, starts_at, excludeId || null, excludeId || null);
}

function bookingList() {
  refreshBookingStatuses();
  return db
    .prepare(
      `SELECT b.*, a.name as account_name, a.login as account_login, u.username as operator_name
       FROM bookings b
       JOIN accounts a ON a.id = b.account_id
       LEFT JOIN users u ON u.id = b.operator_id
       ORDER BY b.starts_at DESC`
    )
    .all();
}

app.get('/api/setup', (_req, res) => {
  res.json({ complete: isSetupComplete() });
});

app.post('/api/setup', async (req, res) => {
  if (isSetupComplete()) return res.status(409).json({ error: '系统已初始化' });
  const { username, password, siteName } = req.body;
  if (!username?.trim() || !password || password.length < 6) {
    return res.status(400).json({ error: '用户名必填，密码至少 6 位' });
  }
  const id = nanoid();
  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO users (id, username, password_hash, role, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(
    id,
    username.trim(),
    passwordHash,
    'admin',
    now()
  );
  if (siteName?.trim()) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('siteName', siteName.trim());
  }
  audit(id, 'setup', 'system', 'setup', '创建首次管理员并完成安装向导');
  req.session.userId = id;
  req.session.adminUserId = id;
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id), true) });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND enabled = 1').get(username);
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  req.session.userId = user.id;
  req.session.adminUserId = user.role === 'admin' ? user.id : null;
  audit(user.id, 'login', 'user', user.id, '用户登录');
  res.json({ user: publicUser(user, user.role === 'admin') });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const id = req.user.id;
  req.session.destroy(() => {
    audit(id, 'logout', 'user', id, '用户退出登录');
    res.json({ ok: true });
  });
});

app.post('/api/auth/switch-user', requireAuth, (req, res) => {
  const rootAdminId = req.session.adminUserId || (req.user.role === 'admin' ? req.user.id : null);
  if (!rootAdminId) return res.status(403).json({ error: '只有管理员可以快捷切换用户' });
  const rootAdmin = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'admin' AND enabled = 1").get(rootAdminId);
  if (!rootAdmin) return res.status(403).json({ error: '管理员切换权限已失效' });
  const nextUser = db.prepare('SELECT * FROM users WHERE id = ? AND enabled = 1').get(req.body.userId);
  if (!nextUser) return res.status(404).json({ error: '用户不存在或已停用' });
  audit(req.user.id, 'switch_user', 'user', nextUser.id, `管理员快捷切换到 ${nextUser.username}`);
  req.session.adminUserId = rootAdmin.id;
  req.session.userId = nextUser.id;
  res.json({ user: publicUser(nextUser, true) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const settings = Object.fromEntries(allRows('settings').map((item) => [item.key, item.value]));
  const canSwitch = req.user.role === 'admin' || Boolean(req.session.adminUserId);
  res.json({ user: publicUser(req.user, canSwitch), settings, version: appVersion });
});

app.get('/api/settings', requireAuth, (_req, res) => {
  const settings = Object.fromEntries(allRows('settings').map((item) => [item.key, item.value]));
  res.json({ settings, version: appVersion, githubRepo, githubBranch });
});

app.put('/api/settings', requireAuth, requireAdmin, (req, res) => {
  const allowed = ['siteName', 'timezone', 'defaultView', 'auditRetentionDays', 'auditRetentionCustomDays'];
  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const key of allowed) {
    if (typeof req.body[key] === 'string') update.run(key, req.body[key].trim());
  }
  audit(req.user.id, 'update', 'settings', 'system', '修改系统基本信息');
  const settings = Object.fromEntries(allRows('settings').map((item) => [item.key, item.value]));
  res.json({ settings, version: appVersion });
});

app.get('/api/overview', requireAuth, (_req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all();
  const users = db.prepare('SELECT id, username, role, enabled, created_at FROM users ORDER BY created_at DESC').all();
  res.json({ accounts, users, bookings: bookingList() });
});

app.get('/api/accounts', requireAuth, (_req, res) => {
  res.json(db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all());
});

app.post('/api/accounts', requireAuth, requireAdmin, (req, res) => {
  const { name, login, password, remark, status = 'active' } = req.body;
  if (!name?.trim() || !login?.trim() || !password?.trim()) return res.status(400).json({ error: '账号名称、账号和密码必填' });
  const id = nanoid();
  db.prepare('INSERT INTO accounts (id, name, login, password, remark, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    name.trim(),
    login.trim(),
    password.trim(),
    remark || '',
    status,
    now()
  );
  audit(req.user.id, 'create', 'account', id, `新增账号 ${name}`);
  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
});

app.put('/api/accounts/:id', requireAuth, requireAdmin, (req, res) => {
  const { name, login, password, remark, status = 'active' } = req.body;
  db.prepare('UPDATE accounts SET name = ?, login = ?, password = ?, remark = ?, status = ? WHERE id = ?').run(
    name,
    login,
    password,
    remark || '',
    status,
    req.params.id
  );
  audit(req.user.id, 'update', 'account', req.params.id, `修改账号 ${name}`);
  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id));
});

app.delete('/api/accounts/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  audit(req.user.id, 'delete', 'account', req.params.id, '删除账号');
  res.json({ ok: true });
});

app.get('/api/users', requireAuth, requireAdmin, (_req, res) => {
  res.json(db.prepare('SELECT id, username, role, enabled, created_at FROM users ORDER BY created_at DESC').all());
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role = 'user' } = req.body;
  if (!username?.trim() || !password || password.length < 6) return res.status(400).json({ error: '用户名必填，密码至少 6 位' });
  const id = nanoid();
  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO users (id, username, password_hash, role, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(
    id,
    username.trim(),
    passwordHash,
    role === 'admin' ? 'admin' : 'user',
    now()
  );
  audit(req.user.id, 'create', 'user', id, `新增用户 ${username}`);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role = 'user', enabled = true } = req.body;
  if (password) {
    const hash = await bcrypt.hash(password, 12);
    db.prepare('UPDATE users SET username = ?, password_hash = ?, role = ?, enabled = ? WHERE id = ?').run(
      username,
      hash,
      role,
      enabled ? 1 : 0,
      req.params.id
    );
  } else {
    db.prepare('UPDATE users SET username = ?, role = ?, enabled = ? WHERE id = ?').run(username, role, enabled ? 1 : 0, req.params.id);
  }
  audit(req.user.id, 'update', 'user', req.params.id, `修改用户 ${username}`);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)));
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: '不能删除当前登录管理员' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  audit(req.user.id, 'delete', 'user', req.params.id, '删除用户');
  res.json({ ok: true });
});

app.get('/api/bookings', requireAuth, (_req, res) => {
  res.json(bookingList());
});

app.post('/api/bookings', requireAuth, (req, res) => {
  const err = assertBookingInput(req.body);
  if (err) return res.status(400).json({ error: err });
  const accountErr = accountStatusError(req.body.account_id);
  if (accountErr) return res.status(400).json({ error: accountErr });
  const conflicts = findConflicts(req.body);
  if (conflicts.length) {
    return res.status(409).json({ error: '这个时间被预约啦', conflicts });
  }
  const id = nanoid();
  const createdAt = now();
  db.prepare(
    `INSERT INTO bookings
     (id, account_id, renter_name, renter_contact, starts_at, ends_at, status, operator_id, remark, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.body.account_id,
    req.body.renter_name.trim(),
    req.body.renter_contact.trim(),
    req.body.starts_at,
    req.body.ends_at,
    req.body.status || 'reserved',
    req.user.id,
    req.body.remark || '',
    createdAt,
    createdAt
  );
  audit(req.user.id, 'create', 'booking', id, `新增出租记录 ${req.body.renter_name}`);
  res.json(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id));
});

app.put('/api/bookings/:id', requireAuth, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: '记录不存在' });
  if (req.user.role !== 'admin' && booking.operator_id !== req.user.id) return res.status(403).json({ error: '只能修改自己创建的记录' });
  const err = assertBookingInput(req.body);
  if (err) return res.status(400).json({ error: err });
  const targetAccount = db.prepare('SELECT id, status FROM accounts WHERE id = ?').get(req.body.account_id);
  if (!targetAccount) return res.status(400).json({ error: '账号不存在' });
  const targetAccountDisabled = targetAccount.status !== 'active';
  const accountChanged = req.body.account_id !== booking.account_id;
  const timeChanged = req.body.starts_at !== booking.starts_at || req.body.ends_at !== booking.ends_at;
  if (targetAccountDisabled && (accountChanged || timeChanged)) return res.status(400).json({ error: '账号已停用，不能安排出租' });
  const conflicts = findConflicts({ ...req.body, excludeId: req.params.id });
  if (conflicts.length) {
    return res.status(409).json({ error: '这个时间被预约啦', conflicts });
  }
  db.prepare(
    `UPDATE bookings
     SET account_id = ?, renter_name = ?, renter_contact = ?, starts_at = ?, ends_at = ?, status = ?, remark = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    req.body.account_id,
    req.body.renter_name.trim(),
    req.body.renter_contact.trim(),
    req.body.starts_at,
    req.body.ends_at,
    req.body.status || booking.status,
    req.body.remark || '',
    now(),
    req.params.id
  );
  audit(req.user.id, 'update', 'booking', req.params.id, `修改出租记录 ${req.body.renter_name}`);
  res.json(db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id));
});

app.patch('/api/bookings/:id/action', requireAuth, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: '记录不存在' });
  if (req.user.role !== 'admin' && booking.operator_id !== req.user.id) return res.status(403).json({ error: '只能操作自己创建的记录' });
  const { action, ends_at } = req.body;
  if (action === 'endEarly') {
    const timestamp = now();
    db.prepare("UPDATE bookings SET status = 'ended_early', ends_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, req.params.id);
  } else if (action === 'renew') {
    const accountErr = accountStatusError(booking.account_id);
    if (accountErr) return res.status(400).json({ error: '账号已停用，不能续租' });
    const newEnd = ends_at;
    if (!newEnd) return res.status(400).json({ error: '请选择新的结束时间后再续租' });
    const oldEndTime = new Date(booking.ends_at).getTime();
    const newEndTime = new Date(newEnd).getTime();
    if (Number.isNaN(newEndTime)) return res.status(400).json({ error: '请选择有效的续租时间' });
    if (newEndTime === oldEndTime) return res.status(400).json({ error: '请先选择新的结束时间后再续租' });
    if (newEndTime <= oldEndTime) return res.status(400).json({ error: '续租时间必须晚于当前结束时间' });
    const conflicts = findConflicts({ account_id: booking.account_id, starts_at: booking.starts_at, ends_at: newEnd, excludeId: booking.id });
    if (conflicts.length) {
      return res.status(409).json({ error: '续租时间已被预约啦', conflicts });
    }
    db.prepare('UPDATE bookings SET ends_at = ?, updated_at = ? WHERE id = ?').run(newEnd, now(), req.params.id);
  } else if (action === 'cancel') {
    db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
    audit(req.user.id, 'delete', 'booking', req.params.id, '删除出租记录');
    return res.json({ ok: true });
  } else {
    return res.status(400).json({ error: '未知操作' });
  }
  audit(req.user.id, action, 'booking', req.params.id, `执行 ${action}`);
  res.json(db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id));
});

app.delete('/api/bookings/:id', requireAuth, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: '记录不存在' });
  if (req.user.role !== 'admin' && booking.operator_id !== req.user.id) return res.status(403).json({ error: '只能删除自己创建的记录' });
  db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  audit(req.user.id, 'delete', 'booking', req.params.id, '删除出租记录');
  res.json({ ok: true });
});

app.get('/api/audit-logs', requireAuth, requireAdmin, (_req, res) => {
  pruneAuditLogs();
  res.json(
    db
      .prepare(
        `SELECT l.*, u.username as actor_name
         FROM audit_logs l
         LEFT JOIN users u ON u.id = l.actor_id
         ORDER BY l.created_at DESC
         LIMIT 500`
      )
      .all()
  );
});

app.delete('/api/audit-logs', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM audit_logs').run();
  res.json({ ok: true });
});

app.get('/api/admin/export', requireAuth, requireAdmin, (req, res) => {
  const manifest = {
    app: 'cute-schedule',
    version: 1,
    exportedAt: now(),
    tables: TABLES
  };
  const payload = Object.fromEntries(TABLES.map((table) => [table, allRows(table)]));
  audit(req.user.id, 'export', 'backup', null, '导出完整系统数据');
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile('data.json', Buffer.from(JSON.stringify(payload, null, 2)));
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="schedule-backup-${stamp}.zip"`);
  res.send(zip.toBuffer());
});

app.post('/api/admin/import', requireAuth, requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择备份文件' });
  let payload;
  try {
    const zip = new AdmZip(req.file.buffer);
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    payload = JSON.parse(zip.readAsText('data.json'));
    if (manifest.app !== 'cute-schedule' || manifest.version !== 1) throw new Error('版本不匹配');
    for (const table of TABLES) {
      if (!Array.isArray(payload[table])) throw new Error(`缺少 ${table}`);
    }
  } catch (error) {
    return res.status(400).json({ error: `备份文件无效：${error.message}` });
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const recoveryZip = new AdmZip();
  recoveryZip.addFile('manifest.json', Buffer.from(JSON.stringify({ app: 'cute-schedule', version: 1, exportedAt: now(), recovery: true }, null, 2)));
  recoveryZip.addFile('data.json', Buffer.from(JSON.stringify(Object.fromEntries(TABLES.map((table) => [table, allRows(table)])), null, 2)));
  const recoveryPath = path.join(dataDir, `recovery-before-import-${Date.now()}.zip`);
  recoveryZip.writeZip(recoveryPath);

  try {
    replaceAllData(payload);
    audit(null, 'import', 'backup', null, `导入完整系统数据，恢复点：${path.basename(recoveryPath)}`);
    req.session.destroy(() => {});
    res.json({ ok: true, recovery: path.basename(recoveryPath), relogin: true });
  } catch (error) {
    return res.status(500).json({ error: `导入失败，当前数据未替换：${error.message}` });
  }
});

app.get('/api/admin/version', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const url = `https://raw.githubusercontent.com/${githubRepo}/${githubBranch}/package.json`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
    const remotePackage = await response.json();
    const latest = remotePackage.version || '0.0.0';
    res.json({
      current: appVersion,
      latest,
      hasUpdate: compareVersion(latest, appVersion) > 0,
      repo: githubRepo,
      branch: githubBranch
    });
  } catch (error) {
    res.status(500).json({ error: `检测版本失败：${error.message}` });
  }
});

app.post('/api/admin/update', requireAuth, requireAdmin, async (req, res) => {
  try {
    const status = await execAsync('git status --short', { cwd: appDir, timeout: 30_000 });
    if (status.stdout.trim() && !req.body.force) {
      return res.status(409).json({ error: '服务器项目目录有未提交改动，请确认后勾选强制更新', dirty: status.stdout });
    }
    const quotedAppDir = shellQuote(appDir);
    const quotedBranch = shellQuote(githubBranch);
    const composeCommand = '(docker compose up -d --build --force-recreate --remove-orphans || docker-compose up -d --build --force-recreate --remove-orphans)';
    const command = `
      set -eu
      APP_DIR=${quotedAppDir}
      BRANCH=${quotedBranch}
      cd "$APP_DIR"
      git fetch origin "$BRANCH"
      git reset --hard "origin/$BRANCH"
      if command -v docker >/dev/null 2>&1 && [ -S /var/run/docker.sock ]; then
        SELF_ID="$(cat /etc/hostname 2>/dev/null || true)"
        SELF_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$SELF_ID" 2>/dev/null || true)"
        if [ -n "$SELF_IMAGE" ]; then
          docker rm -f cute-schedule-updater >/dev/null 2>&1 || true
          docker run -d --name cute-schedule-updater \\
            -v /var/run/docker.sock:/var/run/docker.sock \\
            -v "$APP_DIR":"$APP_DIR" \\
            -w "$APP_DIR" \\
            -e APP_DIR="$APP_DIR" \\
            -e GITHUB_BRANCH="$BRANCH" \\
            "$SELF_IMAGE" sh -lc 'set -eu; cd "$APP_DIR"; git config --global --add safe.directory "$APP_DIR" || true; git fetch origin "$GITHUB_BRANCH"; git reset --hard "origin/$GITHUB_BRANCH"; ${composeCommand}'
          exit 0
        fi
      fi
      ${composeCommand}
    `;
    audit(req.user.id, 'update_start', 'system', 'version', '开始从 GitHub 拉取更新并重启服务');
    res.json({ ok: true, message: '已开始更新，服务会自动重建并重启，请稍后刷新页面。' });
    exec(command, { cwd: appDir, timeout: 1000 * 60 * 20 }, (error, stdout, stderr) => {
      if (error) {
        console.error('self update failed', error, stdout, stderr);
      }
    });
  } catch (error) {
    res.status(500).json({ error: `启动更新失败：${error.message}` });
  }
});

function compareVersion(a, b) {
  const pa = String(a).split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(port, () => {
  console.log(`Schedule app listening on http://localhost:${port}`);
});
