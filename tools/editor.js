// Start the scene editor for an example: node tools/editor.js physics3d [--port 8091]
//   serves the project, and lets the editor page read and write examples/<name>/scenes/*.json
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../packages/build/src/index.js';

const name = process.argv[2];
if (!name || !/^[a-z0-9_-]+$/.test(name)) { console.error('usage: node tools/editor.js <example name> [--port 8091]'); process.exit(2); }
const pi = process.argv.indexOf('--port');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dev = await serve({ root, port: pi > 0 ? Number(process.argv[pi + 1]) : 8091, liveReload: false, writable: [{ route: '/__scenes', dir: `examples/${name}/scenes`, ext: '.json' }], log: console.log });
console.log(`${name} scene editor: ${dev.url}examples/${name}/editor.html   (Ctrl+C to stop)`);
