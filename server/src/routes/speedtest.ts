import crypto from 'node:crypto';
import { Hono } from 'hono';
import { requireAdmin, type AppEnv } from '../auth.ts';

const CHUNK = crypto.randomBytes(1024 * 1024); // random, so nothing on the way can compress it
const MAX_DOWNLOAD = 4 * 1024 ** 3;
const noStore = { 'cache-control': 'no-store' };

export const speedTestRoutes = new Hono<AppEnv>().use(requireAdmin);

speedTestRoutes.get('/ping', (c) => c.body(null, 204, noStore));

speedTestRoutes.get('/download', (c) => {
  let left = Math.min(Number(c.req.query('bytes')) || 0, MAX_DOWNLOAD);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (left <= 0) return controller.close();
      const piece = CHUNK.subarray(0, Math.min(left, CHUNK.length));
      left -= piece.length;
      controller.enqueue(new Uint8Array(piece));
    },
  });
  return c.body(body, 200, { ...noStore, 'content-type': 'application/octet-stream' });
});

// Reads and throws away whatever is sent, so the disk plays no part in the result.
speedTestRoutes.post('/upload', async (c) => {
  let received = 0;
  const reader = c.req.raw.body?.getReader();
  for (let r = await reader?.read(); r && !r.done; r = await reader?.read()) received += r.value.length;
  return c.json({ received }, 200, noStore);
});
