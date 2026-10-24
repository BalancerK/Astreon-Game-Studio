// Does disabling Nagle matter for game-style traffic? Run: node packages/transport/bench/nodelay.js
// Server streams small messages every 8 ms; client measures how late each arrives (loopback).
import { listenWebSocket } from '../src/node.js';
import { connectWebSocket, CHANNEL } from '../src/index.js';

async function trial(noDelay, count = 400, gapMs = 8) {
  const l = await listenWebSocket({ pingIntervalMs: 60_000 });
  l.onConnection = (c) => {
    c.socket.setNoDelay(noDelay);
    let i = 0;
    const timer = setInterval(() => {
      const b = new Uint8Array(40);
      new DataView(b.buffer).setFloat64(0, performance.timeOrigin + performance.now());
      c.send(b, CHANNEL.UNRELIABLE);
      if (++i >= count) clearInterval(timer);
    }, gapMs);
  };
  const client = connectWebSocket(`ws://127.0.0.1:${l.port}/`);
  const delays = [];
  client.onMessage = (b) => delays.push(performance.timeOrigin + performance.now() - new DataView(b.buffer, b.byteOffset).getFloat64(0));
  await new Promise((r) => { const t = setInterval(() => { if (delays.length >= count) { clearInterval(t); r(); } }, 20); });
  client.close();
  await l.close();
  delays.sort((a, b) => a - b);
  const p = (q) => delays[Math.floor(q * (delays.length - 1))].toFixed(2);
  return `p50 ${p(0.5)} ms, p99 ${p(0.99)} ms, max ${p(1)} ms`;
}

console.log('Nagle ON  (setNoDelay(false)):', await trial(false));
console.log('Nagle OFF (setNoDelay(true)): ', await trial(true));
