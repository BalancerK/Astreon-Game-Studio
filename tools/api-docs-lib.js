// The API reference, generated from the source: every package's public exports (what `src/index.js` exports, following re-exports into
// the files that define them), with their JSDoc comments, as Markdown pages and one searchable HTML page. No dependencies.
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { scan, codeTest } from '../packages/build/src/lexer.js';

const TAGS = new Set(['param', 'returns', 'return', 'typedef', 'property', 'prop', 'example', 'template', 'type', 'deprecated', 'internal', 'private', 'throws', 'see', 'callback', 'readonly', 'override', 'this', 'since', 'default', 'satisfies']);
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'super', 'with', 'else', 'do']);

// ---------- JSDoc ----------

/** Read a `{type}` with balanced braces at the start of `s`. @returns {{type: string, rest: string}} */
function takeType(s) {
  s = s.trimStart();
  if (s[0] !== '{') return { type: '', rest: s };
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return { type: s.slice(1, i).trim(), rest: s.slice(i + 1).trimStart() };
  }
  return { type: s.slice(1).trim(), rest: '' };
}

/**
 * Parse a `/** ... *​/` comment.
 * @returns {{description: string, params: any[], returns: any, properties: any[], typedefs: any[], examples: string[], deprecated: string | null, internal: boolean, throws: string[], template: string[], type: string, see: string[]}}
 */
export function parseJsDoc(raw) {
  const body = raw.replace(/^\/\*\*+/, '').replace(/\*+\/$/, '').split('\n').map((l) => l.replace(/^\s*\*( |$)?/, '')).join('\n');
  // a tag starts at "@word" (a known tag) at the start of a line or after whitespace
  const re = /(^|\s)@([a-z]+)\b/g, marks = [];
  for (let m; (m = re.exec(body));) if (TAGS.has(m[2])) marks.push({ at: m.index + m[1].length, name: m[2], end: m.index + m[0].length });
  const doc = { description: (marks.length ? body.slice(0, marks[0].at) : body).trim(), params: [], returns: null, properties: [], typedefs: [], examples: [], deprecated: null, internal: false, throws: [], template: [], type: '', see: [] };
  marks.forEach((mk, i) => {
    const text = body.slice(mk.end, i + 1 < marks.length ? marks[i + 1].at : body.length);
    const t = mk.name === 'example' ? text.replace(/^\s*\n?/, '').replace(/\s+$/, '') : text.trim();
    switch (mk.name) {
      case 'param': case 'property': case 'prop': {
        const { type, rest } = takeType(t);
        const m = /^(\.\.\.)?(\[[^\]]*\]|\S+)\s*(?:-\s*)?([\s\S]*)$/.exec(rest);
        if (!m) break;
        let name = m[2], optional = false, dflt;
        if (name.startsWith('[')) { optional = true; name = name.slice(1, -1); const eq = name.indexOf('='); if (eq >= 0) { dflt = name.slice(eq + 1); name = name.slice(0, eq); } }
        const spread = type.startsWith('...');
        const item = { name: (m[1] ?? (spread ? '...' : '')) + name, type: spread ? type.slice(3) : type, optional: optional || /=\s*$/.test(type), default: dflt, description: m[3].replace(/\s+/g, ' ').trim() };
        (mk.name === 'param' ? doc.params : doc.properties).push(item);
        break;
      }
      case 'returns': case 'return': { const { type, rest } = takeType(t); doc.returns = { type, description: rest.replace(/^-\s*/, '').replace(/\s+/g, ' ').trim() }; break; }
      case 'typedef': case 'callback': { const { type, rest } = takeType(t); const m = /^(\S+)\s*([\s\S]*)$/.exec(rest); if (m) doc.typedefs.push({ name: m[1], type, description: m[2].replace(/\s+/g, ' ').trim() }); break; }
      case 'example': doc.examples.push(t); break;
      case 'deprecated': doc.deprecated = t || 'deprecated'; break;
      case 'internal': case 'private': doc.internal = true; break;
      case 'throws': doc.throws.push(takeType(t).rest.replace(/\s+/g, ' ')); break;
      case 'template': doc.template.push(t); break;
      case 'type': doc.type = takeType(t).type; break;
      case 'see': doc.see.push(t); break;
      default: break;
    }
  });
  return doc;
}

