// Serve a single-page example for a browser. Usage: node tools/serve-example.js <name> [--port 8090]
//   e.g. `npm run walk3d` then open the printed address. (The arena has its own server: `npm run arena`.)
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './static-server.js';
import { offlineScript } from './studio-offline.js';

const name = process.argv[2];
if (!name || !/^[a-z0-9_-]+$/.test(name)) { console.error('usage: node tools/serve-example.js <example name> [--port 8090]'); process.exit(2); }
const portIndex = process.argv.indexOf('--port');
const port = portIndex > 0 ? Number(process.argv[portIndex + 1]) : 8090;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const index = name === 'studio' ? '/studio/index.html' : name === 'studio-spike' ? '/studio/spike/index.html' : `/examples/${name}/index.html`;     // the studio spike needs `localhost` (the game runs on 127.0.0.1)
const generated = name === 'studio' ? { '/studio/offline-files.js': () => offlineScript(root) } : {};      // the studio's list of offline files, made fresh on every request
const server = createStaticServer({ root, index, allowDirs: ['packages', 'examples', 'studio'], generated });
server.listen(port, '127.0.0.1', () => console.log(`${name}: http://127.0.0.1:${port}/   (Ctrl+C to stop)`));
