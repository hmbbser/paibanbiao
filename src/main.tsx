import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Archive,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  DatabaseBackup,
  Download,
  FileClock,
  GripVertical,
  KeyRound,
  LogOut,
  Mail,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import './styles.css';
import { InboxButton } from './MailInbox';
import { UpdatePanel } from './UpdatePanel';

type Role = 'admin' | 'user';
type User = { id: string; username: string; role: Role; enabled: boolean; created_at: string; can_switch?: boolean };
type AppSettings = { siteName: string; timezone: string; defaultView: string; exportVersion?: string; auditRetentionDays?: string; auditRetentionCustomDays?: string; accountCopyFields?: string; nameScrollSeconds?: string; toastDurationSeconds?: string; mailLookupWindowMinutes?: string };
type Account = { id: string; name: string; login: string; password: string; remark: string; status: string; mailbox_id?: string; sort_order?: number; created_at: string };
type AccountName = { id: string; name: string; created_at: string };
type Mailbox = { id: string; email: string; password: string; remark: string; client_id: string; refresh_token: string; created_at: string; updated_at: string };
type MailCodeResult = { code: string; email: string; recipient?: string; mailbox?: string; subject?: string; sender?: string; receivedAt?: string };
type PasswordResetLinkResult = { link: string; email: string; recipient?: string; mailbox?: string; subject?: string; sender?: string; receivedAt?: string };
type BookingStatus = 'reserved' | 'active' | 'completed' | 'ended_early' | 'cancelled';
type Booking = {
  id: string;
  account_id: string;
  account_name?: string;
  account_login?: string;
  renter_name: string;
  renter_contact: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  operator_id: string;
  operator_name?: string;
  remark: string;
  created_at: string;
  updated_at: string;
};
type AuditLog = { id: string; actor_name?: string; action: string; entity_type: string; summary: string; created_at: string };
type Overview = { accounts: Account[]; users: User[]; bookings: Booking[] };

const defaultSettings: AppSettings = { siteName: '甜排班', timezone: 'Asia/Shanghai', defaultView: 'day', auditRetentionDays: '7', accountCopyFields: 'name,login,password,status', nameScrollSeconds: '8', toastDurationSeconds: '1', mailLookupWindowMinutes: '10' };
const localMockEnabled = import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE === 'true';

const statusText: Record<BookingStatus, string> = {
  reserved: '预约',
  active: '出租中',
  completed: '已结束',
  ended_early: '已结束',
  cancelled: '已删除'
};

const editableBookingStatuses: BookingStatus[] = ['reserved', 'active', 'completed'];

type NavItem = {
  id: string;
  label: string;
  icon: typeof CalendarDays;
  admin?: boolean;
};

const navItems: NavItem[] = [
  { id: 'timeline', label: '时间线', icon: CalendarDays },
  { id: 'accounts', label: '账号', icon: KeyRound },
  { id: 'mailboxes', label: '邮箱', icon: Mail, admin: true },
  { id: 'users', label: '用户', icon: Users, admin: true },
  { id: 'records', label: '记录', icon: FileClock },
  { id: 'backup', label: '备份', icon: DatabaseBackup, admin: true },
  { id: 'settings', label: '设置', icon: Settings }
];

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  if (localMockEnabled) return mockApi<T>(url, options);

  const res = await fetch(url, {
    credentials: 'include',
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || '请求失败');
  return data;
}

async function copyTextToClipboard(text: string) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
}

type MockState = Overview & {
  settings: AppSettings;
  accountNames: AccountName[];
  mailboxes: Mailbox[];
  auditLogs: AuditLog[];
  sessionUserId: string;
  switchRootUserId?: string;
};

const mockKey = 'cute-schedule-local-mock';

function mockNow(offsetHours = 0) {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + offsetHours);
  return date.toISOString();
}

function mockBooking(id: string, account: Account, renter: string, contact: string, startHour: number, endHour: number, status: BookingStatus, operator: User): Booking {
  const start = new Date();
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(start);
  end.setHours(endHour, 0, 0, 0);
  return {
    id,
    account_id: account.id,
    account_name: account.name,
    account_login: account.login,
    renter_name: renter,
    renter_contact: contact,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    status,
    operator_id: operator.id,
    operator_name: operator.username,
    remark: '',
    created_at: mockNow(-2),
    updated_at: mockNow(-1)
  };
}

function createMockState(): MockState {
  const admin: User = { id: 'u-admin', username: 'admin', role: 'admin', enabled: true, created_at: mockNow(-72) };
  const staff: User = { id: 'u-staff', username: 'xiaomei', role: 'user', enabled: true, created_at: mockNow(-48) };
  const accounts: Account[] = [
    { id: 'a-1', name: 'A账号', login: 'A123456', password: 'aA123456', remark: '主力账号 demo@example.com', status: 'active', created_at: mockNow(-60) },
    { id: 'a-2', name: 'B账号', login: 'B234567', password: 'bB234567', remark: '备用账号', status: 'active', created_at: mockNow(-50) },
    { id: 'a-3', name: 'C账号', login: 'C345678', password: 'cC345678', remark: '游戏账号', status: 'active', created_at: mockNow(-40) },
    { id: 'a-4', name: 'D账号', login: 'D456789', password: 'dD456789', remark: '测试账号', status: 'active', created_at: mockNow(-30) }
  ];
  const mailboxes: Mailbox[] = [
    {
      id: 'm-1',
      email: 'demo@example.com',
      password: 'demo-password',
      remark: '本地演示邮箱',
      client_id: 'demo-client-id',
      refresh_token: 'demo-refresh-token',
      created_at: mockNow(-20),
      updated_at: mockNow(-20)
    }
  ];
  accounts[0].mailbox_id = mailboxes[0].id;
  return {
    settings: { ...defaultSettings, siteName: '账号出租管理系统', exportVersion: '0.2.13', auditRetentionDays: '7' },
    users: [admin, staff],
    accounts,
    mailboxes,
    accountNames: uniqueNames(accounts.map((account) => account.name)).map((name, index) => ({
      id: `name-${index + 1}`,
      name,
      created_at: mockNow(-59 + index)
    })),
    bookings: [
      mockBooking('b-1', accounts[0], '张三', '138****1234', 0, 6, 'completed', admin),
      mockBooking('b-2', accounts[1], '周八', '159****1111', 9, 15, 'reserved', admin),
      mockBooking('b-3', accounts[0], '李四', '139****5678', 8, 12, 'active', admin),
      mockBooking('b-4', accounts[2], '郑十一', '138****4444', 10, 14, 'active', staff),
      mockBooking('b-5', accounts[0], '赵六', '136****2468', 18, 22, 'reserved', admin)
    ],
    auditLogs: [
      { id: 'log-1', actor_name: 'admin', action: 'local_mock', entity_type: 'system', summary: '本地 UI 调试数据已初始化', created_at: mockNow(-1) }
    ],
    sessionUserId: admin.id,
    switchRootUserId: admin.id
  };
}

function loadMockState() {
  const raw = localStorage.getItem(mockKey);
  if (!raw) {
    const initial = createMockState();
    saveMockState(initial);
    return initial;
  }
  try {
    return normalizeMockState(JSON.parse(raw) as MockState);
  } catch {
    const initial = createMockState();
    saveMockState(initial);
    return initial;
  }
}

function normalizeNameKey(name: string) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function uniqueNames(names: string[]) {
  const map = new Map<string, string>();
  names.forEach((name) => {
    const display = name.trim();
    const key = normalizeNameKey(display);
    if (display && key && !map.has(key)) map.set(key, display);
  });
  return Array.from(map.values());
}

