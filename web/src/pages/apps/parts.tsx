import { Check, Copy, Download, ExternalLink, HardDrive } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast.tsx';
import { Dialog } from '../../components/ui.tsx';
import { bytes, cx } from '../../lib/format.ts';
import { FROM_LABEL, PLATFORM_INFO, sideloadLinks } from '../../lib/platform.ts';
import type { AppDownload, CatalogApp, Platform } from '../../lib/types.ts';

/** A rounded-square app icon. Without a picture, the app's colour and first letter stand in. */
export function AppIcon({ app, className }: { app: Pick<CatalogApp, 'name' | 'icon' | 'tint'>; className?: string }) {
  const [broken, setBroken] = useState(false);
  const tint = app.tint || 'var(--accent)';
  return (
    <span
      className={cx('relative grid shrink-0 place-items-center overflow-hidden rounded-[23%] text-white select-none', className)}
      style={{ background: app.icon && !broken ? 'var(--surface-2)' : tint, containerType: 'inline-size' } as CSSProperties}
    >
      {app.icon && !broken ? (
        <img src={app.icon} alt="" loading="lazy" className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span className="font-display text-[55cqw] leading-none">{app.name.slice(0, 1)}</span>
      )}
      <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-black/8 ring-inset dark:ring-white/10" />
    </span>
  );
}

/** Where Get goes on this platform. Sideloadable .ipa files come after the App Store. */
export function choicesFor(app: CatalogApp, platform: Platform | null) {
  return platform ? app.downloads.filter((d) => d.platform === platform) : [];
}

const isFile = (d: AppDownload) => d.from === 'server' || d.from === 'github';

export function downloadName(d: AppDownload) {
  return d.label || PLATFORM_INFO[d.platform].label;
}

/** The pill button. One way to get the app opens it straight away; several open a sheet. */
export function GetButton({ app, platform, tone = 'plain' }: { app: CatalogApp; platform: Platform | null; tone?: 'plain' | 'onColor' }) {
  const [open, setOpen] = useState(false);
  const choices = choicesFor(app, platform);
  const cls = cx(
    'inline-flex h-8 min-w-[4.5rem] shrink-0 cursor-pointer items-center justify-center rounded-full px-4 text-sm font-semibold transition-[filter,background-color]',
    tone === 'plain' ? 'bg-surface-2 text-accent hover:brightness-95 dark:hover:brightness-125' : 'bg-white/95 text-neutral-900 hover:bg-white',
  );
  if (!choices.length) {
    return (
      <Link to={`/apps/${app.slug}`} className={cls} aria-label={`View ${app.name}`}>
        View
      </Link>
    );
  }
  const only = choices.length === 1 && !choices[0].sideload ? choices[0] : null;
  if (only) {
    return (
      <a href={only.href} {...linkProps(only)} className={cls} aria-label={`Get ${app.name} (${FROM_LABEL[only.from]})`}>
        Get
      </a>
    );
  }
  return (
    <>
      <button type="button" className={cls} onClick={() => setOpen(true)} aria-label={`Get ${app.name}`}>
        Get
      </button>
      <GetSheet app={app} platform={platform!} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export const linkProps = (d: AppDownload) =>
  d.from === 'server' ? { download: d.file_name ?? true } : { target: '_blank', rel: 'noreferrer' };

function GetSheet({ app, platform, open, onClose }: { app: CatalogApp; platform: Platform; open: boolean; onClose: () => void }) {
  const choices = choicesFor(app, platform);
  return (
    <Dialog open={open} onClose={onClose} title={`Get ${app.name}`}>
      <p className="-mt-2 mb-4 text-sm text-muted">for {PLATFORM_INFO[platform].label}</p>
      <div className="space-y-2">
        {choices.map((d) => (
          <DownloadRow key={d.id} d={d} onPick={onClose} />
        ))}
      </div>
    </Dialog>
  );
}

/** One way to get an app: a store page, a website, or a file (from this server or GitHub). */
export function DownloadRow({ d, onPick }: { d: AppDownload; onPick?: () => void }) {
  if (d.sideload) return <SideloadRow d={d} />;
  const Icon = d.from === 'server' ? HardDrive : isFile(d) ? Download : ExternalLink;
  return (
    <a
      href={d.href}
      {...linkProps(d)}
      onClick={onPick}
      className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 transition-colors hover:border-accent/60"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{downloadName(d)}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
          <span className={cx(d.from === 'server' && 'text-emerald-700 dark:text-emerald-400')}>{FROM_LABEL[d.from]}</span>
          {d.version && <span>Version {d.version}</span>}
          {d.size ? <span>{bytes(d.size)}</span> : null}
        </div>
      </div>
      <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-accent transition-colors group-hover:bg-accent group-hover:text-accent-fg">
        <Icon className="size-4" />
      </span>
    </a>
  );
}

/** An .ipa can't be opened on an iPhone directly; SideStore or AltStore installs it. */
function SideloadRow({ d }: { d: AppDownload }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3.5 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{downloadName(d)}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
            <span className="text-emerald-700 dark:text-emerald-400">From this server</span>
            {d.version && <span>Version {d.version}</span>}
            {d.size ? <span>{bytes(d.size)}</span> : null}
          </div>
        </div>
        <a href={d.href} download={d.file_name ?? true} className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline">
          .ipa file
        </a>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {sideloadLinks('install', d.sideload!).map((l) => (
          <a
            key={l.name}
            href={l.href}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-surface-2 text-sm font-medium text-fg transition-colors hover:bg-accent hover:text-accent-fg"
          >
            Install with {l.name}
          </a>
        ))}
      </div>
    </div>
  );
}

/** Explains the house source and adds it to SideStore or AltStore in one tap. */
export function SourceCard({ source, compact }: { source: string; compact?: boolean }) {
  const notify = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify("Couldn't copy, press and hold the address instead", 'error');
    }
  };
  return (
    <section className="rounded-2xl border border-line bg-accent-soft/60 p-4 sm:p-5">
      <h2 className="font-semibold">Install apps on iPhone and iPad from this server</h2>
      {!compact && (
        <p className="mt-1 max-w-prose text-sm text-muted">
          Some apps here aren't on the App Store. With SideStore or AltStore on your iPhone, add this server once and they show up there, with
          updates.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {sideloadLinks('source', source).map((l) => (
          <a
            key={l.name}
            href={l.href}
            className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg shadow-sm hover:brightness-110"
          >
            Add to {l.name}
          </a>
        ))}
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm text-muted hover:text-fg"
        >
          {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
          {copied ? 'Copied' : 'Copy address'}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        Don't have either yet? See <Link to="/apps/sidestore" className="text-accent hover:underline">SideStore</Link>. The address works
        like a password, so keep it in the house.
      </p>
    </section>
  );
}
