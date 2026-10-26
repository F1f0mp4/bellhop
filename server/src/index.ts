import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { isCrossOrigin, sameOrigin, seedAdmin, userFromCookieHeader, type AppEnv } from './auth.ts';
import { config } from './config.ts';
import { authRoutes } from './routes/auth.ts';
import { cleanupUploads, mediaRoutes, tus } from './routes/media.ts';
import { serviceRoutes } from './routes/services.ts';
import { lookupRoutes, settingsRoutes } from './routes/settings.ts';
import { ticketRoutes } from './routes/tickets.ts';
import { userRoutes } from './routes/users.ts';
import { wikiRoutes } from './routes/wiki.ts';
import { startHealthChecks } from './services/health.ts';

seedAdmin();
cleanupUploads();
setInterval(cleanupUploads, 6 * 3600e3).unref();
startHealthChecks();

const app = new Hono<AppEnv>();

app.use('/api/*', sameOrigin);
app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/auth', authRoutes);
app.route('/api/tickets', ticketRoutes);
app.route('/api/users', userRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/lookup', lookupRoutes);
app.route('/api/media', mediaRoutes);
app.route('/api/services', serviceRoutes);
app.route('/api/wiki', wikiRoutes);

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// The built web app, with index.html as the fallback for client-side routes.
const webRoot = path.relative(process.cwd(), config.webDir) || '.';
app.use('/*', serveStatic({ root: webRoot }));
app.get('/*', (c) => {
  const index = path.join(config.webDir, 'index.html');
  if (!fs.existsSync(index)) return c.text('Web app not built. Run `npm run build`, or use `npm run dev:web` while developing.', 404);
  return c.html(fs.readFileSync(index, 'utf8'));
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof SyntaxError) return c.json({ error: 'Bad request body' }, 400);
  console.error(err);
  return c.json({ error: 'Something went wrong on the server' }, 500);
});

const honoListener = getRequestListener(app.fetch);

function sendJson(res: http.ServerResponse, status: number, body: object) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

// Resumable uploads (tus protocol) go straight to tus's Node handler on the raw request.
// Converting them to web streams first hid client disconnects from tus, so an interrupted
// piece could keep its upload locked and every retry for that file waited behind it.
function handleUpload(req: http.IncomingMessage, res: http.ServerResponse) {
  const user = userFromCookieHeader(req.headers.cookie);
  if (!user) return sendJson(res, 401, { error: 'Please sign in' });
  if (user.role !== 'admin') return sendJson(res, 403, { error: 'Admins only' });
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host;
  if (isCrossOrigin(req.method ?? 'GET', req.headers.origin, host)) return sendJson(res, 403, { error: 'Cross-origin request blocked' });
  tus.handle(req, res).catch((err) => {
    console.error('  upload handler failed:', err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Upload failed on the server' });
    else res.destroy();
  });
}

const server = http.createServer((req, res) => {
  const path = req.url?.split('?')[0] ?? '';
  if (path === '/api/uploads' || path.startsWith('/api/uploads/')) return handleUpload(req, res);
  honoListener(req, res);
});

// Node closes requests that take longer than 5 minutes by default. An upload piece on a slow
// connection can take longer than that, so only the header timeout stays.
server.requestTimeout = 0;
server.keepAliveTimeout = 65_000;

server.listen(config.port, () => {
  console.log(`  Bellhop is ready on http://localhost:${config.port}`);
  console.log(`  library:  ${config.mediaDir}\n  incoming: ${config.incomingDir}\n  data:     ${config.dataDir}`);
});
