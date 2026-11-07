import { AlertTriangle, ArrowLeft, Check, ImageUp, Loader2, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../components/Toast.tsx';
import { Button, Card, Field, Input, PageTitle, Select, Spinner, Tabs, Textarea } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { bytes, cx } from '../../lib/format.ts';
import { PLATFORM_INFO, PLATFORMS } from '../../lib/platform.ts';
import type { AdminApp, AdminDownload, AppsAdminData, Platform } from '../../lib/types.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { AppIcon } from '../apps/parts.tsx';

type DownloadDraft = {
  key: string;
  id?: number;
  platform: Platform;
  label: string;
  source: 'link' | 'release' | 'upload';
  url: string;
  asset: string;
  keep: boolean;
  file?: File; // picked for upload, sent after saving
};

type Draft = {
  name: string;
  developer: string;
  subtitle: string;
  description: string;
  category: string;
  repo: string;
  homepage: string;
  license: string;
  icon_url: string;
  tint: string;
  featured: boolean;
  downloads: DownloadDraft[];
};

type Lookup = { repo: string; name: string; description: string; homepage: string; license: string; release: { tag: string; assets: { name: string; size: number }[] } | null };

const blank: Draft = { name: '', developer: '', subtitle: '', description: '', category: '', repo: '', homepage: '', license: '', icon_url: '', tint: '', featured: false, downloads: [] };

let keySeq = 0;
const newKey = () => `d${++keySeq}`;

const toDraft = (a: AdminApp): Draft => ({
  name: a.name,
  developer: a.developer,
  subtitle: a.subtitle,
  description: a.description,
  category: a.category,
  repo: a.repo,
  homepage: a.homepage,
  license: a.license,
  icon_url: a.icon_url,
  tint: a.tint,
  featured: a.featured,
  downloads: a.downloads.map((d) => ({ key: newKey(), id: d.id, platform: d.platform, label: d.label, source: d.source, url: d.url, asset: d.asset, keep: d.keep })),
});

/** Sends a big file with progress. fetch can't report upload progress, XMLHttpRequest can. */
function uploadWithProgress<T>(url: string, file: File, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${url}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: any = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('The upload was cut off. Check the connection and try again.'));
    xhr.send(file);
  });
}

