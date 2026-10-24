// The production build: bundle and minify the game's code, copy its files under names that contain their content hash, write a manifest
// that maps the plain names to those files, rewrite the pages to match, and precompress what compresses.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { resolve, join, dirname, extname, relative, sep, posix } from 'node:path';
import { gzipSync, brotliCompressSync, constants as zc } from 'node:zlib';
import { bundle } from './bundle.js';
import { minifyJson, minifyCss } from './minify.js';
import { matchFiles, hashBytes, compressible } from './files.js';

/**
 * @typedef {object} BuildConfig
 * @property {string} [root] The project folder (default: the current folder). Everything below is relative to it.
 * @property {string} [outDir] Where the build goes (`dist`). It is emptied first.
 * @property {string[]} [pages] HTML pages to process (`['index.html']`): their module scripts are bundled, files they refer to are hashed.
 * @property {string[]} [assets] Globs of files the game loads at run time (`['assets/**']`): they get hashed names and manifest entries.
 * @property {string} [publicPath] URL prefix the build will be served under (`''` = next to the page, `'/game/'`...).
 * @property {boolean} [minify] Default true.
 * @property {Array<'gzip' | 'brotli'>} [compress] Precompressed copies written next to files that shrink (default both).
 * @property {number} [hashLength] Hex digits of the content hash in file names (8).
 * @property {Record<string, string>} [alias] Import specifier prefixes to replace.
 * @property {Record<string, string>} [define] Identifiers replaced by literal text in the code (`{ DEBUG: 'false' }`).
 * @property {Record<string, (bytes: Buffer, file: string) => Buffer | string>} [transforms] By extension (`'.png'`): change a file's bytes before hashing (compress textures, convert audio...).
 * @property {(msg: string) => void} [log]
 */

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
const rel = (p) => p.split(sep).join('/');

function defaultTransforms() {
  return {
    '.json': (b, f) => { try { return minifyJson(b.toString('utf8')); } catch (e) { throw new Error(`${f}: ${e.message}`); } },
    '.css': (b) => minifyCss(b.toString('utf8')),
  };
}

