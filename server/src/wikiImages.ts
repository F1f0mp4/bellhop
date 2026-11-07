import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as const;
export type ImageExt = keyof typeof IMAGE_TYPES;

/**
 * The image format from the file's first bytes, ignoring its name and the browser's claim.
 * SVG is left out on purpose: served from this origin it could run scripts.
 */
export function sniffImage(b: Uint8Array): ImageExt | undefined {
  const starts = (sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts([0xff, 0xd8, 0xff])) return 'jpg';
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
}

const NAME = /^[0-9a-f]{24}\.(png|jpg|gif|webp)$/;

export const imagesDir = () => path.join(config.dataDir, 'wiki-images');

/** Saves the image under a name taken from its contents, so the same picture is only stored once. */
export function saveImage(bytes: Uint8Array, ext: ImageExt): string {
  const name = `${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24)}.${ext}`;
  const dir = imagesDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  }
  return name;
}

/** The stored file for a name from a URL, or undefined for anything that isn't one of ours. */
export function imagePath(name: string): { file: string; type: string } | undefined {
  const m = NAME.exec(name);
  if (!m) return undefined;
  const file = path.join(imagesDir(), name);
  return fs.existsSync(file) ? { file, type: IMAGE_TYPES[m[1] as ImageExt] } : undefined;
}
