// Runs INSIDE the confined child process (see ModSandbox for how it is started and what flags it gets).
// It owns exactly one SandboxCore and speaks a tiny IPC protocol with the host. Everything crossing the
// channel is JSON; mod code never runs outside the vm context (docs/SECURITY.md).
import { SandboxCore } from './sandbox-core.js';

const selftest = process.argv.includes('--selftest'); // diagnostics for tests; never enabled in production
let core = null;
const send = (m) => { try { process.send(m); } catch { process.exit(3); } };

process.on('uncaughtException', () => process.exit(2));
process.on('unhandledRejection', () => process.exit(2));
process.on('disconnect', () => process.exit(0)); // the host went away: do not linger

/** What this process can still do, as the host will see it. Used only by tests to prove the confinement. */
async function probe() {
  const out = {};
  const attempt = async (name, fn) => { try { out[name] = await fn(); } catch (e) { out[name] = `blocked:${e.code ?? e.name}`; } };
  await attempt('fsRead', async () => { const fs = await import('node:fs'); return fs.readFileSync(process.argv[1], 'utf8').length > 0 ? 'ALLOWED' : 'empty'; });
  await attempt('fsReadOther', async () => { const fs = await import('node:fs'); return fs.readdirSync('.').length >= 0 ? 'ALLOWED' : 'x'; });
  await attempt('fsWrite', async () => { const fs = await import('node:fs'); fs.writeFileSync('probe.tmp', 'x'); return 'ALLOWED'; });
  await attempt('spawn', async () => { const cp = await import('node:child_process'); cp.execSync('echo hi'); return 'ALLOWED'; });
  await attempt('worker', async () => { const { Worker } = await import('node:worker_threads'); new Worker('1', { eval: true }); return 'ALLOWED'; });
  await attempt('stringEval', () => { return String(new Function('return 1')()); });
  out.envVars = Object.keys(process.env).length;
  out.permissionModel = process.permission ? 'on' : 'off';
  out.pid = process.pid;
  return out;
}

process.on('message', async (m) => {
  switch (m.t) {
    case 'load':
      core = new SandboxCore({
        source: m.source, filename: m.filename, loadBudgetMs: m.loadBudgetMs, defaultBudgetMs: m.budgetMs, maxResultBytes: m.maxResultBytes,
      });
      send({ t: 'loaded', id: m.id, result: core.load() });
      break;
    case 'call':
      send({ t: 'result', id: m.id, result: core ? core.call(m.hook, m.arg, m.budgetMs) : { ok: false, kind: 'invalid', error: 'not loaded', ms: 0 } });
      break;
    case 'exit':
      process.exit(0);
      break;
    case 'probe':
      if (selftest) send({ t: 'probed', id: m.id, result: await probe() });
      break;
    case 'hang': // selftest: block this process's event loop OUTSIDE the vm, to exercise the host watchdog
      if (selftest) for (;;);
      break;
    default:
      break;
  }
});

send({ t: 'ready', pid: process.pid });
