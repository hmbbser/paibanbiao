import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Archive,
  CalendarDays,
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
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import './styles.css';

type Role = 'admin' | 'user';
type User = { id: string; username: string; role: Role; enabled: boolean; created_at: string };
type AppSettings = { siteName: string; timezone: string; defaultView: string; exportVersion?: string };
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

const defaultSettings: AppSettings = { siteName: '甜排班', timezone: 'Asia/Shanghai', defaultView: 'day' };

const statusText: Record<BookingStatus, string> = {
  reserved: '预约',
  active: '出租中',
  completed: '已结束',
  ended_early: '提前结束',
  cancelled: '已取消'
};

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
  { id: 'audit', label: '审计', icon: ShieldCheck, admin: true },
  { id: 'backup', label: '备份', icon: DatabaseBackup, admin: true },
  { id: 'settings', label: '设置', icon: Settings }
];

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
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
  return <Dashboard user={user} settings={settings} onSettings={setSettings} onLogout={() => setUser(null)} />;
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
  onSettings,
  onLogout
}: {
  user: User;
  settings: AppSettings;
  onSettings: (settings: AppSettings) => void;
  onLogout: () => void;
}) {
  const [active, setActive] = useState('timeline');
  const [overview, setOverview] = useState<Overview>({ accounts: [], users: [], bookings: [] });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Booking | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    const data = await api<Overview>('/api/overview');
    setOverview(data);
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    onLogout();
  }

  const visibleNav = navItems.filter((item) => !item.admin || user.role === 'admin');
  const filteredBookings = overview.bookings.filter((booking) => {
    const text = `${booking.account_name} ${booking.renter_name} ${booking.renter_contact} ${booking.operator_name}`.toLowerCase();
    return text.includes(query.toLowerCase());
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
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button className="icon-btn mobile-menu"><Menu size={18} /></button>
          <div className="searchbox">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索账号、租客、手机号" />
          </div>
          <input className="date-input" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
          {user.role === 'admin' && (
            <button className="soft-btn" onClick={() => window.location.assign('/api/admin/export')}>
              <Download size={16} />
              导出
            </button>
          )}
          <button className="primary" onClick={() => { setEditing(null); setDrawerOpen(true); }}>
            <Plus size={16} />
            新建出租
          </button>
          <div className="user-pill">{user.role === 'admin' ? '管理员' : '普通用户'} · {user.username}</div>
          <button className="icon-btn" onClick={logout}><LogOut size={17} /></button>
        </header>

        <section className="content">
          {error && <div className="toast">{error}<button onClick={() => setError('')}><X size={14} /></button></div>}
          {active === 'timeline' && (
            <Timeline
              user={user}
              accounts={overview.accounts}
              bookings={filteredBookings}
              onEdit={(booking) => { setEditing(booking); setDrawerOpen(true); }}
            />
          )}
          {active === 'accounts' && <AccountsPanel user={user} accounts={overview.accounts} refresh={refresh} />}
          {active === 'users' && user.role === 'admin' && <UsersPanel users={overview.users} refresh={refresh} />}
          {active === 'records' && <RecordsPanel user={user} bookings={filteredBookings} refresh={refresh} onEdit={(booking) => { setEditing(booking); setDrawerOpen(true); }} />}
          {active === 'audit' && user.role === 'admin' && <AuditPanel />}
          {active === 'backup' && user.role === 'admin' && <BackupPanel />}
          {active === 'settings' && <SettingsPanel user={user} settings={settings} onSettings={onSettings} />}
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
    </div>
  );
}

