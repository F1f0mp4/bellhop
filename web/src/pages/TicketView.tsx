import { ArrowLeft, CircleDot, Send, Trash2, Upload } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../components/Toast.tsx';
import { Button, Card, Dialog, Poster, Select, Spinner, StatusPill, Textarea, TypeBadge } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { ago, cx } from '../lib/format.ts';
import { isMedia, PRIORITY_INFO, STATUS_INFO, STATUSES } from '../lib/labels.ts';
import type { Comment, Priority, Status, Ticket } from '../lib/types.ts';
import { useFetch } from '../lib/useFetch.ts';

type Detail = Ticket & { comments: Comment[] };

export function TicketView() {
  const { id } = useParams();
  const { user } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();
  const { data: t, error, reload, setData } = useFetch<Detail>(`/tickets/${id}`);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const admin = user?.role === 'admin';

  if (error) return <p className="text-rose-500">{error}</p>;
  if (!t) return <Spinner />;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      await api.post(`/tickets/${t.id}/comments`, { body: reply });
      setReply('');
      await reload();
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  const update = async (patch: { status?: Status; priority?: Priority }) => {
    try {
      const next = await api.patch<Ticket>(`/tickets/${t.id}`, patch);
      setData({ ...t, ...next });
      await reload();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const remove = async () => {
    try {
      await api.del(`/tickets/${t.id}`);
      notify(admin ? 'Ticket deleted' : 'Request withdrawn');
      navigate(admin ? '/admin' : '/requests');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const media = isMedia(t.type);
  const canDelete = admin || (t.user_id === user?.id && t.status === 'new');

  return (
    <div className="mx-auto max-w-4xl">
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Back
      </button>

      <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
        <div className="min-w-0 space-y-6">
          <div className="flex gap-5">
            {media && (
              <Poster
                media={t.media_ref}
                type={t.type}
                className={cx('w-28 shadow-lg', t.type === 'music' ? 'aspect-square' : 'aspect-[2/3]')}
              />
            )}
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <TypeBadge type={t.type} />
                <StatusPill status={t.status} />
              </div>
              <h1 className="font-display text-4xl leading-tight tracking-tight break-words">{t.title}</h1>
              <p className="mt-1 text-sm text-muted">
                {t.username} · {ago(t.created_at)}
                {t.media_ref?.subtitle && ` · ${t.media_ref.subtitle}`}
              </p>
            </div>
          </div>

          {t.body && (
            <Card className="p-4">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{t.body}</p>
            </Card>
          )}

          <section>
            <h2 className="mb-3 text-sm font-medium text-muted">Activity</h2>
            <ol className="relative space-y-4 border-l border-line pl-5">
              <TimelineEvent text="Request sent" who={t.username} at={t.created_at} />
              {t.comments.map((c) =>
                c.kind === 'event' ? (
                  <TimelineEvent key={c.id} text={c.body} who={c.username} at={c.created_at} />
                ) : (
                  <li key={c.id} className="relative">
                    <span className="absolute top-3 -left-[25px] size-2.5 rounded-full border-2 border-bg bg-muted" />
                    <div
                      className={cx(
                        'rounded-xl border p-3',
                        c.role === 'admin' ? 'border-accent/30 bg-accent-soft' : 'border-line bg-surface',
                      )}
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                        <span className="font-medium text-fg">{c.username ?? 'Removed user'}</span>
                        {c.role === 'admin' && <span className="rounded bg-accent/20 px-1.5 text-[10px] font-semibold text-accent uppercase">admin</span>}
                        <span>{ago(c.created_at)}</span>
                      </div>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{c.body}</p>
                    </div>
                  </li>
                ),
              )}
            </ol>
          </section>

          <form onSubmit={send} className="space-y-2">
            <Textarea
              placeholder={admin ? 'Reply to the requester…' : 'Add a comment or more details…'}
              className="min-h-20"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e);
              }}
            />
            <div className="flex justify-end">
              <Button type="submit" variant="primary" size="sm" loading={sending} disabled={!reply.trim()}>
                <Send className="size-3.5" /> Send
              </Button>
            </div>
          </form>
        </div>

        <aside className="space-y-3">
          {admin && (
            <Card className="space-y-4 p-4">
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted">Status</div>
                <Select value={t.status} onChange={(e) => update({ status: e.target.value as Status })}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_INFO[s].label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted">Priority</div>
                <Select value={t.priority} onChange={(e) => update({ priority: e.target.value as Priority })}>
                  {(Object.keys(PRIORITY_INFO) as Priority[]).map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_INFO[p].label}
                    </option>
                  ))}
                </Select>
              </div>
              {media && t.status !== 'done' && (
                <Link to={`/admin/media?ticket=${t.id}`} className="block">
                  <Button variant="primary" className="w-full">
                    <Upload className="size-4" /> Fulfill with upload
                  </Button>
                </Link>
              )}
            </Card>
          )}
          {canDelete && (
            <Button variant="ghost" size="sm" className="w-full text-rose-600 dark:text-rose-300" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-3.5" /> {admin ? 'Delete ticket' : 'Withdraw request'}
            </Button>
          )}
        </aside>
      </div>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={admin ? 'Delete this ticket?' : 'Withdraw this request?'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={remove}>
              {admin ? 'Delete' : 'Withdraw'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">The ticket and its replies will be removed. This can't be undone.</p>
      </Dialog>
    </div>
  );
}

function TimelineEvent({ text, who, at }: { text: string; who: string | null; at: string }) {
  return (
    <li className="relative flex items-center gap-2 text-sm text-muted">
      <CircleDot className="absolute -left-[27px] size-3.5 bg-bg text-muted" />
      <span className="text-fg">{text}</span>
      {who && <span>by {who}</span>}
      <span>· {ago(at)}</span>
    </li>
  );
}
