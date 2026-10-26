import fs from 'node:fs';
import path from 'node:path';

export class UnsafePathError extends Error {}

/**
 * Resolve `rel` inside `root` and refuse anything that escapes it,
 * including through symlinks that already exist on disk.
 */
export function resolveInside(root: string, rel: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, '.' + path.sep + (rel ?? ''));
  if (!isInside(base, target)) throw new UnsafePathError(`Path escapes ${base}`);

  // Walk up to the deepest part that exists and check where it really points.
  let probe = target;
  while (!fs.existsSync(probe) && probe !== base) probe = path.dirname(probe);
  if (fs.existsSync(probe) && fs.existsSync(base)) {
    const realBase = fs.realpathSync(base);
    const realProbe = fs.realpathSync(probe);
    if (!isInside(realBase, realProbe)) throw new UnsafePathError(`Path escapes ${base} through a link`);
  }
  return target;
}

export function isInside(base: string, target: string): boolean {
  return target === base || target.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}

/** Path relative to root with forward slashes, for sending to the browser. */
export const toRel = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join('/');
