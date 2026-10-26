import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { cx } from '../lib/format.ts';
import type { LookupResult } from '../lib/types.ts';
import { Input, Poster, Spinner } from './ui.tsx';

export type LookupKind = 'movie' | 'series' | 'music';

/** Debounced title search against TMDB (movies, series) or MusicBrainz (music). */
export function useLookup(type: LookupKind, query: string) {
  const [results, setResults] = useState<LookupResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    const timer = setTimeout(async () => {
      try {
        const r = await api.get<LookupResult[]>(`/lookup?type=${type}&q=${encodeURIComponent(q)}`);
        if (!cancelled) {
          setResults(r);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [type, query]);

  return { results, loading, error };
}

const placeholders: Record<LookupKind, string> = {
  movie: 'Search movies, e.g. Dune',
  series: 'Search shows, e.g. Severance',
  music: 'Search albums or artists',
};

export function MediaSearch({
  type,
  onPick,
  initialQuery = '',
  compact,
}: {
  type: LookupKind;
  onPick: (r: LookupResult) => void;
  initialQuery?: string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const { results, loading, error } = useLookup(type, query);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input autoFocus className="pl-9" placeholder={placeholders[type]} value={query} onChange={(e) => setQuery(e.target.value)} />
        {loading && <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2" />}
      </div>
      {error && <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p>}
      {!loading && query.trim().length >= 2 && !results.length && !error && (
        <p className="text-sm text-muted">Nothing found. Try another spelling, or type it in yourself.</p>
      )}
      {results.length > 0 && (
        <div className={cx('grid gap-3', compact ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4')}>
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r)}
              className="group cursor-pointer text-left"
            >
              <Poster
                media={r}
                type={type}
                className={cx(
                  'w-full ring-accent transition group-hover:ring-2',
                  type === 'music' ? 'aspect-square' : 'aspect-[2/3]',
                )}
              />
              <div className="mt-1.5 line-clamp-2 text-sm leading-snug font-medium">{r.title}</div>
              <div className="truncate text-xs text-muted">{[r.year, r.subtitle].filter(Boolean).join(' · ')}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
