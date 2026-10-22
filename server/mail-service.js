import { createHash } from 'node:crypto';
import { extractSteamGuardCode, extractSteamRecoveryLink, isSteamLoginMessage } from './steam-mail.js';

export const MAIL_FOLDERS = [
  { label: 'Inbox', graph: 'inbox' },
  { label: 'Junk', graph: 'junkemail' }
];
export const BROWSE_LIMIT = 100;
// A freshness policy, not a promise about Steam's own code expiry.
export const MAIL_CODE_MAX_AGE_MINUTES = 5;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const recipientHeaders = ['to', 'cc', 'delivered-to', 'x-original-to', 'envelope-to', 'resent-to'];
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

// Provider IDs can change when Graph falls back to IMAP or a message is moved.
// The RFC Message-ID identifies the same mail across both transports; hash it so
// persistent read keys do not store addresses or other Message-ID contents.
function readIdentity(messageId, fallbackId) {
  const value = String(messageId || '').trim();
  return /^<[^<>\s]+@[^<>\s]+>$/.test(value)
    ? `message:${createHash('sha256').update(value).digest('hex')}` : fallbackId;
}

export function mailError(message, code = 'MAIL_UNAVAILABLE', status = 502) {
  return Object.assign(new Error(message), { code, status });
}

export function recipientMatches(message, expectedEmail) {
  const recipients = [
    ...(message.to || []), ...(message.cc || []),
    ...(message.headers || []).flatMap((value) => String(value).match(emailPattern) || [])
  ].map(normalizeEmail);
  return recipients.includes(normalizeEmail(expectedEmail));
}

export function withinLookupWindow(receivedAt, requestAt, windowMinutes = 10) {
  const receivedTime = Date.parse(receivedAt);
  const requestTime = Date.parse(requestAt);
  return Number.isFinite(receivedTime) && Number.isFinite(requestTime) && windowMinutes > 0
    && receivedTime <= requestTime && receivedTime >= requestTime - windowMinutes * 60_000;
}

export function sortMessages(messages) {
  return [...messages].sort((a, b) => (Date.parse(b.receivedAt) || 0) - (Date.parse(a.receivedAt) || 0)
    || String(a.id || '').localeCompare(String(b.id || '')));
}

function lookupOptions(options) {
  const requestAt = options.requestAt ?? new Date().toISOString();
  if (options.latest === true) {
    if (!Number.isFinite(Date.parse(requestAt))) throw mailError('邮件查询时间无效', 'INVALID_LOOKUP_WINDOW', 400);
    const afterReceivedAt = options.afterReceivedAt;
    if (afterReceivedAt != null && (typeof afterReceivedAt !== 'string' || !Number.isFinite(Date.parse(afterReceivedAt)))) {
      throw mailError('上次验证码邮件时间无效', 'INVALID_LOOKUP_WINDOW', 400);
    }
    return { requestAt, latest: true, ...(afterReceivedAt != null ? { afterReceivedAt } : {}) };
  }
  const windowMinutes = Number(options.windowMinutes ?? 10);
  const since = new Date(Date.parse(requestAt) - windowMinutes * 60_000);
  if (!Number.isFinite(Date.parse(requestAt)) || !Number.isFinite(windowMinutes) || windowMinutes <= 0 || !Number.isFinite(since.getTime())) {
    throw mailError('邮件查询时间范围无效', 'INVALID_LOOKUP_WINDOW', 400);
  }
  return { requestAt, windowMinutes, since: since.toISOString() };
}

