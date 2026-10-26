// Filename parsing and Jellyfin path building.
// Pure string code with no Node imports: the web app imports this file too,
// so previews in the browser match what the server does on import.

export type MediaType = 'movie' | 'series' | 'music';

export type Meta = {
  type: MediaType;
  title: string;
  year?: string;
  season?: number;
  episode?: number;
  episodeEnd?: number;
  artist?: string;
  album?: string;
};

export type Dirs = { movies: string; shows: string; music: string };

export const VIDEO_EXT = ['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.wmv', '.ts', '.m2ts', '.webm', '.mpg', '.mpeg', '.flv'];
export const SUB_EXT = ['.srt', '.ass', '.ssa', '.sub', '.idx', '.vtt', '.sup'];
export const AUDIO_EXT = ['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.alac', '.wma', '.aiff', '.ape', '.wv'];
export const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

export type FileKind = 'video' | 'sub' | 'audio' | 'image' | 'other';

export function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  if (i <= 0) return [name, ''];
  return [name.slice(0, i), name.slice(i).toLowerCase()];
}

export function kindOf(name: string): FileKind {
  const ext = splitExt(name)[1];
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (SUB_EXT.includes(ext)) return 'sub';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (IMAGE_EXT.includes(ext)) return 'image';
  return 'other';
}

/** Files worth importing. Everything else (nfo, txt, exe, samples) stays behind. */
export function isImportable(name: string): boolean {
  if (/(^|[\s._-])sample([\s._-]|$)/i.test(splitExt(name)[0])) return false;
  return kindOf(name) !== 'other';
}

const QUALITY =
  /\b(2160p|1080[pi]|720p|576p|480p|4k|uhd|blu ?ray|bdrip|brrip|bdremux|web ?dl|web ?rip|webrip|web|hdtv|hdrip|dvdrip|dvd|remux|x ?264|x ?265|h ?264|h ?265|hevc|avc|hdr|hdr10|dv|dovi|atmos|ddp?\s?[257]\s?[01]|aac|ac3|eac3|dts|truehd|10 ?bit|proper|repack|extended|unrated|remastered|imax|multi|dual audio|complete|internal|limited)\b/i;

const EPISODE = /\bS(\d{1,2})\s?E(\d{1,3})(?:\s?-?\s?E(\d{1,3})|-(\d{1,3})\b)?/i;
const EPISODE_X = /\b(\d{1,2})x(\d{2,3})\b/;
const SEASON_ONLY = /\b(?:S(\d{1,2})|Season\s?(\d{1,2}))\b/i;
const YEAR = /\b(19[2-9]\d|20\d{2})\b/g;

