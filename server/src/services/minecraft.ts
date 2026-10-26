import dns from 'node:dns/promises';
import net from 'node:net';

// Minecraft "Server List Ping": the same request the multiplayer screen sends.
// Works against any Java server (Crafty, vanilla, Paper) without an API key.

export type McStatus = { version: string; players: number; max: number; motd: string };

function varInt(n: number): Buffer {
  const out: number[] = [];
  let v = n >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v) byte |= 0x80;
    out.push(byte);
  } while (v);
  return Buffer.from(out);
}

/** Read a VarInt at `offset`; returns undefined if the buffer ends first. */
export function readVarInt(buf: Buffer, offset: number): { value: number; size: number } | undefined {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buf.length) return;
    const byte = buf[offset + i];
    value |= (byte & 0x7f) << (7 * i);
    if (!(byte & 0x80)) return { value, size: i + 1 };
  }
  throw new Error('VarInt too long');
}

const packet = (...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([varInt(body.length), body]);
};

function mcString(s: string) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varInt(b.length), b]);
}

/** Flatten a chat component ({ text, extra: [...] }) and strip § colour codes. */
export function flattenMotd(d: unknown): string {
  const walk = (x: any): string =>
    typeof x === 'string' ? x : x ? `${x.text ?? ''}${Array.isArray(x.extra) ? x.extra.map(walk).join('') : ''}` : '';
  return walk(d).replace(/§./g, '').replace(/\s+/g, ' ').trim();
}

/** "mc.example.com", "mc.example.com:25566" or "[::1]:25565" -> host and port, following SRV records. */
export async function resolveAddress(address: string): Promise<{ host: string; port: number }> {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(address.trim().replace(/^minecraft:\/\//, ''));
  if (!m) throw new Error('Bad address');
  const host = m[1];
  if (m[2]) return { host, port: Number(m[2]) };
  if (!net.isIP(host)) {
    try {
      const [srv] = await dns.resolveSrv(`_minecraft._tcp.${host}`);
      if (srv) return { host: srv.name, port: srv.port };
    } catch {}
  }
  return { host, port: 25565 };
}

export async function pingMinecraft(address: string, timeoutMs = 5000): Promise<McStatus> {
  const { host, port } = await resolveAddress(address);
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error('Timed out')));
    socket.on('error', fail);
    socket.on('connect', () => {
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      // Handshake (protocol -1 = "just asking"), then a status request.
      socket.write(packet(varInt(0), varInt(-1), mcString(host), portBuf, varInt(1)));
      socket.write(packet(varInt(0)));
    });
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        const len = readVarInt(buf, 0);
        if (!len || buf.length < len.size + len.value) return;
        const id = readVarInt(buf, len.size)!;
        const strLen = readVarInt(buf, len.size + id.size)!;
        const start = len.size + id.size + strLen.size;
        const json = JSON.parse(buf.subarray(start, start + strLen.value).toString('utf8'));
        socket.destroy();
        resolve({
          version: json.version?.name ?? '',
          players: json.players?.online ?? 0,
          max: json.players?.max ?? 0,
          motd: flattenMotd(json.description),
        });
      } catch (e) {
        fail(e as Error);
      }
    });
  });
}
