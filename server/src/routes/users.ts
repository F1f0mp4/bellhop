import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { hashPassword, requireAdmin, type AppEnv } from '../auth.ts';
import { all, one, run } from '../db.ts';

export const userRoutes = new Hono<AppEnv>().use(requireAdmin);

const activeAdmins = () =>
  one<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0")!.n;

userRoutes.get('/', (c) =>
  c.json(
    all(`SELECT u.id, u.username, u.role, u.disabled, u.created_at,
           (SELECT COUNT(*) FROM tickets t WHERE t.user_id = u.id) AS ticket_count
         FROM users u ORDER BY u.username`),
  ),
);

userRoutes.post('/', async (c) => {
  const { username, password, role } = await c.req.json<{ username?: string; password?: string; role?: string }>();
  const name = username?.trim() ?? '';
  if (!/^[\w.\- ]{2,32}$/.test(name)) throw new HTTPException(400, { message: 'Usernames are 2–32 letters, numbers, spaces, dots or dashes' });
  if (!password || password.length < 6) throw new HTTPException(400, { message: 'Passwords need at least 6 characters' });
  if (one('SELECT id FROM users WHERE username = ?', name)) throw new HTTPException(409, { message: 'That username is taken' });
  run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', name, hashPassword(password), role === 'admin' ? 'admin' : 'user');
  return c.json({ ok: true }, 201);
});

userRoutes.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const target = one<{ id: number; role: string; disabled: number }>('SELECT id, role, disabled FROM users WHERE id = ?', id);
  if (!target) throw new HTTPException(404, { message: 'User not found' });
  const b = await c.req.json<{ password?: string; role?: string; disabled?: boolean }>();
  const losingAdmin =
    target.role === 'admin' && !target.disabled && ((b.role && b.role !== 'admin') || b.disabled === true);
  if (losingAdmin && activeAdmins() <= 1) throw new HTTPException(400, { message: 'You need at least one active admin' });
  if (b.password !== undefined) {
    if (b.password.length < 6) throw new HTTPException(400, { message: 'Passwords need at least 6 characters' });
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.password), id);
    run('DELETE FROM sessions WHERE user_id = ?', id);
  }
  if (b.role) run('UPDATE users SET role = ? WHERE id = ?', b.role === 'admin' ? 'admin' : 'user', id);
  if (b.disabled !== undefined) {
    run('UPDATE users SET disabled = ? WHERE id = ?', b.disabled ? 1 : 0, id);
    if (b.disabled) run('DELETE FROM sessions WHERE user_id = ?', id);
  }
  return c.json({ ok: true });
});