export function AppEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const notify = useToast();
  // The admin list has everything, including categories for the suggestions and live status.
  const { data, reload } = useFetch<AppsAdminData>('/apps/admin');
  const app = isNew ? undefined : data?.apps.find((a) => a.id === Number(id));
  const [draft, setDraft] = useState<Draft | null>(isNew ? blank : null);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const [iconFile, setIconFile] = useState<File | null>(null);
  const iconInput = useRef<HTMLInputElement>(null);
  const pickedIcon = useMemo(() => (iconFile ? URL.createObjectURL(iconFile) : null), [iconFile]);

  useEffect(() => {
    if (!draft && app) setDraft(toDraft(app));
  }, [app, draft]);

  const live = Boolean(app && (app.checking || app.downloads.some((d) => d.progress)));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(reload, 2000);
    return () => clearInterval(t);
  }, [live, reload]);

  if (!data) return <Spinner />;
  if (!isNew && !app) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-muted">That app is gone. <Link to="/admin/apps" className="text-accent hover:underline">Back to apps</Link></p>
      </div>
    );
  }
  if (!draft) return <Spinner />;

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setDownload = (key: string, patch: Partial<DownloadDraft>) =>
    set({ downloads: draft.downloads.map((d) => (d.key === key ? { ...d, ...patch } : d)) });
  const categories = [...new Set(data.apps.map((a) => a.category).filter(Boolean))];

  const fill = async () => {
    setLooking(true);
    try {
      const info = await api.get<Lookup>(`/apps/lookup?repo=${encodeURIComponent(draft.repo)}`);
      setLookup(info);
      // Only fill what's empty; never overwrite what the admin typed.
      setDraft((d) =>
        d && {
          ...d,
          repo: info.repo,
          name: d.name || info.name,
          subtitle: d.subtitle || (info.description.length <= 80 ? info.description : ''),
          description: d.description || info.description,
          homepage: d.homepage || info.homepage,
          license: d.license || info.license,
          developer: d.developer || info.repo.split('/')[0],
        },
      );
      notify(info.release ? `Found ${info.release.tag} with ${info.release.assets.length} files` : 'Found the repo; it has no release yet');
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setLooking(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...draft, downloads: draft.downloads.map(({ key: _k, file: _f, ...d }) => d) };
      let saved = isNew ? await api.post<AdminApp>('/apps', body) : await api.put<AdminApp>(`/apps/${id}`, body);
      // The server returns downloads in the order sent, so files line up with their new ids.
      for (const [i, d] of draft.downloads.entries()) {
        if (d.source !== 'upload' || !d.file) continue;
        const target = saved.downloads[i];
        setUploads((u) => ({ ...u, [d.key]: 0 }));
        saved = await uploadWithProgress<AdminApp>(`/apps/downloads/${target.id}/file?name=${encodeURIComponent(d.file.name)}`, d.file, (f) =>
          setUploads((u) => ({ ...u, [d.key]: f })),
        );
        setUploads((u) => {
          const { [d.key]: _, ...rest } = u;
          return rest;
        });
      }
      if (iconFile) saved = await api.upload<AdminApp>(`/apps/${saved.id}/icon`, iconFile);
      notify(isNew ? `${saved.name} added` : 'Saved');
      setIconFile(null);
      if (isNew) navigate(`/admin/apps/${saved.id}`, { replace: true });
      setDraft(toDraft(saved));
      reload();
    } catch (err) {
      notify((err as Error).message, 'error');
      setUploads({});
    } finally {
      setSaving(false);
    }
  };

  const recheck = async () => {
    await api.post(`/apps/${id}/check`);
    setTimeout(reload, 400);
  };

  const iconPreview = pickedIcon ?? app?.icon ?? null;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/admin/apps" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Manage apps
      </Link>
      <PageTitle
        title={isNew ? 'Add app' : draft.name || 'Edit app'}
        actions={
          app && (
            <>
              <Link to={`/apps/${app.slug}`}>
                <Button variant="ghost">View page</Button>
              </Link>
              {draft.repo && (
                <Button onClick={recheck} loading={app.checking}>
                  {!app.checking && <RefreshCw className="size-4" />} Check for updates
                </Button>
              )}
            </>
          )
        }
      />
      {app?.check_error && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {app.check_error}
        </p>
      )}

      <form onSubmit={save} className="space-y-6">
        <Section title="GitHub" text="Optional. With the repo, Bellhop fills in the details and keeps release downloads on the latest version.">
          <div className="flex gap-2">
            <Input value={draft.repo} onChange={(e) => set({ repo: e.target.value })} placeholder="localsend/localsend or a github.com link" />
            <Button type="button" onClick={fill} loading={looking} disabled={!draft.repo.trim()}>
              Fill in
            </Button>
          </div>
        </Section>

        <Section title="Details">
          <div className="flex items-start gap-4">
            <div className="space-y-2">
              <AppIcon app={{ name: draft.name || '?', icon: iconPreview, tint: draft.tint }} className="size-20" />
              <input
                ref={iconInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => setIconFile(e.target.files?.[0] ?? null)}
              />
              <Button type="button" size="sm" variant="ghost" className="w-20 px-0" onClick={() => iconInput.current?.click()}>
                <ImageUp className="size-3.5" /> Icon
              </Button>
            </div>
            <div className="grid flex-1 gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="LocalSend" required />
              </Field>
              <Field label="Made by">
                <Input value={draft.developer} onChange={(e) => set({ developer: e.target.value })} placeholder="LocalSend" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="One-line description" hint="Shown under the name in the list">
                  <Input value={draft.subtitle} onChange={(e) => set({ subtitle: e.target.value })} placeholder="AirDrop for every device" maxLength={80} />
                </Field>
              </div>
            </div>
          </div>
          <Field label="About" hint="A blank line starts a new paragraph">
            <Textarea value={draft.description} onChange={(e) => set({ description: e.target.value })} rows={4} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Category">
              <Input value={draft.category} onChange={(e) => set({ category: e.target.value })} list="app-categories" placeholder="Utilities" />
              <datalist id="app-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Licence">
              <Input value={draft.license} onChange={(e) => set({ license: e.target.value })} placeholder="GPL-3.0" />
            </Field>
            <Field label="Colour" hint="For the featured card">
              <div className="flex gap-2">
                <input
                  type="color"
                  value={draft.tint || '#a96f12'}
                  onChange={(e) => set({ tint: e.target.value })}
                  className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-surface p-1"
                  aria-label="Pick a colour"
                />
                <Input value={draft.tint} onChange={(e) => set({ tint: e.target.value })} placeholder="#16857a" />
              </div>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Website">
              <Input value={draft.homepage} onChange={(e) => set({ homepage: e.target.value })} placeholder="https://localsend.org" />
            </Field>
            <Field label="Icon link" hint="Leave empty to find one from the App Store, the website or GitHub">
              <Input value={draft.icon_url} onChange={(e) => set({ icon_url: e.target.value })} placeholder="https://… or an App Store link" />
            </Field>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="accent-[var(--accent)]" checked={draft.featured} onChange={(e) => set({ featured: e.target.checked })} />
            Feature it at the top of the Apps page
          </label>
        </Section>

        <Section title="Downloads" text="One row per way to get the app. People see the ones for their device first.">
          <datalist id="release-assets">
            {lookup?.release?.assets.map((a) => (
              <option key={a.name} value={a.name}>
                {bytes(a.size)}
              </option>
            ))}
          </datalist>
          {draft.downloads.map((d) => (
            <DownloadEditor
              key={d.key}
              d={d}
              status={app?.downloads.find((x) => x.id === d.id)}
              uploading={uploads[d.key]}
              hasRepo={Boolean(draft.repo.trim())}
              onChange={(patch) => setDownload(d.key, patch)}
              onRemove={() => set({ downloads: draft.downloads.filter((x) => x.key !== d.key) })}
            />
          ))}
          <Button
            type="button"
            onClick={() =>
              set({
                downloads: [
                  ...draft.downloads,
                  { key: newKey(), platform: 'macos', label: '', source: draft.repo ? 'release' : 'link', url: '', asset: '', keep: false },
                ],
              })
            }
          >
            <Plus className="size-4" /> Add download
          </Button>
        </Section>

        <div className="flex justify-end gap-2">
          <Link to="/admin/apps">
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          <Button type="submit" variant="primary" loading={saving}>
            {isNew ? 'Add app' : 'Save'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {text && <p className="mt-1 text-sm text-muted">{text}</p>}
      </div>
      {children}
    </Card>
  );
}

