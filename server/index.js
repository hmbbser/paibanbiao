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
const accountOrderSql = 'ORDER BY sort_order ASC, created_at ASC';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function shortCommit(hash) {
  return hash ? String(hash).trim().slice(0, 7) : '';
}

async function currentGitCommit() {
  try {
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: appDir, timeout: 30_000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function remoteGitCommit() {
  try {
    const remote = `https://github.com/${githubRepo}.git`;
    const ref = `refs/heads/${githubBranch}`;
    const { stdout } = await execAsync(`git ls-remote ${shellQuote(remote)} ${shellQuote(ref)}`, { timeout: 45_000 });
    return stdout.trim().split(/\s+/)[0] || '';
  } catch {
    return '';
  }
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

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const emailPatternGlobal = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const mailboxFolders = [
  { label: 'INBOX', graph: 'inbox', imap: 'INBOX' },
  { label: 'Junk', graph: 'junkemail', imap: 'Junk' }
];

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function extractFirstEmail(value) {
  const match = String(value || '').match(emailPattern);
  return match ? normalizeEmail(match[0]) : '';
}

function parseMailboxLine(line, delimiter = '') {
  const raw = String(line || '').trim();
  if (!raw) return null;
  const delimiters = delimiter?.trim() ? [delimiter.trim()] : ['----', '|', '\t', ',', ';', ' '];
  for (const item of delimiters) {
    const parts = raw.split(item).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 4 || !emailPattern.test(parts[0])) continue;
    return {
      email: normalizeEmail(parts[0]),
      password: parts[1] || '',
      client_id: parts[2] || '',
      refresh_token: parts.slice(3).join(item).trim()
    };
  }
  return null;
}

function parseMailboxImport(content, delimiter = '') {
  const rows = String(content || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const valid = [];
  const invalid = [];
  for (const [index, line] of rows.entries()) {
    const item = parseMailboxLine(line, delimiter);
    if (!item || !item.email || !item.client_id || !item.refresh_token) {
      invalid.push({ line: index + 1, reason: '格式不正确' });
      continue;
    }
    valid.push(item);
  }
  return { valid, invalid, total: rows.length };
}

function upsertMailbox(item) {
  const existing = db.prepare('SELECT id FROM mailboxes WHERE email = ?').get(item.email);
  const timestamp = now();
  if (existing) {
    db.prepare('UPDATE mailboxes SET password = ?, client_id = ?, refresh_token = ?, updated_at = ? WHERE email = ?').run(
      item.password || '',
      item.client_id,
      item.refresh_token,
      timestamp,
      item.email
    );
    return 'updated';
  }
  db.prepare('INSERT INTO mailboxes (id, email, password, client_id, refresh_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    nanoid(),
    item.email,
    item.password || '',
    item.client_id,
    item.refresh_token,
    timestamp,
    timestamp
  );
  return 'created';
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtmlLines(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|table|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function extractVerificationCode(...values) {
  const text = values.map((value) => stripHtml(value)).join(' ');
  const focusedPatterns = [
    /(?:验证码|驗證碼|校验码|安全码|动态码|登录码|登陆码|verification\s*code|security\s*code|login\s*code|passcode|otp|code)[^\d]{0,40}(\d{4,8})/i,
    /(\d{4,8})[^\d]{0,24}(?:验证码|驗證碼|校验码|安全码|verification\s*code|security\s*code|login\s*code|passcode|otp|code)/i
  ];
  for (const pattern of focusedPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  const fallback = text.match(/(^|[^\d])(\d{6})(?!\d)/);
  return fallback?.[2] || '';
}

function messageText(...values) {
  return values.map((value) => stripHtmlLines(value)).filter(Boolean).join('\n');
}

function senderHasEmail(sender, expectedEmail) {
  const expected = normalizeEmail(expectedEmail);
  return (String(sender || '').match(emailPatternGlobal) || []).map(normalizeEmail).includes(expected);
}

function hasAnyPattern(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function findSteamCodeToken(value) {
  const ignored = new Set(['STEAM', 'VALVE', 'HTTPS']);
  const candidates = [];
  const matches = String(value || '').matchAll(/(^|[^A-Z0-9])([A-Z0-9]{5})(?![A-Z0-9])/g);
  for (const match of matches) {
    const token = match[2];
    if (!ignored.has(token)) candidates.push(token);
  }
  return candidates.at(-1) || '';
}

const steamGuardPatterns = [
  /Steam\s*Guard/i,
  /Steam\s*ガード/i,
  /ガードコード/,
  /Steam\s*令牌/,
  /Steam\s*安全/,
  /验证码|驗證碼|安全代码|安全碼|登录码|登入碼|令牌码|令牌碼|动态码|動態碼/,
  /보안\s*코드|가드\s*코드/,
  /c[oó]digo.{0,40}(?:Steam|Guard)|(?:Steam|Guard).{0,40}c[oó]digo/i,
  /code.{0,40}(?:Steam|Guard)|(?:Steam|Guard).{0,40}code/i,
  /codice.{0,40}(?:Steam|Guard)|(?:Steam|Guard).{0,40}codice/i,
  /c[oó]digo.{0,40}(?:Steam|Guard)|(?:Steam|Guard).{0,40}c[oó]digo/i,
  /код.{0,40}(?:Steam|Guard)|(?:Steam|Guard).{0,40}код/i
];

const steamLoginPatterns = [
  /new\s+(?:web|mobile|device)|new\s+login|login\s+attempt|access.{0,40}account/i,
  /新しい.{0,20}(?:デバイス|機器|ログイン)|ログインしよう/,
  /新的.{0,20}(?:设备|裝置|登录|登入)|新.{0,10}(?:Web|移动|流動)/,
  /새.{0,20}(?:기기|로그인)|로그인.{0,20}시도/,
  /nouveau.{0,30}(?:appareil|connexion)|tentative.{0,30}connexion/i,
  /nuevo.{0,30}(?:dispositivo|inicio)|intento.{0,30}(?:inicio|sesión)/i,
  /neue.{0,30}(?:gerät|anmeldung)|anmeldeversuch/i,
  /нов.{0,30}(?:устрой|вход)|попыт.{0,30}вход/i
];

const steamRequestOriginPatterns = [
  /リクエスト元[:：]?/,
  /request\s*(?:origin|from)[:：]?/i,
  /请求.{0,8}(?:来源|源)|請求.{0,8}(?:來源|源)|登录.{0,8}(?:地点|位置)|登入.{0,8}(?:地點|位置)/,
  /요청.{0,8}(?:위치|출처)|로그인.{0,8}위치/,
  /origine.{0,20}(?:demande|requête)|provenance/i,
  /origen.{0,20}(?:solicitud|petición)|procedencia/i,
  /origine.{0,20}richiesta/i,
  /anforderungs.{0,12}(?:ort|ursprung)|anfrage.{0,12}(?:ort|ursprung)/i,
  /источник.{0,20}запрос|место.{0,20}запрос/i
];

function findTokenNearLine(lines, patterns, afterLineCount) {
  for (let index = 0; index < lines.length; index += 1) {
    if (!hasAnyPattern(lines[index], patterns)) continue;
    const code = findSteamCodeToken(lines.slice(index, index + afterLineCount).join('\n'));
    if (code) return code;
  }
  return '';
}

function extractSteamGuardCode(message) {
  if (!senderHasEmail(message.sender, 'noreply@steampowered.com')) return '';
  const text = messageText(message.subject, message.text, message.html);
  const compact = text.replace(/\s+/g, ' ');
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const hasGuardSignal = hasAnyPattern(compact, steamGuardPatterns);
  const hasLoginSignal = hasAnyPattern(compact, steamLoginPatterns);
  const hasOriginSignal = hasAnyPattern(compact, steamRequestOriginPatterns);
  const hasNearbyToken = Boolean(hasGuardSignal && findTokenNearLine(lines, steamGuardPatterns, 10));
  const isLoginGuardMail = /Steam/i.test(text) && hasGuardSignal && (hasLoginSignal || hasOriginSignal || hasNearbyToken);
  if (!isLoginGuardMail) return '';

  const originCode = findTokenNearLine(lines, steamRequestOriginPatterns, 6);
  if (originCode) return originCode;

  const guardCode = findTokenNearLine(lines, steamGuardPatterns, 10);
  if (guardCode) return guardCode;

  for (const pattern of steamGuardPatterns) {
    const markerIndex = compact.search(pattern);
    if (markerIndex >= 0) {
      const code = findSteamCodeToken(compact.slice(markerIndex, markerIndex + 480));
      if (code) return code;
    }
  }
  return findSteamCodeToken(compact.slice(0, 1200));
}

function extractMessageCode(message) {
  const steamCode = extractSteamGuardCode(message);
  if (steamCode) return steamCode;
  if (senderHasEmail(message.sender, 'noreply@steampowered.com')) return '';
  return extractVerificationCode(message.subject, message.text, message.html);
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function cleanUrlCandidate(value) {
  return decodeHtmlEntities(value)
    .trim()
    .replace(/[)\].,;\uFF0C\u3002]+$/g, '');
}

const steamRecoveryPatterns = [
  /account\s*(?:recovery|recover|reset)|recover.{0,30}(?:account|password|credentials)|reset.{0,30}(?:password|credentials)/i,
  /Steam.{0,30}(?:recovery|recover|reset|password|credentials)/i,
  /\u30a2\u30ab\u30a6\u30f3\u30c8.{0,24}(?:\u5fa9\u65e7|\u56de\u5fa9)|(?:\u5fa9\u65e7|\u56de\u5fa9).{0,24}(?:\u30a2\u30ab\u30a6\u30f3\u30c8|\u30ed\u30b0\u30a4\u30f3\u8cc7\u683c\u60c5\u5831)/,
  /(?:\u627e\u56de|\u6062\u590d|\u6062\u5fa9|\u91cd\u7f6e|\u91cd\u8a2d).{0,24}(?:\u8d26\u53f7|\u5e10\u53f7|\u8cec\u865f|\u5e33\u865f|\u5bc6\u7801|\u5bc6\u78bc)/,
  /(?:\uacc4\uc815|\ube44\ubc00\ubc88\ud638).{0,24}(?:\ubcf5\uad6c|\uc7ac\uc124\uc815)|(?:\ubcf5\uad6c|\uc7ac\uc124\uc815).{0,24}(?:\uacc4\uc815|\ube44\ubc00\ubc88\ud638)/,
  /(?:recuperar|recuperaci[o\u00f3]n|restablecer|redefinir|senha|contrase[n\u00f1]a|mot de passe|r[e\u00e9]cup[e\u00e9]ration|zur[u\u00fc]cksetzen|wiederherstellung)/i
];

function steamRecoveryLinkFromCandidate(candidate) {
  const cleaned = cleanUrlCandidate(candidate);
  try {
    const url = new URL(cleaned);
    if (url.hostname.toLowerCase() !== 'help.steampowered.com') return '';
    if (!url.pathname.includes('/wizard/VerifyCode')) return '';
    if (!url.searchParams.has('c')) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function extractSteamRecoveryLink(message) {
  if (!senderHasEmail(message.sender, 'noreply@steampowered.com')) return '';
  const raw = decodeHtmlEntities([message.subject, message.text, message.html].filter(Boolean).join('\n'));
  const text = messageText(message.subject, message.text, message.html);
  const compact = `${stripHtml(raw)} ${text}`.replace(/\s+/g, ' ');
  const hasRecoverySignal = hasAnyPattern(compact, steamRecoveryPatterns) || /AccountRecoveryCode|wizard\/VerifyCode/i.test(raw);
  if (!hasRecoverySignal || !/Steam/i.test(compact)) return '';

  const candidates = raw.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  for (const candidate of candidates) {
    const link = steamRecoveryLinkFromCandidate(candidate);
    if (link) return link;
  }
  return '';
}

function graphAddresses(recipients = []) {
  return recipients.map((item) => normalizeEmail(item?.emailAddress?.address)).filter(Boolean);
}

function messageRecipients(message) {
  return [...(message.to || []), ...(message.cc || [])].map(normalizeEmail).filter(Boolean);
}

function recipientMatches(message, expectedEmail) {
  const expected = normalizeEmail(expectedEmail);
  return messageRecipients(message).some((email) => email === expected);
}

async function requestMicrosoftToken(refreshToken, clientId, graph = false) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });
  if (graph) body.set('scope', 'https://graph.microsoft.com/.default');

  const response = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const error = new Error('邮箱授权失效，请联系管理员');
    error.status = 502;
    throw error;
  }
  return data;
}

async function getGraphAccessToken(mailbox) {
  const data = await requestMicrosoftToken(mailbox.refresh_token, mailbox.client_id, true);
  const scope = String(data.scope || '');
  if (!scope.includes('https://graph.microsoft.com/Mail.Read')) {
    const error = new Error('Graph Mail.Read 权限不可用');
    error.code = 'GRAPH_PERMISSION_MISSING';
    throw error;
  }
  return data.access_token;
}

async function fetchGraphMessages(accessToken, folder) {
  const url = new URL(`https://graph.microsoft.com/v1.0/me/mailFolders/${folder.graph}/messages`);
  url.searchParams.set('$top', '100');
  url.searchParams.set('$orderby', 'receivedDateTime desc');
  url.searchParams.set('$select', 'id,subject,bodyPreview,body,receivedDateTime,createdDateTime,from,toRecipients,ccRecipients');
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const error = new Error('读取邮箱失败，请联系管理员');
    error.status = 502;
    throw error;
  }
  const data = await response.json();
  return (data.value || []).map((item) => ({
    id: item.id,
    mailbox: folder.label,
    sender: item.from?.emailAddress?.address || '',
    subject: item.subject || '',
    text: item.bodyPreview || '',
    html: item.body?.content || '',
    receivedAt: item.receivedDateTime || item.createdDateTime || '',
    to: graphAddresses(item.toRecipients),
    cc: graphAddresses(item.ccRecipients)
  }));
}

async function fetchImapMessages(mailbox, folder) {
  const imapModule = await import('node-imap');
  const parserModule = await import('mailparser');
  const Imap = imapModule.default || imapModule;
  const simpleParser = parserModule.simpleParser || parserModule.default?.simpleParser;
  if (!Imap || !simpleParser) throw new Error('IMAP 依赖不可用');

  const token = await requestMicrosoftToken(mailbox.refresh_token, mailbox.client_id, false);
  const authString = Buffer.from(`user=${mailbox.email}\x01auth=Bearer ${token.access_token}\x01\x01`).toString('base64');

  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: mailbox.email,
      xoauth2: authString,
      host: 'outlook.office365.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });
    const messages = [];
    let settled = false;
    let expected = 0;
    let parsed = 0;

    function finish(error) {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(messages.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()));
    }

    imap.once('ready', async () => {
      try {
        await new Promise((openResolve, openReject) => {
          imap.openBox(folder.imap, true, (error, box) => error ? openReject(error) : openResolve(box));
        });
        const ids = await new Promise((searchResolve, searchReject) => {
          imap.search(['ALL'], (error, results) => error ? searchReject(error) : searchResolve(results || []));
        });
        const latest = ids.slice(-100);
        expected = latest.length;
        if (!expected) {
          imap.end();
          return;
        }
        const fetcher = imap.fetch(latest, { bodies: '' });
        fetcher.on('message', (msg) => {
          msg.on('body', (stream) => {
            simpleParser(stream)
              .then((mail) => {
                messages.push({
                  mailbox: folder.label,
                  sender: mail.from?.text || '',
                  subject: mail.subject || '',
                  text: mail.text || '',
                  html: mail.html || '',
                  receivedAt: mail.date ? mail.date.toISOString() : '',
                  to: (mail.to?.value || []).map((item) => normalizeEmail(item.address)).filter(Boolean),
                  cc: (mail.cc?.value || []).map((item) => normalizeEmail(item.address)).filter(Boolean)
                });
              })
              .catch(() => {})
              .finally(() => {
                parsed += 1;
                if (parsed >= expected) imap.end();
              });
          });
        });
        fetcher.once('error', (error) => {
          imap.end();
          finish(error);
        });
      } catch (error) {
        imap.end();
        finish(error);
      }
    });

    imap.once('error', finish);
    imap.once('end', () => finish());
    imap.connect();
  });
}

