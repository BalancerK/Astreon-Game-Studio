// Start the Crazy Eights server: node server/main.js [--port 8080] [--data ./data] [--mode worker|process|inline] [--root <folder to serve>]
import { resolve, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i < 0 ? dflt : args[i + 1]; };
const here = dirname(fileURLToPath(import.meta.url));
// inside the engine repository the page imports engine files by relative path, so the repository is the root;
// in a project of your own it is the project folder
const inRepo = existsSync(join(here, '..', '..', '..', 'packages', 'turns'));
const root = resolve(opt('root', inRepo ? join(here, '..', '..', '..') : join(here, '..')));

const server = await startServer({
  root,
  port: Number(opt('port', 8080)),
  host: opt('host', '127.0.0.1'),
  dataDir: opt('data', null) ? resolve(opt('data')) : null,
  mode: opt('mode', 'worker'),
  secret: process.env.JOIN_SECRET, log: (m) => console.log(m),
});
const page = inRepo ? 'examples/crazy-eights/index.html' : '';
console.log(`Crazy Eights: ${server.url}${page}   (Ctrl+C to stop)`);
const stop = async () => { console.log('stopping…'); await server.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
