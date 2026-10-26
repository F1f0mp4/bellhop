import { Inbox, MessageSquare, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Empty, PageTitle, Poster, Spinner, StatusPill, Tabs, TypeBadge } from '../../components/ui.tsx';
import { ago } from '../../lib/format.ts';
import { isMedia } from '../../lib/labels.ts';
import type { Ticket } from '../../lib/types.ts';
import { useFetch } from '../../lib/useFetch.ts';

type Filter = 'open' | 'closed' | 'all';

export function MyTickets() {
  const { data, loading, error } = useFetch<Ticket[]>('/tickets?mine=1');
  const [filter, setFilter] = useState<Filter>('open');

  const open = (t: Ticket) => t.status === 'new' || t.status === 'in_progress';
  const shown = (data ?? []).filter((t) => (filter === 'all' ? true : filter === 'open' ? open(t) : !open(t)));
  const openCount = (data ?? []).filter(open).length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle
        title="My requests"
        subtitle={data ? `${openCount} open` : undefined}
        actions={
          <Link to="/new">
            <Button variant="primary">
              <Plus className="size-4" /> New request
            </Button>
          </Link>
        }
      />
      <div className="mb-4">
        <Tabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      {loading && !data && <Spinner />}
      {error && <p className="text-rose-500">{error}</p>}
      {data && !shown.length && (
        <Empty icon={<Inbox className="size-5" />} title={filter === 'open' ? 'Nothing open' : 'Nothing here yet'}>
          Requests you send show up here with their status and replies.
        </Empty>
      )}
      <ul className="space-y-2">
        {shown.map((t) => (
          <li key={t.id}>
            <TicketRow ticket={t} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TicketRow({ ticket: t, showUser }: { ticket: Ticket; showUser?: boolean }) {
  return (
    <Link
      to={`/requests/${t.id}`}
      className="flex items-center gap-4 rounded-xl border border-line bg-surface p-3 transition hover:border-muted/50"
    >
      {isMedia(t.type) ? (
        <Poster media={t.media_ref} type={t.type} className={t.type === 'music' ? 'size-12' : 'h-14 w-10'} />
      ) : (
        <div className="grid size-12 shrink-0 place-items-center">
          <TypeBadge type={t.type} withLabel={false} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{t.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
          <TypeBadge type={t.type} />
          {showUser && <span>{t.username}</span>}
          <span>updated {ago(t.updated_at)}</span>
          {t.comment_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3" /> {t.comment_count}
            </span>
          )}
        </div>
      </div>
      <StatusPill status={t.status} />
    </Link>
  );
}