function scanMessagesForCode(messages, expectedEmail) {
  const ordered = [...messages].sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime());
  for (const message of ordered) {
    if (!recipientMatches(message, expectedEmail)) continue;
    const code = extractMessageCode(message);
    if (!code) continue;
    return {
      code,
      email: normalizeEmail(expectedEmail),
      recipient: normalizeEmail(expectedEmail),
      mailbox: message.mailbox,
      subject: message.subject || '',
      sender: message.sender || '',
      receivedAt: message.receivedAt || ''
    };
  }
  return null;
}

function scanMessagesForRecoveryLink(messages, expectedEmail) {
  const ordered = [...messages].sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime());
  for (const message of ordered) {
    if (!recipientMatches(message, expectedEmail)) continue;
    const link = extractSteamRecoveryLink(message);
    if (!link) continue;
    return {
      link,
      email: normalizeEmail(expectedEmail),
      recipient: normalizeEmail(expectedEmail),
      mailbox: message.mailbox,
      subject: message.subject || '',
      sender: message.sender || '',
      receivedAt: message.receivedAt || ''
    };
  }
  return null;
}

async function findMailboxCode(mailbox, expectedEmail) {
  const errors = [];
  let graphCompleted = false;
  try {
    const graphToken = await getGraphAccessToken(mailbox);
    const graphMessages = [];
    for (const folder of mailboxFolders) {
      graphMessages.push(...await fetchGraphMessages(graphToken, folder));
    }
    const found = scanMessagesForCode(graphMessages, expectedEmail);
    if (found) return found;
    graphCompleted = true;
  } catch (error) {
    errors.push(error);
  }

  if (graphCompleted) return null;

  const imapMessages = [];
  for (const folder of mailboxFolders) {
    try {
      imapMessages.push(...await fetchImapMessages(mailbox, folder));
    } catch (error) {
      errors.push(error);
    }
  }
  const found = scanMessagesForCode(imapMessages, expectedEmail);
  if (found) return found;

  if (errors.length && errors.every((error) => error.status === 502 || error.code === 'GRAPH_PERMISSION_MISSING')) {
    const authError = errors.find((error) => error.status === 502);
    if (authError && errors.length > 1) throw authError;
  }
  return null;
}

