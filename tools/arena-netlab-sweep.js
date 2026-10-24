// Sweep InterpolationClock parameters across the network scenarios. Usage: node tools/arena-netlab-sweep.js
import { runScenario, SCENARIOS } from '../examples/arena/test/netlab.js';

const configs = [
  { k: 3, minBufferTicks: 1.5 }, { k: 4, minBufferTicks: 1.5 }, { k: 4, minBufferTicks: 2 },
  { k: 5, minBufferTicks: 2 }, { k: 6, minBufferTicks: 2 }, { k: 4, minBufferTicks: 2.5 },
];
console.log('config'.padEnd(26) + Object.keys(SCENARIOS).map((n) => n.split(' (')[0].padEnd(20)).join(''));
for (const opt of configs) {
  let row = `k=${opt.k} min=${opt.minBufferTicks}`.padEnd(26);
  for (const link of Object.values(SCENARIOS)) {
    let b = 0, s = 0;
    for (const seed of [7, 8]) { const r = await runScenario({ link, seconds: 25, seed, clockOptions: opt }); b += r.behindMs / 2; s += r.starvedPct / 2; }
    row += `${b.toFixed(0).padStart(4)} ms ${s.toFixed(1).padStart(4)}%`.padEnd(20);
  }
  console.log(row);
}
