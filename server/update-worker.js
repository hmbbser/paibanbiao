import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import { createUpdateStore, redactLog } from './update-store.js';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
export function runCommand(file, args, { cwd, env, log = () => {}, timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0', BUILDKIT_PROGRESS: 'plain' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let pending = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    function consume(chunk) {
      const text = chunk.toString();
      output = (output + text).slice(-64 * 1024);
      pending += text;
      const lines = pending.split(/[\r\n]+/);
      pending = lines.pop() || '';
      for (const line of lines) if (line) log(line);
      if (pending.length > 2000) { log(pending.slice(0, 2000)); pending = ''; }
    }
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (pending) log(pending);
      if (code === 0 && !timedOut) resolve(output.trim());
      else reject(new Error(timedOut ? `${file} 执行超时` : `${file} 执行失败（退出码 ${code}）：${redactLog(output.trim().slice(-1800))}`));
    });
  });
}

const tableKeys = { settings: ['key'], users: ['id'], accounts: ['id'], mailboxes: ['id'], account_names: ['id'], bookings: ['id'], mail_message_reads: ['mailbox_id', 'message_id'] };
export async function backupDatabase(dbPath, directory) {
  const database = new Database(dbPath, { fileMustExist: true });
  try {
    await database.backup(path.join(directory, 'database.sqlite'));
  } finally { database.close(); }
  const snapshot = new Database(path.join(directory, 'database.sqlite'), { readonly: true });
  try {
    const tables = [...Object.keys(tableKeys), 'audit_logs'].filter(table => snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
    const payload = Object.fromEntries(tables.map(table => [table, snapshot.prepare(`SELECT * FROM ${table}`).all()]));
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({ app: 'cute-schedule', version: 1, exportedAt: new Date().toISOString(), tables })));
    zip.addFile('data.json', Buffer.from(JSON.stringify(payload)));
    zip.writeZip(path.join(directory, 'data-backup.zip'));
  } finally { snapshot.close(); }
}

export function verifyDatabase(dbPath, backupPath) {
  const database = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (database.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('数据库完整性检查未通过');
    database.prepare('ATTACH DATABASE ? AS before_update').run(backupPath);
    for (const [table, keys] of Object.entries(tableKeys)) {
      if (!database.prepare("SELECT name FROM before_update.sqlite_master WHERE name=? AND type='table'").get(table)) continue;
      const match = keys.map(key => `current.${key} = previous.${key}`).join(' AND ');
      const missing = database.prepare(`SELECT COUNT(*) AS count FROM before_update.${table} previous WHERE NOT EXISTS (SELECT 1 FROM main.${table} current WHERE ${match})`).get().count;
      if (missing) throw new Error(`数据检查未通过：${table} 缺少 ${missing} 条原记录，备份已保留`);
    }
  } finally { database.close(); }
}