async function findMailboxRecoveryLink(mailbox, expectedEmail) {
  const errors = [];
  let graphCompleted = false;
  try {
    const graphToken = await getGraphAccessToken(mailbox);
    const graphMessages = [];
    for (const folder of mailboxFolders) {
      graphMessages.push(...await fetchGraphMessages(graphToken, folder));
    }
    const found = scanMessagesForRecoveryLink(graphMessages, expectedEmail);
    if (found) return found;
    graphCompleted = true;
  } catch (error) {
    errors.push(error);
  }

  if (graphCompleted) return null;

  const imapMessages = [];
  for (const folder of mailboxFolders) {
    try {
      imapMessages.push(...await fetchImapMessages(mailbox, folder));
    } catch (error) {
      errors.push(error);
    }
  }
  const found = scanMessagesForRecoveryLink(imapMessages, expectedEmail);
  if (found) return found;

  if (errors.length && errors.every((error) => error.status === 502 || error.code === 'GRAPH_PERMISSION_MISSING')) {
    const authError = errors.find((error) => error.status === 502);
    if (authError && errors.length > 1) throw authError;
  }
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

app.get('/api/public-settings', (_req, res) => {
  const settings = Object.fromEntries(allRows('settings').map((item) => [item.key, item.value]));
  res.json({ siteName: settings.siteName || '甜排班' });
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
  const allowed = ['siteName', 'timezone', 'defaultView', 'auditRetentionDays', 'auditRetentionCustomDays', 'accountCopyFields', 'nameScrollSeconds', 'toastDurationSeconds'];
  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const key of allowed) {
    if (typeof req.body[key] === 'string') update.run(key, req.body[key].trim());
  }
  audit(req.user.id, 'update', 'settings', 'system', '修改系统基本信息');
  const settings = Object.fromEntries(allRows('settings').map((item) => [item.key, item.value]));
  res.json({ settings, version: appVersion });
});