function clean(raw: string): string {
  return raw
    .replace(/^\s*(\[[^\]]*\]\s*)+/, '') // leading [ReleaseGroup] tags
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tidyTitle(raw: string): string {
  let t = raw.replace(/[([{\-–\s]+$/, '').replace(/^[-–\s]+/, '').replace(/\(\s*\)/g, '').trim();
  if (t && t === t.toLowerCase()) t = t.replace(/\b\w/g, (ch) => ch.toUpperCase());
  return t;
}

/** Text before the first quality tag, e.g. "Dune Part Two 2024 2160p" -> "Dune Part Two 2024". */
function beforeQuality(s: string): string {
  const m = QUALITY.exec(s);
  return m ? s.slice(0, m.index) : s;
}

function lastYear(s: string): { year: string; index: number } | undefined {
  let found: { year: string; index: number } | undefined;
  for (const m of s.matchAll(YEAR)) if (m.index! > 0) found = { year: m[1], index: m.index! };
  return found;
}

export type Parsed = Meta & { ext: string };

/**
 * Guess what a file is from its name. `folder` is the name of the folder it sat in,
 * used when the file name alone says too little ("S01E02.mkv", "01 - Intro.flac").
 */
export function parseName(filename: string, folder?: string): Parsed {
  const [rawBase, ext] = splitExt(filename);
  const base = clean(rawBase);
  const kind = kindOf(filename);

  if (kind === 'audio' || (kind === 'image' && folder)) {
    return { ...parseMusic(base, folder), ext };
  }

  const ep = EPISODE.exec(base) ?? EPISODE_X.exec(base);
  if (ep) {
    const season = Number(ep[1]);
    const episode = Number(ep[2]);
    const endRaw = ep[3] ?? ep[4];
    let head = base.slice(0, ep.index);
    const y = lastYear(head);
    let year = y?.year;
    if (y) head = head.slice(0, y.index);
    let title = tidyTitle(head);
    if (!title && folder) {
      const f = parseFolder(folder);
      title = f.title;
      year ??= f.year;
    }
    return {
      type: 'series',
      title,
      year,
      season,
      episode,
      episodeEnd: endRaw ? Number(endRaw) : undefined,
      ext,
    };
  }

  const head = beforeQuality(base);
  const y = lastYear(head);
  let title = tidyTitle(y ? head.slice(0, y.index) : head);
  let year = y?.year;

  // A movie folder like "Dune (2021)" usually knows better than "dune-1080p.mkv".
  if (folder) {
    const f = parseFolder(folder);
    if (f.season !== undefined) {
      return { type: 'series', title: f.title, year: f.year, season: f.season, ext };
    }
    if (f.year && !year) {
      title = f.title;
      year = f.year;
    }
  }
  return { type: 'movie', title, year, ext };
}

/** Parse a folder name: "Dune (2021)", "Severance.S02.1080p", "Artist - Album (2020)". */
export function parseFolder(name: string): { title: string; year?: string; season?: number } {
  const base = clean(name);
  const s = SEASON_ONLY.exec(base);
  const head = beforeQuality(s ? base.slice(0, s.index) : base);
  const y = lastYear(head);
  const title = tidyTitle(y ? head.slice(0, y.index) : head);
  const season = s ? Number(s[1] ?? s[2]) : undefined;
  return { title, year: y?.year, season };
}

function parseMusic(base: string, folder?: string): Meta {
  let artist = '';
  let album = '';
  let year: string | undefined;
  if (folder) {
    const f = clean(folder);
    const y = lastYear(f);
    year = y?.year;
    const name = tidyTitle(y ? f.slice(0, y.index) : f);
    const parts = name.split(/\s+-\s+/);
    if (parts.length >= 2) {
      artist = parts[0];
      album = parts.slice(1).join(' - ');
    } else {
      album = name;
    }
  }
  if (!artist) {
    // "Artist - Title" or "Artist - Album - 03 - Title"
    const parts = base.replace(/^\d{1,3}\s*[-.]\s*/, '').split(/\s+-\s+/);
    if (parts.length >= 2 && !/^\d+$/.test(parts[0])) artist = parts[0];
    if (parts.length >= 3 && !album) album = parts[1];
  }
  return {
    type: 'music',
    title: album || artist,
    artist: artist || 'Unknown Artist',
    album: album || 'Unknown Album',
    year,
  };
}

/** Make a string safe as a single path segment on Linux, Windows shares and Jellyfin. */
export function sanitize(segment: string): string {
  let s = segment
    .replace(/:\s/g, ' - ')
    .replace(/[:]/g, '-')
    .replace(/[\\/*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 180);
  if (!s || s === '.' || s === '..') s = 'Unknown';
  return s;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ".en", ".eng.forced" etc. from "Movie.en.srt", so subtitles keep their language. */
function subtitleSuffix(filename: string): string {
  const m = /\.([a-z]{2,3}|english|czech|slovak|german|french|spanish)(\.(forced|sdh|cc))?$/i.exec(splitExt(filename)[0]);
  return m ? m[0].toLowerCase() : '';
}

export function validateMeta(meta: Meta): string | null {
  if (meta.type === 'music') {
    if (!meta.artist?.trim() || !meta.album?.trim()) return 'Needs an artist and album';
    return null;
  }
  if (!meta.title?.trim()) return 'Needs a title';
  if (meta.year && !/^\d{4}$/.test(meta.year)) return 'Year should look like 2024';
  if (meta.type === 'series') {
    if (!Number.isInteger(meta.season) || meta.season! < 0) return 'Needs a season number';
    if (!Number.isInteger(meta.episode) || meta.episode! < 0) return 'Needs an episode number';
  }
  return null;
}

/** Target path relative to the media root, always with forward slashes. */
export function buildTarget(meta: Meta, filename: string, dirs: Dirs): string {
  const ext = splitExt(filename)[1];
  const isSub = kindOf(filename) === 'sub';
  const lang = isSub ? subtitleSuffix(filename) : '';

  if (meta.type === 'music') {
    return [dirs.music, sanitize(meta.artist!), sanitize(meta.album!), sanitize(filename)].join('/');
  }

  const title = sanitize(meta.title);
  const named = meta.year ? `${title} (${meta.year})` : title;

  if (meta.type === 'movie') {
    if (kindOf(filename) === 'image') return [dirs.movies, named, sanitize(filename)].join('/');
    return [dirs.movies, named, `${named}${lang}${ext}`].join('/');
  }

  const ep = `S${pad(meta.season!)}E${pad(meta.episode!)}${meta.episodeEnd ? `-E${pad(meta.episodeEnd)}` : ''}`;
  return [dirs.shows, named, `Season ${pad(meta.season!)}`, `${title} ${ep}${lang}${ext}`].join('/');
}

/** Files that belong together in the upload screen (one movie, one show, one album). */
export function groupKey(meta: Meta): string {
  if (meta.type === 'music') return `music|${meta.artist?.toLowerCase()}|${meta.album?.toLowerCase()}`;
  return `${meta.type}|${meta.title.toLowerCase()}|${meta.year ?? ''}`;
}
