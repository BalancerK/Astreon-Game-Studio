// Entry point that runs INSIDE a worker thread: hosts one room and exposes the gateway's clients to it as
// virtual connections. Not imported directly; `WorkerRoom` starts it. Protocol: see room-runtime.js.
import { parentPort, workerData } from 'node:worker_threads';
import { startRoomRuntime } from './room-runtime.js';

const handle = startRoomRuntime({
  module: workerData.module,
  options: workerData.options,
  send: (message, transfer) => parentPort.postMessage(message, transfer),
  exit: (code) => process.exit(code),
});
parentPort.on('message', handle);
