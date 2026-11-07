import { getSetting } from '../db.ts';

export type ReleaseAsset = { name: string; size: number; url: string };
export type Release = { tag: string; published_at: string; assets: ReleaseAsset[] };
export type RepoInfo = {
  repo: string;
  name: string;
  description: string;
  homepage: string;
  license: string;
  owner_avatar: string;
  owner_is_org: boolean;
};

export class GitHubError extends Error {
  rateLimited: boolean;
  constructor(message: string, rateLimited = false) {
    super(message);
    this.rateLimited = rateLimited;
  }
}

/** "owner/name" from that, or from any github.com link to the repo. */
export function parseRepo(input: string): string | undefined {
  const s = input.trim().replace(/\.git$/, '');
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/i.exec(s) ?? /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

// Checksums and signatures sit next to every file in a release; nobody wants to download those.
const SIDECAR = /\.(sig|asc|sha1|sha256|sha512|md5|blockmap|zsync|digest|sbom|json|txt)$/i;

export function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .trim()
    .split('')
    .map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[\\^$.+()[\]{}|]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`, 'i');
}

/**
 * The release file a pattern like `*-arm64.dmg` means. When several match, the shortest name wins:
 * the plain build tends to be the one without `-unsigned`, `-legacy` or `-debug` tacked on.
 */
export function matchAsset(pattern: string, assets: ReleaseAsset[]): ReleaseAsset | undefined {
  if (!pattern.trim()) return;
  const re = globToRegExp(pattern);
  const wantsSidecar = SIDECAR.test(pattern);
  return assets
    .filter((a) => re.test(a.name) && (wantsSidecar || !SIDECAR.test(a.name)))
    .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))[0];
}

export function githubHeaders(): Record<string, string> {
  const token = getSetting('github_token');
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'Bellhop',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function gh<T>(path: string, notFound: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com${path}`, { headers: githubHeaders(), signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new GitHubError("Couldn't reach GitHub");
  }
  if (res.status === 404) throw new GitHubError(notFound);
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
    const mins = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60e3)) : 60;
    throw new GitHubError(`GitHub's hourly limit is used up, it resets in ${mins} min. A token in Settings raises it.`, true);
  }
  if (res.status === 401) throw new GitHubError('GitHub refused the token in Settings');
  if (!res.ok) throw new GitHubError(`GitHub answered ${res.status}`);
  return (await res.json()) as T;
}

export async function latestRelease(repo: string): Promise<Release> {
  const r = await gh<any>(`/repos/${repo}/releases/latest`, `${repo} has no published release on GitHub`);
  return {
    tag: String(r.tag_name ?? ''),
    published_at: String(r.published_at ?? ''),
    assets: (r.assets ?? []).map((a: any) => ({ name: String(a.name), size: Number(a.size), url: String(a.browser_download_url) })),
  };
}

export async function repoInfo(repo: string): Promise<RepoInfo> {
  const r = await gh<any>(`/repos/${repo}`, `GitHub has no repo called ${repo}`);
  const license = r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : '';
  return {
    repo: String(r.full_name),
    name: String(r.name ?? ''),
    description: String(r.description ?? '').trim(),
    homepage: String(r.homepage ?? '').trim(),
    license,
    owner_avatar: String(r.owner?.avatar_url ?? ''),
    owner_is_org: r.owner?.type === 'Organization',
  };
}
