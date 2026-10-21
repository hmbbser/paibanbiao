import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import './update-panel.css';

type VersionInfo = { current: string; latest: string; hasUpdate: boolean; repo: string; branch: string };
type UpdateLog = { time: string; level: string; message: string };
type UpdateJob = {
  id: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; phase: string; progress: number;
  message: string; startedAt: string; updatedAt: string; finishedAt?: string;
  currentVersion: string; latestVersion?: string; backupPath?: string; recovery?: string; logs: UpdateLog[];
};
type Request = <T>(url: string, options?: RequestInit) => Promise<T>;
const storageKey = 'schedule.update.token';
const isActive = (job: UpdateJob | null) => Boolean(job && ['queued', 'running'].includes(job.status));
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export function UpdatePanel({ request }: { request: Request }) {
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [job, setJob] = useState<UpdateJob | null>(null);
  const [force, setForce] = useState(false);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState('');
  const [connection, setConnection] = useState('');
  const [checkedAt, setCheckedAt] = useState('');
  const [loaded, setLoaded] = useState(false);
  const token = useRef('');
  const mounted = useRef(true);
  const startingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followLogs = useRef(true);
  const currentJob = useRef<UpdateJob | null>(null);
  const completed = useRef('');
  const requestEpoch = useRef(0);
  const active = isActive(job);
  useEffect(() => { mounted.current = true; try { token.current = sessionStorage.getItem(storageKey) || ''; } catch { /* Storage is optional. */ } return () => { mounted.current = false; }; }, []);

  const checkVersion = useCallback(async () => {
    setChecking(true);
    setNotice('');
    try {
      const result = await request<VersionInfo>('/api/admin/version', { signal: AbortSignal.timeout(45_000) });
      if (!mounted.current) return;
      setVersion(result);
      setCheckedAt(new Date().toISOString());
      setNotice(result.hasUpdate ? '发现新版本，可以一键更新' : '当前已经是最新版本');
    } catch (error) { if (mounted.current) setNotice((error as Error).message); }
    finally { if (mounted.current) setChecking(false); }
  }, [request]);

  useEffect(() => {
    let cancelled = false;
    let timer: number;
    let controller: AbortController | null = null;
    async function poll() {
      const epoch = requestEpoch.current;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 10_000);
      try {
        const result = await request<{ job: UpdateJob | null }>('/api/admin/update/status', { signal: controller.signal, headers: token.current ? { Authorization: `Bearer ${token.current}` } : undefined });
        if (cancelled || epoch !== requestEpoch.current) return;
        // A status request issued before POST must not replace the newly accepted job.
        if (!startingRef.current) {
          currentJob.current = result.job;
          setJob(result.job);
        }
        setLoaded(true);
        setConnection('');
        if (!startingRef.current && result.job?.status === 'succeeded' && completed.current !== result.job.id) {
          completed.current = result.job.id;
          setVersion(null);
        }
      } catch (error) {
        if (cancelled) return;
        const message = (error as Error).message;
        setConnection(message.includes('登录') ? '登录已失效，请重新登录后查看更新结果。' : isActive(currentJob.current) ? '服务暂时无法连接，正在自动重连；已收到的日志会保留。' : `暂时无法读取更新状态，正在重试：${message}`);
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled) timer = window.setTimeout(poll, isActive(currentJob.current) ? 2000 : 5000);
      }
    }
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); controller?.abort(); };
  }, [request]);

  useEffect(() => { if (followLogs.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [job?.logs]);

  async function startUpdate() {
    if (startingRef.current || active) return;
    if (!window.confirm('将备份数据、拉取最新代码并重建服务，切换时会短暂重启。' + (force ? '\n强制更新会覆盖服务器目录内未提交的源码改动。' : '') + '\n确认开始更新吗？')) return;
    startingRef.current = true;
    requestEpoch.current += 1;
    setStarting(true);
    setNotice('');
    try {
      const result = await request<{ job: UpdateJob; token: string; message: string }>('/api/admin/update', { method: 'POST', body: JSON.stringify({ force }), signal: AbortSignal.timeout(35_000) });
      if (!mounted.current) return;
      requestEpoch.current += 1;
      token.current = result.token;
      try { sessionStorage.setItem(storageKey, result.token); } catch { /* Polling still works until reload. */ }
      currentJob.current = result.job;
      setJob(result.job);
      setVersion(null);
      followLogs.current = true;
      setConnection('');
    } catch (error) { if (mounted.current) setNotice((error as Error).message); }
    finally { startingRef.current = false; if (mounted.current) setStarting(false); }
  }

  function downloadLogs() {
    if (!job) return;
    const text = [job.message, job.recovery || '', job.backupPath ? `服务器备份：${job.backupPath}` : '', ...job.logs.map(line => `[${line.time}] ${line.message}`)].filter(Boolean).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `update-${job.id}.log`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const StatusIcon = active ? LoaderCircle : job?.status === 'succeeded' ? CheckCircle2 : TriangleAlert;
  return <div className="settings-card settings-form update-card">
    <RefreshCw />
    <div>
      <h3>版本更新</h3>
      <p>检测新版，备份后更新。执行进度与日志会自动保存。</p>
      <div className="version-box">
        <span>当前版本：{version?.current || (job?.status === 'succeeded' ? job.latestVersion : job?.currentVersion) || '未检测'}</span>
        <span>最新版本：{version?.latest || job?.latestVersion || '未检测'}</span>
        <span>仓库：{version?.repo || 'hmbbser/paibanbiao'}</span>
      </div>
      {checkedAt && <p className="update-checked">上次检测：{time(checkedAt)}</p>}
      <label className="check-row"><input type="checkbox" checked={force} disabled={active || starting} onChange={event => setForce(event.target.checked)} />强制更新（备份后覆盖本地源码改动）</label>
      <div className="card-actions update-actions">
        <button type="button" className="soft-btn" onClick={() => void checkVersion()} disabled={checking || active || starting}>{checking ? <LoaderCircle className="update-spin" /> : <RefreshCw />}{checking ? '检测中…' : '检测版本'}</button>
        <button type="button" className="primary" onClick={startUpdate} disabled={!loaded || Boolean(connection) || starting || active || Boolean(version && !version.hasUpdate && !force)}>{starting || active ? <LoaderCircle className="update-spin" /> : <Download />}{starting ? '正在启动…' : active ? '正在更新…' : job?.status === 'failed' ? '重新尝试更新' : '一键更新'}</button>
      </div>
      {notice && <p className="update-notice" role="status">{notice}</p>}
      {connection && <p className="update-notice" role="status">{connection}</p>}
      {!loaded && !connection && <p className="update-notice">正在读取上次更新记录…</p>}
      {job && <section className={`update-result is-${job.status}`} aria-label="更新进度与执行日志">
        <div className="update-result-heading"><StatusIcon className={active ? 'update-spin' : ''} /><strong role="status">{job.message}</strong><span>{job.progress}%</span></div>
        <progress value={job.progress} max={100} aria-label="更新进度" />
        <div className="update-log-toolbar"><span>执行日志 · {job.logs.length} 条{job.logs.length >= 300 ? '（最近）' : ''}</span><button type="button" className="soft-btn" onClick={downloadLogs}><Download />下载日志</button></div>
        <div className="update-logs" ref={scrollRef} tabIndex={0} aria-label="执行日志" onScroll={event => { const el = event.currentTarget; followLogs.current = el.scrollHeight - el.scrollTop - el.clientHeight < 36; }}>
          {job.logs.map((line, index) => <div className={`update-log-line level-${line.level}`} key={`${line.time}-${index}`}><time dateTime={line.time}>{time(line.time)}</time><span>{line.message}</span></div>)}
        </div>
        {job.backupPath && <p className="update-backup">服务器备份：<code>{job.backupPath}</code></p>}
        {job.recovery && <p className="update-recovery">{job.recovery}</p>}
        {job.status === 'succeeded' && <button type="button" className="soft-btn" onClick={() => window.location.reload()}>刷新页面使用新版本</button>}
      </section>}
      <div className="update-help"><ShieldCheck /><span>首次构建可能需要十几分钟。构建期间服务继续运行，切换前备份数据；重启时页面会自动重连。刷新页面或重新登录后，可继续查看结果。</span></div>
    </div>
  </div>;
}
