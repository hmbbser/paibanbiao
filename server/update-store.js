import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const activeUpdate = (job) => Boolean(job && ['queued', 'running'].includes(job.status));
export const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
export function redactLog(value) {
  return String(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/((?:password|passwd|token|secret|authorization|client_secret)[\w-]*\s*[=:]\s*)(?:Bearer\s+)?[^\s,;]+/gi, '$1[redacted]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[redacted]')
    .slice(0, 2000);
}

export function createUpdateStore(dataDir) {
  const root = path.resolve(dataDir, 'updates');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, 'active.lock');
  const jobDir = (id) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效的更新任务编号');
    return path.join(root, id);
  };
  const writeJson = (file, value) => {
    const tmp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  function read(id) {
    if (!id) {
      try { id = JSON.parse(fs.readFileSync(path.join(root, 'latest.json'), 'utf8')).id; }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    }
    return JSON.parse(fs.readFileSync(path.join(jobDir(id), 'status.json'), 'utf8'));
  }
  function save(job) { writeJson(path.join(jobDir(job.id), 'status.json'), job); return job; }
  function log(id, message, level = 'info') {
    const file = path.join(jobDir(id), 'logs.jsonl');
    const lines = String(message).split(/[\r\n]+/).filter(Boolean);
    for (const line of lines) fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), level, message: redactLog(line) }) + '\n', { mode: 0o600 });
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').slice(-501).join('\n'), { mode: 0o600 });
    }
  }
  function patch(id, changes) {
    const previous = read(id);
    const job = { ...previous, ...changes, ...(changes.message ? { message: redactLog(changes.message) } : {}), updatedAt: new Date().toISOString() };
    if (changes.message && changes.message !== previous.message) log(id, changes.message, changes.status === 'failed' ? 'error' : 'info');
    return save(job);
  }
  function release(id) {
    try { if (fs.readFileSync(lock, 'utf8') === id) fs.unlinkSync(lock); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  function finish(id, status, message, extra = {}) {
    const job = patch(id, { ...extra, status, message: redactLog(message), finishedAt: new Date().toISOString(), ...(status === 'succeeded' ? { progress: 100 } : {}) });
    release(id);
    return job;
  }
  function create(extra = {}) {
    const id = randomUUID();
    let fd;
    try { fd = fs.openSync(lock, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw Object.assign(new Error('已有更新正在进行，请查看执行日志'), { status: 409 }); throw error; }
    try {
      fs.writeFileSync(fd, id);
      fs.mkdirSync(jobDir(id), { mode: 0o700 });
      const token = randomBytes(32).toString('hex');
      const timestamp = new Date().toISOString();
      const job = save({ ...extra, id, status: 'queued', phase: 'preflight', progress: 0, message: '更新任务已创建，正在检查运行环境', startedAt: timestamp, updatedAt: timestamp, tokenHash: tokenHash(token) });
      writeJson(path.join(root, 'latest.json'), { id });
      log(id, job.message);
      return { job, token };
    } catch (error) { release(id); throw error; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  function publicJob(job = read()) {
    if (!job) return null;
    const { tokenHash: _hash, workerName: _worker, ...visible } = job;
    let logs = [];
    try { logs = fs.readFileSync(path.join(jobDir(job.id), 'logs.jsonl'), 'utf8').trim().split('\n').filter(Boolean).slice(-300).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { ...visible, logs };
  }
  function accepts(token, job) {
    return typeof token === 'string' && token.length === 64 && Boolean(job?.tokenHash) && timingSafeEqual(Buffer.from(tokenHash(token), 'hex'), Buffer.from(job.tokenHash, 'hex'));
  }
  return { root, jobDir, read, save, patch, log, finish, create, publicJob, accepts, writeJson };
}
