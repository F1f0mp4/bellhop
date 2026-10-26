import { ArrowLeft, BookOpen, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../components/Toast.tsx';
import { Button, Dialog, Empty, Input, PageTitle, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { ago } from '../../lib/format.ts';
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

export function WikiIndex() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const q = query.trim();
  const { data, loading } = useFetch<WikiSummary[]>(`/wiki${q ? `?q=${encodeURIComponent(q)}` : ''}`);

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle
        title="Wiki"
        subtitle="How things work around here."
        actions={
          user?.role === 'admin' && (
            <Link to="/wiki/new">
              <Button variant="primary">
                <Plus className="size-4" /> New page
              </Button>
            </Link>
          )
        }
      />
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input className="pl-9" placeholder="Search pages" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {!data && loading && <Spinner />}
      {data && !data.length && (
        <Empty icon={<BookOpen className="size-5" />} title={q ? 'Nothing matches' : 'No pages yet'}>
          {q ? 'Try another word.' : user?.role === 'admin' ? 'Start with the Wi-Fi password, how to join the Minecraft servers, or house rules for the media server.' : 'Check back soon.'}
        </Empty>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {data?.map((p) => (
          <li key={p.slug}>
            <Link to={`/wiki/${p.slug}`} className="block h-full rounded-xl border border-line bg-surface p-4 transition hover:border-muted/50">
              <div className="font-medium">{p.title}</div>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{plain(p.excerpt) || 'Empty page'}</p>
              <div className="mt-2 text-xs text-muted">Updated {ago(p.updated_at)}</div>
            </Link>
          </li>
        ))}
      </ul>
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
          <h1 className="font-display text-5xl leading-tight tracking-tight">{page.title}</h1>
          <p className="mt-1 text-sm text-muted">
            Updated {ago(page.updated_at)}
            {page.updated_by && ` by ${page.updated_by}`}
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