function Timeline({ user, accounts, bookings, onEdit }: { user: User; accounts: Account[]; bookings: Booking[]; onEdit: (booking: Booking) => void }) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
  const end = new Date(start);
  end.setHours(24);
  const activeBookings = bookings.filter((booking) => booking.status !== 'cancelled');
  const metrics = {
    today: activeBookings.length,
    expiring: activeBookings.filter((booking) => new Date(booking.ends_at).getTime() - Date.now() < 1000 * 60 * 60 * 2 && new Date(booking.ends_at) > new Date()).length,
    conflicts: 0,
    available: accounts.length
  };

  return (
    <div className="timeline-view">
      <div className="metrics">
        <Metric label="今日出租" value={metrics.today} tone="mint" />
        <Metric label="即将到期" value={metrics.expiring} tone="amber" />
        <Metric label="预约冲突" value={metrics.conflicts} tone="coral" />
        <Metric label="可用账号" value={metrics.available} tone="sky" />
      </div>

      <div className="scheduler">
        <div className="time-head account-head">账号小窝</div>
        {Array.from({ length: 24 }, (_, index) => (
          <div className="time-head" key={index}>{String(index).padStart(2, '0')}:00</div>
        ))}
        {accounts.map((account) => {
          const rowBookings = activeBookings.filter((booking) => booking.account_id === account.id);
          return (
            <React.Fragment key={account.id}>
              <div className="account-cell">
                <strong>{account.name}</strong>
                <span>{account.login} / {account.password}</span>
                <small>{account.remark || '暂无备注，可安心排班'}</small>
              </div>
              <div className="timeline-row">
                {Array.from({ length: 24 }, (_, index) => <span className="hour-cell" key={index} />)}
                {rowBookings.length === 0 && <div className="empty-slot"><Sparkles size={14} /> 今天还很空，可以安排啦</div>}
                {rowBookings.map((booking) => {
                  const left = percentBetween(new Date(booking.starts_at), start, end);
                  const right = percentBetween(new Date(booking.ends_at), start, end);
                  return (
                    <button
                      className={`booking-bar ${booking.status}`}
                      key={booking.id}
                      style={{ left: `${left}%`, width: `${Math.max(right - left, 4)}%` }}
                      onClick={() => (user.role === 'admin' || booking.operator_id === user.id) && onEdit(booking)}
                    >
                      <strong>{booking.renter_name}</strong>
                      <span>{booking.renter_contact} · {statusText[booking.status]}</span>
                    </button>
                  );
                })}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      <div className="mobile-schedule">
        {accounts.map((account) => (
          <article className="account-card" key={account.id}>
            <div>
              <h3>{account.name}</h3>
              <p>{account.login} / {account.password}</p>
              <small>{account.remark || '暂无备注'}</small>
            </div>
            {activeBookings.filter((booking) => booking.account_id === account.id).map((booking) => (
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

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`metric ${tone}`}>
      <Sparkles size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
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
  const firstAccount = accounts[0]?.id || '';
  const [form, setForm] = useState({
    account_id: booking?.account_id || firstAccount,
    renter_name: booking?.renter_name || '',
    renter_contact: booking?.renter_contact || '',
    starts_at: toLocalInput(booking?.starts_at || new Date().toISOString()),
    ends_at: toLocalInput(booking?.ends_at || addHours(new Date(), 1).toISOString()),
    status: booking?.status || 'reserved',
    remark: booking?.remark || '',
    override: false
  });
  const [conflict, setConflict] = useState('');

  function setDuration(hours: number) {
    setForm({ ...form, ends_at: toLocalInput(addHours(new Date(form.starts_at), hours).toISOString()) });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setConflict('');
    try {
      const payload = { ...form, starts_at: new Date(form.starts_at).toISOString(), ends_at: new Date(form.ends_at).toISOString() };
      await api(booking ? `/api/bookings/${booking.id}` : '/api/bookings', {
        method: booking ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      onSaved();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('预约')) setConflict(msg);
      onError(msg);
    }
  }

  async function action(name: 'endEarly' | 'renew' | 'cancel') {
    if (!booking) return;
    try {
      await api(`/api/bookings/${booking.id}/action`, {
        method: 'PATCH',
        body: JSON.stringify({ action: name, ends_at: new Date(form.ends_at).toISOString(), override: form.override })
      });
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <div>
          <span>出租小表单</span>
          <h2>{booking ? '编辑出租' : '新建出租'}</h2>
        </div>
        <button className="icon-btn" onClick={onClose}><X size={18} /></button>
      </div>
      <form className="stack" onSubmit={save}>
        <label>
          <span>账号</span>
          <select value={form.account_id} onChange={(event) => setForm({ ...form, account_id: event.target.value })}>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
        <Field label="租客姓名" value={form.renter_name} onChange={(renter_name) => setForm({ ...form, renter_name })} />
        <Field label="联系方式" value={form.renter_contact} onChange={(renter_contact) => setForm({ ...form, renter_contact })} />
        <label>
          <span>开始时间</span>
          <input type="datetime-local" value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} />
        </label>
        <label>
          <span>结束时间</span>
          <input type="datetime-local" value={form.ends_at} onChange={(event) => setForm({ ...form, ends_at: event.target.value })} />
        </label>
        <div className="duration-grid">
          {[1, 3, 6, 9, 12, 24].map((hour) => <button type="button" key={hour} onClick={() => setDuration(hour)}>{hour}h</button>)}
        </div>
        <label>
          <span>状态</span>
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as BookingStatus })}>
            {Object.entries(statusText).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>备注</span>
          <textarea value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
        </label>
        {user.role === 'admin' && (
          <label className="check-row">
            <input type="checkbox" checked={form.override} onChange={(event) => setForm({ ...form, override: event.target.checked })} />
            管理员覆盖冲突
          </label>
        )}
        {conflict && <div className="conflict">{conflict}</div>}
        <button className="primary large">保存预约</button>
        {booking && (
          <div className="drawer-actions">
            <button type="button" className="soft-btn" onClick={() => action('renew')}>续租</button>
            <button type="button" className="soft-btn" onClick={() => action('endEarly')}>提前结束</button>
            <button type="button" className="danger-btn" onClick={() => action('cancel')}>取消</button>
          </div>
        )}
      </form>
    </aside>
  );
}

function AccountsPanel({ user, accounts, refresh }: { user: User; accounts: Account[]; refresh: () => void }) {
  const [modal, setModal] = useState<Account | 'new' | null>(null);
  return (
    <Panel
      title="账号管理"
      subtitle="管理可出租账号、密码和备注信息"
      action={user.role === 'admin' && <button className="primary" onClick={() => setModal('new')}><Plus size={16} />添加账号</button>}
    >
      <div className="admin-toolbar">
        <div className="searchbox table-search">
          <Search size={16} />
          <input placeholder="搜索账号..." />
        </div>
        <button className="soft-btn" onClick={refresh}><RefreshCw size={16} />刷新</button>
      </div>
      <div className="admin-table">
        <div className="admin-table-head account-table">
          <span>名称</span>
          <span>账号</span>
          <span>密码</span>
          <span>状态</span>
          <span>备注</span>
          <span>创建时间</span>
          {user.role === 'admin' && <span>操作</span>}
        </div>
        {accounts.map((account) => (
          <div className="admin-table-row account-table" key={account.id}>
            <strong>{account.name}</strong>
            <span>{account.login}</span>
            <code>{account.password}</code>
            <span className={`status-pill ${account.status === 'active' ? 'ok' : 'muted'}`}>{account.status === 'active' ? '正常' : '停用'}</span>
            <span>{account.remark || '-'}</span>
            <span>{formatDateTime(account.created_at)}</span>
            {user.role === 'admin' && (
              <div className="row-actions">
                <button className="ghost-action" onClick={() => setModal(account)}>编辑</button>
                <DeleteButton url={`/api/accounts/${account.id}`} refresh={refresh} />
              </div>
            )}
          </div>
        ))}
        {accounts.length === 0 && <div className="empty-table">还没有账号，点击右上角“添加账号”开始。</div>}
      </div>
      {modal && <AccountModal account={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
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
  return (
    <Panel
      title="用户管理"
      subtitle="创建登录用户并控制角色和启用状态"
      action={<button className="primary" onClick={() => setModal('new')}><UserPlus size={16} />添加用户</button>}
    >
      <div className="admin-toolbar">
        <div className="searchbox table-search">
          <Search size={16} />
          <input placeholder="搜索用户..." />
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
        {users.map((item) => (
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
        {users.length === 0 && <div className="empty-table">还没有用户。</div>}
      </div>
      {modal && <UserModal user={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
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

function AccountModal({ account, onClose, onSaved }: { account: Account | null; onClose: () => void; onSaved: () => void }) {
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
      onSaved();
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

function UserModal({ user, onClose, onSaved }: { user: User | null; onClose: () => void; onSaved: () => void }) {
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
      onSaved();
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

function RecordsPanel({ user, bookings, refresh, onEdit }: { user: User; bookings: Booking[]; refresh: () => void; onEdit: (booking: Booking) => void }) {
  return (
    <Panel title="出租记录">
      <div className="table-list">
        {bookings.map((booking) => (
          <div className="table-row record" key={booking.id}>
            <span>{booking.account_name}</span>
            <strong>{booking.renter_name}</strong>
            <span>{booking.renter_contact}</span>
            <span>{formatTime(booking.starts_at)} - {formatTime(booking.ends_at)}</span>
            <span className={`tag ${booking.status}`}>{statusText[booking.status]}</span>
            {(user.role === 'admin' || booking.operator_id === user.id) && <button className="soft-btn" onClick={() => onEdit(booking)}>编辑</button>}
            {(user.role === 'admin' || booking.operator_id === user.id) && <DeleteButton url={`/api/bookings/${booking.id}`} refresh={refresh} />}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AuditPanel() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  useEffect(() => {
    api<AuditLog[]>('/api/audit-logs').then(setLogs);
  }, []);
  return (
    <Panel title="审计日志">
      <div className="table-list">
        {logs.map((log) => (
          <div className="table-row" key={log.id}>
            <span>{formatTime(log.created_at)}</span>
            <strong>{log.actor_name || '系统'}</strong>
            <span>{log.action}</span>
            <span>{log.summary}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function BackupPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');

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
          <p>导出系统设置、用户、账号、出租记录和审计日志，可迁移到其他服务器。</p>
          <button className="primary" onClick={() => window.location.assign('/api/admin/export')}>下载备份包</button>
        </article>
        <article className="data-card">
          <Upload />
          <h3>完整导入恢复</h3>
          <p>导入前会自动生成恢复点，导入成功后需要重新登录。</p>
          <input type="file" accept=".zip" onChange={(event) => setFile(event.target.files?.[0] || null)} />
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

function DeleteButton({ url, refresh }: { url: string; refresh: () => void }) {
  async function remove() {
    if (!confirm('确认删除吗？')) return;
    await api(url, { method: 'DELETE' });
    refresh();
  }
  return <button className="icon-btn danger" onClick={remove}><Trash2 size={15} /></button>;
}

function MobileTabs({ active, setActive, isAdmin }: { active: string; setActive: (id: string) => void; isAdmin: boolean }) {
  const items = navItems.filter((item) => ['timeline', 'accounts', 'records', 'settings'].includes(item.id) || (isAdmin && item.id === 'backup'));
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

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label>
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function toLocalInput(value: string) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
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
