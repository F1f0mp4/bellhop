-- Bellhop ticket store. Applied on every boot; every statement is idempotent.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,            -- sha256 of the cookie token
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL CHECK (type IN ('issue', 'feature', 'movie', 'series', 'music')),
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL DEFAULT '',
  status     TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'done', 'declined')),
  priority   TEXT    NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  media_ref  TEXT,                           -- JSON: { source, id, title, year, poster, subtitle }
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS tickets_user   ON tickets(user_id);

-- Replies and status changes, shown together as the ticket's timeline.
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY,
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT    NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'event')),
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS comments_ticket ON comments(ticket_id);

-- Links in the side panel: web apps open in a new tab, Minecraft servers show players online.
CREATE TABLE IF NOT EXISTS services (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL DEFAULT 'web' CHECK (kind IN ('web', 'minecraft')),
  url         TEXT    NOT NULL,              -- https://jellyfin.example.com, or mc.example.com:25565
  check_url   TEXT    NOT NULL DEFAULT '',   -- optional address to health-check instead of url
  category    TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL DEFAULT '',
  icon        TEXT    NOT NULL DEFAULT 'auto',
  checks      INTEGER NOT NULL DEFAULT 1,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Wiki pages in Markdown. Everyone reads, admins write.
CREATE TABLE IF NOT EXISTS wiki_pages (
  id         INTEGER PRIMARY KEY,
  slug       TEXT    NOT NULL UNIQUE,
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL DEFAULT '',
  category   TEXT    NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The Apps page: open source apps for the household, each with downloads per platform.
CREATE TABLE IF NOT EXISTS apps (
  id          INTEGER PRIMARY KEY,
  slug        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  developer   TEXT    NOT NULL DEFAULT '',
  subtitle    TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL DEFAULT '',
  category    TEXT    NOT NULL DEFAULT '',
  repo        TEXT    NOT NULL DEFAULT '',   -- owner/name on GitHub, where release downloads come from
  homepage    TEXT    NOT NULL DEFAULT '',
  license     TEXT    NOT NULL DEFAULT '',
  icon        TEXT    NOT NULL DEFAULT '',   -- stored file name in data/apps/icons
  icon_url    TEXT    NOT NULL DEFAULT '',   -- where the icon comes from; empty = App Store, website or GitHub
  tint        TEXT    NOT NULL DEFAULT '',   -- #rrggbb for the featured card and AltStore
  featured    INTEGER NOT NULL DEFAULT 0,
  starter     TEXT,                          -- key in the starter list, so it isn't offered twice
  release_tag TEXT,
  checked_at  TEXT,
  check_error TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One way to get an app on one platform: a link (App Store, website), a file from the app's latest
-- GitHub release (optionally kept on this server), or a file an admin uploaded.
CREATE TABLE IF NOT EXISTS app_downloads (
  id             INTEGER PRIMARY KEY,
  app_id         INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  platform       TEXT    NOT NULL CHECK (platform IN ('ios', 'android', 'macos', 'windows', 'linux')),
  label          TEXT    NOT NULL DEFAULT '',
  source         TEXT    NOT NULL DEFAULT 'link' CHECK (source IN ('link', 'release', 'upload')),
  url            TEXT    NOT NULL DEFAULT '',   -- link: where Get goes
  asset          TEXT    NOT NULL DEFAULT '',   -- release: file name pattern, e.g. *-arm64.dmg
  keep           INTEGER NOT NULL DEFAULT 0,    -- release: keep a copy on this server
  remote_url     TEXT,                          -- release: the matching file on GitHub
  file           TEXT,                          -- stored copy, relative to data/apps/files
  file_name      TEXT,
  size           INTEGER,
  version        TEXT,
  released_at    TEXT,
  sha256         TEXT,
  ipa            TEXT,                          -- JSON read from an .ipa: bundle id, versions, permissions
  error          TEXT,
  position       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS app_downloads_app ON app_downloads(app_id);

-- Settings edited in the admin UI. Environment variables are the fallback.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
