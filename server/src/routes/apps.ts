import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { Hono } from 'hono';
import { requireAdmin, requireUser, type AppEnv } from '../auth.ts';
import { all, db, getSetting, now, one, run, setSetting } from '../db.ts';
import { slugify } from '../slug.ts';
import { buildSource } from '../apps/altstore.ts';
import { GitHubError, latestRelease, parseRepo, repoInfo } from '../apps/github.ts';
import { addStarterApps, STARTER_APPS } from '../apps/starter.ts';
import { filesDir, iconFile, removeStored, safeFileName, saveIcon, sendFile, storedBytes, storedFile } from '../apps/store.ts';
import {
  checkAll,
  checkApp,
  cleanVersion,
  downloadProgress,
  isChecking,
  keepsCopy,
  PLATFORMS,
  storeFile,
  type AppRow,
  type DownloadRow,
  type Platform,
} from '../apps/updates.ts';

export const appRoutes = new Hono<AppEnv>();

const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────

function origin(c: Context) {
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0].trim() || new URL(c.req.url).protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host')?.split(',')[0].trim() || c.req.header('host') || new URL(c.req.url).host;
  return `${proto}://${host}`;
}

/** The secret in the AltStore source address. Phones can't sign in, so the address itself is the key. */
function sourceKey() {
  let key = getSetting('apps_source_key');
  if (!key) {
    key = crypto.randomBytes(18).toString('base64url');
    setSetting('apps_source_key', key);
  }
  return key;
}

function checkKey(given: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(sourceKey());
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HTTPException(404, { message: 'Not found' });
}

const sourceUrl = (c: Context) => `${origin(c)}/api/apps/source/${sourceKey()}`;

function linkKind(url: string): string {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  if (/(^|\.)apple\.com$/.test(host)) return 'appstore';
  if (host === 'play.google.com') return 'play';
  if (host === 'f-droid.org') return 'fdroid';
  if (host === 'flathub.org') return 'flathub';
  if (host === 'github.com' || host.endsWith('githubusercontent.com')) return 'github';
  return 'web';
}

const downloadsOf = (appId: number) => all<DownloadRow>('SELECT * FROM app_downloads WHERE app_id = ? ORDER BY position, id', appId);

const fileHref = (d: DownloadRow) => `/api/apps/files/${d.id}/${encodeURIComponent(d.file_name ?? 'download')}`;

/** What everyone sees: where Get goes, and whether it comes from this server. */
function publicDownload(d: DownloadRow, sourceBase: string) {
  const local = d.file && storedFile(d.file) ? fileHref(d) : null;
  const href = local ?? (d.source === 'release' ? d.remote_url : d.source === 'link' ? d.url : null);
  if (!href) return null;
  return {
    id: d.id,
    platform: d.platform,
    label: d.label,
    href,
    from: local ? 'server' : linkKind(href),
    file_name: d.source === 'link' ? null : d.file_name,
    size: d.source === 'link' ? null : d.size,
    version: d.source === 'link' ? null : d.version,
    released_at: d.source === 'link' ? null : d.released_at,
    // An app AltStore or SideStore can install straight from this server.
    sideload: local && d.ipa ? `${sourceBase}/files/${d.id}/${encodeURIComponent(d.file_name!)}` : null,
  };
}

function publicApp(app: AppRow, downloads: DownloadRow[], sourceBase: string) {
  const list = downloads.map((d) => publicDownload(d, sourceBase)).filter((d) => d !== null);
  return {
    id: app.id,
    slug: app.slug,
    name: app.name,
    developer: app.developer,
    subtitle: app.subtitle,
    description: app.description,
    category: app.category,
    homepage: app.homepage,
    license: app.license,
    repo: app.repo,
    icon: app.icon ? `/api/apps/icons/${app.icon}` : null,
    tint: app.tint,
    featured: Boolean(app.featured),
    version: app.release_tag ? cleanVersion(app.release_tag) : (list.find((d) => d.version)?.version ?? null),
    downloads: list,
  };
}

