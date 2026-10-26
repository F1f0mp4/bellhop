import { ConciergeBell, KeyRound, LayoutGrid, LogOut, Moon, Sun } from 'lucide-react';
import { Suspense, useState, type FormEvent } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { cx } from '../lib/format.ts';
import { Launcher } from './Launcher.tsx';
import { useToast } from './Toast.tsx';
import { Button, Dialog, Field, Input, Spinner } from './ui.tsx';

const userLinks = [
  { to: '/new', label: 'New request' },
  { to: '/requests', label: 'My requests' },
  { to: '/wiki', label: 'Wiki' },
];

const adminLinks = [
  { to: '/admin', label: 'Board', end: true },
  { to: '/admin/media', label: 'Media' },
  { to: '/wiki', label: 'Wiki' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/settings', label: 'Settings' },
];

const PIN_KEY = 'bellhop-panel-pinned';

function usePanel() {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(() => {
    try {
      return localStorage.getItem(PIN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const togglePin = () => {
    const next = !pinned;
    try {
      localStorage.setItem(PIN_KEY, next ? '1' : '0');
    } catch {}
    setPinned(next);
    setOpen(false);
  };
  return { open, pinned, toggle: () => setOpen((o) => !o), close: () => setOpen(false), togglePin };
}

function useTheme() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'dark');
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('bellhop-theme', next);
    } catch {}
    setTheme(next);
  };
  return { theme, toggle };
}

export function Brand({ large }: { large?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cx('grid place-items-center rounded-lg bg-accent text-accent-fg', large ? 'size-10' : 'size-7')}>
        <ConciergeBell className={large ? 'size-5' : 'size-4'} />
      </span>
      <span className={cx('font-display tracking-tight', large ? 'text-4xl' : 'text-2xl')}>Bellhop</span>
    </span>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [pwOpen, setPwOpen] = useState(false);
  const panel = usePanel();
  const links = user?.role === 'admin' ? adminLinks : userLinks;

  return (
    <div className={cx('min-h-dvh', panel.pinned && 'lg:pl-72')}>
      <Launcher open={panel.open} pinned={panel.pinned} onClose={panel.close} onTogglePin={panel.togglePin} />
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Button
            variant="ghost"
            size="icon"
            className={cx('-ml-2', panel.pinned && 'lg:hidden')}
            onClick={panel.toggle}
            aria-label="Links and wiki"
            title="Links and wiki"
          >
            <LayoutGrid className="size-4.5" />
          </Button>
          <NavLink to={user?.role === 'admin' ? '/admin' : '/new'} aria-label="Bellhop home">
            <Brand />
          </NavLink>
          <nav className={cx('ml-2 hidden items-center gap-1', panel.pinned ? 'md:flex lg:hidden xl:flex' : 'md:flex')}>
            {links.map((l) => (
              <NavItem key={l.to} {...l} />
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-2 hidden text-sm text-muted sm:inline">{user?.username}</span>
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Switch theme" title="Switch theme">
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setPwOpen(true)} aria-label="Change password" title="Change password">
              <KeyRound className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={logout} aria-label="Sign out" title="Sign out">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
        <nav className={cx('flex gap-1 overflow-x-auto px-3 pb-2', panel.pinned ? 'md:hidden lg:flex xl:hidden' : 'md:hidden')}>
          {links.map((l) => (
            <NavItem key={l.to} {...l} />
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>
      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function NavItem({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          'shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors',
          isActive ? 'bg-surface-2 font-medium text-fg' : 'text-muted hover:text-fg',
        )
      }
    >
      {label}
    </NavLink>
  );
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const notify = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/password', { current, next });
      notify('Password changed');
      setCurrent('');
      setNext('');
      onClose();
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Change password">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 6 characters">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
