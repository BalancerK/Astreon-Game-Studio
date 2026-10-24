// Per-client bandwidth with interest management and budgets. Usage: node tools/arena-bandwidth.js
import { runBandwidth } from '../examples/arena/test/netlab.js';

const rows = [
  ['whole world, no budget', { viewRadius: Infinity }],
  ['view 700, no budget', { viewRadius: 700 }],
  ['view 700, budget 30 KB/s', { viewRadius: 700, bandwidth: 30_000 }],
  ['view 700, budget 15 KB/s', { viewRadius: 700, bandwidth: 15_000 }],
  ['view 400, no budget', { viewRadius: 400 }],
];
for (const bots of [150, 400]) {
  console.log(`\n${bots} bots, 4 clients, 15 s, 40 ms +- 10 ms network`);
  console.log('mode'.padEnd(28) + 'KB/s/client'.padStart(12) + 'sees'.padStart(8) + 'full%'.padStart(8) + 'tick ms'.padStart(9) + 'corrections'.padStart(13));
  for (const [name, opt] of rows) {
    const r = await runBandwidth({ bots, ...opt });
    console.log(name.padEnd(28) + r.kbpsPerClient.toFixed(1).padStart(12) + r.visibleAvg.toFixed(0).padStart(8) + r.fullPct.toFixed(0).padStart(7) + '%' + r.tickMsAvg.toFixed(3).padStart(9) + String(r.corrections).padStart(13));
  }
}
