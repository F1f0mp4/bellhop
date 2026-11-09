import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bellhop-apps-'));
const { Hono } = await import('hono');
const { HTTPException } = await import('hono/http-exception');
const { run, one } = await import('../src/db.ts');
const { codeSignatureRange, entitlementsFromSignature, parsePlist, readIpa } = await import('../src/apps/ipa.ts');
const { cleanVersion } = await import('../src/apps/updates.ts');
const { globToRegExp, matchAsset, parseRepo } = await import('../src/apps/github.ts');
const { altstoreCategory, buildSource } = await import('../src/apps/altstore.ts');
const { addStarterApps, STARTER_APPS } = await import('../src/apps/starter.ts');
const { appRoutes, cleanApp } = await import('../src/routes/apps.ts');

const tmp = (name: string) => path.join(process.env.DATA_DIR!, name);

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────

/** A minimal zip writer: stored or deflated entries, central directory, end record. */
function makeZip(entries: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const body = e.deflate ? zlib.deflateRawSync(e.data) : e.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>application-identifier</key><string>ABCDE12345.com.example.Demo</string>
<key>get-task-allow</key><true/>
<key>com.apple.security.application-groups</key><array><string>group.demo</string></array>
</dict></plist>`;

/** A 64-bit Mach-O with a code signature holding entitlements, padded past the reader's first megabyte. */
function makeExecutable(padding: number): Buffer {
  const xml = Buffer.from(ENTITLEMENTS);
  const blob = Buffer.alloc(8);
  blob.writeUInt32BE(0xfade7171, 0);
  blob.writeUInt32BE(8 + xml.length, 4);
  const superHead = Buffer.alloc(20);
  superHead.writeUInt32BE(0xfade0cc0, 0);
  superHead.writeUInt32BE(20 + 8 + xml.length, 4);
  superHead.writeUInt32BE(1, 8);
  superHead.writeUInt32BE(5, 12); // entitlements slot
  superHead.writeUInt32BE(20, 16);
  const sig = Buffer.concat([superHead, blob, xml]);

  const header = Buffer.alloc(32 + 16);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(1, 16); // ncmds
  header.writeUInt32LE(16, 20); // sizeofcmds
  header.writeUInt32LE(0x1d, 32); // LC_CODE_SIGNATURE
  header.writeUInt32LE(16, 36);
  header.writeUInt32LE(header.length + padding, 40);
  header.writeUInt32LE(sig.length, 44);
  return Buffer.concat([header, Buffer.alloc(padding, 0x41), sig]);
}

const BPLIST = Buffer.from(
  'YnBsaXN0MDDZAQIDBAUGBwgJCgsMDQ4PEhMUXxAaQ0ZCdW5kbGVTaG9ydFZlcnNpb25TdHJpbmdfEBJDRkJ1bmRsZUlkZW50aWZpZXJfEBhOU0NhbWVyYVVzYWdlRGVzY3JpcHRpb25fEBNDRkJ1bmRsZURpc3BsYXlOYW1lXxASTFNSZXF1aXJlc0lQaG9uZU9TXlVJRGV2aWNlRmFtaWx5XxASQ0ZCdW5kbGVFeGVjdXRhYmxlXxAPQ0ZCdW5kbGVWZXJzaW9uXxAQTWluaW11bU9TVmVyc2lvblMyLjFfEBBjb20uZXhhbXBsZS5EZW1vXVNjYW4gUVIgY29kZXNkAEQA6QBtAG8JohAREAEQAlREZW1vUzIxMFQxNS4wAAgAGwA4AE0AaAB+AJMAogC3AMkA3ADgAPMBAQEKAQsBDgEQARIBFwEbAAAAAAAAAgEAAAAAAAAAFQAAAAAAAAAAAAAAAAAAASA=',
  'base64',
);

function makeIpa(file: string) {
  fs.writeFileSync(
    file,
    makeZip([
      { name: 'Payload/Demo.app/Info.plist', data: BPLIST, deflate: true },
      { name: 'Payload/Demo.app/Frameworks/Thing.framework/Info.plist', data: Buffer.from('<plist><dict/></plist>') },
      { name: 'Payload/Demo.app/Demo', data: makeExecutable(3 * 1024 * 1024), deflate: true },
    ]),
  );
}

// ── IPA reading ────────────────────────────────────────────────────────────────────────────────

test('binary plist from plutil', () => {
  const p = parsePlist(BPLIST) as Record<string, unknown>;
  assert.equal(p.CFBundleIdentifier, 'com.example.Demo');
  assert.equal(p.CFBundleDisplayName, 'Démo');
  assert.deepEqual(p.UIDeviceFamily, [1, 2]);
  assert.equal(p.LSRequiresIPhoneOS, true);
});

test('XML plist, with entities and nesting', () => {
  const p = parsePlist(Buffer.from(`<?xml version="1.0"?><!-- hi --><plist><dict><key>a</key><string>x &amp; &#x263A;</string>
    <key>n</key><dict><key>b</key><array><integer>3</integer><false/><string/></array></dict><key>e</key><dict/></dict></plist>`));
  assert.deepEqual(p, { a: 'x & ☺', n: { b: [3, false, ''] }, e: {} });
});

test('entitlements come out of a Mach-O code signature', () => {
  const exe = makeExecutable(100);
  const range = codeSignatureRange(exe)!;
  assert.deepEqual(entitlementsFromSignature(exe.subarray(...range)), [
    'application-identifier',
    'get-task-allow',
    'com.apple.security.application-groups',
  ]);
  assert.equal(codeSignatureRange(Buffer.from('not a binary at all, just some text here')), undefined);
});

test('reads an .ipa: bundle, versions, privacy strings and entitlements from a big executable', async () => {
  const file = tmp('Demo.ipa');
  makeIpa(file);
  const info = await readIpa(file);
  assert.deepEqual(info, {
    bundleId: 'com.example.Demo',
    version: '2.1',
    build: '210',
    minOS: '15.0',
    name: 'Démo',
    privacy: { NSCameraUsageDescription: 'Scan QR codes' },
    entitlements: ['application-identifier', 'get-task-allow', 'com.apple.security.application-groups'],
  });
});

test('refuses files that are not apps', async () => {
  fs.writeFileSync(tmp('notzip.ipa'), 'hello');
  await assert.rejects(readIpa(tmp('notzip.ipa')), /Not a zip/);
  fs.writeFileSync(tmp('empty.ipa'), makeZip([{ name: 'readme.txt', data: Buffer.from('hi') }]));
  await assert.rejects(readIpa(tmp('empty.ipa')), /No app inside/);
});

// ── Releases ───────────────────────────────────────────────────────────────────────────────────

const asset = (name: string) => ({ name, size: 1, url: `https://github.com/x/y/releases/download/v1/${name}` });

test('repo names from links', () => {
  assert.equal(parseRepo('localsend/localsend'), 'localsend/localsend');
  assert.equal(parseRepo('https://github.com/utmapp/UTM/releases'), 'utmapp/UTM');
  assert.equal(parseRepo('github.com/obsproject/obs-studio.git'), 'obsproject/obs-studio');
  assert.equal(parseRepo('https://gitlab.com/a/b'), undefined);
  assert.equal(parseRepo('just-a-name'), undefined);
});

test('asset patterns pick the plain build and skip checksums', () => {
  const assets = ['KeePassXC-2.8.0-1-arm64.dmg', 'KeePassXC-2.8.0-arm64.dmg', 'KeePassXC-2.8.0-arm64.dmg.sig', 'KeePassXC-2.8.0-arm64.dmg.DIGEST'].map(asset);
  assert.equal(matchAsset('KeePassXC-*-arm64.dmg', assets)?.name, 'KeePassXC-2.8.0-arm64.dmg');
  assert.equal(matchAsset('*arm64*', assets)?.name, 'KeePassXC-2.8.0-arm64.dmg');
  const ls = ['LocalSend-1.18.2-windows-x86-64-unsigned.exe', 'LocalSend-1.18.2-windows-x86-64.exe'].map(asset);
  assert.equal(matchAsset('LocalSend-*-windows-x86-64.exe', ls)?.name, 'LocalSend-1.18.2-windows-x86-64.exe');
  assert.equal(matchAsset('joplin-*-ARM64.dmg', [asset('Joplin-3.7.22-arm64.DMG')])?.name, 'Joplin-3.7.22-arm64.DMG');
  assert.equal(matchAsset('*.ipa', ls), undefined);
  assert.equal(matchAsset('', ls), undefined);
  assert.ok(globToRegExp('a+b(1).[x]?').test('a+b(1).[x]z'));
});

test('versions from tags', () => {
  assert.equal(cleanVersion('v1.18.2'), '1.18.2');
  assert.equal(cleanVersion('release-5.3.0'), '5.3.0');
  assert.equal(cleanVersion('Audacity-4.0.2'), '4.0.2');
  assert.equal(cleanVersion('0.7.0-alpha'), '0.7.0-alpha');
  assert.equal(cleanVersion('nightly'), 'nightly');
});

test('every starter download has a platform and either a link or a file pattern', () => {
  const keys = new Set<string>();
  for (const a of STARTER_APPS) {
    assert.ok(!keys.has(a.key), `duplicate ${a.key}`);
    keys.add(a.key);
    assert.ok(a.downloads.length, a.name);
    for (const d of a.downloads) {
      assert.ok(Boolean(d.url) !== Boolean(d.asset), `${a.name}: link or pattern`);
      if (d.asset) assert.ok(a.repo, `${a.name} needs a repo for ${d.asset}`);
      if (d.url) assert.match(d.url, /^https:\/\//);
    }
  }
});

// ── AltStore source ────────────────────────────────────────────────────────────────────────────

test('AltStore source lists kept .ipa files only', () => {
  const ipa = JSON.stringify({ bundleId: 'com.utmapp.UTM', version: '5.0.8', build: '508', minOS: '15.0', name: 'UTM', privacy: {}, entitlements: ['get-task-allow'] });
  const app = { id: 1, name: 'UTM', developer: 'UTM', subtitle: 'VMs', description: 'Run VMs', category: 'Utilities', icon: 'abc.png', tint: '#2d6cdf' } as any;
  const d = { platform: 'ios', file: '7/UTM.ipa', file_name: 'UTM.ipa', size: 100, released_at: '2026-10-17T00:00:00Z', ipa, label: '' } as any;
  const base = 'https://bellhop.lan/api/apps/source/KEY';
  const s = buildSource(base, 'https://bellhop.lan', [
    { app, downloads: [{ ...d, id: 7 }, { ...d, id: 8, platform: 'macos', ipa: null, file_name: 'UTM.dmg' }, { ...d, id: 9, file: null }] },
  ]);
  assert.equal(s.identifier, 'bellhop.lan.bellhop');
  assert.equal(s.apps.length, 1);
  const a = s.apps[0];
  assert.equal(a.bundleIdentifier, 'com.utmapp.UTM');
  assert.equal(a.versions[0].downloadURL, `${base}/files/7/UTM.ipa`);
  assert.equal(a.versions[0].version, '5.0.8');
  assert.equal(a.iconURL, `${base}/icons/abc.png`);
  assert.equal(a.tintColor, '2d6cdf');
  assert.deepEqual(a.appPermissions, { entitlements: ['get-task-allow'], privacy: {} });
  assert.equal(altstoreCategory('Media'), 'entertainment');
  assert.equal(altstoreCategory('Whatever'), 'other');
});

// ── Form validation ────────────────────────────────────────────────────────────────────────────

test('app form validation', () => {
  assert.throws(() => cleanApp({ name: ' ' }), /name/);
  assert.throws(() => cleanApp({ name: 'X', repo: 'nope' }), /repo/);
  assert.throws(() => cleanApp({ name: 'X', tint: 'blue' }), /Colour/);
  assert.throws(() => cleanApp({ name: 'X', downloads: [{ platform: 'macos', source: 'release', asset: '*.dmg' }] }), /GitHub repo/);
  assert.throws(() => cleanApp({ name: 'X', downloads: [{ platform: 'beos', source: 'link', url: 'x.com' }] }), /platform/);
  assert.throws(() => cleanApp({ name: 'X', downloads: [{ platform: 'ios', source: 'link', url: 'javascript:alert(1)' }] }), /web link/);
  const a = cleanApp({ name: 'X', repo: 'https://github.com/a/b', homepage: 'x.org', downloads: [{ platform: 'ios', source: 'link', url: 'apps.apple.com/app/x/id123', keep: true }] });
  assert.equal(a.repo, 'a/b');
  assert.equal(a.homepage, 'https://x.org');
  assert.equal(a.downloads[0].url, 'https://apps.apple.com/app/x/id123');
  assert.equal(a.downloads[0].keep, 0); // only release files are kept
});

// ── Routes ─────────────────────────────────────────────────────────────────────────────────────

const server = new Hono();
server.route('/api/apps', appRoutes);
server.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'server error' }, 500);
});

