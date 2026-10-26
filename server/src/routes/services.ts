import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAdmin, requireUser, type AppEnv } from '../auth.ts';
import { all, db, one, run } from '../db.ts';
import { checkService, forget, healthOf } from '../services/health.ts';

export const serviceRoutes = new Hono<AppEnv>();

type Service = {
  id: number;
  name: string;
  kind: 'web' | 'minecraft';
  url: string;
  check_url: string;
  category: string;
  description: string;
  icon: string;
  checks: number;
  position: number;
};

const withHealth = (s: Service) => ({ ...s, health: s.checks ? healthOf(s.id) : null });

serviceRoutes.get('/', requireUser, (c) =>
  c.json(all<Service>('SELECT * FROM services ORDER BY position, id').map(withHealth)),
);

function clean(b: Partial<Service>) {
  const name = b.name?.trim() ?? '';
  const kind = b.kind === 'minecraft' ? 'minecraft' : 'web';
  let url = b.url?.trim() ?? '';
  if (!name) throw new HTTPException(400, { message: 'Give it a name' });
  if (!url) throw new HTTPException(400, { message: kind === 'web' ? 'Add the address it lives at' : 'Add the server address' });
  if (kind === 'web') {
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url}`;
    try {
      const u = new URL(url);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    } catch {
      throw new HTTPException(400, { message: 'That address does not look like a web link' });
    }
  } else if (!/^[\w.\-]+(:\d{1,5})?$|^\[[0-9a-f:]+\](:\d{1,5})?$/i.test(url)) {
    throw new HTTPException(400, { message: 'Use host or host:port, e.g. mc.example.com:25565' });
  }
  return {
    name: name.slice(0, 60),
    kind,
    url,
    check_url: b.check_url?.trim() ?? '',
    category: b.category?.trim().slice(0, 40) ?? '',
    description: b.description?.trim().slice(0, 140) ?? '',
    icon: b.icon?.trim() || 'auto',
    checks: b.checks === 0 || (b.checks as unknown) === false ? 0 : 1,
  };
}

serviceRoutes.post('/', requireAdmin, async (c) => {
  const s = clean(await c.req.json());
  const pos = one<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM services')!.p;
  const res = run(
    `INSERT INTO services (name, kind, url, check_url, category, description, icon, checks, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    s.name, s.kind, s.url, s.check_url, s.category, s.description, s.icon, s.checks, pos,
  );
  const row = one<Service>('SELECT * FROM services WHERE id = ?', Number(res.lastInsertRowid))!;
  if (row.checks) await checkService(row);
  return c.json(withHealth(row), 201);
});

serviceRoutes.put('/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  if (!one('SELECT id FROM services WHERE id = ?', id)) throw new HTTPException(404, { message: 'Link not found' });
  const s = clean(await c.req.json());
  run(
    `UPDATE services SET name = ?, kind = ?, url = ?, check_url = ?, category = ?, description = ?, icon = ?, checks = ? WHERE id = ?`,
    s.name, s.kind, s.url, s.check_url, s.category, s.description, s.icon, s.checks, id,
  );
  const row = one<Service>('SELECT * FROM services WHERE id = ?', id)!;
  forget(id);
  if (row.checks) await checkService(row);
  return c.json(withHealth(row));
});

serviceRoutes.delete('/:id', requireAdmin, (c) => {
  const id = Number(c.req.param('id'));
  run('DELETE FROM services WHERE id = ?', id);
  forget(id);
  return c.json({ ok: true });
});

serviceRoutes.post('/reorder', requireAdmin, async (c) => {
  const { ids } = await c.req.json<{ ids: number[] }>();
  if (!Array.isArray(ids)) throw new HTTPException(400, { message: 'Bad order' });
  const stmt = db.prepare('UPDATE services SET position = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    ids.forEach((id, i) => stmt.run(i, Number(id)));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return c.json({ ok: true });
});

serviceRoutes.post('/:id/check', requireUser, async (c) => {
  const row = one<Service>('SELECT * FROM services WHERE id = ?', Number(c.req.param('id')));
  if (!row) throw new HTTPException(404, { message: 'Link not found' });
  return c.json(await checkService(row));
});
