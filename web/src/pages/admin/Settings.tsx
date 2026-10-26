import { CheckCircle2, FolderOpen, XCircle } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useToast } from '../../components/Toast.tsx';
import { Button, Card, Field, Input, PageTitle, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { useFetch } from '../../lib/useFetch.ts';

type SettingsData = {
  jellyfin_url: string;
  has_jellyfin_key: boolean;
  has_tmdb_key: boolean;
  movies_dir: string;
  shows_dir: string;
  music_dir: string;
};

type Folder = { path: string; exists: boolean; writable: boolean };
type MediaStatus = { library: Folder; incoming: Folder };
type TestResult = { ok: boolean; message: string };

export function Settings() {
  const notify = useToast();
  const { data, reload } = useFetch<SettingsData>('/settings');
  const { data: status } = useFetch<MediaStatus>('/media/status');
  const [form, setForm] = useState({ jellyfin_url: '', jellyfin_key: '', tmdb_key: '', movies_dir: '', shows_dir: '', music_dir: '' });
  const [busy, setBusy] = useState(false);
  const [jfTest, setJfTest] = useState<TestResult | null>(null);
  const [tmdbTest, setTmdbTest] = useState<TestResult | null>(null);

  useEffect(() => {
    if (data) setForm((f) => ({ ...f, jellyfin_url: data.jellyfin_url, movies_dir: data.movies_dir, shows_dir: data.shows_dir, music_dir: data.music_dir }));
  }, [data]);

  if (!data) return <Spinner />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put('/settings', form);
      setForm((f) => ({ ...f, jellyfin_key: '', tmdb_key: '' }));
      notify('Settings saved');
      reload();
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const test = async (which: 'jellyfin' | 'tmdb') => {
    if (which === 'jellyfin') {
      setJfTest(null);
      setJfTest(await api.post<TestResult>('/settings/test-jellyfin', { url: form.jellyfin_url, key: form.jellyfin_key }));
    } else {
      setTmdbTest(null);
      setTmdbTest(await api.post<TestResult>('/settings/test-tmdb', { key: form.tmdb_key }));
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Settings" />
      <form onSubmit={save} className="space-y-6">
        <Section title="Jellyfin" text="Bellhop asks Jellyfin to rescan after every import. Create a key in Jellyfin under Dashboard → API Keys.">
          <Field label="Server URL" hint="As this container sees it, e.g. http://jellyfin:8096 or http://192.168.1.10:8096">
            <Input value={form.jellyfin_url} onChange={set('jellyfin_url')} placeholder="http://jellyfin:8096" />
          </Field>
          <Field label="API key">
            <Input
              type="password"
              value={form.jellyfin_key}
              onChange={set('jellyfin_key')}
              placeholder={data.has_jellyfin_key ? '•••••••• saved, type to replace' : 'Paste key'}
              autoComplete="off"
            />
          </Field>
          <TestRow onTest={() => test('jellyfin')} result={jfTest} />
        </Section>

        <Section
          title="Movie and show search"
          text={
            <>
              A free TMDB key adds posters and search to movie and series requests. Get one at themoviedb.org → Settings → API. Music search
              uses MusicBrainz and needs nothing.
            </>
          }
        >
          <Field label="TMDB API key or read access token">
            <Input
              type="password"
              value={form.tmdb_key}
              onChange={set('tmdb_key')}
              placeholder={data.has_tmdb_key ? '•••••••• saved, type to replace' : 'Paste key'}
              autoComplete="off"
            />
          </Field>
          <TestRow onTest={() => test('tmdb')} result={tmdbTest} />
        </Section>

        <Section title="Library folders" text="Folder names inside your media folder. Match what your Jellyfin libraries point at.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Movies">
              <Input value={form.movies_dir} onChange={set('movies_dir')} />
            </Field>
            <Field label="Series">
              <Input value={form.shows_dir} onChange={set('shows_dir')} />
            </Field>
            <Field label="Music">
              <Input value={form.music_dir} onChange={set('music_dir')} />
            </Field>
          </div>
          {status && (
            <div className="space-y-2 rounded-lg bg-surface-2 p-3 text-sm">
              <FolderLine name="Media" f={status.library} />
              <FolderLine name="Incoming" f={status.incoming} optional />
            </div>
          )}
        </Section>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy}>
            Save settings
          </Button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, text, children }: { title: string; text: ReactNode; children: ReactNode }) {
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted">{text}</p>
      </div>
      {children}
    </Card>
  );
}

function TestRow({ onTest, result }: { onTest: () => Promise<void>; result: TestResult | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          await onTest().finally(() => setBusy(false));
        }}
      >
        Test connection
      </Button>
      {result && (
        <span className={`inline-flex items-center gap-1.5 text-sm ${result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-300'}`}>
          {result.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
          {result.message}
        </span>
      )}
    </div>
  );
}

function FolderLine({ name, f, optional }: { name: string; f: Folder; optional?: boolean }) {
  const ok = f.exists && f.writable;
  return (
    <div className="flex items-center gap-2">
      <FolderOpen className="size-4 text-muted" />
      <span className="w-20 text-muted">{name}</span>
      <code className="truncate text-xs">{f.path}</code>
      <span className={`ml-auto shrink-0 text-xs ${ok ? 'text-emerald-600 dark:text-emerald-400' : optional ? 'text-muted' : 'text-rose-500'}`}>
        {ok ? 'writable' : f.exists ? 'read-only' : optional ? 'not mounted' : 'missing'}
      </span>
    </div>
  );
}
