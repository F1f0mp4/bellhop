import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { watchStats } from '../src/media/jellyfin.ts';
import { SizeIndex } from '../src/media/sizes.ts';

function put(file: string, bytes: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes));
}

// Shows/ with one series, Jellyfin's hidden folders included, plus the upload staging folder at the root.
function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bellhop-sizes-'));
  const show = path.join(root, 'Shows', '1883 (2021)');
  put(path.join(show, 'Season 01', '1883 S01E01.mkv'), 1000);
  put(path.join(show, 'Season 01', '1883 S01E02.mkv'), 2000);
  put(path.join(show, 'Season 01', '.chapters', 'S01E01.xml'), 30);
  put(path.join(show, 'Season 01', '1883 S01E01.trickplay', '320 - 10x10', '0.jpg'), 400);
  put(path.join(show, 'poster.jpg'), 5);
  put(path.join(root, 'Movies', 'Heat (1995)', 'Heat (1995).mkv'), 7000);
  put(path.join(root, 'Music', 'Pink Floyd', 'Animals (1977)', '01 Pigs on the Wing.flac'), 100);
  put(path.join(root, 'Music', 'Pink Floyd', 'Animals (1977)', '02 Dogs.flac'), 200);
  put(path.join(root, 'Music', 'Pink Floyd', 'Animals (1977)', 'cover.jpg'), 10);
  put(path.join(root, '.bellhop-tmp', 'upload'), 99999);
  return { root, show, shows: path.join(root, 'Shows'), movies: path.join(root, 'Movies'), music: path.join(root, 'Music') };
}

test('one walk sizes every folder, hidden Jellyfin folders included', async () => {
  const { root, show, shows, music } = library();
  const idx = new SizeIndex(root, ['.bellhop-tmp']);
  await idx.rescanAll();
  assert.deepEqual(idx.get(show), { bytes: 3435, files: 5, audio: 0, folders: 1 });
  // .chapters takes space but, being hidden, isn't counted as a subfolder; the .trickplay folder is visible.
  assert.deepEqual(idx.get(path.join(show, 'Season 01')), { bytes: 3430, files: 4, audio: 0, folders: 1 });
  assert.deepEqual(idx.get(shows), { bytes: 3435, files: 5, audio: 0, folders: 1 });
  // Audio files are counted as tracks; the cover isn't.
  assert.deepEqual(idx.get(music), { bytes: 310, files: 3, audio: 2, folders: 1 });
  // The staging folder is left out of the root total.
  assert.deepEqual(idx.get(root), { bytes: 10745, files: 9, audio: 2, folders: 3 });
  assert.ok(idx.scannedAt);
});

test('an import refreshes the new folder and its parents without a full walk', async () => {
  const { root, shows } = library();
  const idx = new SizeIndex(root, ['.bellhop-tmp']);
  await idx.rescanAll();
  const andor = path.join(shows, 'Andor (2022)');
  put(path.join(andor, 'Season 01', 'Andor S01E01.mkv'), 500);
  await idx.changed(andor);
  assert.equal(idx.get(andor)?.bytes, 500);
  assert.deepEqual(idx.get(shows), { bytes: 3935, files: 6, audio: 0, folders: 2 });
  assert.equal(idx.get(root)?.bytes, 11245);
});

test('a delete drops the folder and its children from the cache', async () => {
  const { root, show, shows } = library();
  const idx = new SizeIndex(root, ['.bellhop-tmp']);
  await idx.rescanAll();
  fs.rmSync(show, { recursive: true });
  await idx.changed(show);
  assert.equal(idx.get(show), undefined);
  assert.equal(idx.get(path.join(show, 'Season 01')), undefined);
  assert.deepEqual(idx.get(shows), { bytes: 0, files: 0, audio: 0, folders: 0 });
  assert.equal(idx.get(root)?.bytes, 7310);
});

test('a rename moves the size to the new name', async () => {
  const { root, movies } = library();
  const idx = new SizeIndex(root, ['.bellhop-tmp']);
  await idx.rescanAll();
  const from = path.join(movies, 'Heat (1995)');
  const to = path.join(movies, 'Heat [1995]');
  fs.renameSync(from, to);
  await idx.changed(from, to);
  assert.equal(idx.get(from), undefined);
  assert.equal(idx.get(to)?.bytes, 7000);
  assert.equal(idx.get(movies)?.bytes, 7000);
});

test('busy is true while a walk is queued and paths outside the root are ignored', async () => {
  const { root } = library();
  const idx = new SizeIndex(root);
  const walk = idx.rescanAll();
  assert.equal(idx.busy, true);
  await walk;
  assert.equal(idx.busy, false);
  await idx.changed(path.join(os.tmpdir(), 'elsewhere'));
  assert.equal(idx.get(path.join(os.tmpdir(), 'elsewhere')), undefined);
});

// A stand-in for Jellyfin's Items API: two movies and a series with two episodes (one with no runtime yet).
const seen: string[] = [];
const items: Record<string, { RunTimeTicks?: number | null }[]> = {
  Movie: [{ RunTimeTicks: 2 * 3600e7 }, { RunTimeTicks: 3600e7 }],
  Series: [{}],
  Episode: [{ RunTimeTicks: 45 * 60e7 }, { RunTimeTicks: null }],
};
const jf = http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://x');
  seen.push(`${req.headers['x-emby-token']} ${url.pathname}?${url.searchParams.get('IncludeItemTypes')}`);
  if (req.headers['x-emby-token'] !== 'secret') {
    res.statusCode = 401;
    return res.end();
  }
  const list = items[url.searchParams.get('IncludeItemTypes')!] ?? [];
  const limit = url.searchParams.get('Limit');
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ Items: limit === '0' ? [] : list, TotalRecordCount: list.length }));
});
await new Promise<void>((r) => jf.listen(0, '127.0.0.1', r));
const jfUrl = `http://127.0.0.1:${(jf.address() as net.AddressInfo).port}`;
after(() => jf.close());

test('adds up Jellyfin runtimes per kind', async () => {
  const r = await watchStats(jfUrl, 'secret');
  assert.deepEqual(r, {
    ok: true,
    stats: {
      movies: { count: 2, seconds: 3 * 3600 },
      series: { count: 1, episodes: 2, seconds: 45 * 60 },
    },
  });
  assert.ok(seen.includes('secret /Items?Episode'));
  // Music lives in Navidrome, so Jellyfin is never asked about it.
  assert.ok(!seen.some((s) => /Audio|MusicAlbum/.test(s)));
});

test('reports why Jellyfin numbers are missing', async () => {
  const r = await watchStats(jfUrl, 'wrong');
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.message : '', /401/);
});
