// Turning a tree of ES modules into one script. Each module becomes a function; `import` becomes a lookup of the other module's exports
// (which are getters, so they read the current value); only modules the entry actually reaches are included.
//
// What it supports: import / export in every ordinary form (default, named, `as`, namespace, `export … from`, `export *`), literal

// What it refuses, with a message that names the file: circular imports, `export let/var` (imports are read when the module starts, so a
// binding that changes later would go stale), destructuring exports, several names in one `export const a = 1, b = 2;` (only the first would be exported), and top-level `await` outside the entry module.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { scan, codeTest } from './lexer.js';
import { minifyJs } from './minify.js';

/**
 * The bundler could not bundle the code (a missing file, a circular import, an unsupported form). The message names the file.
 */
export class BundleError extends Error {
  constructor(message) { super(message); this.name = 'BundleError'; }
}

const IDENT = '[A-Za-z_$][\\w$]*';
const RE = {
  importFrom: new RegExp(`^import\\s+(?:(${IDENT})\\s*,?\\s*)?(?:\\*\\s*as\\s+(${IDENT})|\\{([^}]*)\\})?\\s*from\\s*(['"])([^'"\\n]+)\\4[ \\t]*;?`, 'gm'),
  importBare: /^import\s*(['"])([^'"\n]+)\1[ \t]*;?/gm,
  exportFrom: new RegExp(`^export\\s+(?:\\*(?:\\s*as\\s+(${IDENT}))?|\\{([^}]*)\\})\\s*from\\s*(['"])([^'"\\n]+)\\3[ \\t]*;?`, 'gm'),
  exportList: /^export\s*\{([^}]*)\}(?!\s*from\b)[ \t]*;?/gm,
  exportDefault: /^export\s+default\s+/gm,
  exportDecl: new RegExp(`^export\\s+(async\\s+function\\s*\\*?|function\\s*\\*?|class|const|let|var)\\s*(${IDENT}|[{\\[])?`, 'gm'),
  dynamic: /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
};

/** Split `a, b as c` into [[imported, local], ...]. */
function names(list) {
  return list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [a, b] = s.split(/\s+as\s+/); return [a.trim(), (b ?? a).trim()]; });
}

/** Where an import specifier points. @returns {string} an absolute file path */
export function resolveImport(spec, fromFile, { alias = {} } = {}) {
  for (const [from, to] of Object.entries(alias)) if (spec === from || spec.startsWith(`${from}/`)) spec = to + spec.slice(from.length);
  const tryFile = (p) => {
    for (const c of [p, `${p}.js`, join(p, 'index.js')]) { try { if (statSync(c).isFile()) return c; } catch { /* next */ } }
    return null;
  };
  if (spec.startsWith('.') || spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec)) {
    const hit = tryFile(resolve(dirname(fromFile), spec));
    if (!hit) throw new BundleError(`${fromFile}: cannot find "${spec}"`);
    return hit;
  }
  const parts = spec.split('/'), pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0], sub = spec.slice(pkg.length + 1);
  for (let dir = dirname(fromFile); ; dir = dirname(dir)) {
    const pdir = join(dir, 'node_modules', pkg);
    if (existsSync(pdir)) {
      if (sub) { const hit = tryFile(join(pdir, sub)); if (hit) return hit; }
      else {
        const json = JSON.parse(readFileSync(join(pdir, 'package.json'), 'utf8'));
        const ex = typeof json.exports === 'string' ? json.exports : (typeof json.exports?.['.'] === 'string' ? json.exports['.'] : (json.exports?.['.']?.import ?? json.exports?.['.']?.default));
        const hit = tryFile(join(pdir, ex ?? json.module ?? json.main ?? 'index.js'));
        if (hit) return hit;
      }
    }
    if (dirname(dir) === dir) break;
  }
  throw new BundleError(`${fromFile}: cannot find the package "${spec}" (looked in node_modules folders above it)`);
}

