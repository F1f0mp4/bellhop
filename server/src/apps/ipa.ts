import fs from 'node:fs';
import zlib from 'node:zlib';

/** What AltStore and SideStore need to know about an .ipa before they'll install it. */
export type IpaInfo = {
  bundleId: string;
  version: string; // CFBundleShortVersionString, which the source listing must match
  build: string; // CFBundleVersion
  minOS: string;
  name: string;
  privacy: Record<string, string>; // NS…UsageDescription keys from Info.plist
  entitlements: string[]; // from the main executable's code signature, if it has one
};

const MAX_PLIST = 4 * 1024 * 1024;

export async function readIpa(file: string): Promise<IpaInfo> {
  const fd = fs.openSync(file, 'r');
  try {
    const entries = zipEntries(fd);
    const plistEntry = entries.find((e) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(e.name));
    if (!plistEntry) throw new Error('No app inside this .ipa');
    const info = parsePlist(readEntry(fd, plistEntry, MAX_PLIST));
    if (!isDict(info)) throw new Error("The app's Info.plist is not a dictionary");
    const bundleId = str(info.CFBundleIdentifier);
    if (!bundleId) throw new Error("The app's Info.plist has no bundle identifier");

    const appDir = plistEntry.name.slice(0, -'Info.plist'.length);
    const exe = str(info.CFBundleExecutable);
    const exeEntry = exe ? entries.find((e) => e.name === appDir + exe) : undefined;
    // An unsigned build simply has none; that isn't a reason to refuse the file.
    const entitlements = exeEntry ? await readEntitlements(file, fd, exeEntry).catch(() => []) : [];

    const privacy: Record<string, string> = {};
    for (const [k, v] of Object.entries(info)) if (/^NS\w+UsageDescription$/.test(k) && typeof v === 'string') privacy[k] = v;

    return {
      bundleId,
      version: str(info.CFBundleShortVersionString) || str(info.CFBundleVersion),
      build: str(info.CFBundleVersion),
      minOS: str(info.MinimumOSVersion),
      name: str(info.CFBundleDisplayName) || str(info.CFBundleName) || exe,
      privacy,
      entitlements,
    };
  } finally {
    fs.closeSync(fd);
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const isDict = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && !Buffer.isBuffer(v);

// ── Zip ─────────────────────────────────────────────────────────────────────────────────────────

export type ZipEntry = { name: string; method: number; compressedSize: number; size: number; offset: number };

function readAt(fd: number, pos: number, len: number): Buffer {
  const b = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = fs.readSync(fd, b, got, len - got, pos + got);
    if (!n) throw new Error('The file ends early');
    got += n;
  }
  return b;
}

/** The files in a zip, from its central directory. Only the end of the file is read. */
export function zipEntries(fd: number): ZipEntry[] {
  const { size } = fs.fstatSync(fd);
  const tailLen = Math.min(size, 22 + 65535 + 20); // end record, longest comment, zip64 locator
  const tail = readAt(fd, size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  let count = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error('Broken zip64 file');
    const rec = readAt(fd, Number(tail.readBigUInt64LE(loc + 8)), 56);
    if (rec.readUInt32LE(0) !== 0x06064b50) throw new Error('Broken zip64 file');
    count = Number(rec.readBigUInt64LE(32));
    cdSize = Number(rec.readBigUInt64LE(40));
    cdOffset = Number(rec.readBigUInt64LE(48));
  }
  if (cdOffset + cdSize > size) throw new Error('Broken zip directory');

  const cd = readAt(fd, cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('Broken zip directory');
    const method = cd.readUInt16LE(p + 10);
    let compressedSize = cd.readUInt32LE(p + 20);
    let fileSize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let offset = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    // zip64 extra field: holds only the values that didn't fit, in this order.
    const extraEnd = p + 46 + nameLen + extraLen;
    for (let e = p + 46 + nameLen; e + 4 <= extraEnd; ) {
      const id = cd.readUInt16LE(e);
      const len = cd.readUInt16LE(e + 2);
      if (id === 1) {
        let q = e + 4;
        const take = () => {
          const v = Number(cd.readBigUInt64LE(q));
          q += 8;
          return v;
        };
        if (fileSize === 0xffffffff) fileSize = take();
        if (compressedSize === 0xffffffff) compressedSize = take();
        if (offset === 0xffffffff) offset = take();
      }
      e += 4 + len;
    }
    entries.push({ name, method, compressedSize, size: fileSize, offset });
    p = extraEnd + commentLen;
  }
  return entries;
}

function dataStart(fd: number, entry: ZipEntry) {
  const local = readAt(fd, entry.offset, 30);
  if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('Broken zip entry');
  return entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
}

/** One small file's contents. Refuses anything over `max`, so a hostile zip can't fill memory. */
export function readEntry(fd: number, entry: ZipEntry, max: number): Buffer {
  if (entry.size > max || entry.compressedSize > max) throw new Error(`${entry.name} is too large`);
  const data = readAt(fd, dataStart(fd, entry), entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: max });
  throw new Error(`Unsupported compression in ${entry.name}`);
}

