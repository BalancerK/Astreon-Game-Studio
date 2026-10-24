#!/usr/bin/env node
// The studio's project folders, from the command line: make one, check that it loads and runs, build it as a web game, and serve it while you edit it in any
// editor. It reads a folder the same way the studio's folder link does (same files, same rules), so a project you link from the studio, or one made here,
// is the same thing in both places.
//
//   node tools/studio-cli.js new <folder> [--template hero]     make a project folder from a starting game (--list shows them)
//   node tools/studio-cli.js check <folder> [--seconds 15]      load it, run it with no keys and with random keys, draw it; exit 1 on any problem
//   node tools/studio-cli.js build <folder> [--out dir | --zip file] [--title T] [--no-offline] [--max-kb N]
//   node tools/studio-cli.js serve <folder> [--port 8080] [--open]   serve the built game; it reloads the page when a file changes
import { promises as fs, readFileSync, statSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join, resolve, relative, dirname, isAbsolute, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { NodeFolder } from './node-folder.js';
import { readFolder, writeFile } from '../studio/app/store/folder-sync.js';
import { buildWebExport } from '../studio/export/export.js';
import { settingsOf } from '../studio/app/store/project-settings.js';
import { assetsOf } from '../studio/app/store/assets.js';
import { sizeReport, evaluate, defaultBudgets } from '../studio/export/health.js';
import { writeZip } from '../studio/app/store/zip.js';
import { TEMPLATES, DEFAULT_TEMPLATE } from '../studio/app/store/templates.js';
import { loadGame } from './replay-run.js';
import { setSoundSink, setCanvasFactory } from '../packages/arcade/src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DT = 1 / 60;

export class CliError extends Error {}

/** Read a project folder: its text files and its pictures and sounds (the same ones the studio's folder link takes). */
export async function loadProject(folder) {
  const path = resolve(folder);
  const stat = await fs.stat(path).catch(() => null);
  if (!stat?.isDirectory()) throw new CliError(`"${folder}" is not a folder.`);
  const { files, skipped } = await readFolder(new NodeFolder(path));
  const content = Object.fromEntries([...files].map(([p, f]) => [p, f.text]));
  if (typeof content['src/main.js'] !== 'string') throw new CliError(`"${folder}" has no src/main.js, so it is not a studio project. Make one with: new <folder>`);
  return { path, files: content, skipped, name: path.split(/[\\/]/).filter(Boolean).pop() };
}

/** Make a project folder from a starting game. */
export async function newProject(folder, template = DEFAULT_TEMPLATE) {
  const t = TEMPLATES[template];
  if (!t) throw new CliError(`There is no starting game called "${template}". They are: ${Object.keys(TEMPLATES).join(', ')}.`);
  const path = resolve(folder);
  const existing = await fs.readdir(path).catch(() => []);
  if (existing.length) throw new CliError(`"${folder}" is not empty. Choose a folder that is new or empty.`);
  const dir = new NodeFolder(path);
  await fs.mkdir(path, { recursive: true });
  for (const [file, content] of Object.entries(t.files)) await writeFile(dir, file, content);
  return { path, files: Object.keys(t.files) };
}

const engineReader = async (p) => fs.readFile(join(root, 'packages', p), 'utf8').catch(() => null);
const runtimeText = () => readFileSync(join(root, 'studio/export/runtime.js'), 'utf8');
const controlsText = () => readFileSync(join(root, 'studio/runner/controls.js'), 'utf8');

/** Build the web game from a loaded project. */
export async function buildProject(project, { title, offline = true } = {}) {
  const { settings } = settingsOf(project.files);
  const assets = assetsOf({ list: () => Object.keys(project.files), read: (p) => project.files[p] });
  const built = await buildWebExport({
    files: Object.fromEntries(Object.entries(project.files).filter(([, v]) => typeof v === 'string')),
    title: title || settings.title || project.name, readEngine: engineReader, runtime: runtimeText(), controls: controlsText(), assets, settings, offline,
  });
  const sizes = await sizeReport(built.files, async (bytes) => gzipSync(bytes).length);
  return { ...built, sizes, title: title || settings.title || project.name };
}

const ctx = () => new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });

/**
 * Load the game, run it with no keys and then with random keys, draw it, and say what is wrong.
 * @returns {Promise<{ok: boolean, ticks: number, problems: string[], warnings: string[], summary: unknown}>}
 */
