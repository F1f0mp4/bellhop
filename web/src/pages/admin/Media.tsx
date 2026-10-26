import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  File as FileIcon,
  FileAudio,
  FileText,
  FileVideo,
  Folder,
  FolderInput,
  HardDriveDownload,
  Image,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { buildTarget, kindOf, validateMeta, type Dirs, type MediaType, type Meta } from '../../../../server/src/media/naming.ts';
import { MediaSearch } from '../../components/MediaSearch.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Button, Card, Dialog, Empty, Field, Input, PageTitle, Poster, Select, Spinner, Tabs } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { filesFromDrop, filesFromInput } from '../../lib/dropFiles.ts';
import { bytes, cx } from '../../lib/format.ts';
import { TYPE_INFO } from '../../lib/labels.ts';
import {
  addEntries,
  clearFinished,
  fileMeta,
  importGroups,
  isReady,
  pauseUpload,
  removeFile,
  removeGroup,
  resumeUpload,
  updateFile,
  updateGroup,
  useStaging,
  type Group,
  type NewEntry,
  type StagedFile,
  type TicketContext,
} from '../../lib/staging.ts';
import type { Ticket } from '../../lib/types.ts';
import { useFetch } from '../../lib/useFetch.ts';

type Folder = { path: string; exists: boolean; writable: boolean };
type LibraryFolder = { key: string; name: string; exists: boolean; writable: boolean };
type MediaStatus = {
  library: Folder;
  uploads: { path: string; writable: boolean };
  folders: LibraryFolder[];
  incoming: Folder;
  user: string;
  dirs: Dirs;
  jellyfin: boolean;
};
type Entry = { name: string; path: string; dir: boolean; size: number | null; mtime: string; kind: string };
type Listing = { path: string; entries: Entry[] };

const DRAG_MIME = 'application/x-bellhop-path';
const MEDIA_TYPES: MediaType[] = ['movie', 'series', 'music'];

export function Media() {
  const [tab, setTab] = useState<'add' | 'library'>('add');
  const { data: status } = useFetch<MediaStatus>('/media/status');
  const staging = useStaging();
  const pending = staging.files.filter((f) => !f.result?.ok).length;

  return (
    <div>
      <PageTitle
        title="Media"
        subtitle="Drop files in, check where they'll land, import. Jellyfin rescans on its own."
        actions={
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { value: 'add', label: <>Add media{pending > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] text-accent-fg">{pending}</span>}</> },
              { value: 'library', label: 'Library' },
            ]}
          />
        }
      />
      {!status ? <Spinner /> : tab === 'add' ? <AddMedia status={status} /> : <Library status={status} />}
    </div>
  );
}

/* ------------------------------------------------------------------ Add media */

function ticketContext(t: Ticket): TicketContext | null {
  if (t.type !== 'movie' && t.type !== 'series' && t.type !== 'music') return null;
  const ref = t.media_ref;
  const title = ref?.title ?? t.title.replace(/\s*\(\d{4}\)$/, '');
  if (t.type === 'music') {
    const artist = ref?.subtitle?.split(' · ')[0] || 'Unknown Artist';
    return { id: t.id, poster: ref?.poster, meta: { type: 'music', title, artist, album: title, year: ref?.year } };
  }
  return { id: t.id, poster: ref?.poster, meta: { type: t.type, title, year: ref?.year } };
}

