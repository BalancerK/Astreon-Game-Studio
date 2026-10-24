// Compare interpolation strategies across network conditions (virtual clock, deterministic).
// Usage: node tools/arena-netlab.js
import { runScenario, SCENARIOS } from '../examples/arena/test/netlab.js';

const modes = [['adaptive', null], ['fixed 100 ms', 100], ['fixed 50 ms', 50]];
console.log('scenario'.padEnd(38) + modes.map(([n]) => n.padEnd(34)).join(''));
console.log(''.padEnd(38) + modes.map(() => 'behind newest   starved   backwards  '.padEnd(34)).join(''));
for (const [name, link] of Object.entries(SCENARIOS)) {
  let row = name.padEnd(38);
  for (const [, fixed] of modes) {
    const r = await runScenario({ link, fixedDelayMs: fixed, seconds: 30, seed: 7 });
    row += `${r.behindMs.toFixed(0).padStart(5)} ms (max ${r.behindMaxMs.toFixed(0).padStart(3)})  ${r.starvedPct.toFixed(1).padStart(5)} %  ${String(r.backwards).padStart(4)}      `;
  }
  console.log(row);
}
