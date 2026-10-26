import { ArrowDown, ArrowUp, Globe, Link2, Pencil, Pickaxe, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { grouped, serviceSubtitle, StatusDot } from '../../components/Launcher.tsx';
import { ICONS, ServiceIcon } from '../../components/ServiceIcon.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Button, Card, Dialog, Empty, Field, Input, PageTitle, Spinner, Tabs } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { cx } from '../../lib/format.ts';
import type { Service } from '../../lib/types.ts';
import { useFetch } from '../../lib/useFetch.ts';

type Draft = Pick<Service, 'name' | 'kind' | 'url' | 'check_url' | 'category' | 'description' | 'icon' | 'checks'>;
const blank: Draft = { name: '', kind: 'web', url: '', check_url: '', category: '', description: '', icon: 'auto', checks: 1 };

export function Links() {
  const notify = useToast();
  const { data, setData, reload } = useFetch<Service[]>('/services');
  const [editing, setEditing] = useState<{ id?: number; draft: Draft } | null>(null);
  const [deleting, setDeleting] = useState<Service | null>(null);
  const [checking, setChecking] = useState(false);

  // Up/down moves within a category; the stored order is one flat list.
  const move = async (s: Service, dir: -1 | 1) => {
    const list = data!;
    const peers = list.filter((x) => (x.category || 'Apps') === (s.category || 'Apps'));
    const i = peers.indexOf(s);
    const other = peers[i + dir];
    if (!other) return;
    const next = [...list];
    const a = next.indexOf(s);
    const b = next.indexOf(other);
    [next[a], next[b]] = [next[b], next[a]];
    setData(next);
    try {
      await api.post('/services/reorder', { ids: next.map((x) => x.id) });
    } catch (e) {
      notify((e as Error).message, 'error');
      reload();
    }
  };

  const recheck = async () => {
    setChecking(true);
    await Promise.all((data ?? []).filter((s) => s.checks).map((s) => api.post(`/services/${s.id}/check`).catch(() => null)));
    await reload();
    setChecking(false);
  };

  const remove = async () => {
    try {
      await api.del(`/services/${deleting!.id}`);
      notify(`Removed ${deleting!.name}`);
      setDeleting(null);
      reload();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle
        title="Links"
        subtitle="Everything in the side panel. Everyone signed in can see these."
        actions={
          <>
            {data?.some((s) => s.checks) && (
              <Button onClick={recheck} loading={checking}>
                {!checking && <RefreshCw className="size-4" />} Check now
              </Button>
            )}
            <Button variant="primary" onClick={() => setEditing({ draft: blank })}>
              <Plus className="size-4" /> Add link
            </Button>
          </>
        }
      />
      {!data ? (
        <Spinner />
      ) : !data.length ? (
        <Empty icon={<Link2 className="size-5" />} title="No links yet">
          Add Jellyfin, the Crafty panel, each Minecraft server, your router… anything people go looking for.
        </Empty>
      ) : (
        <div className="space-y-6">
          {grouped(data).map(([category, items]) => (
            <section key={category}>
              <h2 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">{category}</h2>
              <Card className="divide-y divide-line">
                {items.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-3 p-3">
                    <ServiceIcon service={s} className="size-9" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{s.name}</span>
                        <StatusDot service={s} />
                      </div>
                      <div className="truncate text-xs text-muted">
                        {s.url}
                        {s.health && !s.health.up && <span className="text-rose-500"> · {s.health.error ?? 'down'}</span>}
                        {s.kind === 'minecraft' && s.health?.up && <span> · {serviceSubtitle(s)}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0">
                      <Button variant="ghost" size="icon" className="hidden size-8 sm:inline-flex" disabled={i === 0} onClick={() => move(s, -1)} aria-label="Move up">
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="hidden size-8 sm:inline-flex" disabled={i === items.length - 1} onClick={() => move(s, 1)} aria-label="Move down">
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing({ id: s.id, draft: { ...s } })} aria-label={`Edit ${s.name}`}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8 hover:text-rose-500" onClick={() => setDeleting(s)} aria-label={`Remove ${s.name}`}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}

      <LinkDialog
        state={editing}
        categories={[...new Set((data ?? []).map((s) => s.category).filter(Boolean))]}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
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
        <p className="text-sm text-muted">It disappears from everyone's side panel. The service itself isn't touched.</p>
      </Dialog>
    </div>
  );
}

function LinkDialog({
  state,
  categories,
  onClose,
  onSaved,
}: {
  state: { id?: number; draft: Draft } | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useToast();
  const [d, setD] = useState<Draft>(blank);
  const [last, setLast] = useState(state);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  if (state !== last) {
    setLast(state);
    setD(state?.draft ?? blank);
    setAdvanced(Boolean(state?.draft.check_url));
  }
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const mc = d.kind === 'minecraft';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (state?.id) await api.put(`/services/${state.id}`, d);
      else await api.post('/services', d);
      notify(state?.id ? 'Link saved' : `${d.name} added to the side panel`);
      onSaved();
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog wide open={Boolean(state)} onClose={onClose} title={state?.id ? 'Edit link' : 'Add link'}>
      <form onSubmit={submit} className="space-y-4">
        <Tabs
          value={d.kind}
          onChange={(kind) => set({ kind, icon: d.icon === 'pickaxe' || d.icon === 'globe' ? 'auto' : d.icon })}
          options={[
            { value: 'web', label: <><Globe className="size-3.5" /> Website</> },
            { value: 'minecraft', label: <><Pickaxe className="size-3.5" /> Minecraft server</> },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input autoFocus value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder={mc ? 'Survival' : 'Jellyfin'} />
          </Field>
          <Field label="Group" hint="Links with the same group sit together">
            <Input value={d.category} onChange={(e) => set({ category: e.target.value })} list="link-categories" placeholder={mc ? 'Minecraft' : 'Media'} />
            <datalist id="link-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field
          label={mc ? 'Server address' : 'Address'}
          hint={mc ? 'What people type in Minecraft, e.g. mc.example.com or 192.168.1.20:25566. Clicking it copies this.' : 'Opens in a new tab'}
        >
          <Input value={d.url} onChange={(e) => set({ url: e.target.value })} placeholder={mc ? 'mc.example.com:25565' : 'https://jellyfin.example.com'} />
        </Field>
        <Field label="Short description" hint="Optional, shown under the name">
          <Input value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder={mc ? 'Modded 1.20.1, ask for whitelist' : 'Movies and shows'} />
        </Field>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">Icon</span>
          <div className="flex flex-wrap gap-1.5">
            <IconChoice active={d.icon === 'auto'} onClick={() => set({ icon: 'auto' })} title={mc ? 'Pickaxe' : "The site's own icon"}>
              <span className="text-[10px] font-semibold">AUTO</span>
            </IconChoice>
            {Object.entries(ICONS).map(([key, Icon]) => (
              <IconChoice key={key} active={d.icon === key} onClick={() => set({ icon: key })} title={key}>
                <Icon className="size-4" />
              </IconChoice>
            ))}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="accent-[var(--accent)]" checked={Boolean(d.checks)} onChange={(e) => set({ checks: e.target.checked ? 1 : 0 })} />
          Show whether it's up{mc ? ' and who is online' : ''}
        </label>
        {Boolean(d.checks) &&
          (advanced ? (
            <Field label="Check this address instead" hint="Useful when the public address goes through a proxy Bellhop can't reach, e.g. http://192.168.1.10:8096">
              <Input value={d.check_url} onChange={(e) => set({ check_url: e.target.value })} placeholder={mc ? '192.168.1.20:25565' : 'http://192.168.1.10:8096'} />
            </Field>
          ) : (
            <button type="button" onClick={() => setAdvanced(true)} className="cursor-pointer text-sm text-accent hover:underline">
              Check a different address
            </button>
          ))}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {state?.id ? 'Save' : 'Add link'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function IconChoice({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cx(
        'grid size-9 cursor-pointer place-items-center rounded-lg border transition-colors',
        active ? 'border-accent bg-accent-soft text-fg' : 'border-line text-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}
