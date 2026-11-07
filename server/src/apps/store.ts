import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { config } from '../config.ts';
import { IMAGE_TYPES, sniffImage, type ImageExt } from '../wikiImages.ts';
import { repoInfo } from './github.ts';

export const appsDir = () => path.join(config.dataDir, 'apps');
export const filesDir = () => path.join(appsDir(), 'files');
export const iconsDir = () => path.join(appsDir(), 'icons');

const MAX_ICON_BYTES = 5 * 1024 * 1024;
const ICON_NAME = /^[0-9a-f]{24}\.(png|jpg|gif|webp)$/;

/** Keeps a release file's own name, minus anything that could leave its folder or upset a header. */
export function safeFileName(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).replace(/[^\w.\-+() ]/g, '_').replace(/^\.+/, '');
  return base.slice(-120) || 'download';
}

/** A stored download, or undefined if `rel` doesn't point inside the files folder. */
export function storedFile(rel: string | null | undefined): string | undefined {
  if (!rel) return;
  const root = filesDir();
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return;
  return fs.existsSync(file) ? file : undefined;
}

/** Deletes a stored download, and its folder once that's empty. */
export function removeStored(rel: string | null | undefined) {
  const file = storedFile(rel);
  if (!file) return;
  fs.rmSync(file, { force: true });
  const dir = path.dirname(file);
  if (dir !== filesDir() && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
}

export function saveIcon(bytes: Uint8Array): string {
  const ext = sniffImage(bytes);
  if (!ext) throw new Error('Icons can be PNG, JPEG, GIF or WebP');
  const name = `${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24)}.${ext}`;
  fs.mkdirSync(iconsDir(), { recursive: true });
  const file = path.join(iconsDir(), name);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(`${file}.tmp`, bytes);
    fs.renameSync(`${file}.tmp`, file);
  }
  return name;
}

export function iconFile(name: string): { file: string; type: string } | undefined {
  const m = ICON_NAME.exec(name);
  if (!m) return;
  const file = path.join(iconsDir(), name);
  return fs.existsSync(file) ? { file, type: IMAGE_TYPES[m[1] as ImageExt] } : undefined;
}

async function fetchLimited(url: string, max: number, accept = '*/*'): Promise<{ bytes: Uint8Array; type: string; url: string }> {
  const res = await fetch(url, { headers: { 'user-agent': 'Bellhop', accept }, signal: AbortSignal.timeout(15_000), redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${new URL(url).host} answered ${res.status}`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > max) throw new Error('That file is too large');
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), type: res.headers.get('content-type') ?? '', url: res.url || url };
}

/** Downloads an image and stores it as an icon. App Store page links are turned into their artwork. */
export async function fetchIcon(url: string): Promise<string> {
  const storeId = appStoreId(url);
  if (storeId) {
    const art = await appStoreArtwork(storeId);
    if (!art) throw new Error('The App Store has no app with that link');
    url = art;
  }
  const { bytes } = await fetchLimited(url, MAX_ICON_BYTES, 'image/*');
  return saveIcon(bytes);
}

export function appStoreId(url: string): string | undefined {
  return /^https:\/\/(?:apps|itunes)\.apple\.com\/.*\/id(\d{5,})/i.exec(url)?.[1];
}

async function appStoreArtwork(id: string): Promise<string | undefined> {
  const { bytes } = await fetchLimited(`https://itunes.apple.com/lookup?id=${id}`, 1024 * 1024, 'application/json');
  const r = JSON.parse(Buffer.from(bytes).toString('utf8')).results?.[0];
  return r?.artworkUrl512 ?? r?.artworkUrl100;
}

/** The biggest apple-touch-icon a website lists, which is usually its app icon. */
async function touchIcon(homepage: string): Promise<string | undefined> {
  const { bytes, url } = await fetchLimited(homepage, 1024 * 1024, 'text/html');
  const html = Buffer.from(bytes).toString('utf8');
  let best: { href: string; size: number } | undefined;
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel\s*=\s*["'][^"']*apple-touch-icon/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    const size = Number(/sizes\s*=\s*["'](\d+)x\d+/i.exec(tag)?.[1] ?? 180);
    if (!best || size > best.size) best = { href: href.replace(/&#x2F;/gi, '/').replace(/&amp;/g, '&'), size };
  }
  return new URL(best?.href ?? '/apple-touch-icon.png', url).href;
}

/**
 * Finds an icon for an app without the admin having to: the App Store listing, then the website's
 * touch icon, then the GitHub organisation's picture. Personal GitHub avatars are skipped, since a
 * developer's face isn't the app's icon.
 */
export async function findIcon(app: { icon_url: string; homepage: string; repo: string }, links: string[]): Promise<string | undefined> {
  const attempts: (() => Promise<string | undefined>)[] = [];
  if (app.icon_url) attempts.push(async () => app.icon_url);
  const storeLink = links.find((l) => appStoreId(l));
  if (storeLink) attempts.push(async () => storeLink);
  if (app.homepage) attempts.push(() => touchIcon(app.homepage));
  if (app.repo) {
    attempts.push(async () => {
      const info = await repoInfo(app.repo);
      return info.owner_is_org ? `${info.owner_avatar}${info.owner_avatar.includes('?') ? '&' : '?'}s=256` : undefined;
    });
  }
  for (const attempt of attempts) {
    try {
      const url = await attempt();
      if (url) return await fetchIcon(url);
    } catch {}
  }
}

/** Streams a stored file, with Range support so big downloads can resume. */
export function sendFile(file: string, name: string, req: Request, type = 'application/octet-stream'): Response {
  const size = fs.statSync(file).size;
  const headers: Record<string, string> = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'content-disposition': `attachment; filename="${name.replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=0, must-revalidate',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else {
      start = Math.max(0, size - Number(range[2]));
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    }
    status = 206;
    headers['content-range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['content-length'] = String(end - start + 1);
  if (req.method === 'HEAD' || size === 0) return new Response(null, { status, headers });
  const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
  return new Response(stream, { status, headers });
}

/** How much the kept copies take up on disk. */
export function storedBytes(): number {
  let total = 0;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) total += fs.statSync(p).size;
    }
  };
  if (fs.existsSync(filesDir())) walk(filesDir());
  return total;
}
