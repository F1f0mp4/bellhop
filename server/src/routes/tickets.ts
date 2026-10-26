import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireUser, type AppEnv, type User } from '../auth.ts';
import { all, now, one, run } from '../db.ts';

export const TYPES = ['issue', 'feature', 'movie', 'series', 'music'] as const;
export const STATUSES = ['new', 'in_progress', 'done', 'declined'] as const;
const PRIORITIES = ['low', 'normal', 'high'] as const;

export const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  in_progress: 'In progress',
  done: 'Done',
  declined: 'Declined',
};

export type MediaRef = { source: string; id: string; title: string; year?: string; poster?: string; subtitle?: string };

const LIST_SQL = `
  SELECT t.*, u.username,
    (SELECT COUNT(*) FROM comments c WHERE c.ticket_id = t.id AND c.kind = 'comment') AS comment_count
  FROM tickets t JOIN users u ON u.id = t.user_id`;

const shape = (t: Record<string, any>): Record<string, any> => ({ ...t, media_ref: t.media_ref ? JSON.parse(t.media_ref) : null });

function loadTicket(id: number, user: User) {
  const t = one(`${LIST_SQL} WHERE t.id = ?`, id);
  if (!t || (user.role !== 'admin' && t.user_id !== user.id)) throw new HTTPException(404, { message: 'Ticket not found' });
  return t;
}

// Shared with the media import so fulfilling a request leaves the same trail.
export function setStatus(ticketId: number, status: string, by: User | null, note?: string) {
  run('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?', status, now(), ticketId);
  run(
    "INSERT INTO comments (ticket_id, user_id, kind, body) VALUES (?, ?, 'event', ?)",
    ticketId,
    by?.id ?? null,
    note ?? `Marked ${STATUS_LABEL[status]}`,
  );
}

export const ticketRoutes = new Hono<AppEnv>().use(requireUser);

ticketRoutes.get('/', (c) => {
  const user = c.get('user');
  const where: string[] = [];
  const params: any[] = [];
  if (user.role !== 'admin' || c.req.query('mine')) {
    where.push('t.user_id = ?');
    params.push(user.id);
  }
  for (const key of ['status', 'type'] as const) {
    const v = c.req.query(key);
    if (v) {
      where.push(`t.${key} = ?`);
      params.push(v);
    }
  }
  const sql = `${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.updated_at DESC`;
  return c.json(all(sql, ...params).map(shape));
});

// Open requests for the same title, so people don't ask twice.
ticketRoutes.get('/duplicates', (c) => {
  const type = c.req.query('type') ?? '';
  const refId = c.req.query('ref') ?? '';
  const title = (c.req.query('title') ?? '').trim();
  if (!refId && !title) return c.json([]);
  const rows = all(
    `SELECT t.id, t.title, t.status, u.username FROM tickets t JOIN users u ON u.id = t.user_id
     WHERE t.type = ? AND t.status IN ('new', 'in_progress')
       AND ((? <> '' AND json_extract(t.media_ref, '$.id') = ?) OR (? <> '' AND t.title = ? COLLATE NOCASE))
     LIMIT 5`,
    type, refId, refId, title, title,
  );
  return c.json(rows);
});

ticketRoutes.post('/', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<{ type?: string; title?: string; body?: string; media_ref?: MediaRef | null }>();
  const title = b.title?.trim();
  if (!TYPES.includes(b.type as any)) throw new HTTPException(400, { message: 'Pick what kind of request this is' });
  if (!title) throw new HTTPException(400, { message: 'Add a title' });
  if (title.length > 200 || (b.body?.length ?? 0) > 10000) throw new HTTPException(400, { message: 'That is a bit long' });
  const res = run(
    'INSERT INTO tickets (user_id, type, title, body, media_ref) VALUES (?, ?, ?, ?, ?)',
    user.id, b.type!, title, b.body?.trim() ?? '', b.media_ref ? JSON.stringify(b.media_ref) : null,
  );
  return c.json(shape(loadTicket(Number(res.lastInsertRowid), user)), 201);
});

ticketRoutes.get('/:id', (c) => {
  const user = c.get('user');
  const ticket = shape(loadTicket(Number(c.req.param('id')), user));
  const comments = all(
    `SELECT c.id, c.kind, c.body, c.created_at, u.username, u.role FROM comments c
     LEFT JOIN users u ON u.id = c.user_id WHERE c.ticket_id = ? ORDER BY c.created_at, c.id`,
    ticket.id,
  );
  return c.json({ ...ticket, comments });
});

ticketRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') throw new HTTPException(403, { message: 'Admins only' });
  const t = loadTicket(Number(c.req.param('id')), user);
  const b = await c.req.json<{ status?: string; priority?: string }>();
  if (b.status && b.status !== t.status) {
    if (!STATUSES.includes(b.status as any)) throw new HTTPException(400, { message: 'Unknown status' });
    setStatus(t.id, b.status, user);
  }
  if (b.priority && b.priority !== t.priority) {
    if (!PRIORITIES.includes(b.priority as any)) throw new HTTPException(400, { message: 'Unknown priority' });
    run('UPDATE tickets SET priority = ?, updated_at = ? WHERE id = ?', b.priority, now(), t.id);
  }
  return c.json(shape(loadTicket(t.id, user)));
});

ticketRoutes.post('/:id/comments', async (c) => {
  const user = c.get('user');
  const t = loadTicket(Number(c.req.param('id')), user);
  const { body } = await c.req.json<{ body?: string }>();
  const text = body?.trim();
  if (!text) throw new HTTPException(400, { message: 'Write something first' });
  run("INSERT INTO comments (ticket_id, user_id, kind, body) VALUES (?, ?, 'comment', ?)", t.id, user.id, text.slice(0, 10000));
  run('UPDATE tickets SET updated_at = ? WHERE id = ?', now(), t.id);
  return c.json({ ok: true }, 201);
});

ticketRoutes.delete('/:id', (c) => {
  const user = c.get('user');
  const t = loadTicket(Number(c.req.param('id')), user);
  if (user.role !== 'admin' && t.status !== 'new') throw new HTTPException(400, { message: 'Only new requests can be withdrawn' });
  run('DELETE FROM tickets WHERE id = ?', t.id);
  return c.json({ ok: true });
});
