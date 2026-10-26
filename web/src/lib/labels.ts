import { Film, Lightbulb, Music2, Tv, Wrench, type LucideIcon } from 'lucide-react';
import type { Priority, Status, TicketType } from './types.ts';

export const TYPE_INFO: Record<TicketType, { label: string; short: string; hint: string; icon: LucideIcon; tone: string }> = {
  issue: {
    label: "Something's broken",
    short: 'Issue',
    hint: 'Buffering, missing subtitles, Wi-Fi, a service is down',
    icon: Wrench,
    tone: 'text-rose-600 bg-rose-500/12 dark:text-rose-300',
  },
  feature: {
    label: 'I have an idea',
    short: 'Idea',
    hint: 'A new service, a setting, something that would be nice',
    icon: Lightbulb,
    tone: 'text-violet-600 bg-violet-500/12 dark:text-violet-300',
  },
  movie: {
    label: 'Movie',
    short: 'Movie',
    hint: 'Request a film for the library',
    icon: Film,
    tone: 'text-amber-700 bg-amber-500/14 dark:text-amber-300',
  },
  series: {
    label: 'Series',
    short: 'Series',
    hint: 'A show, or a missing season',
    icon: Tv,
    tone: 'text-teal-700 bg-teal-500/12 dark:text-teal-300',
  },
  music: {
    label: 'Music',
    short: 'Music',
    hint: 'An album or artist',
    icon: Music2,
    tone: 'text-pink-600 bg-pink-500/12 dark:text-pink-300',
  },
};

export const TYPES = Object.keys(TYPE_INFO) as TicketType[];
export const isMedia = (t: TicketType) => t === 'movie' || t === 'series' || t === 'music';

export const STATUS_INFO: Record<Status, { label: string; tone: string; dot: string }> = {
  new: { label: 'New', tone: 'text-sky-700 bg-sky-500/12 dark:text-sky-300', dot: 'bg-sky-500' },
  in_progress: { label: 'In progress', tone: 'text-amber-700 bg-amber-500/14 dark:text-amber-300', dot: 'bg-amber-500' },
  done: { label: 'Done', tone: 'text-emerald-700 bg-emerald-500/12 dark:text-emerald-300', dot: 'bg-emerald-500' },
  declined: { label: 'Declined', tone: 'text-zinc-600 bg-zinc-500/14 dark:text-zinc-400', dot: 'bg-zinc-500' },
};

export const STATUSES = Object.keys(STATUS_INFO) as Status[];

export const PRIORITY_INFO: Record<Priority, { label: string; dot: string }> = {
  low: { label: 'Low', dot: 'bg-zinc-400' },
  normal: { label: 'Normal', dot: 'bg-sky-500' },
  high: { label: 'High', dot: 'bg-rose-500' },
};
