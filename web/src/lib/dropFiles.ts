import { isImportable } from '../../../server/src/media/naming.ts';
import type { NewEntry } from './staging.ts';

type FsEntry = FileSystemEntry;

function readAll(dir: FileSystemDirectoryEntry): Promise<FsEntry[]> {
  const reader = dir.createReader();
  const out: FsEntry[] = [];
  return new Promise((resolve, reject) => {
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(out);
        out.push(...batch);
        next(); // readEntries hands back at most ~100 entries per call
      }, reject);
    next();
  });
}

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((res, rej) => entry.file(res, rej));

async function walk(entry: FsEntry, parent: string | undefined, out: { file: File; folder?: string }[]) {
  if (entry.isFile) {
    out.push({ file: await fileOf(entry as FileSystemFileEntry), folder: parent });
  } else if (entry.isDirectory) {
    for (const child of await readAll(entry as FileSystemDirectoryEntry)) await walk(child, entry.name, out);
  }
}

/** Files from a drop, including everything inside dropped folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<{ entries: NewEntry[]; skipped: number }> {
  const found: { file: File; folder?: string }[] = [];
  const items = [...dt.items].filter((i) => i.kind === 'file');
  const roots = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FsEntry[];
  if (roots.length) {
    for (const r of roots) await walk(r, undefined, found);
  } else {
    for (const f of dt.files) found.push({ file: f });
  }
  return toEntries(found);
}

/** Files from <input type="file">, where folders arrive with webkitRelativePath set. */
export function filesFromInput(list: FileList): { entries: NewEntry[]; skipped: number } {
  return toEntries(
    [...list].map((file) => {
      const parts = file.webkitRelativePath?.split('/') ?? [];
      return { file, folder: parts.length > 1 ? parts[parts.length - 2] : undefined };
    }),
  );
}

function toEntries(found: { file: File; folder?: string }[]) {
  const keep = found.filter((f) => isImportable(f.file.name));
  return {
    entries: keep.map(({ file, folder }) => ({ name: file.name, size: file.size, folder, source: 'upload' as const, file })),
    skipped: found.length - keep.length,
  };
}
