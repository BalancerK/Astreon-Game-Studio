// Entry point that runs INSIDE a child process: hosts one room and exposes the gateway's clients to it as
// virtual connections over the IPC channel. Not imported directly; `ProcessRoom` starts it.
// Protocol: see room-runtime.js. The first message is `{t:'init', module, options}`.
import { startRoomRuntime } from './room-runtime.js';

let handle = null;
const rss = () => { const m = process.memoryUsage(); return { rssMb: m.rss / 1048576, heapMb: m.heapUsed / 1048576 }; };

process.on('message', (m) => {
  if (!handle) {
    if (m && m.t === 'init') {
      handle = startRoomRuntime({
        module: m.module,
        options: m.options,
        send: (message) => { try { process.send(message); } catch { /* the gateway is gone */ } },
        exit: (code) => process.exit(code),
        extraStats: rss,
      });
    }
    return;
  }
  handle(m);
});
// If the gateway dies, no room may outlive it.
process.on('disconnect', () => process.exit(0));
process.on('uncaughtException', (e) => { try { process.send({ t: 'fatal', error: String(e && e.stack ? e.stack : e) }); } catch { /* gone */ } process.exit(1); });