function adminApp(app: AppRow) {
  return {
    ...app,
    featured: Boolean(app.featured),
    icon: app.icon ? `/api/apps/icons/${app.icon}` : null,
    checking: isChecking(app.id),
    downloads: downloadsOf(app.id).map((d) => ({
      ...d,
      keep: Boolean(d.keep),
      ipa: d.ipa ? JSON.parse(d.ipa) : null,
      stored: Boolean(d.file && storedFile(d.file)),
      keeps_copy: keepsCopy(d),
      progress: downloadProgress(d.id) ?? null,
    })),
  };
}

const appById = (id: number) => {
  const app = one<AppRow>('SELECT * FROM apps WHERE id = ?', id);
  if (!app) throw new HTTPException(404, { message: 'App not found' });
  return app;
};

// ── Public: AltStore / SideStore source, protected by the key in its address ───────────────────

appRoutes.get('/source/:key', (c) => {
  checkKey(c.req.param('key'));
  const apps = all<AppRow>('SELECT * FROM apps ORDER BY position, id').map((app) => ({ app, downloads: downloadsOf(app.id) }));
  c.header('cache-control', 'no-cache');
  return c.json(buildSource(sourceUrl(c), origin(c), apps));
});

appRoutes.get('/source/:key/files/:id/:name', (c) => {
  checkKey(c.req.param('key'));
  const d = one<DownloadRow>('SELECT * FROM app_downloads WHERE id = ?', Number(c.req.param('id')));
  const file = d?.ipa ? storedFile(d.file) : undefined;
  if (!d || !file) throw new HTTPException(404, { message: 'File not found' });
  return sendFile(file, d.file_name ?? 'app.ipa', c.req.raw);
});

appRoutes.get('/source/:key/icons/:name', (c) => {
  checkKey(c.req.param('key'));
  return icon(c);
});

// ── Everyone signed in ────────────────────────────────────────────────────────────────────────

