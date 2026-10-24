#!/usr/bin/env node
// create-game <name or path> [--template 2d|3d|multiplayer] [--engine-path <checkout>] [--no-install]
import { resolve, basename } from 'node:path';
import { createProject, listTemplates, checkName } from './create.js';

const args = process.argv.slice(2);
const flag = (name, hasValue = true) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = hasValue ? args[i + 1] : true; args.splice(i, hasValue ? 2 : 1); return v; };

try {
  if (flag('--list', false) || flag('-l', false)) {
    for (const t of listTemplates()) console.log(`${t.name.padEnd(8)} ${t.description}`);
    process.exit(0);
  }
  if (flag('--help', false) || flag('-h', false)) {
    console.log('usage: create-game <name or path> [--template 2d|3d|multiplayer] [--engine-path <engine checkout>] [--no-install]\n       create-game --list');
    process.exit(0);
  }
  const template = flag('--template') ?? '2d';
  const enginePath = flag('--engine-path');
  const install = !flag('--no-install', false);
  const target = args[0];
  const name = target ? basename(resolve(target)) : target;     // `../games/my-game` makes a project called my-game in that folder
  const bad = checkName(name);
  if (bad) throw new Error(bad);
  const { dir } = createProject({ dir: resolve(target), name, template, enginePath, install, log: console.log });
  console.log(`\nDone. Next:\n  cd ${target}\n${install ? '' : '  npm install\n'}  npm run dev      # serve it with live reload\n  npm test         # the game's own tests\n  npm run build    # bundle, minify, hash: dist/\n${template === '3d' ? '  open /editor.html on the dev server to edit scenes/main.json\n' : ''}`);
  void dir;
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