export async function executeUpdate(config, { run = runCommand, sleep = delay, backup = backupDatabase, verify = verifyDatabase } = {}) {
  const store = createUpdateStore(config.dataDir);
  const directory = store.jobDir(config.id);
  const backupDir = path.join(directory, 'backup');
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const log = message => store.log(config.id, message);
  const stage = (phase, progress, message, extra = {}) => store.patch(config.id, { ...extra, status: 'running', phase, progress, message });
  const env = Object.fromEntries((config.env || []).map(item => { const index = item.indexOf('='); return [item.slice(0, index), item.slice(index + 1)]; }));
  const command = (file, args, options = {}) => run(file, args, { cwd: config.appDir, env, log, ...options });
  const git = (...args) => command('git', ['-c', `safe.directory=${config.appDir}`, ...args]);
  let composeBin = 'docker';
  let composePrefix = ['compose'];
  const composeArgs = ['-p', config.project, '--project-directory', config.appDir, ...config.composeFiles.flatMap(file => ['-f', file])];
  const compose = (args, options) => command(composeBin, [...composePrefix, ...composeArgs, ...args], options);
  const dbPath = config.dbPath || path.join(config.dataDir, 'app.sqlite');
  const rollbackTag = `cute-schedule-rollback:${config.id}`;
  let switched = false;
  let targetCommit;
  let latestVersion;
  const heartbeat = setInterval(() => store.patch(config.id, {}), 5000);
  async function health(expectedVersion, expectedCommit, requireNew = true) {
    let last = '服务尚未就绪';
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const id = await compose(['ps', '-q', config.service], { log: () => {}, timeout: 10_000 });
        if (!id || (requireNew && id === config.container)) throw new Error('等待新容器启动');
        const script = "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health', {signal:AbortSignal.timeout(4000)}).then(async r=>{if(!r.ok)throw Error('HTTP '+r.status);console.log(JSON.stringify(await r.json()))}).catch(e=>{console.error(e.message);process.exit(1)})";
        const value = JSON.parse(await command('docker', ['exec', id, 'node', '-e', script], { log: () => {}, timeout: 10_000 }));
        if (value.ok && value.version === expectedVersion && (!expectedCommit || value.commit === expectedCommit)) return value;
        last = `等待版本 ${expectedVersion} 启动（当前 ${value.version || '未知'}）`;
      } catch (error) { last = error.message; }
      await sleep(3000);
    }
    throw new Error(`服务健康检查超时：${last}`);
  }
  try {
    stage('preflight', 5, '检查 Git、Docker Compose 与工作目录');
    try { await command('docker', ['compose', 'version']); }
    catch { composeBin = 'docker-compose'; composePrefix = []; await command(composeBin, ['version']); }
    await git('check-ref-format', '--branch', config.githubBranch);
    const dirty = await git('status', '--porcelain');
    if (dirty && !config.force) throw new Error('服务器目录有未提交改动，请先保存改动，或勾选强制更新后重试');
    const currentCommit = await git('rev-parse', 'HEAD');
    if (!/^[a-f0-9]{40,64}$/.test(currentCommit)) throw new Error('无法确定当前 Git 版本');
    stage('source-backup', 12, '备份当前源码与配置', { previousCommit: currentCommit, backupPath: backupDir });
    await command('tar', ['-czf', path.join(backupDir, 'source.tar.gz'), '--exclude=./.git', '--exclude=./node_modules', '--exclude=./dist', '--exclude=./data', '.']);
    const savedCompose = config.composeFiles.map((file, index) => {
      const saved = path.join(backupDir, `compose-${index}.yml`);
      fs.copyFileSync(file, saved);
      return saved;
    });
    await command('docker', ['tag', config.image, rollbackTag]);
    store.writeJson(path.join(backupDir, 'recovery.json'), { previousCommit: currentCommit, image: rollbackTag, project: config.project, service: config.service, appDir: config.appDir });
    stage('fetch', 20, '从 GitHub 获取最新代码');
    await git('fetch', '--no-tags', 'origin', config.githubBranch);
    targetCommit = await git('rev-parse', 'FETCH_HEAD');
    if (!/^[a-f0-9]{40,64}$/.test(targetCommit)) throw new Error('远端返回了无效的 Git 版本');
    await git('reset', '--hard', targetCommit);
    latestVersion = JSON.parse(fs.readFileSync(path.join(config.appDir, 'package.json'), 'utf8')).version;
    if (typeof latestVersion !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(latestVersion)) throw new Error('新版 package.json 缺少有效版本号');
    stage('build', 35, '正在构建新版镜像，旧服务继续运行；首次构建可能需要十几分钟', { latestVersion, targetCommit });
    await compose(['build', '--build-arg', `APP_COMMIT=${targetCommit}`, config.service], { timeout: 20 * 60_000 });
    stage('backup', 75, '镜像构建完成，暂停数据写入并备份数据库');
    // Existing writes must finish before taking the snapshot. The API blocks new writes in this phase.
    let drained = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = await health(config.currentVersion, undefined, false);
      if (state.activeWrites === 0) { drained = true; break; }
      await sleep(1000);
    }
    if (!drained) throw new Error('仍有数据写入未结束，已取消切换，请稍后重试');
    await backup(dbPath, backupDir);
    log('数据库备份完成，可通过“备份 → 导入”恢复 data-backup.zip');
    stage('restart', 85, '正在切换并重启服务，页面将自动重新连接');
    switched = true;
    await compose(['up', '-d', '--no-build', '--force-recreate', '--no-deps', config.service], { timeout: 180_000 });
    stage('verify', 95, '检查新版本、服务健康及原有数据记录');
    await health(latestVersion, targetCommit);
    verify(dbPath, path.join(backupDir, 'database.sqlite'));
    store.finish(config.id, 'succeeded', `已更新到 v${latestVersion}，服务健康与数据检查通过`, { phase: 'done' });
    log('更新完成；服务器备份与日志已保留');
    // Keep the saved compose paths available for recovery without changing deployment labels on success.
    return { savedCompose };
  } catch (error) {
    log(`更新失败：${error.message}`);
    let recovery = switched ? '切换未完成，备份已保留，请检查服务器状态' : '旧服务未被替换，备份与日志已保留';
    if (switched) {
      try {
        stage('rollback', 95, '新版未通过检查，正在尝试恢复原镜像');
        await command('docker', ['tag', rollbackTag, config.imageRef]);
        config.composeFiles.forEach((file, index) => fs.copyFileSync(path.join(backupDir, `compose-${index}.yml`), file));
        await compose(['up', '-d', '--no-build', '--force-recreate', '--no-deps', config.service], { timeout: 180_000 });
        await health(config.currentVersion, undefined, false);
        recovery = '已恢复原镜像；数据库未自动覆盖，请根据日志确认数据状态';
      } catch (rollbackError) { recovery = `自动恢复原镜像失败：${redactLog(rollbackError.message)}；请使用服务器备份恢复`; }
    }
    store.finish(config.id, 'failed', `更新失败：${error.message}`, { recovery });
    return { error: error.message };
  } finally {
    clearInterval(heartbeat);
    const configPath = path.join(directory, 'config.json');
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  await executeUpdate(config);
}
