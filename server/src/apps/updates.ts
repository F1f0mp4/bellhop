import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { all, now, one, run, setSetting } from '../db.ts';
import { GitHubError, latestRelease, matchAsset, type ReleaseAsset } from './github.ts';
import { readIpa } from './ipa.ts';
import { filesDir, findIcon, iconFile, removeStored, safeFileName, storedFile } from './store.ts';

export type Platform = 'ios' | 'android' | 'macos' | 'windows' | 'linux';
export const PLATFORMS: Platform[] = ['ios', 'android', 'macos', 'windows', 'linux'];

export type AppRow = {
  id: number;
  slug: string;
  name: string;
  developer: string;
  subtitle: string;
  description: string;
  category: string;
  repo: string;
  homepage: string;
  license: string;
  icon: string;
  icon_url: string;
  tint: string;
  featured: number;
  starter: string | null;
  release_tag: string | null;
  checked_at: string | null;
  check_error: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type DownloadRow = {
  id: number;
  app_id: number;
  platform: Platform;
  label: string;
  source: 'link' | 'release' | 'upload';
  url: string;
  asset: string;
  keep: number;
  remote_url: string | null;
  file: string | null;
  file_name: string | null;
  size: number | null;
  version: string | null;
  released_at: string | null;
  sha256: string | null;
  ipa: string | null;
  error: string | null;
  position: number;
};

/** iPhones install through AltStore or SideStore, which need the file on this server to read it. */
export const keepsCopy = (d: Pick<DownloadRow, 'source' | 'keep' | 'platform'>) =>
  d.source === 'upload' || (d.source === 'release' && (Boolean(d.keep) || d.platform === 'ios'));

/** "v1.18.2", "release-5.3.0" and "Audacity-4.0.2" are all just versions. */
export function cleanVersion(tag: string): string {
  return /\d+(?:\.\d+)+[\w.+-]*/.exec(tag)?.[0] ?? tag.replace(/^v(?=\d)/, '');
}

// ── Progress, for the admin screen ─────────────────────────────────────────────────────────────

const progress = new Map<number, { received: number; total: number }>();
export const downloadProgress = (id: number) => progress.get(id);

const appChecks = new Map<number, Promise<void>>();
let allCheck: Promise<void> | null = null;
export const isChecking = (appId?: number) => (appId === undefined ? Boolean(allCheck) : appChecks.has(appId));

/** Looks for a newer release of one app and fetches what should be kept. One run per app at a time. */
export function checkApp(appId: number): Promise<void> {
  const running = appChecks.get(appId);
  if (running) return running;
  const p = runCheck(appId).finally(() => appChecks.delete(appId));
  appChecks.set(appId, p);
  return p;
}

export function checkAll(): Promise<void> {
  allCheck ??= (async () => {
    try {
      for (const { id } of all<{ id: number }>('SELECT id FROM apps ORDER BY position, id')) {
        try {
          await checkApp(id);
        } catch (e) {
          // Out of GitHub requests: the rest would fail the same way, so try again next round.
          if (e instanceof GitHubError && e.rateLimited) break;
        }
      }
      setSetting('apps_checked_at', now());
    } finally {
      allCheck = null;
    }
  })();
  return allCheck;
}

async function runCheck(appId: number) {
  const app = one<AppRow>('SELECT * FROM apps WHERE id = ?', appId);
  if (!app) return;
  const downloads = all<DownloadRow>('SELECT * FROM app_downloads WHERE app_id = ? ORDER BY position, id', appId);

  if (!app.icon || !iconFile(app.icon)) {
    const icon = await findIcon(app, downloads.map((d) => d.url));
    if (icon) run('UPDATE apps SET icon = ? WHERE id = ?', icon, appId);
  }

  // A copy the admin no longer wants kept.
  for (const d of downloads) {
    if (d.file && !keepsCopy(d)) {
      removeStored(d.file);
      run('UPDATE app_downloads SET file = NULL, sha256 = NULL, ipa = NULL WHERE id = ?', d.id);
    }
  }

  const releases = downloads.filter((d) => d.source === 'release');
  if (!releases.length) {
    run('UPDATE apps SET checked_at = ?, check_error = NULL WHERE id = ?', now(), appId);
    return;
  }
  if (!app.repo) {
    run('UPDATE apps SET checked_at = ?, check_error = ? WHERE id = ?', now(), 'Add the GitHub repo to get release files', appId);
    return;
  }

  let release;
  try {
    release = await latestRelease(app.repo);
  } catch (e) {
    run('UPDATE apps SET checked_at = ?, check_error = ? WHERE id = ?', now(), (e as Error).message, appId);
    throw e;
  }
  run('UPDATE apps SET release_tag = ?, checked_at = ?, check_error = NULL WHERE id = ?', release.tag, now(), appId);
  const version = cleanVersion(release.tag);

  for (const d of releases) {
    const asset = matchAsset(d.asset, release.assets);
    if (!asset) {
      run('UPDATE app_downloads SET error = ? WHERE id = ?', `Nothing in ${release.tag} matches "${d.asset}"`, d.id);
      continue;
    }
    if (!keepsCopy(d)) {
      run(
        'UPDATE app_downloads SET remote_url = ?, file_name = ?, size = ?, version = ?, released_at = ?, error = NULL WHERE id = ?',
        asset.url, asset.name, asset.size, version, release.published_at, d.id,
      );
      continue;
    }
    // Same release, same file, still on disk: nothing to do.
    if (storedFile(d.file) && d.version === version && d.file_name === asset.name && d.size === asset.size) {
      run('UPDATE app_downloads SET remote_url = ?, error = NULL WHERE id = ?', asset.url, d.id);
      continue;
    }
    try {
      await fetchCopy(d, asset, version, release.published_at);
    } catch (e) {
      run('UPDATE app_downloads SET error = ? WHERE id = ?', `Couldn't download ${asset.name}: ${(e as Error).message}`, d.id);
    }
  }
}

const STALL_MS = 60_000;

async function fetchCopy(d: DownloadRow, asset: ReleaseAsset, version: string, releasedAt: string) {
  const dir = path.join(filesDir(), String(d.id));
  fs.mkdirSync(dir, { recursive: true });
  const part = path.join(dir, `${safeFileName(asset.name)}.part`);
  const abort = new AbortController();
  let stall = setTimeout(() => abort.abort(), STALL_MS);
  progress.set(d.id, { received: 0, total: asset.size });
  try {
    const res = await fetch(asset.url, { headers: { 'user-agent': 'Bellhop' }, redirect: 'follow', signal: abort.signal });
    if (!res.ok || !res.body) throw new Error(`GitHub answered ${res.status}`);
    const hash = crypto.createHash('sha256');
    let received = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        received += chunk.length;
        progress.set(d.id, { received, total: asset.size });
        clearTimeout(stall);
        stall = setTimeout(() => abort.abort(), STALL_MS);
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as any), meter, fs.createWriteStream(part));
    if (asset.size && received !== asset.size) throw new Error(`got ${received} of ${asset.size} bytes`);
    await storeFile(d, part, asset.name, { sha256: hash.digest('hex'), version, released_at: releasedAt, remote_url: asset.url });
  } catch (e) {
    fs.rmSync(part, { force: true });
    throw abort.signal.aborted ? new Error('the download stalled') : e;
  } finally {
    clearTimeout(stall);
    progress.delete(d.id);
  }
}

