import { twMerge } from 'tailwind-merge';

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function ago(iso: string): string {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(iso).toLocaleDateString();
}

/** 45 s, 12 min, 1 h 5 min */
export function duration(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

export function bytes(n: number | null | undefined): string {
  if (n == null) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

// Later classes win, so `<Input className="w-11">` overrides the default full width.
export const cx = (...parts: (string | false | null | undefined)[]) => twMerge(parts.filter(Boolean).join(' '));