// ── Code signature ──────────────────────────────────────────────────────────────────────────────

const HEAD_BYTES = 1024 * 1024;

/**
 * Entitlements from the executable's code signature. The executable can be hundreds of MB, so it is
 * inflated as a stream and only the headers and the signature are kept.
 */
async function readEntitlements(file: string, fd: number, entry: ZipEntry): Promise<string[]> {
  if (entry.method !== 0 && entry.method !== 8) return [];
  const start = dataStart(fd, entry);
  if (!entry.compressedSize) return [];
  const src = fs.createReadStream(file, { start, end: start + entry.compressedSize - 1 });
  const stream = entry.method === 8 ? src.pipe(zlib.createInflateRaw()) : src;
  src.on('error', (e) => stream.destroy(e));

  let head = Buffer.alloc(0);
  let range: [number, number] | undefined;
  const kept: Buffer[] = [];
  let pos = 0;
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      if (!range) {
        head = Buffer.concat([head, chunk]);
        if (head.length < HEAD_BYTES && pos + chunk.length < entry.size) {
          pos += chunk.length;
          continue;
        }
        range = codeSignatureRange(head);
        if (!range) return [];
        if (range[0] < head.length) kept.push(head.subarray(range[0], Math.min(range[1], head.length)));
        head = Buffer.alloc(0);
      } else {
        const s = Math.max(range[0], pos);
        const e = Math.min(range[1], pos + chunk.length);
        if (s < e) kept.push(chunk.subarray(s - pos, e - pos));
      }
      pos += chunk.length;
      if (pos >= range[1]) break;
    }
  } finally {
    src.destroy();
    stream.destroy();
  }
  return range ? entitlementsFromSignature(Buffer.concat(kept)) : [];
}

/** Where the code signature sits in a Mach-O file (the first slice of a universal one). */
export function codeSignatureRange(b: Buffer): [number, number] | undefined {
  if (b.length < 32) return;
  let base = 0;
  const fat = b.readUInt32BE(0);
  if (fat === 0xcafebabe || fat === 0xcafebabf) {
    if (!b.readUInt32BE(4)) return;
    base = fat === 0xcafebabe ? b.readUInt32BE(16) : Number(b.readBigUInt64BE(16));
    if (base + 32 > b.length) return;
  }
  const magic = b.readUInt32LE(base);
  if (magic !== 0xfeedfacf && magic !== 0xfeedface) return;
  const ncmds = b.readUInt32LE(base + 16);
  let p = base + (magic === 0xfeedfacf ? 32 : 28);
  for (let i = 0; i < ncmds && p + 16 <= b.length; i++) {
    const cmd = b.readUInt32LE(p);
    const size = b.readUInt32LE(p + 4);
    if (cmd === 0x1d) {
      const off = b.readUInt32LE(p + 8);
      const len = b.readUInt32LE(p + 12);
      return [base + off, base + off + len];
    }
    if (size < 8) return;
    p += size;
  }
}

/** The keys of the entitlements plist inside a code signature super blob. */
export function entitlementsFromSignature(sig: Buffer): string[] {
  if (sig.length < 12 || sig.readUInt32BE(0) !== 0xfade0cc0) return [];
  const count = sig.readUInt32BE(8);
  for (let i = 0; i < count && 20 + i * 8 <= sig.length; i++) {
    const off = sig.readUInt32BE(16 + i * 8);
    if (off + 8 > sig.length || sig.readUInt32BE(off) !== 0xfade7171) continue;
    const len = Math.min(sig.readUInt32BE(off + 4), sig.length - off);
    const dict = parsePlist(sig.subarray(off + 8, off + len));
    return isDict(dict) ? Object.keys(dict) : [];
  }
  return [];
}

// ── Property lists ──────────────────────────────────────────────────────────────────────────────

export function parsePlist(b: Buffer): unknown {
  return b.toString('latin1', 0, 8) === 'bplist00' ? parseBinaryPlist(b) : parseXmlPlist(b.toString('utf8'));
}

