import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAdmin, requireUser, type AppEnv } from '../auth.ts';
import { SECRET_SETTINGS, settingDefaults } from '../config.ts';
import { getSetting, setSetting } from '../db.ts';
import { searchMusic } from '../lookup/musicbrainz.ts';
import { searchTmdb, testTmdb, tmdbEnabled } from '../lookup/tmdb.ts';
import { testJellyfin } from '../media/jellyfin.ts';
import { sanitize } from '../media/naming.ts';

export const settingsRoutes = new Hono<AppEnv>().use(requireAdmin);

// Secrets never leave the server; the UI only learns whether one is set.
settingsRoutes.get('/', (c) => {
  const out: Record<string, string | boolean> = {};
  for (const key of Object.keys(settingDefaults)) {
    if (SECRET_SETTINGS.has(key)) out[`has_${key}`] = Boolean(getSetting(key));
    else out[key] = getSetting(key);
  }
  return c.json(out);
});

settingsRoutes.put('/', async (c) => {
  const body = await c.req.json<Record<string, string | null>>();
  for (const [key, value] of Object.entries(body)) {
    if (!(key in settingDefaults)) continue;
    if (SECRET_SETTINGS.has(key)) {
      if (value === null) setSetting(key, '');
      else if (value) setSetting(key, value.trim());
      continue;
    }
    let v = (value ?? '').trim();
    if (key.endsWith('_dir')) {
      v = sanitize(v);
      if (v === 'Unknown') throw new HTTPException(400, { message: 'Folder names cannot be empty' });
    }
    if (key === 'jellyfin_url' && v && !/^https?:\/\//.test(v)) {
      throw new HTTPException(400, { message: 'Jellyfin URL should start with http:// or https://' });
    }
    setSetting(key, v);
  }
  return c.json({ ok: true });
});

settingsRoutes.post('/test-jellyfin', async (c) => {
  const { url, key } = await c.req.json<{ url?: string; key?: string }>();
  return c.json(await testJellyfin(url, key));
});

settingsRoutes.post('/test-tmdb', async (c) => {
  const { key } = await c.req.json<{ key?: string }>();
  return c.json(await testTmdb(key));
});

export const lookupRoutes = new Hono<AppEnv>().use(requireUser);

lookupRoutes.get('/status', (c) => c.json({ tmdb: tmdbEnabled(), music: true }));

lookupRoutes.get('/', async (c) => {
  const type = c.req.query('type');
  const q = c.req.query('q')?.trim();
  if (!q || q.length < 2) return c.json([]);
  try {
    if (type === 'music') return c.json(await searchMusic(q));
    if (type === 'movie' || type === 'series') {
      if (!tmdbEnabled()) return c.json([]);
      return c.json(await searchTmdb(type, q, c.req.query('year')));
    }
  } catch {
    const source = type === 'music' ? 'MusicBrainz' : 'TMDB';
    throw new HTTPException(502, { message: `Couldn't reach ${source} right now, try again in a moment` });
  }
  throw new HTTPException(400, { message: 'Unknown lookup type' });
});