// ---------- reading a source file ----------

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/** The index just after the `)` that closes the `(` at `open`, skipping strings and comments. */
function closeParen(source, open, isCode) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (!isCode(i)) continue;
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return i + 1;
  }
  return source.length;
}
function closeBrace(source, open, isCode) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (!isCode(i)) continue;
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return i + 1;
  }
  return source.length;
}

/**
 * What a source file declares and exports.
 * @returns {{decls: Map<string, any>, exported: Map<string, string>, reexports: Array<{from: string, names: Array<[string, string]> | '*', ns?: string}>, typedefs: any[]}}
 * `decls`: local name -> declaration; `exported`: exported name -> local name.
 */
export function analyzeSource(source, file = '') {
  const segs = scan(source), isCode = codeTest(segs);
  const comments = segs.filter((s) => s.type === 'comment' && source.startsWith('/**', s.start)).map((s) => ({ start: s.start, end: s.end, text: source.slice(s.start, s.end) }));
  const lineOf = (pos) => source.slice(0, pos).split('\n').length;
  const docBefore = (pos) => { // the doc comment that ends right before `pos` (only whitespace between)
    let lo = 0, hi = comments.length - 1, best = null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (comments[mid].end <= pos) { best = comments[mid]; lo = mid + 1; } else hi = mid - 1; }
    return best && /^\s*$/.test(source.slice(best.end, pos)) ? parseJsDoc(best.text) : null;
  };
  const out = { decls: new Map(), exported: new Map(), reexports: [], typedefs: [] };

  for (const c of comments) { // @typedef anywhere
    if (!/@typedef|@callback/.test(c.text)) continue;
    const d = parseJsDoc(c.text);
    for (const t of d.typedefs) out.typedefs.push({ ...t, properties: d.properties, file, line: lineOf(c.start), description: t.description || d.description });
  }

  const declRe = /^(export\s+(?:default\s+)?)?(async\s+)?(function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  for (let m; (m = declRe.exec(source));) {
    if (!isCode(m.index)) continue;
    const [, exp, async, kw, name] = m;
    const start = m.index, doc = docBefore(start);
    const kind = kw.startsWith('function') ? 'function' : kw === 'class' ? 'class' : 'constant';
    const decl = { name, kind, doc, file, line: lineOf(start), exported: !!exp, signature: '', members: [], extends: null };
    const after = m.index + m[0].length;
    if (kind === 'function') {
      const open = source.indexOf('(', after);
      decl.signature = `${async ? 'async ' : ''}${kw.replace(/\s+/g, '')} ${name}${collapse(source.slice(open, closeParen(source, open, isCode)))}`.replace('function*', 'function*');
    } else if (kind === 'class') {
      const open = source.indexOf('{', after);
      const head = collapse(source.slice(after, open));
      decl.extends = /^extends\s+([\w$.]+)/.exec(head)?.[1] ?? null;
      decl.signature = `class ${name}${head ? ` ${head}` : ''}`;
      decl.members = classMembers(source, open, closeBrace(source, open, isCode), isCode, docBefore, lineOf, file);
    } else {
      // const NAME = (args) => … / function (…) { … }: show it as a function; anything else as a constant
      const rhs = source.slice(after, after + 400);
      const arrow = /^\s*=\s*(async\s+)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.exec(rhs), fnExpr = /^\s*=\s*(async\s+)?function\s*\*?\s*\w*\s*(\([^)]*\))/.exec(rhs);
      if (arrow) { decl.kind = 'function'; decl.signature = `${arrow[1] ? 'async ' : ''}function ${name}${arrow[2].startsWith('(') ? collapse(arrow[2]) : `(${arrow[2]})`}`; }
      else if (fnExpr) { decl.kind = 'function'; decl.signature = `${fnExpr[1] ? 'async ' : ''}function ${name}${collapse(fnExpr[2])}`; }
      else { decl.signature = `const ${name}`; decl.value = collapse(/^\s*=\s*([^;\n]*)/.exec(rhs)?.[1] ?? '').slice(0, 80); }
    }
    out.decls.set(name, decl);
    if (exp) out.exported.set(/default/.test(exp) ? 'default' : name, name);
    if (kind === 'constant') { // `const A = 1, B = 2;` declares several names that share one comment
      let depth = 0;
      for (let i = after, stop = Math.min(source.length, after + 600); i < stop; i++) {
        if (!isCode(i)) continue;
        const c = source[i];
        if (c === '(' || c === '[' || c === '{') depth++; else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === ';' && depth <= 0) break;
        else if (c === '\n' && depth <= 0 && /^\S/.test(source.slice(i + 1, i + 2))) break;
        else if (c === ',' && depth === 0) {
          const more = /^\s*([A-Za-z_$][\w$]*)\s*=/.exec(source.slice(i + 1, i + 80));
          if (more) { out.decls.set(more[1], { ...decl, name: more[1], signature: `const ${more[1]}`, value: '' }); if (exp) out.exported.set(more[1], more[1]); }
        }
      }
    }
  }

  const listRe = /^export\s*\{([^}]*)\}(?:\s*from\s*(['"])([^'"\n]+)\2)?/gm;
  for (let m; (m = listRe.exec(source));) {
    if (!isCode(m.index)) continue;
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [a, b] = s.split(/\s+as\s+/); return [a.trim(), (b ?? a).trim()]; });
    if (m[3]) out.reexports.push({ from: m[3], names });
    else for (const [local, ex] of names) out.exported.set(ex, local);
  }
  const starRe = /^export\s*\*(?:\s*as\s+([\w$]+))?\s*from\s*(['"])([^'"\n]+)\2/gm;
  for (let m; (m = starRe.exec(source));) if (isCode(m.index)) out.reexports.push({ from: m[3], names: '*', ns: m[1] });
  return out;
}

function classMembers(source, open, end, isCode, docBefore, lineOf, file) {
  const members = [];
  const re = /^[ \t]*(static\s+)?(async\s+)?(get\s+|set\s+)?(\*\s*)?([A-Za-z_$][\w$]*)\s*\(/gm;
  re.lastIndex = open;
  // depth 1 means directly inside the class body
  let depth = 0, pos = open;
  const depthAt = (target) => { for (; pos < target; pos++) if (isCode(pos)) { if (source[pos] === '{') depth++; else if (source[pos] === '}') depth--; } return depth; };
  for (let m; (m = re.exec(source)) && m.index < end;) {
    if (!isCode(m.index + m[0].length - 2)) continue;
    const name = m[5];
    if (KEYWORDS.has(name) && !m[1] && !m[3]) continue;
    const nameAt = m.index + m[0].indexOf(name, m[0].search(/\S/));
    if (depthAt(nameAt) !== 1) continue;
    const parenAt = m.index + m[0].length - 1;
    const sig = collapse(source.slice(parenAt, closeParen(source, parenAt, isCode)));
    const kind = name === 'constructor' ? 'constructor' : m[3]?.trim() === 'get' ? 'getter' : m[3]?.trim() === 'set' ? 'setter' : m[1] ? 'static method' : 'method';
    if (name.startsWith('_') || /\bprivate\b/.test(m[0])) continue;
    const doc = docBefore(m.index + m[0].search(/\S/));
    if (doc?.internal) continue;
    members.push({ name, kind, signature: `${m[1] ? 'static ' : ''}${m[2] ? 'async ' : ''}${m[3] ?? ''}${m[4] ? '*' : ''}${name}${kind === 'getter' ? '' : sig}`.replace(/\s+/g, ' ').trim(), doc, file, line: lineOf(m.index) });
  }
  return members;
}

/** The `//` comment lines at the top of a file, as one paragraph (what the module is for). */
export function headerComment(source) {
  const out = [];
  for (const line of source.split('\n')) { if (/^\/\/ ?/.test(line)) out.push(line.replace(/^\/\/ ?/, '')); else if (out.length || line.trim()) break; }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

// ---------- the public API of a package ----------

const exists = (p) => existsSync(p) && !readdirSafe(p);
function readdirSafe(p) { try { readdirSync(p); return true; } catch { return false; } }
function resolveFile(from, spec) {
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.js`, join(base, 'index.js')]) if (exists(c)) return c;
  return null;
}

/**
 * Everything a package exports, with docs. Follows `export … from` into the files that define things.
 * @param {string} pkgDir
 * @param {string} [entryFile] The entry module, relative to the package (default `src/index.js`; `src/node.js` is the Node-only entry some packages have).
 * @returns {Array<any>} entries `{name, kind, signature, doc, members, file, line, ...}`, `namespace` entries carry `entries`
 */
export function publicApi(pkgDir, entryFile = 'src/index.js') {
  const cache = new Map();
  const get = (file) => { if (!cache.has(file)) cache.set(file, analyzeSource(readFileSync(file, 'utf8'), relative(pkgDir, file).split(sep).join('/'))); return cache.get(file); };
  const entry = join(pkgDir, entryFile);
  if (!existsSync(entry)) return [];

  /** Find `exported` in `file`: the declaration, or null. */
  /** The declaration under the name it is exported as (an alias shows in its signature too). */
  const renamed = (d, to) => (d.name === to ? d : { ...d, name: to, signature: d.signature.replace(d.name, to) });
  const find = (file, exported, seen = new Set()) => {
    const key = `${file}:${exported}`;
    if (seen.has(key)) return null; seen.add(key);
    const a = get(file);
    if (a.exported.has(exported)) { const local = a.exported.get(exported); const d = a.decls.get(local); if (d) return renamed(d, exported); }
    for (const r of a.reexports) {
      const target = resolveFile(file, r.from); if (!target) continue;
      if (r.names === '*') { if (r.ns) continue; const hit = find(target, exported, seen); if (hit) return hit; }
      else { const pair = r.names.find(([, ex]) => ex === exported); if (pair) { const hit = find(target, pair[0], seen); if (hit) return renamed(hit, exported); } }
    }
    return null;
  };
  /** Every name a file exports (following `export *`). */
  const namesOf = (file, seen = new Set()) => {
    if (seen.has(file)) return []; seen.add(file);
    const a = get(file), names = [...a.exported.keys()];
    for (const r of a.reexports) {
      const target = resolveFile(file, r.from); if (!target) continue;
      if (r.names === '*') { if (r.ns) names.push(r.ns); else names.push(...namesOf(target, seen)); } else names.push(...r.names.map(([, ex]) => ex));
    }
    return [...new Set(names)];
  };
  const entriesOf = (file) => {
    const out = [];
    const a = get(file);
    for (const name of namesOf(file)) {
      const nsRe = a.reexports.find((r) => r.ns === name);
      if (nsRe) {
        const target = resolveFile(file, nsRe.from), head = target ? headerComment(readFileSync(target, 'utf8')) : '';
        out.push({ name, kind: 'namespace', signature: `namespace ${name}`, doc: head ? { description: head, params: [], returns: null, properties: [], examples: [], throws: [], deprecated: null, internal: false } : null, members: [], entries: target ? entriesOf(target) : [], file: relative(pkgDir, target ?? file).split(sep).join('/'), line: 1 });
        continue;
      }
      const d = find(file, name);
      out.push(d ?? { name, kind: 'constant', signature: name, doc: null, members: [], file: relative(pkgDir, file).split(sep).join('/'), line: 1, unresolved: true });
    }
    return out.filter((e) => !e.doc?.internal).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  };
  const entries = entriesOf(entry);
  // typedefs from every file that contributes an export
  const files = new Set(entries.flatMap((e) => e.file ? [e.file] : []));
  const types = [];
  for (const rel of files) { const f = join(pkgDir, rel); if (existsSync(f)) for (const t of get(f).typedefs) types.push(t); }
  const seenT = new Set();
  const uniqueTypes = types.filter((t) => !seenT.has(t.name) && seenT.add(t.name)).sort((x, y) => (x.name < y.name ? -1 : 1));
  if (uniqueTypes.length) entries.push({ name: '(types)', kind: 'types', types: uniqueTypes, signature: '', doc: null, members: [], file: '', line: 0 });
  return entries;
}

/** The exports of a package's Node-only entry (`src/node.js`), flagged `node: true`; the ones already exported from the main entry are left out. */
function nodeEntries(dir) {
  if (!existsSync(join(dir, 'src', 'node.js'))) return [];
  const main = new Set(publicApi(dir).map((e) => e.name));
  return publicApi(dir, 'src/node.js').filter((e) => e.kind !== 'types' && !main.has(e.name)).map((e) => ({ ...e, node: true }));
}

/** The whole model: every package with its description, version and API. */
export function buildModel(root) {
  const packages = [];
  for (const name of readdirSync(join(root, 'packages')).sort()) {
    const dir = join(root, 'packages', name), pj = join(dir, 'package.json');
    if (!existsSync(pj)) continue;
    const pkg = JSON.parse(readFileSync(pj, 'utf8'));
    packages.push({ name, title: pkg.name ?? `@engine/${name}`, version: pkg.version, description: pkg.description ?? '', bin: pkg.bin ?? null, api: [...publicApi(dir), ...nodeEntries(dir)] });
  }
  return { packages };
}

/** How much of the public API has a description. */
export function coverage(pkg) {
  const flat = [];
  const walk = (es) => { for (const e of es) { if (e.kind === 'types') continue; if (e.kind === 'namespace') { walk(e.entries); continue; } flat.push(e); } };
  walk(pkg.api);
  const documented = flat.filter((e) => e.doc?.description).length;
  return { total: flat.length, documented, missing: flat.filter((e) => !e.doc?.description).map((e) => e.name) };
}

/** Public exports without a description, as `@engine/pkg: name` lines. */
export function undocumented(root) {
  return buildModel(root).packages.flatMap((p) => coverage(p).missing.map((n) => `${p.title}: ${n}`));
}

// ---------- Markdown ----------

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const summary = (doc) => esc((doc?.description ?? '').split(/(?<=[.!?])\s|\n\n/)[0]);
const anchor = (s) => s.toLowerCase().replace(/[^a-z0-9 _-]/g, '').trim().replace(/\s+/g, '-');

function paramsTable(params) {
  if (!params.length) return '';
  return `| Name | Type | Description |\n|---|---|---|\n${params.map((p) => `| \`${esc(p.name)}\`${p.optional ? ' (optional)' : ''} | ${p.type ? `\`${esc(p.type)}\`` : ''} | ${esc(p.description)}${p.default !== undefined ? ` (default \`${esc(p.default)}\`)` : ''} |`).join('\n')}\n`;
}

/** The heading text of an entry: short, so its link is short too. */
const headingOf = (e) => (e.kind === 'class' ? `class ${e.name}` : e.name);

function entryMd(e, level = 3, parent = '') {
  const h = '#'.repeat(level);
  const lines = [];
  lines.push(`${h} \`${parent}${headingOf(e)}\``, '');
  if (e.signature && e.kind !== 'namespace') lines.push('```js', e.signature, '```', '');
  const d = e.doc;
  if (d?.deprecated) lines.push(`> **Deprecated:** ${d.deprecated}`, '');
  if (d?.description) lines.push(d.description, '');
  if (e.kind === 'constant' && e.value) lines.push(`Value: \`${esc(e.value)}\``, '');
  if (d?.params.length) lines.push('**Parameters**', '', paramsTable(d.params));
  if (d?.returns) lines.push(`**Returns** ${d.returns.type ? `\`${esc(d.returns.type)}\`` : ''}${d.returns.description ? ` — ${d.returns.description}` : ''}`, '');
  if (d?.throws.length) lines.push(`**Throws** ${d.throws.join('; ')}`, '');
  for (const ex of d?.examples ?? []) lines.push('**Example**', '', '```js', ex, '```', '');
  if (d?.properties.length) lines.push('**Properties**', '', paramsTable(d.properties));
  if (e.kind === 'class' && e.members.length) {
    for (const m of e.members) {
      lines.push(`${h}# \`${e.name}.${m.name}\``, '', '```js', m.signature, '```', '');
      if (m.doc?.description) lines.push(m.doc.description, '');
      if (m.doc?.params.length) lines.push(paramsTable(m.doc.params));
      if (m.doc?.returns) lines.push(`**Returns** ${m.doc.returns.type ? `\`${esc(m.doc.returns.type)}\`` : ''}${m.doc.returns.description ? ` — ${m.doc.returns.description}` : ''}`, '');
    }
  }
  if (e.kind === 'namespace') for (const sub of e.entries) lines.push(entryMd(sub, level + 1, `${e.name}.`));
  if (e.file) lines.push(`<sub>src/${e.file.replace(/^src\//, '')}:${e.line}</sub>`, '');
  return lines.join('\n');
}

/** One Markdown page for a package. */
export function packageMarkdown(pkg) {
  const cov = coverage(pkg);
  const lines = [`# ${pkg.title}`, '', pkg.description ? `${pkg.description}.` : '', '', '```', `npm install ${pkg.title}`, '```', '', `Version ${pkg.version}. The package's own README ([packages/${pkg.name}](../../packages/${pkg.name}/README.md)) explains how the pieces fit together; this page lists every export.`, ''];
  if (pkg.bin) lines.push(`Command line: ${Object.keys(pkg.bin).map((b) => `\`${b}\``).join(', ')}`, '');
  const groups = [['function', 'Functions'], ['class', 'Classes'], ['constant', 'Constants'], ['namespace', 'Namespaces']];
  const real = pkg.api.filter((e) => e.kind !== 'types');
  const mainEntries = real.filter((e) => !e.node), nodeApi = real.filter((e) => e.node);
  if (!real.length) lines.push('_This package has no JavaScript exports (it is used from the command line)._', '');
  else {
    lines.push(`## Contents (${cov.documented} of ${cov.total} documented)`, '', '| Name | Kind | Summary |', '|---|---|---|');
    for (const e of real) lines.push(`| [\`${e.name}\`](#${anchor(headingOf(e))}) | ${e.kind}${e.node ? ' (Node)' : ''} | ${summary(e.doc)} |`);
    lines.push('');
    for (const [kind, title] of groups) {
      const es = mainEntries.filter((e) => e.kind === kind);
      if (!es.length) continue;
      lines.push(`## ${title}`, '');
      for (const e of es) lines.push(entryMd(e));
    }
    if (nodeApi.length) {
      lines.push(`## Node entry`, '', `These come from \`${pkg.title}/src/node.js\` and use Node's built-in modules, so they are for servers and tools, not browsers.`, '', `\`\`\`js
import { ${nodeApi.slice(0, 3).map((e) => e.name).join(', ')} } from '${pkg.title}/src/node.js';
\`\`\``, '');
      for (const e of nodeApi) lines.push(entryMd(e));
    }
  }
  const types = pkg.api.find((e) => e.kind === 'types');
  if (types) {
    lines.push('## Types', '');
    for (const t of types.types) {
      lines.push(`### \`${t.name}\``, '', t.description ? `${t.description}` : '', '');
      if (t.type) lines.push(`Type: \`${esc(t.type)}\``, '');
      if (t.properties.length) lines.push(paramsTable(t.properties));
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** The index page: every package, what it is, and how well it is documented. */
export function indexMarkdown(model) {
  const lines = ['# API reference', '', 'Generated from the source by `npm run docs` (`tools/api-docs.js`): every export of every package with its JSDoc. Open [index.html](index.html) for a searchable version.', '', '| Package | What it is | Exports | Documented |', '|---|---|---|---|'];
  for (const p of model.packages) { const c = coverage(p); lines.push(`| [\`${p.title}\`](${p.name}.md) | ${esc(p.description)} | ${c.total} | ${c.total ? Math.round((c.documented / c.total) * 100) : 100}% |`); }
  return `${lines.join('\n')}\n`;
}

// ---------- HTML ----------

const he = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inline(s) { return he(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>'); }
function prose(s) {
  if (!s) return '';
  return s.split(/\n\n+/).map((para) => {
    const lines = para.split('\n');
    if (lines.every((l) => /^\s*[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`;
    return `<p>${inline(para.replace(/\n/g, ' '))}</p>`;
  }).join('');
}
const paramsHtml = (ps) => (ps.length ? `<table><tr><th>Name</th><th>Type</th><th>Description</th></tr>${ps.map((p) => `<tr><td><code>${he(p.name)}</code>${p.optional ? ' <i>optional</i>' : ''}</td><td>${p.type ? `<code>${he(p.type)}</code>` : ''}</td><td>${inline(p.description)}${p.default !== undefined ? ` (default <code>${he(p.default)}</code>)` : ''}</td></tr>`).join('')}</table>` : '');

function entryHtml(pkg, e, parent = '') {
  const id = `${pkg.name}.${parent}${e.name}`;
  const d = e.doc;
  let h = `<section class="entry" id="${he(id)}" data-name="${he(`${parent}${e.name}`.toLowerCase())}"><h3><span class="kind">${e.node ? 'node ' : ''}${e.kind}</span> <code>${he(e.signature || e.name)}</code></h3>`;
  if (d?.deprecated) h += `<p class="dep"><b>Deprecated:</b> ${inline(d.deprecated)}</p>`;
  if (d?.description) h += prose(d.description);
  if (e.kind === 'constant' && e.value) h += `<p>Value: <code>${he(e.value)}</code></p>`;
  if (d?.params.length) h += `<h4>Parameters</h4>${paramsHtml(d.params)}`;
  if (d?.returns) h += `<p><b>Returns</b> ${d.returns.type ? `<code>${he(d.returns.type)}</code>` : ''}${d.returns.description ? ` — ${inline(d.returns.description)}` : ''}</p>`;
  for (const ex of d?.examples ?? []) h += `<h4>Example</h4><pre><code>${he(ex)}</code></pre>`;
  if (d?.properties.length) h += `<h4>Properties</h4>${paramsHtml(d.properties)}`;
  if (e.kind === 'class') for (const m of e.members) {
    h += `<div class="member" data-name="${he(`${e.name}.${m.name}`.toLowerCase())}"><h5><code>${he(m.signature)}</code></h5>${prose(m.doc?.description)}${paramsHtml(m.doc?.params ?? [])}${m.doc?.returns ? `<p><b>Returns</b> ${m.doc.returns.type ? `<code>${he(m.doc.returns.type)}</code>` : ''}${m.doc.returns.description ? ` — ${inline(m.doc.returns.description)}` : ''}</p>` : ''}</div>`;
  }
  if (e.kind === 'namespace') h += e.entries.map((s) => entryHtml(pkg, { ...s, signature: `${e.name}.${s.name}` }, `${e.name}.`)).join('');
  if (e.file) h += `<p class="src">src/${he(e.file.replace(/^src\//, ''))}:${e.line}</p>`;
  return `${h}</section>`;
}

const PAGE_CSS = `
:root{--bg:#fff;--fg:#1f2430;--dim:#667085;--line:#e4e7ec;--accent:#2b59d6;--code:#f4f5f8}
@media (prefers-color-scheme:dark){:root{--bg:#15171c;--fg:#dde1ea;--dim:#8d94a5;--line:#2c313b;--accent:#7aa2ff;--code:#1f232b}}
*{box-sizing:border-box}body{margin:0;font:15px/1.55 system-ui,Segoe UI,sans-serif;background:var(--bg);color:var(--fg);display:grid;grid-template-columns:280px 1fr;min-height:100vh}
nav{position:sticky;top:0;height:100vh;overflow:auto;padding:14px;border-right:1px solid var(--line)}nav input{width:100%;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
nav h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:16px 0 4px}nav a{display:block;padding:1px 6px;color:var(--fg);text-decoration:none;border-radius:4px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}nav a:hover{background:var(--code)}nav a.pkg{font-weight:600}
main{padding:24px 40px;max-width:980px}h1{margin-top:0}h2.package{margin-top:48px;border-top:1px solid var(--line);padding-top:20px}code,pre{background:var(--code);border-radius:4px;font:13px ui-monospace,Consolas,monospace}code{padding:1px 4px}pre{padding:10px 12px;overflow:auto}
.entry{margin:22px 0;padding-top:10px;border-top:1px solid var(--line)}.entry h3{font-size:16px;margin:0 0 6px}.kind{font-size:11px;text-transform:uppercase;color:var(--dim);margin-right:6px}.member{margin:10px 0 10px 16px;padding-left:12px;border-left:2px solid var(--line)}.member h5{margin:0 0 2px;font-size:13px}
table{border-collapse:collapse;margin:6px 0;font-size:13px}th,td{border:1px solid var(--line);padding:3px 8px;text-align:left;vertical-align:top}.src{color:var(--dim);font-size:12px;margin:4px 0}.dep{color:#b42318}.hidden{display:none}.meta{color:var(--dim)}
`;
const PAGE_JS = `const q=document.getElementById('q');q.addEventListener('input',()=>{const t=q.value.trim().toLowerCase();document.querySelectorAll('nav a[data-name]').forEach(a=>a.classList.toggle('hidden',!!t&&!a.dataset.name.includes(t)));document.querySelectorAll('.entry').forEach(e=>{const hit=!t||e.dataset.name.includes(t)||[...e.querySelectorAll('.member')].some(m=>m.dataset.name.includes(t));e.classList.toggle('hidden',!hit)});});`;

/** One self-contained HTML page with every package and a search box. */
export function renderHtml(model, { title = 'API reference' } = {}) {
  const nav = model.packages.map((p) => `<h2><a class="pkg" href="#pkg-${p.name}" data-name="${he(p.name)}">${he(p.title)}</a></h2>${p.api.filter((e) => e.kind !== 'types').map((e) => `<a href="#${he(`${p.name}.${e.name}`)}" data-name="${he(`${p.name} ${e.name}`.toLowerCase())}">${he(e.name)}</a>`).join('')}`).join('');
  const body = model.packages.map((p) => {
    const c = coverage(p);
    const types = p.api.find((e) => e.kind === 'types');
    return `<h2 class="package" id="pkg-${p.name}">${he(p.title)} <span class="meta">${he(p.version)}</span></h2><p>${he(p.description)}.</p><p class="meta">${c.documented} of ${c.total} exports have a description. <code>npm install ${he(p.title)}</code></p>${p.api.filter((e) => e.kind !== 'types').map((e) => entryHtml(p, e)).join('')}${types ? `<h3>Types</h3>${types.types.map((t) => `<section class="entry" data-name="${he(t.name.toLowerCase())}" id="${he(`${p.name}.${t.name}`)}"><h3><span class="kind">type</span> <code>${he(t.name)}</code></h3>${prose(t.description)}${paramsHtml(t.properties)}</section>`).join('')}` : ''}`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${he(title)}</title><style>${PAGE_CSS}</style></head><body><nav><input id="q" type="search" placeholder="Search the API" autofocus>${nav}</nav><main><h1>${he(title)}</h1><p class="meta">Generated from the source. ${model.packages.length} packages.</p>${body}</main><script>${PAGE_JS}</script></body></html>\n`;
}

/** Every file of the reference: `{ 'README.md': text, 'core.md': text, …, 'index.html': text }`. */
export function renderAll(model) {
  const files = { 'README.md': indexMarkdown(model), 'index.html': renderHtml(model) };
  for (const p of model.packages) files[`${p.name}.md`] = packageMarkdown(p);
  return files;
}

export function writeAll(root, outDir = join(root, 'docs', 'api')) {
  mkdirSync(outDir, { recursive: true });
  const files = renderAll(buildModel(root));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(outDir, name), text);
  return Object.keys(files);
}

/** Compare the generated files with what is on disk. @returns {string[]} the files that differ or are missing */
export function checkAll(root, outDir = join(root, 'docs', 'api')) {
  const stale = [];
  for (const [name, text] of Object.entries(renderAll(buildModel(root)))) {
    const f = join(outDir, name);
    if (!existsSync(f) || readFileSync(f, 'utf8') !== text) stale.push(name);
  }
  return stale;
}
