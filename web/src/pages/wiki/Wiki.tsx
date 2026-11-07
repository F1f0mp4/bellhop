import { ArrowLeft, BookOpen, Folder, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useToast } from '../../components/Toast.tsx';
import { Button, Dialog, Empty, Input, PageTitle, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { ago, cx } from '../../lib/format.ts';
import { renderMarkdown } from '../../lib/markdown.ts';
import type { WikiPage, WikiSummary } from '../../lib/types.ts';
import { useFetch } from '../../lib/useFetch.ts';

const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, l) => l ?? t)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Page groups by category, A–Z, with uncategorised pages last. */
function byCategory(pages: WikiSummary[]) {
  const groups = new Map<string, WikiSummary[]>();
  for (const p of pages) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
  return [...groups].sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b, undefined, { sensitivity: 'base' })));
}

export function WikiIndex() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const q = query.trim();
  const { data, loading } = useFetch<WikiSummary[]>(`/wiki${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  // The chips come from every page, so they stay put while searching.
  const { data: everything } = useFetch<WikiSummary[]>('/wiki');
  const categories = useMemo(() => byCategory(everything ?? []).map(([c]) => c).filter(Boolean), [everything]);
  const picked = params.get('category');
  const category = picked !== null && categories.includes(picked) ? picked : null;
  const shown = useMemo(() => (data ?? []).filter((p) => category === null || p.category === category), [data, category]);
  const groups = byCategory(shown);
  const headings = categories.length > 0 && category === null;

  const pick = (c: string | null) => setParams(c === null ? {} : { category: c }, { replace: true });

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle
        title="Wiki"
        subtitle="How things work around here."
        actions={
          user?.role === 'admin' && (
            <Link to={`/wiki/new${category ? `?category=${encodeURIComponent(category)}` : ''}`}>
              <Button variant="primary">
                <Plus className="size-4" /> New page
              </Button>
            </Link>
          )
        }
      />
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input className="pl-9" placeholder="Search pages" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {categories.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1.5" role="group" aria-label="Categories">
          {[null, ...categories].map((c) => (
            <button
              key={c ?? ''}
              type="button"
              onClick={() => pick(c)}
              aria-pressed={category === c}
              className={cx(
                'cursor-pointer rounded-full border px-3 py-1 text-sm transition-colors',
                category === c ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted hover:border-muted/50 hover:text-fg',
              )}
            >
              {c ?? 'All'}
            </button>
          ))}
        </div>
      )}
      {!data && loading && <Spinner />}
      {data && !shown.length && (
        <Empty icon={<BookOpen className="size-5" />} title={q || category ? 'Nothing matches' : 'No pages yet'}>
          {q ? 'Try another word.' : category ? 'No pages in this category yet.' : user?.role === 'admin' ? 'Start with the Wi-Fi password, how to join the Minecraft servers, or house rules for the media server.' : 'Check back soon.'}
        </Empty>
      )}
      <div className="space-y-6">
        {groups.map(([c, pages]) => (
          <section key={c} aria-label={headings ? c || 'Other' : undefined}>
            {headings && <h2 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">{c || 'Other'}</h2>}
            <ul className="grid gap-2 sm:grid-cols-2">
              {pages.map((p) => (
                <li key={p.slug}>
                  <Link to={`/wiki/${p.slug}`} className="block h-full rounded-xl border border-line bg-surface p-4 transition hover:border-muted/50">
                    <div className="font-medium">{p.title}</div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">{plain(p.excerpt) || 'Empty page'}</p>
                    <div className="mt-2 text-xs text-muted">
                      {p.created_by && `By ${p.created_by} · `}Updated {ago(p.updated_at)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Rendered Markdown where links inside the app navigate without a page reload. */
export function Prose({ html }: { html: string }) {
  const navigate = useNavigate();
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!a || !href?.startsWith('/') || a.target || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    navigate(href);
  };
  return <div onClick={onClick} className="prose prose-bellhop max-w-none" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function WikiView() {
  const { slug } = useParams();
  const { user } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();
  const { data: page, error } = useFetch<WikiPage>(`/wiki/${slug}`);
  const { data: all } = useFetch<WikiSummary[]>('/wiki');
  const [confirm, setConfirm] = useState(false);
  const admin = user?.role === 'admin';

  const html = useMemo(() => (page ? renderMarkdown(page.body, all ? new Set(all.map((p) => p.slug)) : undefined) : ''), [page, all]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <Empty icon={<BookOpen className="size-5" />} title="No page here yet">
          {admin ? (
            <Link to={`/wiki/new?title=${encodeURIComponent(slug ?? '')}`} className="text-accent underline">
              Create it
            </Link>
          ) : (
            <Link to="/wiki" className="text-accent underline">
              Back to the wiki
            </Link>
          )}
        </Empty>
      </div>
    );
  }
  if (!page) return <Spinner />;

  const remove = async () => {
    try {
      await api.del(`/wiki/${page.slug}`);
      notify(`Deleted "${page.title}"`);
      navigate('/wiki');
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  return (
    <article className="mx-auto max-w-3xl">
      <Link to="/wiki" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Wiki
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          {page.category && (
            <Link
              to={`/wiki?category=${encodeURIComponent(page.category)}`}
              className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
            >
              <Folder className="size-3.5" /> {page.category}
            </Link>
          )}
          <h1 className="font-display text-5xl leading-tight tracking-tight">{page.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {page.created_by && (
              <span title={new Date(page.created_at).toLocaleString()}>
                Added by {page.created_by} {ago(page.created_at)} ·{' '}
              </span>
            )}
            Updated {ago(page.updated_at)}
            {page.updated_by && page.updated_by !== page.created_by && ` by ${page.updated_by}`}
          </p>
        </div>
        {admin && (
          <div className="flex gap-1">
            <Link to={`/wiki/${page.slug}/edit`}>
              <Button size="sm">
                <Pencil className="size-3.5" /> Edit
              </Button>
            </Link>
            <Button size="sm" variant="ghost" className="hover:text-rose-500" onClick={() => setConfirm(true)} aria-label="Delete page">
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
      {page.body.trim() ? <Prose html={html} /> : <p className="text-muted">This page is empty.</p>}

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Delete "${page.title}"?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={remove}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">Links to it from other pages will show as missing. This can't be undone.</p>
      </Dialog>
    </article>
  );
}
