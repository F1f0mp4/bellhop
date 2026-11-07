import { PackageOpen, Search, Settings2 } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Button, Empty, Input, PageTitle, Spinner } from '../../components/ui.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { cx } from '../../lib/format.ts';
import { detectPlatform, PLATFORM_INFO, PLATFORMS } from '../../lib/platform.ts';
import type { Catalog, CatalogApp, Platform } from '../../lib/types.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { AppIcon, GetButton, SourceCard } from './parts.tsx';

const PICK_KEY = 'bellhop-apps-platform';

function usePlatform() {
  const detected = useMemo(detectPlatform, []);
  const [picked, setPicked] = useState<Platform | 'all' | null>(() => {
    try {
      return (sessionStorage.getItem(PICK_KEY) as Platform | 'all' | null) ?? null;
    } catch {
      return null;
    }
  });
  const value = picked ?? detected ?? 'all';
  const set = (p: Platform | 'all') => {
    try {
      sessionStorage.setItem(PICK_KEY, p);
    } catch {}
    setPicked(p);
  };
  return { value, detected, set };
}

const matches = (a: CatalogApp, q: string) =>
  !q || [a.name, a.subtitle, a.developer, a.category].some((s) => s.toLowerCase().includes(q));

function byCategory(apps: CatalogApp[]) {
  const groups = new Map<string, CatalogApp[]>();
  for (const a of apps) groups.set(a.category || 'Other', [...(groups.get(a.category || 'Other') ?? []), a]);
  return [...groups];
}

export function Apps() {
  const { user } = useAuth();
  const { data, error } = useFetch<Catalog>('/apps');
  const platform = usePlatform();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const p = platform.value === 'all' ? null : platform.value;

  const everything = data?.apps ?? [];
  const forPlatform = everything.filter((a) => !p || a.downloads.some((d) => d.platform === p));
  const shown = forPlatform.filter((a) => matches(a, q));
  const featured = q ? [] : forPlatform.filter((a) => a.featured);
  const hidden = everything.length - forPlatform.length;

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle
        title="Apps"
        subtitle="Open source apps picked for this house. Some download straight from the server."
        actions={
          user?.role === 'admin' && (
            <Link to="/admin/apps">
              <Button>
                <Settings2 className="size-4" /> Manage
              </Button>
            </Link>
          )
        }
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="radiogroup" aria-label="Show apps for">
          <div className="inline-flex rounded-full border border-line bg-surface p-0.5">
            {(['all', ...PLATFORMS] as const).map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={platform.value === v}
                onClick={() => platform.set(v)}
                className={cx(
                  'shrink-0 cursor-pointer rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors',
                  platform.value === v ? 'bg-fg font-medium text-bg' : 'text-muted hover:text-fg',
                )}
              >
                {v === 'all' ? 'Everything' : PLATFORM_INFO[v].label}
                {v === platform.detected && <span className="sr-only"> (this device)</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search apps" className="rounded-full pl-9" aria-label="Search apps" />
        </div>
      </div>

      {error ? (
        <Empty icon={<PackageOpen className="size-5" />} title="Couldn't load the apps">
          {error}
        </Empty>
      ) : !data ? (
        <Spinner />
      ) : !everything.length ? (
        <Empty icon={<PackageOpen className="size-5" />} title="No apps yet">
          {user?.role === 'admin' ? (
            <>
              Add some under <Link to="/admin/apps" className="text-accent hover:underline">Manage</Link>, or start from the starter list.
            </>
          ) : (
            'Nothing has been added here yet.'
          )}
        </Empty>
      ) : (
        <div className="space-y-10">
          {featured.length > 0 && <FeaturedShelf apps={featured} platform={p} />}

          {p === 'ios' && data.source && !q && <SourceCard source={data.source} />}

          {!shown.length && (
            <Empty icon={<Search className="size-5" />} title={q ? `Nothing matches "${query.trim()}"` : 'Nothing here for this device'}>
              {p && <button className="cursor-pointer text-accent hover:underline" onClick={() => platform.set('all')}>Show apps for every device</button>}
            </Empty>
          )}

          {byCategory(shown).map(([category, apps]) => (
            <section key={category} aria-labelledby={`cat-${category}`}>
              <h2 id={`cat-${category}`} className="mb-1 text-xl font-semibold tracking-tight">
                {category}
              </h2>
              <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
                {apps.map((a) => (
                  <li key={a.id} className="flex min-w-0 items-center gap-3 border-b border-line py-3">
                    <Link to={`/apps/${a.slug}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg">
                      <AppIcon app={a} className="size-14" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{a.name}</span>
                        <span className="block truncate text-sm text-muted">{a.subtitle || a.developer}</span>
                      </span>
                    </Link>
                    <GetButton app={a} platform={p} />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {p && hidden > 0 && !q && (
            <p className="text-sm text-muted">
              {hidden} more {hidden === 1 ? 'app is' : 'apps are'} for other devices.{' '}
              <button className="cursor-pointer text-accent hover:underline" onClick={() => platform.set('all')}>
                Show everything
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The App Store's big cards: each one in the app's own colour, the icon set large against it. */
function FeaturedShelf({ apps, platform }: { apps: CatalogApp[]; platform: Platform | null }) {
  return (
    <section aria-label="Featured">
      <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
        {apps.map((a) => {
          const tint = a.tint || 'var(--accent)';
          return (
            <article
              key={a.id}
              className="relative flex h-64 w-[min(26rem,85vw)] shrink-0 snap-start flex-col overflow-hidden rounded-3xl p-5 text-white sm:h-72"
              style={{ background: `color-mix(in oklab, ${tint} 88%, black)` } as CSSProperties}
            >
              {/* The icon, oversized and tilted off the corner, is the card's picture. */}
              <AppIcon app={a} className="pointer-events-none absolute -top-6 -right-8 size-52 rotate-[8deg] opacity-95 shadow-2xl sm:size-60" />
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: `linear-gradient(to top, color-mix(in oklab, ${tint} 70%, black) 30%, transparent 75%)` }}
              />
              <Link to={`/apps/${a.slug}`} className="relative mt-auto block max-w-[85%] rounded-lg">
                <span className="block text-sm text-white/75">{a.category}</span>
                <span className="mt-0.5 block font-display text-4xl leading-[1.05] tracking-tight sm:text-5xl">{a.name}</span>
                <span className="mt-1.5 block text-sm leading-snug text-white/85">{a.subtitle}</span>
              </Link>
              <div className="relative mt-4 flex items-center justify-between gap-3">
                <span className="truncate text-xs text-white/70">{a.developer !== a.name && a.developer}</span>
                <GetButton app={a} platform={platform} tone="onColor" />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