function icon(c: Context) {
  const found = iconFile(c.req.param('name') ?? '');
  if (!found) throw new HTTPException(404, { message: 'Icon not found' });
  return c.body(fs.readFileSync(found.file), 200, {
    'content-type': found.type,
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
}

appRoutes.get('/icons/:name', requireUser, icon);

const FILE_TYPES: Record<string, string> = {
  apk: 'application/vnd.android.package-archive',
  dmg: 'application/x-apple-diskimage',
  zip: 'application/zip',
  msi: 'application/x-msi',
};

appRoutes.get('/files/:id/:name', requireUser, (c) => {
  const d = one<DownloadRow>('SELECT * FROM app_downloads WHERE id = ?', Number(c.req.param('id')));
  const file = d && storedFile(d.file);
  if (!d || !file) throw new HTTPException(404, { message: 'That file is no longer on the server' });
  const ext = path.extname(d.file_name ?? '').slice(1).toLowerCase();
  return sendFile(file, d.file_name ?? 'download', c.req.raw, FILE_TYPES[ext]);
});

appRoutes.get('/', requireUser, (c) => {
  const base = sourceUrl(c);
  const apps = all<AppRow>('SELECT * FROM apps ORDER BY position, id').map((a) => publicApp(a, downloadsOf(a.id), base));
  const sideloadable = apps.some((a) => a.downloads.some((d) => d.sideload));
  return c.json({ apps, source: sideloadable ? base : null });
});

// ── Admin ─────────────────────────────────────────────────────────────────────────────────────

appRoutes.get('/admin', requireAdmin, (c) => {
  const apps = all<AppRow>('SELECT * FROM apps ORDER BY position, id').map(adminApp);
  const inCatalog = new Set(apps.map((a) => a.starter).filter(Boolean));
  return c.json({
    apps,
    checking: isChecking(),
    checked_at: getSetting('apps_checked_at') || null,
    stored_bytes: storedBytes(),
    source: sourceUrl(c),
    has_github_token: Boolean(getSetting('github_token')),
    starter_left: STARTER_APPS.filter((a) => !inCatalog.has(a.key)).length,
  });
});

type DownloadInput = { id?: number; platform?: string; label?: string; source?: string; url?: string; asset?: string; keep?: boolean | number };
type AppInput = Partial<Record<'name' | 'developer' | 'subtitle' | 'description' | 'category' | 'repo' | 'homepage' | 'license' | 'icon_url' | 'tint', string>> & {
  featured?: boolean;
  downloads?: DownloadInput[];
};

const bad = (message: string) => new HTTPException(400, { message });

function webUrl(value: string | undefined, what: string): string {
  let v = value?.trim() ?? '';
  if (!v) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
  } catch {
    throw bad(`${what} doesn't look like a web link`);
  }
  return v;
}

export function cleanApp(b: AppInput) {
  const name = b.name?.trim() ?? '';
  if (!name) throw bad('Give the app a name');
  const repoText = b.repo?.trim() ?? '';
  const repo = repoText ? parseRepo(repoText) : '';
  if (repo === undefined) throw bad('Use owner/name or a github.com link for the repo');
  const tint = b.tint?.trim() ?? '';
  if (tint && !/^#[0-9a-f]{6}$/i.test(tint)) throw bad('Colour should look like #3b82f6');
  const downloads = (b.downloads ?? []).map((d, i) => {
    const platform = d.platform as Platform;
    if (!PLATFORMS.includes(platform)) throw bad(`Download ${i + 1}: pick a platform`);
    const source = d.source === 'release' || d.source === 'upload' ? d.source : 'link';
    const asset = d.asset?.trim().slice(0, 120) ?? '';
    const url = source === 'link' ? webUrl(d.url, `Download ${i + 1}'s link`) : '';
    if (source === 'link' && !url) throw bad(`Download ${i + 1}: add the link`);
    if (source === 'release' && !asset) throw bad(`Download ${i + 1}: say which release file, e.g. *.dmg`);
    if (source === 'release' && !repo) throw bad('Release files need the GitHub repo');
    return {
      id: d.id ? Number(d.id) : undefined,
      platform,
      label: d.label?.trim().slice(0, 40) ?? '',
      source,
      url,
      asset: source === 'release' ? asset : '',
      keep: source === 'release' && (d.keep === true || d.keep === 1) ? 1 : 0,
    };
  });
  if (downloads.length > 20) throw bad('That is a lot of downloads; 20 at most');
  return {
    name: name.slice(0, 60),
    developer: b.developer?.trim().slice(0, 60) ?? '',
    subtitle: b.subtitle?.trim().slice(0, 80) ?? '',
    description: b.description?.trim().slice(0, 4000) ?? '',
    category: b.category?.trim().slice(0, 30) ?? '',
    repo,
    homepage: webUrl(b.homepage, 'The website'),
    license: b.license?.trim().slice(0, 40) ?? '',
    icon_url: webUrl(b.icon_url, 'The icon link'),
    tint,
    featured: b.featured ? 1 : 0,
    downloads,
  };
}

function uniqueSlug(name: string, exceptId?: number) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; one('SELECT id FROM apps WHERE slug = ? AND id IS NOT ?', slug, exceptId ?? null); i++) slug = `${base}-${i}`;
  return slug;
}

