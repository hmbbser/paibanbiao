import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import express from 'express';
import { activeUpdate, createUpdateStore, redactLog } from '../server/update-store.js';
import { createUpdateService, createUpdateWriteGuard, registerUpdateRoutes, resolveDeployment } from '../server/update-service.js';
import { backupDatabase, executeUpdate, runCommand, verifyDatabase } from '../server/update-worker.js';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const previousCommit = 'a'.repeat(40);
const targetCommit = 'b'.repeat(40);
const self = (source = '/srv/schedule') => ({
  Id: 'old-container', Image: 'sha256:old-image',
  Config: { Image: 'schedule:latest', Env: ['DB_PATH=/app/data/app.sqlite', 'SESSION_SECRET=test-private'], Labels: {
    'com.docker.compose.project': 'schedule', 'com.docker.compose.service': 'schedule',
    'com.docker.compose.project.config_files': `${source}/docker-compose.yml`
  } },
  Mounts: [{ Type: 'bind', Source: source, Destination: '/opt/cute-schedule' },
    { Type: 'volume', Source: '/var/lib/docker/volumes/schedule-data/_data', Destination: '/app/data' }]
});

test('update logs and result persist, hide tokens and reject duplicate jobs', t => {
  const root = workspace(t);
  const store = createUpdateStore(root);
  const { job, token } = store.create({ currentVersion: '0.2.14' });
  assert.throws(() => createUpdateStore(root).create(), error => error.status === 409);
  store.log(job.id, '\u001b[31merror\u001b[0m\npassword=private token=private2 Authorization: Bearer private3 https://user:private4@example.com ghp_private5');
  store.patch(job.id, { status: 'running', phase: 'build', progress: 35 });
  const reopened = createUpdateStore(root);
  assert.equal(activeUpdate(reopened.read()), true);
  assert.equal(reopened.accepts(token, reopened.read()), true);
  assert.equal(reopened.accepts('c'.repeat(64), reopened.read()), false);
  assert.equal(reopened.accepts('short', reopened.read()), false);
  const visible = reopened.publicJob();
  assert.equal(visible.tokenHash, undefined);
  assert.equal(visible.logs[1].message, 'error');
  assert.doesNotMatch(JSON.stringify(visible), /private|\u001b/);
  assert.ok(visible.logs.every(line => Number.isFinite(Date.parse(line.time))));
  reopened.finish(job.id, 'failed', 'build failed token=private6');
  assert.doesNotMatch(JSON.stringify(reopened.publicJob()), /private6/);
  assert.equal(activeUpdate(reopened.read()), false);
  assert.equal(reopened.create().job.status, 'queued');
  assert.throws(() => reopened.read('../outside'), /无效/);
});

test('log output is bounded and malformed partial lines do not break status', t => {
  const store = createUpdateStore(workspace(t));
  const { job } = store.create();
  store.log(job.id, Array.from({ length: 1200 }, (_, i) => `${i} ${'x'.repeat(1990)}`).join('\n'));
  fs.appendFileSync(path.join(store.jobDir(job.id), 'logs.jsonl'), '{partial');
  assert.ok(fs.statSync(path.join(store.jobDir(job.id), 'logs.jsonl')).size <= 2 * 1024 * 1024);
  assert.ok(store.publicJob().logs.length <= 300);
  assert.equal(redactLog('Authorization=Bearer secret-value'), 'Authorization=[redacted]');
});

test('deployment inspection uses the real host directory and rejects unsafe compose paths', () => {
  assert.equal(resolveDeployment(self(), '/opt/cute-schedule', '/app/data').hostAppDir, '/srv/schedule');
  assert.throws(() => resolveDeployment({ ...self(), Mounts: [] }, '/opt/cute-schedule', '/app/data'), /挂载/);
  const invalid = self();
  invalid.Config.Labels['com.docker.compose.project.config_files'] = '/etc/other.yml';
  assert.throws(() => resolveDeployment(invalid, '/opt/cute-schedule', '/app/data'), /Compose 配置/);
});

