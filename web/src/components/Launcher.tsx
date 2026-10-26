import { BookOpen, ChevronRight, Copy, ExternalLink, Pin, PinOff, Plus, Search, Settings2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth.tsx';
import { ago, cx } from '../lib/format.ts';
import type { Service, WikiSummary } from '../lib/types.ts';
import { useFetch } from '../lib/useFetch.ts';
import { ServiceIcon } from './ServiceIcon.tsx';
import { useToast } from './Toast.tsx';
import { Button, Input } from './ui.tsx';

/** Group links by category, keeping the order they were arranged in. */
export function grouped(services: Service[]) {
  const groups = new Map<string, Service[]>();
  for (const s of services) {
    const key = s.category || 'Apps';
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.entries()];
}

export function StatusDot({ service: s }: { service: Service }) {
  if (!s.checks) return null;
  const h = s.health;
  const tone = !h ? 'bg-zinc-400' : h.up ? 'bg-emerald-500' : 'bg-rose-500';
  const label = !h ? 'Checking…' : h.up ? `Up${h.ms != null ? ` · ${h.ms} ms` : ''}` : `Down · ${h.error ?? 'no answer'}`;
  return (
    <span title={`${label}${h ? ` · checked ${ago(h.checked_at)}` : ''}`} className="relative flex size-2.5 shrink-0">
      {h?.up && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/50 [animation-duration:3s]" />}
      <span className={cx('relative size-2.5 rounded-full', tone)} />
    </span>
  );
}

export function serviceSubtitle(s: Service): string {
  const mc = s.health?.minecraft;
  if (s.kind === 'minecraft') {
    if (mc) return `${mc.players}/${mc.max} online · ${mc.version}`;
    if (s.health && !s.health.up) return 'Offline';
    return s.description || s.url;
  }
  if (s.description) return s.description;
  try {
    return new URL(s.url).host;
  } catch {
    return s.url;
  }
}

export function useCopyAddress() {
  const notify = useToast();
  return async (s: Service) => {
    try {
      await navigator.clipboard.writeText(s.url);
      notify(`Copied ${s.url}. In Minecraft: Multiplayer → Add Server → paste.`);
    } catch {
      notify(`Server address: ${s.url}`);
    }
  };
}

export function Launcher({ open, pinned, onClose, onTogglePin }: { open: boolean; pinned: boolean; onClose: () => void; onTogglePin: () => void }) {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const visible = open || pinned;
  const { data: services, reload } = useFetch<Service[]>('/services');
  const { data: pages } = useFetch<WikiSummary[]>(visible ? '/wiki' : null);
  const [query, setQuery] = useState('');
  const copy = useCopyAddress();

  // Fresh status while the panel is on screen; the server re-checks every minute.
  useEffect(() => {
    if (!visible) return;
    reload();
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [visible, reload]);

  useEffect(() => {
    if (!open || pinned) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pinned, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (services ?? []).filter((s) => !q || `${s.name} ${s.category} ${s.description} ${s.url}`.toLowerCase().includes(q));
  }, [services, query]);

  const closeIfFloating = () => !pinned && onClose();
  const upCount = (services ?? []).filter((s) => s.checks && s.health?.up).length;
  const checked = (services ?? []).filter((s) => s.checks).length;

  return (
    <>
      {open && (
        <div
          className={cx('fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] lg:bg-black/20', pinned && 'lg:hidden')}
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        aria-label="Links and wiki"
        className={cx(
          'fixed inset-y-0 left-0 z-50 flex w-[min(20rem,88vw)] flex-col border-r border-line bg-surface transition-transform duration-200',
          pinned ? 'lg:z-20 lg:w-72' : 'shadow-2xl',
          visible ? 'translate-x-0' : '-translate-x-full',
          pinned && !open && 'max-lg:-translate-x-full',
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
          <span className="font-medium">Everything</span>
          {checked > 0 && (
            <span className="text-xs text-muted">
              {upCount}/{checked} up
            </span>
          )}
          <div className="ml-auto flex">
            <Button variant="ghost" size="icon" className="hidden lg:inline-flex" onClick={onTogglePin} title={pinned ? 'Unpin panel' : 'Keep panel open'} aria-label={pinned ? 'Unpin panel' : 'Pin panel'}>
              {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            </Button>
            <Button variant="ghost" size="icon" className={cx(pinned && 'lg:hidden')} onClick={onClose} aria-label="Close panel">
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {(services?.length ?? 0) > 6 && (
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
              <Input className="h-8 pl-8 text-sm" placeholder="Find…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}

          {services && !services.length && (
            <div className="mx-1 mb-4 rounded-xl border border-dashed border-line p-4 text-sm text-muted">
              {admin ? (
                <>
                  Add Jellyfin, your Minecraft servers and anything else people should find here.
                  <Link to="/admin/links" onClick={closeIfFloating} className="mt-3 flex items-center gap-1.5 font-medium text-accent">
                    <Plus className="size-4" /> Add a link
                  </Link>
                </>
              ) : (
                'No links yet.'
              )}
            </div>
          )}

          {grouped(filtered).map(([category, items]) => (
            <section key={category} className="mb-4">
              <h3 className="mb-1 px-2 text-[11px] font-semibold tracking-wider text-muted uppercase">{category}</h3>
              <ul className="space-y-0.5">
                {items.map((s) => (
                  <li key={s.id}>
                    <ServiceRow service={s} onCopy={() => copy(s)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section className="mb-2">
            <div className="mb-1 flex items-center px-2">
              <h3 className="text-[11px] font-semibold tracking-wider text-muted uppercase">Wiki</h3>
              {admin && (
                <Link to="/wiki/new" onClick={closeIfFloating} className="ml-auto text-muted hover:text-accent" title="New page" aria-label="New wiki page">
                  <Plus className="size-3.5" />
                </Link>
              )}
            </div>
            <ul className="space-y-0.5">
              {pages?.slice(0, 8).map((p) => (
                <li key={p.slug}>
                  <NavLink
                    to={`/wiki/${p.slug}`}
                    onClick={closeIfFloating}
                    className={({ isActive }) =>
                      cx('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2', isActive && 'bg-surface-2 font-medium')
                    }
                  >
                    <BookOpen className="size-3.5 shrink-0 text-muted" />
                    <span className="truncate">{p.title}</span>
                  </NavLink>
                </li>
              ))}
              <li>
                <Link to="/wiki" onClick={closeIfFloating} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted hover:text-fg">
                  {pages?.length ? `All pages (${pages.length})` : 'Open the wiki'} <ChevronRight className="size-3.5" />
                </Link>
              </li>
            </ul>
          </section>
        </div>

        {admin && (
          <div className="border-t border-line p-2">
            <Link
              to="/admin/links"
              onClick={closeIfFloating}
              className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg"
            >
              <Settings2 className="size-4" /> Manage links
            </Link>
          </div>
        )}
      </aside>
    </>
  );
}

function ServiceRow({ service: s, onCopy }: { service: Service; onCopy: () => void }) {
  const inner = (
    <>
      <ServiceIcon service={s} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{s.name}</span>
        <span className="block truncate text-xs text-muted">{serviceSubtitle(s)}</span>
      </span>
      <StatusDot service={s} />
      {s.kind === 'minecraft' ? (
        <Copy className="size-3.5 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" />
      ) : (
        <ExternalLink className="size-3.5 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" />
      )}
    </>
  );
  const cls = 'group flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2';
  if (s.kind === 'minecraft') {
    return (
      <button onClick={onCopy} className={cls} title={s.health?.minecraft?.motd || `Copy ${s.url}`}>
        {inner}
      </button>
    );
  }
  return (
    <a href={s.url} target="_blank" rel="noopener noreferrer" className={cls}>
      {inner}
    </a>
  );
}