/** Where `url` (as written in a page or stylesheet at `fromRel`) points, relative to root, or null if it is not a local file. */
function localTarget(root, fromRel, url) {
  const clean = url.split(/[?#]/)[0];
  if (!clean || EXTERNAL.test(clean)) return null;
  const p = clean.startsWith('/') ? clean.slice(1) : posix.normalize(posix.join(posix.dirname(fromRel), clean));
  if (p.startsWith('..')) return null;
  const abs = join(root, p);
  try { return statSync(abs).isFile() ? p : null; } catch { return null; }
}

/**
 * Build a project. Same input, same output, byte for byte.
 * @param {BuildConfig} config
 * @returns {{outDir: string, files: Array<{path: string, bytes: number, gzip?: number, brotli?: number}>, manifest: any, bundles: Array<{page: string, entry: string, file: string, modules: number, source: number, minified: number, gzip: number}>, warnings: string[]}}
 */
export function build(config = {}) {
  const root = resolve(config.root ?? '.');
  const outDir = resolve(root, config.outDir ?? 'dist');
  const { pages = ['index.html'], assets: assetGlobs = [], publicPath = '', minify = true, compress = ['gzip', 'brotli'], hashLength = 8, alias = {}, define = {}, log = () => {} } = config;
  const transforms = { ...defaultTransforms(), ...(config.transforms ?? {}) };
  if (outDir === root || root.startsWith(outDir + sep)) throw new Error(`outDir "${outDir}" would delete the project folder; choose a folder inside it`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const warnings = [];
  const written = new Map(); // out path -> bytes
  const emit = (path, data) => {
    const abs = join(outDir, path);
    mkdirSync(dirname(abs), { recursive: true });
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    writeFileSync(abs, buf);
    written.set(path, buf);
    return buf;
  };
  const manifest = { version: 1, assets: {}, bundles: {} };
  const hashed = new Map(); // source path (relative to root) -> hashed output path

  const hashedName = (path, bytes) => {
    const ext = extname(path);
    return `${path.slice(0, path.length - ext.length)}.${hashBytes(bytes, hashLength)}${ext}`;
  };
  const addAsset = (path, { inManifest = true } = {}) => {
    if (hashed.has(path)) return hashed.get(path);
    let bytes = readFileSync(join(root, path));
    const ext = extname(path).toLowerCase();
    if (ext === '.css') bytes = Buffer.from(rewriteCss(path, bytes.toString('utf8')), 'utf8');
    const t = transforms[ext];
    if (t) { const out = t(bytes, path); bytes = Buffer.isBuffer(out) ? out : Buffer.from(out, 'utf8'); }
    const name = hashedName(path, bytes);
    hashed.set(path, name);
    emit(name, bytes);
    if (inManifest) manifest.assets[path] = { url: name, hash: hashBytes(bytes, hashLength), bytes: bytes.length };
    return name;
  };
  const rewriteCss = (path, css) => css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, url) => {
    const target = localTarget(root, path, url);
    if (!target) return m;
    const out = addAsset(target, { inManifest: false });
    return `url(${q}${posix.relative(posix.dirname(path), out)}${url.slice(url.search(/[?#]/) >= 0 ? url.search(/[?#]/) : url.length)}${q})`;
  });

  // run-time assets: everything the globs match, whether or not a page mentions it
  for (const f of matchFiles(root, assetGlobs)) if (!f.startsWith(rel(relative(root, outDir)) + '/')) addAsset(f);

  // pages
  const bundles = [];
  const pageList = [];
  for (const page of pages) {
    const pagePath = join(root, page);
    if (!existsSync(pagePath)) throw new Error(`page "${page}" does not exist (looked in ${root})`);
    let html = readFileSync(pagePath, 'utf8');
    // how this page refers to a file in the output: from its own folder, or from the public path
    const publicUrl = (path) => (publicPath ? publicPath + path : posix.relative(posix.dirname(page), path));
    // module scripts -> one bundle each
    html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs, inline) => {
      if (!/\btype\s*=\s*["']?module/i.test(attrs)) return tag;
      const src = /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(attrs)?.[2];
      if (!src) { warnings.push(`${page}: an inline module script is left as it is (put it in a file to have it bundled)`); return tag; }
      const target = localTarget(root, page, src);
      if (!target) { warnings.push(`${page}: script "${src}" is not a local file; left as it is`); return tag; }
      const result = bundle(join(root, target), { root, minify, alias, define });
      const code = Buffer.from(result.code, 'utf8');
      const file = hashedName(target.replace(/\.m?js$/, '.js'), code);
      emit(file, code);
      manifest.bundles[`${page}:${target}`] = file;
      bundles.push({ page, entry: target, file, modules: result.modules.length, source: result.modules.reduce((n, m) => n + readFileSync(m.file).length, 0), minified: code.length, gzip: gzipSync(code, { level: 9 }).length });
      const other = attrs.replace(/\s*\btype\s*=\s*(["'])module\1/i, '').replace(/\s*\bsrc\s*=\s*(["'])(.*?)\1/i, '').replace(/\s*\bdefer\b/i, '').trim();
      return `<script defer${other ? ` ${other}` : ''} src="${publicUrl(file)}"></script>`;
    });
    // everything else the page points at is hashed and rewritten (images, styles, icons)
    html = html.replace(/\b(src|href|poster)\s*=\s*(["'])(.*?)\2/gi, (m, attr, q, url) => {
      if (url.startsWith(publicPath) && publicPath && existsSync(join(outDir, url.slice(publicPath.length)))) return m; // already ours (a bundle)
      const target = localTarget(root, page, url);
      if (!target || extname(target).toLowerCase() === '.html') return m;
      const tail = url.slice(url.search(/[?#]/) >= 0 ? url.search(/[?#]/) : url.length);
      return `${attr}=${q}${publicUrl(addAsset(target, { inManifest: false }))}${tail}${q}`;
    });
    pageList.push({ page, html, base: publicPath || `${posix.relative(posix.dirname(page), '') || '.'}/` });
  }
  // the manifest is final once every page has been read
  const manifestText = JSON.stringify({ version: 1, assets: sortKeys(manifest.assets), bundles: sortKeys(manifest.bundles), publicPath });
  for (const { page, html, base } of pageList) {
    // the page's copy also says where the output folder is from this page, so `new AssetManager({ base, manifest })` just works
    const text = JSON.stringify({ ...JSON.parse(manifestText), base });
    const inline = `<script id="asset-manifest" type="application/json">${text.replace(/</g, '\\u003c')}</script>`;
    emit(page, /<\/head>/i.test(html) ? html.replace(/<\/head>/i, () => `${inline}\n</head>`) : `${inline}\n${html}`);
  }
  emit('manifest.json', manifestText);

  // headers for hosts that read them (Netlify, Cloudflare Pages): hashed files never change; pages and the manifest always revalidate
  const pageHeaders = pageList.map(({ page }) => `/${page}\n  Cache-Control: no-cache`).join('\n');
  emit('_headers', `${pageHeaders}\n/manifest.json\n  Cache-Control: no-cache\n/*\n  Cache-Control: public, max-age=31536000, immutable\n`.replace(/^\n/, ''));

  // precompression
  const files = [];
  for (const [path, buf] of [...written].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const entry = { path, bytes: buf.length };
    if (compressible(path) && buf.length >= 256) {
      if (compress.includes('gzip')) { const z = gzipSync(buf, { level: 9 }); if (z.length < buf.length * 0.95) { emit(`${path}.gz`, z); entry.gzip = z.length; } }
      if (compress.includes('brotli')) { const z = brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: buf.length } }); if (z.length < buf.length * 0.95) { emit(`${path}.br`, z); entry.brotli = z.length; } }
    }
    files.push(entry);
  }
  log(`built ${files.length} files into ${outDir}`);
  return { outDir, files, manifest: JSON.parse(manifestText), bundles, warnings };
}

function sortKeys(o) { return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))); }

/** A short text report of a build. */
export function formatReport(result) {
  const kb = (n) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  const lines = [];
  for (const b of result.bundles) lines.push(`${b.page}  ${b.entry}: ${b.modules} modules, ${kb(b.source)} source -> ${kb(b.minified)} minified -> ${kb(b.gzip)} gzip   (${b.file})`);
  const total = result.files.filter((f) => !/\.(gz|br)$/.test(f.path)).reduce((n, f) => n + f.bytes, 0);
  lines.push(`${result.files.filter((f) => !/\.(gz|br)$/.test(f.path)).length} files, ${kb(total)} in ${result.outDir}`);
  for (const w of result.warnings) lines.push(`warning: ${w}`);
  return lines.join('\n');
}
