import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { removeTree } from '../src/media/removeTree.ts';

function show() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bellhop-rm-'));
  const season = path.join(root, 'Black Bird (2022)', 'Season 01');
  fs.mkdirSync(path.join(season, '.chapters'), { recursive: true });
  fs.writeFileSync(path.join(season, 'Black Bird S01E01.mkv'), 'x');
  fs.writeFileSync(path.join(season, '.chapters', 'Black Bird S01E01_chapters.xml'), 'x');
  return { root, top: path.join(root, 'Black Bird (2022)'), season };
}

test('removes a whole tree, hidden folders included', async () => {
  const { top } = show();
  assert.deepEqual(await removeTree(top), []);
  assert.equal(fs.existsSync(top), false);
});

test('a missing target is not a failure', async () => {
  const { root } = show();
  assert.deepEqual(await removeTree(path.join(root, 'nope')), []);
});

// A folder without write permission stands in for a locked file: its contents can't be unlinked.
test('names the stuck file, keeps going, and leaves its folders', { skip: process.getuid?.() === 0 }, async () => {
  const { top, season } = show();
  const chapters = path.join(season, '.chapters');
  fs.chmodSync(chapters, 0o555);
  try {
    const failures = await removeTree(top);
    assert.deepEqual(failures, [{ path: path.join(chapters, 'Black Bird S01E01_chapters.xml'), code: 'EACCES' }]);
    assert.equal(fs.existsSync(path.join(season, 'Black Bird S01E01.mkv')), false);
    assert.equal(fs.existsSync(chapters), true);
  } finally {
    fs.chmodSync(chapters, 0o755);
  }
});