test('write guard pauses SQLite writers, allows status and tracks aborted async requests', () => {
  let job = null;
  const guard = createUpdateWriteGuard({ read: () => job });
  function request(method, pathname) {
    const res = new EventEmitter();
    res.end = () => res;
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.body = body; return res.end(); };
    let passed = false;
    guard.middleware({ method, path: pathname }, res, () => { passed = true; });
    return { res, passed };
  }
  const pending = request('POST', '/auth/login');
  assert.equal(guard.activeWrites, 1);
  pending.res.emit('close');
  assert.equal(guard.activeWrites, 1);
  job = { status: 'running', phase: 'backup' };
  for (const [method, pathname] of [['POST', '/auth/login'], ['PUT', '/accounts/a'], ['GET', '/audit-logs'], ['GET', '/admin/export'], ['GET', '/accounts/a/messages']]) {
    const blocked = request(method, pathname);
    assert.equal(blocked.passed, false);
    assert.equal(blocked.res.statusCode, 503);
  }
  for (const pathname of ['/admin/update/status', '/accounts', '/auth/me', '/health']) assert.equal(request('GET', pathname).passed, true);
  pending.res.end();
  pending.res.emit('finish');
  assert.equal(guard.activeWrites, 0);
});

test('unsupported local update fails visibly and permits retry', async t => {
  const root = workspace(t);
  const service = createUpdateService({ dataDir: root, dbPath: path.join(root, 'app.sqlite'), appDir: root, appVersion: '0.2.14', githubBranch: 'main', platform: 'win32' });
  await service.start();
  assert.equal((await service.status()).status, 'failed');
  assert.match((await service.status()).message, /Linux Docker/);
  await service.start();
  assert.equal((await service.status()).status, 'failed');
});

test('worker launch uses mounted data and current image; duplicate requests are rejected', async t => {
  const root = workspace(t);
  const deployment = self();
  deployment.Mounts[1].Destination = root;
  const calls = [];
  let release;
  let config;
  const service = createUpdateService({ dataDir: root, dbPath: path.join(root, 'app.sqlite'), appDir: '/opt/cute-schedule', appVersion: '0.2.14', githubBranch: 'main', platform: 'linux', selfId: () => 'old-container',
    run: async (file, args) => {
      calls.push([file, args]);
      if (args[0] === 'inspect') return { stdout: JSON.stringify([deployment]) };
      config = JSON.parse(fs.readFileSync(args.at(-1), 'utf8'));
      await new Promise(resolve => { release = resolve; });
      return { stdout: 'worker-id' };
    }
  });
  const result = await service.start();
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(service.start(), error => error.status === 409);
  assert.equal(config.appDir, '/srv/schedule');
  assert.equal(config.dbPath, path.join(root, 'app.sqlite'));
  assert.equal(calls[1][1].includes('--volumes-from'), true);
  assert.equal(calls[1][1].includes('--rm'), true);
  assert.equal(calls[1][1].includes('sha256:old-image'), true);
  release();
  await new Promise(resolve => setImmediate(resolve));
  service.store.finish(result.job.id, 'succeeded', 'done');
});

test('failed worker launch removes private environment config and records the cause', async t => {
  const root = workspace(t);
  const deployment = self();
  deployment.Mounts[1].Destination = root;
  const service = createUpdateService({ dataDir: root, dbPath: path.join(root, 'app.sqlite'), appDir: '/opt/cute-schedule', appVersion: '0.2.14', githubBranch: 'main', platform: 'linux', selfId: () => 'old-container',
    run: async (_file, args) => {
      if (args[0] === 'inspect') return { stdout: JSON.stringify([deployment]) };
      throw new Error('docker failed token=private-value');
    }
  });
  const result = await service.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.store.read().status, 'failed');
  assert.doesNotMatch(service.store.read().message, /private-value/);
  assert.equal(fs.existsSync(path.join(service.store.jobDir(result.job.id), 'config.json')), false);
});

