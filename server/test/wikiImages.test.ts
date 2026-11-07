import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bellhop-wiki-'));
const { imagePath, saveImage, sniffImage } = await import('../src/wikiImages.ts');

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const bytes = (s: string) => new TextEncoder().encode(s);

test('sniff recognises the allowed formats', () => {
  assert.equal(sniffImage(png), 'png');
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(sniffImage(bytes('GIF89a....')), 'gif');
  assert.equal(sniffImage(bytes('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
});

test('sniff refuses SVG, HTML and short files', () => {
  assert.equal(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), undefined);
  assert.equal(sniffImage(bytes('<!doctype html><script></script>')), undefined);
  assert.equal(sniffImage(bytes('RIFF\0\0\0\0WAVE')), undefined);
  assert.equal(sniffImage(new Uint8Array([0x89])), undefined);
});

test('saving the same image twice gives one file', () => {
  const a = saveImage(png, 'png');
  assert.equal(saveImage(png, 'png'), a);
  assert.match(a, /^[0-9a-f]{24}\.png$/);
  assert.deepEqual(imagePath(a)?.type, 'image/png');
  assert.deepEqual(new Uint8Array(fs.readFileSync(imagePath(a)!.file)), png);
});

test('imagePath only serves our own names', () => {
  assert.equal(imagePath('../bellhop.db'), undefined);
  assert.equal(imagePath('..%2Fbellhop.db'), undefined);
  assert.equal(imagePath('0123456789abcdef01234567.svg'), undefined);
  assert.equal(imagePath('0123456789abcdef01234567.png'), undefined); // well formed, not stored
});
