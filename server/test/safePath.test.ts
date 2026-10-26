import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveInside, UnsafePathError } from '../src/media/safePath.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bellhop-safe-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bellhop-out-'));
fs.mkdirSync(path.join(root, 'Movies'));
fs.symlinkSync(outside, path.join(root, 'escape'));

test('allows normal paths', () => {
  assert.equal(resolveInside(root, 'Movies/Dune (2021)/x.mkv'), path.join(root, 'Movies/Dune (2021)/x.mkv'));
  assert.equal(resolveInside(root, ''), path.resolve(root));
});

test('absolute paths stay inside the root', () => {
  assert.equal(resolveInside(root, '/etc/passwd'), path.join(root, 'etc/passwd'));
});

for (const bad of ['../x', 'Movies/../../x', '..', 'a/../../../etc/passwd']) {
  test(`blocks ${bad}`, () => assert.throws(() => resolveInside(root, bad), UnsafePathError));
}

test('blocks symlinks that point outside', () => {
  assert.throws(() => resolveInside(root, 'escape/file.mkv'), UnsafePathError);
});

test('blocks sibling folders with the same prefix', () => {
  assert.throws(() => resolveInside(root, `../${path.basename(root)}-evil/x`), UnsafePathError);
});
