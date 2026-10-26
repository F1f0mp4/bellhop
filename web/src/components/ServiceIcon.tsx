import {
  BookOpen,
  Camera,
  Cloud,
  Cpu,
  Database,
  Download,
  Film,
  Gamepad2,
  Globe,
  HardDrive,
  House,
  Image,
  Lock,
  MessageCircle,
  Monitor,
  Music2,
  Pickaxe,
  Server,
  Shield,
  Tv,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { cx } from '../lib/format.ts';
import type { Service } from '../lib/types.ts';

export const ICONS: Record<string, LucideIcon> = {
  film: Film,
  tv: Tv,
  music: Music2,
  pickaxe: Pickaxe,
  gamepad: Gamepad2,
  server: Server,
  'hard-drive': HardDrive,
  cloud: Cloud,
  download: Download,
  camera: Camera,
  image: Image,
  home: House,
  wifi: Wifi,
  shield: Shield,
  lock: Lock,
  database: Database,
  cpu: Cpu,
  monitor: Monitor,
  book: BookOpen,
  chat: MessageCircle,
  globe: Globe,
};

const TONES = [
  'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  'bg-rose-500/15 text-rose-600 dark:text-rose-300',
  'bg-teal-500/15 text-teal-600 dark:text-teal-300',
];

const toneFor = (name: string) => TONES[[...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % TONES.length];

/** The service's own favicon when icon is "auto", otherwise a chosen icon or the first letter. */
export function ServiceIcon({ service, className }: { service: Pick<Service, 'name' | 'kind' | 'url' | 'icon'>; className?: string }) {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const box = cx('grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg', toneFor(service.name), className);

  const Chosen = ICONS[service.icon] ?? (service.kind === 'minecraft' && service.icon === 'auto' ? Pickaxe : null);
  if (Chosen) {
    return (
      <span className={box}>
        <Chosen className="size-4" />
      </span>
    );
  }

  let favicon = '';
  if (service.kind === 'web' && service.icon === 'auto') {
    try {
      favicon = new URL('/favicon.ico', service.url).href;
    } catch {}
  }

  return (
    <span className={box}>
      {favicon && !faviconFailed ? (
        <img src={favicon} alt="" className="size-5 object-contain" onError={() => setFaviconFailed(true)} />
      ) : (
        <span className="text-sm font-semibold uppercase">{service.name.slice(0, 1)}</span>
      )}
    </span>
  );
}
