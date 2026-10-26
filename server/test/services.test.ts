import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, test } from 'node:test';
import { slugify } from '../src/slug.ts';
import { checkWeb } from '../src/services/health.ts';
import { flattenMotd, pingMinecraft, readVarInt, resolveAddress } from '../src/services/minecraft.ts';

function varInt(n: number) {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}

// A tiny stand-in for a Minecraft server: answers the status request, split over two writes.
const status = {
  version: { name: 'Paper 1.21.1' },
  players: { online: 3, max: 20 },
  description: { text: '§aSurvival ', extra: [{ text: 'world' }] },
};
const mc = net.createServer((sock) => {
  sock.once('data', () => {
    const json = Buffer.from(JSON.stringify(status));
    const body = Buffer.concat([varInt(0), varInt(json.length), json]);
    const pkt = Buffer.concat([varInt(body.length), body]);
    sock.write(pkt.subarray(0, 10));
    setTimeout(() => sock.end(pkt.subarray(10)), 20);
  });
});
await new Promise<void>((r) => mc.listen(0, '127.0.0.1', r));
const mcPort = (mc.address() as net.AddressInfo).port;

const web = http.createServer((req, res) => {
  res.statusCode = req.url === '/broken' ? 502 : req.url === '/login' ? 401 : 200;
  res.end('ok');
});
await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
const webPort = (web.address() as net.AddressInfo).port;

after(() => {
  mc.close();
  web.close();
});

test('pings a Minecraft server', async () => {
  const s = await pingMinecraft(`127.0.0.1:${mcPort}`);
  assert.deepEqual(s, { version: 'Paper 1.21.1', players: 3, max: 20, motd: 'Survival world' });
});

test('Minecraft ping fails cleanly when nothing listens', async () => {
  await assert.rejects(pingMinecraft('127.0.0.1:1', 1000));
});

test('address parsing', async () => {
  assert.deepEqual(await resolveAddress('10.0.0.5:25566'), { host: '10.0.0.5', port: 25566 });
  assert.deepEqual(await resolveAddress('10.0.0.5'), { host: '10.0.0.5', port: 25565 });
  assert.deepEqual(await resolveAddress('[::1]:25565'), { host: '::1', port: 25565 });
});

test('varint', () => {
  assert.deepEqual(readVarInt(Buffer.from([0xdd, 0xc7, 0x01]), 0), { value: 25565, size: 3 });
  assert.equal(readVarInt(Buffer.from([0x80]), 0), undefined);
});

test('motd flattening', () => {
  assert.equal(flattenMotd('§6Hello §lthere'), 'Hello there');
  assert.equal(flattenMotd({ text: 'A', extra: [{ text: 'B', extra: [{ text: 'C' }] }] }), 'ABC');
});

test('web checks: 2xx and 401 are up, 5xx and refused are down', async () => {
  assert.equal((await checkWeb(`http://127.0.0.1:${webPort}/`)).up, true);
  assert.equal((await checkWeb(`http://127.0.0.1:${webPort}/login`)).up, true);
  assert.deepEqual(await checkWeb(`http://127.0.0.1:${webPort}/broken`), { up: false, error: 'HTTP 502' });
  assert.equal((await checkWeb('http://127.0.0.1:1/')).up, false);
});

test('wiki slugs', () => {
  assert.equal(slugify('Wi-Fi & Guests'), 'wi-fi-guests');
  assert.equal(slugify('Návod na Minecraft'), 'navod-na-minecraft');
  assert.equal(slugify('!!!'), 'page');
});