function sortAccountsByOrder(accounts: Account[]) {
  return [...accounts].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function normalizeMockState(state: MockState) {
  if (Array.isArray(state.accounts)) {
    const missingSortOrder = state.accounts.some((account) => !Number.isFinite(Number(account.sort_order)));
    state.accounts = sortAccountsByOrder(state.accounts.map((account, index) => ({
      ...account,
      sort_order: Number.isFinite(Number(account.sort_order)) ? Number(account.sort_order) : (index + 1) * 10
    })));
    if (missingSortOrder) saveMockState(state);
  }
  if (!Array.isArray(state.mailboxes)) {
    state.mailboxes = [];
    saveMockState(state);
  } else {
    const missingMailboxRemark = state.mailboxes.some((mailbox) => typeof mailbox.remark !== 'string');
    if (missingMailboxRemark) {
      state.mailboxes = state.mailboxes.map((mailbox) => ({ ...mailbox, remark: mailbox.remark || '' }));
      saveMockState(state);
    }
  }
  if (!Array.isArray(state.accountNames)) {
    state.accountNames = uniqueNames(state.accounts.map((account) => account.name)).map((name, index) => ({
      id: `name-${index + 1}`,
      name,
      created_at: mockNow(-59 + index)
    }));
    saveMockState(state);
  }
  state.settings = { ...defaultSettings, ...state.settings };
  return state;
}

function saveMockState(state: MockState) {
  localStorage.setItem(mockKey, JSON.stringify(state));
}

function addMockAudit(state: MockState, actor: User | undefined, action: string, entityType: string, summary: string) {
  state.auditLogs.unshift({
    id: crypto.randomUUID(),
    actor_name: actor?.username || '系统',
    action,
    entity_type: entityType,
    summary,
    created_at: new Date().toISOString()
  });
}

function auditRetentionDays(settings: AppSettings) {
  const raw = settings.auditRetentionDays === 'custom' ? settings.auditRetentionCustomDays : settings.auditRetentionDays;
  const days = Number(raw || 7);
  return Number.isFinite(days) && days > 0 ? days : 7;
}

function applyMockAuditRetention(state: MockState) {
  const days = auditRetentionDays(state.settings);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const nextLogs = state.auditLogs.filter((log) => new Date(log.created_at).getTime() >= cutoff);
  if (nextLogs.length !== state.auditLogs.length) {
    state.auditLogs = nextLogs;
    saveMockState(state);
  }
}

function enrichBookings(state: MockState) {
  return state.bookings.map((booking) => {
    const account = state.accounts.find((item) => item.id === booking.account_id);
    const operator = state.users.find((item) => item.id === booking.operator_id);
    return {
      ...booking,
      status: getAutoBookingStatus(booking),
      account_name: account?.name || booking.account_name,
      account_login: account?.login || booking.account_login,
      operator_name: operator?.username || booking.operator_name
    };
  });
}

function readBody<T>(options: RequestInit): T {
  if (!options.body || options.body instanceof FormData) return {} as T;
  return JSON.parse(String(options.body)) as T;
}

const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function normalizeEmailText(value: string) {
  return value.trim().toLowerCase();
}

function extractFirstEmailText(value: string) {
  const match = String(value || '').match(emailRegex);
  return match ? normalizeEmailText(match[0]) : '';
}

function parseMailboxImportText(content: string, delimiter = '') {
  const rows = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const valid: Omit<Mailbox, 'id' | 'created_at' | 'updated_at'>[] = [];
  const invalid: { line: number; reason: string }[] = [];
  const delimiters = delimiter.trim() ? [delimiter.trim()] : ['----', '|', '\t', ',', ';', ' '];
  rows.forEach((line, index) => {
    let parsed: Omit<Mailbox, 'id' | 'created_at' | 'updated_at'> | null = null;
    for (const item of delimiters) {
      const parts = line.split(item).map((part) => part.trim());
      if (parts.length < 4 || !emailRegex.test(parts[0])) continue;
      parsed = {
        email: normalizeEmailText(parts[0]),
        password: parts[1] || '',
        client_id: parts[2] || '',
        refresh_token: parts[3] || '',
        remark: parts.slice(4).join(item).trim()
      };
      break;
    }
    if (!parsed || !parsed.email || !parsed.client_id || !parsed.refresh_token) invalid.push({ line: index + 1, reason: '格式不正确' });
    else valid.push(parsed);
  });
  return { total: rows.length, valid, invalid };
}

function maskSecret(value: string, start = 6, end = 4) {
  if (!value) return '-';
  if (value.length <= start + end) return '*'.repeat(value.length);
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function isBlockingBooking(status?: BookingStatus) {
  return status !== 'cancelled';
}

function bookingTimesOverlap(a: Pick<Booking, 'starts_at' | 'ends_at'>, b: Pick<Booking, 'starts_at' | 'ends_at'>) {
  return new Date(a.starts_at) < new Date(b.ends_at) && new Date(b.starts_at) < new Date(a.ends_at);
}

function getAutoBookingStatus(booking: Pick<Booking, 'starts_at' | 'ends_at' | 'status'>, nowDate = new Date()): BookingStatus {
  if (booking.status === 'cancelled' || booking.status === 'ended_early') return booking.status;
  const start = new Date(booking.starts_at);
  const end = new Date(booking.ends_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return booking.status;
  if (nowDate >= end) return 'completed';
  if (nowDate >= start) return 'active';
  return 'reserved';
}

function withAutoBookingStatus<T extends Booking>(booking: T): T {
  return { ...booking, status: getAutoBookingStatus(booking) };
}

function findBookingConflicts(bookings: Booking[], candidate: Pick<Booking, 'account_id' | 'starts_at' | 'ends_at'> & { id?: string }) {
  return bookings.filter((booking) => (
    booking.id !== candidate.id
    && booking.account_id === candidate.account_id
    && isBlockingBooking(booking.status)
    && bookingTimesOverlap(candidate, booking)
  ));
}

function collectConflictIds(bookings: Booking[]) {
  const ids = new Set<string>();
  bookings.forEach((booking, index) => {
    if (!isBlockingBooking(booking.status)) return;
    for (let nextIndex = index + 1; nextIndex < bookings.length; nextIndex += 1) {
      const other = bookings[nextIndex];
      if (
        isBlockingBooking(other.status)
        && booking.account_id === other.account_id
        && bookingTimesOverlap(booking, other)
      ) {
        ids.add(booking.id);
        ids.add(other.id);
      }
    }
  });
  return ids;
}

async function mockApi<T>(url: string, options: RequestInit = {}): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 90));
  const state = loadMockState();
  const method = (options.method || 'GET').toUpperCase();
  const sessionUser = state.users.find((item) => item.id === state.sessionUserId) || state.users[0];
  const rootUser = state.switchRootUserId ? state.users.find((item) => item.id === state.switchRootUserId) : null;
  const canSwitch = sessionUser.role === 'admin' || rootUser?.role === 'admin';
  const publicMockUser = (item: User) => ({ ...item, can_switch: canSwitch });
  const ok = (value: unknown) => value as T;
  const fail = (message: string): never => {
    throw new Error(message);
  };

  if (url === '/api/setup' && method === 'GET') return ok({ complete: true });
  if (url === '/api/public-settings') return ok({ siteName: state.settings.siteName || defaultSettings.siteName });
  if (url === '/api/setup' && method === 'POST') {
    const body = readBody<{ siteName?: string; username?: string }>(options);
    const admin = { ...state.users[0], username: body.username || 'admin' };
    state.users[0] = admin;
    state.settings.siteName = body.siteName || state.settings.siteName;
    state.sessionUserId = admin.id;
    saveMockState(state);
    return ok({ user: { ...admin, can_switch: true } });
  }
  if (url === '/api/auth/me') return ok({ user: publicMockUser(sessionUser), settings: state.settings });
  if (url === '/api/auth/login' && method === 'POST') {
    const body = readBody<{ username: string }>(options);
    const user = state.users.find((item) => item.username === body.username && item.enabled) || state.users[0];
    state.sessionUserId = user.id;
    state.switchRootUserId = user.role === 'admin' ? user.id : undefined;
    saveMockState(state);
    return ok({ user: { ...user, can_switch: user.role === 'admin' } });
  }
  if (url === '/api/auth/logout' && method === 'POST') {
    state.sessionUserId = '';
    saveMockState(state);
    return ok({ success: true });
  }
  if (url === '/api/auth/switch-user' && method === 'POST') {
    if (!canSwitch) fail('只有管理员可以快捷切换用户');
    const body = readBody<{ userId: string }>(options);
    const nextUser = state.users.find((item) => item.id === body.userId && item.enabled);
    if (!nextUser) return fail('用户不存在或已停用');
    if (!state.switchRootUserId && sessionUser.role === 'admin') state.switchRootUserId = sessionUser.id;
    state.sessionUserId = nextUser.id;
    saveMockState(state);
    return ok({ user: publicMockUser(nextUser) });
  }
  if (url === '/api/overview') return ok({ accounts: state.accounts, users: state.users, bookings: enrichBookings(state) });
  if (url === '/api/audit-logs' && method === 'GET') {
    applyMockAuditRetention(state);
    return ok(state.auditLogs);
  }
  if (url === '/api/audit-logs' && method === 'DELETE') {
    state.auditLogs = [];
    saveMockState(state);
    return ok({ success: true });
  }
  if (url === '/api/settings' && method === 'PUT') {
    state.settings = { ...state.settings, ...readBody<AppSettings>(options) };
    addMockAudit(state, sessionUser, 'update', 'settings', '修改系统基本信息');
    saveMockState(state);
    return ok({ settings: state.settings });
  }
  if (url === '/api/admin/version') return ok({ current: '0.2.13-local', latest: '0.2.13-local', hasUpdate: false, repo: 'hmbbser/paibanbiao', branch: 'main' });
  if (url === '/api/admin/update/status') return ok({ job: null });
  if (url === '/api/admin/update' && method === 'POST') return fail('本地演示模式不执行真实更新，请在服务器上操作');
  if (url === '/api/admin/import' && method === 'POST') {
    if (options.body instanceof FormData) {
      const file = options.body.get('file');
      if (file instanceof File) {
        const text = await file.text();
        const imported = JSON.parse(text) as Partial<MockState>;
        if (!Array.isArray(imported.accounts) || !Array.isArray(imported.users) || !Array.isArray(imported.bookings) || !imported.settings) {
          return fail('备份文件格式不正确');
        }
        const importedUsers = imported.users;
        const importedAccounts = imported.accounts;
        const importedBookings = imported.bookings;
        const importedMailboxes = (imported.mailboxes || []).map((mailbox) => ({ ...mailbox, remark: mailbox.remark || '' }));
        const importedAccountNames = imported.accountNames || uniqueNames(importedAccounts.map((account) => account.name)).map((name, index) => ({
          id: `name-${index + 1}`,
          name,
          created_at: new Date().toISOString()
        }));
        saveMockState({
          settings: { ...defaultSettings, ...imported.settings },
          users: importedUsers,
          accounts: importedAccounts,
          mailboxes: importedMailboxes,
          accountNames: importedAccountNames,
          bookings: importedBookings,
          auditLogs: imported.auditLogs || [],
          sessionUserId: imported.sessionUserId || importedUsers[0]?.id || '',
          switchRootUserId: imported.switchRootUserId
        });
      }
    }
    return ok({ recovery: 'local-ui-recovery' });
  }

  if (url === '/api/mailboxes' && method === 'GET') return ok(state.mailboxes);
  if (url === '/api/mailboxes' && method === 'POST') {
    const body = readBody<Partial<Mailbox>>(options);
    const email = normalizeEmailText(body.email || '');
    if (!email || !body.client_id || !body.refresh_token) return fail('请填写邮箱、Client ID 和 Refresh Token');
    if (state.mailboxes.some((item) => item.email === email)) return fail('这个邮箱已经存在');
    const item: Mailbox = {
      id: crypto.randomUUID(),
      email,
      password: body.password || '',
      remark: body.remark || '',
      client_id: body.client_id,
      refresh_token: body.refresh_token,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    state.mailboxes.unshift(item);
    addMockAudit(state, sessionUser, 'create', 'mailbox', `新增邮箱 ${email}`);
    saveMockState(state);
    return ok(item);
  }
  if (url === '/api/mailboxes/import' && method === 'POST') {
    const body = readBody<{ content: string; delimiter?: string }>(options);
    const parsed = parseMailboxImportText(body.content || '', body.delimiter || '');
    let created = 0;
    let updated = 0;
    parsed.valid.forEach((item) => {
      const existingIndex = state.mailboxes.findIndex((mailbox) => mailbox.email === item.email);
      if (existingIndex >= 0) {
        state.mailboxes[existingIndex] = { ...state.mailboxes[existingIndex], ...item, updated_at: new Date().toISOString() };
        updated += 1;
      } else {
        state.mailboxes.unshift({ ...item, id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        created += 1;
      }
    });
    addMockAudit(state, sessionUser, 'import', 'mailbox', `导入邮箱：新增 ${created}，更新 ${updated}，失败 ${parsed.invalid.length}`);
    saveMockState(state);
    return ok({ total: parsed.total, created, updated, failed: parsed.invalid.length, invalid: parsed.invalid });
  }

  const mailCodeMatch = url.match(/^\/api\/accounts\/([^/]+)\/mail-code$/);
  if (mailCodeMatch && method === 'POST') {
    const account = state.accounts.find((item) => item.id === mailCodeMatch[1]);
    if (!account) return fail('账号不存在');
    if (!account.mailbox_id) return fail('请先在账号里选择收件邮箱');
    const mailbox = state.mailboxes.find((item) => item.id === account.mailbox_id);
    const email = extractFirstEmailText(account.remark) || mailbox?.email || '';
    if (!mailbox) return fail('账号绑定的收件邮箱不存在，请重新选择');
    const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const mockCode = Array.from({ length: 5 }, () => codeChars[Math.floor(Math.random() * codeChars.length)]).join('');
    const result = {
      code: mockCode,
      email,
      recipient: email,
      mailbox: 'Junk',
      subject: 'ご利用のSteamアカウントに新しいWebまたはモバイル機器からのアクセスがありました',
      sender: 'noreply_at_steampowered_com_demo@icloud.com',
      receivedAt: new Date().toISOString()
    };
    addMockAudit(state, sessionUser, 'lookup', 'mail_code', `获取登录验证码 ${account.name} (${account.login})，收件人 ${email}，验证码 ${mockCode}，文件夹 ${result.mailbox}，邮件时间 ${result.receivedAt}，主题 ${result.subject}`);
    saveMockState(state);
    return ok(result);
  }

  const passwordResetMatch = url.match(/^\/api\/accounts\/([^/]+)\/password-reset-link$/);
  if (passwordResetMatch && method === 'POST') {
    const account = state.accounts.find((item) => item.id === passwordResetMatch[1]);
    if (!account) return fail('账号不存在');
    if (!account.mailbox_id) return fail('请先在账号里选择收件邮箱');
    const mailbox = state.mailboxes.find((item) => item.id === account.mailbox_id);
    const email = extractFirstEmailText(account.remark) || mailbox?.email || '';
    if (!mailbox) return fail('账号绑定的收件邮箱不存在，请重新选择');
    const result = {
      link: 'https://help.steampowered.com/ja/wizard/VerifyCode?i=406&s=710806048765760421&m=2&c=5H64C',
      email,
      recipient: email,
      mailbox: 'Junk',
      subject: 'Steam\u30a2\u30ab\u30a6\u30f3\u30c8\u5fa9\u65e7',
      sender: 'noreply_at_steampowered_com_demo@icloud.com',
      receivedAt: new Date().toISOString()
    };
    addMockAudit(state, sessionUser, 'lookup', 'password_reset_link', `获取重置密码链接 ${account.name} (${account.login})，收件人 ${email}，链接 ${result.link}，文件夹 ${result.mailbox}，邮件时间 ${result.receivedAt}，主题 ${result.subject}`);
    saveMockState(state);
    return ok(result);
  }

  const mailboxMatch = url.match(/^\/api\/mailboxes\/(.+)$/);
  if (mailboxMatch && method === 'PUT') {
    const body = readBody<Partial<Mailbox>>(options);
    const email = normalizeEmailText(body.email || '');
    if (!email || !body.client_id || !body.refresh_token) return fail('请填写邮箱、Client ID 和 Refresh Token');
    if (state.mailboxes.some((item) => item.id !== mailboxMatch[1] && item.email === email)) return fail('这个邮箱已经存在');
    state.mailboxes = state.mailboxes.map((item) => item.id === mailboxMatch[1] ? {
      ...item,
      email,
      password: body.password || '',
      remark: body.remark || '',
      client_id: body.client_id || '',
      refresh_token: body.refresh_token || '',
      updated_at: new Date().toISOString()
    } : item);
    addMockAudit(state, sessionUser, 'update', 'mailbox', `修改邮箱 ${email}`);
    saveMockState(state);
    return ok(state.mailboxes.find((item) => item.id === mailboxMatch[1]));
  }
  if (mailboxMatch && method === 'DELETE') {
    const old = state.mailboxes.find((item) => item.id === mailboxMatch[1]);
    state.mailboxes = state.mailboxes.filter((item) => item.id !== mailboxMatch[1]);
    addMockAudit(state, sessionUser, 'delete', 'mailbox', `删除邮箱 ${old?.email || mailboxMatch[1]}`);
    saveMockState(state);
    return ok({ success: true });
  }

  const accountMatch = url.match(/^\/api\/accounts\/(.+)$/);
  if (url === '/api/accounts' && method === 'POST') {
    const body = readBody<Partial<Account>>(options);
    const mailboxId = String(body.mailbox_id || '').trim();
    if (mailboxId && !state.mailboxes.some((mailbox) => mailbox.id === mailboxId)) return fail('选择的收件邮箱不存在');
    const maxOrder = Math.max(0, ...state.accounts.map((account) => Number(account.sort_order) || 0));
    const account: Account = {
      id: crypto.randomUUID(),
      name: body.name || '新账号',
      login: body.login || '',
      password: body.password || '',
      remark: body.remark || '',
      status: body.status || 'active',
      mailbox_id: mailboxId,
      sort_order: maxOrder + 10,
      created_at: new Date().toISOString()
    };
    state.accounts.push(account);
    addMockAudit(state, sessionUser, 'create', 'account', `新增账号 ${account.name}`);
    saveMockState(state);
    return ok(account);
  }
  if (url === '/api/accounts/order' && method === 'POST') {
    const body = readBody<{ ids?: string[] }>(options);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const currentIds = state.accounts.map((account) => account.id);
    const currentSet = new Set(currentIds);
    if (!ids.length || ids.length !== currentIds.length || new Set(ids).size !== currentIds.length || ids.some((id) => !currentSet.has(id))) {
      return fail('\u8d26\u53f7\u6392\u5e8f\u6570\u636e\u4e0d\u6b63\u786e');
    }
    const orderMap = new Map(ids.map((id, index) => [id, (index + 1) * 10]));
    state.accounts = sortAccountsByOrder(state.accounts.map((account) => ({ ...account, sort_order: orderMap.get(account.id) || account.sort_order })));
    addMockAudit(state, sessionUser, 'update', 'account', '\u8c03\u6574\u8d26\u53f7\u6392\u5e8f');
    saveMockState(state);
    return ok(state.accounts);
  }
  const accountNameMatch = url.match(/^\/api\/account-names\/(.+)$/);
  if (url === '/api/account-names' && method === 'GET') return ok(state.accountNames);
  if (url === '/api/account-names' && method === 'POST') {
    const body = readBody<Partial<AccountName>>(options);
    const name = body.name?.trim();
    if (!name) return fail('名称不能为空');
    const nameKey = normalizeNameKey(name);
    if (state.accountNames.some((item) => normalizeNameKey(item.name) === nameKey)) return fail('这个名称已经存在');
    const item: AccountName = { id: crypto.randomUUID(), name, created_at: new Date().toISOString() };
    state.accountNames.push(item);
    addMockAudit(state, sessionUser, 'create', 'account_name', `新增账号名称 ${name}`);
    saveMockState(state);
    return ok(item);
  }
  if (accountNameMatch && method === 'PUT') {
    const body = readBody<Partial<AccountName>>(options);
    const name = body.name?.trim();
    if (!name) return fail('名称不能为空');
    const nameKey = normalizeNameKey(name);
    if (state.accountNames.some((item) => item.id !== accountNameMatch[1] && normalizeNameKey(item.name) === nameKey)) return fail('这个名称已经存在');
    const old = state.accountNames.find((item) => item.id === accountNameMatch[1]);
    if (!old) return fail('名称不存在');
    state.accountNames = state.accountNames.map((item) => item.id === accountNameMatch[1] ? { ...item, name } : item);
    let syncedAccounts = 0;
    state.accounts = state.accounts.map((account) => {
      if (normalizeNameKey(account.name) !== normalizeNameKey(old.name)) return account;
      syncedAccounts += 1;
      return { ...account, name };
    });
    addMockAudit(state, sessionUser, 'update', 'account_name', `修改账号名称 ${old.name} -> ${name}，同步 ${syncedAccounts} 个账号`);
    saveMockState(state);
    return ok({ ...state.accountNames.find((item) => item.id === accountNameMatch[1]), syncedAccounts });
  }
  if (accountNameMatch && method === 'DELETE') {
    const old = state.accountNames.find((item) => item.id === accountNameMatch[1]);
    state.accountNames = state.accountNames.filter((item) => item.id !== accountNameMatch[1]);
    addMockAudit(state, sessionUser, 'delete', 'account_name', `删除账号名称 ${old?.name || accountNameMatch[1]}`);
    saveMockState(state);
    return ok({ success: true });
  }
  if (accountMatch && method === 'PUT') {
    const body = readBody<Partial<Account>>(options);
    const mailboxId = String(body.mailbox_id || '').trim();
    if (mailboxId && !state.mailboxes.some((mailbox) => mailbox.id === mailboxId)) return fail('选择的收件邮箱不存在');
    state.accounts = state.accounts.map((item) => item.id === accountMatch[1] ? { ...item, ...body, mailbox_id: mailboxId } : item);
    addMockAudit(state, sessionUser, 'update', 'account', `修改账号 ${body.name || accountMatch[1]}`);
    saveMockState(state);
    return ok({ success: true });
  }
  if (accountMatch && method === 'DELETE') {
    const account = state.accounts.find((item) => item.id === accountMatch[1]);
    state.accounts = state.accounts.filter((item) => item.id !== accountMatch[1]);
    state.bookings = state.bookings.filter((item) => item.account_id !== accountMatch[1]);
    addMockAudit(state, sessionUser, 'delete', 'account', `删除账号 ${account?.name || accountMatch[1]}`);
    saveMockState(state);
    return ok({ success: true });
  }

  const userMatch = url.match(/^\/api\/users\/(.+)$/);
  if (url === '/api/users' && method === 'POST') {
    const body = readBody<Partial<User>>(options);
    const user: User = {
      id: crypto.randomUUID(),
      username: body.username || 'new-user',
      role: body.role || 'user',
      enabled: body.enabled ?? true,
      created_at: new Date().toISOString()
    };
    state.users.unshift(user);
    addMockAudit(state, sessionUser, 'create', 'user', `新增用户 ${user.username}`);
    saveMockState(state);
    return ok(user);
  }
  if (userMatch && method === 'PUT') {
    const body = readBody<Partial<User>>(options);
    state.users = state.users.map((item) => item.id === userMatch[1] ? { ...item, ...body } : item);
    addMockAudit(state, sessionUser, 'update', 'user', `修改用户 ${body.username || userMatch[1]}`);
    saveMockState(state);
    return ok({ success: true });
  }
  if (userMatch && method === 'DELETE') {
    const target = state.users.find((item) => item.id === userMatch[1]);
    state.users = state.users.filter((item) => item.id !== userMatch[1]);
    addMockAudit(state, sessionUser, 'delete', 'user', `删除用户 ${target?.username || userMatch[1]}`);
    saveMockState(state);
    return ok({ success: true });
  }

  const bookingActionMatch = url.match(/^\/api\/bookings\/(.+)\/action$/);
  if (bookingActionMatch && method === 'PATCH') {
    const body = readBody<{ action: 'endEarly' | 'renew' | 'cancel'; ends_at?: string }>(options);
    const booking = state.bookings.find((item) => item.id === bookingActionMatch[1]);
    if (!booking) return fail('记录不存在');
    if (body.action === 'renew') {
      const newEndValue = body.ends_at || '';
      if (!newEndValue) fail('请选择新的结束时间后再续租');
      const oldEndTime = new Date(booking.ends_at).getTime();
      const newEndTime = new Date(newEndValue).getTime();
      if (Number.isNaN(newEndTime)) fail('请选择有效的续租时间');
      if (newEndTime === oldEndTime) fail('请先选择新的结束时间后再续租');
      if (newEndTime <= oldEndTime) fail('续租时间必须晚于当前结束时间');
      const account = state.accounts.find((item) => item.id === booking.account_id);
      if (account?.status !== 'active') fail('账号已停用，不能续租');
      const conflicts = findBookingConflicts(state.bookings, {
        id: booking.id,
        account_id: booking.account_id,
        starts_at: booking.starts_at,
        ends_at: newEndValue
      });
      if (conflicts.length) fail('这个时间被预约啦，请调整时间');
    }
    const timestamp = new Date().toISOString();
    if (body.action === 'cancel') {
      state.bookings = state.bookings.filter((item) => item.id !== bookingActionMatch[1]);
      addMockAudit(state, sessionUser, 'delete', 'booking', `删除出租记录 ${booking.renter_name}`);
    } else {
      state.bookings = state.bookings.map((item) => {
        if (item.id !== bookingActionMatch[1]) return item;
        if (body.action === 'endEarly') return { ...item, status: 'ended_early', ends_at: timestamp, updated_at: timestamp };
        return { ...item, ends_at: body.ends_at || item.ends_at, updated_at: timestamp };
      });
      addMockAudit(
        state,
        sessionUser,
        body.action,
        'booking',
        body.action === 'endEarly' ? `提前结束出租记录 ${booking.renter_name}` : `续租出租记录 ${booking.renter_name}`
      );
    }
    saveMockState(state);
    return ok({ success: true });
  }

  const bookingMatch = url.match(/^\/api\/bookings\/(.+)$/);
  if (url === '/api/bookings' && method === 'POST') {
    const body = readBody<Partial<Booking>>(options);
    const account = state.accounts.find((item) => item.id === body.account_id);
    if (!account) return fail('请选择账号');
    if (account.status !== 'active') fail('账号已停用，不能新建出租');
    const booking: Booking = {
      id: crypto.randomUUID(),
      account_id: body.account_id || account.id,
      account_name: account.name,
      account_login: account.login,
      renter_name: body.renter_name || '新租客',
      renter_contact: body.renter_contact || '',
      starts_at: body.starts_at || new Date().toISOString(),
      ends_at: body.ends_at || addHours(new Date(), 1).toISOString(),
      status: body.status || 'reserved',
      operator_id: sessionUser.id,
      operator_name: sessionUser.username,
      remark: body.remark || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const conflicts = findBookingConflicts(state.bookings, booking);
    if (conflicts.length) fail('这个时间被预约啦，请调整时间');
    state.bookings.unshift(booking);
    addMockAudit(state, sessionUser, 'create', 'booking', `新增出租记录 ${booking.renter_name}`);
    saveMockState(state);
    return ok(booking);
  }
  if (bookingMatch && method === 'PUT') {
    const body = readBody<Partial<Booking>>(options);
    const oldBooking = state.bookings.find((item) => item.id === bookingMatch[1]);
    if (!oldBooking) return fail('记录不存在');
    const targetAccount = state.accounts.find((item) => item.id === (body.account_id ?? oldBooking.account_id));
    if (!targetAccount) return fail('账号不存在');
    const accountChanged = (body.account_id ?? oldBooking.account_id) !== oldBooking.account_id;
    const timeChanged = Boolean(
      (body.starts_at && body.starts_at !== oldBooking.starts_at)
      || (body.ends_at && body.ends_at !== oldBooking.ends_at)
    );
    if (targetAccount.status !== 'active' && (accountChanged || timeChanged)) fail('账号已停用，不能安排出租');
    const nextBooking: Booking = {
      ...oldBooking,
      ...body,
      account_id: body.account_id ?? oldBooking.account_id,
      renter_name: body.renter_name ?? oldBooking.renter_name,
      renter_contact: body.renter_contact ?? oldBooking.renter_contact,
      starts_at: body.starts_at ?? oldBooking.starts_at,
      ends_at: body.ends_at ?? oldBooking.ends_at,
      status: body.status ?? oldBooking.status,
      operator_id: body.operator_id ?? oldBooking.operator_id,
      remark: body.remark ?? oldBooking.remark,
      created_at: body.created_at ?? oldBooking.created_at,
      updated_at: new Date().toISOString()
    };
    const conflicts = findBookingConflicts(state.bookings, nextBooking);
    if (conflicts.length) fail('这个时间被预约啦，请调整时间');
    state.bookings = state.bookings.map((item) => item.id === bookingMatch[1] ? { ...item, ...body, updated_at: new Date().toISOString() } : item);
    addMockAudit(state, sessionUser, 'update', 'booking', `修改出租记录 ${body.renter_name || oldBooking.renter_name}`);
    saveMockState(state);
    return ok({ success: true });
  }
  if (bookingMatch && method === 'DELETE') {
    const booking = state.bookings.find((item) => item.id === bookingMatch[1]);
    state.bookings = state.bookings.filter((item) => item.id !== bookingMatch[1]);
    addMockAudit(state, sessionUser, 'delete', 'booking', `删除出租记录 ${booking?.renter_name || bookingMatch[1]}`);
    saveMockState(state);
    return ok({ success: true });
  }

  return fail(`本地 mock 暂不支持：${method} ${url}`);
}

function App() {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettingsState] = useState<AppSettings>(() => ({ ...defaultSettings, siteName: getCachedSiteName() }));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bootstrap();
  }, []);

  function applySettings(nextSettings: AppSettings) {
    const merged = { ...defaultSettings, ...nextSettings };
    setSettingsState(merged);
    document.title = merged.siteName || defaultSettings.siteName;
    if (typeof window !== 'undefined') localStorage.setItem('schedule-site-name', merged.siteName || defaultSettings.siteName);
    return merged;
  }

  async function bootstrap() {
    try {
      try {
        const publicSettings = await api<{ siteName?: string }>('/api/public-settings');
        if (publicSettings.siteName) applySettings({ ...settings, siteName: publicSettings.siteName });
      } catch {
        document.title = settings.siteName || defaultSettings.siteName;
      }
      const setup = await api<{ complete: boolean }>('/api/setup');
      setSetupComplete(setup.complete);
      if (setup.complete) {
        const me = await api<{ user: User; settings: AppSettings }>('/api/auth/me');
        setUser(me.user);
        applySettings(me.settings);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  if (loading || setupComplete === null) return <Splash siteName={settings.siteName} />;
  if (!setupComplete) return <SetupWizard onDone={(next, nextSettings) => { setSetupComplete(true); setUser(next); applySettings(nextSettings); }} />;
  if (!user) return <Login onDone={(next, nextSettings) => { setUser(next); applySettings(nextSettings); }} />;
  return <Dashboard user={user} settings={settings} onUser={setUser} onSettings={applySettings} onLogout={() => setUser(null)} />;
}

function getCachedSiteName() {
  if (typeof window === 'undefined') return defaultSettings.siteName;
  return localStorage.getItem('schedule-site-name') || defaultSettings.siteName;
}

function Splash({ siteName }: { siteName: string }) {
  return (
    <main className="auth-shell">
      <div className="brand-card">
        <Sparkles />
        <h1>{siteName || defaultSettings.siteName}</h1>
        <p>正在整理今天的可爱时间线...</p>
      </div>
    </main>
  );
}

function SetupWizard({ onDone }: { onDone: (user: User, settings: AppSettings) => void }) {
  const [form, setForm] = useState({ siteName: '甜排班', username: '', password: '' });
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const res = await api<{ user: User }>('/api/setup', { method: 'POST', body: JSON.stringify(form) });
      const nextSettings = { ...defaultSettings, siteName: form.siteName || defaultSettings.siteName };
      document.title = nextSettings.siteName;
      onDone(res.user, nextSettings);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <AuthPanel title="安装向导" subtitle="先创建第一个管理员账号，这个账号拥有最高权限。">
      <form className="stack" onSubmit={submit}>
        <Field label="系统名称" value={form.siteName} onChange={(siteName) => setForm({ ...form, siteName })} />
        <Field label="管理员用户名" value={form.username} onChange={(username) => setForm({ ...form, username })} />
        <Field label="管理员密码" type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} />
        {error && <p className="form-error">{error}</p>}
        <button className="primary large">完成安装</button>
      </form>
    </AuthPanel>
  );
}

function Login({ onDone }: { onDone: (user: User, settings: AppSettings) => void }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const res = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify(form) });
      const me = await api<{ user: User; settings: AppSettings }>('/api/auth/me');
      const nextSettings = { ...defaultSettings, ...me.settings };
      document.title = nextSettings.siteName;
      onDone(res.user, nextSettings);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <AuthPanel title="欢迎回来" subtitle="同一个入口登录，系统会按角色显示对应功能。">
      <form className="stack" onSubmit={submit}>
        <Field label="用户名" value={form.username} onChange={(username) => setForm({ ...form, username })} />
        <Field label="密码" type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} />
        {error && <p className="form-error">{error}</p>}
        <button className="primary large">登录</button>
      </form>
    </AuthPanel>
  );
}

function AuthPanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="logo-bubble">
          <CalendarDays />
          <Sparkles />
        </div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        {children}
      </section>
    </main>
  );
}

