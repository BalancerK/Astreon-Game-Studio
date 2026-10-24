// Node-only entry: `import { listenWebSocket } from '@engine/transport/node'`.
export { listenWebSocket, acceptKey } from './ws/server.js';
export { FrameParser, WsError, OP, encodeFrame, encodeClose } from './ws/frame.js';
export { createSignalingServer } from './rtc/signal-server.js';