app.get('/api/overview', requireAuth, (_req, res) => {
  const accounts = db.prepare(`SELECT * FROM accounts ${accountOrderSql}`).all();
  const users = db.prepare('SELECT id, username, role, enabled, created_at FROM users ORDER BY created_at DESC').all();
  res.json({ accounts, users, bookings: bookingList() });
});

app.get('/api/accounts', requireAuth, (_req, res) => {
  res.json(db.prepare(`SELECT * FROM accounts ${accountOrderSql}`).all());
});

app.get('/api/account-names', requireAuth, (_req, res) => {
  res.json(db.prepare('SELECT * FROM account_names ORDER BY created_at ASC').all());
});

app.post('/api/account-names', requireAuth, requireAdmin, (req, res) => {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: '名称不能为空' });
  const duplicate = db.prepare('SELECT id FROM account_names WHERE name = ?').get(name);
  if (duplicate) return res.status(409).json({ error: '这个名称已经存在' });
  const id = nanoid();
  db.prepare('INSERT INTO account_names (id, name, created_at) VALUES (?, ?, ?)').run(id, name, now());
  audit(req.user.id, 'create', 'account_name', id, `新增账号名称 ${name}`);
  res.json(db.prepare('SELECT * FROM account_names WHERE id = ?').get(id));
});

