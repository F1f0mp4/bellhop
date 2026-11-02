import { ArrowDown, ArrowUp, Gauge as GaugeIcon, Play, Square, Timer } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Card, PageTitle } from '../../components/ui.tsx';
import { cx } from '../../lib/format.ts';
import { hasActiveUploads } from '../../lib/staging.ts';

type Phase = 'idle' | 'ping' | 'download' | 'upload' | 'piece' | 'done';
type PieceResult = { sendSeconds: number; replySeconds: number | null; onDisk: boolean };
type Results = { ping?: number; jitter?: number; download?: number; upload?: number; piece?: PieceResult; error?: string };

const MB = 1024 * 1024;
const TEST_MS = 10_000;
const RAMP_MS = 1000; // the first second is the connection speeding up, not its speed
const PIECE_SIZE = 16 * MB; // same size as a real upload piece
const REPLY_TIMEOUT_MS = 60_000;
const TUS = { 'Tus-Resumable': '1.0.0' };

const mbps = (bytesSent: number, ms: number) => (bytesSent * 8) / 1e6 / (ms / 1000);

function randomBlob(size: number) {
  const block = crypto.getRandomValues(new Uint8Array(65536));
  return new Blob(Array(Math.ceil(size / block.length)).fill(block)).slice(0, size);
}

async function measurePing(signal: AbortSignal) {
  const times: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t = performance.now();
    await fetch('/api/speedtest/ping', { cache: 'no-store', signal });
    times.push(performance.now() - t);
  }
  const jitter = times.slice(1).reduce((n, t, i) => n + Math.abs(t - times[i]), 0) / (times.length - 1);
  return { ping: [...times].sort((a, b) => a - b)[times.length >> 1], jitter };
}

/** Runs for TEST_MS, reports the live speed, returns the speed after the ramp-up. */
async function timed(signal: AbortSignal, onSpeed: (v: number) => void, work: (add: (n: number) => void, stop: AbortSignal) => Promise<unknown>) {
  const stop = new AbortController();
  const abort = () => stop.abort();
  signal.addEventListener('abort', abort);
  const start = performance.now();
  let total = 0;
  let atRamp = 0;
  let points: [number, number][] = [];
  const tick = setInterval(() => {
    const now = performance.now();
    if (now - start < RAMP_MS) atRamp = total;
    points.push([now, total]);
    points = points.filter(([t]) => now - t < 2000);
    if (points.length > 1) onSpeed(mbps(total - points[0][1], now - points[0][0]));
  }, 150);
  const end = setTimeout(abort, TEST_MS);
  await work((n) => (total += n), stop.signal).catch(() => {});
  clearTimeout(end);
  clearInterval(tick);
  signal.removeEventListener('abort', abort);
  signal.throwIfAborted();
  return mbps(total - atRamp, performance.now() - start - RAMP_MS);
}

async function downloadLoop(add: (n: number) => void, stop: AbortSignal) {
  while (!stop.aborted) {
    const res = await fetch(`/api/speedtest/download?bytes=${1024 * MB}`, { cache: 'no-store', signal: stop });
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      add(value.length);
    }
  }
}

// XHR rather than fetch: it reports upload progress, and it's what real uploads go through.
function xhrSend(method: string, url: string, headers: Record<string, string>, body: Blob, stop: AbortSignal, onSent: (n: number) => void, timeout = 0) {
  return new Promise<number>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.timeout = timeout;
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    let last = 0;
    xhr.upload.onprogress = (e) => {
      onSent(e.loaded - last);
      last = e.loaded;
    };
    const abort = () => xhr.abort();
    stop.addEventListener('abort', abort, { once: true });
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = xhr.onabort = xhr.ontimeout = () => reject(new Error('Request failed'));
    xhr.onloadend = () => stop.removeEventListener('abort', abort);
    xhr.send(body);
  });
}

async function uploadLoop(blob: Blob, add: (n: number) => void, stop: AbortSignal) {
  while (!stop.aborted) await xhrSend('POST', '/api/speedtest/upload', {}, blob, stop, add);
}

