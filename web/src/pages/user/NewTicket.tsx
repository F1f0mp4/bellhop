import { AlertTriangle, Pencil, Send } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { MediaSearch, type LookupKind } from '../../components/MediaSearch.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Button, Card, Field, Input, PageTitle, Poster, StatusPill, Textarea } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { cx } from '../../lib/format.ts';
import { isMedia, TYPE_INFO, TYPES } from '../../lib/labels.ts';
import type { LookupResult, MediaRef, Status, Ticket, TicketType } from '../../lib/types.ts';
import { useFetch } from '../../lib/useFetch.ts';

type Duplicate = { id: number; title: string; status: Status; username: string };

export function NewTicket() {
  const [type, setType] = useState<TicketType | null>(null);

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title="What can we do for you?" subtitle="Pick one. You'll get updates on the request page." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {TYPES.map((t) => {
          const info = TYPE_INFO[t];
          const Icon = info.icon;
          const active = type === t;
          return (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cx(
                'group flex cursor-pointer flex-col items-start gap-3 rounded-xl border p-4 text-left transition',
                active ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-muted/50',
                t === 'issue' && 'col-span-2 sm:col-span-1',
              )}
            >
              <span className={cx('grid size-9 place-items-center rounded-lg', info.tone)}>
                <Icon className="size-4.5" />
              </span>
              <span>
                <span className="block text-sm font-medium">{info.label}</span>
                <span className="mt-0.5 hidden text-xs leading-snug text-muted sm:block">{info.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      {type && (
        <div key={type} className="animate-rise mt-6">
          {isMedia(type) ? <MediaForm type={type as LookupKind} /> : <TextForm type={type} />}
        </div>
      )}
    </div>
  );
}

function useSubmit() {
  const navigate = useNavigate();
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const submit = async (body: { type: TicketType; title: string; body: string; media_ref?: MediaRef | null }) => {
    setBusy(true);
    try {
      const t = await api.post<Ticket>('/tickets', body);
      notify('Request sent. You will see updates here.');
      navigate(`/requests/${t.id}`);
    } catch (e) {
      notify((e as Error).message, 'error');
      setBusy(false);
    }
  };
  return { submit, busy };
}

function TextForm({ type }: { type: TicketType }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const { submit, busy } = useSubmit();
  const issue = type === 'issue';

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit({ type, title, body });
  };

  return (
    <Card className="p-5">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={issue ? "What's wrong?" : "What's the idea?"}>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={issue ? 'e.g. Jellyfin keeps buffering on the living room TV' : 'e.g. Add a shared family photo library'}
            maxLength={200}
          />
        </Field>
        <Field label="Details" hint={issue ? 'When did it start? Which device? Any error message?' : 'Why would it help? Anything you have in mind?'}>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>
            <Send className="size-4" /> Send
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MediaForm({ type }: { type: LookupKind }) {
  const { data: status } = useFetch<{ tmdb: boolean }>('/lookup/status');
  const canSearch = type === 'music' || status?.tmdb;
  const [picked, setPicked] = useState<LookupResult | null>(null);
  const [manual, setManual] = useState(false);
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [note, setNote] = useState('');
  const [dupes, setDupes] = useState<Duplicate[]>([]);
  const { submit, busy } = useSubmit();

  const useManual = manual || (status && !canSearch);
  const finalTitle = useManual ? title.trim() : picked?.title ?? '';

  useEffect(() => {
    const ref = useManual ? '' : picked?.id ?? '';
    const t = finalTitle;
    if (!ref && !t) return setDupes([]);
    const timer = setTimeout(() => {
      api
        .get<Duplicate[]>(`/tickets/duplicates?type=${type}&ref=${encodeURIComponent(ref)}&title=${encodeURIComponent(t)}`)
        .then(setDupes, () => setDupes([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [picked, finalTitle, useManual, type]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const media_ref: MediaRef | null = useManual
      ? { source: 'manual', id: '', title: title.trim(), year: year.trim() || undefined }
      : picked && { source: picked.source, id: picked.id, title: picked.title, year: picked.year, poster: picked.poster, subtitle: picked.subtitle };
    const label = media_ref?.year ? `${finalTitle} (${media_ref.year})` : finalTitle;
    submit({ type, title: label, body: note, media_ref });
  };

  if (!status) return null;

  return (
    <Card className="p-5">
      <form onSubmit={onSubmit} className="space-y-5">
        {useManual ? (
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field label="Title">
              <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={180} />
            </Field>
            <Field label="Year">
              <Input inputMode="numeric" placeholder="optional" value={year} onChange={(e) => setYear(e.target.value)} maxLength={4} />
            </Field>
            {canSearch && (
              <button type="button" onClick={() => setManual(false)} className="cursor-pointer text-left text-sm text-accent hover:underline">
                Search instead
              </button>
            )}
          </div>
        ) : picked ? (
          <div className="flex gap-4">
            <Poster media={picked} type={type} className={cx('w-24', type === 'music' ? 'aspect-square' : 'aspect-[2/3]')} />
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold">{picked.title}</div>
              <div className="text-sm text-muted">{[picked.year, picked.subtitle].filter(Boolean).join(' · ')}</div>
              {picked.overview && <p className="mt-2 line-clamp-3 text-sm text-muted">{picked.overview}</p>}
              <Button type="button" variant="ghost" size="sm" className="mt-2 -ml-3" onClick={() => setPicked(null)}>
                <Pencil className="size-3.5" /> Pick another
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <MediaSearch type={type} onPick={(r) => setPicked(r)} />
            <button type="button" onClick={() => setManual(true)} className="cursor-pointer text-sm text-accent hover:underline">
              Can't find it? Type it in
            </button>
          </div>
        )}

        {dupes.length > 0 && (
          <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
            <div className="space-y-1">
              {dupes.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    Already requested by <b>{d.username}</b>
                  </span>
                  <StatusPill status={d.status} />
                </div>
              ))}
              <div className="text-muted">You can still send yours, but it's probably on the way.</div>
            </div>
          </div>
        )}

        {(picked || useManual) && (
          <>
            <Field label="Anything else?" hint="Language, a specific season, director's cut…">
              <Textarea className="min-h-20" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={busy} disabled={!finalTitle}>
                <Send className="size-4" /> Request it
              </Button>
            </div>
          </>
        )}
      </form>
    </Card>
  );
}