app.put('/api/account-names/:id', requireAuth, requireAdmin, (req, res) => {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: '名称不能为空' });
  const duplicate = db.prepare('SELECT id FROM account_names WHERE name = ? AND id != ?').get(name, req.params.id);
  if (duplicate) return res.status(409).json({ error: '这个名称已经存在' });
  const old = db.prepare('SELECT * FROM account_names WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: '名称不存在' });
  db.prepare('UPDATE account_names SET name = ? WHERE id = ?').run(name, req.params.id);
  audit(req.user.id, 'update', 'account_name', req.params.id, `修改账号名称 ${old.name} -> ${name}`);
  res.json(db.prepare('SELECT * FROM account_names WHERE id = ?').get(req.params.id));
});

app.delete('/api/account-names/:id', requireAuth, requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM account_names WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM account_names WHERE id = ?').run(req.params.id);
  audit(req.user.id, 'delete', 'account_name', req.params.id, `删除账号名称 ${old?.name || req.params.id}`);
  res.json({ ok: true });
});

app.get('/api/mailboxes', requireAuth, requireAdmin, (_req, res) => {
  res.json(db.prepare('SELECT * FROM mailboxes ORDER BY created_at DESC').all());
});

app.post('/api/mailboxes', requireAuth, requireAdmin, (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '').trim();
  const clientId = String(req.body.client_id || '').trim();
  const refreshToken = String(req.body.refresh_token || '').trim();
  if (!email || !emailPattern.test(email) || !clientId || !refreshToken) {
    return res.status(400).json({ error: '请填写邮箱、Client ID 和 Refresh Token' });
  }
  const duplicate = db.prepare('SELECT id FROM mailboxes WHERE email = ?').get(email);
  if (duplicate) return res.status(409).json({ error: '这个邮箱已经存在' });
  const id = nanoid();
  const timestamp = now();
  db.prepare('INSERT INTO mailboxes (id, email, password, client_id, refresh_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    email,
    password,
    clientId,
    refreshToken,
    timestamp,
    timestamp
  );
  audit(req.user.id, 'create', 'mailbox', id, `新增邮箱 ${email}`);
  res.json(db.prepare('SELECT * FROM mailboxes WHERE id = ?').get(id));
});

