import { Bold, Code, Heading2, Italic, Link2, List, ListChecks, Quote, Table } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useToast } from '../../components/Toast.tsx';
import { Button, Input, Spinner, Tabs } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { cx } from '../../lib/format.ts';
import { renderMarkdown } from '../../lib/markdown.ts';
import type { WikiPage, WikiSummary } from '../../lib/types.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { Prose } from './Wiki.tsx';

const STARTER = `Write in **Markdown**. Link to another page with [[Page title]].

## Example

- Server address: \`mc.example.com\`
- Ask in the request desk if you need access
`;

type Edit = { before: string; after: string; placeholder: string; block?: boolean };

const TOOLS: { icon: ReactNode; label: string; edit: Edit }[] = [
  { icon: <Heading2 className="size-4" />, label: 'Heading', edit: { before: '## ', after: '', placeholder: 'Heading', block: true } },
  { icon: <Bold className="size-4" />, label: 'Bold', edit: { before: '**', after: '**', placeholder: 'bold' } },
  { icon: <Italic className="size-4" />, label: 'Italic', edit: { before: '_', after: '_', placeholder: 'italic' } },
  { icon: <Link2 className="size-4" />, label: 'Link to a wiki page', edit: { before: '[[', after: ']]', placeholder: 'Page title' } },
  { icon: <List className="size-4" />, label: 'List', edit: { before: '- ', after: '', placeholder: 'item', block: true } },
  { icon: <ListChecks className="size-4" />, label: 'Checklist', edit: { before: '- [ ] ', after: '', placeholder: 'to do', block: true } },
  { icon: <Quote className="size-4" />, label: 'Note', edit: { before: '> ', after: '', placeholder: 'note', block: true } },
  { icon: <Code className="size-4" />, label: 'Code', edit: { before: '`', after: '`', placeholder: 'code' } },
  {
    icon: <Table className="size-4" />,
    label: 'Table',
    edit: { before: '| Name | Value |\n| --- | --- |\n| ', after: ' |  |', placeholder: 'Wi-Fi', block: true },
  },
];

// Keyed by page so switching from one page's editor to another starts fresh.
export function WikiEdit() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  return <Editor key={`${slug ?? 'new'}:${params.get('title') ?? ''}`} />;
}

function Editor() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const notify = useToast();
  const isNew = !slug;
  const { data: page } = useFetch<WikiPage>(isNew ? null : `/wiki/${slug}`);
  const { data: all } = useFetch<WikiSummary[]>('/wiki');
  const [title, setTitle] = useState(isNew ? params.get('title') ?? '' : '');
  const [body, setBody] = useState(isNew ? STARTER : '');
  const [loaded, setLoaded] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'write' | 'preview'>('write');
  const area = useRef<HTMLTextAreaElement>(null);
  const saved = useRef({ title: isNew ? title : '', body: isNew ? STARTER : '' });

  useEffect(() => {
    if (page && !loaded) {
      setTitle(page.title);
      setBody(page.body);
      saved.current = { title: page.title, body: page.body };
      setLoaded(true);
    }
  }, [page, loaded]);

  const dirty = loaded && (title !== saved.current.title || body !== saved.current.body);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !saving && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('Leave without saving? Your changes will be lost.')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => dirty && e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const html = useMemo(() => renderMarkdown(body, all ? new Set(all.map((p) => p.slug)) : undefined), [body, all]);

  const save = async () => {
    setSaving(true);
    try {
      const res = isNew ? await api.post<WikiPage>('/wiki', { title, body }) : await api.put<WikiPage>(`/wiki/${slug}`, { title, body });
      saved.current = { title, body };
      notify('Page saved');
      navigate(`/wiki/${res.slug}`);
    } catch (e) {
      notify((e as Error).message, 'error');
      setSaving(false);
    }
  };

  const apply = ({ before, after, placeholder, block }: Edit) => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const selected = body.slice(s, e) || placeholder;
    const needsBreak = block && s > 0 && body[s - 1] !== '\n' ? '\n' : '';
    const insert = `${needsBreak}${before}${selected}${after}`;
    setBody(body.slice(0, s) + insert + body.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      const start = s + needsBreak.length + before.length;
      el.setSelectionRange(start, start + selected.length);
    });
  };

  if (!loaded) return <Spinner />;

  return (
    <div
      className="mx-auto max-w-6xl"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault();
          save();
        }
      }}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Page title"
          autoFocus={isNew}
          className="h-12 min-w-0 flex-1 basis-64 border-transparent bg-transparent px-0 font-display text-4xl focus:border-transparent focus:ring-0"
          aria-label="Page title"
        />
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted sm:inline">{dirty ? 'Unsaved changes' : 'Saved'}</span>
          <Button variant="ghost" onClick={() => navigate(isNew ? '/wiki' : `/wiki/${slug}`)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!title.trim()} title="Save (⌘S / Ctrl+S)">
            Save
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface p-0.5">
          {TOOLS.map((t) => (
            <button
              key={t.label}
              type="button"
              title={t.label}
              aria-label={t.label}
              onClick={() => {
                setView('write');
                apply(t.edit);
              }}
              className="grid size-8 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
            >
              {t.icon}
            </button>
          ))}
        </div>
        <div className="ml-auto lg:hidden">
          <Tabs
            value={view}
            onChange={setView}
            options={[
              { value: 'write', label: 'Write' },
              { value: 'preview', label: 'Preview' },
            ]}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <textarea
          ref={area}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck
          className={cx(
            'min-h-[60vh] w-full resize-y rounded-xl border border-line bg-surface p-4 font-mono text-sm leading-relaxed text-fg focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none',
            view === 'preview' && 'max-lg:hidden',
          )}
          aria-label="Page content in Markdown"
        />
        <div className={cx('min-h-[60vh] overflow-auto rounded-xl border border-dashed border-line p-5', view === 'write' && 'max-lg:hidden')}>
          {body.trim() ? <Prose html={html} /> : <p className="text-sm text-muted">Preview shows up here.</p>}
        </div>
      </div>
    </div>
  );
}