/** One real upload piece through the real upload path: how long to send, then how long for the reply. */
async function measurePiece(signal: AbortSignal): Promise<PieceResult> {
  const created = await fetch('/api/uploads', { method: 'POST', headers: { ...TUS, 'Upload-Length': String(PIECE_SIZE) }, signal });
  const url = created.headers.get('Location');
  if (!created.ok || !url) throw new Error(`The upload path answered ${created.status}`);
  try {
    const start = performance.now();
    let sent = 0;
    let sentAt = 0;
    let replySeconds: number | null = null;
    await xhrSend(
      'PATCH',
      url,
      { ...TUS, 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' },
      randomBlob(PIECE_SIZE),
      signal,
      (n) => {
        sent += n;
        if (sent >= PIECE_SIZE) sentAt = performance.now();
      },
      REPLY_TIMEOUT_MS,
    )
      .then(() => (replySeconds = (performance.now() - (sentAt || start)) / 1000))
      .catch(() => signal.throwIfAborted());
    const head = await fetch(url, { method: 'HEAD', headers: TUS, cache: 'no-store', signal });
    return {
      sendSeconds: ((sentAt || performance.now()) - start) / 1000,
      replySeconds,
      onDisk: Number(head.headers.get('Upload-Offset')) === PIECE_SIZE,
    };
  } finally {
    fetch(url, { method: 'DELETE', headers: TUS }).catch(() => {});
  }
}

export function SpeedTest() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [live, setLive] = useState(0);
  const [results, setResults] = useState<Results>({});
  const [busyUploads, setBusyUploads] = useState(false);
  const run = useRef<AbortController | null>(null);

  useEffect(() => () => run.current?.abort(), []);

  const start = async () => {
    const ctl = new AbortController();
    run.current = ctl;
    const { signal } = ctl;
    const update = (r: Results) => setResults((prev) => ({ ...prev, ...r }));
    setResults({});
    setLive(0);
    setBusyUploads(hasActiveUploads());
    try {
      setPhase('ping');
      update(await measurePing(signal));
      setPhase('download');
      update({ download: await timed(signal, setLive, (add, stop) => Promise.all([0, 1, 2, 3].map(() => downloadLoop(add, stop)))) });
      setLive(0);
      setPhase('upload');
      const blob = randomBlob(8 * MB);
      update({ upload: await timed(signal, setLive, (add, stop) => Promise.all([0, 1, 2].map(() => uploadLoop(blob, add, stop)))) });
      setLive(0);
      setPhase('piece');
      update({ piece: await measurePiece(signal) });
      setPhase('done');
    } catch (e) {
      setLive(0);
      setPhase(signal.aborted ? 'idle' : 'done');
      if (!signal.aborted) update({ error: (e as Error).message });
    }
  };

  const running = phase !== 'idle' && phase !== 'done';
  const shown = phase === 'done' || phase === 'idle' ? (results.upload ?? 0) : live;

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title="Speed test" subtitle="Measures the connection between this device and Bellhop, not your internet connection." />
      <Card className="p-6">
        <Gauge value={shown} label={phaseLabel(phase)} active={running} />
        <div className="mt-2 flex justify-center">
          {running ? (
            <Button onClick={() => run.current?.abort()}>
              <Square className="size-4" /> Stop
            </Button>
          ) : (
            <Button variant="primary" onClick={start}>
              <Play className="size-4" /> {phase === 'done' ? 'Run again' : 'Start test'}
            </Button>
          )}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon={<Timer className="size-4" />} label="Ping" value={results.ping} unit="ms" active={phase === 'ping'} />
          <Stat icon={<GaugeIcon className="size-4" />} label="Jitter" value={results.jitter} unit="ms" active={phase === 'ping'} />
          <Stat icon={<ArrowDown className="size-4" />} label="Download" value={results.download} unit="Mbps" active={phase === 'download'} />
          <Stat icon={<ArrowUp className="size-4" />} label="Upload" value={results.upload} unit="Mbps" active={phase === 'upload'} />
        </div>
      </Card>

      {(phase === 'piece' || results.piece || results.error) && (
        <Card className="mt-4 p-5">
          <h2 className="font-medium">Real upload check</h2>
          <p className="mt-1 text-sm text-muted">Sends one 16 MB piece the way media uploads do, then deletes it.</p>
          {phase === 'piece' && <p className="mt-3 text-sm">Sending, and waiting up to a minute for the reply…</p>}
          {results.piece && <PieceReport piece={results.piece} />}
          {results.error && <p className="mt-3 text-sm text-rose-500">The test stopped: {results.error}</p>}
        </Card>
      )}
      {busyUploads && <p className="mt-3 text-sm text-amber-600 dark:text-amber-300">Uploads were running during this test, so these results will read low. Pause them for a fair number.</p>}
    </div>
  );
}