app.put('/api/mailboxes/:id', requireAuth, requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM mailboxes WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: '邮箱不存在' });
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '').trim();
  const clientId = String(req.body.client_id || '').trim();
  const refreshToken = String(req.body.refresh_token || '').trim();
  if (!email || !emailPattern.test(email) || !clientId || !refreshToken) {
    return res.status(400).json({ error: '请填写邮箱、Client ID 和 Refresh Token' });
  }
  const duplicate = db.prepare('SELECT id FROM mailboxes WHERE email = ? AND id != ?').get(email, req.params.id);
  if (duplicate) return res.status(409).json({ error: '这个邮箱已经存在' });
  db.prepare('UPDATE mailboxes SET email = ?, password = ?, client_id = ?, refresh_token = ?, updated_at = ? WHERE id = ?').run(
    email,
    password,
    clientId,
    refreshToken,
    now(),
    req.params.id
  );
  audit(req.user.id, 'update', 'mailbox', req.params.id, `修改邮箱 ${old.email} -> ${email}`);
  res.json(db.prepare('SELECT * FROM mailboxes WHERE id = ?').get(req.params.id));
});

app.delete('/api/mailboxes/:id', requireAuth, requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM mailboxes WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM mailboxes WHERE id = ?').run(req.params.id);
  audit(req.user.id, 'delete', 'mailbox', req.params.id, `删除邮箱 ${old?.email || req.params.id}`);
  res.json({ ok: true });
});

