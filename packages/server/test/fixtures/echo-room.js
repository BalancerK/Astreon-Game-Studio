// A tiny room module for host tests: echoes messages and misbehaves on request. Uses only node built-ins.
import { readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const attempt = (fn) => { try { fn(); return 'ALLOWED'; } catch (e) { return `blocked:${e.code ?? e.name}`; } };

export async function createRoom(options = {}) {
  if (options.failToStart) throw new Error('refusing to start');
  if (options.slowStart) await new Promise((r) => setTimeout(r, options.slowStart));
  let connected = 0;
  let probe = null;
  const bomb = [];
  return {
    attach(conn) {
      connected++;
      conn.onMessage = (bytes, ch) => conn.send(new Uint8Array([...bytes].map((b) => (b + 1) & 255)), ch);
      conn.onClose = () => { connected--; };
    },
    stats: () => ({ connected, pid: process.pid, probe, env: Object.keys(process.env).length, secret: process.env.ENGINE_TEST_SECRET ?? null, label: options.label ?? null }),
    control(m) {
      if (m.crash) setImmediate(() => { throw new Error('boom from room'); });
      if (m.hang) { const end = Date.now() + m.hang; while (Date.now() < end); }
      if (m.bomb) setImmediate(() => { for (;;) bomb.push(new Array(1e5).fill(1)); });
      if (m.probe) {
        probe = {
          readOwnDir: attempt(() => readdirSync(HERE)),
          readOther: attempt(() => readFileSync(m.other)),
          write: attempt(() => writeFileSync(m.writeTo, 'x')),
          spawn: attempt(() => { const r = spawnSync(process.execPath, ['-e', '0']); if (r.error) throw r.error; }),
        };
      }
    },
  };
}