export function scanMessages(messages, expectedEmail, options, kind = 'code') {
  const extractor = kind === 'link' ? extractSteamRecoveryLink : extractSteamGuardCode;
  for (const message of sortMessages(messages)) {
    if (!recipientMatches(message, expectedEmail)) continue;
    if (options.latest) {
      const receivedTime = Date.parse(message.receivedAt);
      if (!Number.isFinite(receivedTime) || receivedTime > Date.parse(options.requestAt)) continue;
    } else if (!withinLookupWindow(message.receivedAt, options.requestAt, options.windowMinutes)) continue;
    const value = extractor(message);
    if (kind === 'code' && options.latest && (value || isSteamLoginMessage(message))) {
      // Select the newest login message first. Folder collectors use a preview
      // so an unreadable older message cannot override a newer one elsewhere.
      if (!options.preview) {
        let error;
        if (options.maxAgeMinutes && !withinLookupWindow(message.receivedAt, options.requestAt, options.maxAgeMinutes)) {
          error = mailError(`最新验证码邮件已超过 ${options.maxAgeMinutes} 分钟，请在 Steam 请求新验证码后重试`, 'MAIL_CODE_STALE', 409);
        } else if (options.afterReceivedAt && Date.parse(message.receivedAt) <= Date.parse(options.afterReceivedAt)) {
          error = mailError('尚未收到比上次更新的验证码邮件，请在 Steam 请求新验证码', 'MAIL_CODE_NOT_NEW', 409);
        } else if (!value) {
          error = mailError('最新 Steam 登录邮件无法提取验证码，请打开收件箱查看；不会返回旧验证码', 'MAIL_CODE_UNREADABLE', 422);
        }
        if (error) throw Object.assign(error, { receivedAt: message.receivedAt });
      }
      return {
        code: value, email: normalizeEmail(expectedEmail), recipient: normalizeEmail(expectedEmail),
        mailbox: message.mailbox, subject: message.subject || '', sender: message.sender || '', receivedAt: message.receivedAt,
        ...(options.maxAgeMinutes ? { expiresAt: new Date(Date.parse(message.receivedAt) + options.maxAgeMinutes * 60_000).toISOString() } : {})
      };
    }
    if (value) return {
      [kind]: value, email: normalizeEmail(expectedEmail), recipient: normalizeEmail(expectedEmail),
      mailbox: message.mailbox, subject: message.subject || '', sender: message.sender || '', receivedAt: message.receivedAt
    };
  }
  return null;
}

export async function requestMicrosoftToken(mailbox, graph, { fetchImpl = fetch, saveToken } = {}) {
  const body = new URLSearchParams({ client_id: mailbox.client_id, grant_type: 'refresh_token', refresh_token: mailbox.refresh_token });
  body.set('scope', graph ? 'https://graph.microsoft.com/.default' : 'https://outlook.office.com/IMAP.AccessAsUser.All');
  let response;
  let data;
  try {
    response = await fetchImpl('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(), signal: AbortSignal.timeout(30_000)
    });
    data = await response.json();
  } catch {
    throw mailError('邮箱授权服务暂时无法连接，请稍后重试');
  }
  if (!response.ok || !data.access_token) throw mailError('邮箱授权失效或权限不足，请联系管理员', 'MAIL_AUTH_FAILED');
  if (data.refresh_token && data.refresh_token !== mailbox.refresh_token) {
    mailbox.refresh_token = data.refresh_token;
    if (saveToken) await saveToken(mailbox.id, data.refresh_token);
  }
  // Some token endpoints omit scope. The Graph response remains authoritative in that case.
  if (graph && data.scope && !String(data.scope).split(/\s+/).some((scope) => /(?:^|\/)Mail\.Read(?:Write)?$/i.test(scope))) {
    throw mailError('Graph Mail.Read 权限不可用', 'GRAPH_PERMISSION_MISSING');
  }
  return data.access_token;
}

function graphAddresses(recipients = []) {
  return recipients.map((item) => normalizeEmail(item?.emailAddress?.address)).filter(Boolean);
}