function sessionFor(username: string, role: 'user' | 'admin') {
  const id = Number(run("INSERT INTO users (username, password_hash, role) VALUES (?, 'x', ?)", username, role).lastInsertRowid);
  const token = crypto.randomBytes(16).toString('hex');
  run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', crypto.createHash('sha256').update(token).digest('hex'), id, '2999-01-01T00:00:00Z');
  return `bellhop_session=${token}`;
}

const adminCookie = sessionFor('boss', 'admin');
const userCookie = sessionFor('kid', 'user');
const req = (url: string, init: RequestInit & { cookie?: string } = {}) =>
  server.request(`http://bellhop.lan${url}`, { ...init, headers: { ...(init.headers as object), ...(init.cookie ? { cookie: init.cookie } : {}) } });
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

test('the catalog needs a sign-in, and editing needs an admin', async () => {
  assert.equal((await req('/api/apps')).status, 401);
  assert.equal((await req('/api/apps', { ...json({ name: 'X' }), cookie: userCookie })).status, 403);
});

test('upload a file, download it with ranges, and list an .ipa in the AltStore source', async () => {
  const created = await req('/api/apps', {
    ...json({
      name: 'Demo',
      category: 'Utilities',
      downloads: [
        { platform: 'android', source: 'upload', label: 'APK' },
        { platform: 'ios', source: 'upload' },
        { platform: 'windows', source: 'link', url: 'https://example.com/demo.exe' },
      ],
    }),
    cookie: adminCookie,
  });
  assert.equal(created.status, 201);
  const app = await created.json();
  const [apk, ios] = app.downloads;

  // Nothing uploaded yet: only the link shows.
  let list = await (await req('/api/apps', { cookie: userCookie })).json();
  assert.deepEqual(list.apps[0].downloads.map((d: any) => d.from), ['web']);
  assert.equal(list.source, null);

  const bad = await req(`/api/apps/downloads/${ios.id}/file?name=demo.zip`, { method: 'POST', body: 'x', cookie: adminCookie });
  assert.equal(bad.status, 400);

  const apkBytes = Buffer.from('0123456789abcdef');
  const up = await req(`/api/apps/downloads/${apk.id}/file?name=demo%20app.apk`, { method: 'POST', body: apkBytes, cookie: adminCookie });
  assert.equal(up.status, 200);
  makeIpa(tmp('upload.ipa'));
  const upIpa = await req(`/api/apps/downloads/${ios.id}/file?name=Demo.ipa`, { method: 'POST', body: fs.readFileSync(tmp('upload.ipa')), cookie: adminCookie });
  const after = await upIpa.json();
  assert.equal(after.downloads[1].ipa.bundleId, 'com.example.Demo');
  assert.equal(after.downloads[1].version, '2.1');

  list = await (await req('/api/apps', { cookie: userCookie })).json();
  const [a, i] = list.apps[0].downloads;
  assert.equal(a.from, 'server');
  assert.equal(a.href, `/api/apps/files/${apk.id}/demo%20app.apk`);
  assert.equal(a.size, 16);
  assert.ok(i.sideload.startsWith('http://bellhop.lan/api/apps/source/'));
  assert.ok(list.source);

  const full = await req(a.href, { cookie: userCookie });
  assert.equal(full.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.match(full.headers.get('content-disposition')!, /attachment/);
  assert.equal(await full.text(), '0123456789abcdef');
  const part = await req(a.href, { cookie: userCookie, headers: { range: 'bytes=4-7' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 4-7/16');
  assert.equal(await part.text(), '4567');
  assert.equal((await req(a.href, { cookie: userCookie, headers: { range: 'bytes=99-' } })).status, 416);
  assert.equal((await req(a.href)).status, 401);

  // The source works without a cookie, but only with the key.
  const sourcePath = new URL(list.source).pathname;
  const source = await (await req(sourcePath)).json();
  assert.equal(source.apps.length, 1);
  assert.equal(source.apps[0].bundleIdentifier, 'com.example.Demo');
  const ipaPath = new URL(source.apps[0].downloadURL).pathname;
  assert.equal((await req(ipaPath)).status, 200);
  assert.equal((await req(sourcePath.replace(/[^/]+$/, 'wrong-key-wrong-key-wro'))).status, 404);
  // The key only opens iPhone apps, not every file on the server.
  assert.equal((await req(ipaPath.replace(`/files/${ios.id}/Demo.ipa`, `/files/${apk.id}/demo%20app.apk`))).status, 404);

  // Rotating the key retires the old address.
  const rotated = await (await req('/api/apps/source/rotate', { method: 'POST', cookie: adminCookie })).json();
  assert.notEqual(rotated.source, list.source);
  assert.equal((await req(sourcePath)).status, 404);

  // Dropping a download deletes its file.
  const stored = one<{ file: string }>('SELECT file FROM app_downloads WHERE id = ?', apk.id)!.file;
  assert.ok(fs.existsSync(path.join(process.env.DATA_DIR!, 'apps', 'files', stored)));
  const edit = await req(`/api/apps/${app.id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...app, downloads: app.downloads.slice(1) }),
    headers: { 'content-type': 'application/json' },
    cookie: adminCookie,
  });
  assert.equal(edit.status, 200);
  assert.equal((await edit.json()).downloads.length, 2);
  assert.ok(!fs.existsSync(path.join(process.env.DATA_DIR!, 'apps', 'files', stored)));

  // And by slug, for the detail page.
  const bySlug = await (await req('/api/apps/demo', { cookie: userCookie })).json();
  assert.equal(bySlug.name, 'Demo');
});

test('starter apps are added once', () => {
  const n = addStarterApps(['localsend', 'utm', 'nope']);
  assert.equal(n, 2);
  assert.equal(addStarterApps(['localsend']), 0);
  const d = one<{ source: string; asset: string }>(
    "SELECT d.source, d.asset FROM app_downloads d JOIN apps a ON a.id = d.app_id WHERE a.starter = 'utm' AND d.platform = 'ios' AND d.source = 'release'",
  );
  assert.deepEqual({ ...d }, { source: 'release', asset: 'UTM.ipa' });
});

test('maker and coding starter patterns pick the right file from real releases', () => {
  // File names from each project's latest release in November 2026.
  const releases: Record<string, string[]> = {
    freecad: [
      'FreeCAD_1.1.4-Linux-aarch64-py311.AppImage', 'FreeCAD_1.1.4-Linux-aarch64-py311.AppImage-SHA256.txt',
      'FreeCAD_1.1.4-Linux-aarch64-py311.AppImage.zsync', 'FreeCAD_1.1.4-Linux-x86_64-py311.AppImage',
      'FreeCAD_1.1.4-macOS-arm64-py311.dmg', 'FreeCAD_1.1.4-macOS-arm64-py311.dmg-SHA256.txt',
      'FreeCAD_1.1.4-macOS-x86_64-py311.dmg', 'FreeCAD_1.1.4-Windows-x86_64-py311-installer.exe',
      'FreeCAD_1.1.4-Windows-x86_64-py311.7z', 'freecad_source_1.1.4.tar.gz',
    ],
    orcaslicer: [
      'OrcaSlicer-Linux-flatpak_V2.5.0_x86_64.flatpak', 'OrcaSlicer_Linux_AppImage_Ubuntu2404_aarch64_V2.5.0.AppImage',
      'OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.5.0.AppImage', 'OrcaSlicer_Mac_universal_V2.5.0.dmg',
      'OrcaSlicer_Windows_Installer_V2.5.0_arm64.exe', 'OrcaSlicer_Windows_Installer_V2.5.0_x64.exe',
      'OrcaSlicer_Windows_V2.5.0_x64_portable.zip',
    ],
    'arduino-ide': [
      'arduino-ide_2.3.10_Linux_64bit.AppImage', 'arduino-ide_2.3.10_Linux_64bit.zip', 'arduino-ide_2.3.10_macOS_64bit.dmg',
      'arduino-ide_2.3.10_macOS_arm64.dmg', 'arduino-ide_2.3.10_Windows_64bit.exe', 'arduino-ide_2.3.10_Windows_64bit.msi',
    ],
    zed: [
      'bwrap-linux-x86_64.gz', 'Zed-aarch64.dmg', 'Zed-aarch64.exe', 'zed-linux-aarch64.tar.gz', 'zed-linux-x86_64.tar.gz',
      'zed-remote-server-linux-x86_64.gz', 'zed-remote-server-windows-x86_64.zip', 'Zed-x86_64.dmg', 'Zed-x86_64.exe',
    ],
    thonny: ['thonny-5.0.1-arm64.exe', 'thonny-5.0.1-arm64.pkg', 'thonny-5.0.1-windows-portable-x64.zip', 'thonny-5.0.1-x64.exe', 'thonny-5.0.1-x64.pkg'],
    ollama: [
      'ollama-darwin.tgz', 'Ollama-darwin.zip', 'ollama-linux-amd64-rocm.tar.zst', 'ollama-linux-amd64.tar.zst',
      'ollama-linux-arm64-jetpack6.tar.zst', 'ollama-linux-arm64.tar.zst', 'ollama-windows-amd64.zip', 'Ollama.dmg', 'OllamaSetup.exe', 'sha256sum.txt',
    ],
  };
  const expected: Record<string, string[]> = {
    freecad: [
      'FreeCAD_1.1.4-macOS-arm64-py311.dmg', 'FreeCAD_1.1.4-macOS-x86_64-py311.dmg', 'FreeCAD_1.1.4-Windows-x86_64-py311-installer.exe',
      'FreeCAD_1.1.4-Linux-x86_64-py311.AppImage', 'FreeCAD_1.1.4-Linux-aarch64-py311.AppImage',
    ],
    orcaslicer: ['OrcaSlicer_Mac_universal_V2.5.0.dmg', 'OrcaSlicer_Windows_Installer_V2.5.0_x64.exe', 'OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.5.0.AppImage'],
    'arduino-ide': [
      'arduino-ide_2.3.10_macOS_arm64.dmg', 'arduino-ide_2.3.10_macOS_64bit.dmg', 'arduino-ide_2.3.10_Windows_64bit.exe', 'arduino-ide_2.3.10_Linux_64bit.AppImage',
    ],
    zed: ['Zed-aarch64.dmg', 'Zed-x86_64.dmg', 'Zed-x86_64.exe', 'zed-linux-x86_64.tar.gz', 'zed-linux-aarch64.tar.gz'],
    thonny: ['thonny-5.0.1-arm64.pkg', 'thonny-5.0.1-x64.pkg', 'thonny-5.0.1-x64.exe'],
    ollama: ['Ollama.dmg', 'OllamaSetup.exe', 'ollama-linux-amd64.tar.zst', 'ollama-linux-arm64.tar.zst'],
  };
  for (const [key, names] of Object.entries(releases)) {
    const assets = names.map((name) => ({ name, size: 1, url: `https://example.com/${name}` }));
    const app = STARTER_APPS.find((a) => a.key === key)!;
    const picked = app.downloads.filter((d) => d.asset).map((d) => matchAsset(d.asset!, assets)?.name);
    assert.deepEqual(picked, expected[key], key);
  }
});

test('starter release files marked keep are kept on the server', () => {
  addStarterApps(['orcaslicer', 'thonny']);
  const rows = (key: string) =>
    one<{ kept: number; links: number }>(
      "SELECT SUM(d.keep) AS kept, SUM(d.source = 'link') AS links FROM app_downloads d JOIN apps a ON a.id = d.app_id WHERE a.starter = ?",
      key,
    );
  assert.deepEqual({ ...rows('orcaslicer') }, { kept: 3, links: 0 });
  assert.deepEqual({ ...rows('thonny') }, { kept: 3, links: 1 }); // the Flathub link isn't a file to keep
});