function AddMedia({ status }: { status: MediaStatus }) {
  const notify = useToast();
  const [params, setParams] = useSearchParams();
  const ticketId = params.get('ticket');
  const { data: ticket } = useFetch<Ticket>(ticketId ? `/tickets/${ticketId}` : null);
  const ctx = ticket && String(ticket.id) === ticketId ? ticketContext(ticket) : null;
  const { groups, files, importing } = useStaging();
  const [keepOriginal, setKeepOriginal] = useState(true);

  const add = (entries: NewEntry[], forceType?: MediaType, skipped = 0) => {
    const n = addEntries(entries, { forceType, ticket: ctx });
    if (skipped) notify(`Skipped ${skipped} file${skipped === 1 ? '' : 's'} that aren't video, audio or subtitles`);
    else if (!n && entries.length) notify('Those files are already in the list');
    else if (!entries.length) notify('No media files found there', 'error');
  };

  const addIncoming = async (path: string, forceType?: MediaType) => {
    try {
      const found = await api.get<{ path: string; name: string; folder?: string; size: number }[]>(
        `/media/expand?path=${encodeURIComponent(path)}`,
      );
      add(found.map((f) => ({ name: f.name, size: f.size, folder: f.folder, source: 'incoming', ref: f.path })), forceType);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  const ready = files.filter(isReady);
  const readyGroups = groups.filter((g) => {
    const gf = files.filter((f) => f.groupId === g.id && !f.result?.ok);
    return gf.length > 0 && gf.every(isReady) && gf.every((f) => !validateMeta(fileMeta(g, f)));
  });
  const anyIncoming = files.some((f) => f.source === 'incoming' && !f.result?.ok);
  const finished = files.some((f) => f.result?.ok);

  const runImport = async (ids: string[]) => {
    try {
      const responses = await importGroups(ids, keepOriginal);
      const imported = responses.reduce((n, r) => n + r.imported, 0);
      const failed = responses.reduce((n, r) => n + r.results.filter((x) => !x.ok).length, 0);
      const jf = responses.find((r) => r.jellyfin)?.jellyfin;
      if (imported) notify(`Imported ${imported} file${imported === 1 ? '' : 's'}${jf?.ok ? '. Jellyfin is scanning.' : ''}`);
      if (failed) notify(`${failed} file${failed === 1 ? '' : 's'} could not be imported, see the list`, 'error');
      if (jf && !jf.ok && status.jellyfin) notify(jf.message, 'error');
      const done = responses.find((r) => r.ticket)?.ticket;
      if (done) {
        notify(`Request "${done.title}" marked done`);
        setParams({});
      }
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  if (!status.library.exists) {
    return (
      <Empty icon={<HardDriveDownload className="size-5" />} title="No media folder mounted">
        Bellhop looks for your library at <code>{status.library.path}</code>. Mount your media dataset there.
      </Empty>
    );
  }

  const blocked = status.folders.filter((f) => !f.writable);

  return (
    <div className="space-y-6 pb-24">
      {blocked.length > 0 && (
        <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
          <div>
            Bellhop runs as user <b>{status.user}</b> and can't write to{' '}
            {blocked.map((f, i) => (
              <span key={f.key}>
                {i > 0 && ', '}
                <code>{f.name}/</code>
                {!f.exists && ' (missing, and the media folder is read-only so it cannot be created)'}
              </span>
            ))}
            . Imports into {blocked.length === 1 ? 'it' : 'them'} will fail until that user has write access, or the folder name in Settings is
            changed to match yours.
          </div>
        </div>
      )}
      {ticketId && ticket && (
        <div className="flex items-center gap-4 rounded-xl border border-accent/40 bg-accent-soft p-3">
          <Poster media={ticket.media_ref} type={ticket.type} className={ticket.type === 'music' ? 'size-12' : 'h-14 w-10'} />
          <div className="min-w-0 flex-1 text-sm">
            <div className="text-muted">Fulfilling a request from {ticket.username}</div>
            <div className="truncate font-medium">{ticket.title}</div>
            <div className="text-xs text-muted">Files you add now are named after this request. Importing marks it done.</div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setParams({})} aria-label="Stop fulfilling">
            <X className="size-4" />
          </Button>
        </div>
      )}

      <div className={cx('grid gap-4', status.incoming.exists && 'lg:grid-cols-2')}>
        <DropZone onFiles={add} onIncoming={addIncoming} />
        {status.incoming.exists && <IncomingBrowser onAdd={addIncoming} />}
      </div>

      {groups.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted">
            Ready to import · {groups.length} item{groups.length === 1 ? '' : 's'}
          </h2>
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              files={files.filter((f) => f.groupId === g.id)}
              dirs={status.dirs}
              canImport={readyGroups.includes(g) && !importing}
              onImport={() => runImport([g.id])}
            />
          ))}
        </section>
      )}

      {files.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <span className="text-sm text-muted">
              {ready.length} of {files.filter((f) => !f.result?.ok).length} ready
            </span>
            {anyIncoming && (
              <label className="flex cursor-pointer items-center gap-2 text-sm" title="Hard-links files so torrents keep seeding and no extra space is used">
                <input type="checkbox" className="accent-[var(--accent)]" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} />
                Keep originals in incoming
              </label>
            )}
            <div className="ml-auto flex gap-2">
              {finished && (
                <Button variant="ghost" size="sm" onClick={clearFinished}>
                  Clear finished
                </Button>
              )}
              <Button variant="primary" loading={importing} disabled={!readyGroups.length} onClick={() => runImport(readyGroups.map((g) => g.id))}>
                <Check className="size-4" /> Import {readyGroups.length > 1 ? `all ${readyGroups.length}` : ''}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DropZone({
  onFiles,
  onIncoming,
}: {
  onFiles: (entries: NewEntry[], type?: MediaType, skipped?: number) => void;
  onIncoming: (path: string, type?: MediaType) => void;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const accepts = (e: DragEvent) => e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(DRAG_MIME);

  const drop = async (e: DragEvent, type?: MediaType) => {
    e.preventDefault();
    e.stopPropagation();
    depth.current = 0;
    setOver(false);
    const internal = e.dataTransfer.getData(DRAG_MIME);
    if (internal) return onIncoming(internal, type);
    const { entries, skipped } = await filesFromDrop(e.dataTransfer);
    onFiles(entries, type, skipped);
  };

  return (
    <div
      onDragEnter={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => accepts(e) && e.preventDefault()}
      onDragLeave={() => {
        if (--depth.current <= 0) setOver(false);
      }}
      onDrop={(e) => drop(e)}
      className={cx(
        'relative flex min-h-72 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-6 text-center transition-colors',
        over ? 'border-accent bg-accent-soft/60' : 'border-line bg-surface/50',
      )}
    >
      {over ? (
        <div className="grid w-full max-w-md grid-cols-2 gap-3">
          <DropTarget label="Auto-detect" icon={<Search className="size-5" />} onDrop={(e) => drop(e)} wide />
          {MEDIA_TYPES.map((t) => {
            const Icon = TYPE_INFO[t].icon;
            return <DropTarget key={t} label={`As ${TYPE_INFO[t].short.toLowerCase()}`} icon={<Icon className="size-5" />} onDrop={(e) => drop(e, t)} />;
          })}
        </div>
      ) : (
        <>
          <div className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
            <UploadCloud className="size-7" />
          </div>
          <div>
            <div className="text-lg font-medium">Drop movies, episodes or albums</div>
            <div className="mt-1 text-sm text-muted">Whole folders work too. Big files resume if the connection drops.</div>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              <FileIcon className="size-3.5" /> Choose files
            </Button>
            <Button size="sm" onClick={() => folderInput.current?.click()}>
              <Folder className="size-3.5" /> Choose folder
            </Button>
          </div>
        </>
      )}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const { entries, skipped } = filesFromInput(e.target.files!);
          onFiles(entries, undefined, skipped);
          e.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        {...({ webkitdirectory: '' } as object)}
        onChange={(e) => {
          const { entries, skipped } = filesFromInput(e.target.files!);
          onFiles(entries, undefined, skipped);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function DropTarget({ label, icon, onDrop, wide }: { label: string; icon: ReactNode; onDrop: (e: DragEvent) => void; wide?: boolean }) {
  const [hot, setHot] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setHot(true);
      }}
      onDragLeave={() => setHot(false)}
      onDrop={(e) => {
        setHot(false);
        onDrop(e);
      }}
      className={cx(
        'flex flex-col items-center justify-center gap-2 rounded-xl border p-4 text-sm font-medium transition',
        wide && 'col-span-2',
        hot ? 'scale-[1.03] border-accent bg-accent text-accent-fg' : 'border-line bg-surface',
      )}
    >
      {icon}
      {label}
    </div>
  );
}

const kindIcon = (name: string, dir?: boolean) => {
  if (dir) return <Folder className="size-4 text-accent" />;
  const k = kindOf(name);
  if (k === 'video') return <FileVideo className="size-4 text-muted" />;
  if (k === 'audio') return <FileAudio className="size-4 text-muted" />;
  if (k === 'sub') return <FileText className="size-4 text-muted" />;
  if (k === 'image') return <Image className="size-4 text-muted" />;
  return <FileIcon className="size-4 text-muted/60" />;
};

function Breadcrumbs({ root, path, onGo }: { root: string; path: string; onGo: (p: string) => void }) {
  const parts = path.split('/').filter(Boolean);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
      <button onClick={() => onGo('')} className="cursor-pointer font-medium hover:text-accent">
        {root}
      </button>
      {parts.map((p, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-3.5 shrink-0 text-muted" />
          <button onClick={() => onGo(parts.slice(0, i + 1).join('/'))} className="cursor-pointer truncate hover:text-accent">
            {p}
          </button>
        </span>
      ))}
    </div>
  );
}

function IncomingBrowser({ onAdd }: { onAdd: (path: string) => void }) {
  const [path, setPath] = useState('');
  const { data, loading, reload } = useFetch<Listing>(`/media/browse?root=incoming&path=${encodeURIComponent(path)}`);

  return (
    <Card className="flex max-h-[28rem] min-h-72 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <FolderInput className="size-4 shrink-0 text-muted" />
        <Breadcrumbs root="Incoming" path={path} onGo={setPath} />
        <Button variant="ghost" size="icon" className="ml-auto shrink-0" onClick={reload} aria-label="Refresh">
          <RefreshCw className={cx('size-4', loading && 'animate-spin')} />
        </Button>
      </div>
      <div className="px-4 pt-2 text-xs text-muted">Drag onto the drop zone, or press + to add.</div>
      <ul className="flex-1 overflow-y-auto p-2">
        {data?.entries.length === 0 && <li className="p-6 text-center text-sm text-muted">Empty folder</li>}
        {data?.entries.map((e) => (
          <li
            key={e.path}
            draggable
            onDragStart={(ev) => {
              ev.dataTransfer.setData(DRAG_MIME, e.path);
              ev.dataTransfer.effectAllowed = 'copy';
            }}
            className="group flex cursor-grab items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2 active:cursor-grabbing"
          >
            {kindIcon(e.name, e.dir)}
            {e.dir ? (
              <button onClick={() => setPath(e.path)} className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm hover:text-accent">
                {e.name}
              </button>
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm">{e.name}</span>
            )}
            <span className="shrink-0 text-xs text-muted tabular-nums">{bytes(e.size)}</span>
            <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => onAdd(e.path)} aria-label={`Add ${e.name}`}>
              <Plus className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function GroupCard({
  group: g,
  files,
  dirs,
  canImport,
  onImport,
}: {
  group: Group;
  files: StagedFile[];
  dirs: Dirs;
  canImport: boolean;
  onImport: () => void;
}) {
  const [matching, setMatching] = useState(false);
  const meta = g.meta;
  const done = files.every((f) => f.result?.ok);
  const setMeta = (patch: Partial<Meta>) => updateGroup(g.id, { meta: patch });
  const isMusic = meta.type === 'music';
  const totalSize = files.reduce((n, f) => n + f.size, 0);

  return (
    <Card className={cx('animate-rise overflow-hidden', done && 'opacity-70')}>
      <div className="flex gap-4 border-b border-line p-4">
        <button onClick={() => setMatching(true)} className="shrink-0 cursor-pointer" title="Find the right title">
          <Poster media={g.poster ? { source: 'tmdb', id: '', title: '', poster: g.poster } : null} type={meta.type} className={isMusic ? 'size-20' : 'h-24 w-16'} />
        </button>
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[8.5rem_1fr_6rem]">
          <Select value={meta.type} onChange={(e) => setMeta({ type: e.target.value as MediaType })} aria-label="Type" disabled={done}>
            {MEDIA_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_INFO[t].short}
              </option>
            ))}
          </Select>
          {isMusic ? (
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
              <Input value={meta.artist ?? ''} onChange={(e) => setMeta({ artist: e.target.value })} placeholder="Artist" aria-label="Artist" disabled={done} />
              <Input value={meta.album ?? ''} onChange={(e) => setMeta({ album: e.target.value, title: e.target.value })} placeholder="Album" aria-label="Album" disabled={done} />
            </div>
          ) : (
            <>
              <Input value={meta.title} onChange={(e) => setMeta({ title: e.target.value })} placeholder="Title" aria-label="Title" disabled={done} />
              <Input
                value={meta.year ?? ''}
                onChange={(e) => setMeta({ year: e.target.value.replace(/\D/g, '').slice(0, 4) || undefined })}
                placeholder="Year"
                aria-label="Year"
                inputMode="numeric"
                disabled={done}
              />
            </>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
            <Button size="sm" variant="ghost" className="-ml-2" onClick={() => setMatching(true)} disabled={done}>
              <Search className="size-3.5" /> Find title
            </Button>
            <span className="text-xs text-muted">
              {files.length} file{files.length === 1 ? '' : 's'} · {bytes(totalSize)}
            </span>
            <div className="ml-auto flex gap-1">
              {!done && (
                <Button size="sm" variant="ghost" onClick={() => removeGroup(g.id)}>
                  <Trash2 className="size-3.5" /> Remove
                </Button>
              )}
              {!done && (
                <Button size="sm" variant="primary" disabled={!canImport} onClick={onImport}>
                  Import
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      <ul className="divide-y divide-line">
        {files.map((f) => (
          <FileRow key={f.key} file={f} meta={fileMeta(g, f)} dirs={dirs} series={meta.type === 'series'} />
        ))}
      </ul>
      <MatchDialog group={g} open={matching} onClose={() => setMatching(false)} />
    </Card>
  );
}

function FileRow({ file: f, meta, dirs, series }: { file: StagedFile; meta: Meta; dirs: Dirs; series: boolean }) {
  const problem = validateMeta(meta);
  const target = problem ? null : buildTarget(meta, f.name, dirs);
  const up = f.upload;
  const num = (v: string) => (v === '' ? undefined : Math.max(0, Math.min(999, Number(v.replace(/\D/g, '')))));

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      <span className="shrink-0">{kindIcon(f.name)}</span>
      <div className="min-w-0 flex-1 basis-64">
        <div className="truncate text-xs text-muted" title={f.name}>
          {f.source === 'incoming' ? 'incoming/' : ''}
          {f.folder ? `${f.folder}/` : ''}
          {f.name}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <ArrowRight className="size-3.5 shrink-0 text-muted" />
          {f.result ? (
            f.result.ok ? (
              <span className="truncate text-emerald-600 dark:text-emerald-400">{f.result.to}</span>
            ) : (
              <span className="truncate text-rose-600 dark:text-rose-300">{f.result.error}</span>
            )
          ) : target ? (
            <span className="truncate" title={target}>
              <span className="text-muted">{target.slice(0, target.lastIndexOf('/') + 1)}</span>
              {target.slice(target.lastIndexOf('/') + 1)}
            </span>
          ) : (
            <span className="text-amber-600 dark:text-amber-300">{problem}</span>
          )}
        </div>
      </div>

      {series && !f.result?.ok && kindOf(f.name) !== 'image' && (
        <div className="flex items-center gap-1 text-xs text-muted">
          S
          <Input className="h-7 w-11 px-1.5 text-center" value={f.season ?? ''} onChange={(e) => updateFile(f.key, { season: num(e.target.value) })} aria-label="Season" />
          E
          <Input className="h-7 w-11 px-1.5 text-center" value={f.episode ?? ''} onChange={(e) => updateFile(f.key, { episode: num(e.target.value) })} aria-label="Episode" />
        </div>
      )}

      <div className="flex w-full items-center gap-2 sm:w-52">
        {f.result?.ok ? (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="size-3.5" /> Imported
          </span>
        ) : up ? (
          <>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className={cx('h-full rounded-full transition-[width]', up.state === 'error' ? 'bg-rose-500' : up.state === 'done' ? 'bg-emerald-500' : 'bg-accent')}
                style={{ width: `${Math.round(up.progress * 100)}%` }}
              />
            </div>
            <span className="w-16 text-right text-xs text-muted tabular-nums" title={up.error}>
              {up.state === 'done' ? bytes(f.size) : up.state === 'error' ? 'failed' : up.state === 'queued' ? 'waiting' : `${Math.floor(up.progress * 100)}%`}
            </span>
            {up.state === 'uploading' && (
              <Button variant="ghost" size="icon" className="size-7" onClick={() => pauseUpload(f.key)} aria-label="Pause">
                <Pause className="size-3.5" />
              </Button>
            )}
            {(up.state === 'paused' || up.state === 'error') && (
              <Button variant="ghost" size="icon" className="size-7" onClick={() => resumeUpload(f.key)} aria-label="Resume">
                <Play className="size-3.5" />
              </Button>
            )}
          </>
        ) : (
          <span className="ml-auto text-xs text-muted tabular-nums">{bytes(f.size)}</span>
        )}
        {!f.result?.ok && (
          <Button variant="ghost" size="icon" className="size-7" onClick={() => removeFile(f.key)} aria-label={`Remove ${f.name}`}>
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}

function MatchDialog({ group: g, open, onClose }: { group: Group; open: boolean; onClose: () => void }) {
  const isMusic = g.meta.type === 'music';
  const { data: lookup } = useFetch<{ tmdb: boolean }>(open ? '/lookup/status' : null);
  const unavailable = !isMusic && lookup && !lookup.tmdb;
  return (
    <Dialog open={open} onClose={onClose} title={`Find the ${TYPE_INFO[g.meta.type].short.toLowerCase()}`}>
      {unavailable ? (
        <p className="text-sm text-muted">
          Add a TMDB key in <Link to="/admin/settings" className="text-accent underline">Settings</Link> to search movies and shows. You can still type
          the title and year by hand.
        </p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          <MediaSearch
            compact
            type={g.meta.type}
            initialQuery={isMusic ? [g.meta.artist !== 'Unknown Artist' && g.meta.artist, g.meta.album].filter(Boolean).join(' ') : g.meta.title}
            onPick={(r) => {
              if (isMusic) {
                updateGroup(g.id, { poster: r.poster, meta: { album: r.title, title: r.title, artist: r.subtitle?.split(' · ')[0] || g.meta.artist, year: r.year } });
              } else {
                updateGroup(g.id, { poster: r.poster, meta: { title: r.title, year: r.year } });
              }
              onClose();
            }}
          />
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ Library */

function Library({ status }: { status: MediaStatus }) {
  const notify = useToast();
  const [path, setPath] = useState('');
  const { data, loading, reload } = useFetch<Listing>(`/media/browse?root=library&path=${encodeURIComponent(path)}`);
  const [renaming, setRenaming] = useState<Entry | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [scanning, setScanning] = useState(false);
  const protectedNames = Object.values(status.dirs);

  const rescan = async () => {
    setScanning(true);
    const r = await api.post<{ ok: boolean; message: string }>('/media/refresh').catch((e) => ({ ok: false, message: e.message }));
    notify(r.message, r.ok ? 'ok' : 'error');
    setScanning(false);
  };

  const remove = async () => {
    try {
      await api.post('/media/library/delete', { path: deleting!.path });
      notify(`Deleted ${deleting!.name}`);
      setDeleting(null);
      reload();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Breadcrumbs root="Library" path={path} onGo={setPath} />
        <div className="ml-auto flex shrink-0 gap-1">
          {status.jellyfin && (
            <Button variant="ghost" size="sm" onClick={rescan} loading={scanning}>
              Rescan Jellyfin
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={reload} aria-label="Refresh">
            <RefreshCw className={cx('size-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>
      <ul className="divide-y divide-line">
        {data?.entries.length === 0 && <li className="p-10 text-center text-sm text-muted">Nothing here yet</li>}
        {data?.entries.map((e) => {
          const locked = !path && protectedNames.includes(e.name);
          return (
            <li key={e.path} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50">
              {kindIcon(e.name, e.dir)}
              {e.dir ? (
                <button onClick={() => setPath(e.path)} className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm hover:text-accent">
                  {e.name}
                </button>
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm">{e.name}</span>
              )}
              <span className="hidden text-xs text-muted tabular-nums sm:inline">{bytes(e.size)}</span>
              {!locked && (
                <div className="flex gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => setRenaming(e)} aria-label={`Rename ${e.name}`}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7 hover:text-rose-500" onClick={() => setDeleting(e)} aria-label={`Delete ${e.name}`}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <RenameDialog entry={renaming} onClose={() => setRenaming(null)} onDone={reload} />
      <Dialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.dir ? 'folder' : 'file'}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove}>
              Delete for good
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          <span className="font-medium break-all text-fg">{deleting?.path}</span>
          {deleting?.dir ? ' and everything inside it' : ''} will be removed from disk. This can't be undone.
        </p>
      </Dialog>
    </Card>
  );
}

function RenameDialog({ entry, onClose, onDone }: { entry: Entry | null; onClose: () => void; onDone: () => void }) {
  const notify = useToast();
  const [name, setName] = useState('');
  const [last, setLast] = useState<Entry | null>(null);
  if (entry !== last) {
    setLast(entry);
    setName(entry?.name ?? '');
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/media/library/rename', { path: entry!.path, name });
      notify('Renamed');
      onClose();
      onDone();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <Dialog open={Boolean(entry)} onClose={onClose} title="Rename">
      <form onSubmit={submit} className="space-y-4">
        <Field label="New name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || name === entry?.name}>
            Rename
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
