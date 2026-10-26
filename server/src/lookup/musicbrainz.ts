import type { LookupResult } from './tmdb.ts';

// MusicBrainz needs no key, only a descriptive User-Agent and about one request a second.
export async function searchMusic(query: string): Promise<LookupResult[]> {
  const url = new URL('https://musicbrainz.org/ws/2/release-group/');
  url.searchParams.set('query', query);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', '12');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Bellhop/1.0 (self-hosted request desk)', accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`MusicBrainz answered ${res.status}`);
  const data = (await res.json()) as { 'release-groups': any[] };
  return data['release-groups'].map((r) => ({
    source: 'musicbrainz',
    id: r.id,
    title: r.title,
    year: r['first-release-date']?.slice(0, 4) || undefined,
    subtitle: [r['artist-credit']?.map((a: any) => a.name).join(', '), r['primary-type']].filter(Boolean).join(' · '),
    poster: `https://coverartarchive.org/release-group/${r.id}/front-250`,
  }));
}