app.post('/api/mailboxes/import', requireAuth, requireAdmin, (req, res) => {
  const parsed = parseMailboxImport(req.body.content, req.body.delimiter);
  let created = 0;
  let updated = 0;
  const transaction = db.transaction(() => {
    for (const item of parsed.valid) {
      const result = upsertMailbox(item);
      if (result === 'created') created += 1;
      else updated += 1;
    }
  });
  transaction();
  audit(req.user.id, 'import', 'mailbox', null, `导入邮箱：新增 ${created}，更新 ${updated}，失败 ${parsed.invalid.length}`);
  res.json({
    total: parsed.total,
    created,
    updated,
    failed: parsed.invalid.length,
    invalid: parsed.invalid
  });
});

app.post('/api/accounts', requireAuth, requireAdmin, (req, res) => {
  const { name, login, password, remark, status = 'active' } = req.body;
  if (!name?.trim() || !login?.trim() || !password?.trim()) return res.status(400).json({ error: '账号名称、账号和密码必填' });
  const id = nanoid();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as value FROM accounts').get();
  db.prepare('INSERT INTO accounts (id, name, login, password, remark, status, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    name.trim(),
    login.trim(),
    password.trim(),
    remark || '',
    status,
    Number(maxOrder.value || 0) + 10,
    now()
  );
  audit(req.user.id, 'create', 'account', id, `新增账号 ${name}`);
  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
});