export async function checkProject(project, { seconds = 15 } = {}) {
  const problems = [];
  const warnings = [];
  setSoundSink(() => {});
  setCanvasFactory(() => ({ getContext: ctx }));
  const text = Object.fromEntries(Object.entries(project.files).filter(([, v]) => typeof v === 'string'));
  let loaded;
  try {
    loaded = await loadGame(text);
  } catch (error) {
    return { ok: false, ticks: 0, problems: [`The game could not be loaded: ${error.message}`], warnings, summary: undefined };
  }
  const { mod, cleanup } = loaded;
  let ticks = 0;
  let summary;
  try {
    for (const name of ['create', 'update', 'render']) if (typeof mod[name] !== 'function') problems.push(`src/main.js does not export a function called ${name}.`);
    if (problems.length) return { ok: false, ticks, problems, warnings, summary };
    const game = mod.create();
    const total = Math.max(60, Math.round(seconds * 60));
    let seed = 7;
    const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pool = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'KeyR', 'KeyX', 'KeyZ'];
    try {
      for (; ticks < total; ticks++) {
        const keys = ticks < total / 4 ? new Set() : new Set(pool.filter(() => next() < 0.3));
        mod.update(game, keys, DT);
        if (ticks % 30 === 0) mod.render(game, ctx(), 0);
      }
      mod.render(game, ctx(), 0);
    } catch (error) {
      problems.push(`The game stopped with an error after ${ticks} ticks (${(ticks / 60).toFixed(1)} s): ${error.stack?.split('\n').slice(0, 3).join(' ') ?? error}`);
    }
    if (!problems.length) {
      try { summary = mod.summary?.(game); } catch (error) { problems.push(`summary() threw: ${error.message}`); }
      try { JSON.parse(JSON.stringify(game)); } catch { warnings.push('The game state cannot be saved as plain data (a function or a loop inside it), so the Time Machine cannot record it.'); }
      if (summary !== undefined && (typeof summary !== 'object' || summary === null)) warnings.push('summary() should return an object.');
    }
  } finally { cleanup(); }
  return { ok: problems.length === 0, ticks, problems, warnings, summary };
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json', '.md': 'text/plain; charset=utf-8',
};
// The page is given the version it was made from, so a change between it being served and its first check is still noticed.
const reloadScript = (version) => `<script>(function(){var v="${version}";setInterval(function(){fetch("/__version",{cache:"no-store"}).then(function(r){return r.text()})`
  + '.then(function(t){if(t!==v)location.reload()}).catch(function(){})},1000)})()</script>';
const versionOf = (signature) => createHash('sha1').update(signature).digest('hex').slice(0, 12);

/** A fingerprint of the project folder that changes when any file is added, removed or edited (cheap: names, sizes and dates). */
export function folderSignature(path) {
  let sig = '';
  const walk = (dir, depth) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { if (depth < 8) walk(full, depth + 1); } else { const s = statSync(full); sig += `${full}:${s.size}:${s.mtimeMs};`; }
    }
  };
  walk(path, 0);
  return sig;
}