function parseBinaryPlist(b: Buffer): unknown {
  if (b.length < 40) throw new Error('Broken plist');
  const t = b.length - 32;
  const offSize = b[t + 6];
  const refSize = b[t + 7];
  const numObjects = Number(b.readBigUInt64BE(t + 8));
  const top = Number(b.readBigUInt64BE(t + 16));
  const table = Number(b.readBigUInt64BE(t + 24));
  if (!offSize || !refSize || table + numObjects * offSize > t) throw new Error('Broken plist');
  const uint = (pos: number, n: number) => {
    if (pos + n > b.length) throw new Error('Broken plist');
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + b[pos + i];
    return v;
  };

  const parse = (index: number, depth: number): unknown => {
    if (depth > 64 || index >= numObjects) throw new Error('Broken plist');
    const pos = uint(table + index * offSize, offSize);
    const marker = b[pos];
    const type = marker >> 4;
    const info = marker & 15;
    const length = (unit: number): [number, number] => {
      let n = info;
      let s = pos + 1;
      if (info === 15) {
        const w = 1 << (b[pos + 1] & 15);
        n = uint(pos + 2, w);
        s = pos + 2 + w;
      }
      if (s + n * unit > b.length) throw new Error('Broken plist');
      return [n, s];
    };
    switch (type) {
      case 0x0:
        return info === 8 ? false : info === 9 ? true : null;
      case 0x1:
        return info === 3 ? Number(b.readBigInt64BE(pos + 1)) : uint(pos + 1, 1 << info);
      case 0x2:
        return info === 2 ? b.readFloatBE(pos + 1) : b.readDoubleBE(pos + 1);
      case 0x3:
        return new Date((978307200 + b.readDoubleBE(pos + 1)) * 1000).toISOString();
      case 0x4: {
        const [n, s] = length(1);
        return b.subarray(s, s + n);
      }
      case 0x5: {
        const [n, s] = length(1);
        return b.toString('latin1', s, s + n);
      }
      case 0x6: {
        const [n, s] = length(2);
        return Buffer.from(b.subarray(s, s + 2 * n)).swap16().toString('utf16le');
      }
      case 0x8:
        return uint(pos + 1, info + 1);
      case 0xa: {
        const [n, s] = length(refSize);
        return Array.from({ length: n }, (_, k) => parse(uint(s + k * refSize, refSize), depth + 1));
      }
      case 0xd: {
        const [n, s] = length(2 * refSize);
        const out: Record<string, unknown> = {};
        for (let k = 0; k < n; k++) {
          out[String(parse(uint(s + k * refSize, refSize), depth + 1))] = parse(uint(s + (n + k) * refSize, refSize), depth + 1);
        }
        return out;
      }
    }
    throw new Error('Unsupported plist value');
  };
  return parse(top, 0);
}

type Tok = { tag?: string; close?: boolean; self?: boolean; text?: string };

function parseXmlPlist(xml: string): unknown {
  const toks: Tok[] = [];
  for (const m of xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([A-Za-z]+)[^>]*?(\/?)>|([^<]+)/g)) {
    toks.push(m[2] ? { tag: m[2], close: m[1] === '/', self: m[3] === '/' } : { text: m[4] });
  }
  let i = 0;
  const nextTag = () => {
    while (i < toks.length && !toks[i].tag) i++;
    if (i >= toks.length) throw new Error('Broken plist');
    return toks[i++];
  };
  const textUntil = (name: string) => {
    let s = '';
    while (i < toks.length && !(toks[i].tag === name && toks[i].close)) s += toks[i++].text ?? '';
    i++;
    return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()],
    );
  };
  const value = (depth: number): unknown => {
    if (depth > 64) throw new Error('Broken plist');
    const t = nextTag();
    switch (t.tag) {
      case 'plist':
        return value(depth + 1);
      case 'dict': {
        const out: Record<string, unknown> = {};
        if (t.self) return out;
        for (;;) {
          const k = nextTag();
          if (k.tag === 'dict' && k.close) return out;
          if (k.tag !== 'key') throw new Error('Broken plist');
          const key = textUntil('key');
          out[key] = value(depth + 1);
        }
      }
      case 'array': {
        const out: unknown[] = [];
        if (t.self) return out;
        for (;;) {
          while (i < toks.length && !toks[i].tag) i++;
          if (toks[i]?.tag === 'array' && toks[i].close) {
            i++;
            return out;
          }
          out.push(value(depth + 1));
        }
      }
      case 'string':
        return t.self ? '' : textUntil('string');
      case 'integer':
      case 'real':
        return Number(textUntil(t.tag));
      case 'true':
      case 'false':
        if (!t.self) textUntil(t.tag);
        return t.tag === 'true';
      case 'date':
        return textUntil('date').trim();
      case 'data':
        return Buffer.from(textUntil('data').replace(/\s+/g, ''), 'base64');
    }
    throw new Error('Broken plist');
  };
  return value(0);
}