export async function fetchGraphFolder(accessToken, folder, options = {}, fetchImpl = fetch) {
  const url = new URL(`https://graph.microsoft.com/v1.0/me/mailFolders/${folder.graph}/messages`);
  url.searchParams.set('$top', String(BROWSE_LIMIT));
  url.searchParams.set('$orderby', 'receivedDateTime desc');
  url.searchParams.set('$select', 'id,internetMessageId,subject,body,receivedDateTime,from,toRecipients,ccRecipients,internetMessageHeaders');
  if (options.since) url.searchParams.set('$filter', `receivedDateTime ge ${options.since}`);
  else if (options.latest) url.searchParams.set('$filter', `receivedDateTime le ${options.requestAt}`);
  let next = url.toString();
  const messages = [];
  const seenPages = new Set();
  while (next) {
    const pageUrl = new URL(next);
    if (pageUrl.origin !== 'https://graph.microsoft.com' || !pageUrl.pathname.startsWith('/v1.0/me/')) {
      throw mailError('邮箱分页地址无效，无法确认最新邮件');
    }
    if (seenPages.has(next) || seenPages.size >= 100) throw mailError(options.latest
      ? '邮箱邮件过多，无法确认最新验证码，请整理邮箱后重试'
      : '查询时间范围内邮件过多，无法确认最新邮件，请缩短查询时间范围');
    seenPages.add(next);
    let response;
    let data;
    try {
      response = await fetchImpl(next, { headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'IdType="ImmutableId"' }, signal: AbortSignal.timeout(30_000) });
      data = await response.json();
    } catch {
      throw mailError('读取邮箱超时或连接失败，请稍后重试');
    }
    if (!response.ok) throw mailError(response.status === 401 || response.status === 403 ? '邮箱授权失效或权限不足，请联系管理员' : '读取邮箱失败，请稍后重试', response.status === 401 || response.status === 403 ? 'MAIL_AUTH_FAILED' : 'MAIL_UNAVAILABLE');
    if (!Array.isArray(data.value)) throw mailError('邮箱返回的邮件列表无效');
    for (const item of data.value) {
      if (!item.id || !Number.isFinite(Date.parse(item.receivedDateTime))) throw mailError('邮件缺少接收时间或标识，无法确认最新邮件');
      if (typeof item.body?.content !== 'string') throw mailError('邮件正文读取不完整，请检查邮箱读取权限');
      const isHtml = String(item.body?.contentType || '').toLowerCase() === 'html';
      messages.push({
        id: `graph:${item.id}`, readId: readIdentity(item.internetMessageId, `graph:${item.id}`), mailbox: folder.label, sender: item.from?.emailAddress?.address || '',
        subject: item.subject || '', text: isHtml ? '' : item.body?.content || '', html: isHtml ? item.body?.content || '' : '',
        receivedAt: item.receivedDateTime, to: graphAddresses(item.toRecipients), cc: graphAddresses(item.ccRecipients),
        headers: (item.internetMessageHeaders || []).filter((header) => recipientHeaders.includes(String(header.name).toLowerCase())).map((header) => String(header.value || ''))
      });
    }
    next = data['@odata.nextLink'] || '';
    // Graph orders pages by receipt time. Once this folder has a match, every
    // unread page is older; the other folder is checked independently.
    if (options.latest && scanMessages(messages, options.expectedEmail, { ...options, preview: true }, options.kind)) return { messages: sortMessages(messages), hasMore: false };
    if (!options.latest && !options.since && messages.length >= BROWSE_LIMIT) return { messages: sortMessages(messages).slice(0, BROWSE_LIMIT), hasMore: Boolean(next) || messages.length > BROWSE_LIMIT };
  }
  return { messages: sortMessages(messages), hasMore: false };
}

export function resolveImapFolder(boxes, label) {
  const paths = [];
  function visit(nodes, parent = '') {
    for (const [name, info] of Object.entries(nodes || {})) {
      const folderPath = parent ? `${parent}${info.delimiter || '/'}${name}` : name;
      paths.push({ path: folderPath, name, flags: (info.attribs || []).map((flag) => String(flag).toLowerCase()) });
      visit(info.children, folderPath);
    }
  }
  visit(boxes);
  const wantedFlag = label === 'Inbox' ? '\\inbox' : '\\junk';
  const special = paths.find((folder) => folder.flags.includes(wantedFlag));
  if (special) return special.path;
  const aliases = label === 'Inbox' ? ['inbox'] : ['junk', 'junk email', 'junk e-mail', 'spam', '垃圾邮件', '垃圾郵件', '迷惑メール', '스팸 메일'];
  return paths.find((folder) => aliases.includes(folder.name.toLowerCase()))?.path || '';
}

function parsedHeaders(mail) {
  const result = [];
  for (const key of recipientHeaders) {
    const raw = mail.headers?.get?.(key);
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (value) result.push(typeof value === 'string' ? value : value.text || value.address || '');
    }
  }
  for (const line of mail.headerLines || []) {
    if (recipientHeaders.includes(String(line.key || '').toLowerCase())) result.push(String(line.line || line.value || ''));
  }
  return result.filter(Boolean);
}

export function normalizeImapMessage(mail, attributes, folder, uidvalidity) {
  const receivedTime = new Date(attributes.date);
  if (!attributes.date || !Number.isFinite(receivedTime.getTime())) throw mailError('邮件缺少内部接收时间，无法确认最新邮件');
  const receivedAt = receivedTime.toISOString();
  if (!attributes.uid || !uidvalidity) throw mailError('邮件缺少稳定标识，无法读取');
  const id = `imap:${encodeURIComponent(folder.path)}:${uidvalidity}:${attributes.uid}`;
  return {
    id, readId: readIdentity(mail.messageId, id),
    mailbox: folder.label, sender: mail.from?.text || '', subject: mail.subject || '',
    text: mail.text || '', html: typeof mail.html === 'string' ? mail.html : '', receivedAt,
    to: (mail.to?.value || []).map((address) => normalizeEmail(address.address)).filter(Boolean),
    cc: (mail.cc?.value || []).map((address) => normalizeEmail(address.address)).filter(Boolean), headers: parsedHeaders(mail)
  };
}