/**
 * Moves a finished file into place and records it. Shared by release copies and admin uploads.
 * For an .ipa, the app inside is read so AltStore and SideStore can list it.
 */
export async function storeFile(
  d: Pick<DownloadRow, 'id' | 'file' | 'platform'>,
  part: string,
  name: string,
  meta: { sha256?: string; version?: string | null; released_at?: string | null; remote_url?: string | null },
) {
  const fileName = safeFileName(name);
  const rel = `${d.id}/${fileName}`;
  const target = path.join(filesDir(), rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(part, target);
  if (d.file && d.file !== rel) removeStored(d.file);

  let ipa: string | null = null;
  let error: string | null = null;
  let version = meta.version ?? null;
  if (/\.ipa$/i.test(fileName)) {
    try {
      const info = await readIpa(target);
      ipa = JSON.stringify(info);
      version ||= info.version;
    } catch (e) {
      error = `Couldn't read the app inside: ${(e as Error).message}`;
    }
  } else if (d.platform === 'ios') {
    error = 'iPhones and iPads can only install .ipa files';
  }

  const size = fs.statSync(target).size;
  const sha256 = meta.sha256 ?? (await hashFile(target));
  run(
    `UPDATE app_downloads SET file = ?, file_name = ?, size = ?, sha256 = ?, version = ?, released_at = ?, remote_url = ?, ipa = ?, error = ?
     WHERE id = ?`,
    rel, fileName, size, sha256, version, meta.released_at ?? now(), meta.remote_url ?? null, ipa, error, d.id,
  );
}

async function hashFile(file: string) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

/** Folders left behind by deleted downloads, and half-finished files from a restart mid-download. */
export function cleanupFiles() {
  const root = filesDir();
  if (!fs.existsSync(root)) return;
  const ids = new Set(all<{ id: number; file: string | null }>('SELECT id, file FROM app_downloads').map((d) => String(d.id)));
  const files = new Set(all<{ file: string }>('SELECT file FROM app_downloads WHERE file IS NOT NULL').map((d) => d.file));
  for (const dir of fs.readdirSync(root)) {
    const p = path.join(root, dir);
    if (!ids.has(dir)) {
      fs.rmSync(p, { recursive: true, force: true });
      continue;
    }
    if (!fs.statSync(p).isDirectory()) continue;
    for (const f of fs.readdirSync(p)) if (!files.has(`${dir}/${f}`)) fs.rmSync(path.join(p, f), { force: true });
  }
}

export function startAppUpdates() {
  cleanupFiles();
  setTimeout(() => checkAll().catch((e) => console.error('  app update check failed:', e)), 20_000).unref();
  setInterval(() => checkAll().catch((e) => console.error('  app update check failed:', e)), 12 * 3600e3).unref();
}