function Dashboard({
  user,
  settings,
  onUser,
  onSettings,
  onLogout
}: {
  user: User;
  settings: AppSettings;
  onUser: (user: User) => void;
  onSettings: (settings: AppSettings) => void;
  onLogout: () => void;
}) {
  const [active, setActive] = useState('timeline');
  const [overview, setOverview] = useState<Overview>({ accounts: [], users: [], bookings: [] });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Booking | null>(null);
  const [accountEditing, setAccountEditing] = useState<Account | null>(null);
  const [accountViewing, setAccountViewing] = useState<Account | null>(null);
  const [viewing, setViewing] = useState<Booking | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [pageLoading, setPageLoading] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    setPageLoading(true);
    const timer = window.setTimeout(() => setPageLoading(false), 500);
    return () => window.clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(''), getToastDurationMs(settings));
    return () => window.clearTimeout(timer);
  }, [error, settings]);

  async function refresh() {
    const data = await api<Overview>('/api/overview');
    setOverview({ ...data, bookings: data.bookings.map(withAutoBookingStatus) });
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    onLogout();
  }

  async function switchUser(userId: string) {
    const res = await api<{ user: User }>('/api/auth/switch-user', { method: 'POST', body: JSON.stringify({ userId }) });
    onUser(res.user);
    await refresh();
  }

  const visibleNav = navItems.filter((item) => (!item.admin || user.role === 'admin') && (item.id !== 'settings' || user.role === 'admin'));
  const filteredBookings = overview.bookings.filter((booking) => {
    const text = `${booking.account_name} ${booking.account_login} ${booking.renter_name} ${booking.renter_contact} ${booking.operator_name} ${booking.remark}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });
  const filteredAccounts = overview.accounts.filter((account) => {
    if (!query.trim()) return true;
    const text = `${account.name} ${account.login} ${account.password} ${account.remark}`.toLowerCase();
    return text.includes(query.toLowerCase()) || filteredBookings.some((booking) => booking.account_id === account.id);
  });

  return (
    <div className="app-shell" style={{ '--toast-duration': `${getToastDurationMs(settings)}ms` } as React.CSSProperties}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <CalendarDays size={18} />
            <Sparkles size={11} />
          </div>
          <span>{settings.siteName || '甜排班'}</span>
        </div>
        <nav>
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={active === item.id ? 'active' : ''} onClick={() => setActive(item.id)}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="avatar-bubble"><Sparkles size={18} /></div>
          <div>
            <strong>{user.username}</strong>
            <span>{user.role === 'admin' ? '管理员' : '普通用户'}</span>
          </div>
          <button className="icon-btn" onClick={logout}><LogOut size={15} /></button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button className="icon-btn mobile-menu"><Menu size={18} /></button>
          <div className="topbar-spacer" />
          <div className="user-pill">{user.role === 'admin' ? '管理员' : '普通用户'} · {user.username}</div>
          <button className="icon-btn" onClick={logout}><LogOut size={17} /></button>
        </header>

        <section className="content">
          <NoticeToast message={error} tone="danger" />
          {active === 'timeline' && (
            <Timeline
              user={user}
              settings={settings}
              users={overview.users}
              accounts={filteredAccounts}
              bookings={filteredBookings}
              query={query}
              onQuery={setQuery}
              onSwitchUser={switchUser}
              onViewAccount={(account) => setAccountViewing(account)}
              onEditAccount={(account) => setAccountEditing(account)}
              onNew={() => { setEditing(null); setDrawerOpen(true); }}
                onEdit={(booking) => setViewing(booking)}
              />
            )}
          {active === 'accounts' && <AccountsPanel user={user} settings={settings} accounts={overview.accounts} refresh={refresh} />}
          {active === 'mailboxes' && user.role === 'admin' && <MailboxesPanel />}
          {active === 'users' && user.role === 'admin' && <UsersPanel users={overview.users} refresh={refresh} />}
          {active === 'records' && (
            <RecordsPanel
              user={user}
              bookings={filteredBookings}
              accounts={overview.accounts}
              users={overview.users}
              refresh={refresh}
              onEdit={(booking) => { setEditing(booking); setDrawerOpen(true); }}
            />
          )}
          {active === 'backup' && user.role === 'admin' && <BackupPanel settings={settings} />}
          {active === 'settings' && <SettingsPanel user={user} settings={settings} onSettings={onSettings} />}
          {pageLoading && <div className="page-loader"><span /></div>}
        </section>
      </main>

      <MobileTabs active={active} setActive={setActive} isAdmin={user.role === 'admin'} />
      {drawerOpen && (
        <BookingDrawer
          user={user}
          accounts={overview.accounts}
          booking={editing}
          onClose={() => setDrawerOpen(false)}
          onSaved={async () => {
            setDrawerOpen(false);
            await refresh();
          }}
          onError={setError}
        />
      )}
      {viewing && (
        <BookingDetailModal
          booking={viewing}
          settings={settings}
          onClose={() => setViewing(null)}
          onDeleted={async () => {
            setViewing(null);
            await refresh();
          }}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
            setDrawerOpen(true);
          }}
          canEdit={user.role === 'admin' || viewing.operator_id === user.id}
        />
      )}
      {accountViewing && (
        <AccountDetailModal
          account={accountViewing}
          settings={settings}
          onClose={() => setAccountViewing(null)}
          onDeleted={user.role === 'admin' ? async () => {
            setAccountViewing(null);
            await refresh();
          } : undefined}
          onEdit={user.role === 'admin' ? () => {
            setAccountEditing(accountViewing);
            setAccountViewing(null);
          } : undefined}
          onStatusChanged={user.role === 'admin' ? async (nextAccount) => {
            setAccountViewing(nextAccount);
            await refresh();
          } : undefined}
        />
      )}
      {accountEditing && (
        <AccountModal
          account={accountEditing}
          onClose={() => setAccountEditing(null)}
          onSaved={async () => {
            setAccountEditing(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function Timeline({
  user,
  settings,
  users,
  accounts,
  bookings,
  query,
  onQuery,
  onSwitchUser,
  onViewAccount,
  onEditAccount,
  onNew,
  onEdit
}: {
  user: User;
  settings: AppSettings;
  users: User[];
  accounts: Account[];
  bookings: Booking[];
  query: string;
  onQuery: (value: string) => void;
  onSwitchUser: (userId: string) => void;
  onViewAccount: (account: Account) => void;
  onEditAccount: (account: Account) => void;
  onNew: () => void;
  onEdit: (booking: Booking) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<BookingStatus | 'all' | 'conflict'>('all');
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateValue(new Date()));
  const [recordMode, setRecordMode] = useState<'today' | 'recent'>('today');
  const [nameFilter, setNameFilter] = useState<string[]>([]);
  const [accountRailOpen, setAccountRailOpen] = useState(true);
  const [accountRailEnabled, setAccountRailEnabled] = useState(false);
  const schedulerRef = useRef<HTMLDivElement>(null);
  const schedulerDrag = useRef({
    active: false,
    moved: false,
    captured: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    suppressClickUntil: 0
  });
  const autoBookings = useMemo(() => bookings.map(withAutoBookingStatus), [bookings]);
  const selectedNameSet = useMemo(() => new Set(nameFilter), [nameFilter]);
  const accountNameById = useMemo(() => new Map(accounts.map((account) => [account.id, account.name])), [accounts]);
  const hasNameFilter = selectedNameSet.size > 0;
  const matchAccountName = (name?: string) => !hasNameFilter || selectedNameSet.has(name || '');
  const start = new Date(`${selectedDate}T00:00:00`);
  const end = new Date(start);
  end.setHours(24);
  const isSelectedToday = selectedDate === getLocalDateValue(new Date());
  const activeBookings = autoBookings.filter((booking) => {
    if (booking.status === 'cancelled') return false;
    if (!matchAccountName(booking.account_name || accountNameById.get(booking.account_id))) return false;
    const bookingStart = new Date(booking.starts_at);
    const bookingEnd = new Date(booking.ends_at);
    return bookingEnd > start && bookingStart < end;
  });
  const conflictIds = collectConflictIds(activeBookings);
  const visibleBookings = activeBookings.filter((booking) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'conflict') return conflictIds.has(booking.id);
    if (statusFilter === 'completed') return booking.status === 'completed' || booking.status === 'ended_early';
    return booking.status === statusFilter;
  });
  const visibleBookingAccountIds = new Set(visibleBookings.map((booking) => booking.account_id));
  const visibleAccounts = accounts.filter((account) => matchAccountName(account.name) && (account.status === 'active' || visibleBookingAccountIds.has(account.id)));
  const activeAccountCount = accounts.filter((account) => matchAccountName(account.name) && account.status === 'active').length;
  const miniBookings = recordMode === 'today'
    ? visibleBookings
    : autoBookings.filter((booking) => booking.status !== 'cancelled' && matchAccountName(booking.account_name || accountNameById.get(booking.account_id))).slice(0, 8);
  const currentLeft = percentBetween(new Date(), start, end);
  const metrics = {
    today: activeBookings.length,
    expiring: activeBookings.filter((booking) => new Date(booking.ends_at).getTime() - Date.now() < 1000 * 60 * 60 * 2 && new Date(booking.ends_at) > new Date()).length,
    conflicts: conflictIds.size,
    available: activeAccountCount,
    active: activeBookings.filter((booking) => booking.status === 'active').length,
    reserved: activeBookings.filter((booking) => booking.status === 'reserved').length
  };
  const accountRailActive = accountRailEnabled && !accountRailOpen;
  const nowLineEdgeClass = currentLeft > 88 ? 'near-right' : currentLeft < 12 ? 'near-left' : '';

  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px) and (pointer: coarse)');
    const update = () => {
      setAccountRailEnabled(media.matches);
      if (!media.matches) setAccountRailOpen(true);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  function ownerClass(booking: Booking) {
    return booking.operator_id === user.id ? 'is-mine' : 'is-others';
  }

  function shiftDate(days: number) {
    const date = new Date(`${selectedDate}T00:00:00`);
    date.setDate(date.getDate() + days);
    setSelectedDate(getLocalDateValue(date));
  }

  function startSchedulerDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.currentTarget;
    schedulerDrag.current = {
      active: true,
      moved: false,
      captured: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: target.scrollLeft,
      scrollTop: target.scrollTop,
      suppressClickUntil: 0
    };
  }

  function moveSchedulerDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = schedulerDrag.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      drag.captured = true;
      event.currentTarget.classList.add('is-dragging');
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    if (!drag.moved) return;
    event.preventDefault();
    event.currentTarget.scrollLeft = drag.scrollLeft - dx;
    event.currentTarget.scrollTop = drag.scrollTop - dy;
  }

  function endSchedulerDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = schedulerDrag.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    if (drag.moved) drag.suppressClickUntil = Date.now() + 90;
    drag.active = false;
    event.currentTarget.classList.remove('is-dragging');
    if (drag.captured) event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function suppressDraggedClick(event: React.MouseEvent<HTMLDivElement>) {
    if (Date.now() <= schedulerDrag.current.suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <div className="timeline-view">
      <div className="timeline-command">
        <button type="button" className="icon-btn date-shift" onClick={() => shiftDate(-1)} title="上一天"><ChevronLeft size={18} /></button>
        <DatePickerButton value={selectedDate} onChange={setSelectedDate} todayLabel={isSelectedToday ? '今天' : ''} align="center" />
        <button type="button" className="icon-btn date-shift" onClick={() => shiftDate(1)} title="下一天"><ChevronRight size={18} /></button>
        <button type="button" className="soft-btn" onClick={() => setSelectedDate(getLocalDateValue(new Date()))}>今天</button>
        <div className="searchbox timeline-search">
          <Search size={16} />
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索账号 / 租客 / 手机号" />
        </div>
        {(user.role === 'admin' || user.can_switch) && (
          <UserSwitcher user={user} users={users} onSwitchUser={onSwitchUser} />
        )}
        <button type="button" className="primary" onClick={onNew}>
          <Plus size={16} />
          新建出租 ✨
        </button>
      </div>
      <div className="metrics">
        <Metric label="今日出租" value={metrics.today} tone="mint" detail={`出租中 ${metrics.active}`} />
        <Metric label="即将到期" value={metrics.expiring} tone="amber" detail="30分钟内" />
        <Metric label="预约冲突" value={metrics.conflicts} tone="coral" detail={metrics.conflicts ? '需处理' : '正常'} />
        <Metric label="可用账号" value={metrics.available} tone="sky" detail={`预约 ${metrics.reserved}`} />
      </div>

      <div className="status-filter">
        <AccountNameFilter accounts={accounts} selected={nameFilter} onChange={setNameFilter} compact />
        <button type="button" className={statusFilter === 'all' ? 'active' : ''} onClick={() => setStatusFilter('all')}>全部</button>
        <button type="button" className={statusFilter === 'reserved' ? 'active' : ''} onClick={() => setStatusFilter('reserved')}><span className="dot reserved" />预约</button>
        <button type="button" className={statusFilter === 'active' ? 'active' : ''} onClick={() => setStatusFilter('active')}><span className="dot active" />出租中</button>
        <button type="button" className={statusFilter === 'completed' ? 'active' : ''} onClick={() => setStatusFilter('completed')}><span className="dot completed" />已结束</button>
        <button type="button" className={statusFilter === 'conflict' ? 'active' : ''} onClick={() => setStatusFilter('conflict')}><span className="dot cancelled" />冲突</button>
      </div>

      {accountRailEnabled && (
        <button
          type="button"
          className={`account-rail-toggle ${accountRailOpen ? 'open' : ''}`}
          onClick={() => setAccountRailOpen((value) => !value)}
          aria-pressed={accountRailOpen}
        >
          <KeyRound size={14} />
          <span>{accountRailOpen ? '收起账号小窝' : '展开账号小窝'}</span>
        </button>
      )}

      <div
        className={`scheduler ${accountRailEnabled ? (accountRailOpen ? 'account-rail-open' : 'account-rail-collapsed') : ''}`}
        ref={schedulerRef}
        onPointerDown={startSchedulerDrag}
        onPointerMove={moveSchedulerDrag}
        onPointerUp={endSchedulerDrag}
        onPointerCancel={endSchedulerDrag}
        onClickCapture={suppressDraggedClick}
      >
        <button
          type="button"
          className="time-head account-head account-rail-head"
          onClick={() => {
            if (accountRailEnabled) setAccountRailOpen((value) => !value);
          }}
          aria-label={accountRailOpen ? '收起账号小窝' : '展开账号小窝'}
        >
          <span>账号小窝</span>
          {accountRailEnabled && <ChevronRight size={13} />}
        </button>
        {Array.from({ length: 24 }, (_, index) => (
          <div className="time-head" key={index}>
            <strong>{String(index).padStart(2, '0')}:00</strong>
            <small>30</small>
          </div>
        ))}
        {visibleAccounts.map((account, accountIndex) => {
          const accountActive = account.status === 'active';
          const accountStatusText = accountActive ? '可用' : '停用';
          const rowBookings = visibleBookings.filter((booking) => booking.account_id === account.id);
          const rowLanes = assignBookingLanes(rowBookings);
          const rowHeight = Math.max(106, 106 + rowLanes.maxLane * 72);
          return (
            <React.Fragment key={account.id}>
              <div
                className="account-cell account-cell-clickable"
                style={{ minHeight: rowHeight }}
                role="button"
                tabIndex={0}
                onClick={() => accountRailActive ? setAccountRailOpen(true) : onViewAccount(account)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    if (accountRailActive) setAccountRailOpen(true);
                    else onViewAccount(account);
                  }
                }}
              >
                <div className="account-line">
                  <strong><MarqueeText text={account.name} settings={settings} /></strong>
                  <span className={accountActive ? 'account-status available' : 'account-status disabled'}><i />{accountStatusText}</span>
                </div>
                <span>账号：{account.login}</span>
                {user.role === 'admin' && (
                  <button
                    type="button"
                    className="account-quick-edit"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditAccount(account);
                    }}
                  >
                    <KeyRound size={13} />
                    编辑账号
                  </button>
                )}
              </div>
              <div className="timeline-row" style={{ minHeight: rowHeight }}>
                {Array.from({ length: 24 }, (_, index) => <span className="hour-cell" style={{ minHeight: rowHeight }} key={index} />)}
                {isSelectedToday && currentLeft >= 0 && currentLeft <= 100 && (
                  <div className={`${accountIndex === 0 ? 'now-line show-label' : 'now-line'} ${nowLineEdgeClass}`} style={{ left: `${currentLeft}%` }}>
                    {accountIndex === 0 && <span>现在 {formatClock(new Date().toISOString())}</span>}
                  </div>
                )}
                {rowBookings.length === 0 && (
                  <div className={`empty-slot ${accountActive ? '' : 'disabled'}`}>
                    <Sparkles size={14} />
                    {accountActive ? '今天还很空，可以安排啦' : '账号已停用，不能安排'}
                  </div>
                )}
                {rowBookings.map((booking) => {
                  const visibleStart = maxDate(new Date(booking.starts_at), start);
                  const visibleEnd = minDate(new Date(booking.ends_at), end);
                  const left = percentBetween(visibleStart, start, end);
                  const right = percentBetween(visibleEnd, start, end);
                  const widthPercent = Math.max(right - left, 4);
                  const compactClass = widthPercent < 7 ? 'is-compact' : '';
                  const microClass = widthPercent < 4.1 ? 'is-micro' : '';
                  const crossesDay = new Date(booking.starts_at) < start || new Date(booking.ends_at) > end;
                  const hasConflict = conflictIds.has(booking.id);
                  return (
                    <button
                      className={`booking-bar ${booking.status} ${ownerClass(booking)} ${compactClass} ${microClass} ${crossesDay ? 'cross-day' : ''} ${hasConflict ? 'has-conflict' : ''}`}
                      key={booking.id}
                      style={{ left: `${left}%`, width: `${widthPercent}%`, top: `${20 + (rowLanes.byId.get(booking.id) || 0) * 72}px` }}
                      title={`租客：${booking.renter_name}\n联系方式：${booking.renter_contact || '-'}\n账号：${booking.account_name || '-'}\n时间：${formatDateTime(booking.starts_at)} - ${formatDateTime(booking.ends_at)}\n状态：${hasConflict ? '冲突 · ' : ''}${statusText[booking.status]}\n操作人：${booking.operator_name || '-'}`}
                      onClick={() => (user.role === 'admin' || booking.operator_id === user.id) && onEdit(booking)}
                    >
                      <strong>{booking.renter_name}</strong>
                      <span>{booking.renter_contact}</span>
                      <small>{formatTimelineRange(visibleStart, visibleEnd, start, end)}{crossesDay ? ' · 跨天' : ''} · {hasConflict ? '冲突' : statusText[booking.status]}</small>
                    </button>
                  );
                })}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      <div className="timeline-footer">
        <div className="timeline-legend">
          <span><i className="reserved" />预约</span>
          <span><i className="active" />出租中</span>
          <span><i className="completed" />已结束</span>
          <span><i className="cancelled" />冲突</span>
        </div>
      </div>

      <div className="mini-records">
        <div className="mini-records-title">
          <button type="button" className={recordMode === 'today' ? 'active' : ''} onClick={() => setRecordMode('today')}>今日记录</button>
          <button type="button" className={recordMode === 'recent' ? 'active' : ''} onClick={() => setRecordMode('recent')}>近期记录</button>
        </div>
        <div className="mini-records-head">
          <span>时间</span>
          <span>账号</span>
          <span>租客</span>
          <span>联系方式</span>
          <span>开始 - 结束时间</span>
          <span>状态</span>
          <span>操作人</span>
        </div>
        {miniBookings.slice(0, 8).map((booking) => (
          <button type="button" className={`mini-record-row ${ownerClass(booking)}`} key={booking.id} onClick={() => onEdit(booking)}>
            <span>{formatTime(booking.starts_at)}</span>
            <span>{booking.account_name}</span>
            <strong>{booking.renter_name}</strong>
            <span>{booking.renter_contact || '-'}</span>
            <span>{formatTime(booking.starts_at)} - {formatTime(booking.ends_at)}</span>
            <span className={`tag ${booking.status}`}>{statusText[booking.status]}</span>
            <span>{booking.operator_name || '-'}</span>
          </button>
        ))}
        {miniBookings.length === 0 && <div className="empty-table">当前没有记录。</div>}
      </div>

      <div className="mobile-schedule">
        {visibleAccounts.map((account) => (
          <article className="account-card" key={account.id}>
            <div>
              <h3>{account.name}</h3>
              <p>{account.login} / {account.password}</p>
              <small>{account.remark || '暂无备注'}</small>
            </div>
            {visibleBookings.filter((booking) => booking.account_id === account.id).map((booking) => (
              <button className={`mobile-booking ${booking.status} ${ownerClass(booking)}`} key={booking.id} onClick={() => onEdit(booking)}>
                <span>{statusText[booking.status]}</span>
                <strong>{booking.renter_name}</strong>
                <small>{formatTime(booking.starts_at)} - {formatTime(booking.ends_at)}</small>
              </button>
            ))}
          </article>
        ))}
      </div>
    </div>
  );
}

function percentBetween(value: Date, start: Date, end: Date) {
  return Math.min(100, Math.max(0, ((value.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100));
}

function maxDate(a: Date, b: Date) {
  return a > b ? a : b;
}

function minDate(a: Date, b: Date) {
  return a < b ? a : b;
}

function DatePickerButton({ value, onChange, todayLabel = '', align = 'start' }: { value: string; onChange: (value: string) => void; todayLabel?: string; align?: 'start' | 'center' }) {
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [calendarStyle, setCalendarStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const [month, setMonth] = useState(() => {
    const date = new Date(`${value || getLocalDateValue(new Date())}T00:00:00`);
    date.setDate(1);
    return date;
  });
  const today = getLocalDateValue(new Date());
  const selected = value || today;
  const weeks = buildCalendarDays(month);

  useEffect(() => {
    const selectedDate = new Date(`${selected}T00:00:00`);
    if (!Number.isNaN(selectedDate.getTime()) && (selectedDate.getMonth() !== month.getMonth() || selectedDate.getFullYear() !== month.getFullYear())) {
      selectedDate.setDate(1);
      setMonth(selectedDate);
    }
  }, [selected]);

  useLayoutEffect(() => {
    if (!open) return;

    function updateCalendarPosition() {
      const control = controlRef.current;
      const calendar = calendarRef.current;
      if (!control || !calendar) return;

      const rect = control.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 8;
      const calendarWidth = calendar.offsetWidth || Math.min(270, window.innerWidth - viewportPadding * 2);
      const calendarHeight = calendar.offsetHeight;
      const preferredLeft = align === 'center'
        ? rect.left + rect.width / 2 - calendarWidth / 2
        : rect.left;
      const maxLeft = window.innerWidth - calendarWidth - viewportPadding;
      const left = Math.min(Math.max(preferredLeft, viewportPadding), Math.max(viewportPadding, maxLeft));

      const belowTop = rect.bottom + gap;
      const aboveTop = rect.top - calendarHeight - gap;
      const maxTop = window.innerHeight - calendarHeight - viewportPadding;
      const top = calendarHeight && belowTop > maxTop && aboveTop >= viewportPadding
        ? aboveTop
        : Math.min(belowTop, Math.max(viewportPadding, maxTop));

      setCalendarStyle({ left, top, visibility: 'visible' });
    }

    updateCalendarPosition();
    window.addEventListener('resize', updateCalendarPosition);
    window.addEventListener('scroll', updateCalendarPosition, true);
    return () => {
      window.removeEventListener('resize', updateCalendarPosition);
      window.removeEventListener('scroll', updateCalendarPosition, true);
    };
  }, [open, align, month]);

  useEffect(() => {
    if (!open) return;

    function closeOnOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (controlRef.current?.contains(target) || calendarRef.current?.contains(target)) return;
      setOpen(false);
    }

    function closeOnKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnKey);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnKey);
    };
  }, [open]);

  function shiftMonth(offset: number) {
    const next = new Date(month);
    next.setMonth(next.getMonth() + offset);
    setMonth(next);
  }

  function choose(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div className="cute-date">
      <button type="button" className="date-control" ref={controlRef} onClick={() => setOpen((next) => !next)}>
        <CalendarDays size={17} />
        <strong>{formatDateLabel(selected)}</strong>
        {todayLabel && <span>{todayLabel}</span>}
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="cute-calendar" ref={calendarRef} style={calendarStyle}>
          <div className="calendar-head">
            <button type="button" onClick={() => shiftMonth(-1)}><ChevronLeft size={16} /></button>
            <strong>{month.getFullYear()}年 {month.getMonth() + 1}月</strong>
            <button type="button" onClick={() => shiftMonth(1)}><ChevronRight size={16} /></button>
          </div>
          <div className="calendar-week">
            {['日', '一', '二', '三', '四', '五', '六'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="calendar-grid">
            {weeks.map((day) => {
              const dateValue = getLocalDateValue(day);
              const muted = day.getMonth() !== month.getMonth();
              return (
                <button
                  type="button"
                  key={dateValue}
                  className={`${muted ? 'muted' : ''} ${dateValue === selected ? 'selected' : ''} ${dateValue === today ? 'today' : ''}`}
                  onClick={() => choose(dateValue)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
          <div className="calendar-actions">
            <button type="button" onClick={() => choose(today)}>今天</button>
            <button type="button" onClick={() => setOpen(false)}>关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}

function UserSwitcher({ user, users, onSwitchUser }: { user: User; users: User[]; onSwitchUser: (userId: string) => void }) {
  const [open, setOpen] = useState(false);
  const enabledUsers = users.filter((item) => item.enabled);

  function choose(userId: string) {
    setOpen(false);
    if (userId !== user.id) onSwitchUser(userId);
  }

  return (
    <div className="user-switch">
      <button type="button" className="user-switch-button" onClick={() => setOpen((value) => !value)}>
        <span>{user.can_switch ? '管理员' : user.role === 'admin' ? '管理员' : '用户'}</span>
        <strong>{user.username} · {user.role === 'admin' ? '管理员' : '普通用户'}</strong>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="user-switch-menu">
          {enabledUsers.map((item) => (
            <button type="button" className={item.id === user.id ? 'active' : ''} key={item.id} onClick={() => choose(item.id)}>
              <strong>{item.username}</strong>
              <span>{item.role === 'admin' ? '管理员' : '普通用户'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function buildCalendarDays(month: Date) {
  const first = new Date(month);
  first.setDate(1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function assignBookingLanes(bookings: Booking[]) {
  const laneEnds: Date[] = [];
  const byId = new Map<string, number>();

  [...bookings]
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    .forEach((booking) => {
      const start = new Date(booking.starts_at);
      const end = new Date(booking.ends_at);
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(end);
      } else {
        laneEnds[lane] = end;
      }
      byId.set(booking.id, lane);
    });

  return { byId, maxLane: Math.max(0, laneEnds.length - 1) };
}

function Metric({ label, value, tone, detail }: { label: string; value: number; tone: string; detail: string }) {
  return (
    <div className={`metric ${tone}`}>
      <Sparkles size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  );
}

function BookingDrawer({
  user,
  accounts,
  booking,
  onClose,
  onSaved,
  onError
}: {
  user: User;
  accounts: Account[];
  booking: Booking | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const firstActiveAccount = accounts.find((account) => account.status === 'active')?.id || '';
  const initialStart = booking ? new Date(booking.starts_at) : new Date();
  const initialEnd = booking ? new Date(booking.ends_at) : addHours(initialStart, 1);
  const initialStatus = booking
    ? (editableBookingStatuses.includes(booking.status) ? booking.status : 'completed')
    : 'reserved';
  const [form, setForm] = useState({
    account_id: booking?.account_id || firstActiveAccount,
    renter_name: booking?.renter_name || '',
    renter_contact: booking?.renter_contact || '',
    starts_at: toLocalInput(initialStart.toISOString()),
    ends_at: toLocalInput(initialEnd.toISOString()),
    status: initialStatus,
    remark: booking?.remark || ''
  });
  const [conflict, setConflict] = useState('');
  const [formError, setFormError] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [accountCategoryOpen, setAccountCategoryOpen] = useState(false);
  const [accountCategory, setAccountCategory] = useState('all');
  const [accountNameLibrary, setAccountNameLibrary] = useState<string[]>([]);
  const accountPickerRef = useRef<HTMLDivElement>(null);
  const selectedAccount = accounts.find((account) => account.id === form.account_id);
  const activeAccounts = accounts.filter((account) => account.status === 'active');
  const selectableAccounts = booking && selectedAccount && selectedAccount.status !== 'active'
    ? [selectedAccount, ...activeAccounts.filter((account) => account.id !== selectedAccount.id)]
    : activeAccounts;
  const accountCategoryOptions = useMemo(
    () => uniqueNames([...accountNameLibrary, ...selectableAccounts.map((account) => account.name)]).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    [accountNameLibrary, selectableAccounts]
  );
  const filteredSelectableAccounts = accountCategory === 'all'
    ? selectableAccounts
    : selectableAccounts.filter((account) => normalizeNameKey(account.name) === accountCategory);
  const selectedAccountCategoryLabel = accountCategory === 'all'
    ? '全部分类'
    : accountCategoryOptions.find((name) => normalizeNameKey(name) === accountCategory) || '全部分类';

  useEffect(() => {
    if (!accountPickerOpen) return undefined;
    const closePicker = (event: PointerEvent) => {
      if (!accountPickerRef.current?.contains(event.target as Node)) {
        setAccountPickerOpen(false);
        setAccountCategoryOpen(false);
      }
    };
    window.addEventListener('pointerdown', closePicker);
    return () => window.removeEventListener('pointerdown', closePicker);
  }, [accountPickerOpen]);

  useEffect(() => {
    let alive = true;
    api<AccountName[]>('/api/account-names')
      .then((items) => {
        if (alive) setAccountNameLibrary(items.map((item) => item.name));
      })
      .catch(() => {
        if (alive) setAccountNameLibrary([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (accountCategory === 'all') return;
    const available = new Set(accountCategoryOptions.map(normalizeNameKey));
    if (!available.has(accountCategory)) setAccountCategory('all');
  }, [accountCategory, accountCategoryOptions]);

  function setDuration(hours: number) {
    const start = booking ? (parseLocalDate(form.starts_at) || new Date()) : new Date();
    const nextStart = toLocalInput(start.toISOString());
    const nextEnd = toLocalInput(addHours(start, hours).toISOString());
    setForm({ ...form, starts_at: nextStart, ends_at: nextEnd });
  }

  function setLocalPart(field: 'starts_at' | 'ends_at', part: 'date' | 'time', value: string) {
    const current = form[field] || toLocalInput(new Date().toISOString());
    const next = part === 'date' ? `${value}T${timePart(current)}` : `${datePart(current)}T${value}`;
    if (field === 'starts_at') {
      const duration = Math.max(durationHours(form.starts_at, form.ends_at) || 1, 1);
      const nextStart = parseLocalDate(next) || roundToNextMinutes(new Date(), 30);
      setForm({ ...form, starts_at: next, ends_at: toLocalInput(addHours(nextStart, duration).toISOString()) });
      return;
    }
    setForm({ ...form, [field]: next });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setConflict('');
    setFormError('');
    try {
      const payload = { ...form, starts_at: new Date(form.starts_at).toISOString(), ends_at: new Date(form.ends_at).toISOString() };
      if (!payload.account_id) throw new Error('请先添加或选择账号');
      if (!booking && selectedAccount?.status !== 'active') throw new Error('账号已停用，不能新建出租');
      if (!form.renter_name.trim()) throw new Error('请填写租客姓名');
      if (new Date(payload.ends_at) <= new Date(payload.starts_at)) throw new Error('结束时间必须晚于开始时间');
      await api(booking ? `/api/bookings/${booking.id}` : '/api/bookings', {
        method: booking ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      onSaved();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('预约')) setConflict(msg);
      setFormError(msg);
      onError(msg);
    }
  }

  async function action(name: 'endEarly' | 'renew') {
    if (!booking) return;
    setConflict('');
    setFormError('');
    try {
      const payload: { action: 'endEarly' | 'renew'; ends_at?: string } = { action: name };
      if (name === 'renew') {
        const bookingAccount = accounts.find((account) => account.id === booking.account_id);
        if (bookingAccount?.status !== 'active') throw new Error('账号已停用，不能续租');
        const oldEndTime = new Date(booking.ends_at).getTime();
        const newEnd = new Date(form.ends_at);
        const newEndTime = newEnd.getTime();
        if (Number.isNaN(newEndTime)) throw new Error('请选择有效的续租时间');
        if (newEndTime === oldEndTime) throw new Error('请先选择新的结束时间后再续租');
        if (newEndTime <= oldEndTime) throw new Error('续租时间必须晚于当前结束时间');
        payload.ends_at = newEnd.toISOString();
      }
      await api(`/api/bookings/${booking.id}/action`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      onSaved();
    } catch (err) {
      const msg = (err as Error).message;
      setFormError(msg);
      onError(msg);
    }
  }

  async function deleteBooking() {
    if (!booking) {
      onClose();
      return;
    }
    setDeleteLoading(true);
    try {
      await api(`/api/bookings/${booking.id}`, { method: 'DELETE' });
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="admin-modal booking-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <div>
            <span>出租小表单</span>
            <h2>{booking ? '编辑出租' : '新建出租'}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <form className="modal-form" onSubmit={save}>
        <div className="form-field booking-account-field">
          <span>账号</span>
          <div ref={accountPickerRef} className={`booking-account-picker ${accountPickerOpen ? 'is-open' : ''}`}>
            <button
              type="button"
              className="booking-account-trigger"
              onClick={() => {
                setAccountPickerOpen((open) => {
                  if (open) setAccountCategoryOpen(false);
                  return !open;
                });
              }}
              aria-expanded={accountPickerOpen}
            >
              <span className="booking-account-trigger-main">
                <Sparkles size={15} />
                <strong>{selectedAccount ? <MarqueeText text={selectedAccount.name} settings={defaultSettings} /> : '暂无可用账号'}</strong>
              </span>
              {selectedAccount && <small>{selectedAccount.login}</small>}
              <ChevronDown size={16} />
            </button>
            {accountPickerOpen && (
              <div className="booking-account-menu">
                <div className="booking-account-filter">
                  <span>分类筛选</span>
                  <div className={`booking-account-category ${accountCategoryOpen ? 'is-open' : ''}`}>
                    <button
                      type="button"
                      className="booking-account-category-trigger"
                      onClick={() => setAccountCategoryOpen((open) => !open)}
                      title={selectedAccountCategoryLabel}
                    >
                      <strong>{selectedAccountCategoryLabel}</strong>
                      <ChevronDown size={14} />
                    </button>
                    {accountCategoryOpen && (
                      <div className="booking-account-category-menu">
                        <button
                          type="button"
                          className={accountCategory === 'all' ? 'active' : ''}
                          onClick={() => {
                            setAccountCategory('all');
                            setAccountCategoryOpen(false);
                          }}
                        >
                          全部分类
                        </button>
                        {accountCategoryOptions.map((name) => {
                          const key = normalizeNameKey(name);
                          return (
                            <button
                              type="button"
                              key={key}
                              className={accountCategory === key ? 'active' : ''}
                              onClick={() => {
                                setAccountCategory(key);
                                setAccountCategoryOpen(false);
                              }}
                              title={name}
                            >
                              {name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                {selectableAccounts.length === 0 ? (
                  <div className="booking-account-empty">暂无可用账号</div>
                ) : filteredSelectableAccounts.length === 0 ? (
                  <div className="booking-account-empty">这个分类下没有可用账号</div>
                ) : filteredSelectableAccounts.map((account) => (
                  <button
                    type="button"
                    key={account.id}
                    className={`booking-account-option ${account.id === form.account_id ? 'active' : ''} ${account.status !== 'active' ? 'disabled' : ''}`}
                    onClick={() => {
                      setForm({ ...form, account_id: account.id });
                      setAccountPickerOpen(false);
                      setAccountCategoryOpen(false);
                    }}
                  >
                    <span>
                      <strong>{account.name}</strong>
                      <small>账号：{account.login}</small>
                    </span>
                    <em>{account.status === 'active' ? '可用' : '停用'}</em>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <Field label="租客姓名" value={form.renter_name} onChange={(renter_name) => setForm({ ...form, renter_name })} required />
        <Field label="联系方式" value={form.renter_contact} onChange={(renter_contact) => setForm({ ...form, renter_contact })} />
        <div className="form-field">
          <span>开始时间</span>
          <div className="time-pair">
            <DatePickerButton value={datePart(form.starts_at)} onChange={(value) => setLocalPart('starts_at', 'date', value)} />
            <TimeSelect value={timePart(form.starts_at)} onChange={(value) => setLocalPart('starts_at', 'time', value)} />
          </div>
        </div>
        <div className="form-field">
          <span>结束时间</span>
          <div className="time-pair">
            <DatePickerButton value={datePart(form.ends_at)} onChange={(value) => setLocalPart('ends_at', 'date', value)} />
            <TimeSelect value={timePart(form.ends_at)} onChange={(value) => setLocalPart('ends_at', 'time', value)} />
          </div>
        </div>
        <div className="duration-grid">
          {[1, 3, 6, 9, 12, 24].map((hour) => (
            <button type="button" className={durationHours(form.starts_at, form.ends_at) === hour ? 'active' : ''} key={hour} onClick={() => setDuration(hour)}>{hour}h</button>
          ))}
        </div>
        <FancySelect
          label="状态"
          value={form.status}
          options={editableBookingStatuses.map((key) => ({ value: key, label: statusText[key] }))}
          onChange={(status) => setForm({ ...form, status: status as BookingStatus })}
        />
        <label>
          <span>备注</span>
          <textarea value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
        </label>
        {conflict && <div className="conflict">{conflict}</div>}
        {formError && !conflict && <div className="form-error">{formError}</div>}
        <div className="form-actions">
          <button className="primary large">保存</button>
        </div>
        {booking && (
          <div className="drawer-actions">
            <button type="button" className="soft-btn" onClick={() => action('renew')}>续租</button>
            <button type="button" className="soft-btn" onClick={() => action('endEarly')}>提前结束</button>
            <button type="button" className="danger-btn" onClick={() => setDeleteConfirmOpen(true)}>删除</button>
          </div>
        )}
        </form>
      </section>
      {deleteConfirmOpen && (
        <ConfirmModal
          title="确认删除出租"
          body={`确定删除 ${booking?.renter_name || '这条出租记录'} 吗？删除后无法恢复。`}
          confirmLabel="删除"
          onConfirm={deleteBooking}
          onClose={() => setDeleteConfirmOpen(false)}
          loading={deleteLoading}
          danger
        />
      )}
    </div>
  );
}

function BookingDetailModal({
  booking,
  settings,
  onClose,
  onDeleted,
  onEdit,
  canEdit
}: {
  booking: Booking;
  settings: AppSettings;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
  onEdit: () => void;
  canEdit: boolean;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copyToast, setCopyToast] = useState('');
  const [toastTone, setToastTone] = useState<'success' | 'danger' | 'info'>('success');
  const [mailCode, setMailCode] = useState<MailCodeResult | null>(null);
  const [mailCodeLoading, setMailCodeLoading] = useState(false);
  const [passwordResetLink, setPasswordResetLink] = useState<PasswordResetLinkResult | null>(null);
  const [passwordResetLoading, setPasswordResetLoading] = useState(false);
  const copyToastTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyToastTimer.current) window.clearTimeout(copyToastTimer.current);
  }, []);

  function showCopyToast(message: string, tone: 'success' | 'danger' | 'info' = 'success') {
    if (copyToastTimer.current) window.clearTimeout(copyToastTimer.current);
    setToastTone(tone);
    setCopyToast(message);
    copyToastTimer.current = window.setTimeout(() => setCopyToast(''), getToastDurationMs(settings));
  }

  async function deleteBooking() {
    setDeleting(true);
    try {
      await api(`/api/bookings/${booking.id}`, { method: 'DELETE' });
      await onDeleted();
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  async function copyBooking() {
    await copyTextToClipboard(buildBookingCopyText(booking));
    showCopyToast('复制成功');
  }

  async function copyField(value: string) {
    await copyTextToClipboard(value);
    showCopyToast('复制成功');
  }

  async function fetchLoginCode() {
    setMailCodeLoading(true);
    setMailCode(null);
    try {
      const result = await api<MailCodeResult>(`/api/accounts/${booking.account_id}/mail-code`, { method: 'POST' });
      setMailCode(result);
      await copyTextToClipboard(result.code);
      showCopyToast('验证码已复制');
    } catch (error) {
      showCopyToast((error as Error).message, 'danger');
    } finally {
      setMailCodeLoading(false);
    }
  }

  async function fetchPasswordResetLink() {
    setPasswordResetLoading(true);
    setPasswordResetLink(null);
    try {
      const result = await api<PasswordResetLinkResult>(`/api/accounts/${booking.account_id}/password-reset-link`, { method: 'POST' });
      setPasswordResetLink(result);
      await copyTextToClipboard(result.link);
      showCopyToast('\u91cd\u7f6e\u94fe\u63a5\u5df2\u590d\u5236');
    } catch (error) {
      showCopyToast((error as Error).message, 'danger');
    } finally {
      setPasswordResetLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="admin-modal compact detail-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <div>
            <span>出租详情</span>
            <h2>{booking.renter_name}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="detail-grid">
          <DetailItem label="账号名称" value={booking.account_name || '-'} onCopy={copyField} />
          <DetailItem label="租客姓名" value={booking.renter_name} onCopy={copyField} />
          <DetailItem label="联系方式" value={booking.renter_contact || '-'} onCopy={copyField} />
          <DetailItem label="开始时间" value={formatDateTime(booking.starts_at)} onCopy={copyField} />
          <DetailItem label="结束时间" value={formatDateTime(booking.ends_at)} onCopy={copyField} />
          <DetailItem label="当前状态" value={statusText[booking.status]} onCopy={copyField} />
          <DetailItem label="操作人" value={booking.operator_name || '-'} onCopy={copyField} />
          <DetailItem label="备注" value={booking.remark || '-'} onCopy={copyField} />
        </div>
        <div className="modal-actions detail-actions account-detail-actions">
          <button className={`soft-btn login-code-action ${mailCode ? 'has-code' : ''}`} onClick={fetchLoginCode} disabled={mailCodeLoading}><Mail size={16} />{mailCodeLoading ? '获取中...' : (mailCode?.code || '获取登陆验证码')}</button>
          <button className={`soft-btn reset-link-action ${passwordResetLink ? 'has-link' : ''}`} onClick={fetchPasswordResetLink} disabled={passwordResetLoading}><KeyRound size={16} />{passwordResetLoading ? '\u83b7\u53d6\u4e2d...' : (passwordResetLink ? '\u94fe\u63a5\u5df2\u590d\u5236' : '\u91cd\u7f6e\u5bc6\u7801')}</button>
          <InboxButton baseUrl={`/api/accounts/${booking.account_id}/messages`} api={api} className="soft-btn" />
          <button className="soft-btn" onClick={copyBooking}><Copy size={16} />复制</button>
          {canEdit && <button className="primary" onClick={onEdit}>编辑出租</button>}
          {canEdit && <button className="danger-btn" onClick={() => setDeleteOpen(true)}><Trash2 size={16} />删除</button>}
        </div>
      </section>
      <NoticeToast message={copyToast} tone={toastTone} />
      {deleteOpen && (
        <ConfirmModal
          title="确认删除出租"
          body={`确定删除 ${booking.renter_name} 的出租记录吗？删除后无法恢复。`}
          confirmLabel="删除"
          onConfirm={deleteBooking}
          onClose={() => setDeleteOpen(false)}
          loading={deleting}
          danger
        />
      )}
    </div>
  );
}

function buildBookingCopyText(booking: Booking) {
  return [
    ['账号名称', booking.account_name || '-'],
    ['租客姓名', booking.renter_name || '-'],
    ['联系方式', booking.renter_contact || '-'],
    ['开始时间', formatDateTime(booking.starts_at)],
    ['结束时间', formatDateTime(booking.ends_at)],
    ['当前状态', statusText[booking.status]],
    ['操作人', booking.operator_name || '-'],
    ['备注', booking.remark || '-']
  ].map(([label, value]) => `${label}：${value}`).join('------');
}

const accountCopyFieldOptions = [
  { key: 'name', label: '\u8d26\u53f7\u540d\u79f0' },
  { key: 'login', label: '\u8d26\u53f7' },
  { key: 'password', label: '\u5bc6\u7801' },
  { key: 'status', label: '\u72b6\u6001' },
  { key: 'remark', label: '\u5907\u6ce8' },
  { key: 'created_at', label: '\u521b\u5efa\u65f6\u95f4' }
] as const;

function accountCopyValue(account: Account, key: string) {
  if (key === 'name') return account.name;
  if (key === 'login') return account.login;
  if (key === 'password') return account.password;
  if (key === 'status') return account.status === 'active' ? '\u6b63\u5e38' : '\u505c\u7528';
  if (key === 'remark') return account.remark || '-';
  if (key === 'created_at') return formatDateTime(account.created_at);
  return '';
}

function buildAccountCopyText(account: Account, settings: AppSettings) {
  const selected = (settings.accountCopyFields || defaultSettings.accountCopyFields || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const fields = selected.length ? selected : ['name', 'login', 'password', 'status'];
  return fields
    .map((key) => {
      const option = accountCopyFieldOptions.find((item) => item.key === key);
      if (!option) return null;
      return `${option.label}\uff1a${accountCopyValue(account, key)}`;
    })
    .filter(Boolean)
    .join('------');
}

function getNameScrollSeconds(settings: AppSettings) {
  const raw = Number(settings.nameScrollSeconds || defaultSettings.nameScrollSeconds || 8);
  if (!Number.isFinite(raw)) return 8;
  return Math.min(30, Math.max(3, raw));
}

function getToastDurationMs(settings: AppSettings) {
  const raw = Number(settings.toastDurationSeconds || defaultSettings.toastDurationSeconds || 1);
  const seconds = Number.isFinite(raw) ? Math.min(10, Math.max(0.5, raw)) : 1;
  return Math.round(seconds * 1000);
}

function MarqueeText({ text, settings }: { text: string; settings: AppSettings }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [long, setLong] = useState(false);
  const [motion, setMotion] = useState(() => ({
    duration: getNameScrollSeconds(settings),
    start: 0,
    end: 0
  }));

  useLayoutEffect(() => {
    const container = containerRef.current;
    const label = textRef.current;
    if (!container || !label) return undefined;

    const updateMotion = () => {
      const baseSeconds = getNameScrollSeconds(settings);
      const shouldScroll = label.scrollWidth > container.clientWidth + 2;
      setLong(shouldScroll);
      if (!shouldScroll) {
        setMotion({ duration: baseSeconds, start: 0, end: 0 });
        return;
      }
      const pixelsPerSecond = 120 / baseSeconds;
      const start = container.clientWidth;
      const end = label.scrollWidth;
      const distance = Math.max(start + end, 120);
      setMotion({ duration: distance / pixelsPerSecond, start, end });
    };

    updateMotion();
    const observer = new ResizeObserver(updateMotion);
    observer.observe(container);
    observer.observe(label);
    return () => observer.disconnect();
  }, [settings.nameScrollSeconds, text]);

  const style = {
    '--marquee-duration': `${motion.duration}s`,
    '--marquee-start': `${motion.start}px`,
    '--marquee-end': `${motion.end}px`
  } as React.CSSProperties;
  return (
    <span ref={containerRef} className={`marquee-text ${long ? 'is-long' : ''}`} style={style} title={text}>
      <span ref={textRef}>{text}</span>
    </span>
  );
}

function AccountDetailModal({
  account,
  settings,
  onClose,
  onDeleted,
  onEdit,
  onStatusChanged
}: {
  account: Account;
  settings: AppSettings;
  onClose: () => void;
  onDeleted?: () => void | Promise<void>;
  onEdit?: () => void;
  onStatusChanged?: (account: Account) => void | Promise<void>;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [copyToast, setCopyToast] = useState('');
  const [toastTone, setToastTone] = useState<'success' | 'danger' | 'info'>('success');
  const [mailCode, setMailCode] = useState<MailCodeResult | null>(null);
  const [mailCodeLoading, setMailCodeLoading] = useState(false);
  const [passwordResetLink, setPasswordResetLink] = useState<PasswordResetLinkResult | null>(null);
  const [passwordResetLoading, setPasswordResetLoading] = useState(false);
  const copyToastTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyToastTimer.current) window.clearTimeout(copyToastTimer.current);
  }, []);

  function showCopyToast(message: string, tone: 'success' | 'danger' | 'info' = 'success') {
    if (copyToastTimer.current) window.clearTimeout(copyToastTimer.current);
    setToastTone(tone);
    setCopyToast(message);
    copyToastTimer.current = window.setTimeout(() => setCopyToast(''), getToastDurationMs(settings));
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      await api(`/api/accounts/${account.id}`, { method: 'DELETE' });
      await onDeleted?.();
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  async function copyAccount() {
    const text = buildAccountCopyText(account, settings);
    await copyTextToClipboard(text);
    showCopyToast('复制成功');
  }

  async function copyField(value: string) {
    await copyTextToClipboard(value);
    showCopyToast('复制成功');
  }

  async function fetchLoginCode() {
    setMailCodeLoading(true);
    setMailCode(null);
    try {
      const result = await api<MailCodeResult>(`/api/accounts/${account.id}/mail-code`, { method: 'POST' });
      setMailCode(result);
      await copyTextToClipboard(result.code);
      showCopyToast('验证码已复制');
    } catch (error) {
      showCopyToast((error as Error).message, 'danger');
    } finally {
      setMailCodeLoading(false);
    }
  }

  async function fetchPasswordResetLink() {
    setPasswordResetLoading(true);
    setPasswordResetLink(null);
    try {
      const result = await api<PasswordResetLinkResult>(`/api/accounts/${account.id}/password-reset-link`, { method: 'POST' });
      setPasswordResetLink(result);
      await copyTextToClipboard(result.link);
      showCopyToast('\u91cd\u7f6e\u94fe\u63a5\u5df2\u590d\u5236');
    } catch (error) {
      showCopyToast((error as Error).message, 'danger');
    } finally {
      setPasswordResetLoading(false);
    }
  }

  async function toggleAccountStatus() {
    const nextStatus = account.status === 'active' ? 'disabled' : 'active';
    const nextAccount = { ...account, status: nextStatus };
    setStatusChanging(true);
    try {
      await api(`/api/accounts/${account.id}`, {
        method: 'PUT',
        body: JSON.stringify(nextAccount)
      });
      await onStatusChanged?.(nextAccount);
      showCopyToast(nextStatus === 'active' ? '账号已恢复正常' : '账号已停用');
    } finally {
      setStatusChanging(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="admin-modal compact detail-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <div>
            <span>账号详情</span>
            <h2>{account.name}</h2>
          </div>
          <div className="modal-title-actions">
            {onStatusChanged && (
              <button
                type="button"
                className={`detail-status-toggle ${account.status === 'active' ? 'on' : ''}`}
                onClick={toggleAccountStatus}
                disabled={statusChanging}
                aria-pressed={account.status === 'active'}
                title={account.status === 'active' ? '切换为停用' : '切换为正常'}
              >
                <span>{account.status === 'active' ? '正常' : '停用'}</span>
                <i />
              </button>
            )}
            <button className="icon-btn" onClick={onClose}><X size={18} /></button>
          </div>
        </div>
        <div className="detail-grid">
          <DetailItem label="账号名称" value={account.name} onCopy={copyField} />
          <DetailItem label="账号" value={account.login} onCopy={copyField} />
          <DetailItem label="密码" value={account.password} onCopy={copyField} />
          <DetailItem label="状态" value={account.status === 'active' ? '正常' : '停用'} onCopy={copyField} />
          <DetailItem label="备注" value={account.remark || '-'} onCopy={copyField} />
          <DetailItem label="创建时间" value={formatDateTime(account.created_at)} onCopy={copyField} />
        </div>
        <div className="modal-actions detail-actions account-detail-actions">
          <button className={`soft-btn login-code-action ${mailCode ? 'has-code' : ''}`} onClick={fetchLoginCode} disabled={mailCodeLoading}><Mail size={16} />{mailCodeLoading ? '获取中...' : (mailCode?.code || '获取登陆验证码')}</button>
          <button className={`soft-btn reset-link-action ${passwordResetLink ? 'has-link' : ''}`} onClick={fetchPasswordResetLink} disabled={passwordResetLoading}><KeyRound size={16} />{passwordResetLoading ? '\u83b7\u53d6\u4e2d...' : (passwordResetLink ? '\u94fe\u63a5\u5df2\u590d\u5236' : '\u91cd\u7f6e\u5bc6\u7801')}</button>
          <InboxButton baseUrl={`/api/accounts/${account.id}/messages`} api={api} className="soft-btn" />
          <button className="soft-btn" onClick={copyAccount}><Copy size={16} />复制</button>
          {onEdit && <button className="primary" onClick={onEdit}>{'\u7f16\u8f91\u8d26\u53f7'}</button>}
          {onDeleted && <button className="danger-btn" onClick={() => setDeleteOpen(true)}><Trash2 size={16} />{'\u5220\u9664'}</button>}
        </div>
      </section>
      <NoticeToast message={copyToast} tone={toastTone} />
      {deleteOpen && (
        <ConfirmModal
          title="确认删除账号"
          body={`确定删除账号 ${account.name} 吗？相关出租记录也会一并删除。`}
          confirmLabel="删除"
          onConfirm={deleteAccount}
          onClose={() => setDeleteOpen(false)}
          loading={deleting}
          danger
        />
      )}
    </div>
  );
}

function DetailItem({ label, value, onCopy }: { label: string; value: string; onCopy?: (value: string) => void | Promise<void> }) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
    </>
  );
  if (!onCopy) return <div className="detail-item">{content}</div>;
  return (
    <button type="button" className="detail-item detail-copy-item" onClick={() => onCopy(value)} title={`复制${label}`}>
      {content}
    </button>
  );
}

function MailCodeModal({ result, onClose, onCopy }: { result: MailCodeResult; onClose: () => void; onCopy: () => void | Promise<void> }) {
  return (
    <div className="modal-backdrop" onClick={(event) => { event.stopPropagation(); onClose(); }}>
      <section className="admin-modal compact mail-code-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <div>
            <span>登陆验证码</span>
            <h2>{result.code}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="mail-code-details">
          <DetailItem label="邮箱" value={result.email || '-'} />
          <DetailItem label="邮箱夹" value={result.mailbox || '-'} />
          <DetailItem label="发件人" value={result.sender || '-'} />
          <DetailItem label="时间" value={result.receivedAt ? formatDateTime(result.receivedAt) : '-'} />
          <DetailItem label="主题" value={result.subject || '-'} />
        </div>
        <div className="modal-actions confirm-actions">
          <button type="button" className="soft-btn" onClick={onClose}>关闭</button>
          <button type="button" className="primary" onClick={onCopy}><Copy size={16} />复制验证码</button>
        </div>
      </section>
    </div>
  );
}

function NoticeToast({ message, tone = 'danger' }: { message: string; tone?: 'danger' | 'success' | 'info' }) {
  if (!message) return null;
  return (
    <div className={`app-toast ${tone}`} role="status" aria-live="polite">
      <span>{message}</span>
    </div>
  );
}

function uniqueAccountNames(accounts: Account[]) {
  return uniqueNames(accounts.map((account) => account.name)).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function AccountNameFilter({
  accounts,
  names,
  selected,
  onChange,
  compact = false
}: {
  accounts: Account[];
  names?: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const options = useMemo(() => uniqueNames(names?.length ? names : uniqueAccountNames(accounts)), [accounts, names]);
  const selectedSet = useMemo(() => new Set(selected.map(normalizeNameKey)), [selected]);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    if (!selected.length) return;
    const available = new Set(options.map(normalizeNameKey));
    const next = selected.filter((item) => available.has(normalizeNameKey(item)));
    if (next.length !== selected.length) onChange(next);
  }, [options, selected, onChange]);

  function toggle(name: string) {
    const key = normalizeNameKey(name);
    const next = selectedSet.has(key)
      ? selected.filter((item) => normalizeNameKey(item) !== key)
      : [...selected, name];
    onChange(next);
  }

  function toggleOpen() {
    setOpen((value) => !value);
  }

  return (
    <div className={`game-filter ${compact ? 'compact' : ''}`} ref={ref}>
      <button
        type="button"
        className={`game-filter-trigger ${selected.length ? 'active' : ''}`}
        onClick={toggleOpen}
        disabled={options.length === 0}
      >
        <Sparkles size={15} />
        <span>{selected.length ? `\u5df2\u9009 ${selected.length}` : '\u6309\u540d\u79f0\u7b5b\u9009'}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="game-filter-menu">
          <div className="game-filter-head">
            <strong>{'\u9009\u62e9\u6e38\u620f/\u540d\u79f0'}</strong>
            <button type="button" onClick={() => onChange([])} disabled={!selected.length}>{'\u6e05\u7a7a'}</button>
          </div>
          <div className="game-filter-options">
            {options.map((name) => (
              <label className="game-filter-option" key={name}>
                <input type="checkbox" checked={selectedSet.has(normalizeNameKey(name))} onChange={() => toggle(name)} />
                <span>{name}</span>
              </label>
            ))}
            {options.length === 0 && <p>{'\u6682\u65e0\u53ef\u7b5b\u9009\u540d\u79f0'}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

const pageSizeOptions = [5, 10, 20, 50];

function clampPage(page: number, pageCount: number) {
  return Math.min(Math.max(1, page), Math.max(1, pageCount));
}

function paginateItems<T>(items: T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = clampPage(page, pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    pageCount,
    safePage,
    items: items.slice(start, start + pageSize),
    start: items.length ? start + 1 : 0,
    end: Math.min(start + pageSize, items.length)
  };
}

function pageNumbers(current: number, pageCount: number) {
  const pages = new Set([1, pageCount, current - 1, current, current + 1]);
  return Array.from(pages)
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((a, b) => a - b);
}

function PageSizeDropdown({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  function toggleOpen() {
    setOpen((next) => {
      const willOpen = !next;
      if (willOpen && ref.current) {
        const rect = ref.current.getBoundingClientRect();
        const bottomSpace = window.innerHeight - rect.bottom;
        const topSpace = rect.top;
        const openUp = bottomSpace < 180 && topSpace > bottomSpace;
        setMenuStyle({
          position: 'fixed',
          left: `${rect.left}px`,
          top: openUp ? 'auto' : `${rect.bottom + 8}px`,
          bottom: openUp ? `${window.innerHeight - rect.top + 8}px` : 'auto',
          width: `${rect.width}px`,
          minWidth: `${Math.max(rect.width, 82)}px`
        });
      }
      return willOpen;
    });
  }

  return (
    <div className="page-size-menu" ref={ref}>
      <button type="button" className="page-size-trigger" onClick={toggleOpen} aria-expanded={open}>
        <strong>{value}</strong>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="page-size-options" style={menuStyle}>
          {pageSizeOptions.map((size) => (
            <button
              type="button"
              className={size === value ? 'active' : ''}
              key={size}
              onClick={() => {
                onChange(size);
                setOpen(false);
              }}
            >
              {size}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PaginationControls({
  total,
  page,
  pageSize,
  onPage,
  onPageSize
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = clampPage(page, pageCount);
  const [jump, setJump] = useState(String(safePage));

  useEffect(() => {
    setJump(String(safePage));
  }, [safePage]);

  function jumpToPage(event: React.FormEvent) {
    event.preventDefault();
    const next = Number(jump);
    if (Number.isFinite(next)) onPage(clampPage(Math.floor(next), pageCount));
  }

  return (
    <div className="pagination-bar">
      <div className="pagination-size">
        <span>{'\u6bcf\u9875'}</span>
        <PageSizeDropdown value={pageSize} onChange={(next) => { onPageSize(next); onPage(1); }} />
        <span className="pagination-total">{`\u5171 ${total} \u6761 / ${pageCount} \u9875`}</span>
      </div>
      <div className="pagination-pages">
        <button type="button" className="pager-btn" disabled={safePage <= 1} onClick={() => onPage(safePage - 1)}><ChevronLeft size={15} /></button>
        {pageNumbers(safePage, pageCount).map((item, index, list) => (
          <React.Fragment key={item}>
            {index > 0 && item - list[index - 1] > 1 && <span className="pager-gap">...</span>}
            <button type="button" className={`pager-btn ${item === safePage ? 'active' : ''}`} onClick={() => onPage(item)}>{item}</button>
          </React.Fragment>
        ))}
        <button type="button" className="pager-btn" disabled={safePage >= pageCount} onClick={() => onPage(safePage + 1)}><ChevronRight size={15} /></button>
      </div>
      <form className="pagination-jump" onSubmit={jumpToPage}>
        <span>{'\u8df3\u5230'}</span>
        <input value={jump} onChange={(event) => setJump(event.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" />
        <button type="submit" className="soft-btn">{'\u786e\u5b9a'}</button>
      </form>
    </div>
  );
}

function MailboxesPanel() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Mailbox | 'new' | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'danger' | 'info'>('success');
  const searchTerm = search.trim().toLowerCase();
  const visibleMailboxes = mailboxes.filter((mailbox) => {
    if (!searchTerm) return true;
    return `${mailbox.email} ${mailbox.client_id} ${mailbox.password} ${mailbox.remark || ''}`.toLowerCase().includes(searchTerm);
  });

  useEffect(() => {
    loadMailboxes();
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 1800);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function loadMailboxes() {
    try {
      setMailboxes(await api<Mailbox[]>('/api/mailboxes'));
    } catch (error) {
      setMessageTone('danger');
      setMessage((error as Error).message);
    }
  }

  function showMessage(text: string, tone: 'success' | 'danger' | 'info' = 'success') {
    setMessageTone(tone);
    setMessage(text);
  }

  async function copyMailboxValue(value: string, label: string) {
    try {
      await copyTextToClipboard(value);
      showMessage(`${label}已复制`);
    } catch (error) {
      showMessage((error as Error).message || '复制失败', 'danger');
    }
  }

  const MailboxCopyValue = ({ value, label, children, className = '' }: { value: string; label: string; children: React.ReactNode; className?: string }) => (
    <button
      type="button"
      className={`mailbox-copy-value ${className}`}
      onClick={() => copyMailboxValue(value, label)}
      title={`点击复制${label}`}
    >
      <Copy size={13} />
      <span>{children}</span>
    </button>
  );

  return (
    <Panel
      title="邮箱管理"
      subtitle="维护微软邮箱 API 凭证，用于按账号绑定邮箱获取登陆验证码"
      action={<button className="primary" onClick={() => setModal('new')}><Plus size={16} />添加邮箱</button>}
    >
      <div className="admin-toolbar mailbox-toolbar">
        <button className="soft-btn refresh-action" onClick={loadMailboxes}><RefreshCw size={16} />刷新</button>
        <div className="searchbox table-search">
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索邮箱..." />
        </div>
        <button className="soft-btn" onClick={() => setImportOpen(true)}><Upload size={16} />批量导入</button>
      </div>

      <div className="admin-table mailbox-table">
        <div className="admin-table-head mailbox-table-grid">
          <span>邮箱</span>
          <span>密码</span>
          <span>备注</span>
          <span>Client ID</span>
          <span>Refresh Token</span>
          <span>更新时间</span>
          <span>操作</span>
        </div>
        {visibleMailboxes.map((mailbox) => (
          <div className="admin-table-row mailbox-table-grid" key={mailbox.id}>
            <MailboxCopyValue value={mailbox.email} label="邮箱" className="mailbox-email mailbox-visible-value">{mailbox.email}</MailboxCopyValue>
            <MailboxCopyValue value={mailbox.password} label="密码" className="mono-value mailbox-visible-value">{mailbox.password}</MailboxCopyValue>
            <MailboxCopyValue value={mailbox.remark || ''} label="备注" className="mailbox-remark mailbox-visible-value">{mailbox.remark || '-'}</MailboxCopyValue>
            <MailboxCopyValue value={mailbox.client_id} label="Client ID" className="mono-value">{maskSecret(mailbox.client_id, 8, 6)}</MailboxCopyValue>
            <MailboxCopyValue value={mailbox.refresh_token} label="Refresh Token" className="mono-value token-preview">{maskSecret(mailbox.refresh_token, 10, 6)}</MailboxCopyValue>
            <span>{formatDateTime(mailbox.updated_at || mailbox.created_at)}</span>
            <div className="row-actions">
              <button className="ghost-action" onClick={() => setModal(mailbox)}>编辑</button>
              <InboxButton baseUrl={`/api/mailboxes/${mailbox.id}/messages`} api={api} />
              <DeleteButton
                url={`/api/mailboxes/${mailbox.id}`}
                refresh={loadMailboxes}
                body={`确定删除邮箱 ${mailbox.email} 吗？`}
              />
            </div>
          </div>
        ))}
        {visibleMailboxes.length === 0 && <div className="empty-table">{mailboxes.length === 0 ? '还没有邮箱，点击右上角“添加邮箱”或批量导入。' : '没有匹配的邮箱。'}</div>}
      </div>
      <div className="mobile-mailbox-cards">
        {visibleMailboxes.map((mailbox) => (
          <article className="mobile-mailbox-card" key={mailbox.id}>
            <div className="mobile-mailbox-card-head">
              <MailboxCopyValue value={mailbox.email} label="邮箱" className="mailbox-email mailbox-visible-value">{mailbox.email}</MailboxCopyValue>
            </div>
            <div className="mobile-mailbox-fields">
              <span>密码</span>
              <MailboxCopyValue value={mailbox.password} label="密码" className="mono-value mailbox-visible-value">{mailbox.password}</MailboxCopyValue>
              <span>备注</span>
              <MailboxCopyValue value={mailbox.remark || ''} label="备注" className="mailbox-remark mailbox-visible-value">{mailbox.remark || '-'}</MailboxCopyValue>
              <span>Client ID</span>
              <MailboxCopyValue value={mailbox.client_id} label="Client ID" className="mono-value">{maskSecret(mailbox.client_id, 8, 6)}</MailboxCopyValue>
              <span>Refresh Token</span>
              <MailboxCopyValue value={mailbox.refresh_token} label="Refresh Token" className="mono-value token-preview">{maskSecret(mailbox.refresh_token, 10, 6)}</MailboxCopyValue>
              <span>更新时间</span>
              <strong>{formatDateTime(mailbox.updated_at || mailbox.created_at)}</strong>
            </div>
            <div className="mobile-mailbox-actions">
              <button className="ghost-action" onClick={() => setModal(mailbox)}>编辑</button>
              <InboxButton baseUrl={`/api/mailboxes/${mailbox.id}/messages`} api={api} />
              <DeleteButton
                url={`/api/mailboxes/${mailbox.id}`}
                refresh={loadMailboxes}
                body={`确定删除邮箱 ${mailbox.email} 吗？`}
              />
            </div>
          </article>
        ))}
      </div>

      <NoticeToast message={message} tone={messageTone} />
      {modal && (
        <MailboxModal
          mailbox={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await loadMailboxes();
            showMessage('保存成功');
          }}
          onError={(error) => showMessage(error, 'danger')}
        />
      )}
      {importOpen && (
        <MailboxImportModal
          onClose={() => setImportOpen(false)}
          onImported={async (summary) => {
            await loadMailboxes();
            setImportOpen(false);
            showMessage(`导入完成：新增 ${summary.created}，更新 ${summary.updated}，失败 ${summary.failed}`, summary.failed ? 'info' : 'success');
          }}
          onError={(error) => showMessage(error, 'danger')}
        />
      )}
    </Panel>
  );
}

function MailboxModal({
  mailbox,
  onClose,
  onSaved,
  onError
}: {
  mailbox: Mailbox | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    email: mailbox?.email || '',
    password: mailbox?.password || '',
    remark: mailbox?.remark || '',
    client_id: mailbox?.client_id || '',
    refresh_token: mailbox?.refresh_token || ''
  });
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api<Mailbox>(mailbox ? `/api/mailboxes/${mailbox.id}` : '/api/mailboxes', {
        method: mailbox ? 'PUT' : 'POST',
        body: JSON.stringify(form)
      });
      await onSaved();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="admin-modal compact mailbox-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <div>
            <span>邮箱配置</span>
            <h2>{mailbox ? '编辑邮箱' : '添加邮箱'}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={saving}><X size={18} /></button>
        </div>
        <form className="modal-form" onSubmit={save}>
          <Field label="邮箱" value={form.email} onChange={(email) => setForm({ ...form, email })} required />
          <Field label="密码" value={form.password} onChange={(password) => setForm({ ...form, password })} />
          <label>
            <span>备注</span>
            <textarea className="mailbox-remark-textarea" value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
          </label>
          <Field label="Client ID" value={form.client_id} onChange={(client_id) => setForm({ ...form, client_id })} required />
          <label>
            <span>Refresh Token</span>
            <textarea required value={form.refresh_token} onChange={(event) => setForm({ ...form, refresh_token: event.target.value })} />
          </label>
          <div className="modal-actions">
            <button type="button" className="soft-btn" onClick={onClose} disabled={saving}>取消</button>
            <button className="primary" disabled={saving}>{saving ? '保存中...' : '保存'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function MailboxImportModal({
  onClose,
  onImported,
  onError
}: {
  onClose: () => void;
  onImported: (summary: { created: number; updated: number; failed: number }) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [delimiter, setDelimiter] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<{ total: number; created: number; updated: number; failed: number; invalid?: { line: number; reason: string }[] } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const result = await api<{ total: number; created: number; updated: number; failed: number; invalid?: { line: number; reason: string }[] }>('/api/mailboxes/import', {
        method: 'POST',
        body: JSON.stringify({ content, delimiter })
      });
      setSummary(result);
      await onImported(result);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="admin-modal compact mailbox-import-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <div>
            <span>批量导入</span>
            <h2>导入微软邮箱</h2>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={loading}><X size={18} /></button>
        </div>
        <form className="modal-form" onSubmit={submit}>
          <Field label="分隔符" value={delimiter} onChange={setDelimiter} />
          <label>
            <span>邮箱数据</span>
            <textarea
              className="mailbox-import-textarea"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="邮箱----密码----Client ID----Refresh Token----备注"
              required
            />
          </label>
          {summary && (
            <div className="mailbox-import-result">
              <strong>{`共 ${summary.total} 行，新增 ${summary.created}，更新 ${summary.updated}，失败 ${summary.failed}`}</strong>
              {summary.invalid?.slice(0, 5).map((item) => <span key={item.line}>{`第 ${item.line} 行：${item.reason}`}</span>)}
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="soft-btn" onClick={onClose} disabled={loading}>取消</button>
            <button className="primary" disabled={loading}>{loading ? '导入中...' : '导入'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AccountsPanel({ user, settings, accounts, refresh }: { user: User; settings: AppSettings; accounts: Account[]; refresh: () => void }) {
  const [modal, setModal] = useState<Account | 'new' | null>(null);
  const [nameManagerOpen, setNameManagerOpen] = useState(false);
  const [accountNames, setAccountNames] = useState<AccountName[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [toggleLoadingId, setToggleLoadingId] = useState('');
  const [mailCodeLoadingId, setMailCodeLoadingId] = useState('');
  const [mailCodes, setMailCodes] = useState<Record<string, MailCodeResult>>({});
  const [passwordResetLoadingId, setPasswordResetLoadingId] = useState('');
  const [passwordResetLinks, setPasswordResetLinks] = useState<Record<string, PasswordResetLinkResult>>({});
  const [draggingAccountId, setDraggingAccountId] = useState('');
  const [dragOverAccountId, setDragOverAccountId] = useState('');
  const [accountOrderSaving, setAccountOrderSaving] = useState(false);
  const accountPointerDrag = useRef({ active: false, pointerId: -1, sourceId: '', targetId: '' });
  const [copyToast, setCopyToast] = useState('');
  const [toastTone, setToastTone] = useState<'success' | 'danger' | 'info'>('success');
  const copyToastTimer = useRef<number | null>(null);
  const [nameFilter, setNameFilter] = useState<string[]>([]);
  const [statusQuickFilter, setStatusQuickFilter] = useState<'all' | 'active' | 'disabled'>(() => {
    if (typeof window === 'undefined') return 'all';
    const saved = localStorage.getItem('account-status-quick-filter');
    return saved === 'active' || saved === 'disabled' || saved === 'all' ? saved : 'all';
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const searchTerm = search.trim().toLowerCase();
  const nameFilterKey = nameFilter.join('|');
  const accountNameOptions = useMemo(() => {
    const managed = accountNames.map((item) => item.name);
    return uniqueNames([...managed, ...accounts.map((account) => account.name)]).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  }, [accountNames, accounts]);
  const selectedNameSet = useMemo(() => new Set(nameFilter.map(normalizeNameKey)), [nameFilter]);
  const visibleAccounts = accounts.filter((account) => {
    if (selectedNameSet.size && !selectedNameSet.has(normalizeNameKey(account.name))) return false;
    if (statusQuickFilter === 'active' && account.status !== 'active') return false;
    if (statusQuickFilter === 'disabled' && account.status === 'active') return false;
    if (!searchTerm) return true;
    const statusLabel = account.status === 'active' ? '正常' : '停用';
    const text = `${account.name} ${account.login} ${account.password} ${account.remark} ${statusLabel}`.toLowerCase();
    return text.includes(searchTerm);
  });
  const accountTableClass = `account-table ${user.role === 'admin' ? 'manage' : 'readonly'}`;
  const visibleSelectedIds = visibleAccounts.filter((account) => selectedIds.has(account.id)).map((account) => account.id);
  const allVisibleSelected = visibleAccounts.length > 0 && visibleSelectedIds.length === visibleAccounts.length;
  const pagedAccounts = paginateItems(visibleAccounts, page, pageSize);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, pageSize, accounts.length, nameFilterKey, statusQuickFilter]);

  useEffect(() => {
    localStorage.setItem('account-status-quick-filter', statusQuickFilter);
  }, [statusQuickFilter]);

  useEffect(() => {
    loadAccountNames();
  }, []);

  useEffect(() => {
    if (!modal || modal === 'new') return;
    const nextAccount = accounts.find((account) => account.id === modal.id);
    if (!nextAccount) return;
    if (JSON.stringify(nextAccount) !== JSON.stringify(modal)) setModal(nextAccount);
  }, [accounts, modal]);

  useEffect(() => () => {
    if (copyToastTimer.current) window.clearTimeout(copyToastTimer.current);
  }, []);

  function showCopyToast(message: string, tone: 'success' | 'danger' | 'info' = 'success') {
    if (copyToastTimer.current) window.clearTimeout(copyToastTimer.current);
    setToastTone(tone);
    setCopyToast(message);
    copyToastTimer.current = window.setTimeout(() => setCopyToast(''), getToastDurationMs(settings));
  }

  async function loadAccountNames() {
    const list = await api<AccountName[]>('/api/account-names');
    setAccountNames(list);
  }

  async function refreshAccountsAndNames() {
    await Promise.all([refresh(), loadAccountNames()]);
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleAccounts.forEach((account) => next.delete(account.id));
      else visibleAccounts.forEach((account) => next.add(account.id));
      return next;
    });
  }

  async function toggleAccountStatus(account: Account) {
    const nextStatus = account.status === 'active' ? 'disabled' : 'active';
    setToggleLoadingId(account.id);
    try {
      await api(`/api/accounts/${account.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...account, status: nextStatus })
      });
      await refresh();
    } finally {
      setToggleLoadingId('');
    }
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setBulkDeleting(true);
    try {
      for (const id of ids) {
        await api(`/api/accounts/${id}`, { method: 'DELETE' });
      }
      setSelectedIds(new Set());
      setBulkConfirmOpen(false);
      await refresh();
    } finally {
      setBulkDeleting(false);
    }
  }

  async function copyAccount(account: Account) {
    if (account.status !== 'active') {
      showCopyToast('\u8be5\u8d26\u6237\u5df2\u7ecf\u6b7b\u4ea1 \u4e0d\u80fd\u590d\u5236');
      return;
    }
    await copyTextToClipboard(buildAccountCopyText(account, settings));
    showCopyToast('复制成功');
  }

  async function copyAccountField(account: Account, value: string) {
    if (account.status !== 'active') {
      showCopyToast('\u8be5\u8d26\u6237\u5df2\u7ecf\u6b7b\u4ea1 \u4e0d\u80fd\u590d\u5236');
      return;
    }
    await copyTextToClipboard(value);
    showCopyToast('复制成功');
  }

  async function fetchLoginCode(account: Account) {
    setMailCodeLoadingId(account.id);
    setMailCodes((current) => { const next = { ...current }; delete next[account.id]; return next; });
    try {
      const result = await api<MailCodeResult>(`/api/accounts/${account.id}/mail-code`, { method: 'POST' });
      setMailCodes((current) => ({ ...current, [account.id]: result }));
      await copyTextToClipboard(result.code);
      showCopyToast('验证码已复制');
    } catch (error) {
      showCopyToast((error as Error).message, 'danger');
    } finally {
      setMailCodeLoadingId('');
    }
  }

  async function fetchPasswordResetLink(account: Account) {
    setPasswordResetLoadingId(account.id);
    setPasswordResetLinks((current) => { const next = { ...current }; delete next[account.id]; return next; });
    try {
      const result = await api<PasswordResetLinkResult>(`/api/accounts/${account.id}/password-reset-link`, { method: 'POST' });
      setPasswordResetLinks((current) => ({ ...current, [account.id]: result }));
      await copyTextToClipboard(result.link);
      showCopyToast('\u91cd\u7f6e\u94fe\u63a5\u5df2\u590d\u5236');
    } catch (error) {
      showCopyToast((error as Error).message, 'danger');
    } finally {
      setPasswordResetLoadingId('');
    }
  }

  function moveAccountOrder(sourceId: string, targetId: string) {
    if (!sourceId || !targetId || sourceId === targetId || user.role !== 'admin') return;
    const sourceIndex = visibleAccounts.findIndex((account) => account.id === sourceId);
    const targetIndex = visibleAccounts.findIndex((account) => account.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const reorderedVisible = [...visibleAccounts];
    const [source] = reorderedVisible.splice(sourceIndex, 1);
    reorderedVisible.splice(targetIndex, 0, source);
    const visibleIdSet = new Set(visibleAccounts.map((account) => account.id));
    const visibleQueue = [...reorderedVisible];
    const nextIds = accounts.map((account) => visibleIdSet.has(account.id) ? visibleQueue.shift()!.id : account.id);
    saveAccountOrder(nextIds);
  }

  async function saveAccountOrder(ids: string[]) {
    setAccountOrderSaving(true);
    try {
      await api<Account[]>('/api/accounts/order', { method: 'POST', body: JSON.stringify({ ids }) });
      await refresh();
      showCopyToast('\u8d26\u53f7\u6392\u5e8f\u5df2\u4fdd\u5b58');
    } catch (error) {
      showCopyToast((error as Error).message, 'danger');
    } finally {
      setAccountOrderSaving(false);
      setDraggingAccountId('');
      setDragOverAccountId('');
    }
  }

  function startAccountDrag(event: React.DragEvent, accountId: string) {
    setDraggingAccountId(accountId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', accountId);
  }

  function startAccountPointerDrag(event: React.PointerEvent<HTMLButtonElement>, accountId: string) {
    if (accountOrderSaving || user.role !== 'admin') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    accountPointerDrag.current = { active: true, pointerId: event.pointerId, sourceId: accountId, targetId: accountId };
    setDraggingAccountId(accountId);
    setDragOverAccountId('');
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveAccountPointerDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = accountPointerDrag.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const target = element?.closest<HTMLElement>('[data-account-drop-id]');
    const targetId = target?.dataset.accountDropId || '';
    if (targetId && targetId !== drag.sourceId) {
      drag.targetId = targetId;
      setDragOverAccountId(targetId);
    }
  }

  function endAccountPointerDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = accountPointerDrag.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    accountPointerDrag.current = { active: false, pointerId: -1, sourceId: '', targetId: '' };
    if (drag.targetId && drag.targetId !== drag.sourceId) {
      moveAccountOrder(drag.sourceId, drag.targetId);
      return;
    }
    setDraggingAccountId('');
    setDragOverAccountId('');
  }

  function enterAccountDrop(accountId: string) {
    if (draggingAccountId && draggingAccountId !== accountId) setDragOverAccountId(accountId);
  }

  function dropAccount(event: React.DragEvent, accountId: string) {
    event.preventDefault();
    const sourceId = draggingAccountId || event.dataTransfer.getData('text/plain');
    moveAccountOrder(sourceId, accountId);
  }

  const CopyValue = ({ account, value, className = '' }: { account: Account; value: string; className?: string }) => (
    <button type="button" className={`copy-value ${className}`} onClick={() => copyAccountField(account, value)} title="点击复制">
      {className.includes('copy-value-name') ? <MarqueeText text={value} settings={settings} /> : value}
    </button>
  );

  return (
    <Panel
      title="账号管理"
      subtitle="管理可出租账号、密码和备注信息"
      action={user.role === 'admin' && <button className="primary" onClick={() => setModal('new')}><Plus size={16} />添加账号</button>}
    >
      <div className="admin-toolbar">
        <button className="soft-btn refresh-action" onClick={refresh}><RefreshCw size={16} />刷新</button>
        <div className="searchbox table-search">
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索账号..." />
        </div>
        {user.role === 'admin' && (
          <button className="soft-btn manage-name-action" onClick={() => setNameManagerOpen(true)}><Sparkles size={16} />管理名称</button>
        )}
        {user.role === 'admin' && selectedIds.size > 0 && (
          <button className="danger-btn bulk-delete-action" onClick={() => setBulkConfirmOpen(true)}>
            <Trash2 size={16} />
            删除选中 {selectedIds.size}
          </button>
        )}
        <div className="account-filter-tools">
          <div className="status-quick-filter" aria-label="账号状态快捷筛选">
            <button type="button" className={statusQuickFilter === 'all' ? 'active' : ''} onClick={() => setStatusQuickFilter('all')}>全部</button>
            <button type="button" className={statusQuickFilter === 'active' ? 'active' : ''} onClick={() => setStatusQuickFilter('active')}>正常</button>
            <button type="button" className={statusQuickFilter === 'disabled' ? 'active danger' : ''} onClick={() => setStatusQuickFilter('disabled')}>死亡</button>
          </div>
          <AccountNameFilter accounts={accounts} names={accountNameOptions} selected={nameFilter} onChange={setNameFilter} />
        </div>
      </div>
      <div className={`admin-table ${user.role === 'admin' ? 'admin-account-table' : 'user-account-table'}`}>
        <div className={`admin-table-head ${accountTableClass}`}>
          {user.role === 'admin' && <span className="drag-head" aria-hidden="true" />}
          {user.role === 'admin' && (
            <label className="table-check">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="选择当前列表账号" />
            </label>
          )}
          <span>名称</span>
          <span>账号</span>
          <span>密码</span>
          <span>状态</span>
          <span>备注</span>
          <span>创建时间</span>
          <span>操作</span>
        </div>
        {pagedAccounts.items.map((account) => (
          <div
            className={`admin-table-row ${accountTableClass} ${account.status !== 'active' ? 'account-disabled-row' : ''} ${draggingAccountId === account.id ? 'is-reordering' : ''} ${dragOverAccountId === account.id ? 'is-drag-over' : ''}`}
            key={account.id}
            data-account-drop-id={account.id}
            onDragOver={(event) => {
              if (!draggingAccountId || draggingAccountId === account.id) return;
              event.preventDefault();
              enterAccountDrop(account.id);
            }}
            onDrop={(event) => dropAccount(event, account.id)}
          >
            {user.role === 'admin' && (
              <button
                type="button"
                className="account-drag-handle"
                draggable={false}
                onPointerDown={(event) => startAccountPointerDrag(event, account.id)}
                onPointerMove={moveAccountPointerDrag}
                onPointerUp={endAccountPointerDrag}
                onPointerCancel={endAccountPointerDrag}
                title={'\u62d6\u52a8\u6392\u5e8f'}
                aria-label={`\u62d6\u52a8\u8c03\u6574 ${account.name} \u6392\u5e8f`}
                disabled={accountOrderSaving}
              >
                <GripVertical size={16} />
              </button>
            )}
            {user.role === 'admin' && (
              <label className="table-check">
                <input type="checkbox" checked={selectedIds.has(account.id)} onChange={() => toggleSelected(account.id)} aria-label={`选择${account.name}`} />
              </label>
            )}
            <CopyValue account={account} value={account.name} className="copy-value-name" />
            <CopyValue account={account} value={account.login} />
            <CopyValue account={account} value={account.password} className="copy-value-code" />
            <div className="status-toggle-cell">
              <span className={`status-pill ${account.status === 'active' ? 'ok' : 'muted'}`}>{account.status === 'active' ? '正常' : '停用'}</span>
              {user.role === 'admin' && (
                <button
                  type="button"
                  className={`switch-toggle ${account.status === 'active' ? 'on' : ''}`}
                  onClick={() => toggleAccountStatus(account)}
                  disabled={toggleLoadingId === account.id}
                  aria-label={`${account.status === 'active' ? '停用' : '启用'}${account.name}`}
                  title={account.status === 'active' ? '停用账号' : '启用账号'}
                >
                  <span />
                </button>
              )}
            </div>
            <CopyValue account={account} value={account.remark || '-'} />
            <span>{formatDateTime(account.created_at)}</span>
            <div className="row-actions account-row-actions">
              <button
                type="button"
                className={`ghost-action login-code-action ${mailCodes[account.id] ? 'has-code' : ''}`}
                onClick={() => fetchLoginCode(account)}
                disabled={mailCodeLoadingId === account.id}
                title="获取登陆验证码"
              >
                <Mail size={14} />
                {mailCodeLoadingId === account.id ? '获取中...' : (mailCodes[account.id]?.code || '登陆验证码')}
              </button>
              <button
                type="button"
                className={`ghost-action reset-link-action ${passwordResetLinks[account.id] ? 'has-link' : ''}`}
                onClick={() => fetchPasswordResetLink(account)}
                disabled={passwordResetLoadingId === account.id}
                title={'\u91cd\u7f6e\u5bc6\u7801'}
              >
                <KeyRound size={14} />
                {passwordResetLoadingId === account.id ? '\u83b7\u53d6\u4e2d...' : (passwordResetLinks[account.id] ? '\u94fe\u63a5\u5df2\u590d\u5236' : '\u91cd\u7f6e\u5bc6\u7801')}
              </button>
              <InboxButton baseUrl={`/api/accounts/${account.id}/messages`} api={api} />
              <button className="ghost-action copy-action" onClick={() => copyAccount(account)}><Copy size={14} />复制</button>
              {user.role === 'admin' && (
                <>
                  <button className="ghost-action" onClick={() => setModal(account)}>编辑</button>
                  <DeleteButton
                    url={`/api/accounts/${account.id}`}
                    refresh={async () => {
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        next.delete(account.id);
                        return next;
                      });
                      await refresh();
                    }}
                    body={`确定删除账号 ${account.name} 吗？相关出租记录也会一并删除。`}
                  />
                </>
              )}
            </div>
          </div>
        ))}
        {visibleAccounts.length === 0 && <div className="empty-table">{accounts.length === 0 ? '还没有账号，点击右上角“添加账号”开始。' : '没有匹配的账号。'}</div>}
      </div>      <div className="mobile-account-cards">
        {visibleAccounts.map((account) => (
          <article
            className={`mobile-account-card ${account.status !== 'active' ? 'account-disabled-card' : ''} ${draggingAccountId === account.id ? 'is-reordering' : ''} ${dragOverAccountId === account.id ? 'is-drag-over' : ''}`}
            key={account.id}
            data-account-drop-id={account.id}
            onDragOver={(event) => {
              if (!draggingAccountId || draggingAccountId === account.id) return;
              event.preventDefault();
              enterAccountDrop(account.id);
            }}
            onDrop={(event) => dropAccount(event, account.id)}
          >
            <div className="mobile-account-card-head">
              <div>
                <CopyValue account={account} value={account.name} className="copy-value-name mobile-title-copy" />
                <span>{account.status === 'active' ? '\u6b63\u5e38' : '\u505c\u7528'}</span>
              </div>
              {user.role === 'admin' ? (
                <div className="mobile-card-tools">
                  <button
                    type="button"
                    className="account-drag-handle"
                    draggable={false}
                    onPointerDown={(event) => startAccountPointerDrag(event, account.id)}
                    onPointerMove={moveAccountPointerDrag}
                    onPointerUp={endAccountPointerDrag}
                    onPointerCancel={endAccountPointerDrag}
                    title={'\u62d6\u52a8\u6392\u5e8f'}
                    aria-label={`\u62d6\u52a8\u8c03\u6574 ${account.name} \u6392\u5e8f`}
                    disabled={accountOrderSaving}
                  >
                    <GripVertical size={16} />
                  </button>
                  <label className="table-check">
                    <input type="checkbox" checked={selectedIds.has(account.id)} onChange={() => toggleSelected(account.id)} aria-label={`\u9009\u62e9${account.name}`} />
                  </label>
                </div>
              ) : (
                <span className={`status-pill ${account.status === 'active' ? 'ok' : 'muted'}`}>{account.status === 'active' ? '\u6b63\u5e38' : '\u505c\u7528'}</span>
              )}
            </div>
            <div className="mobile-account-fields">
              <span>{'\u8d26\u53f7'}</span>
              <CopyValue account={account} value={account.login} />
              <span>{'\u5bc6\u7801'}</span>
              <CopyValue account={account} value={account.password} className="copy-value-code" />
              <span>{'\u5907\u6ce8'}</span>
              <CopyValue account={account} value={account.remark || '-'} />
            </div>
            <div className="mobile-account-actions">
              {user.role === 'admin' && (
                <div className="status-toggle-cell">
                  <span className={`status-pill ${account.status === 'active' ? 'ok' : 'muted'}`}>{account.status === 'active' ? '\u6b63\u5e38' : '\u505c\u7528'}</span>
                  <button
                    type="button"
                    className={`switch-toggle ${account.status === 'active' ? 'on' : ''}`}
                    onClick={() => toggleAccountStatus(account)}
                    disabled={toggleLoadingId === account.id}
                    aria-label={`${account.status === 'active' ? '\u505c\u7528' : '\u542f\u7528'}${account.name}`}
                    title={account.status === 'active' ? '\u505c\u7528\u8d26\u53f7' : '\u542f\u7528\u8d26\u53f7'}
                  >
                    <span />
                  </button>
                </div>
              )}
              <div className="row-actions account-row-actions">
                <button
                  type="button"
                  className={`ghost-action login-code-action ${mailCodes[account.id] ? 'has-code' : ''}`}
                  onClick={() => fetchLoginCode(account)}
                  disabled={mailCodeLoadingId === account.id}
                  title="获取登陆验证码"
                >
                  <Mail size={14} />
                  {mailCodeLoadingId === account.id ? '获取中...' : (mailCodes[account.id]?.code || '登陆验证码')}
                </button>
                <button
                  type="button"
                  className={`ghost-action reset-link-action ${passwordResetLinks[account.id] ? 'has-link' : ''}`}
                  onClick={() => fetchPasswordResetLink(account)}
                  disabled={passwordResetLoadingId === account.id}
                  title={'\u91cd\u7f6e\u5bc6\u7801'}
                >
                  <KeyRound size={14} />
                  {passwordResetLoadingId === account.id ? '\u83b7\u53d6\u4e2d...' : (passwordResetLinks[account.id] ? '\u94fe\u63a5\u5df2\u590d\u5236' : '\u91cd\u7f6e\u5bc6\u7801')}
                </button>
                <InboxButton baseUrl={`/api/accounts/${account.id}/messages`} api={api} />
                <button className="ghost-action copy-action" onClick={() => copyAccount(account)}><Copy size={14} />{'\u590d\u5236'}</button>
                {user.role === 'admin' && (
                  <>
                    <button className="ghost-action" onClick={() => setModal(account)}>{'\u7f16\u8f91'}</button>
                    <DeleteButton
                      url={`/api/accounts/${account.id}`}
                      refresh={async () => {
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          next.delete(account.id);
                          return next;
                        });
                        await refresh();
                      }}
                      body={`\u786e\u5b9a\u5220\u9664\u8d26\u53f7 ${account.name} \u5417\uff1f\u76f8\u5173\u51fa\u79df\u8bb0\u5f55\u4e5f\u4f1a\u4e00\u5e76\u5220\u9664\u3002`}
                    />
                  </>
                )}
              </div>
            </div>
          </article>
        ))}
        {visibleAccounts.length === 0 && <div className="empty-table">{accounts.length === 0 ? '\u8fd8\u6ca1\u6709\u8d26\u53f7\u3002' : '\u6ca1\u6709\u5339\u914d\u7684\u8d26\u53f7\u3002'}</div>}
      </div>
      <PaginationControls total={visibleAccounts.length} page={pagedAccounts.safePage} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
      <NoticeToast message={copyToast} tone={toastTone} />
      {modal && (
        <AccountModal
          account={modal === 'new' ? null : modal}
          nameOptions={accountNameOptions}
          onManageNames={() => setNameManagerOpen(true)}
          onClose={() => setModal(null)}
          onSaved={async () => { await refreshAccountsAndNames(); setModal(null); }}
        />
      )}
      {nameManagerOpen && (
        <AccountNameManagerModal
          names={accountNames}
          onClose={() => setNameManagerOpen(false)}
          onChanged={async () => {
            await refreshAccountsAndNames();
          }}
        />
      )}
      {bulkConfirmOpen && (
        <ConfirmModal
          title="确认批量删除"
          body={`确定删除选中的 ${selectedIds.size} 个账号吗？相关出租记录也会一并删除。`}
          confirmLabel="批量删除"
          onConfirm={bulkDelete}
          onClose={() => setBulkConfirmOpen(false)}
          loading={bulkDeleting}
          danger
        />
      )}
    </Panel>
  );
  const [form, setForm] = useState({ name: '', login: '', password: '', remark: '' });
  async function create(event: React.FormEvent) {
    event.preventDefault();
    await api('/api/accounts', { method: 'POST', body: JSON.stringify(form) });
    setForm({ name: '', login: '', password: '', remark: '' });
    refresh();
  }
  async function edit(account: Account) {
    const name = prompt('账号名称', account.name);
    if (name === null) return;
    const login = prompt('登录账号', account.login);
    if (login === null) return;
    const password = prompt('密码', account.password);
    if (password === null) return;
    const remark = prompt('备注', account.remark || '') ?? '';
    await api(`/api/accounts/${account.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...account, name, login, password, remark })
    });
    refresh();
  }
  return (
    <Panel title="账号管理" action={user.role === 'admin' && <UserPlusForm form={form} setForm={setForm} onSubmit={create} />}>
      <div className="cards-grid">
        {accounts.map((account) => (
          <article className="data-card" key={account.id}>
            <h3>{account.name}</h3>
            <p>账号：{account.login}</p>
            <p>密码：{account.password}</p>
            <small>{account.remark || '暂无备注'}</small>
            {user.role === 'admin' && (
              <div className="card-actions">
                <button className="soft-btn" onClick={() => edit(account)}>修改</button>
                <DeleteButton url={`/api/accounts/${account.id}`} refresh={refresh} />
              </div>
            )}
          </article>
        ))}
      </div>
    </Panel>
  );
}

function UserPlusForm({ form, setForm, onSubmit }: { form: any; setForm: (next: any) => void; onSubmit: (event: React.FormEvent) => void }) {
  return (
    <form className="inline-form" onSubmit={onSubmit}>
      <input placeholder="名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      <input placeholder="账号" value={form.login} onChange={(event) => setForm({ ...form, login: event.target.value })} />
      <input placeholder="密码" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
      <input placeholder="备注" value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
      <button className="primary"><Plus size={15} />添加</button>
    </form>
  );
}

function UsersPanel({ users, refresh }: { users: User[]; refresh: () => void }) {
  const [modal, setModal] = useState<User | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const searchTerm = search.trim().toLowerCase();
  const visibleUsers = users.filter((item) => {
    if (!searchTerm) return true;
    const roleLabel = item.role === 'admin' ? '管理员' : '普通用户';
    const statusLabel = item.enabled ? '启用' : '停用';
    const text = `${item.username} ${roleLabel} ${statusLabel} ${formatDateTime(item.created_at)}`.toLowerCase();
    return text.includes(searchTerm);
  });
  const pagedUsers = paginateItems(visibleUsers, page, pageSize);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, pageSize, users.length]);

  return (
    <Panel
      title="用户管理"
      subtitle="创建登录用户并控制角色和启用状态"
      action={<button className="primary" onClick={() => setModal('new')}><UserPlus size={16} />添加用户</button>}
    >
      <div className="admin-toolbar">
        <div className="searchbox table-search">
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索用户..." />
        </div>
        <button className="soft-btn" onClick={refresh}><RefreshCw size={16} />刷新</button>
      </div>
      <div className="admin-table">
        <div className="admin-table-head user-table">
          <span>用户名</span>
          <span>角色</span>
          <span>状态</span>
          <span>创建时间</span>
          <span>操作</span>
        </div>
        {pagedUsers.items.map((item) => (
          <div className="admin-table-row user-table" key={item.id}>
            <strong>{item.username}</strong>
            <span>{item.role === 'admin' ? '管理员' : '普通用户'}</span>
            <span className={`status-pill ${item.enabled ? 'ok' : 'muted'}`}>{item.enabled ? '启用' : '停用'}</span>
            <span>{formatDateTime(item.created_at)}</span>
            <div className="row-actions">
              <button className="ghost-action" onClick={() => setModal(item)}>编辑</button>
              <DeleteButton url={`/api/users/${item.id}`} refresh={refresh} />
            </div>
          </div>
        ))}
        {visibleUsers.length === 0 && <div className="empty-table">{users.length === 0 ? '还没有用户。' : '没有匹配的用户。'}</div>}
      </div>
      <PaginationControls total={visibleUsers.length} page={pagedUsers.safePage} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
      {modal && <UserModal user={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={async () => { await refresh(); setModal(null); }} />}
    </Panel>
  );
  const [form, setForm] = useState({ username: '', password: '', role: 'user' });
  async function create(event: React.FormEvent) {
    event.preventDefault();
    await api('/api/users', { method: 'POST', body: JSON.stringify(form) });
    setForm({ username: '', password: '', role: 'user' });
    refresh();
  }
  async function edit(user: User) {
    const username = prompt('用户名', user.username);
    if (username === null) return;
    const role = prompt('角色：admin 或 user', user.role);
    if (role === null) return;
    const enabled = confirm('确认启用这个用户？选择取消会停用。');
    await api(`/api/users/${user.id}`, {
      method: 'PUT',
      body: JSON.stringify({ username, role: role === 'admin' ? 'admin' : 'user', enabled })
    });
    refresh();
  }
  return (
    <Panel title="用户管理">
      <form className="inline-form" onSubmit={create}>
        <input placeholder="用户名" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
        <input placeholder="密码" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        <FancySelect
          label="角色"
          value={form.role}
          options={[
            { value: 'user', label: '普通用户' },
            { value: 'admin', label: '管理员' }
          ]}
          onChange={(role) => setForm({ ...form, role })}
        />
        <button className="primary"><UserPlus size={15} />新增用户</button>
      </form>
      <div className="table-list">
        {users.map((item) => (
          <div className="table-row" key={item.id}>
            <span>{item.username}</span>
            <span>{item.role === 'admin' ? '管理员' : '普通用户'}</span>
            <span>{item.enabled ? '启用' : '停用'}</span>
            <button className="soft-btn" onClick={() => edit(item)}>修改</button>
            <DeleteButton url={`/api/users/${item.id}`} refresh={refresh} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function NamePicker({
  value,
  options,
  onChange,
  onManage
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onManage?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const filtered = options.filter((name) => !value.trim() || name.toLowerCase().includes(value.trim().toLowerCase()));

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <label className="name-picker-field">
      <span>账号名称</span>
      <div className="name-picker" ref={ref}>
        <div className="name-picker-input">
          <Sparkles size={16} />
          <input
            value={value}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              onChange(event.target.value);
              setOpen(true);
            }}
            placeholder="输入或选择已管理的名称"
          />
          {onManage && <button type="button" className="name-picker-manage" onClick={onManage}>管理</button>}
        </div>
        {open && (
          <div className="name-picker-menu">
            <div className="name-picker-menu-head">
              <strong>快捷选择名称</strong>
              {onManage && <button type="button" onClick={onManage}>管理名称</button>}
            </div>
            <div className="name-picker-options">
              {filtered.map((name) => (
                <button
                  type="button"
                  key={name}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                  }}
                >
                  <Sparkles size={14} />
                  <span>{name}</span>
                </button>
              ))}
              {filtered.length === 0 && <p>没有匹配名称，可以直接输入后保存账号。</p>}
            </div>
          </div>
        )}
      </div>
    </label>
  );
}

function AccountNameManagerModal({
  names,
  onClose,
  onChanged
}: {
  names: AccountName[];
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState('');
  const [loadingId, setLoadingId] = useState('');

  async function createName(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await api('/api/account-names', { method: 'POST', body: JSON.stringify({ name: newName }) });
      setNewName('');
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveName(id: string) {
    setError('');
    setLoadingId(id);
    try {
      await api(`/api/account-names/${id}`, { method: 'PUT', body: JSON.stringify({ name: editingName }) });
      setEditingId('');
      setEditingName('');
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingId('');
    }
  }

  async function deleteName(item: AccountName) {
    setError('');
    setLoadingId(item.id);
    try {
      await api(`/api/account-names/${item.id}`, { method: 'DELETE' });
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingId('');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="admin-modal compact name-manager-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <div>
            <span>名称库</span>
            <h2>管理名称</h2>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="name-manager-body">
          <form className="name-manager-create" onSubmit={createName}>
            <div className="searchbox">
              <Sparkles size={16} />
              <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="新增一个常用名称" />
            </div>
            <button className="primary"><Plus size={16} />新增</button>
          </form>
          {error && <div className="form-error">{error}</div>}
          <div className="name-manager-list">
            {names.map((item) => (
              <div className="name-manager-row" key={item.id}>
                {editingId === item.id ? (
                  <input value={editingName} onChange={(event) => setEditingName(event.target.value)} />
                ) : (
                  <strong>{item.name}</strong>
                )}
                <div className="row-actions">
                  {editingId === item.id ? (
                    <>
                      <button type="button" className="soft-btn" disabled={loadingId === item.id} onClick={() => saveName(item.id)}>保存</button>
                      <button type="button" className="ghost-action" onClick={() => { setEditingId(''); setEditingName(''); }}>取消</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="ghost-action" onClick={() => { setEditingId(item.id); setEditingName(item.name); }}>编辑</button>
                      <button type="button" className="danger-btn" disabled={loadingId === item.id} onClick={() => deleteName(item)}><Trash2 size={15} />删除</button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {names.length === 0 && <div className="empty-table">还没有名称，先新增一个常用名称吧。</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

type FancySelectOption = {
  value: string;
  label: string;
  hint?: string;
};

function FancySelect({
  label,
  value,
  options,
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  options: FancySelectOption[];
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((item) => item.value === value);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <label className="fancy-select-field">
      <span>{label}</span>
      <div className={`fancy-select ${open ? 'is-open' : ''}`} ref={rootRef}>
        <button type="button" className="fancy-select-trigger" onClick={() => setOpen((next) => !next)} aria-expanded={open}>
          <div>
            <strong>{selected?.label || placeholder || '请选择'}</strong>
            {selected?.hint && <small>{selected.hint}</small>}
          </div>
          <ChevronDown size={17} />
        </button>
        {open && (
          <div className="fancy-select-menu">
            {options.map((item) => (
              <button
                key={item.value || '__empty__'}
                type="button"
                className={item.value === value ? 'active' : ''}
                onClick={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
              >
                <strong>{item.label}</strong>
                {item.hint && <small>{item.hint}</small>}
              </button>
            ))}
          </div>
        )}
      </div>
    </label>
  );
}

function AccountModal({
  account,
  nameOptions = [],
  onManageNames,
  onClose,
  onSaved
}: {
  account: Account | null;
  nameOptions?: string[];
  onManageNames?: () => void;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [form, setForm] = useState({
    name: account?.name || '',
    login: account?.login || '',
    password: account?.password || '',
    remark: account?.remark || '',
    status: account?.status || 'active',
    mailbox_id: account?.mailbox_id || ''
  });
  const [error, setError] = useState('');

  useEffect(() => {
    setForm({
      name: account?.name || '',
      login: account?.login || '',
      password: account?.password || '',
      remark: account?.remark || '',
      status: account?.status || 'active',
      mailbox_id: account?.mailbox_id || ''
    });
  }, [account?.id, account?.name, account?.login, account?.password, account?.remark, account?.status, account?.mailbox_id]);

  useEffect(() => {
    let alive = true;
    api<Mailbox[]>('/api/mailboxes')
      .then((items) => {
        if (alive) setMailboxes(items);
      })
      .catch(() => {
        if (alive) setMailboxes([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const statusOptions: FancySelectOption[] = [
    { value: 'active', label: '正常', hint: '账号可正常使用' },
    { value: 'disabled', label: '停用', hint: '账号会被标记为死亡/停用' }
  ];
  const mailboxOptions: FancySelectOption[] = [
    { value: '', label: '暂不绑定收件邮箱', hint: '后续也可以再补选' },
    ...mailboxes.map((mailbox) => ({
      value: mailbox.id,
      label: mailbox.email,
      hint: '收验证码和找回链接都走这个邮箱'
    }))
  ];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await api(account ? `/api/accounts/${account.id}` : '/api/accounts', {
        method: account ? 'PUT' : 'POST',
        body: JSON.stringify(form)
      });
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="admin-modal">
        <div className="modal-title">
          <h2>{account ? '编辑账号' : '添加账号'}</h2>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <form className="modal-form" onSubmit={submit}>
          <NamePicker
            value={form.name}
            options={nameOptions}
            onChange={(name) => setForm({ ...form, name })}
            onManage={onManageNames}
          />
          <div className="form-grid-2">
            <Field label="登录账号" value={form.login} onChange={(login) => setForm({ ...form, login })} />
            <Field label="密码" value={form.password} onChange={(password) => setForm({ ...form, password })} />
          </div>
          <div className="account-select-stack">
            <FancySelect
              label="状态"
              value={form.status}
              options={statusOptions}
              onChange={(status) => setForm({ ...form, status })}
            />
            <FancySelect
              label="收件邮箱"
              value={form.mailbox_id}
              options={mailboxOptions}
              placeholder="选择收件邮箱"
              onChange={(mailbox_id) => setForm({ ...form, mailbox_id })}
            />
          </div>
          <label>
            <span>备注</span>
            <textarea placeholder="请输入备注" value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
          </label>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="soft-btn" onClick={onClose}>取消</button>
            <button className="primary">{account ? '保存修改' : '添加账号'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function UserModal({ user, onClose, onSaved }: { user: User | null; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [form, setForm] = useState({
    username: user?.username || '',
    password: '',
    role: user?.role || 'user',
    enabled: user?.enabled ?? true
  });
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await api(user ? `/api/users/${user.id}` : '/api/users', {
        method: user ? 'PUT' : 'POST',
        body: JSON.stringify(form)
      });
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="admin-modal compact">
        <div className="modal-title">
          <h2>{user ? '编辑用户' : '添加用户'}</h2>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <form className="modal-form" onSubmit={submit}>
          <Field label="用户名" value={form.username} onChange={(username) => setForm({ ...form, username })} />
          <Field label={user ? '新密码（留空不修改）' : '密码'} type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} />
          <div className="form-grid-2">
            <FancySelect
              label="角色"
              value={form.role}
              options={[
                { value: 'user', label: '普通用户', hint: '可查看时间线，维护自己的记录' },
                { value: 'admin', label: '管理员', hint: '拥有系统管理权限' }
              ]}
              onChange={(role) => setForm({ ...form, role: role as Role })}
            />
            <FancySelect
              label="状态"
              value={form.enabled ? '1' : '0'}
              options={[
                { value: '1', label: '启用', hint: '允许登录' },
                { value: '0', label: '停用', hint: '禁止登录' }
              ]}
              onChange={(enabled) => setForm({ ...form, enabled: enabled === '1' })}
            />
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="soft-btn" onClick={onClose}>取消</button>
            <button className="primary">{user ? '保存修改' : '添加用户'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RecordsPanel({
  user,
  bookings,
  accounts,
  users,
  refresh,
  onEdit
}: {
  user: User;
  bookings: Booking[];
  accounts: Account[];
  users: User[];
  refresh: () => void;
  onEdit: (booking: Booking) => void;
}) {
  const [accountFilter, setAccountFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    if (user.role === 'admin') loadLogs();
  }, [user.role]);

  async function loadLogs() {
    const nextLogs = await api<AuditLog[]>('/api/audit-logs');
    setLogs(nextLogs);
  }

  async function refreshRecords() {
    await refresh();
    if (user.role === 'admin') await loadLogs();
  }

  async function clearLogs() {
    setClearLoading(true);
    try {
      await api('/api/audit-logs', { method: 'DELETE' });
      await refreshRecords();
      setClearConfirmOpen(false);
    } finally {
      setClearLoading(false);
    }
  }

  function actionLabel(action: string) {
    const labels: Record<string, string> = {
      create: '新增',
      update: '修改',
      delete: '删除',
      endEarly: '提前结束',
      renew: '续租',
      login: '登录',
      logout: '退出',
      setup: '安装',
      import: '导入',
      export: '导出',
      switch_user: '切换用户',
      update_start: '开始更新'
    };
    return labels[action] || action;
  }

  function entityLabel(entityType: string) {
    const labels: Record<string, string> = {
      booking: '出租',
      account: '账号',
      user: '用户',
      settings: '设置',
      backup: '备份',
      system: '系统'
    };
    return labels[entityType] || entityType;
  }

  const visibleBookings = bookings.filter((booking) => {
    if (booking.status === 'cancelled') return false;
    const accountMatch = accountFilter === 'all' || booking.account_id === accountFilter;
    const userMatch = userFilter === 'all' || booking.operator_id === userFilter;
    return accountMatch && userMatch;
  });
  const selectedUser = users.find((item) => item.id === userFilter);
  const visibleLogs = user.role === 'admin'
    ? logs.filter((log) => {
      const accountMatch = accountFilter === 'all';
      const userMatch = userFilter === 'all' || (log.actor_name || '系统') === selectedUser?.username;
      return accountMatch && userMatch;
    })
    : [];
  const recordRows = [
    ...visibleBookings.map((booking) => ({ kind: 'booking' as const, key: `booking-${booking.id}`, time: booking.created_at, booking })),
    ...visibleLogs.map((log) => ({ kind: 'log' as const, key: `log-${log.id}`, time: log.created_at, log }))
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  const pagedRecordRows = paginateItems(recordRows, page, pageSize);

  useEffect(() => {
    setPage(1);
  }, [accountFilter, userFilter, pageSize, recordRows.length]);

  function ownerClass(booking: Booking) {
    return booking.operator_id === user.id ? 'is-mine' : 'is-others';
  }

  return (
    <div className="records-stack">
      <Panel title="记录" subtitle="按账号和操作用户筛选记录。">
        <div className="admin-toolbar">
          <div className="filter-group">
            <FancySelect
              label="筛选账号"
              value={accountFilter}
              options={[
                { value: 'all', label: '全部账号' },
                ...accounts.map((account) => ({ value: account.id, label: account.name, hint: account.login }))
              ]}
              onChange={setAccountFilter}
            />
            <FancySelect
              label="筛选用户"
              value={userFilter}
              options={[
                { value: 'all', label: '全部用户' },
                ...users.map((item) => ({ value: item.id, label: item.username, hint: item.role === 'admin' ? '管理员' : '普通用户' }))
              ]}
              onChange={setUserFilter}
            />
          </div>
          <div className="row-actions">
            <button className="soft-btn" onClick={refreshRecords}><RefreshCw size={16} />刷新</button>
            {user.role === 'admin' && <button className="danger-btn" onClick={() => setClearConfirmOpen(true)}><Trash2 size={16} />清空操作记录</button>}
          </div>
        </div>
        <div className="record-table">
          <div className="record-head">
            <span>类型</span>
            <span>对象</span>
            <span>内容</span>
            <span>时间</span>
            <span>状态/动作</span>
            <span>操作人</span>
            <span>操作</span>
          </div>
          {pagedRecordRows.items.map((row) => {
            if (row.kind === 'log') {
              return (
                <div className="record-row" key={row.key}>
                  <span>操作</span>
                  <span>{entityLabel(row.log.entity_type)}</span>
                  <strong>{row.log.summary}</strong>
                  <span>{formatDateTime(row.log.created_at)}</span>
                  <span className="tag muted">{actionLabel(row.log.action)}</span>
                  <span>{row.log.actor_name || '系统'}</span>
                  <span>-</span>
                </div>
              );
            }
            const booking = row.booking;
            return (
              <div className={`record-row ${ownerClass(booking)}`} key={row.key}>
                <span>出租</span>
                <span>{booking.account_name}</span>
                <strong>{booking.renter_name}{booking.renter_contact ? ` / ${booking.renter_contact}` : ''}</strong>
                <span>{formatDateTime(booking.starts_at)} - {formatDateTime(booking.ends_at)}</span>
                <span className={`tag ${booking.status}`}>{statusText[booking.status]}</span>
                <span>{booking.operator_name || '-'}</span>
                <div className="row-actions">
                  {(user.role === 'admin' || booking.operator_id === user.id) && <button className="ghost-action" onClick={() => onEdit(booking)}>编辑</button>}
                  {(user.role === 'admin' || booking.operator_id === user.id) && <DeleteButton url={`/api/bookings/${booking.id}`} refresh={refreshRecords} />}
                </div>
              </div>
            );
          })}
          {recordRows.length === 0 && <div className="empty-table">当前筛选条件下没有记录。</div>}
        </div>
        <div className="mobile-record-cards">
          {pagedRecordRows.items.map((row) => {
            if (row.kind === 'log') {
              return (
                <article className="mobile-record-card" key={row.key}>
                  <div className="mobile-record-card-head">
                    <span>{'\u64cd\u4f5c'}</span>
                    <span className="tag muted">{actionLabel(row.log.action)}</span>
                  </div>
                  <strong>{row.log.summary}</strong>
                  <dl>
                    <div><dt>{'\u5bf9\u8c61'}</dt><dd>{entityLabel(row.log.entity_type)}</dd></div>
                    <div><dt>{'\u65f6\u95f4'}</dt><dd>{formatDateTime(row.log.created_at)}</dd></div>
                    <div><dt>{'\u64cd\u4f5c\u4eba'}</dt><dd>{row.log.actor_name || '\u7cfb\u7edf'}</dd></div>
                  </dl>
                </article>
              );
            }
            const booking = row.booking;
            return (
              <article className={`mobile-record-card ${ownerClass(booking)}`} key={row.key}>
                <div className="mobile-record-card-head">
                  <span>{booking.account_name}</span>
                  <span className={`tag ${booking.status}`}>{statusText[booking.status]}</span>
                </div>
                <strong>{booking.renter_name}{booking.renter_contact ? ` / ${booking.renter_contact}` : ''}</strong>
                <dl>
                  <div><dt>{'\u5f00\u59cb'}</dt><dd>{formatDateTime(booking.starts_at)}</dd></div>
                  <div><dt>{'\u7ed3\u675f'}</dt><dd>{formatDateTime(booking.ends_at)}</dd></div>
                  <div><dt>{'\u64cd\u4f5c\u4eba'}</dt><dd>{booking.operator_name || '-'}</dd></div>
                </dl>
                {(user.role === 'admin' || booking.operator_id === user.id) && (
                  <div className="row-actions mobile-record-actions">
                    <button className="ghost-action" onClick={() => onEdit(booking)}>{'\u7f16\u8f91'}</button>
                    <DeleteButton url={`/api/bookings/${booking.id}`} refresh={refreshRecords} />
                  </div>
                )}
              </article>
            );
          })}
          {recordRows.length === 0 && <div className="empty-table">{'\u5f53\u524d\u7b5b\u9009\u6761\u4ef6\u4e0b\u6ca1\u6709\u8bb0\u5f55\u3002'}</div>}
        </div>
        <PaginationControls total={recordRows.length} page={pagedRecordRows.safePage} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
        {clearConfirmOpen && (
          <ConfirmModal
            title="确认清空操作记录"
            body="这里只会清空操作记录，出租记录会继续保留。清空后无法恢复，确认继续吗？"
            confirmLabel="清空"
            onConfirm={clearLogs}
            onClose={() => setClearConfirmOpen(false)}
            loading={clearLoading}
            danger
          />
        )}
      </Panel>
    </div>
  );
}

function BackupPanel({ settings }: { settings: AppSettings }) {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const messageTone = message.includes('成功') ? 'success' : 'danger';

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), getToastDurationMs(settings));
    return () => window.clearTimeout(timer);
  }, [message, settings]);

  function exportBackup() {
    if (!localMockEnabled) {
      window.location.assign('/api/admin/export');
      return;
    }
    const state = loadMockState();
    const blob = new Blob([JSON.stringify({ ...state, exported_at: new Date().toISOString(), app: 'cute-schedule-local' }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `schedule-backup-${getLocalDateValue(new Date()).replace(/-/g, '')}-local.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function restore() {
    if (!file) return;
    if (!confirm('导入会全量替换当前服务器数据，系统会先生成恢复点。确认继续吗？')) return;
    const data = new FormData();
    data.append('file', file);
    try {
      const res = await api<{ recovery: string }>('/api/admin/import', { method: 'POST', body: data });
      setMessage(`导入成功，恢复点：${res.recovery}。请重新登录。`);
      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <Panel title="完整导入导出">
      <div className="backup-grid">
        <article className="data-card">
          <Download />
          <h3>完整导出</h3>
          <p>导出系统设置、用户、账号、出租记录和操作记录，可迁移到其他服务器。</p>
          <button className="primary" onClick={exportBackup}>下载备份包</button>
        </article>
        <article className="data-card">
          <Upload />
          <h3>完整导入恢复</h3>
          <p>导入前会自动生成恢复点，导入成功后需要重新登录。</p>
          <label className="file-picker">
            <input type="file" accept=".zip,.json,application/json" onChange={(event) => setFile(event.target.files?.[0] || null)} />
            <Upload size={18} />
            <span>{file ? file.name : '选择备份压缩包'}</span>
          </label>
          <button className="danger-btn" onClick={restore}>导入并替换</button>
        </article>
      </div>
      <NoticeToast message={message} tone={messageTone} />
    </Panel>
  );
}

function SettingsPanel({ user, settings, onSettings }: { user: User; settings: AppSettings; onSettings: (settings: AppSettings) => void }) {
  const [form, setForm] = useState(settings);
  const [message, setMessage] = useState('');
  const messageTone = message.includes('已保存') || message.includes('最新') || message.includes('成功') ? 'success' : 'danger';
  const selectedCopyFields = (form.accountCopyFields || defaultSettings.accountCopyFields || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), getToastDurationMs(form));
    return () => window.clearTimeout(timer);
  }, [message, form]);

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      const res = await api<{ settings: AppSettings }>('/api/settings', { method: 'PUT', body: JSON.stringify(form) });
      const nextSettings = { ...settings, ...res.settings };
      onSettings(nextSettings);
      document.title = nextSettings.siteName || '甜排班';
      setMessage('系统基本信息已保存');
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  function toggleCopyField(key: string) {
    const set = new Set(selectedCopyFields);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    const ordered = accountCopyFieldOptions.map((item) => item.key).filter((item) => set.has(item));
    setForm({ ...form, accountCopyFields: ordered.join(',') });
  }

  return (
    <Panel title="我的设置">
      <div className="settings-layout">
        <div className="settings-card">
          <Archive />
          <div>
            <h3>{user.username}</h3>
            <p>{user.role === 'admin' ? '管理员拥有全部系统权限。' : '普通用户可查看全部时间线，只能维护自己创建的记录。'}</p>
          </div>
        </div>

        {user.role === 'admin' && (
          <form className="settings-card settings-form" onSubmit={saveSettings}>
            <Settings />
            <div>
              <h3>系统基本信息</h3>
              <p>这里控制左上角系统名字和浏览器标题。</p>
              <div className="settings-fields">
                <Field label="系统名字" value={form.siteName || ''} onChange={(siteName) => setForm({ ...form, siteName })} />
                <FancySelect
                  label="时区"
                  value={form.timezone || 'Asia/Shanghai'}
                  options={[
                    { value: 'Asia/Shanghai', label: 'Asia/Shanghai', hint: '中国时间' },
                    { value: 'UTC', label: 'UTC', hint: '协调世界时' }
                  ]}
                  onChange={(timezone) => setForm({ ...form, timezone })}
                />
                <FancySelect
                  label="默认视图"
                  value={form.defaultView || 'day'}
                  options={[
                    { value: 'day', label: '日视图', hint: '按天查看排班' },
                    { value: 'week', label: '周视图', hint: '按周查看排班' }
                  ]}
                  onChange={(defaultView) => setForm({ ...form, defaultView })}
                />
                <FancySelect
                  label="记录删除规则"
                  value={form.auditRetentionDays || '7'}
                  options={[
                    { value: '3', label: '每 3 天清理一次' },
                    { value: '7', label: '每 7 天清理一次' },
                    { value: '30', label: '每 30 天清理一次' },
                    { value: 'custom', label: '自定义时间段' }
                  ]}
                  onChange={(auditRetentionDays) => setForm({ ...form, auditRetentionDays })}
                />
                <Field label="长名称滚动速度（秒）" type="number" value={form.nameScrollSeconds || defaultSettings.nameScrollSeconds || '8'} onChange={(nameScrollSeconds) => setForm({ ...form, nameScrollSeconds })} />
                <Field label="提示弹窗显示时间（秒）" type="number" value={form.toastDurationSeconds || defaultSettings.toastDurationSeconds || '1'} onChange={(toastDurationSeconds) => setForm({ ...form, toastDurationSeconds })} />
                <Field label="邮件匹配时间窗口（分钟）" type="number" value={form.mailLookupWindowMinutes || defaultSettings.mailLookupWindowMinutes || '10'} onChange={(mailLookupWindowMinutes) => setForm({ ...form, mailLookupWindowMinutes })} />
                {form.auditRetentionDays === 'custom' && (
                  <Field label="自定义保留天数" value={form.auditRetentionCustomDays || ''} onChange={(auditRetentionCustomDays) => setForm({ ...form, auditRetentionCustomDays })} />
                )}
              </div>
              <div className="copy-fields">
                <span>{'\u8d26\u53f7\u8be6\u60c5\u590d\u5236\u5185\u5bb9'}</span>
                <div>
                  {accountCopyFieldOptions.map((item) => (
                    <label className="copy-field-option" key={item.key}>
                      <input type="checkbox" checked={selectedCopyFields.includes(item.key)} onChange={() => toggleCopyField(item.key)} />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <button className="primary">保存基本信息</button>
            </div>
          </form>
        )}

        {user.role === 'admin' && <UpdatePanel request={api} />}

        <NoticeToast message={message} tone={messageTone} />
      </div>
    </Panel>
  );
}

function LegacySettingsPanel({ user }: { user: User }) {
  return (
    <Panel title="我的设置">
      <div className="settings-card">
        <Archive />
        <div>
          <h3>{user.username}</h3>
          <p>{user.role === 'admin' ? '管理员拥有全部系统权限。' : '普通用户可查看全部时间线，只能维护自己创建的记录。'}</p>
        </div>
      </div>
    </Panel>
  );
}

function Panel({ title, subtitle, children, action }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="panel-page">
      <div className="panel-title">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel = '确认',
  onConfirm,
  onClose,
  loading = false,
  danger = false
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  loading?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={(event) => { event.stopPropagation(); onClose(); }}>
      <section className="admin-modal compact confirm-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} disabled={loading}><X size={18} /></button>
        </div>
        <div className="confirm-body">{body}</div>
        <div className="modal-actions confirm-actions">
          <button type="button" className="soft-btn" onClick={onClose} disabled={loading}>取消</button>
          <button type="button" className={danger ? 'danger-btn' : 'primary'} onClick={onConfirm} disabled={loading}>
            {loading ? '处理中...' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function DeleteButton({ url, refresh, label = '删除', title = '确认删除', body = '删除后无法恢复，确认继续吗？' }: { url: string; refresh: () => void | Promise<void>; label?: string; title?: string; body?: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function remove() {
    setLoading(true);
    try {
      await api(url, { method: 'DELETE' });
      await refresh();
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button className="icon-btn danger" onClick={() => setOpen(true)} title={label}><Trash2 size={15} /></button>
      {open && (
        <ConfirmModal
          title={title}
          body={body}
          confirmLabel={label}
          onConfirm={remove}
          onClose={() => setOpen(false)}
          loading={loading}
          danger
        />
      )}
    </>
  );
}

function MobileTabs({ active, setActive, isAdmin }: { active: string; setActive: (id: string) => void; isAdmin: boolean }) {
  const items = navItems.filter((item) => ['timeline', 'accounts', 'records'].includes(item.id) || (isAdmin && ['mailboxes', 'backup', 'settings'].includes(item.id)));
  return (
    <nav className="mobile-tabs" style={{ '--mobile-tab-count': items.slice(0, 5).length } as React.CSSProperties}>
      {items.slice(0, 5).map((item) => {
        const Icon = item.icon;
        return (
          <button key={item.id} className={active === item.id ? 'active' : ''} onClick={() => setActive(item.id)}>
            <Icon size={18} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function Field({ label, value, onChange, type = 'text', required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  return (
    <label>
      <span>{label}</span>
      <input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

const timeHours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const timeMinutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));

function TimeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = /^\d{2}:\d{2}$/.test(value) ? value : '00:00';
  const [selectedHour, selectedMinute] = selected.split(':');
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeHourRef = useRef<HTMLButtonElement>(null);
  const activeMinuteRef = useRef<HTMLButtonElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open) return;

    function updateMenuPosition() {
      const control = controlRef.current;
      const menu = menuRef.current;
      if (!control || !menu) return;

      const rect = control.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 8;
      const menuWidth = menu.offsetWidth || Math.min(300, window.innerWidth - viewportPadding * 2);
      const menuHeight = menu.offsetHeight || 300;
      const preferredLeft = rect.right - menuWidth;
      const maxLeft = window.innerWidth - menuWidth - viewportPadding;
      const left = Math.min(Math.max(preferredLeft, viewportPadding), Math.max(viewportPadding, maxLeft));

      const belowTop = rect.bottom + gap;
      const aboveTop = rect.top - menuHeight - gap;
      const maxTop = window.innerHeight - menuHeight - viewportPadding;
      const top = menuHeight && belowTop > maxTop && aboveTop >= viewportPadding
        ? aboveTop
        : Math.min(belowTop, Math.max(viewportPadding, maxTop));

      setMenuStyle({ left, top, visibility: 'visible' });
    }

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    activeHourRef.current?.scrollIntoView({ block: 'center' });
    activeMinuteRef.current?.scrollIntoView({ block: 'center' });

    function closeOnOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (controlRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    function closeOnKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnKey);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnKey);
    };
  }, [open, selected]);

  function choosePart(part: 'hour' | 'minute', next: string) {
    const nextTime = part === 'hour' ? `${next}:${selectedMinute}` : `${selectedHour}:${next}`;
    onChange(nextTime);
  }

  function chooseNow() {
    const now = new Date();
    const next = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    onChange(next);
  }

  return (
    <div className="time-picker">
      <button type="button" className="time-select time-trigger" ref={controlRef} onClick={() => setOpen((next) => !next)} aria-expanded={open}>
        <Clock3 size={16} />
        <strong>{selected}</strong>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="time-menu" ref={menuRef} style={menuStyle}>
          <div className="time-menu-head">
            <span>时间</span>
            <strong>{selected}</strong>
          </div>
          <div className="time-wheels">
            <div className="time-column">
              <span>小时</span>
              <div className="time-list">
                {timeHours.map((hour) => (
                  <button
                    type="button"
                    className={hour === selectedHour ? 'active' : ''}
                    key={hour}
                    ref={hour === selectedHour ? activeHourRef : undefined}
                    onClick={() => choosePart('hour', hour)}
                  >
                    {hour}
                  </button>
                ))}
              </div>
            </div>
            <div className="time-column">
              <span>分钟</span>
              <div className="time-list">
                {timeMinutes.map((minute) => (
                  <button
                    type="button"
                    className={minute === selectedMinute ? 'active' : ''}
                    key={minute}
                    ref={minute === selectedMinute ? activeMinuteRef : undefined}
                    onClick={() => choosePart('minute', minute)}
                  >
                    {minute}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="time-menu-actions">
            <button type="button" onClick={chooseNow}>现在</button>
            <button type="button" className="primary-time-action" onClick={() => setOpen(false)}>完成</button>
          </div>
        </div>
      )}
    </div>
  );
}

function toLocalInput(value: string) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function getLocalDateValue(date: Date) {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}

function formatDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function datePart(value: string) {
  return (value || toLocalInput(new Date().toISOString())).slice(0, 10);
}

function timePart(value: string) {
  const time = (value || toLocalInput(new Date().toISOString())).slice(11, 16);
  return /^\d{2}:\d{2}$/.test(time) ? time : '00:00';
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function parseLocalDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function roundToNextMinutes(date: Date, stepMinutes: number) {
  const next = new Date(date);
  next.setSeconds(0, 0);
  const remainder = next.getMinutes() % stepMinutes;
  if (remainder !== 0) next.setMinutes(next.getMinutes() + stepMinutes - remainder);
  return next;
}

function durationHours(start: string, end: string) {
  const diff = (new Date(end).getTime() - new Date(start).getTime()) / (60 * 60 * 1000);
  return Number.isFinite(diff) ? Math.round(diff * 10) / 10 : 0;
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatClock(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatTimelineRange(visibleStart: Date, visibleEnd: Date, dayStart: Date, dayEnd: Date) {
  const startLabel = visibleStart.getTime() <= dayStart.getTime() ? '00:00' : formatClock(visibleStart);
  const endLabel = visibleEnd.getTime() >= dayEnd.getTime() ? '24:00' : formatClock(visibleEnd);
  return `${startLabel} - ${endLabel}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

createRoot(document.getElementById('root')!).render(<App />);