test('interrupted updates release locks but Docker connection errors preserve a running job', async t => {
  const root = workspace(t);
  let output = { stdout: JSON.stringify({ Running: false, ExitCode: 137 }) };
  let error;
  const service = createUpdateService({ dataDir: root, appDir: root, appVersion: '0.2.14', run: async () => { if (error) throw error; return output; } });
  let { job } = service.store.create();
  service.store.patch(job.id, { workerName: 'worker', status: 'running', updatedAt: '' });
  service.store.save({ ...service.store.read(), updatedAt: '2000-01-01T00:00:00Z' });
  assert.equal((await service.status()).status, 'failed');
  ({ job } = service.store.create());
  service.store.patch(job.id, { workerName: 'worker', status: 'running' });
  service.store.save({ ...service.store.read(), updatedAt: '2000-01-01T00:00:00Z' });
  error = new Error('Cannot connect to Docker daemon');
  assert.equal((await service.status()).status, 'running');
  error = new Error('No such container: worker');
  assert.equal((await service.status()).status, 'failed');
});

test('status token survives session loss and only grants access to the latest update status', async t => {
  const store = createUpdateStore(workspace(t));
  const { job, token } = store.create();
  const app = express();
  app.use(express.json());
  const auth = (req, res, next) => req.headers['x-role'] ? (req.user = { id: 'admin', role: req.headers['x-role'] }, next()) : res.status(401).json({ error: 'auth' });
  const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'admin' });
  registerUpdateRoutes(app, { service: { store, status: async () => store.publicJob(), start: async () => ({ job: store.publicJob(), token }) }, requireAuth: auth, requireAdmin: admin, audit: () => {} });
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/admin/update`;
  assert.equal((await fetch(`${base}/status`)).status, 401);
  assert.equal((await fetch(`${base}/status`, { headers: { 'x-role': 'user' } })).status, 403);
  assert.equal((await fetch(`${base}/status`, { headers: { Authorization: `Bearer ${'c'.repeat(64)}` } })).status, 401);
  const response = await fetch(`${base}/status`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).job.tokenHash, undefined);
  assert.equal((await fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status, 401);
  assert.equal((await fetch(base, { method: 'POST', headers: { 'x-role': 'admin', 'Content-Type': 'application/json' }, body: '{}' })).status, 202);
  store.finish(job.id, 'failed', 'done');
  store.create();
  assert.equal((await fetch(`${base}/status`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
});

test('SQLite online backup is a valid import archive and detects missing original records', async t => {
  const root = workspace(t);
  const dbPath = path.join(root, 'app.sqlite');
  const database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('siteName', 'Test'); CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT); INSERT INTO users VALUES ('u1', 'Admin'); CREATE TABLE audit_logs (id TEXT);");
  // Close SQLite before workspace cleanup; Windows cannot remove an open DB.
  const backupDir = path.join(root, 'backup');
  fs.mkdirSync(backupDir);
  try {
    await backupDatabase(dbPath, backupDir);
    const zip = new AdmZip(path.join(backupDir, 'data-backup.zip'));
    assert.equal(JSON.parse(zip.readAsText('manifest.json')).app, 'cute-schedule');
    assert.equal(JSON.parse(zip.readAsText('data.json')).users[0].id, 'u1');
    verifyDatabase(dbPath, path.join(backupDir, 'database.sqlite'));
    database.prepare('DELETE FROM users').run();
    assert.throws(() => verifyDatabase(dbPath, path.join(backupDir, 'database.sqlite')), /users 缺少 1 条/);
  } finally { database.close(); }
});

function workerFixture(t, options = {}) {
  const root = workspace(t);
  const store = createUpdateStore(path.join(root, 'data'));
  const { job } = store.create();
  const composeFile = path.join(root, 'docker-compose.yml');
  fs.writeFileSync(composeFile, 'original compose');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.2.15' }));
  fs.writeFileSync(path.join(store.jobDir(job.id), 'config.json'), '{}');
  const config = { id: job.id, dataDir: path.join(root, 'data'), dbPath: path.join(root, 'data/app.sqlite'), appDir: root, githubBranch: 'main', currentVersion: '0.2.14', currentCommit: previousCommit, project: 'schedule', service: 'schedule', composeFiles: [composeFile], container: 'old-container', image: 'sha256:old', imageRef: 'schedule:latest', env: ['PORT=8080'] };
  const calls = [];
  let switched = false;
  let rollback = false;
  const run = async (file, args, commandOptions) => {
    calls.push([file, args]);
    if (file === 'git') {
      if (args.includes('--porcelain')) return options.dirty ? ' M file' : '';
      if (args.includes('rev-parse')) return args.includes('FETCH_HEAD') ? targetCommit : previousCommit;
    }
    if (args.includes('build')) {
      commandOptions.log('build output line');
      if (options.buildFails) throw new Error('build failed');
    }
    if (args[0] === 'tag' && args.at(-1) === config.imageRef) rollback = true;
    if (args.includes('up')) {
      switched = true;
      if (options.restartFails && !rollback) throw new Error('restart failed');
    }
    if (args.includes('ps')) return switched ? (rollback ? 'restored-container' : 'new-container') : 'old-container';
    if (args[0] === 'exec') return JSON.stringify({ ok: true, version: switched && !rollback ? '0.2.15' : '0.2.14', commit: switched && !rollback ? (options.wrongCommit ? previousCommit : targetCommit) : previousCommit, activeWrites: options.busy ? 1 : 0 });
    return '';
  };
  return { root, store, config, calls, deps: { run, sleep: async () => {}, backup: async () => { calls.push(['backup']); fs.writeFileSync(path.join(store.jobDir(job.id), 'backup/database.sqlite'), 'backup'); }, verify: () => { calls.push(['verify']); if (options.verifyFails) throw new Error('original data missing'); } } };
}

test('successful update backs up before restart and finishes only after health and data checks', async t => {
  const f = workerFixture(t);
  await executeUpdate(f.config, f.deps);
  const job = f.store.publicJob();
  assert.equal(job.status, 'succeeded');
  assert.equal(job.progress, 100);
  assert.equal(job.latestVersion, '0.2.15');
  const backupIndex = f.calls.findIndex(([file]) => file === 'backup');
  const restartIndex = f.calls.findIndex(([, args]) => args?.includes('up'));
  assert.ok(backupIndex < restartIndex);
  assert.ok(f.calls.findIndex(([file]) => file === 'verify') > restartIndex);
  assert.ok(job.logs.some(line => line.message === 'build output line'));
  assert.ok(job.logs.some(line => /备份完成/.test(line.message)));
  assert.equal(fs.existsSync(path.join(f.store.jobDir(job.id), 'config.json')), false);
  assert.equal(f.store.create().job.status, 'queued');
});

for (const [name, options, pattern] of [
  ['dirty working tree', { dirty: true }, /未提交改动/],
  ['image build failure', { buildFails: true }, /build failed/],
  ['pending database write', { busy: true }, /数据写入未结束/]
]) test(`${name} preserves old service and releases update lock`, async t => {
  const f = workerFixture(t, options);
  await executeUpdate(f.config, f.deps);
  assert.equal(f.store.read().status, 'failed');
  assert.match(f.store.read().message, pattern);
  assert.equal(f.calls.some(([, args]) => args?.includes('up')), false);
  assert.match(f.store.read().recovery, /旧服务未被替换/);
  f.store.create();
});

for (const options of [{ restartFails: true }, { verifyFails: true }, { wrongCommit: true }]) test(`failed cutover restores the original image: ${JSON.stringify(options)}`, async t => {
  const f = workerFixture(t, options);
  await executeUpdate(f.config, f.deps);
  assert.equal(f.store.read().status, 'failed');
  assert.match(f.store.read().recovery, /已恢复原镜像/);
  assert.equal(f.calls.filter(([, args]) => args?.includes('up')).length, 2);
  assert.ok(f.calls.some(([file, args]) => file === 'docker' && args[0] === 'tag' && args.at(-1) === 'schedule:latest'));
  assert.equal(fs.readFileSync(f.config.composeFiles[0], 'utf8'), 'original compose');
});

test('command runner streams output and surfaces process failure and timeout', async () => {
  const logs = [];
  await runCommand(process.execPath, ['-e', "console.log('build line');process.stderr.write('last line')"], { log: line => logs.push(line) });
  assert.deepEqual(logs, ['build line', 'last line']);
  await assert.rejects(runCommand(process.execPath, ['-e', "console.error('failed');process.exit(2)"]), /退出码 2/);
  await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 100 }), /超时/);
});
