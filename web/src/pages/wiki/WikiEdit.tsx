import { Bold, Code, Folder, Heading2, ImagePlus, Italic, Link2, List, ListChecks, Quote, Table } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
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

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
const MAX_IMAGE_MB = 10;
let uploadSeq = 0;

/** Alt text from a file name: "router-setup.png" becomes "router-setup". */
const altFor = (file: File) => file.name.replace(/\.[^.]+$/, '').replace(/[[\]]/g, '').trim() || 'image';

const filesOf = (dt: DataTransfer | null) => {
  if (!dt) return [];
  const fromItems = [...dt.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f);
  return (fromItems.length ? fromItems : [...dt.files]).filter((f) => f.type.startsWith('image/'));
};

// Keyed by page so switching from one page's editor to another starts fresh.
export function WikiEdit() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  return <Editor key={`${slug ?? 'new'}:${params.get('title') ?? ''}:${params.get('category') ?? ''}`} />;
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
  const [category, setCategory] = useState(isNew ? params.get('category') ?? '' : '');
  const [loaded, setLoaded] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const saved = useRef({ title: isNew ? title : '', body: isNew ? STARTER : '', category: isNew ? category : '' });
  const categories = useMemo(() => [...new Set((all ?? []).map((p) => p.category).filter(Boolean))].sort(), [all]);

  useEffect(() => {
    if (page && !loaded) {
      setTitle(page.title);
      setBody(page.body);
      setCategory(page.category);
      saved.current = { title: page.title, body: page.body, category: page.category };
      setLoaded(true);
    }
  }, [page, loaded]);

  const dirty =
    loaded && (title !== saved.current.title || body !== saved.current.body || category.trim() !== saved.current.category.trim());
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
      const res = isNew
        ? await api.post<WikiPage>('/wiki', { title, body, category })
        : await api.put<WikiPage>(`/wiki/${slug}`, { title, body, category });
      saved.current = { title, body, category };
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

  // The latest text, even before React re-renders, so uploads finishing together don't undo each other.
  const text = useRef(body);
  text.current = body;
  // Where the cursor goes once the new text is on screen.
  const caret = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    const el = area.current;
    if (!caret.current || !el) return;
    // Safari focuses a field on setSelectionRange, so leave the cursor alone if the user moved on.
    if (document.activeElement === el) el.setSelectionRange(...caret.current);
    caret.current = null;
  }, [body]);

  const setText = (next: string, cursor?: [number, number]) => {
    text.current = next;
    if (cursor) caret.current = cursor;
    setBody(next);
  };

  /** Replaces one piece of the text, keeping the cursor on the same spot in what the user wrote. */
  const swap = (find: string, put: string) => {
    const b = text.current;
    const at = b.indexOf(find);
    if (at < 0) return false;
    const end = at + find.length;
    const el = area.current;
    const [s, e] = caret.current ?? [el?.selectionStart ?? 0, el?.selectionEnd ?? 0];
    const move = (p: number) => (p >= end ? p + put.length - find.length : p > at ? at + put.length : p);
    setText(b.slice(0, at) + put + b.slice(end), el ? [move(s), move(e)] : undefined);
    return true;
  };

  /**
   * Puts a placeholder line at the cursor for each image right away, then swaps in the real
   * Markdown once the upload is done, so typing can carry on meanwhile.
   */
  const addImages = (files: File[]) => {
    const tooBig = files.filter((f) => f.size > MAX_IMAGE_MB * 1048576);
    if (tooBig.length) notify(`${tooBig.map((f) => f.name).join(', ')} is over ${MAX_IMAGE_MB} MB`, 'error');
    const ok = files.filter((f) => !tooBig.includes(f));
    if (!ok.length) return;

    const el = area.current;
    const b = text.current;
    const [s, e] = caret.current ?? [el?.selectionStart ?? b.length, el?.selectionEnd ?? b.length];
    // A blank line above, or Markdown folds the images into the list or paragraph before them.
    const lineAbove = b.slice(0, s).split('\n').slice(-2);
    const before = s === 0 ? '' : lineAbove[1] !== '' ? '\n\n' : lineAbove[0].trim() ? '\n' : '';
    // Each job remembers exactly what it added, so a failed upload can take it all back out.
    const jobs = ok.map((file, i) => {
      const token = `![Uploading ${altFor(file)}…](#upload-${++uploadSeq})`;
      return { file, token, added: `${i === 0 ? before : ''}${token}\n` };
    });
    const insert = jobs.map((j) => j.added).join('');
    setView('write');
    el?.focus();
    setText(b.slice(0, s) + insert + b.slice(e), [s + insert.length, s + insert.length]);

    setUploading((n) => n + jobs.length);
    for (const { file, token, added } of jobs) {
      api
        .upload<{ url: string }>('/wiki/images', file)
        .then(({ url }) => swap(token, `![${altFor(file)}](${url})`))
        .catch((err) => {
          if (!swap(added, '')) swap(token, '');
          notify(`${file.name}: ${(err as Error).message}`, 'error');
        })
        .finally(() => setUploading((n) => n - 1));
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesOf(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    addImages(files);
  };

  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');
  const onDragOver = (e: DragEvent<HTMLTextAreaElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };
  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    setDragging(false);
    if (!hasFiles(e)) return;
    e.preventDefault();
    const files = filesOf(e.dataTransfer);
    if (files.length) addImages(files);
    else notify('Only images can be dropped here', 'error');
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
          <span className="hidden text-xs text-muted sm:inline">
            {uploading ? `Uploading ${uploading} image${uploading === 1 ? '' : 's'}…` : dirty ? 'Unsaved changes' : 'Saved'}
          </span>
          <Button variant="ghost" onClick={() => navigate(isNew ? '/wiki' : `/wiki/${slug}`)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={save}
            loading={saving}
            disabled={!title.trim() || uploading > 0}
            title={uploading ? 'Wait for images to finish uploading' : 'Save (⌘S / Ctrl+S)'}
          >
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
          <button
            type="button"
            title="Add an image (or paste or drop one into the text)"
            aria-label="Add an image"
            onClick={() => picker.current?.click()}
            className="grid size-8 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
          >
            <ImagePlus className="size-4" />
          </button>
          <input
            ref={picker}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = ''; // picking the same file again should still fire
              if (files.length) addImages(files);
            }}
          />
        </div>
        <label className="relative" title="Pages with the same category are grouped together in the wiki">
          <Folder className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            list="wiki-categories"
            maxLength={40}
            placeholder="Category"
            aria-label="Category"
            className="h-9 w-48 pl-9"
          />
          <datalist id="wiki-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
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
          onPaste={onPaste}
          onDragOver={onDragOver}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          spellCheck
          className={cx(
            'min-h-[60vh] w-full resize-y rounded-xl border border-line bg-surface p-4 font-mono text-sm leading-relaxed text-fg focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none',
            dragging && 'border-accent ring-2 ring-accent/25',
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