/** Serve the game built from a project folder, building again whenever a file has changed. @returns {Promise<{server: import('node:http').Server, url: string}>} */
export async function serveProject(folder, { port = 8080, host = '127.0.0.1' } = {}) {
  const path = resolve(folder);
  let signature = null;
  let built = null;
  let error = null;
  const refresh = async () => {
    const now = folderSignature(path);
    if (now === signature) return;
    signature = now;
    try { built = await buildProject(await loadProject(path), { offline: false }); error = null; } catch (e) { error = e; }
  };
  await refresh();
  if (error) throw error;
  const server = createServer(async (req, res) => {
    try {
      await refresh();
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/__version') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end(versionOf(signature)); return; }
      if (error) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<pre style="font:14px monospace;padding:1em">${String(error.message).replace(/</g, '&lt;')}</pre>${reloadScript(versionOf(signature))}`);
        return;
      }
      let name = decodeURIComponent(url.pathname.slice(1)) || 'index.html';
      if (name.endsWith('/')) name += 'index.html';
      const body = built.files[name];
      if (body === undefined) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
      const data = name === 'index.html' ? String(body).replace('</body>', `${reloadScript(versionOf(signature))}</body>`) : body;
      res.writeHead(200, { 'Content-Type': TYPES[extname(name)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(typeof data === 'string' ? data : Buffer.from(data));
    } catch (e) {
      res.writeHead(500); res.end(String(e.message));
    }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, host, ok); });
  return { server, url: `http://${host}:${server.address().port}/` };
}

// ---------- the command line ----------

function parse(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      const takesValue = ['out', 'zip', 'title', 'template', 'seconds', 'port', 'max-kb'].includes(k);
      flags[k] = v ?? (takesValue ? argv[++i] : true);
    } else rest.push(a);
  }
  return { flags, rest };
}

const kb = (n) => `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} KB`;

const HELP = `The studio's project folders, from the command line.

  new <folder> [--template hero]      make a project folder from a starting game (--list shows them)
  check <folder> [--seconds 15]       load it, run it (no keys, then random keys), draw it; exit 1 on any problem
  build <folder> [--out dir | --zip file] [--title T] [--no-offline] [--max-kb N]
                                      build the web game (default: a folder next to the project, named <project>-web)
  serve <folder> [--port 8080] [--open]
                                      serve the game; the page reloads when you change a file
`;

export async function main(argv, out = console.log) {
  const { flags, rest } = parse(argv);
  const [command, folder] = rest;
  if (!command || command === 'help' || flags.help) { out(HELP); return 0; }
  try {
    if (command === 'new') {
      if (flags.list) { for (const [k, t] of Object.entries(TEMPLATES)) out(`${k.padEnd(10)} ${t.title}`); return 0; }
      if (!folder) throw new CliError('Say which folder to make: new <folder>');
      const made = await newProject(folder, flags.template);
      out(`Made ${made.path} with ${made.files.length} files.\nNext:  node tools/studio-cli.js serve ${folder}`);
      return 0;
    }
    if (!folder) throw new CliError(`Say which folder: ${command} <folder>`);
    const project = await loadProject(folder);
    if (project.skipped.length) out(`Left out ${project.skipped.length} file${project.skipped.length === 1 ? '' : 's'}: ${project.skipped.slice(0, 4).join(', ')}`);
    if (command === 'check') {
      const result = await checkProject(project, { seconds: Number(flags.seconds) || 15 });
      for (const w of result.warnings) out(`warning: ${w}`);
      for (const p of result.problems) out(`PROBLEM: ${p}`);
      out(result.ok ? `OK: ${project.name} ran ${result.ticks} ticks (${(result.ticks / 60).toFixed(1)} s)${result.summary === undefined ? '' : ` and ended with ${JSON.stringify(result.summary)}`}.`
        : `${project.name} has problems.`);
      return result.ok ? 0 : 1;
    }
    if (command === 'build') {
      const dest = resolve(flags.out ?? `${project.path}-web`);
      const inside = relative(project.path, dest);
      if (!flags.zip && inside && !inside.startsWith('..') && !isAbsolute(inside)) throw new CliError('Choose an output folder outside the project, so it is not built into itself.');
      const built = await buildProject(project, { title: flags.title === true ? undefined : flags.title, offline: !flags['no-offline'] });
      if (flags.zip) {
        const zip = resolve(flags.zip);
        await fs.mkdir(dirname(zip), { recursive: true });
        await fs.writeFile(zip, writeZip(built.files));
        out(`Wrote ${zip}`);
      } else {
        await fs.rm(dest, { recursive: true, force: true });
        const dir = new NodeFolder(dest);
        await fs.mkdir(dest, { recursive: true });
        for (const [file, content] of Object.entries(built.files)) await writeFile(dir, file, content);
        out(`Wrote ${dest}`);
      }
      const verdict = evaluate({ gzipBytes: built.sizes.gzipBytes, files: built.sizes.files }, { ...defaultBudgets(), download: flags['max-kb'] ? Number(flags['max-kb']) : defaultBudgets().download });
      out(`"${built.title}": ${built.sizes.files} files, ${kb(built.sizes.rawBytes)}, ${kb(built.sizes.gzipBytes)} compressed (what a player downloads).`);
      if (built.report.missing.length) out(`warning: these engine files could not be found: ${built.report.missing.join(', ')}`);
      const bad = verdict.items.filter((i) => i.state === 'fail' && (i.id === 'download' || i.id === 'files'));
      for (const i of bad) out(`TOO BIG: ${i.label} is ${Math.round(i.value)}${i.unit} and the limit is ${i.limit}${i.unit}.`);
      if (!flags.zip) out('Upload that folder to any web host, or look at it with:  node tools/studio-cli.js serve <folder>');
      return bad.length && flags['max-kb'] ? 1 : 0;
    }
    if (command === 'serve') {
      const { url } = await serveProject(folder, { port: flags.port === undefined ? 8080 : Number(flags.port) });
      out(`Serving ${project.name} at ${url}\nChange a file and the page reloads. Press Ctrl+C to stop.`);
      if (flags.open) {
        const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
        spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
      }
      return new Promise(() => {});
    }
    throw new CliError(`There is no command called "${command}".\n\n${HELP}`);
  } catch (error) {
    if (error instanceof CliError || error?.code === 'EADDRINUSE') { out(`${error instanceof CliError ? error.message : `That port is already in use. Try another with --port.`}`); return 2; }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { if (typeof code === 'number') process.exit(code); }, (error) => { console.error(error); process.exit(2); });
}