function phaseLabel(phase: Phase) {
  return { idle: 'Ready', ping: 'Checking ping', download: 'Download', upload: 'Upload', piece: 'Real upload check', done: 'Upload result' }[phase];
}

function PieceReport({ piece }: { piece: PieceResult }) {
  const { sendSeconds, replySeconds, onDisk } = piece;
  const message =
    replySeconds == null
      ? onDisk
        ? 'The piece reached the server, but its reply never came back. Uploads will stall on this connection.'
        : 'The server has not got the whole piece and no reply came back. Uploads will stall on this connection.'
      : replySeconds > 5
        ? 'The reply was slow. Uploads will work, but they will pause after every piece.'
        : 'Healthy: the piece was saved and the reply came straight back.';
  return (
    <>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <Fact label="Time to send" value={`${sendSeconds.toFixed(1)} s`} />
        <Fact label="Wait for reply" value={replySeconds == null ? 'No reply in 60 s' : `${replySeconds.toFixed(1)} s`} />
        <Fact label="Saved on server" value={onDisk ? 'Yes' : 'No'} />
      </dl>
      <p className={cx('mt-3 text-sm', replySeconds != null && replySeconds <= 5 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-300')}>{message}</p>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function Stat({ icon, label, value, unit, active }: { icon: ReactNode; label: string; value?: number; unit: string; active: boolean }) {
  return (
    <div className={cx('rounded-lg bg-surface-2 p-3', active && 'ring-1 ring-accent')}>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {icon} {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">
        {value == null ? '–' : format(value)} <span className="text-xs font-normal text-muted">{unit}</span>
      </div>
    </div>
  );
}

const format = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));

// A square-root scale, so 20 Mbps and 900 Mbps both sit somewhere readable on the dial.
const MAX_SCALE = 1000;
const TICKS = [0, 10, 50, 100, 250, 500, 1000];
const SWEEP = 270;
const dialFraction = (v: number) => Math.sqrt(Math.min(v, MAX_SCALE) / MAX_SCALE);

function point(fraction: number, r: number) {
  const angle = ((135 + fraction * SWEEP) * Math.PI) / 180;
  return [100 + r * Math.cos(angle), 100 + r * Math.sin(angle)];
}

function arc(fraction: number, r: number) {
  const [x0, y0] = point(0, r);
  const [x1, y1] = point(fraction, r);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${fraction * SWEEP > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

function Gauge({ value, label, active }: { value: number; label: string; active: boolean }) {
  const f = dialFraction(value);
  return (
    <div className="mx-auto max-w-xs">
      <svg viewBox="0 0 200 180" role="img" aria-label={`${label}: ${format(value)} megabits per second`}>
        <path d={arc(1, 84)} fill="none" stroke="var(--surface-2)" strokeWidth="12" strokeLinecap="round" />
        {f > 0 && <path d={arc(f, 84)} fill="none" stroke="var(--accent)" strokeWidth="12" strokeLinecap="round" />}
        {TICKS.map((t) => {
          const [x, y] = point(dialFraction(t), 64);
          return (
            <text key={t} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill="var(--muted)">
              {t}
            </text>
          );
        })}
        <text x="100" y="104" textAnchor="middle" fontSize="30" fontWeight="600" fill="var(--text)" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {format(value)}
        </text>
        <text x="100" y="122" textAnchor="middle" fontSize="9" fill="var(--muted)">
          Mbps
        </text>
        <text x="100" y="160" textAnchor="middle" fontSize="10" fill={active ? 'var(--accent)' : 'var(--muted)'}>
          {label}
        </text>
      </svg>
    </div>
  );
}