app.post('/api/accounts/order', requireAuth, requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map((id) => String(id)) : [];
  const currentIds = db.prepare(`SELECT id FROM accounts ${accountOrderSql}`).all().map((item) => item.id);
  if (!ids.length || ids.length !== currentIds.length || new Set(ids).size !== currentIds.length) {
    return res.status(400).json({ error: '\u8d26\u53f7\u6392\u5e8f\u6570\u636e\u4e0d\u5b8c\u6574' });
  }
  const currentSet = new Set(currentIds);
  if (ids.some((id) => !currentSet.has(id))) return res.status(400).json({ error: '\u8d26\u53f7\u6392\u5e8f\u6570\u636e\u4e0d\u6b63\u786e' });
  const update = db.prepare('UPDATE accounts SET sort_order = ? WHERE id = ?');
  const transaction = db.transaction(() => {
    ids.forEach((id, index) => update.run((index + 1) * 10, id));
  });
  transaction();
  audit(req.user.id, 'update', 'account', null, '\u8c03\u6574\u8d26\u53f7\u6392\u5e8f');
  res.json(db.prepare(`SELECT * FROM accounts ${accountOrderSql}`).all());
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

app.post('/api/accounts/:id/mail-code', requireAuth, async (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: '账号不存在' });
  const email = extractFirstEmail(account.remark);
  if (!email) return res.status(404).json({ error: '未找到邮箱，请联系管理员' });
  const mailbox = db.prepare('SELECT * FROM mailboxes WHERE email = ?').get(email);
  if (!mailbox) return res.status(404).json({ error: '未找到邮箱，请联系管理员' });
  try {
    const result = await findMailboxCode(mailbox, email);
    if (!result) return res.status(404).json({ error: '未找到验证码，请稍后重试' });
    audit(req.user.id, 'lookup', 'mail_code', account.id, `获取登录验证码 ${account.name}`);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '获取验证码失败，请联系管理员' });
  }
});

app.post('/api/accounts/:id/password-reset-link', requireAuth, async (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: '\u8d26\u53f7\u4e0d\u5b58\u5728' });
  const email = extractFirstEmail(account.remark);
  if (!email) return res.status(404).json({ error: '\u672a\u627e\u5230\u90ae\u7bb1\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458' });
  const mailbox = db.prepare('SELECT * FROM mailboxes WHERE email = ?').get(email);
  if (!mailbox) return res.status(404).json({ error: '\u672a\u627e\u5230\u90ae\u7bb1\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458' });
  try {
    const result = await findMailboxRecoveryLink(mailbox, email);
    if (!result) return res.status(404).json({ error: '\u672a\u627e\u5230\u91cd\u7f6e\u5bc6\u7801\u94fe\u63a5\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5' });
    audit(req.user.id, 'lookup', 'password_reset_link', account.id, `\u83b7\u53d6\u91cd\u7f6e\u5bc6\u7801\u94fe\u63a5 ${account.name}`);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || '\u83b7\u53d6\u91cd\u7f6e\u5bc6\u7801\u94fe\u63a5\u5931\u8d25\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458' });
  }
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
      if (table === 'mailboxes' && !Array.isArray(payload[table])) {
        payload[table] = [];
      }
      if (table === 'account_names' && !Array.isArray(payload[table])) {
        const names = Array.from(new Set((payload.accounts || []).map((account) => String(account.name || '').trim()).filter(Boolean)));
        payload[table] = names.map((name) => ({ id: nanoid(), name, created_at: now() }));
      }
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
    const [response, localCommit, remoteCommit] = await Promise.all([
      fetch(url, { cache: 'no-store' }),
      currentGitCommit(),
      remoteGitCommit()
    ]);
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
    const remotePackage = await response.json();
    const latestVersion = remotePackage.version || '0.0.0';
    const versionChanged = compareVersion(latestVersion, appVersion) > 0;
    const commitChanged = Boolean(localCommit && remoteCommit && localCommit !== remoteCommit);
    const localShort = shortCommit(localCommit);
    const remoteShort = shortCommit(remoteCommit);
    res.json({
      current: localShort ? `${appVersion} (${localShort})` : appVersion,
      latest: remoteShort ? `${latestVersion} (${remoteShort})` : latestVersion,
      currentVersion: appVersion,
      latestVersion,
      currentCommit: localCommit,
      latestCommit: remoteCommit,
      hasUpdate: versionChanged || commitChanged,
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
    const composeCommand = `
      if docker compose version >/dev/null 2>&1; then
        docker compose up -d --build --force-recreate --remove-orphans
      elif command -v docker-compose >/dev/null 2>&1; then
        docker-compose up -d --build --force-recreate --remove-orphans
      else
        echo "docker compose/docker-compose 不可用" >&2
        exit 1
      fi
    `;
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