// Fetch attributes first: UID order and the sender's Date header are not receipt order.
export function fetchImapBatch(imap, ids, withBody, simpleParser) {
  if (!ids.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const pending = [];
    const fetcher = imap.fetch(ids, { bodies: withBody ? '' : [], markSeen: false });
    fetcher.on('message', (message) => {
      const task = new Promise((done, fail) => {
        let attributes;
        let parsed;
        message.once('attributes', (value) => { attributes = value; });
        message.on('body', (stream) => { parsed = simpleParser(stream, { skipHtmlToText: false, skipTextToHtml: true }); parsed.catch(fail); });
        message.once('error', fail);
        message.once('end', async () => {
          try {
            if (!attributes?.uid || !attributes.date || !Number.isFinite(new Date(attributes.date).getTime())) throw mailError('邮件缺少内部接收时间，无法确认最新邮件');
            if (withBody && !parsed) throw mailError('邮件正文读取不完整');
            done({ attributes, mail: withBody ? await parsed : null });
          } catch (error) { fail(error); }
        });
      });
      task.catch(() => {});
      pending.push(task);
    });
    fetcher.once('error', reject);
    fetcher.once('end', () => { Promise.all(pending).then((rows) => {
      if (rows.length !== ids.length) reject(mailError('邮件在读取期间发生变化，请刷新重试'));
      else resolve(rows);
    }, reject); });
  });
}

export async function fetchImapFolder(mailbox, accessToken, folder, options = {}, dependencies = {}) {
  const Imap = dependencies.Imap || (await import('node-imap')).default;
  const simpleParser = dependencies.simpleParser || (await import('mailparser')).simpleParser;
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: mailbox.email, xoauth2: Buffer.from(`user=${mailbox.email}\x01auth=Bearer ${accessToken}\x01\x01`).toString('base64'),
      host: 'outlook.office365.com', port: 993, tls: true, connTimeout: 20_000, authTimeout: 20_000, socketTimeout: 45_000
    });
    let settled = false;
    const timer = setTimeout(() => finish(mailError('读取邮箱超时，请稍后重试')), 90_000);
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        imap.destroy();
        reject(error.status ? error : error.type === 'authentication'
          ? mailError('邮箱授权失效或权限不足，请联系管理员', 'MAIL_AUTH_FAILED')
          : mailError('IMAP 读取失败，请检查邮箱授权后重试'));
      }
      else { imap.end(); resolve(result); }
    }
    const callback = (method, ...args) => new Promise((ok, fail) => imap[method](...args, (error, value) => error ? fail(error) : ok(value)));
    imap.once('error', (error) => finish(error));
    imap.once('end', () => { if (!settled) finish(mailError('邮箱连接提前关闭，读取不完整')); });
    imap.once('close', () => { if (!settled) finish(mailError('邮箱连接提前关闭，读取不完整')); });
    imap.once('ready', async () => {
      try {
        const boxes = await callback('getBoxes');
        const folderPath = resolveImapFolder(boxes, folder.label);
        if (!folderPath) throw mailError(`${folder.label === 'Junk' ? '垃圾邮件箱' : '收件箱'}不可用，无法确认全部邮件`);
        const box = await callback('openBox', folderPath, true);
        // IMAP SINCE works on INTERNALDATE at day precision; exact filtering follows below.
        const criteria = options.since ? [['SINCE', new Date(Date.parse(options.since) - 86_400_000)]] : ['ALL'];
        const ids = await callback('search', criteria) || [];
        if (ids.length > 200_000) throw mailError('邮箱邮件过多，无法完成接收时间排序，请整理邮箱后重试');
        const metadata = [];
        for (let start = 0; start < ids.length; start += 1000) {
          metadata.push(...await fetchImapBatch(imap, ids.slice(start, start + 1000), false, simpleParser));
        }
        const ordered = metadata.filter((row) => (!options.since || new Date(row.attributes.date).getTime() >= Date.parse(options.since))
          && (!options.latest || new Date(row.attributes.date).getTime() <= Date.parse(options.requestAt)))
          .sort((a, b) => new Date(b.attributes.date).getTime() - new Date(a.attributes.date).getTime() || b.attributes.uid - a.attributes.uid);
        const selected = options.since || options.latest ? ordered : ordered.slice(0, BROWSE_LIMIT);
        const messages = [];
        for (let start = 0; start < selected.length; start += 100) {
          const rows = await fetchImapBatch(imap, selected.slice(start, start + 100).map((row) => row.attributes.uid), true, simpleParser);
          messages.push(...rows.map(({ mail, attributes }) => normalizeImapMessage(mail, attributes, { ...folder, path: folderPath }, box.uidvalidity)));
          if (options.latest && scanMessages(messages, options.expectedEmail, { ...options, preview: true }, options.kind)) break;
        }
        finish(null, { messages: sortMessages(messages), hasMore: ordered.length > selected.length });
      } catch (error) { finish(error); }
    });
    imap.connect();
  });
}

