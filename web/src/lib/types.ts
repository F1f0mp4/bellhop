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

export type WikiSummary = { slug: string; title: string; category: string; updated_at: string; excerpt: string; created_by: string | null };
export type WikiPage = {
  id: number;
  slug: string;
  title: string;
  body: string;
  /** Empty when the page has none. */
  category: string;
  created_at: string;
  updated_at: string;
  /** Usernames; null once that account is deleted. */
  created_by: string | null;
  updated_by: string | null;
};

export type Platform = 'ios' | 'android' | 'macos' | 'windows' | 'linux';
export type DownloadFrom = 'server' | 'appstore' | 'play' | 'fdroid' | 'flathub' | 'github' | 'web';

export type AppDownload = {
  id: number;
  platform: Platform;
  label: string;
  href: string;
  from: DownloadFrom;
  file_name: string | null;
  size: number | null;
  version: string | null;
  released_at: string | null;
  sideload: string | null; // an .ipa address AltStore or SideStore can fetch
};

export type CatalogApp = {
  id: number;
  slug: string;
  name: string;
  developer: string;
  subtitle: string;
  description: string;
  category: string;
  homepage: string;
  license: string;
  repo: string;
  icon: string | null;
  tint: string;
  featured: boolean;
  version: string | null;
  downloads: AppDownload[];
};

export type Catalog = { apps: CatalogApp[]; source: string | null };

export type IpaInfo = { bundleId: string; version: string; build: string; minOS: string; name: string };

export type AdminDownload = {
  id: number;
  platform: Platform;
  label: string;
  source: 'link' | 'release' | 'upload';
  url: string;
  asset: string;
  keep: boolean;
  remote_url: string | null;
  file_name: string | null;
  size: number | null;
  version: string | null;
  released_at: string | null;
  ipa: IpaInfo | null;
  error: string | null;
  stored: boolean;
  keeps_copy: boolean;
  progress: { received: number; total: number } | null;
};

export type AdminApp = Omit<CatalogApp, 'downloads' | 'version'> & {
  icon_url: string;
  starter: string | null;
  release_tag: string | null;
  checked_at: string | null;
  check_error: string | null;
  checking: boolean;
  position: number;
  downloads: AdminDownload[];
};

export type AppsAdminData = {
  apps: AdminApp[];
  checking: boolean;
  checked_at: string | null;
  stored_bytes: number;
  source: string;
  has_github_token: boolean;
  starter_left: number;
};