/** Rewrite one module's imports and exports. @returns {{code: string, deps: string[]}} deps are absolute paths, in order */
export function transformModule(src, file, resolveId, { id = file } = {}) {
  const segs = scan(src), isCode = codeTest(segs);
  const edits = []; // [start, end, text]
  const deps = [];
  const getters = []; // [exportedName, expression]
  let counter = 0;
  const bad = (m) => new BundleError(`${file}: ${m}`);
  const dep = (spec) => { const target = resolveId(spec, file); if (!deps.includes(target)) deps.push(target); return `__r(${JSON.stringify(resolveId.idOf(target))})`; };
  const each = (re, fn) => { re.lastIndex = 0; for (let m; (m = re.exec(src));) if (isCode(m.index)) fn(m); };
  /** Does the declaration that starts at `from` (just after the first name) go on to declare another name: `const a = 1, b = 2`? Looks only at code (not strings or comments), to the end of the statement. */
  const declaresMore = (from) => {
    let depth = 0, last = '';
    for (let i = from; i < src.length; i++) {
      if (!isCode(i)) continue;
      const ch = src[i];
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      else if (depth === 0) {
        if (ch === ';') return false;
        if (ch === ',') return /^\s*[A-Za-z_$][\w$]*\s*[=,;\n]/.test(src.slice(i + 1));
        if (ch === '\n' && last && !',=+-*/%&|^?:<>!~.'.includes(last)) return false;
      }
      if (!/\s/.test(ch)) last = ch;
    }
    return false;
  };
  const lines = (text) => '\n'.repeat((text.match(/\n/g) ?? []).length); // keep line numbers: stack traces point at the original lines

  each(RE.importFrom, (m) => {
    const [all, def, ns, list, , spec] = m;
    const v = `__i${counter++}`;
    let code = `const ${v} = ${dep(spec)};`;
    if (def) code += ` const ${def} = ${v}.default;`;
    if (ns) code += ` const ${ns} = ${v};`;
    if (list && list.trim()) code += ` const { ${names(list).map(([a, b]) => (a === b ? a : `${a}: ${b}`)).join(', ')} } = ${v};`;
    edits.push([m.index, m.index + all.length, code + lines(all)]);
  });
  each(RE.importBare, (m) => edits.push([m.index, m.index + m[0].length, `${dep(m[2])};${lines(m[0])}`]));
  each(RE.exportFrom, (m) => {
    const [all, asName, list, , spec] = m;
    const v = `__i${counter++}`;
    let code = `const ${v} = ${dep(spec)};`;
    if (list !== undefined) for (const [a, b] of names(list)) getters.push([b, `${v}.${a}`]);
    else if (asName) getters.push([asName, v]);
    else code += ` __star(exports, ${v});`;
    edits.push([m.index, m.index + all.length, code + lines(all)]);
  });
  each(RE.exportList, (m) => { for (const [a, b] of names(m[1])) getters.push([b, a]); edits.push([m.index, m.index + m[0].length, lines(m[0])]); });
  each(RE.exportDefault, (m) => {
    const rest = src.slice(m.index + m[0].length);
    const named = /^(?:async\s+)?(?:function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/.exec(rest);
    if (named) { getters.push(['default', named[1]]); edits.push([m.index, m.index + m[0].length, '']); }
    else { getters.push(['default', '__default']); edits.push([m.index, m.index + m[0].length, 'const __default = ']); }
  });
  each(RE.exportDecl, (m) => {
    const [all, kind, name] = m;
    if (!name || name === '{' || name === '[') throw bad('`export const { … }` / `export const [ … ]` is not supported; export each name on its own');
    if (kind === 'let' || kind === 'var') throw bad(`\`export ${kind} ${name}\` is not supported: importers read the value once, so a binding that changes later would go stale (use const, or export a function or an object)`);
    if (kind === 'const' && declaresMore(m.index + m[0].length)) throw bad(`\`export const ${name} = …, …\` would export only ${name}: write each exported name as its own \`export const\``);
    getters.push([name, name]);
    edits.push([m.index, m.index + m[0].indexOf(kind), '']); // keep the declaration itself, drop only `export `
  });
  each(RE.dynamic, (m) => edits.push([m.index, m.index + m[0].length, `Promise.resolve().then(() => ${dep(m[2])})`]));

  // top-level await: an unindented statement that starts with (or assigns the result of) `await`
  let hasTla = false;
  for (const m of src.matchAll(/^(?:(?:const|let|var)\s+[\w${}\[\],\s:]+=\s*)?await\b/gm)) if (isCode(m.index)) hasTla = true;

  edits.sort((a, b) => a[0] - b[0]);
  let out = '', pos = 0;
  for (const [s, e, text] of edits) {
    if (s < pos) throw bad('could not read an import / export statement (two matched the same text)');
    out += src.slice(pos, s) + text; pos = e;
  }
  out += src.slice(pos);
  const head = getters.length ? `${getters.map(([n, expr]) => `Object.defineProperty(exports, ${JSON.stringify(n)}, { enumerable: true, get: () => ${expr} });`).join(' ')}\n` : '';
  return { code: head + out, deps, hasTla };
}

/**
 * Bundle an entry module and everything it imports.
 * @param {string} entry Path to the entry file.
 * @param {object} [o]
 * @param {string} [o.root] Module ids are paths relative to this (default: the entry's folder).
 * @param {boolean} [o.minify]
 * @param {Record<string, string>} [o.alias] Replace the start of a specifier: `{ '@game': '/abs/path/src' }`.
 * @param {Record<string, string>} [o.define] Replace plain identifiers with literal text: `{ DEBUG: 'false' }` (code only, never inside strings).
 * @returns {{code: string, modules: Array<{id: string, file: string, bytes: number}>}} modules in the order they run
 */
export function bundle(entry, { root, minify = false, alias = {}, define = {} } = {}) {
  entry = resolve(entry);
  root = resolve(root ?? dirname(entry));
  const idOf = (file) => relative(root, file).split(sep).join('/');
  const resolveId = Object.assign((spec, from) => resolveImport(spec, from, { alias }), { idOf });
  const done = new Map(); // file -> {code, deps}
  const order = [];
  const visiting = [];
  const visit = (file) => {
    if (done.has(file)) return;
    if (visiting.includes(file)) throw new BundleError(`circular import: ${[...visiting.slice(visiting.indexOf(file)), file].map(idOf).join(' -> ')} (imports are read when a module starts, so cycles cannot be bundled; move the shared part into a third module)`);
    visiting.push(file);
    let src = readFileSync(file, 'utf8');
    if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
    if (/^#!/.test(src)) src = `//${src}`;
    let t;
    try { t = transformModule(src, file, resolveId, { id: idOf(file) }); } catch (e) { if (e instanceof SyntaxError) throw new BundleError(`${file}: ${e.message}`); throw e; }
    if (t.hasTla && file !== entry) throw new BundleError(`${file}: top-level \`await\` is only supported in the entry module of a bundle (other modules run synchronously); move the awaiting code into the entry`);
    for (const d of t.deps) visit(d);
    visiting.pop();
    done.set(file, t); order.push(file);
  };
  visit(entry);
  const defineKeys = Object.keys(define);
  const wrap = (file) => {
    let code = done.get(file).code;
    if (defineKeys.length) code = applyDefines(code, define);
    return `${JSON.stringify(idOf(file))}: ${done.get(file).hasTla ? 'async ' : ''}function (exports, __r) {\n"use strict";\n${code}\n}`;
  };
  const body = order.map(wrap).join(',\n');
  let out = `(() => {\nconst __mods = {\n${body}\n};\nconst __cache = {};\n`
    + `function __r(id) { const c = __cache[id]; if (c) return c.exports; const m = __cache[id] = { exports: {} }; __mods[id](m.exports, __r); return m.exports; }\n`
    + `function __star(to, from) { for (const k of Object.keys(from)) if (k !== 'default' && !(k in to)) Object.defineProperty(to, k, { enumerable: true, get: () => from[k] }); }\n`
    + `__r(${JSON.stringify(idOf(entry))});\n})();\n`;
  if (minify) out = minifyJs(out);
  return { code: out, modules: order.map((f) => ({ id: idOf(f), file: f, bytes: done.get(f).code.length })) };
}

function applyDefines(code, define) {
  const segs = scan(code), isCode = codeTest(segs);
  const re = new RegExp(`(?<![\\w$.])(${Object.keys(define).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w$])`, 'g');
  return code.replace(re, (m, name, offset) => (isCode(offset) ? define[name] : m));
}
