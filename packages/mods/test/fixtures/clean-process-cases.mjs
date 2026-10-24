// Runs the sandbox cases that interrupt promise jobs. They must run in a CLEAN process: when Node's test
// runner (or any tool) has async hooks enabled, interrupting a promise job with a vm timeout corrupts
// Node's internal async-hook stack and aborts the process. The production sandbox runs in its own clean
// child process for exactly this reason (docs/SECURITY.md).
import { SandboxCore } from '../../src/node.js';

const out = {};
const hook = (body) => `engine.register({ onFrame(f) { ${body} } });`;

let s = new SandboxCore({ source: '(async () => { for (;;) await null; })(); engine.register({ onFrame() {} });', loadBudgetMs: 30 });
out.asyncBusyLoopAtLoad = s.load();

s = new SandboxCore({ source: hook('function g() { Promise.resolve().then(g); } g(); return 1;') });
s.load();
out.promiseChain = s.call('onFrame', {}, 20);

s = new SandboxCore({ source: hook('return (async () => 1)();') });
s.load();
out.asyncHook = s.call('onFrame', {});

s = new SandboxCore({ source: hook('(async () => { for (;;) await null; })(); return 1;') });
s.load();
const t0 = performance.now();
out.asyncLoopInHook = s.call('onFrame', {}, 20);
out.asyncLoopInHookMs = performance.now() - t0;
out.survivedAfterwards = s.call('onFrame', {}, 20).kind; // a later call must still return, not hang

console.log(JSON.stringify(out));
