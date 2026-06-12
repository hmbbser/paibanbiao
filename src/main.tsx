import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Archive,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  DatabaseBackup,
  Download,
  FileClock,
  KeyRound,
  LogOut,
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

type Role = 'admin' | 'user';
type User = { id: string; username: string; role: Role; enabled: boolean; created_at: string; can_switch?: boolean };
type AppSettings = { siteName: string; timezone: string; defaultView: string; exportVersion?: string; auditRetentionDays?: string; auditRetentionCustomDays?: string };
type Account = { id: string; name: string; login: string; password: string; remark: string; status: string; created_at: string };
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

const defaultSettings: AppSettings = { siteName: '甜排班', timezone: 'Asia/Shanghai', defaultView: 'day', auditRetentionDays: '7' };
const localMockEnabled = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

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

type MockState = Overview & {
  settings: AppSettings;
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
    { id: 'a-1', name: 'A账号', login: 'A123456', password: 'aA123456', remark: '主力账号', status: 'active', created_at: mockNow(-60) },
    { id: 'a-2', name: 'B账号', login: 'B234567', password: 'bB234567', remark: '备用账号', status: 'active', created_at: mockNow(-50) },
    { id: 'a-3', name: 'C账号', login: 'C345678', password: 'cC345678', remark: '游戏账号', status: 'active', created_at: mockNow(-40) },
    { id: 'a-4', name: 'D账号', login: 'D456789', password: 'dD456789', remark: '测试账号', status: 'active', created_at: mockNow(-30) }
  ];
  return {
    settings: { ...defaultSettings, siteName: '账号出租管理系统', exportVersion: '0.2.3', auditRetentionDays: '7' },
    users: [admin, staff],
    accounts,
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
    return JSON.parse(raw) as MockState;
  } catch {
    const initial = createMockState();
    saveMockState(initial);
    return initial;
  }
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
  if (url === '/api/admin/version') return ok({ current: '0.2.3-local', latest: '0.2.3-local', hasUpdate: false, repo: 'hmbbser/paibanbiao', branch: 'main' });
  if (url === '/api/admin/update' && method === 'POST') return ok({ message: '本地 UI 模式不执行真实更新' });
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
        saveMockState({
          settings: { ...defaultSettings, ...imported.settings },
          users: importedUsers,
          accounts: importedAccounts,
          bookings: importedBookings,
          auditLogs: imported.auditLogs || [],
          sessionUserId: imported.sessionUserId || importedUsers[0]?.id || '',
          switchRootUserId: imported.switchRootUserId
        });
      }
    }
    return ok({ recovery: 'local-ui-recovery' });
  }

  const accountMatch = url.match(/^\/api\/accounts\/(.+)$/);
  if (url === '/api/accounts' && method === 'POST') {
    const body = readBody<Partial<Account>>(options);
    const account: Account = {
      id: crypto.randomUUID(),
      name: body.name || '新账号',
      login: body.login || '',
      password: body.password || '',
      remark: body.remark || '',
      status: body.status || 'active',
      created_at: new Date().toISOString()
    };
    state.accounts.unshift(account);
    addMockAudit(state, sessionUser, 'create', 'account', `新增账号 ${account.name}`);
    saveMockState(state);
    return ok(account);
  }
  if (accountMatch && method === 'PUT') {
    const body = readBody<Partial<Account>>(options);
    state.accounts = state.accounts.map((item) => item.id === accountMatch[1] ? { ...item, ...body } : item);
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
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bootstrap();
  }, []);

  async function bootstrap() {
    try {
      const setup = await api<{ complete: boolean }>('/api/setup');
      setSetupComplete(setup.complete);
      if (setup.complete) {
        const me = await api<{ user: User; settings: AppSettings }>('/api/auth/me');
        setUser(me.user);
        const nextSettings = { ...defaultSettings, ...me.settings };
        setSettings(nextSettings);
        document.title = nextSettings.siteName;
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  if (loading || setupComplete === null) return <Splash />;
  if (!setupComplete) return <SetupWizard onDone={(next, nextSettings) => { setSetupComplete(true); setUser(next); setSettings(nextSettings); }} />;
  if (!user) return <Login onDone={(next, nextSettings) => { setUser(next); setSettings(nextSettings); }} />;
  return <Dashboard user={user} settings={settings} onUser={setUser} onSettings={setSettings} onLogout={() => setUser(null)} />;
}

function Splash() {
  return (
    <main className="auth-shell">
      <div className="brand-card">
        <Sparkles />
        <h1>甜排班</h1>
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
    <div className="app-shell">
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
          {error && <div className="toast">{error}<button onClick={() => setError('')}><X size={14} /></button></div>}
          {active === 'timeline' && (
            <Timeline
              user={user}
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
          {active === 'accounts' && <AccountsPanel user={user} accounts={overview.accounts} refresh={refresh} />}
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
          {active === 'backup' && user.role === 'admin' && <BackupPanel />}
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
          onClose={() => setAccountViewing(null)}
          onDeleted={user.role === 'admin' ? async () => {
            setAccountViewing(null);
            await refresh();
          } : undefined}
          onEdit={user.role === 'admin' ? () => {
            setAccountEditing(accountViewing);
            setAccountViewing(null);
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
  const autoBookings = useMemo(() => bookings.map(withAutoBookingStatus), [bookings]);
  const start = new Date(`${selectedDate}T00:00:00`);
  const end = new Date(start);
  end.setHours(24);
  const isSelectedToday = selectedDate === getLocalDateValue(new Date());
  const activeBookings = autoBookings.filter((booking) => {
    if (booking.status === 'cancelled') return false;
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
  const visibleAccounts = accounts.filter((account) => account.status === 'active' || visibleBookingAccountIds.has(account.id));
  const activeAccountCount = accounts.filter((account) => account.status === 'active').length;
  const miniBookings = recordMode === 'today' ? visibleBookings : autoBookings.filter((booking) => booking.status !== 'cancelled').slice(0, 8);
  const currentLeft = percentBetween(new Date(), start, end);
  const metrics = {
    today: activeBookings.length,
    expiring: activeBookings.filter((booking) => new Date(booking.ends_at).getTime() - Date.now() < 1000 * 60 * 60 * 2 && new Date(booking.ends_at) > new Date()).length,
    conflicts: conflictIds.size,
    available: activeAccountCount,
    active: activeBookings.filter((booking) => booking.status === 'active').length,
    reserved: activeBookings.filter((booking) => booking.status === 'reserved').length
  };

  function shiftDate(days: number) {
    const date = new Date(`${selectedDate}T00:00:00`);
    date.setDate(date.getDate() + days);
    setSelectedDate(getLocalDateValue(date));
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
        <button type="button" className={statusFilter === 'all' ? 'active' : ''} onClick={() => setStatusFilter('all')}>全部</button>
        <button type="button" className={statusFilter === 'reserved' ? 'active' : ''} onClick={() => setStatusFilter('reserved')}><span className="dot reserved" />预约</button>
        <button type="button" className={statusFilter === 'active' ? 'active' : ''} onClick={() => setStatusFilter('active')}><span className="dot active" />出租中</button>
        <button type="button" className={statusFilter === 'completed' ? 'active' : ''} onClick={() => setStatusFilter('completed')}><span className="dot completed" />已结束</button>
        <button type="button" className={statusFilter === 'conflict' ? 'active' : ''} onClick={() => setStatusFilter('conflict')}><span className="dot cancelled" />冲突</button>
      </div>

      <div className="scheduler">
        <div className="time-head account-head">账号小窝</div>
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
                onClick={() => onViewAccount(account)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onViewAccount(account);
                }}
              >
                <div className="account-line">
                  <strong>{account.name}</strong>
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
                  <div className={accountIndex === 0 ? 'now-line show-label' : 'now-line'} style={{ left: `${currentLeft}%` }}>
                    {accountIndex === 0 && <span>{formatTime(new Date().toISOString())}</span>}
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
                  const crossesDay = new Date(booking.starts_at) < start || new Date(booking.ends_at) > end;
                  const hasConflict = conflictIds.has(booking.id);
                  return (
                    <button
                      className={`booking-bar ${booking.status} ${crossesDay ? 'cross-day' : ''} ${hasConflict ? 'has-conflict' : ''}`}
                      key={booking.id}
                      style={{ left: `${left}%`, width: `${Math.max(right - left, 4)}%`, top: `${20 + (rowLanes.byId.get(booking.id) || 0) * 72}px` }}
                      title={`租客：${booking.renter_name}\n联系方式：${booking.renter_contact || '-'}\n账号：${booking.account_name || '-'}\n时间：${formatDateTime(booking.starts_at)} - ${formatDateTime(booking.ends_at)}\n状态：${hasConflict ? '冲突 · ' : ''}${statusText[booking.status]}\n操作人：${booking.operator_name || '-'}`}
                      onClick={() => (user.role === 'admin' || booking.operator_id === user.id) && onEdit(booking)}
                    >
                      <strong>{booking.renter_name}</strong>
                      <span>{booking.renter_contact}</span>
                      <small>{formatTime(visibleStart.toISOString())} - {formatTime(visibleEnd.toISOString())}{crossesDay ? ' · 跨天' : ''} · {hasConflict ? '冲突' : statusText[booking.status]}</small>
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
          <button type="button" className="mini-record-row" key={booking.id} onClick={() => onEdit(booking)}>
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
              <button className={`mobile-booking ${booking.status}`} key={booking.id} onClick={() => onEdit(booking)}>
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
  const selectedAccount = accounts.find((account) => account.id === form.account_id);
  const activeAccounts = accounts.filter((account) => account.status === 'active');
  const selectableAccounts = booking && selectedAccount && selectedAccount.status !== 'active'
    ? [selectedAccount, ...activeAccounts.filter((account) => account.id !== selectedAccount.id)]
    : activeAccounts;

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
        <label>
          <span>账号</span>
          <select required value={form.account_id} onChange={(event) => setForm({ ...form, account_id: event.target.value })}>
            {selectableAccounts.length === 0 && <option value="">暂无可用账号</option>}
            {selectableAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.status !== 'active' ? '（停用）' : ''}</option>)}
          </select>
        </label>
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
        <label>
          <span>状态</span>
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as BookingStatus })}>
            {editableBookingStatuses.map((key) => <option key={key} value={key}>{statusText[key]}</option>)}
          </select>
        </label>
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
  onClose,
  onDeleted,
  onEdit,
  canEdit
}: {
  booking: Booking;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
  onEdit: () => void;
  canEdit: boolean;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
          <DetailItem label="账号名称" value={booking.account_name || '-'} />
          <DetailItem label="租客姓名" value={booking.renter_name} />
          <DetailItem label="联系方式" value={booking.renter_contact || '-'} />
          <DetailItem label="开始时间" value={formatDateTime(booking.starts_at)} />
          <DetailItem label="结束时间" value={formatDateTime(booking.ends_at)} />
          <DetailItem label="当前状态" value={statusText[booking.status]} />
          <DetailItem label="操作人" value={booking.operator_name || '-'} />
          <DetailItem label="备注" value={booking.remark || '-'} />
        </div>
        <div className="modal-actions detail-actions split-actions">
          {canEdit && <button className="danger-btn" onClick={() => setDeleteOpen(true)}><Trash2 size={16} />删除</button>}
          <div className="row-actions">
            <button className="soft-btn" onClick={onClose}>关闭</button>
            {canEdit && <button className="primary" onClick={onEdit}>编辑出租</button>}
          </div>
        </div>
      </section>
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

function AccountDetailModal({ account, onClose, onDeleted, onEdit }: { account: Account; onClose: () => void; onDeleted?: () => void | Promise<void>; onEdit?: () => void }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="admin-modal compact detail-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <div>
            <span>账号详情</span>
            <h2>{account.name}</h2>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="detail-grid">
          <DetailItem label="账号名称" value={account.name} />
          <DetailItem label="账号" value={account.login} />
          <DetailItem label="密码" value={account.password} />
          <DetailItem label="状态" value={account.status === 'active' ? '正常' : '停用'} />
          <DetailItem label="备注" value={account.remark || '-'} />
          <DetailItem label="创建时间" value={formatDateTime(account.created_at)} />
        </div>
        <div className="modal-actions detail-actions split-actions">
          {onDeleted && <button className="danger-btn" onClick={() => setDeleteOpen(true)}><Trash2 size={16} />删除</button>}
          <div className="row-actions">
            <button className="soft-btn" onClick={onClose}>关闭</button>
            {onEdit && <button className="primary" onClick={onEdit}>编辑账号</button>}
          </div>
        </div>
      </section>
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

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AccountsPanel({ user, accounts, refresh }: { user: User; accounts: Account[]; refresh: () => void }) {
  const [modal, setModal] = useState<Account | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [toggleLoadingId, setToggleLoadingId] = useState('');
  const searchTerm = search.trim().toLowerCase();
  const visibleAccounts = accounts.filter((account) => {
    if (!searchTerm) return true;
    const statusLabel = account.status === 'active' ? '正常' : '停用';
    const text = `${account.name} ${account.login} ${account.password} ${account.remark} ${statusLabel}`.toLowerCase();
    return text.includes(searchTerm);
  });
  const accountTableClass = `account-table ${user.role === 'admin' ? 'manage' : 'readonly'}`;
  const visibleSelectedIds = visibleAccounts.filter((account) => selectedIds.has(account.id)).map((account) => account.id);
  const allVisibleSelected = visibleAccounts.length > 0 && visibleSelectedIds.length === visibleAccounts.length;

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

  return (
    <Panel
      title="账号管理"
      subtitle="管理可出租账号、密码和备注信息"
      action={user.role === 'admin' && <button className="primary" onClick={() => setModal('new')}><Plus size={16} />添加账号</button>}
    >
      <div className="admin-toolbar">
        <div className="searchbox table-search">
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索账号..." />
        </div>
        <div className="row-actions">
          {user.role === 'admin' && (
            <button className="danger-btn" onClick={() => setBulkConfirmOpen(true)} disabled={selectedIds.size === 0}>
              <Trash2 size={16} />
              删除选中{selectedIds.size ? ` ${selectedIds.size}` : ''}
            </button>
          )}
          <button className="soft-btn" onClick={refresh}><RefreshCw size={16} />刷新</button>
        </div>
      </div>
      <div className="admin-table">
        <div className={`admin-table-head ${accountTableClass}`}>
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
          {user.role === 'admin' && <span>操作</span>}
        </div>
        {visibleAccounts.map((account) => (
          <div className={`admin-table-row ${accountTableClass}`} key={account.id}>
            {user.role === 'admin' && (
              <label className="table-check">
                <input type="checkbox" checked={selectedIds.has(account.id)} onChange={() => toggleSelected(account.id)} aria-label={`选择${account.name}`} />
              </label>
            )}
            <strong>{account.name}</strong>
            <span>{account.login}</span>
            <code>{account.password}</code>
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
            <span>{account.remark || '-'}</span>
            <span>{formatDateTime(account.created_at)}</span>
            {user.role === 'admin' && (
              <div className="row-actions">
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
              </div>
            )}
          </div>
        ))}
        {visibleAccounts.length === 0 && <div className="empty-table">{accounts.length === 0 ? '还没有账号，点击右上角“添加账号”开始。' : '没有匹配的账号。'}</div>}
      </div>
      {modal && <AccountModal account={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={async () => { await refresh(); setModal(null); }} />}
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
  const searchTerm = search.trim().toLowerCase();
  const visibleUsers = users.filter((item) => {
    if (!searchTerm) return true;
    const roleLabel = item.role === 'admin' ? '管理员' : '普通用户';
    const statusLabel = item.enabled ? '启用' : '停用';
    const text = `${item.username} ${roleLabel} ${statusLabel} ${formatDateTime(item.created_at)}`.toLowerCase();
    return text.includes(searchTerm);
  });
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
        {visibleUsers.map((item) => (
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
        <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
          <option value="user">普通用户</option>
          <option value="admin">管理员</option>
        </select>
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

function AccountModal({ account, onClose, onSaved }: { account: Account | null; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [form, setForm] = useState({
    name: account?.name || '',
    login: account?.login || '',
    password: account?.password || '',
    remark: account?.remark || '',
    status: account?.status || 'active'
  });
  const [error, setError] = useState('');

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
          <Field label="账号名称" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <div className="form-grid-2">
            <Field label="登录账号" value={form.login} onChange={(login) => setForm({ ...form, login })} />
            <Field label="密码" value={form.password} onChange={(password) => setForm({ ...form, password })} />
          </div>
          <label>
            <span>状态</span>
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="active">正常</option>
              <option value="disabled">停用</option>
            </select>
          </label>
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
            <label>
              <span>角色</span>
              <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </label>
            <label>
              <span>状态</span>
              <select value={form.enabled ? '1' : '0'} onChange={(event) => setForm({ ...form, enabled: event.target.value === '1' })}>
                <option value="1">启用</option>
                <option value="0">停用</option>
              </select>
            </label>
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

  return (
    <div className="records-stack">
      <Panel title="记录" subtitle="按账号和操作用户筛选记录。">
        <div className="admin-toolbar">
          <div className="filter-group">
            <label>
              <span>筛选账号</span>
              <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
                <option value="all">全部账号</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </label>
            <label>
              <span>筛选用户</span>
              <select value={userFilter} onChange={(event) => setUserFilter(event.target.value)}>
                <option value="all">全部用户</option>
                {users.map((item) => <option key={item.id} value={item.id}>{item.username}</option>)}
              </select>
            </label>
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
          {recordRows.map((row) => {
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
              <div className="record-row" key={row.key}>
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

function BackupPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');

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
      {message && <div className="toast inline">{message}</div>}
    </Panel>
  );
}

function SettingsPanel({ user, settings, onSettings }: { user: User; settings: AppSettings; onSettings: (settings: AppSettings) => void }) {
  const [form, setForm] = useState(settings);
  const [version, setVersion] = useState<{ current: string; latest: string; hasUpdate: boolean; repo: string; branch: string } | null>(null);
  const [force, setForce] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setForm(settings);
  }, [settings]);

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

  async function checkVersion() {
    setMessage('');
    try {
      const res = await api<{ current: string; latest: string; hasUpdate: boolean; repo: string; branch: string }>('/api/admin/version');
      setVersion(res);
      setMessage(res.hasUpdate ? '发现新版本，可以一键更新' : '当前已经是最新版本');
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function runUpdate() {
    if (!confirm('更新会从 GitHub 拉取最新代码并重建容器，过程中服务会短暂重启。确认继续吗？')) return;
    setMessage('');
    try {
      const res = await api<{ message: string }>('/api/admin/update', { method: 'POST', body: JSON.stringify({ force }) });
      setMessage(res.message);
    } catch (err) {
      setMessage((err as Error).message);
    }
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
                <label>
                  <span>时区</span>
                  <select value={form.timezone || 'Asia/Shanghai'} onChange={(event) => setForm({ ...form, timezone: event.target.value })}>
                    <option value="Asia/Shanghai">Asia/Shanghai</option>
                    <option value="UTC">UTC</option>
                  </select>
                </label>
                <label>
                  <span>默认视图</span>
                  <select value={form.defaultView || 'day'} onChange={(event) => setForm({ ...form, defaultView: event.target.value })}>
                    <option value="day">日视图</option>
                    <option value="week">周视图</option>
                  </select>
                </label>
                <label>
                  <span>记录删除规则</span>
                  <select value={form.auditRetentionDays || '7'} onChange={(event) => setForm({ ...form, auditRetentionDays: event.target.value })}>
                    <option value="3">每 3 天清理一次</option>
                    <option value="7">每 7 天清理一次</option>
                    <option value="30">每 30 天清理一次</option>
                    <option value="custom">自定义时间段</option>
                  </select>
                </label>
                {form.auditRetentionDays === 'custom' && (
                  <Field label="自定义保留天数" value={form.auditRetentionCustomDays || ''} onChange={(auditRetentionCustomDays) => setForm({ ...form, auditRetentionCustomDays })} />
                )}
              </div>
              <button className="primary">保存基本信息</button>
            </div>
          </form>
        )}

        {user.role === 'admin' && (
          <div className="settings-card settings-form">
            <RefreshCw />
            <div>
              <h3>版本更新</h3>
              <p>从 GitHub 仓库检测最新版本，不一致时可一键拉取代码、重建并重启服务。</p>
              <div className="version-box">
                <span>当前版本：{version?.current || '未检测'}</span>
                <span>最新版本：{version?.latest || '未检测'}</span>
                <span>仓库：{version?.repo || 'hmbbser/paibanbiao'}</span>
              </div>
              <label className="check-row">
                <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
                强制更新服务器目录未提交改动
              </label>
              <div className="card-actions">
                <button type="button" className="soft-btn" onClick={checkVersion}>检测版本</button>
                <button type="button" className="primary" onClick={runUpdate} disabled={Boolean(version && !version.hasUpdate && !force)}>一键更新</button>
              </div>
            </div>
          </div>
        )}

        {message && <div className="toast inline">{message}</div>}
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
  const items = navItems.filter((item) => ['timeline', 'accounts', 'records'].includes(item.id) || (isAdmin && ['backup', 'settings'].includes(item.id)));
  return (
    <nav className="mobile-tabs">
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
