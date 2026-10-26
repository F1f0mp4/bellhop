// Files waiting to be imported, kept outside React so uploads keep going
// while you click around the rest of the app.
import { useSyncExternalStore } from 'react';
import * as tus from 'tus-js-client';
import { groupKey, kindOf, parseName, type MediaType, type Meta } from '../../../server/src/media/naming.ts';
import { api } from './api.ts';

export type UploadState = 'queued' | 'uploading' | 'paused' | 'done' | 'error';

export type StagedFile = {
  key: string;
  groupId: string;
  name: string;
  size: number;
  folder?: string;
  source: 'upload' | 'incoming';
  ref?: string; // incoming path, or the tus upload id once finished
  season?: number;
  episode?: number;
  episodeEnd?: number;
  upload?: { state: UploadState; progress: number; error?: string };
  result?: { ok: boolean; to: string; error?: string };
};

export type Group = {
  id: string;
  meta: Meta;
  poster?: string;
  ticketId?: number;
};

export type TicketContext = { id: number; meta: Meta; poster?: string };

export type NewEntry = { name: string; size: number; folder?: string; source: 'upload' | 'incoming'; ref?: string; file?: File };

type State = { groups: Group[]; files: StagedFile[]; importing: boolean };

let state: State = { groups: [], files: [], importing: false };
const listeners = new Set<() => void>();
const uploads = new Map<string, tus.Upload>();
const MAX_PARALLEL = 2;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function useStaging(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

let seq = 0;
const uid = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

function patchFile(key: string, patch: Partial<StagedFile>) {
  set({ files: state.files.map((f) => (f.key === key ? { ...f, ...patch } : f)) });
}

function patchUpload(key: string, patch: Partial<NonNullable<StagedFile['upload']>>) {
  set({ files: state.files.map((f) => (f.key === key ? { ...f, upload: { ...f.upload!, ...patch } } : f)) });
}

/** Add files, guessing what each one is and grouping them into movies, shows and albums. */
export function addEntries(entries: NewEntry[], opts: { forceType?: MediaType; ticket?: TicketContext | null } = {}) {
  const groups = [...state.groups];
  const files = [...state.files];
  const known = new Set(files.map((f) => `${f.source}:${f.ref ?? ''}:${f.name}:${f.size}`));
  const folderGroup = new Map<string, string>();
  let added = 0;

  // Media files first, so artwork can follow the folder it came with.
  const sorted = [...entries].sort((a, b) => Number(kindOf(a.name) === 'image') - Number(kindOf(b.name) === 'image'));

  for (const e of sorted) {
    const sig = `${e.source}:${e.ref ?? ''}:${e.name}:${e.size}`;
    if (known.has(sig)) continue;
    known.add(sig);

    let groupId: string | undefined;
    const parsed = parseName(e.name, e.folder);

    if (kindOf(e.name) === 'image') {
      groupId = e.folder ? folderGroup.get(e.folder) : undefined;
      if (!groupId) continue; // stray artwork with no movie or album next to it
    } else {
      let meta: Meta = { type: parsed.type, title: parsed.title, year: parsed.year, artist: parsed.artist, album: parsed.album };
      let poster: string | undefined;
      if (opts.ticket) {
        meta = { ...opts.ticket.meta };
        poster = opts.ticket.poster;
      } else if (opts.forceType && opts.forceType !== meta.type) {
        meta = { ...meta, type: opts.forceType };
        if (opts.forceType === 'music') {
          meta.artist ||= 'Unknown Artist';
          meta.album ||= meta.title || 'Unknown Album';
        }
      }
      const k = groupKey(meta);
      let g = groups.find((x) => groupKey(x.meta) === k && x.ticketId === opts.ticket?.id);
      if (!g) {
        g = { id: uid(), meta, poster, ticketId: opts.ticket?.id };
        groups.push(g);
      }
      groupId = g.id;
      if (e.folder) folderGroup.set(e.folder, g.id);
    }

    const key = uid();
    files.push({
      key,
      groupId,
      name: e.name,
      size: e.size,
      folder: e.folder,
      source: e.source,
      ref: e.ref,
      season: parsed.season,
      episode: parsed.episode,
      episodeEnd: parsed.episodeEnd,
      upload: e.file ? { state: 'queued', progress: 0 } : undefined,
    });
    if (e.file) createUpload(key, e.file);
    added++;
  }

  set({ groups, files });
  pump();
  return added;
}

function createUpload(key: string, file: File) {
  const upload = new tus.Upload(file, {
    endpoint: '/api/uploads',
    chunkSize: 50 * 1024 * 1024, // stays under reverse-proxy body limits (Cloudflare caps at 100 MB)
    retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
    metadata: { filename: file.name, filetype: file.type },
    removeFingerprintOnSuccess: true,
    onProgress: (sent, total) => patchUpload(key, { progress: total ? sent / total : 0 }),
    onSuccess: () => {
      patchFile(key, { ref: upload.url!.split('/').pop(), upload: { state: 'done', progress: 1 } });
      pump();
    },
    onError: (err) => {
      const body = (err as tus.DetailedError).originalResponse?.getBody?.();
      patchUpload(key, { state: 'error', error: body?.includes('sign in') ? 'Signed out, sign in and retry' : err.message.split('\n')[0] });
      pump();
    },
  });
  uploads.set(key, upload);
}

/** Start queued uploads, a couple at a time. */
function pump() {
  const active = state.files.filter((f) => f.upload?.state === 'uploading').length;
  const queued = state.files.filter((f) => f.upload?.state === 'queued').slice(0, Math.max(0, MAX_PARALLEL - active));
  for (const f of queued) {
    const u = uploads.get(f.key);
    if (!u) continue;
    patchUpload(f.key, { state: 'uploading' });
    u.findPreviousUploads().then((prev) => {
      if (prev.length) u.resumeFromPreviousUpload(prev[0]);
      u.start();
    });
  }
}

export function pauseUpload(key: string) {
  uploads.get(key)?.abort();
  patchUpload(key, { state: 'paused' });
  pump();
}

export function resumeUpload(key: string) {
  patchUpload(key, { state: 'queued', error: undefined });
  pump();
}

export function removeFile(key: string) {
  const u = uploads.get(key);
  const f = state.files.find((x) => x.key === key);
  if (u && f?.upload?.state !== 'done') u.abort(true).catch(() => {});
  uploads.delete(key);
  const files = state.files.filter((x) => x.key !== key);
  const groups = state.groups.filter((g) => files.some((x) => x.groupId === g.id));
  set({ files, groups });
  pump();
}

export function removeGroup(id: string) {
  for (const f of state.files.filter((x) => x.groupId === id)) removeFile(f.key);
}

export function updateGroup(id: string, patch: Omit<Partial<Group>, 'meta'> & { meta?: Partial<Meta> }) {
  set({
    groups: state.groups.map((g) => (g.id === id ? { ...g, ...patch, meta: { ...g.meta, ...patch.meta } } : g)),
  });
}

export function updateFile(key: string, patch: Partial<StagedFile>) {
  patchFile(key, patch);
}

export function clearFinished() {
  const files = state.files.filter((f) => !f.result?.ok);
  set({ files, groups: state.groups.filter((g) => files.some((f) => f.groupId === g.id)) });
}

export function fileMeta(g: Group, f: StagedFile): Meta {
  if (g.meta.type !== 'series') return g.meta;
  return { ...g.meta, season: f.season, episode: f.episode, episodeEnd: f.episodeEnd };
}

export const isReady = (f: StagedFile) => !f.result?.ok && (f.source === 'incoming' || f.upload?.state === 'done');

type ImportResponse = {
  results: { name: string; to: string; ok: boolean; error?: string }[];
  imported: number;
  jellyfin: { ok: boolean; message: string } | null;
  ticket: { id: number; title: string } | null;
};

export async function importGroups(groupIds: string[], keepOriginal: boolean) {
  set({ importing: true });
  const responses: ImportResponse[] = [];
  try {
    for (const id of groupIds) {
      const g = state.groups.find((x) => x.id === id);
      if (!g) continue;
      const files = state.files.filter((f) => f.groupId === id && isReady(f));
      if (!files.length) continue;
      const res = await api.post<ImportResponse>('/media/import', {
        ticketId: g.ticketId,
        keepOriginal,
        items: files.map((f) => ({ source: f.source, ref: f.ref, name: f.name, meta: fileMeta(g, f) })),
      });
      res.results.forEach((r, i) => patchFile(files[i].key, { result: r }));
      responses.push(res);
    }
  } finally {
    set({ importing: false });
  }
  return responses;
}

export const hasActiveUploads = () => state.files.some((f) => f.upload && ['queued', 'uploading'].includes(f.upload.state));

window.addEventListener('beforeunload', (e) => {
  if (hasActiveUploads()) e.preventDefault();
});
