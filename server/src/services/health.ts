import http from 'node:http';
import https from 'node:https';
import { all } from '../db.ts';
import { pingMinecraft, type McStatus } from './minecraft.ts';

export type Health = {
  up: boolean;
  ms?: number;
  error?: string;
  minecraft?: McStatus;
  checked_at: string;
};

type ServiceRow = { id: number; kind: 'web' | 'minecraft'; url: string; check_url: string; checks: number };

const cache = new Map<number, Health>();
const INTERVAL = 60_000;

/**
 * Anything that answers below 500 counts as up: a login page (401/403) still means the app is running.
 * Self-signed certificates are accepted, since that's normal on a LAN.
 */
export function checkWeb(url: string, timeoutMs = 5000): Promise<{ up: boolean; error?: string }> {
  return new Promise((resolve) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return resolve({ up: false, error: 'Bad URL' });
    }
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(
      target,
      { method: 'GET', timeout: timeoutMs, rejectUnauthorized: false, headers: { 'user-agent': 'Bellhop status check' } },
      (res) => {
        res.resume();
        req.destroy();
        const code = res.statusCode ?? 0;
        resolve(code < 500 ? { up: true } : { up: false, error: `HTTP ${code}` });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ up: false, error: 'Timed out' });
    });
    req.on('error', (e: NodeJS.ErrnoException) => resolve({ up: false, error: e.code ?? e.message }));
    req.end();
  });
}

export async function checkService(s: ServiceRow): Promise<Health> {
  const started = Date.now();
  const target = s.check_url || s.url;
  let result: Health;
  if (s.kind === 'minecraft') {
    try {
      const minecraft = await pingMinecraft(target);
      result = { up: true, minecraft, ms: Date.now() - started, checked_at: new Date().toISOString() };
    } catch (e) {
      result = { up: false, error: (e as NodeJS.ErrnoException).code ?? (e as Error).message, checked_at: new Date().toISOString() };
    }
  } else {
    const r = await checkWeb(target);
    result = { ...r, ms: r.up ? Date.now() - started : undefined, checked_at: new Date().toISOString() };
  }
  cache.set(s.id, result);
  return result;
}

export async function checkAll() {
  const rows = all<ServiceRow>('SELECT id, kind, url, check_url, checks FROM services WHERE checks = 1');
  for (const id of cache.keys()) if (!rows.some((r) => r.id === id)) cache.delete(id);
  await Promise.all(rows.map(checkService));
}

export const healthOf = (id: number) => cache.get(id) ?? null;
export const forget = (id: number) => cache.delete(id);

export function startHealthChecks() {
  checkAll().catch(() => {});
  setInterval(() => checkAll().catch(() => {}), INTERVAL).unref();
}
