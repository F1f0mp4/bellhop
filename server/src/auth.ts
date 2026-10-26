import crypto from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { config } from './config.ts';
import { all, one, run } from './db.ts';

export type User = { id: number; username: string; role: 'user' | 'admin' };
export type AppEnv = { Variables: { user: User } };

const COOKIE = 'bellhop_session';
const SESSION_DAYS = 30;

// scrypt is built into Node, so the image needs no native modules.
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function startSession(c: Context, userId: number) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, expires.toISOString());
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:',
    path: '/',
    expires,
  });
}

export function endSession(c: Context) {
  const token = getCookie(c, COOKIE);
  if (token) run('DELETE FROM sessions WHERE id = ?', sha256(token));
  deleteCookie(c, COOKIE, { path: '/' });
}

export function userFromCookie(c: Context): User | undefined {
  return userFromToken(getCookie(c, COOKIE));
}

/** Same lookup from a raw Cookie header, for requests handled outside Hono (uploads). */
export function userFromCookieHeader(header: string | undefined): User | undefined {
  const pair = header?.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE}=`));
  return userFromToken(pair ? decodeURIComponent(pair.slice(COOKIE.length + 1)) : undefined);
}

function userFromToken(token: string | undefined): User | undefined {
  if (!token) return;
  return one<User>(
    `SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0`,
    sha256(token),
    new Date().toISOString(),
  );
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = userFromCookie(c);
  if (!user) throw new HTTPException(401, { message: 'Please sign in' });
  c.set('user', user);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = userFromCookie(c);
  if (!user) throw new HTTPException(401, { message: 'Please sign in' });
  if (user.role !== 'admin') throw new HTTPException(403, { message: 'Admins only' });
  c.set('user', user);
  await next();
};

// Cookies are SameSite=Lax; on top of that, reject cross-origin writes outright.
export function isCrossOrigin(method: string, origin: string | undefined, host: string | undefined): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method) || !origin || !host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export const sameOrigin: MiddlewareHandler = async (c, next) => {
  if (isCrossOrigin(c.req.method, c.req.header('origin'), c.req.header('x-forwarded-host') ?? c.req.header('host'))) {
    throw new HTTPException(403, { message: 'Cross-origin request blocked' });
  }
  await next();
};

const attempts = new Map<string, { count: number; reset: number }>();

export function checkLoginRate(key: string) {
  const entry = attempts.get(key);
  const t = Date.now();
  if (!entry || entry.reset < t) {
    attempts.set(key, { count: 1, reset: t + 15 * 60e3 });
    return;
  }
  if (++entry.count > 10) throw new HTTPException(429, { message: 'Too many attempts, try again in a few minutes' });
}

export function seedAdmin() {
  run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
  if (all('SELECT id FROM users LIMIT 1').length) return;
  let password = config.adminPassword;
  if (!password) {
    password = crypto.randomBytes(9).toString('base64url');
    console.log(`\n  No ADMIN_PASSWORD set. Created "${config.adminUser}" with password: ${password}\n`);
  }
  run("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')", config.adminUser, hashPassword(password));
  console.log(`  Admin account "${config.adminUser}" created.`);
}
