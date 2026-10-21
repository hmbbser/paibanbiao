import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { activeUpdate, createUpdateStore, redactLog } from './update-store.js';

const exec = promisify(execFile);
export function resolveDeployment(self, appDir, dataDir) {
  const labels = self.Config?.Labels || {};
  const source = self.Mounts?.find(mount => mount.Destination === appDir && mount.Type === 'bind');
  const data = self.Mounts?.find(mount => dataDir === mount.Destination || dataDir.startsWith(mount.Destination + '/'));
  const project = labels['com.docker.compose.project'];
  const service = labels['com.docker.compose.service'];
  if (!source || !data || !project || !service || !self.Image) throw new Error('一键更新需要 Docker Compose 部署，并挂载项目目录与持久数据目录');
  const files = (labels['com.docker.compose.project.config_files'] || path.posix.join(source.Source, 'docker-compose.yml')).split(',');
  if (files.some(file => !file.startsWith(source.Source + '/') || file.includes('..'))) throw new Error('Compose 配置必须位于已挂载的项目目录内');
  return { hostAppDir: source.Source, project, service, composeFiles: files, image: self.Image, imageRef: self.Config.Image, container: self.Id, env: self.Config.Env || [] };
}

export function createUpdateWriteGuard(store) {
  let activeWrites = 0;
  const middleware = (req, res, next) => {
    const readsThatWrite = ['/audit-logs', '/admin/export'].includes(req.path)
      || /^\/(accounts|mailboxes)\/[^/]+\/messages$/.test(req.path);
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !readsThatWrite) return next();
    const job = store.read();
    if (activeUpdate(job) && ['backup', 'restart', 'verify', 'rollback'].includes(job.phase)) {
      return res.status(503).json({ error: '正在备份并切换新版本，暂时暂停数据写入，请稍后重试' });
    }
    activeWrites += 1;
    let finished = false;
    const release = () => { if (!finished) { finished = true; activeWrites -= 1; } };
    const end = res.end;
    // An aborted connection may still have an async handler writing to SQLite.
    // Count it until the handler ends its response, rather than on socket close.
    res.end = function (...args) { try { return end.apply(this, args); } finally { release(); } };
    res.once('finish', release);
    next();
  };
  return { middleware, get activeWrites() { return activeWrites; } };
}

export function createUpdateService({ dataDir, dbPath, appDir, githubBranch, appVersion, currentCommit, run = exec, platform = process.platform, selfId = () => fs.readFileSync('/etc/hostname', 'utf8').trim() }) {
  const store = createUpdateStore(dataDir);
  const command = (file, args) => run(file, args, { timeout: 30_000, maxBuffer: 1024 * 1024 });
  let checking;
  async function status() {
    if (checking) return checking;
    checking = (async () => {
      const job = store.read();
      if (activeUpdate(job) && Date.now() - Date.parse(job.updatedAt) > (job.status === 'queued' ? 120_000 : 45_000)) {
        if (!job.workerName) store.finish(job.id, 'failed', '更新准备被中断，请重新尝试');
        else {
          try {
            const { stdout } = await command('docker', ['inspect', '--format', '{{json .State}}', job.workerName]);
            const state = JSON.parse(stdout);
            if (!state.Running && activeUpdate(store.read(job.id))) store.finish(job.id, 'failed', `更新进程已停止（退出码 ${state.ExitCode}），请查看日志后重试`);
          } catch (error) {
            // A missing daemon is not proof the worker stopped; only reconcile a missing container.
            if (/No such (object|container)/i.test(error.stderr || error.message) && activeUpdate(store.read(job.id))) store.finish(job.id, 'failed', '更新容器不存在，任务已中断，请重试');
          }
        }
      }
      return store.publicJob();
    })();
    try { return await checking; } finally { checking = null; }
  }
  async function launch(job, force) {
    try {
      if (platform !== 'linux') throw new Error('一键更新仅支持 Linux Docker Compose 部署；本地开发请使用 Git 更新');
      const { stdout } = await command('docker', ['inspect', selfId()]);
      const deployment = resolveDeployment(JSON.parse(stdout)[0], appDir, path.resolve(dataDir));
      const workerName = `schedule-updater-${job.id}`;
      const configPath = path.join(store.jobDir(job.id), 'config.json');
      store.writeJson(configPath, { ...deployment, id: job.id, dataDir: path.resolve(dataDir), dbPath: path.resolve(dbPath), appDir: deployment.hostAppDir, githubBranch, force, currentVersion: appVersion, currentCommit });
      store.patch(job.id, { workerName, message: '运行环境检查通过，正在启动独立更新进程' });
      const args = ['run', '-d', '--rm', '--name', workerName, '--volumes-from', deployment.container,
        ...(deployment.hostAppDir === appDir ? [] : ['--mount', `type=bind,source=${deployment.hostAppDir},target=${deployment.hostAppDir}`]),
        '--entrypoint', 'node', deployment.image, '/app/server/update-worker.js', configPath];
      await command('docker', args);
    } catch (error) {
      fs.rmSync(path.join(store.jobDir(job.id), 'config.json'), { force: true });
      store.finish(job.id, 'failed', `启动更新失败：${redactLog(error.stderr || error.message)}`);
    }
  }
  async function start(force = false) {
    await status();
    const { job, token } = store.create({ currentVersion: appVersion, currentCommit });
    void launch(job, force);
    return { job: store.publicJob(job), token };
  }
  return { store, status, start };
}

export function registerUpdateRoutes(app, { service, requireAuth, requireAdmin, audit }) {
  app.get('/api/admin/update/status', (req, res, next) => {
    try {
      if (service.store.accepts(req.headers.authorization?.replace(/^Bearer /, ''), service.store.read())) return next();
      requireAuth(req, res, () => requireAdmin(req, res, next));
    } catch (error) { next(error); }
  }, async (_req, res) => {
    try { res.set('Cache-Control', 'no-store').json({ job: await service.status() }); }
    catch (error) { res.status(500).json({ error: `读取更新日志失败：${error.message}` }); }
  });
  app.post('/api/admin/update', requireAuth, requireAdmin, async (req, res) => {
    try {
      const result = await service.start(req.body?.force === true);
      audit(req.user.id, 'update_start', 'system', result.job.id, '开始一键更新，可在版本更新中查看持久化执行日志');
      res.status(202).json({ ...result, message: '更新已开始，执行日志会自动刷新' });
    } catch (error) { res.status(error.status || 500).json({ error: `启动更新失败：${error.message}` }); }
  });
}
