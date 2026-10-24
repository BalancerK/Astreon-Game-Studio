#!/usr/bin/env node
// engine-build build | dev | inspect <entry.js>   [--config file] [--out dir] [--port n] [--no-minify]
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, formatReport } from './build.js';
import { bundle } from './bundle.js';
import { serve } from './dev.js';

const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith('-') ? args.shift() : 'build';
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, v && !v.startsWith('--') ? 2 : 1); return v && !v.startsWith('--') ? v : true; };

async function loadConfig(path) {
  const file = resolve(path ?? (existsSync('engine.config.js') ? 'engine.config.js' : 'engine.config.json'));
  if (!existsSync(file)) return path ? (() => { throw new Error(`config file ${file} does not exist`); })() : {};
  const cfg = file.endsWith('.json') ? JSON.parse(readFileSync(file, 'utf8')) : (await import(pathToFileURL(file).href)).default;
  return { root: resolve(file, '..'), ...cfg };
}

try {
  const config = await loadConfig(flag('--config'));
  const out = flag('--out'), port = flag('--port'), noMin = flag('--no-minify');
  if (out) config.outDir = out;
  if (noMin) config.minify = false;
  if (cmd === 'build') {
    const result = build({ ...config, log: console.log });
    console.log(formatReport(result));
  } else if (cmd === 'dev') {
    const s = await serve({ root: config.root, assets: config.assets ?? [], writable: (config.writable ?? []), liveReload: config.liveReload, port: port ? Number(port) : 8080, log: console.log });
    console.log(`serving ${config.root ?? '.'} at ${s.url}  (Ctrl+C to stop)`);
  } else if (cmd === 'inspect') {
    const entry = args[0];
    if (!entry) throw new Error('usage: engine-build inspect <entry.js>');
    const r = bundle(entry, { root: config.root, minify: false, alias: config.alias });
    const total = r.modules.reduce((n, m) => n + m.bytes, 0);
    for (const m of [...r.modules].sort((a, b) => b.bytes - a.bytes)) console.log(`${String(m.bytes).padStart(8)}  ${((m.bytes / total) * 100).toFixed(1).padStart(5)}%  ${m.id}`);
    console.log(`${String(total).padStart(8)}  total, ${r.modules.length} modules`);
  } else throw new Error(`unknown command "${cmd}" (build, dev, inspect)`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
