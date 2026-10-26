export type User = { id: number; username: string; role: 'user' | 'admin' };

export type TicketType = 'issue' | 'feature' | 'movie' | 'series' | 'music';
export type Status = 'new' | 'in_progress' | 'done' | 'declined';
export type Priority = 'low' | 'normal' | 'high';

export type MediaRef = {
  source: 'tmdb' | 'musicbrainz' | 'manual';
  id: string;
  title: string;
  year?: string;
  poster?: string;
  subtitle?: string;
};

export type Ticket = {
  id: number;
  user_id: number;
  username: string;
  type: TicketType;
  title: string;
  body: string;
  status: Status;
  priority: Priority;
  media_ref: MediaRef | null;
  comment_count: number;
  created_at: string;
  updated_at: string;
};

export type Comment = {
  id: number;
  kind: 'comment' | 'event';
  body: string;
  created_at: string;
  username: string | null;
  role: 'user' | 'admin' | null;
};

export type LookupResult = MediaRef & { overview?: string };

export type Health = {
  up: boolean;
  ms?: number;
  error?: string;
  minecraft?: { version: string; players: number; max: number; motd: string };
  checked_at: string;
};

export type Service = {
  id: number;
  name: string;
  kind: 'web' | 'minecraft';
  url: string;
  check_url: string;
  category: string;
  description: string;
  icon: string;
  checks: number;
  position: number;
  health: Health | null;
};

export type WikiSummary = { slug: string; title: string; updated_at: string; excerpt: string };
export type WikiPage = { id: number; slug: string; title: string; body: string; created_at: string; updated_at: string; updated_by: string | null };
