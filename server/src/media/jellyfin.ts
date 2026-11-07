import { getSetting } from '../db.ts';

type Result = { ok: boolean; message: string };

function headers(key: string) {
  return {
    Authorization: `MediaBrowser Token="${key}", Client="Bellhop", Device="Bellhop", DeviceId="bellhop", Version="1.0.0"`,
    'X-Emby-Token': key,
  };
}

async function call(path: string, method: string, url = getSetting('jellyfin_url'), key = getSetting('jellyfin_key'), timeout = 8000) {
  if (!url || !key) return { res: null, error: 'Jellyfin is not set up' };
  try {
    const res = await fetch(new URL(path, url.endsWith('/') ? url : url + '/'), {
      method,
      headers: headers(key),
      signal: AbortSignal.timeout(timeout),
    });
    return { res, error: res.ok ? '' : `Jellyfin answered ${res.status} ${res.statusText}` };
  } catch (e) {
    return { res: null, error: `Could not reach Jellyfin: ${(e as Error).message}` };
  }
}

export async function refreshLibrary(): Promise<Result> {
  const { error } = await call('Library/Refresh', 'POST');
  return error ? { ok: false, message: error } : { ok: true, message: 'Jellyfin is scanning the library' };
}

export async function testJellyfin(url?: string, key?: string): Promise<Result> {
  const { res, error } = await call('System/Info', 'GET', url || undefined, key || undefined);
  if (error || !res) return { ok: false, message: error };
  const info = (await res.json()) as { ServerName?: string; Version?: string };
  return { ok: true, message: `Connected to ${info.ServerName ?? 'Jellyfin'} ${info.Version ?? ''}`.trim() };
}

/** Counts and play time per kind, straight from Jellyfin's own index. Times are in seconds. */
export type WatchStats = {
  movies: { count: number; seconds: number };
  series: { count: number; episodes: number; seconds: number };
  music: { albums: number; tracks: number; seconds: number };
};

const TICKS_PER_SECOND = 1e7; // a tick is 100 ns

export async function watchStats(url?: string, key?: string): Promise<{ ok: true; stats: WatchStats } | { ok: false; message: string }> {
  // Every item of a type, without images or per-user data, so even a big library is a small answer.
  const query = async (type: string, countOnly = false) => {
    const q = new URLSearchParams({
      Recursive: 'true',
      IncludeItemTypes: type,
      IsMissing: 'false',
      EnableImages: 'false',
      EnableUserData: 'false',
      EnableTotalRecordCount: 'true',
    });
    if (countOnly) q.set('Limit', '0');
    const { res, error } = await call(`Items?${q}`, 'GET', url || undefined, key || undefined, 30000);
    if (error || !res) throw new Error(error);
    const body = (await res.json()) as { Items?: { RunTimeTicks?: number | null }[]; TotalRecordCount?: number };
    const items = body.Items ?? [];
    return {
      count: body.TotalRecordCount ?? items.length,
      seconds: items.reduce((s, i) => s + (i.RunTimeTicks ?? 0), 0) / TICKS_PER_SECOND,
    };
  };
  try {
    const [movies, series, episodes, albums, tracks] = await Promise.all([
      query('Movie'),
      query('Series', true),
      query('Episode'),
      query('MusicAlbum', true),
      query('Audio'),
    ]);
    return {
      ok: true,
      stats: {
        movies,
        series: { count: series.count, episodes: episodes.count, seconds: episodes.seconds },
        music: { albums: albums.count, tracks: tracks.count, seconds: tracks.seconds },
      },
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