function saveApp(id: number | undefined, a: ReturnType<typeof cleanApp>) {
  db.exec('BEGIN');
  const removed: DownloadRow[] = [];
  try {
    if (id === undefined) {
      const pos = one<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM apps')!.p;
      const res = run(
        `INSERT INTO apps (slug, name, developer, subtitle, description, category, repo, homepage, license, icon_url, tint, featured, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uniqueSlug(a.name), a.name, a.developer, a.subtitle, a.description, a.category, a.repo, a.homepage, a.license, a.icon_url, a.tint, a.featured, pos,
      );
      id = Number(res.lastInsertRowid);
    } else {
      const old = appById(id);
      // A new icon link, or a new repo or website when the icon was found automatically, means look again.
      const refetchIcon = a.icon_url !== old.icon_url || (!a.icon_url && (a.repo !== old.repo || a.homepage !== old.homepage));
      run(
        `UPDATE apps SET slug = ?, name = ?, developer = ?, subtitle = ?, description = ?, category = ?, repo = ?, homepage = ?, license = ?,
         icon_url = ?, tint = ?, featured = ?, icon = CASE WHEN ? THEN '' ELSE icon END, updated_at = ? WHERE id = ?`,
        a.name === old.name ? old.slug : uniqueSlug(a.name, id), a.name, a.developer, a.subtitle, a.description, a.category, a.repo,
        a.homepage, a.license, a.icon_url, a.tint, a.featured, refetchIcon ? 1 : 0, now(), id,
      );
    }
    const existing = new Map(downloadsOf(id).map((d) => [d.id, d]));
    a.downloads.forEach((d, i) => {
      const prev = d.id ? existing.get(d.id) : undefined;
      if (prev) {
        existing.delete(prev.id);
        // A different file pattern or source means the old file isn't the right one any more.
        const changed = prev.source !== d.source || prev.asset !== d.asset;
        if (changed && prev.file) removed.push(prev);
        run(
          `UPDATE app_downloads SET platform = ?, label = ?, source = ?, url = ?, asset = ?, keep = ?, position = ?
           ${changed ? ', file = NULL, file_name = NULL, size = NULL, version = NULL, remote_url = NULL, sha256 = NULL, ipa = NULL, error = NULL' : ''}
           WHERE id = ?`,
          d.platform, d.label, d.source, d.url, d.asset, d.keep, i, prev.id,
        );
      } else {
        run(
          'INSERT INTO app_downloads (app_id, platform, label, source, url, asset, keep, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          id, d.platform, d.label, d.source, d.url, d.asset, d.keep, i,
        );
      }
    });
    for (const d of existing.values()) {
      removed.push(d);
      run('DELETE FROM app_downloads WHERE id = ?', d.id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  for (const d of removed) removeStored(d.file);
  const appId = id;
  // Icons and release files are fetched in the background; the admin screen shows progress.
  checkApp(appId).catch(() => {});
  return adminApp(appById(appId));
}

appRoutes.post('/', requireAdmin, async (c) => c.json(saveApp(undefined, cleanApp(await c.req.json())), 201));

appRoutes.put('/:id{[0-9]+}', requireAdmin, async (c) => c.json(saveApp(Number(c.req.param('id')), cleanApp(await c.req.json()))));

appRoutes.delete('/:id{[0-9]+}', requireAdmin, (c) => {
  const id = Number(c.req.param('id'));
  const files = downloadsOf(id).map((d) => d.file);
  run('DELETE FROM apps WHERE id = ?', id);
  files.forEach(removeStored);
  return c.json({ ok: true });
});

appRoutes.post('/reorder', requireAdmin, async (c) => {
  const { ids } = await c.req.json<{ ids: number[] }>();
  if (!Array.isArray(ids)) throw bad('Bad order');
  const stmt = db.prepare('UPDATE apps SET position = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    ids.forEach((id, i) => stmt.run(i, Number(id)));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return c.json({ ok: true });
});

appRoutes.post('/check', requireAdmin, (c) => {
  checkAll().catch(() => {});
  return c.json({ ok: true }, 202);
});

appRoutes.post('/:id{[0-9]+}/check', requireAdmin, (c) => {
  const id = appById(Number(c.req.param('id'))).id;
  checkApp(id).catch(() => {});
  return c.json({ ok: true }, 202);
});

appRoutes.post(
  '/:id{[0-9]+}/icon',
  requireAdmin,
  bodyLimit({
    maxSize: 5 * 1024 * 1024,
    onError: () => {
      throw new HTTPException(413, { message: 'Icons can be 5 MB at most' });
    },
  }),
  async (c) => {
    const app = appById(Number(c.req.param('id')));
    let name: string;
    try {
      name = saveIcon(new Uint8Array(await c.req.arrayBuffer()));
    } catch (e) {
      throw new HTTPException(415, { message: (e as Error).message });
    }
    run("UPDATE apps SET icon = ?, icon_url = '', updated_at = ? WHERE id = ?", name, now(), app.id);
    return c.json(adminApp(appById(app.id)));
  },
);

// The file is streamed to disk as it arrives: installers are far too big to hold in memory.
appRoutes.post('/downloads/:id{[0-9]+}/file', requireAdmin, async (c) => {
  const d = one<DownloadRow>('SELECT * FROM app_downloads WHERE id = ?', Number(c.req.param('id')));
  if (!d) throw new HTTPException(404, { message: 'Download not found' });
  if (d.source !== 'upload') throw bad('Switch this download to "Upload" first');
  const name = safeFileName(c.req.query('name') ?? 'download');
  if (d.platform === 'ios' && !/\.ipa$/i.test(name)) throw bad('iPhones and iPads need an .ipa file');
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: 'Files can be 4 GB at most' });
  const body = c.req.raw.body;
  if (!body) throw bad('That file is empty');

  const dir = path.join(filesDir(), String(d.id));
  fs.mkdirSync(dir, { recursive: true });
  const part = path.join(dir, `${name}.${crypto.randomBytes(4).toString('hex')}.part`);
  let received = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      cb(received > MAX_UPLOAD_BYTES ? new HTTPException(413, { message: 'Files can be 4 GB at most' }) : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as any), limit, fs.createWriteStream(part));
    if (!received) throw bad('That file is empty');
    await storeFile(d, part, name, {});
  } catch (e) {
    fs.rmSync(part, { force: true });
    throw e;
  }
  return c.json(adminApp(appById(d.app_id)));
});

/** Name, description, licence and release files for a repo, to fill in the form. */
appRoutes.get('/lookup', requireAdmin, async (c) => {
  const repo = parseRepo(c.req.query('repo') ?? '');
  if (!repo) throw bad('Use owner/name or a github.com link');
  try {
    const info = await repoInfo(repo);
    const release = await latestRelease(info.repo).catch((e) => {
      if (e instanceof GitHubError && e.rateLimited) throw e;
      return null;
    });
    return c.json({ ...info, release: release && { tag: release.tag, assets: release.assets.map((a) => ({ name: a.name, size: a.size })) } });
  } catch (e) {
    throw new HTTPException(e instanceof GitHubError ? 400 : 502, { message: (e as Error).message });
  }
});

appRoutes.get('/starter', requireAdmin, (c) => {
  const inCatalog = new Set(all<{ starter: string }>('SELECT starter FROM apps WHERE starter IS NOT NULL').map((r) => r.starter));
  return c.json(
    STARTER_APPS.map((a) => ({
      key: a.key,
      name: a.name,
      subtitle: a.subtitle,
      category: a.category,
      platforms: [...new Set(a.downloads.map((d) => d.platform))],
      added: inCatalog.has(a.key),
    })),
  );
});

appRoutes.post('/starter', requireAdmin, async (c) => {
  const { keys } = await c.req.json<{ keys: string[] }>();
  if (!Array.isArray(keys)) throw bad('Pick some apps');
  const added = addStarterApps(keys.map(String));
  for (const { id } of all<{ id: number }>(`SELECT id FROM apps WHERE icon = '' OR checked_at IS NULL`)) checkApp(id).catch(() => {});
  return c.json({ added });
});

appRoutes.post('/source/rotate', requireAdmin, (c) => {
  setSetting('apps_source_key', crypto.randomBytes(18).toString('base64url'));
  return c.json({ source: sourceUrl(c) });
});

appRoutes.get('/:slug', requireUser, (c) => {
  const app = one<AppRow>('SELECT * FROM apps WHERE slug = ?', c.req.param('slug'));
  if (!app) throw new HTTPException(404, { message: 'No app with that name' });
  return c.json(publicApp(app, downloadsOf(app.id), sourceUrl(c)));
});
