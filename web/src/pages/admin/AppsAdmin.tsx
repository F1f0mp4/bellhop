import { AlertTriangle, ArrowDown, ArrowUp, ArrowLeft, Check, Copy, HardDrive, ListPlus, Loader2, PackageOpen, Pencil, Plus, RefreshCw, Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast.tsx';
import { Button, Card, Dialog, Empty, PageTitle, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { ago, bytes, cx } from '../../lib/format.ts';
import { PLATFORM_INFO } from '../../lib/platform.ts';
import type { AdminApp, AdminDownload, AppsAdminData, Platform } from '../../lib/types.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { AppIcon } from '../apps/parts.tsx';

export function AppsAdmin() {
  const notify = useToast();
  const { data, setData, reload } = useFetch<AppsAdminData>('/apps/admin');
  const [deleting, setDeleting] = useState<AdminApp | null>(null);
  const [starter, setStarter] = useState(false);
  const [copied, setCopied] = useState(false);
  const busy = Boolean(data && (data.checking || data.apps.some((a) => a.checking || a.downloads.some((d) => d.progress))));

  // Release checks and copies run in the background; follow them while they do.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(reload, 2000);
    return () => clearInterval(t);
  }, [busy, reload]);

  const checkAll = async () => {
    await api.post('/apps/check');
    setData((d) => d && { ...d, checking: true });
    setTimeout(reload, 500);
  };

  const move = async (a: AdminApp, dir: -1 | 1) => {
    const list = [...data!.apps];
    const i = list.indexOf(a);
    if (!list[i + dir]) return;
    [list[i], list[i + dir]] = [list[i + dir], list[i]];
    setData({ ...data!, apps: list });
    try {
      await api.post('/apps/reorder', { ids: list.map((x) => x.id) });
    } catch (e) {
      notify((e as Error).message, 'error');
      reload();
    }
  };

  const remove = async () => {
    try {
      await api.del(`/apps/${deleting!.id}`);
      notify(`Removed ${deleting!.name}`);
      setDeleting(null);
      reload();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  const rotate = async () => {
    await api.post('/apps/source/rotate');
    notify('New address made. Phones need to add it again.');
    reload();
  };

  const copySource = async () => {
    await navigator.clipboard.writeText(data!.source).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/apps" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Apps
      </Link>
      <PageTitle
        title="Manage apps"
        subtitle="What everyone sees on the Apps page."
        actions={
          <>
            {Boolean(data?.starter_left) && (
              <Button onClick={() => setStarter(true)}>
                <ListPlus className="size-4" /> Starter list
              </Button>
            )}
            <Button onClick={checkAll} loading={data?.checking}>
              {!data?.checking && <RefreshCw className="size-4" />} Check for updates
            </Button>
            <Link to="/admin/apps/new">
              <Button variant="primary">
                <Plus className="size-4" /> Add app
              </Button>
            </Link>
          </>
        }
      />

      {!data ? (
        <Spinner />
      ) : (
        <>
          <Card className="mb-6 grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="space-y-1 text-sm">
              <p className="flex items-center gap-2">
                <HardDrive className="size-4 text-muted" />
                {bytes(data.stored_bytes) || '0 B'} of installers kept on this server
                {data.checked_at && <span className="text-muted">(updates checked {ago(data.checked_at)})</span>}
              </p>
              {!data.has_github_token && (
                <p className="text-xs text-muted">
                  Checks use GitHub without a token, which allows 60 lookups an hour. Add one in{' '}
                  <Link to="/admin/settings" className="text-accent hover:underline">Settings</Link> if checks run out.
                </p>
              )}
            </div>
            <div className="min-w-0 space-y-1.5 sm:max-w-xs">
              <p className="text-xs text-muted">AltStore and SideStore address</p>
              <div className="flex gap-1.5">
                <code className="min-w-0 flex-1 truncate rounded-md bg-surface-2 px-2 py-1.5 text-xs">{data.source}</code>
                <Button size="icon" variant="ghost" className="size-8" onClick={copySource} aria-label="Copy address">
                  {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                </Button>
                <Button size="icon" variant="ghost" className="size-8" onClick={rotate} aria-label="Make a new address" title="Make a new address (the old one stops working)">
                  <RefreshCw className="size-3.5" />
                </Button>
              </div>
            </div>
          </Card>

          {!data.apps.length ? (
            <Empty icon={<PackageOpen className="size-5" />} title="No apps yet">
              Add one by hand, or pick from the starter list of open source apps.
            </Empty>
          ) : (
            <Card className="divide-y divide-line">
              {data.apps.map((a, i) => (
                <div key={a.id} className="flex items-start gap-3 p-3">
                  <AppIcon app={a} className="mt-0.5 size-11" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link to={`/admin/apps/${a.id}`} className="truncate font-medium hover:underline">
                        {a.name}
                      </Link>
                      {a.featured && <Star className="size-3.5 shrink-0 fill-accent text-accent" aria-label="Featured" />}
                      {a.checking && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted" aria-label="Checking" />}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {[a.category, a.release_tag && `latest ${a.release_tag}`].filter(Boolean).join(', ')}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {a.downloads.map((d) => (
                        <DownloadChip key={d.id} d={d} />
                      ))}
                    </div>
                    {a.check_error && (
                      <p className="mt-1.5 flex items-start gap-1 text-xs text-rose-600 dark:text-rose-300">
                        <AlertTriangle className="mt-px size-3.5 shrink-0" /> {a.check_error}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0">
                    <Button variant="ghost" size="icon" className="hidden size-8 sm:inline-flex" disabled={i === 0} onClick={() => move(a, -1)} aria-label="Move up">
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="hidden size-8 sm:inline-flex" disabled={i === data.apps.length - 1} onClick={() => move(a, 1)} aria-label="Move down">
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Link to={`/admin/apps/${a.id}`}>
                      <Button variant="ghost" size="icon" className="size-8" aria-label={`Edit ${a.name}`}>
                        <Pencil className="size-3.5" />
                      </Button>
                    </Link>
                    <Button variant="ghost" size="icon" className="size-8 hover:text-rose-500" onClick={() => setDeleting(a)} aria-label={`Remove ${a.name}`}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      <StarterDialog
        open={starter}
        onClose={() => setStarter(false)}
        onAdded={() => {
          setStarter(false);
          reload();
        }}
      />
      <Dialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Remove ${deleting?.name}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Keep
            </Button>
            <Button variant="danger" onClick={remove}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">It disappears from the Apps page, and any installers kept on the server for it are deleted.</p>
      </Dialog>
    </div>
  );
}

/** One download at a glance: platform, and whether it's ready, being fetched, or broken. */
function DownloadChip({ d }: { d: AdminDownload }) {
  const label = `${PLATFORM_INFO[d.platform].label}${d.label ? ` ${d.label}` : ''}`;
  let state: string;
  let tone = 'bg-surface-2 text-muted';
  if (d.progress) {
    state = `${Math.round((d.progress.received / Math.max(1, d.progress.total)) * 100)}%`;
    tone = 'bg-accent-soft text-fg';
  } else if (d.error) {
    state = 'problem';
    tone = 'bg-rose-500/10 text-rose-700 dark:text-rose-300';
  } else if (d.stored) {
    state = 'on server';
    tone = 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  } else if (d.source === 'link') {
    state = 'link';
  } else if (d.source === 'upload') {
    state = 'needs a file';
    tone = 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  } else {
    state = d.remote_url ? 'GitHub' : 'not checked';
  }
  return (
    <span title={d.error ?? d.file_name ?? d.url} className={cx('rounded-md px-1.5 py-0.5 text-[11px] whitespace-nowrap', tone)}>
      {label}: {state}
    </span>
  );
}

type StarterItem = { key: string; name: string; subtitle: string; category: string; platforms: Platform[]; added: boolean };

function StarterDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const notify = useToast();
  const { data } = useFetch<StarterItem[]>(open ? '/apps/starter' : null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const left = (data ?? []).filter((a) => !a.added);

  const toggle = (key: string) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };

  const add = async () => {
    setBusy(true);
    try {
      const { added } = await api.post<{ added: number }>('/apps/starter', { keys: [...picked] });
      notify(`Added ${added} ${added === 1 ? 'app' : 'apps'}`);
      setPicked(new Set());
      onAdded();
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      wide
      open={open}
      onClose={onClose}
      title="Starter list"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={add} loading={busy} disabled={!picked.size}>
            Add {picked.size || ''} {picked.size === 1 ? 'app' : 'apps'}
          </Button>
        </>
      }
    >
      <p className="-mt-1 mb-3 text-sm text-muted">Open source apps you removed or haven't added yet.</p>
      {!data ? (
        <Spinner />
      ) : (
        <div className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {left.map((a) => (
            <label key={a.key} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
              <input type="checkbox" className="accent-[var(--accent)]" checked={picked.has(a.key)} onChange={() => toggle(a.key)} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{a.name}</span>
                <span className="block truncate text-xs text-muted">{a.subtitle}</span>
              </span>
              <span className="hidden shrink-0 text-xs text-muted sm:block">{a.platforms.map((p) => PLATFORM_INFO[p].label).join(', ')}</span>
            </label>
          ))}
        </div>
      )}
    </Dialog>
  );
}
