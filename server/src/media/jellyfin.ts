import { getSetting } from '../db.ts';

type Result = { ok: boolean; message: string };

function headers(key: string) {
  return {
    Authorization: `MediaBrowser Token="${key}", Client="Bellhop", Device="Bellhop", DeviceId="bellhop", Version="1.0.0"`,
    'X-Emby-Token': key,
  };
}

async function call(path: string, method: string, url = getSetting('jellyfin_url'), key = getSetting('jellyfin_key')) {
  if (!url || !key) return { res: null, error: 'Jellyfin is not set up' };
  try {
    const res = await fetch(new URL(path, url.endsWith('/') ? url : url + '/'), {
      method,
      headers: headers(key),
      signal: AbortSignal.timeout(8000),
    });
    return { res, error: res.ok ? '' : `Jellyfin answered ${res.status} ${res.statusText}` };
  } catch (e) {
    return { res: null, error: `Could not reach Jellyfin: ${(e as Error).message}` };
  }
}

export async function refreshLibrary(): Promise<Result> {
  const { error } = await call('Library/Refresh', 'POST');
  return error ? { ok: false, message: error } : { ok: true, message: 'Jellyfin is scanning the library' };
}

export async function testJellyfin(url?: string, key?: string): Promise<Result> {
  const { res, error } = await call('System/Info', 'GET', url || undefined, key || undefined);
  if (error || !res) return { ok: false, message: error };
  const info = (await res.json()) as { ServerName?: string; Version?: string };
  return { ok: true, message: `Connected to ${info.ServerName ?? 'Jellyfin'} ${info.Version ?? ''}`.trim() };
}
