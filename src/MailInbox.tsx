import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import { ArrowLeft, ChevronLeft, ChevronRight, Inbox, RefreshCw, Search, X } from 'lucide-react';
import './mail-inbox.css';

type MailMessage = {
  id: string; mailbox: 'Inbox' | 'Junk'; sender: string; to: string[];
  subject: string; text: string; html: string; receivedAt: string; isRead: boolean;
};
type MailList = { email: string; recipient?: string; messages: MailMessage[]; hasMore?: boolean; warnings?: string[]; scope?: string };
type Api = <T>(url: string, options?: RequestInit) => Promise<T>;

function mailDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false });
}

function mailPlainText(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  doc.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,h5,h6').forEach((node) => node.append('\n'));
  doc.querySelectorAll('td,th').forEach((node) => node.append(' '));
  return doc.body.textContent?.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() || '（无正文）';
}

function mailDocument(html: string) {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'iframe', 'object', 'embed', 'base', 'meta', 'link'],
    FORBID_ATTR: ['srcset', 'background', 'ping'],
  });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  doc.querySelectorAll('a').forEach((link) => {
    const href = link.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) link.removeAttribute('href');
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>body{font:15px/1.7 system-ui,sans-serif;color:#183d4a;margin:20px;overflow-wrap:anywhere}table{max-width:100%!important}img{max-width:100%;height:auto}a{color:#087e77}pre{white-space:pre-wrap}</style></head><body>${doc.body.innerHTML}</body></html>`;
}

export function InboxButton({ baseUrl, api, className = 'ghost-action' }: { baseUrl: string; api: Api; className?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={`${className} inbox-action`} onClick={() => setOpen(true)} title="收件箱（含垃圾箱）"><Inbox size={14} />收件箱</button>
    {open && createPortal(<MailInbox baseUrl={baseUrl} api={api} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

function MailInbox({ baseUrl, api, onClose }: { baseUrl: string; api: Api; onClose: () => void }) {
  const [data, setData] = useState<MailList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [readError, setReadError] = useState<{ mail: MailMessage; message: string } | null>(null);
  const [selected, setSelected] = useState<MailMessage | null>(null);
  const [plain, setPlain] = useState(false);
  const [folder, setFolder] = useState('all');
  const [search, setSearch] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [page, setPage] = useState(1);
  const request = useRef(0);
  const mailboxEpoch = useRef(0);
  const readAttempt = useRef(0);
  const savedReadIds = useRef(new Set<string>());
  const dialog = useRef<HTMLElement>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const htmlDocument = useMemo(() => selected?.html ? mailDocument(selected.html) : '', [selected?.html]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (selectedRef.current) setSelected(null); else onClose();
      }
      if (event.key === 'Tab') {
        const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,iframe,[tabindex="0"]') || []);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', handleKey, true);
    return () => { document.removeEventListener('keydown', handleKey, true); previousFocus?.focus(); };
  }, []);

  useEffect(() => {
    savedReadIds.current.clear();
    setData(null);
    setSelected(null);
    setReadError(null);
    void refresh();
    return () => { request.current += 1; mailboxEpoch.current += 1; };
  }, [baseUrl]);
  useEffect(() => { setPage(1); }, [folder, search, onlyUnread]);

  async function refresh() {
    const current = ++request.current;
    setLoading(true);
    setLoadError('');
    try {
      const next = await api<MailList>(baseUrl);
      if (current !== request.current) return;
      setData({ ...next, messages: next.messages.map((message) => savedReadIds.current.has(message.id) ? { ...message, isRead: true } : message) });
      setPage(1);
    } catch (err) {
      if (current === request.current) setLoadError((err as Error).message);
    } finally { if (current === request.current) setLoading(false); }
  }

  async function openMessage(message: MailMessage) {
    const epoch = mailboxEpoch.current;
    const attempt = ++readAttempt.current;
    setSelected(message);
    setPlain(!message.html);
    setReadError(null);
    if (message.isRead) return;
    try {
      await api(`${baseUrl}/read`, { method: 'POST', body: JSON.stringify({ id: message.id }) });
      if (epoch !== mailboxEpoch.current) return;
      savedReadIds.current.add(message.id);
      setData((current) => current && ({ ...current, messages: current.messages.map((item) => item.id === message.id ? { ...item, isRead: true } : item) }));
      setSelected((current) => current?.id === message.id ? { ...current, isRead: true } : current);
    } catch (err) {
      if (epoch === mailboxEpoch.current && attempt === readAttempt.current) {
        setReadError({ mail: message, message: `邮件已打开，但已读状态保存失败：${(err as Error).message}` });
      }
    }
  }

  const messages = (data?.messages || []).filter((message) => {
    const term = search.trim().toLowerCase();
    return (folder === 'all' || folder === message.mailbox) && (!onlyUnread || !message.isRead)
      && (!term || `${message.subject} ${message.sender} ${message.to.join(' ')}`.toLowerCase().includes(term));
  }).sort((a, b) => (Date.parse(b.receivedAt) || 0) - (Date.parse(a.receivedAt) || 0));
  const pages = Math.max(1, Math.ceil(messages.length / 20));
  const safePage = Math.min(page, pages);

  return <div className="modal-backdrop mail-inbox-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="admin-modal mail-inbox-modal" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="收件箱">
      <div className="modal-title">
        <div><span>收件箱 · 含垃圾箱</span><h2>{selected ? '阅读邮件' : '邮件列表'}</h2><p className="mail-inbox-address">{data?.recipient || data?.email || '正在读取绑定邮箱…'}</p></div>
        <button className="icon-btn" onClick={onClose} aria-label="关闭收件箱"><X size={20} /></button>
      </div>
      {loadError && <div role="alert" className="mail-inbox-warning">{loadError}<button className="ghost-action" onClick={() => void refresh()} disabled={loading}>重试</button></div>}
      {readError && (!selected || selected.id === readError.mail.id) && <div role="alert" className="mail-inbox-warning">{readError.message}<button className="ghost-action" onClick={() => void openMessage(readError.mail)}>重试</button></div>}
      {data?.warnings?.map((warning) => <div role="status" className="mail-inbox-warning" key={warning}>{warning}</div>)}
      {selected ? <div className="mail-reader">
        <div className="mail-reader-toolbar"><button className="soft-btn" onClick={() => setSelected(null)}><ArrowLeft size={16} />返回邮件列表</button>{selected.html && <button className="ghost-action" onClick={() => setPlain(!plain)}>{plain ? '查看原格式' : '查看纯文本'}</button>}</div>
        <h3>{selected.subject || '（无主题）'}</h3>
        <dl className="mail-reader-meta"><dt>发件人</dt><dd>{selected.sender || '未知'}</dd><dt>收件人</dt><dd>{selected.to.join('，') || data?.recipient || data?.email || '未知'}</dd><dt>时间</dt><dd>{mailDate(selected.receivedAt)} · {selected.mailbox === 'Junk' ? '垃圾箱' : '收件箱'} · {selected.isRead ? '已读' : '未读'}</dd></dl>
        {plain ? <pre className="mail-reader-text">{selected.text || mailPlainText(htmlDocument)}</pre> : <iframe className="mail-reader-frame" title="邮件正文" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={htmlDocument} />}
      </div> : <>
        <div className="mail-inbox-toolbar">
          <label className="mail-inbox-search"><Search size={16} /><input aria-label="搜索邮件" placeholder="搜索主题、发件人或收件人" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <select aria-label="邮件文件夹" value={folder} onChange={(event) => setFolder(event.target.value)}><option value="all">全部（含垃圾箱）</option><option value="Inbox">收件箱</option><option value="Junk">垃圾箱</option></select>
          <label className="mail-unread-filter"><input type="checkbox" checked={onlyUnread} onChange={(event) => setOnlyUnread(event.target.checked)} />只看未读</label>
          <button className="soft-btn" onClick={refresh} disabled={loading}><RefreshCw size={16} />{loading ? '读取中…' : '刷新邮件'}</button>
        </div>
        <p className="mail-inbox-hint">按接收时间从新到旧排列 · 未读为浅绿，已读为灰色{data?.scope ? ` · ${data.scope}` : ' · 每个文件夹最近 100 封'}</p>
        {loading && <div className="mail-loading" role="status">正在读取收件箱和垃圾箱，请稍候…</div>}
        <div className="mail-list-scroll" aria-busy={loading}>
          <table className="mail-list-table"><thead><tr><th>状态 / 文件夹</th><th>发件人 / 收件人</th><th>主题</th><th>接收时间</th><th>操作</th></tr></thead><tbody>
            {messages.slice((safePage - 1) * 20, safePage * 20).map((message) => <tr key={message.id} className={message.isRead ? 'mail-row-read' : 'mail-row-unread'}>
              <td><span className={`mail-read-dot ${message.isRead ? 'read' : ''}`} />{message.isRead ? '已读' : '未读'}<span className={`mail-folder ${message.mailbox === 'Junk' ? 'junk' : ''}`}>{message.mailbox === 'Junk' ? '垃圾箱' : '收件箱'}</span></td>
              <td><span>{message.sender || '未知发件人'}</span><small>{message.to.join('，') || data?.recipient || data?.email}</small></td>
              <td><button className="mail-subject-button" onClick={() => openMessage(message)}>{message.subject || '（无主题）'}</button></td>
              <td>{mailDate(message.receivedAt)}</td><td><button className="ghost-action" onClick={() => openMessage(message)}>查看</button></td>
            </tr>)}
          </tbody></table>
          {!loading && !messages.length && <div className="empty-table">{data ? '没有符合条件的邮件。' : '邮件暂未读取，请重试。'}</div>}
        </div>
        <div className="mail-inbox-footer"><span>共 {messages.length} 封{data?.hasMore ? ' · 更早邮件未加载（每个文件夹最近 100 封）' : ''}</span><div><button className="icon-btn" aria-label="上一页邮件" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}><ChevronLeft size={16} /></button><span>{safePage} / {pages}</span><button className="icon-btn" aria-label="下一页邮件" disabled={safePage >= pages} onClick={() => setPage(safePage + 1)}><ChevronRight size={16} /></button></div></div>
      </>}
    </section>
  </div>;
}
