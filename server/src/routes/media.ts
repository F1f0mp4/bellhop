import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { FileStore } from '@tus/file-store';
import { Server as TusServer } from '@tus/server';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAdmin, type AppEnv } from '../auth.ts';
import { config } from '../config.ts';
import { getSetting, one } from '../db.ts';
import { refreshLibrary } from '../media/jellyfin.ts';
import { buildTarget, isImportable, kindOf, validateMeta, type Dirs, type Meta } from '../media/naming.ts';
import { resolveInside, toRel, UnsafePathError } from '../media/safePath.ts';
import { setStatus } from './tickets.ts';

// Uploads land on the same disk as the library so the final move is an instant rename.
// If the media folder won't take a staging folder, fall back to the data folder (imports then copy).
const TMP = '.bellhop-tmp';
const tmpDir = (() => {
  const preferred = path.join(config.mediaDir, TMP);
  try {
    fs.mkdirSync(preferred, { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    const fallback = path.join(config.dataDir, 'uploads');
    fs.mkdirSync(fallback, { recursive: true });
    console.warn(`  Can't write ${preferred}; staging uploads in ${fallback} instead.`);
    return fallback;
  }
})();

const store = new FileStore({ directory: tmpDir, expirationPeriodInMilliseconds: 7 * 864e5 });
export const tus = new TusServer({
  path: '/api/uploads',
  datastore: store,
  relativeLocation: true,
  respectForwardedHeaders: true,
});

export function cleanupUploads() {
  tus.cleanUpExpiredUploads().catch(() => {});
}

const dirs = (): Dirs => ({
  movies: getSetting('movies_dir'),
  shows: getSetting('shows_dir'),
  music: getSetting('music_dir'),
});

const rootFor = (name: string | undefined) => {
  if (name === 'incoming') return config.incomingDir;
  if (name === 'library') return config.mediaDir;
  throw new HTTPException(400, { message: 'Unknown folder' });
};

function safe<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof UnsafePathError) throw new HTTPException(400, { message: 'That path is outside the allowed folders' });
    throw e;
  }
}

const exists = (p: string) => fsp.access(p).then(() => true, () => false);

