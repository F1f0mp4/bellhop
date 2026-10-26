import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8080),
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  mediaDir: path.resolve(env.MEDIA_DIR ?? './data/media'),
  incomingDir: path.resolve(env.INCOMING_DIR ?? './data/incoming'),
  webDir: path.resolve(env.WEB_DIR ?? './web/dist'),
  adminUser: env.ADMIN_USER ?? 'admin',
  adminPassword: env.ADMIN_PASSWORD ?? '',
};

// Defaults for keys in the settings table. The admin UI overrides these.
export const settingDefaults: Record<string, string> = {
  jellyfin_url: env.JELLYFIN_URL ?? '',
  jellyfin_key: env.JELLYFIN_KEY ?? '',
  tmdb_key: env.TMDB_KEY ?? '',
  movies_dir: env.MOVIES_DIR ?? 'Movies',
  shows_dir: env.SHOWS_DIR ?? 'Shows',
  music_dir: env.MUSIC_DIR ?? 'Music',
};

export const SECRET_SETTINGS = new Set(['jellyfin_key', 'tmdb_key']);