export function createMailService(dependencies = {}) {
  const token = dependencies.token || ((mailbox, graph) => requestMicrosoftToken(mailbox, graph, dependencies));
  const graphFolder = dependencies.graphFolder || ((accessToken, folder, options) => fetchGraphFolder(accessToken, folder, options, dependencies.fetchImpl));
  const imapFolder = dependencies.imapFolder || fetchImapFolder;

  async function collect(mailbox, options = {}) {
    let graphToken;
    try { graphToken = await token(mailbox, true); } catch { /* IMAP may have a separate supported permission scope. */ }
    const results = graphToken ? await Promise.allSettled(MAIL_FOLDERS.map((folder) => graphFolder(graphToken, folder, options)))
      : MAIL_FOLDERS.map(() => ({ status: 'rejected' }));
    const missing = results.map((result, index) => result.status === 'rejected' ? index : -1).filter((index) => index >= 0);
    if (missing.length) {
      try {
        const imapToken = await token(mailbox, false);
        const fallback = await Promise.allSettled(missing.map((index) => imapFolder(mailbox, imapToken, MAIL_FOLDERS[index], options)));
        missing.forEach((index, offset) => { results[index] = fallback[offset]; });
      } catch (error) {
        missing.forEach((index) => { results[index] = { status: 'rejected', reason: error }; });
      }
    }
    const warnings = results.flatMap((result, index) => result.status === 'rejected'
      ? [`${MAIL_FOLDERS[index].label === 'Junk' ? '垃圾邮件箱' : '收件箱'}读取失败，请检查邮箱授权后重试；当前结果不完整。`] : []);
    if (results.every((result) => result.status === 'rejected' && result.reason?.code === 'MAIL_AUTH_FAILED')) {
      throw mailError('邮箱授权失效或权限不足，请联系管理员', 'MAIL_AUTH_FAILED');
    }
    const hasMore = results.some((result) => result.status === 'fulfilled' && result.value.hasMore);
    if (warnings.length === MAIL_FOLDERS.length || (options.requireComplete && (warnings.length || hasMore))) {
      throw mailError('无法完整读取收件箱和垃圾邮件箱，无法确认最新邮件；请检查邮箱授权并稍后重试', 'MAIL_INCOMPLETE');
    }
    return {
      messages: sortMessages(results.flatMap((result) => result.status === 'fulfilled' ? result.value.messages : [])),
      hasMore, warnings
    };
  }
  return {
    collect,
    async list(mailbox, recipient = '') {
      const result = await collect(mailbox);
      return { ...result, messages: result.messages.filter((message) => !recipient || recipientMatches(message, recipient)),
        email: mailbox.email, ...(recipient ? { recipient } : {}),
        scope: `显示收件箱和垃圾邮件箱各自按接收时间最新的 ${BROWSE_LIMIT} 封邮件${recipient ? '，再按账号收件人筛选' : ''}。` };
    },
    async find(mailbox, expectedEmail, options = {}, kind = 'code') {
      const window = lookupOptions(options);
      if (window.latest && kind === 'code') window.maxAgeMinutes = MAIL_CODE_MAX_AGE_MINUTES;
      const result = await collect(mailbox, { ...window, expectedEmail, kind, requireComplete: true });
      return scanMessages(result.messages, expectedEmail, window, kind);
    }
  };
}

export function createReadStateStore(database) {
  return {
    annotate(mailboxId, messages) {
      const ids = new Set(database.prepare('SELECT message_id FROM mail_message_reads WHERE mailbox_id = ?').all(mailboxId).map((row) => row.message_id));
      return messages.map((message) => ({ ...message, isRead: ids.has(message.id) || ids.has(message.readId) }));
    },
    markRead(mailboxId, messageId, readId = messageId) {
      const insert = database.prepare('INSERT OR IGNORE INTO mail_message_reads (mailbox_id, message_id, read_at) VALUES (?, ?, ?)');
      const readAt = new Date().toISOString();
      database.transaction(() => {
        for (const id of new Set([messageId, readId])) insert.run(mailboxId, id, readAt);
      })();
    }
  };
}
