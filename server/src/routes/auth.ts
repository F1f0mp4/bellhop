import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { checkLoginRate, endSession, hashPassword, requireUser, startSession, verifyPassword, type AppEnv } from '../auth.ts';
import { one, run } from '../db.ts';

export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/login', async (c) => {
  const { username, password } = await c.req.json<{ username?: string; password?: string }>();
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
  checkLoginRate(`${ip}:${username?.toLowerCase()}`);
  const user = one<{ id: number; password_hash: string; disabled: number }>(
    'SELECT id, password_hash, disabled FROM users WHERE username = ?',
    username ?? '',
  );
  if (!user || user.disabled || !verifyPassword(password ?? '', user.password_hash)) {
    throw new HTTPException(401, { message: 'Wrong username or password' });
  }
  startSession(c, user.id);
  return c.json({ ok: true });
});

authRoutes.post('/logout', (c) => {
  endSession(c);
  return c.json({ ok: true });
});

authRoutes.get('/me', requireUser, (c) => c.json(c.get('user')));

authRoutes.post('/password', requireUser, async (c) => {
  const { current, next } = await c.req.json<{ current?: string; next?: string }>();
  const row = one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', c.get('user').id)!;
  if (!verifyPassword(current ?? '', row.password_hash)) throw new HTTPException(400, { message: 'Current password is wrong' });
  if (!next || next.length < 6) throw new HTTPException(400, { message: 'New password needs at least 6 characters' });
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), c.get('user').id);
  return c.json({ ok: true });
});