function DownloadEditor({
  d,
  status,
  uploading,
  hasRepo,
  onChange,
  onRemove,
}: {
  d: DownloadDraft;
  status?: AdminDownload;
  uploading?: number;
  hasRepo: boolean;
  onChange: (patch: Partial<DownloadDraft>) => void;
  onRemove: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  // Saved status only describes this row if its source hasn't been changed since.
  const s = status && status.source === d.source && status.asset === d.asset ? status : undefined;
  const ios = d.platform === 'ios';

  return (
    <div className="space-y-3 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={d.platform} onChange={(e) => onChange({ platform: e.target.value as Platform })} className="w-auto" aria-label="Platform">
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_INFO[p].label}
            </option>
          ))}
        </Select>
        <Input value={d.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="Label, e.g. Apple silicon" className="w-44 flex-1" aria-label="Label" />
        <Button type="button" variant="ghost" size="icon" className="hover:text-rose-500" onClick={onRemove} aria-label="Remove download">
          <Trash2 className="size-4" />
        </Button>
      </div>
      <Tabs
        value={d.source}
        onChange={(source) => onChange({ source })}
        options={[
          { value: 'link', label: 'Link' },
          { value: 'release', label: 'GitHub release' },
          { value: 'upload', label: 'Upload' },
        ]}
      />
      {d.source === 'link' && (
        <Input value={d.url} onChange={(e) => onChange({ url: e.target.value })} placeholder={ios ? 'https://apps.apple.com/app/…' : 'https://…'} aria-label="Link" />
      )}
      {d.source === 'release' && (
        <div className="space-y-2">
          <Input
            value={d.asset}
            onChange={(e) => onChange({ asset: e.target.value })}
            placeholder={ios ? '*.ipa' : 'e.g. *-arm64.dmg'}
            list="release-assets"
            aria-label="Release file"
          />
          <p className="text-xs text-muted">
            The file from the latest release with this name. Use * for the version number, e.g. <code>LocalSend-*.dmg</code>.
            {!hasRepo && <span className="text-rose-600 dark:text-rose-300"> Needs the GitHub repo above.</span>}
          </p>
          {ios ? (
            <p className="text-xs text-muted">iPhone apps are always kept on this server so SideStore and AltStore can install them.</p>
          ) : (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="accent-[var(--accent)]" checked={d.keep} onChange={(e) => onChange({ keep: e.target.checked })} />
              Keep a copy on this server, so downloads stay in the house
            </label>
          )}
        </div>
      )}
      {d.source === 'upload' && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept={ios ? '.ipa' : undefined}
            className="hidden"
            onChange={(e) => onChange({ file: e.target.files?.[0] })}
          />
          <Button type="button" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload className="size-3.5" /> {d.file || s?.stored ? 'Replace file' : 'Choose file'}
          </Button>
          {d.file && (
            <span className="text-sm text-muted">
              {d.file.name}, {bytes(d.file.size)}. Uploads when you save.
            </span>
          )}
        </div>
      )}
      {uploading !== undefined && <Progress value={uploading} label="Uploading" />}
      {s && <DownloadStatus s={s} />}
    </div>
  );
}

function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div className="space-y-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <p className="text-xs text-muted">
        {label} {Math.round(value * 100)}%
      </p>
    </div>
  );
}

function DownloadStatus({ s }: { s: AdminDownload }) {
  if (s.progress) return <Progress value={s.progress.received / Math.max(1, s.progress.total)} label={`Downloading ${s.file_name ?? ''}`} />;
  return (
    <div className="space-y-1 text-xs">
      {s.error && (
        <p className="flex items-start gap-1 text-rose-600 dark:text-rose-300">
          <AlertTriangle className="mt-px size-3.5 shrink-0" /> {s.error}
        </p>
      )}
      {s.file_name && (
        <p className={cx('flex items-center gap-1', s.stored ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted')}>
          {s.stored ? <Check className="size-3.5" /> : s.keeps_copy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {s.file_name}
          {s.size ? `, ${bytes(s.size)}` : ''}
          {s.version ? `, version ${s.version}` : ''}
          {s.stored ? ', on this server' : s.keeps_copy ? ', waiting to download' : ', from GitHub'}
        </p>
      )}
      {s.ipa && (
        <p className="text-muted">
          {s.ipa.bundleId}, iOS {s.ipa.minOS || 'any'} and later. Listed in the AltStore and SideStore source.
        </p>
      )}
    </div>
  );
}
