import { ArrowLeft, ExternalLink, PackageOpen, Pencil } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, Empty, Spinner } from '../../components/ui.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { ago } from '../../lib/format.ts';
import { detectPlatform, PLATFORM_INFO, PLATFORMS } from '../../lib/platform.ts';
import type { Catalog, CatalogApp } from '../../lib/types.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { AppIcon, DownloadRow, GetButton, SourceCard } from './parts.tsx';

export function AppDetail() {
  const { slug } = useParams();
  const { user } = useAuth();
  const { data: app, error } = useFetch<CatalogApp>(`/apps/${encodeURIComponent(slug ?? '')}`);
  // The source address comes with the catalog; only needed when this app can be sideloaded.
  const needsSource = Boolean(app?.downloads.some((d) => d.sideload));
  const { data: catalog } = useFetch<Catalog>(needsSource ? '/apps' : null);
  const platform = useMemo(detectPlatform, []);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <Back />
        <Empty icon={<PackageOpen className="size-5" />} title="That app isn't here">
          {error}
        </Empty>
      </div>
    );
  }
  if (!app) return <Spinner />;

  const platforms = PLATFORMS.filter((p) => app.downloads.some((d) => d.platform === p));
  // This device first, the rest after.
  const ordered = platform && platforms.includes(platform) ? [platform, ...platforms.filter((p) => p !== platform)] : platforms;
  const latest = app.downloads.map((d) => d.released_at).filter(Boolean).sort().at(-1);

  return (
    <div className="mx-auto max-w-3xl">
      <Back />

      <header className="flex gap-4 sm:gap-6">
        <AppIcon app={app} className="size-24 sm:size-32" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">{app.name}</h1>
          {app.developer &&
            (app.homepage ? (
              <a href={app.homepage} target="_blank" rel="noreferrer" className="mt-0.5 w-fit text-sm text-accent hover:underline">
                {app.developer}
              </a>
            ) : (
              <span className="mt-0.5 text-sm text-muted">{app.developer}</span>
            ))}
          {app.subtitle && <p className="mt-1 text-sm text-muted">{app.subtitle}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
            <GetButton app={app} platform={platform} />
            {user?.role === 'admin' && (
              <Link to={`/admin/apps/${app.id}`}>
                <Button variant="ghost" size="sm">
                  <Pencil className="size-3.5" /> Edit
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <dl className="mt-6 grid grid-cols-2 divide-line border-y border-line py-3 sm:grid-cols-4 sm:divide-x">
        <Fact label="Version">{app.version ?? 'Varies'}</Fact>
        <Fact label="Updated">{latest ? ago(latest) : '—'}</Fact>
        <Fact label="Licence">{app.license || 'Open source'}</Fact>
        <Fact label="Category">{app.category || 'Other'}</Fact>
      </dl>

      {app.description && (
        <div className="mt-6 max-w-prose space-y-3 leading-relaxed">
          {app.description.split(/\n{2,}/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      {(app.repo || app.homepage) && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {app.homepage && (
            <a href={app.homepage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              Website <ExternalLink className="size-3.5" />
            </a>
          )}
          {app.repo && (
            <a href={`https://github.com/${app.repo}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              Source code <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      )}

      <h2 className="mt-10 mb-3 text-xl font-semibold tracking-tight">Downloads</h2>
      {!ordered.length ? (
        <p className="text-sm text-muted">Nothing to download yet.</p>
      ) : (
        <div className="space-y-6">
          {ordered.map((p) => {
            const Icon = PLATFORM_INFO[p].icon;
            return (
              <section key={p}>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted">
                  <Icon className="size-4" />
                  {PLATFORM_INFO[p].label}
                  {p === platform && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-fg">This device</span>}
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {app.downloads
                    .filter((d) => d.platform === p)
                    .map((d) => (
                      <DownloadRow key={d.id} d={d} />
                    ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {needsSource && catalog?.source && (
        <div className="mt-8">
          <SourceCard source={catalog.source} />
        </div>
      )}
    </div>
  );
}

function Back() {
  return (
    <Link to="/apps" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
      <ArrowLeft className="size-4" /> Apps
    </Link>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-3 py-1.5 first:pl-0 sm:text-center sm:first:pl-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-medium">{children}</dd>
    </div>
  );
}
