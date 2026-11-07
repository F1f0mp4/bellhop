import fsp from 'node:fs/promises';
import path from 'node:path';

export type RemoveFailure = { path: string; code: string };

// Deletes everything it can under target and reports what it couldn't, with the real error.
// fs.rm gives up at the first stuck file, and on Linux a locked (immutable) file comes back as a
// misleading ENOTDIR from scandir instead of the EPERM that actually stopped it.
export async function removeTree(target: string): Promise<RemoveFailure[]> {
  const failures: RemoveFailure[] = [];
  const fail = (p: string, e: unknown) => {
    const code = (e as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    if (code !== 'ENOENT') failures.push({ path: p, code });
  };

  async function remove(p: string) {
    const st = await fsp.lstat(p).catch((e) => void fail(p, e));
    if (!st) return;
    if (!st.isDirectory()) {
      await fsp.unlink(p).catch((e) => fail(p, e));
      return;
    }
    const names = await fsp.readdir(p).catch((e) => void fail(p, e));
    if (!names) return;
    const before = failures.length;
    for (const name of names) await remove(path.join(p, name));
    // A folder that still holds a stuck file can't go either; the file is the one worth naming.
    if (failures.length === before) await fsp.rmdir(p).catch((e) => fail(p, e));
  }

  await remove(target);
  return failures;
}