async function writable(dir: string) {
  try {
    await fsp.access(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export const mediaRoutes = new Hono<AppEnv>().use(requireAdmin);

const runAs = () => `${process.getuid?.() ?? '?'}:${process.getgid?.() ?? '?'}`;

// The media root itself may be read-only (common on TrueNAS); only the library folders
// and the upload staging folder need to be writable.
mediaRoutes.get('/status', async (c) => {
  const rootWritable = await writable(config.mediaDir);
  const folders = await Promise.all(
    Object.entries(dirs()).map(async ([key, name]) => {
      const dir = path.join(config.mediaDir, name);
      const there = await exists(dir);
      return { key, name, exists: there, writable: there ? await writable(dir) : rootWritable };
    }),
  );
  return c.json({
    library: { path: config.mediaDir, exists: await exists(config.mediaDir), writable: rootWritable },
    uploads: { path: tmpDir, writable: await writable(tmpDir) },
    folders,
    incoming: { path: config.incomingDir, exists: await exists(config.incomingDir), writable: await writable(config.incomingDir) },
    user: runAs(),
    dirs: dirs(),
    jellyfin: Boolean(getSetting('jellyfin_url') && getSetting('jellyfin_key')),
  });
});

mediaRoutes.get('/browse', async (c) => {
  const root = rootFor(c.req.query('root'));
  const dir = safe(() => resolveInside(root, c.req.query('path') ?? ''));
  if (!(await exists(dir))) return c.json({ path: toRel(root, dir), entries: [] });
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    const st = await fsp.stat(full).catch(() => null);
    if (!st) continue;
    out.push({
      name: e.name,
      path: toRel(root, full),
      dir: st.isDirectory(),
      size: st.isDirectory() ? null : st.size,
      mtime: st.mtime.toISOString(),
      kind: st.isDirectory() ? 'folder' : kindOf(e.name),
    });
  }
  out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return c.json({ path: toRel(root, dir), entries: out });
});

// Every importable file under an incoming path, with the folder it sat in as a naming hint.
mediaRoutes.get('/expand', async (c) => {
  const root = config.incomingDir;
  const start = safe(() => resolveInside(root, c.req.query('path') ?? ''));
  const files: { path: string; name: string; folder?: string; size: number }[] = [];
  const hint = (p: string) => (path.dirname(p) === root ? undefined : path.basename(path.dirname(p)));

  async function walk(p: string, depth: number) {
    const st = await fsp.stat(p);
    if (st.isFile()) {
      if (isImportable(path.basename(p))) files.push({ path: toRel(root, p), name: path.basename(p), folder: hint(p), size: st.size });
      return;
    }
    if (depth > 6 || files.length > 2000) return;
    for (const name of await fsp.readdir(p)) if (!name.startsWith('.')) await walk(path.join(p, name), depth + 1);
  }
  if (!(await exists(start))) throw new HTTPException(404, { message: 'Not found' });
  await walk(start, 0);
  return c.json(files);
});

type ImportItem = { source: 'upload' | 'incoming'; ref: string; name: string; meta: Meta };

async function sourcePath(item: ImportItem): Promise<string> {
  if (item.source === 'incoming') {
    const p = resolveInside(config.incomingDir, item.ref);
    if (!(await fsp.stat(p).catch(() => null))?.isFile()) throw new Error('File is no longer in incoming');
    return p;
  }
  if (item.source === 'upload') {
    if (!/^[\w-]+$/.test(item.ref)) throw new Error('Bad upload id');
    const upload = await store.getUpload(item.ref).catch(() => null);
    if (!upload) throw new Error('Upload not found, it may have expired');
    if (upload.size === undefined || upload.offset !== upload.size) throw new Error('Upload has not finished');
    return resolveInside(tmpDir, item.ref);
  }
  throw new Error('Unknown source');
}

async function placeFile(src: string, dst: string, keepOriginal: boolean) {
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  if (keepOriginal) {
    // A hard link costs no space and keeps torrents seeding; copy if it crosses disks.
    try {
      await fsp.link(src, dst);
    } catch {
      await fsp.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
    }
    return;
  }
  try {
    await fsp.rename(src, dst);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    await fsp.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
    await fsp.unlink(src);
  }
}

mediaRoutes.post('/import', async (c) => {
  const user = c.get('user');
  const { items, ticketId, keepOriginal } = await c.req.json<{ items: ImportItem[]; ticketId?: number; keepOriginal?: boolean }>();
  if (!Array.isArray(items) || !items.length) throw new HTTPException(400, { message: 'Nothing to import' });
  const d = dirs();
  const planned = new Set<string>();
  const results = [];

  for (const item of items) {
    let to = '';
    try {
      const problem = validateMeta(item.meta);
      if (problem) throw new Error(problem);
      to = buildTarget(item.meta, item.name, d);
      const dst = resolveInside(config.mediaDir, to);
      if (planned.has(dst) || (await exists(dst))) throw new Error('A file with that name is already there');
      planned.add(dst);
      const src = await sourcePath(item);
      await placeFile(src, dst, item.source === 'incoming' && Boolean(keepOriginal));
      if (item.source === 'upload') await store.configstore.delete(item.ref);
      results.push({ name: item.name, to, ok: true });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const message =
        e instanceof UnsafePathError
          ? 'That path is outside the allowed folders'
          : code === 'EACCES' || code === 'EPERM'
            ? `No permission to write to ${to.split('/')[0] || 'the media folder'}/ as user ${runAs()}`
            : (e as Error).message;
      results.push({ name: item.name, to, ok: false, error: message });
    }
  }

  const imported = results.filter((r) => r.ok).length;
  const jellyfin = imported ? await refreshLibrary() : null;

  let ticket = null;
  if (ticketId && imported === results.length) {
    const t = one<{ id: number; title: string; status: string }>('SELECT id, title, status FROM tickets WHERE id = ?', ticketId);
    if (t && t.status !== 'done') {
      setStatus(t.id, 'done', user, `Added to the library. Enjoy!`);
      ticket = { id: t.id, title: t.title };
    }
  }
  return c.json({ results, imported, jellyfin, ticket });
});

mediaRoutes.post('/refresh', async (c) => c.json(await refreshLibrary()));

// Top-level library folders are off limits so a stray click can't wipe Movies/.
function guardLibraryPath(rel: string) {
  const abs = safe(() => resolveInside(config.mediaDir, rel));
  const parts = toRel(config.mediaDir, abs).split('/').filter(Boolean);
  if (!parts.length || (parts.length === 1 && Object.values(dirs()).includes(parts[0])) || parts[0] === TMP) {
    throw new HTTPException(400, { message: 'That folder is protected' });
  }
  return abs;
}

mediaRoutes.post('/library/rename', async (c) => {
  const { path: rel, name } = await c.req.json<{ path: string; name: string }>();
  const src = guardLibraryPath(rel);
  const clean = name?.trim();
  if (!clean || /[\\/]/.test(clean) || clean.startsWith('.')) throw new HTTPException(400, { message: 'Pick a plain name without slashes' });
  const dst = path.join(path.dirname(src), clean);
  if (await exists(dst)) throw new HTTPException(409, { message: 'Something with that name is already there' });
  await fsp.rename(src, dst);
  return c.json({ ok: true, path: toRel(config.mediaDir, dst) });
});

mediaRoutes.post('/library/delete', async (c) => {
  const { path: rel } = await c.req.json<{ path: string }>();
  const target = guardLibraryPath(rel);
  if (!(await exists(target))) throw new HTTPException(404, { message: 'Already gone' });
  await fsp.rm(target, { recursive: true });
  return c.json({ ok: true });
});
