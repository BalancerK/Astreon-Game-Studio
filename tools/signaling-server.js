// A signalling server for browser-to-browser games (WebRTC): it introduces players to each other and relays their handshake, nothing more. The game never passes through it.
// Usage: node tools/signaling-server.js [--port 8081] [--host 127.0.0.1] [--origins https://mygame.example,https://other.example] [--max-rooms 1000]
// Put it behind TLS (wss://) for a public game; a browser on an https page may not open a plain ws:// connection to another machine.
import { createSignalingServer } from '../packages/transport/src/node.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const origins = arg('origins', '');
const server = await createSignalingServer({
  port: Number(arg('port', 8081)), host: arg('host', '127.0.0.1'), maxRooms: Number(arg('max-rooms', 1000)),
  ...(origins ? { allowedOrigins: origins.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
});
console.log(`signalling server listening on ws://${server.host}:${server.port}/${origins ? `  (pages allowed: ${origins})` : '  (any page allowed: set --origins for a public server)'}`);
process.on('SIGINT', async () => { await server.close(); process.exit(0); });
