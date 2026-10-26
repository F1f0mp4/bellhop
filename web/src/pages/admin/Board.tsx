import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { MessageSquare, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../../components/Toast.tsx';
import { Button, PageTitle, Poster, PriorityDot, Select, Spinner, TypeBadge } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { ago, cx } from '../../lib/format.ts';
import { isMedia, STATUS_INFO, STATUSES, TYPE_INFO, TYPES } from '../../lib/labels.ts';
import type { Status, Ticket, TicketType } from '../../lib/types.ts';
import { useFetch } from '../../lib/useFetch.ts';

const CLOSED_LIMIT = 15;

export function Board() {
  const { data, setData, loading } = useFetch<Ticket[]>('/tickets');
  const notify = useToast();
  const [type, setType] = useState<TicketType | 'all'>('all');
  const [who, setWho] = useState('all');
  const [dragging, setDragging] = useState<Ticket | null>(null);
  const [expanded, setExpanded] = useState<Set<Status>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  const users = useMemo(() => [...new Set((data ?? []).map((t) => t.username))].sort(), [data]);
  const visible = (data ?? []).filter((t) => (type === 'all' || t.type === type) && (who === 'all' || t.username === who));
  const openCount = (data ?? []).filter((t) => t.status === 'new' || t.status === 'in_progress').length;

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const ticket = data?.find((t) => t.id === active.id);
    const status = over?.id as Status | undefined;
    if (!ticket || !status || ticket.status === status) return;
    const previous = data!;
    setData(previous.map((t) => (t.id === ticket.id ? { ...t, status, updated_at: new Date().toISOString() } : t)));
    try {
      await api.patch(`/tickets/${ticket.id}`, { status });
    } catch (e) {
      setData(previous);
      notify((e as Error).message, 'error');
    }
  };

  return (
    <div>
      <PageTitle
        title="Request board"
        subtitle={data ? `${openCount} open · drag a card to change its status` : undefined}
        actions={
          <>
            {users.length > 1 && (
              <Select value={who} onChange={(e) => setWho(e.target.value)} className="w-40">
                <option value="all">Everyone</option>
                {users.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            )}
            <Link to="/new">
              <Button>
                <Plus className="size-4" /> New request
              </Button>
            </Link>
          </>
        }
      />
      <div className="mb-5 flex flex-wrap gap-1.5">
        <Chip active={type === 'all'} onClick={() => setType('all')}>
          All
        </Chip>
        {TYPES.map((t) => {
          const Icon = TYPE_INFO[t].icon;
          return (
            <Chip key={t} active={type === t} onClick={() => setType(t)}>
              <Icon className="size-3.5" /> {TYPE_INFO[t].short}
            </Chip>
          );
        })}
      </div>

      {loading && !data ? (
        <Spinner />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={({ active }) => setDragging(data?.find((t) => t.id === active.id) ?? null)}
          onDragCancel={() => setDragging(null)}
          onDragEnd={onDragEnd}
        >
          <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 lg:grid lg:grid-cols-4 lg:overflow-visible">
            {STATUSES.map((s) => {
              const items = visible.filter((t) => t.status === s);
              const closed = s === 'done' || s === 'declined';
              const limit = closed && !expanded.has(s) ? CLOSED_LIMIT : Infinity;
              return (
                <Column key={s} status={s} count={items.length}>
                  {items.slice(0, limit).map((t) => (
                    <DraggableCard key={t.id} ticket={t} />
                  ))}
                  {items.length > limit && (
                    <button
                      onClick={() => setExpanded(new Set(expanded).add(s))}
                      className="w-full cursor-pointer rounded-lg py-2 text-xs text-muted hover:text-fg"
                    >
                      Show {items.length - limit} more
                    </button>
                  )}
                </Column>
              );
            })}
          </div>
          <DragOverlay dropAnimation={null}>{dragging && <CardBody ticket={dragging} lifted />}</DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
        active ? 'border-accent bg-accent-soft text-fg' : 'border-line text-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function Column({ status, count, children }: { status: Status; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const info = STATUS_INFO[status];
  return (
    <section
      ref={setNodeRef}
      className={cx(
        'flex w-72 shrink-0 snap-start flex-col rounded-2xl border p-2 transition-colors lg:w-auto',
        isOver ? 'border-accent bg-accent-soft/60' : 'border-line bg-surface/50',
      )}
    >
      <header className="flex items-center gap-2 px-2 pt-1 pb-3">
        <span className={cx('size-2 rounded-full', info.dot)} />
        <h2 className="text-sm font-medium">{info.label}</h2>
        <span className="ml-auto rounded-full bg-surface-2 px-2 text-xs text-muted tabular-nums">{count}</span>
      </header>
      <div className="flex min-h-24 flex-col gap-2">{children}</div>
    </section>
  );
}

function DraggableCard({ ticket }: { ticket: Ticket }) {
  const navigate = useNavigate();
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: ticket.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => navigate(`/requests/${ticket.id}`)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/requests/${ticket.id}`)}
      className={cx('touch-manipulation', isDragging && 'opacity-30')}
    >
      <CardBody ticket={ticket} />
    </div>
  );
}

function CardBody({ ticket: t, lifted }: { ticket: Ticket; lifted?: boolean }) {
  return (
    <article
      className={cx(
        'flex cursor-grab gap-3 rounded-xl border border-line bg-surface p-3 transition hover:border-muted/50',
        lifted && 'rotate-2 cursor-grabbing shadow-2xl',
      )}
    >
      {isMedia(t.type) && t.media_ref?.poster && (
        <Poster media={t.media_ref} type={t.type} className={t.type === 'music' ? 'size-12' : 'h-16 w-11'} />
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-1.5">
          <TypeBadge type={t.type} />
          <PriorityDot priority={t.priority} />
        </div>
        <h3 className="line-clamp-2 text-sm leading-snug font-medium">{t.title}</h3>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
          <span className="max-w-28 shrink-0 truncate">{t.username}</span>
          <span>·</span>
          <span className="shrink-0">{ago(t.created_at)}</span>
          {t.comment_count > 0 && (
            <span className="ml-auto inline-flex items-center gap-1">
              <MessageSquare className="size-3" />
              {t.comment_count}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
