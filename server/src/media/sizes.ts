import fsp from 'node:fs/promises';
import path from 'node:path';
import { kindOf } from './naming.ts';

/**
 * Totals for one folder, everything below it included. `audio` counts music files (tracks), and
 * `folders` counts only its direct, visible subfolders.
 */
export type DirSize = { bytes: number; files: number; audio: number; folders: number };

/**
 * Folder sizes for the library, kept in memory so browsing never has to walk the disk.
 * One walk fills in every folder below the start, and a change only re-reads the folder that
 * changed plus a shallow pass over each parent. Hidden files and folders (Jellyfin's .chapters and
 * *.trickplay) count toward sizes because they take real space, but not toward `folders`.
 */
export class SizeIndex {
  private sizes = new Map<string, DirSize>();
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private skip: string[];
  readonly root: string;
  scannedAt: Date | null = null;

  /** `skip` lists names directly under the root to leave out, like the upload staging folder. */
  constructor(root: string, skip: string[] = []) {
    this.root = path.resolve(root);
    this.skip = skip;
  }

  get(dir: string): DirSize | undefined {
    return this.sizes.get(path.resolve(dir));
  }

  /** True while a walk or refresh is queued or running. */
  get busy() {
    return this.pending > 0;
  }

  /** Walk the whole library again. */
  rescanAll() {
    return this.enqueue(async () => {
      await this.walk(this.root);
      this.scannedAt = new Date();
    });
  }

  /**
   * Something at `target` was added, removed or renamed. Re-reads it if it's a folder that's still
   * there, forgets it if it's gone, then brings every parent's total up to date.
   */
  changed(...targets: string[]) {
    return this.enqueue(async () => {
      for (const t of targets) {
        const abs = path.resolve(t);
        if (!this.inside(abs)) continue;
        this.forget(abs);
        const st = await fsp.lstat(abs).catch(() => null);
        if (st?.isDirectory()) await this.walk(abs);
        if (abs !== this.root) await this.recomputeUp(path.dirname(abs));
      }
    });
  }

  private enqueue(job: () => Promise<void>) {
    this.pending++;
    const run = this.queue.then(job).finally(() => this.pending--);
    this.queue = run.catch((e) => console.warn(`  library sizes: ${(e as Error).message}`));
    return run;
  }

  private inside(abs: string) {
    return abs === this.root || abs.startsWith(this.root + path.sep);
  }

  private skipped(dir: string, name: string) {
    return dir === this.root && this.skip.includes(name);
  }

  private forget(abs: string) {
    const prefix = abs + path.sep;
    for (const k of this.sizes.keys()) if (k === abs || k.startsWith(prefix)) this.sizes.delete(k);
  }

  /** Full walk of `dir`, recording every folder on the way back up. */
  private async walk(dir: string): Promise<DirSize> {
    const total: DirSize = { bytes: 0, files: 0, audio: 0, folders: 0 };
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    const files: string[] = [];
    for (const e of entries) {
      if (this.skipped(dir, e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        add(total, await this.walk(full));
        if (!e.name.startsWith('.')) total.folders++;
      } else {
        files.push(full);
      }
    }
    await this.addFiles(total, files);
    this.sizes.set(dir, total);
    return total;
  }

  /** Re-total `dir` and each parent from their own files plus the cached totals of their subfolders. */
  private async recomputeUp(dir: string) {
    for (let d = dir; this.inside(d); d = path.dirname(d)) {
      const total: DirSize = { bytes: 0, files: 0, audio: 0, folders: 0 };
      const entries = await fsp.readdir(d, { withFileTypes: true }).catch(() => []);
      const files: string[] = [];
      for (const e of entries) {
        if (this.skipped(d, e.name)) continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          add(total, this.sizes.get(full) ?? (await this.walk(full)));
          if (!e.name.startsWith('.')) total.folders++;
        } else {
          files.push(full);
        }
      }
      await this.addFiles(total, files);
      this.sizes.set(d, total);
      if (d === this.root) break;
    }
  }

  // Symlinks count as themselves, never what they point to, so nothing is counted twice.
  private async addFiles(total: DirSize, files: string[]) {
    for (let i = 0; i < files.length; i += 64) {
      const batch = files.slice(i, i + 64);
      const stats = await Promise.all(batch.map((f) => fsp.lstat(f).catch(() => null)));
      stats.forEach((st, j) => {
        if (!st) return;
        total.bytes += st.size;
        total.files++;
        if (kindOf(path.basename(batch[j])) === 'audio') total.audio++;
      });
    }
  }
}

function add(total: DirSize, sub: DirSize) {
  total.bytes += sub.bytes;
  total.files += sub.files;
  total.audio += sub.audio;
}
