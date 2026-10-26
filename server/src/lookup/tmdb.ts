import { getSetting } from '../db.ts';

export type LookupResult = {
  source: 'tmdb' | 'musicbrainz';
  id: string;
  title: string;
  year?: string;
  poster?: string;
  subtitle?: string;
  overview?: string;
};

const IMG = 'https://image.tmdb.org/t/p/w342';

// Accepts either a v3 API key or a v4 read access token (the long "eyJ..." one).
function request(path: string, params: Record<string, string>, key = getSetting('tmdb_key')) {
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);
  return fetch(url, { headers, signal: AbortSignal.timeout(8000) });
}

export const tmdbEnabled = () => Boolean(getSetting('tmdb_key'));

export async function searchTmdb(kind: 'movie' | 'series', query: string, year?: string): Promise<LookupResult[]> {
  const isMovie = kind === 'movie';
  const res = await request(isMovie ? 'search/movie' : 'search/tv', {
    query,
    include_adult: 'false',
    [isMovie ? 'year' : 'first_air_date_year']: year ?? '',
  });
  if (!res.ok) throw new Error(`TMDB answered ${res.status}`);
  const data = (await res.json()) as { results: any[] };
  return data.results.slice(0, 12).map((r) => {
    const date: string = (isMovie ? r.release_date : r.first_air_date) ?? '';
    return {
      source: 'tmdb',
      id: `${isMovie ? 'movie' : 'tv'}:${r.id}`,
      title: isMovie ? r.title : r.name,
      year: date.slice(0, 4) || undefined,
      poster: r.poster_path ? IMG + r.poster_path : undefined,
      overview: r.overview,
    };
  });
}

export async function testTmdb(key?: string) {
  const res = await request('configuration', {}, key || getSetting('tmdb_key'));
  return res.ok ? { ok: true, message: 'TMDB key works' } : { ok: false, message: `TMDB answered ${res.status}` };
}
