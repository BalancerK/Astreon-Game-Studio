// Knowing what a name means: where it is declared, everywhere it is used, and a safe way to give it another name. This is a small reader for the JavaScript the
// studio's projects are written in (functions, classes, const/let/var with patterns, parameters, imports and exports, template strings), not a full parser:
// it keeps strings and comments out of the way, knows blocks, parameters and loops are scopes (so a local `x` is not the `x` of another function), and follows
// `import` and `export` between the project's own files. What it does not understand it leaves alone, and a rename is always shown before it is made.
// Pure functions on text: no page needed, tested in Node.
import { KEYWORDS } from './tokenize.js';

const ID = /[A-Za-z_$][\w$]*/y;
const IMPORT_STATEMENT = new RegExp([
  String.raw`\bimport\s+(?:(?<def>[\w$]+)\s*,?\s*)?`,
  String.raw`(?:\*\s*as\s+(?<ns>[\w$]+)|\{(?<list>[^}]*)\})?`,
  String.raw`\s*from\s*(?<q>["'])(?<src>[^"'\n]+)\k<q>`,
].join(''), 'g');
const IS_ID = /^[A-Za-z_$][\w$]*$/;

/** Replace strings and comments by spaces (same length, same line breaks); code inside `${ }` of a template string stays. */
export function maskText(text) {
  const out = text.split('');
  const n = text.length;
  const blank = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  const frames = [{ tpl: false, depth: 0 }];
  let i = 0;
  while (i < n) {
    const f = frames[frames.length - 1];
    const c = text[i];
    if (f.tpl) {
      if (c === '\\') { blank(i, i + 2); i += 2; continue; }
      if (c === '`') { out[i] = ' '; frames.pop(); i++; continue; }
      if (c === '$' && text[i + 1] === '{') { blank(i, i + 2); frames.push({ tpl: false, depth: 0 }); i += 2; continue; }
      blank(i, i + 1); i++; continue;
    }
    if (c === '/' && text[i + 1] === '/') { const e = text.indexOf('\n', i); const end = e < 0 ? n : e; blank(i, end); i = end; continue; }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; blank(i, end); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      blank(i, j + 1); i = j + 1; continue;
    }
    if (c === '`') { out[i] = ' '; frames.push({ tpl: true, depth: 0 }); i++; continue; }
    if (c === '{') f.depth++;
    else if (c === '}') {
      if (f.depth === 0 && frames.length > 1) { out[i] = ' '; frames.pop(); i++; continue; }
      f.depth--;
    }
    i++;
  }
  return out.join('');
}

const CLOSER = { '(': ')', '[': ']', '{': '}' };

/** The index of the bracket that closes the one at `open` (or -1). `m` is masked text. */
function matchClose(m, open) {
  const want = CLOSER[m[open]];
  let depth = 0;
  for (let i = open; i < m.length; i++) {
    const c = m[i];
    if (c === m[open]) depth++;
    else if (c === want && --depth === 0) return i;
  }
  return -1;
}

/** The index of the bracket that opens the one at `close` (or -1). */
function matchOpen(m, close) {
  const want = { ')': '(', ']': '[', '}': '{' }[m[close]];
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    const c = m[i];
    if (c === m[close]) depth++;
    else if (c === want && --depth === 0) return i;
  }
  return -1;
}

const prevSig = (m, i) => { let k = i - 1; while (k >= 0 && /\s/.test(m[k])) k--; return k; };
const nextSig = (m, i) => { let k = i; while (k < m.length && /\s/.test(m[k])) k++; return k; };

/** The bracket a position is directly inside: '{', '(' or '[' (or '' at the top). */
function enclosingBracket(m, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const c = m[i];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if (c === '(' || c === '[' || c === '{') { if (depth === 0) return c; depth--; }
  }
  return '';
}

/** Names bound by a pattern or a parameter list: `a, b = 1, {c, d: e}, [f, ...g]`. `src` is masked text starting at `offset`. @returns {{name: string, index: number}[]} */
function patternNames(src, offset, isObject = false) {
  const found = [];
  let depth = 0;
  let start = 0;
  const items = [];
  for (let i = 0; i <= src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    if (i === src.length || (c === ',' && depth === 0)) { items.push([start, i]); start = i + 1; }
  }
  for (const [a, b] of items) {
    let text = src.slice(a, b);
    let at = a;
    const lead = text.length - text.trimStart().length;
    text = text.trimStart(); at += lead;
    if (text.startsWith('...')) { text = text.slice(3); at += 3; }
    if (isObject) {
      let d = 0;
      for (let k = 0; k < text.length; k++) {
        const c = text[k];
        if (c === '(' || c === '[' || c === '{') d++;
        else if (c === ')' || c === ']' || c === '}') d--;
        else if (c === ':' && d === 0) { text = text.slice(k + 1); at += k + 1; break; }
        else if (c === '=' && d === 0) break;
      }
      const l2 = text.length - text.trimStart().length;
      text = text.trimStart(); at += l2;
    }
    if (text[0] === '{' || text[0] === '[') {
      const close = matchClose(text, 0);
      if (close > 0) found.push(...patternNames(text.slice(1, close), offset + at + 1, text[0] === '{'));
      continue;
    }
    ID.lastIndex = 0;
    const m = ID.exec(text);
    if (m && !KEYWORDS.has(m[0])) found.push({ name: m[0], index: offset + at });
  }
  return found;
}

/** The names a `const` / `let` / `var` statement declares, starting right after the keyword. */
function declarators(m, from) {
  const found = [];
  let i = from;
  for (;;) {
    i = nextSig(m, i);
    if (m[i] === '{' || m[i] === '[') {
      const close = matchClose(m, i);
      if (close < 0) break;
      found.push(...patternNames(m.slice(i + 1, close), i + 1, m[i] === '{'));
      i = close + 1;
    } else {
      ID.lastIndex = i;
      const id = ID.exec(m);
      if (!id) break;
      if (!KEYWORDS.has(id[0])) found.push({ name: id[0], index: i });
      i += id[0].length;
    }
    // skip the initializer: to the next comma at depth 0 (another name follows), or the end of the statement
    let depth = 0;
    let last = '';
    let more = false;
    for (; i < m.length; i++) {
      const c = m[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
      else if (depth === 0 && c === ';') break;
      else if (depth === 0 && c === ',') { more = true; i++; break; }
      else if (depth === 0 && c === '\n' && last && !',=+-*/%&|^?:<>.([{'.includes(last) && !/^\s*[?:.+\-*/%&|^<>=,]/.test(m.slice(i, i + 40))) break;
      else if (depth === 0 && /^\s(?:of|in)\s/.test(m.slice(i, i + 5))) break;
      if (!/\s/.test(c)) last = c;
    }
    if (!more) break;
  }
  return found;
}

/**
 * Read one file.
 * @param {string} text
 */
export function indexFile(text) {
  const m = maskText(text);
  const n = m.length;
  const lineStarts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const position = (index) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= index) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, column: index - lineStarts[lo] + 1 };
  };
  const scopes = [{ start: 0, end: n }];
  const decls = [];
  const scopeOf = (index) => {
    let best = 0;
    for (let s = 1; s < scopes.length; s++) {
      const sc = scopes[s];
      if (sc.start <= index && index <= sc.end && sc.end - sc.start < scopes[best].end - scopes[best].start) best = s;
    }
    return best;
  };
  const addScope = (start, end) => scopes.push({ start, end }) - 1;
  const declare = (name, index, kind, scope, extra = {}) => decls.push({ name, index, kind, scope, exported: false, ...extra });

  // blocks are scopes
  const stack = [];
  for (let i = 0; i < n; i++) {
    if (m[i] === '{') stack.push(i);
    else if (m[i] === '}' && stack.length) addScope(stack.pop(), i);
  }
  const blockEndAfter = (i) => { const k = nextSig(m, i); return m[k] === '{' ? matchClose(m, k) : -1; };

  // functions: the name belongs outside, the parameters inside
  for (const f of m.matchAll(/\bfunction\b\s*\*?\s*(?<name>[A-Za-z_$][\w$]*)?\s*\(/g)) {
    const open = f.index + f[0].length - 1;
    const close = matchClose(m, open);
    if (close < 0) continue;
    const bodyEnd = blockEndAfter(close + 1);
    const scope = addScope(open, bodyEnd < 0 ? close : bodyEnd);
    if (f.groups.name) {
      const at = f.index + f[0].indexOf(f.groups.name, 8);
      const before = m.slice(Math.max(0, f.index - 40), f.index);
      declare(f.groups.name, at, 'function', scopeOf(f.index), { exported: /\bexport\s+(?:default\s+)?(?:async\s+)?$/.test(before) });
    }
    for (const p of patternNames(m.slice(open + 1, close), open + 1)) declare(p.name, p.index, 'parameter', scope);
  }
  // arrow functions
  for (const a of m.matchAll(/=>/g)) {
    const before = prevSig(m, a.index);
    let params = [];
    let start = before;
    if (m[before] === ')') {
      const open = matchOpen(m, before);
      if (open < 0) continue;
      start = open;
      params = patternNames(m.slice(open + 1, before), open + 1);
    } else {
      let b = before;
      while (b >= 0 && /[\w$]/.test(m[b])) b--;
      start = b + 1;
      if (start <= before) params = [{ name: m.slice(start, before + 1), index: start }];
    }
    const k = nextSig(m, a.index + 2);
    let end;
    if (m[k] === '{') end = matchClose(m, k);
    else {
      let depth = 0;
      end = n;
      for (let i = k; i < n; i++) {
        const c = m[i];
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') { if (depth === 0) { end = i; break; } depth--; }
        else if (depth === 0 && (c === ',' || c === ';')) { end = i; break; }
      }
    }
    if (end < 0) continue;
    const scope = addScope(start, end);
    for (const p of params) if (!KEYWORDS.has(p.name)) declare(p.name, p.index, 'parameter', scope);
  }
  // methods in classes and objects: `update(dt) {`
  for (const f of m.matchAll(/(?<![\w$.])(?:async\s+|static\s+|get\s+|set\s+)*(?<name>[A-Za-z_$][\w$]*)\s*\(/g)) {
    if (KEYWORDS.has(f.groups.name)) continue;
    const open = f.index + f[0].length - 1;
    const close = matchClose(m, open);
    if (close < 0) continue;
    const k = nextSig(m, close + 1);
    if (m[k] !== '{' || enclosingBracket(m, f.index) !== '{' || /function\s*\*?\s*$/.test(m.slice(Math.max(0, f.index - 20), f.index))) continue;
    const end = matchClose(m, k);
    if (end < 0) continue;
    const scope = addScope(open, end);
    for (const p of patternNames(m.slice(open + 1, close), open + 1)) declare(p.name, p.index, 'parameter', scope);
  }
  // for (...) and catch (...)
  for (const f of m.matchAll(/\b(?:for|catch)\b\s*(?:await\s*)?\(/g)) {
    const open = f.index + f[0].length - 1;
    const close = matchClose(m, open);
    if (close < 0) continue;
    const bodyEnd = blockEndAfter(close + 1);
    const scope = addScope(open, bodyEnd < 0 ? close : bodyEnd);
    if (f[0].startsWith('catch')) for (const p of patternNames(m.slice(open + 1, close), open + 1)) declare(p.name, p.index, 'parameter', scope);
  }
  // classes
  for (const c of m.matchAll(/\bclass\s+(?<name>[A-Za-z_$][\w$]*)/g)) {
    const before = m.slice(Math.max(0, c.index - 30), c.index);
    const exported = /\bexport\s+(?:default\s+)?$/.test(before);
    declare(c.groups.name, c.index + c[0].length - c.groups.name.length, 'class', scopeOf(c.index), { exported });
  }
  // variables
  for (const v of m.matchAll(/\b(?:const|let|var)\b/g)) {
    const before = m.slice(Math.max(0, v.index - 30), v.index);
    const exported = /\bexport\s+$/.test(before);
    const scope = scopeOf(v.index);
    for (const d of declarators(m, v.index + v[0].length)) declare(d.name, d.index, 'variable', scope, { exported });
  }
  // imports and exports
  const imports = [];
  const exportList = [];
  const inCode = (i) => m[i] !== ' ' || text[i] === ' ';
  const spec = [];
  for (const im of text.matchAll(IMPORT_STATEMENT)) {
    if (!inCode(im.index) || m.slice(im.index, im.index + 6) !== 'import') continue;
    const end = im.index + im[0].length;
    spec.push([im.index, end]);
    const base = { source: im.groups.src, stmtStart: im.index, stmtEnd: end };
    if (im.groups.def) {
      const at = im.index + im[0].indexOf(im.groups.def, 6);
      imports.push({ ...base, imported: 'default', local: im.groups.def, importedIndex: at, localIndex: at });
    }
    if (im.groups.ns) {
      const at = im.index + im[0].lastIndexOf(im.groups.ns);
      imports.push({ ...base, imported: '*', local: im.groups.ns, importedIndex: at, localIndex: at });
    }
    if (im.groups.list !== undefined) {
      const listAt = im.index + im[0].indexOf('{') + 1;
      for (const e of im.groups.list.matchAll(/([\w$]+)(?:\s+as\s+([\w$]+))?/g)) {
        const importedIndex = listAt + e.index;
        const localIndex = e[2] ? listAt + e.index + e[0].length - e[2].length : importedIndex;
        imports.push({ ...base, imported: e[1], local: e[2] ?? e[1], importedIndex, localIndex });
      }
    }
  }
  for (const imp of imports) declare(imp.local, imp.localIndex, 'import', 0, { import: imp });
  for (const ex of text.matchAll(/\bexport\s*\{(?<list>[^}]*)\}(?:\s*from\s*(?<q>["'])(?<src>[^"'\n]+)\k<q>)?/g)) {
    if (!inCode(ex.index) || m.slice(ex.index, ex.index + 6) !== 'export') continue;
    const end = ex.index + ex[0].length;
    spec.push([ex.index, end]);
    const listAt = ex.index + ex[0].indexOf('{') + 1;
    for (const e of ex.groups.list.matchAll(/([\w$]+)(?:\s+as\s+([\w$]+))?/g)) {
      const localIndex = listAt + e.index;
      const exportedIndex = e[2] ? listAt + e.index + e[0].length - e[2].length : localIndex;
      exportList.push({ local: e[1], exported: e[2] ?? e[1], localIndex, exportedIndex, source: ex.groups.src ?? null });
    }
  }
  const reexportAll = [];
  for (const ex of text.matchAll(/\bexport\s*\*\s*from\s*(["'])([^"'\n]+)\1/g)) {
    if (inCode(ex.index) && m.slice(ex.index, ex.index + 6) === 'export') reexportAll.push(ex[2]);
  }
  const inSpec = (i) => spec.some(([a, b]) => i >= a && i < b);

  // every use of a name
  const occurrences = [];
  for (const w of m.matchAll(/(?<![\w$])[A-Za-z_$][\w$]*/g)) {
    const name = w[0];
    if (KEYWORDS.has(name) || inSpec(w.index)) continue;
    const before = prevSig(m, w.index);
    const after = nextSig(m, w.index + name.length);
    if (m[before] === '.' && m[before - 1] !== '.') continue;                                                         // obj.name
    const open = m[before] === '{' || m[before] === ',';
    if (open && m[after] === ':' && m[after + 1] !== ':' && enclosingBracket(m, w.index) === '{') continue;          // { name: 1 }
    const shorthand = open && (m[after] === ',' || m[after] === '}') && enclosingBracket(m, w.index) === '{';
    occurrences.push({ name, index: w.index, end: w.index + name.length, shorthand });
  }

  // `a.b`: the name after a dot. What it means depends on what `a` is: a namespace import (`import * as ns`), or `this` inside a class.
  const members = [];
  for (const w of m.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    if (inSpec(w.index) || (KEYWORDS.has(w[1]) && w[1] !== 'this')) continue;
    const at = w.index + w[0].length - w[2].length;
    members.push({ object: w[1], objectIndex: w.index, name: w[2], index: at, end: at + w[2].length });
  }
  // classes (where each body is) and the methods at the top of a body
  const classes = [];
  for (const c of m.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)[^{]*\{/g)) {
    const open = c.index + c[0].length - 1;
    const end = matchClose(m, open);
    if (end > open) classes.push({ name: c[1], start: open, end });
  }
  const methods = [];
  for (const cls of classes) {
    const body = m.slice(cls.start + 1, cls.end);
    for (const f of body.matchAll(/(?<![\w$.])(?:(?:static|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\(/dg)) {
      if (KEYWORDS.has(f[1])) continue;
      const at = cls.start + 1 + f.indices[1][0];
      const smallest = scopes.slice(1).filter((sc) => sc.start < at && at < sc.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
      if (smallest?.start === cls.start) methods.push({ name: f[1], index: at, cls });
    }
  }

  /** The declaration a name refers to at a position: the innermost scope that declares it wins. */
  const resolve = (name, index) => {
    const chain = [];
    for (let s = 0; s < scopes.length; s++) if (scopes[s].start <= index && index <= scopes[s].end) chain.push(s);
    chain.sort((a, b) => (scopes[a].end - scopes[a].start) - (scopes[b].end - scopes[b].start));
    for (const s of chain) {
      const d = decls.find((x) => x.scope === s && x.name === name);
      if (d) return d;
    }
    return null;
  };
  const classAt = (index) => classes.filter((c) => c.start < index && index < c.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0] ?? null;
  return {
    text, masked: m, position, scopes, decls, imports, exportList, reexportAll, occurrences, members, classes, methods, classAt, resolve, scopeOf,
  };
}

// ---------- the project: several files that import each other ----------

const cache = new Map();                     // path -> {text, ix}: reading a file again is free until its text changes
function file(files, path) {
  const text = files[path];
  if (typeof text !== 'string') return null;
  const hit = cache.get(path);
  if (hit && hit.text === text) return hit.ix;
  const ix = indexFile(text);
  cache.set(path, { text, ix });
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  return ix;
}

/** Which of the project's files a relative import points at (or null: a package or something missing). */
export function resolveImport(files, from, source) {
  if (!source.startsWith('.')) return null;
  const parts = from.split('/').slice(0, -1);
  for (const seg of source.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  const base = parts.join('/');
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`]) if (typeof files[candidate] === 'string') return candidate;
  return null;
}

/** The declaration a file exports under a name (following `export { a as b }` and re-exports). */
function exportedDecl(files, path, name, seen = new Set()) {
  if (seen.has(`${path}:${name}`)) return null;
  seen.add(`${path}:${name}`);
  const ix = file(files, path);
  if (!ix) return null;
  const direct = ix.decls.find((d) => d.exported && d.name === name && d.scope === 0);
  if (direct) return { path, decl: direct };
  const entry = ix.exportList.find((e) => e.exported === name);
  if (!entry) {
    for (const source of ix.reexportAll) {                                   // export * from './other.js'
      const target = resolveImport(files, path, source);
      const found = target ? exportedDecl(files, target, name, seen) : null;
      if (found) return found;
    }
    return null;
  }
  if (entry.source) {
    const target = resolveImport(files, path, entry.source);
    return target ? exportedDecl(files, target, entry.local, seen) : null;
  }
  const local = ix.decls.find((d) => d.name === entry.local && d.scope === 0);
  return local ? homeOf(files, path, local, seen) : null;
}

/** Follow an import to the declaration it really is: `{path, decl}`, `{external: {source, name}}` or null. */
function homeOf(files, path, decl, seen = new Set()) {
  if (decl.kind !== 'import') return { path, decl };
  const target = resolveImport(files, path, decl.import.source);
  if (!target) return { external: { source: decl.import.source, name: decl.import.imported } };
  if (decl.import.imported === '*') return { path, decl };
  return exportedDecl(files, target, decl.import.imported, seen) ?? null;
}

/**
 * The class a variable holds an instance of, when it can be told from where the variable is made: `const ship = new Ship(...)`, with the class in this
 * file or imported from another file of the project. Anything else (a function's result, a parameter) is not known, and gives null.
 * @returns {{path: string, cls: {name: string, start: number, end: number}} | null}
 */
function instanceClass(files, path, ix, member) {
  const d = ix.resolve(member.object, member.objectIndex);
  if (!d || d.kind !== 'variable') return null;
  const after = ix.masked.slice(d.index + d.name.length, d.index + d.name.length + 80);
  const made = /^\s*=\s*new\s+([A-Za-z_$][\w$]*)\s*\(/.exec(after);
  if (!made) return null;
  const name = made[1];
  const here = ix.classes.find((c) => c.name === name);
  if (here && ix.decls.some((x) => x.kind === 'class' && x.name === name)) return { path, cls: here };
  const decl = ix.resolve(name, d.index);
  const home = decl ? homeOf(files, path, decl) : null;
  if (!home || home.external || home.decl.kind !== 'class') return null;
  const cls = file(files, home.path)?.classes.find((c) => c.name === home.decl.name);
  return cls ? { path: home.path, cls } : null;
}

/** What is at a position: a use of a name, or a name in an import or export list. */
function useAt(ix, index, files = null, path = '') {
  const method = ix.methods.find((x) => index >= x.index && index <= x.index + x.name.length);
  if (method) return { kind: 'this', name: method.name, index: method.index, cls: method.cls };
  const member = ix.members.find((x) => index >= x.index && index <= x.end);
  if (member?.object === 'this') {
    const cls = ix.classAt(member.index);
    if (cls) return { kind: 'this', name: member.name, index: member.index, cls };
  } else if (member) {
    const ns = ix.resolve(member.object, member.objectIndex);
    if (ns?.kind === 'import' && ns.import.imported === '*') return { kind: 'member', name: member.name, index: member.index, ns };
    const inst = files ? instanceClass(files, path, ix, member) : null;                // ship.fire(), where ship = new Ship()
    if (inst) return { kind: 'instance', name: member.name, index: member.index, classPath: inst.path, cls: inst.cls };
  }
  const occ = ix.occurrences.find((o) => o.index <= index && index <= o.end);
  if (occ) return { kind: 'use', name: occ.name, index: occ.index };
  for (const imp of ix.imports) {
    for (const [at, name] of [[imp.importedIndex, imp.imported], [imp.localIndex, imp.local]]) {
      if (index >= at && index <= at + name.length) return { kind: 'import', name: imp.local, index: imp.localIndex, import: imp };
    }
  }
  for (const ex of ix.exportList) {
    if (index >= ex.localIndex && index <= ex.localIndex + ex.local.length) return { kind: 'export', name: ex.local, index: ex.localIndex };
  }
  return null;
}

/** Where `this.name` is declared inside a class: the method, or else the first place the class sets the property. */
function thisDeclaration(ix, at) {
  const method = ix.methods.find((x) => x.cls === at.cls && x.name === at.name);
  if (method) return { index: method.index, declKind: 'method' };
  const first = ix.members.find((x) => x.object === 'this' && x.name === at.name && at.cls.start < x.index && x.index < at.cls.end);
  return first ? { index: first.index, declKind: 'property' } : null;
}

/** The name at (or right before) a position in a text, for commands that act on "the word under the cursor". */
export function nameAt(text, index) {
  const w = (c) => c !== undefined && /[\w$]/.test(c);
  let a = index;
  let b = index;
  while (a > 0 && w(text[a - 1])) a--;
  while (b < text.length && w(text[b])) b++;
  const name = text.slice(a, b);
  return IS_ID.test(name) ? { name, from: a, to: b } : null;
}

const where = (files, path, index) => ({ path, index, ...file(files, path).position(index) });

/**
 * Where the name at a position is declared.
 * @returns {{kind: 'local', path: string, index: number, line: number, column: number, name: string, declKind: string} | {kind: 'external', source: string, name: string} | null}
 */
export function definitionAt(files, path, index) {
  const ix = file(files, path);
  const at = ix && useAt(ix, index, files, path);
  if (!at) return null;
  if (at.kind === 'instance') {
    const own = thisDeclaration(file(files, at.classPath), at);
    return own ? { kind: 'local', ...where(files, at.classPath, own.index), name: at.name, declKind: own.declKind } : null;
  }
  if (at.kind === 'this') {
    const own = thisDeclaration(ix, at);
    return own ? { kind: 'local', ...where(files, path, own.index), name: at.name, declKind: own.declKind } : null;
  }
  if (at.kind === 'member') {
    const target = resolveImport(files, path, at.ns.import.source);
    if (!target) return { kind: 'external', source: at.ns.import.source, name: at.name };
    const found = exportedDecl(files, target, at.name);
    return found ? { kind: 'local', ...where(files, found.path, found.decl.index), name: found.decl.name, declKind: found.decl.kind } : null;
  }
  const decl = at.kind === 'import' ? ix.decls.find((d) => d.kind === 'import' && d.import === at.import) : ix.resolve(at.name, at.index);
  if (!decl) return null;
  const home = homeOf(files, path, decl);
  if (!home) return { kind: 'local', ...where(files, path, decl.index), name: decl.name, declKind: decl.kind };
  if (home.external) return { kind: 'external', ...home.external };
  return { kind: 'local', ...where(files, home.path, home.decl.index), name: home.decl.name, declKind: home.decl.kind };
}

/**
 * Every place the name at a position is used, in every file, with the name it has there.
 * @returns {{name: string, home: {path: string, index: number}, uses: {path: string, index: number, end: number, line: number, column: number, text: string,
 *   role: 'declaration' | 'use' | 'import' | 'export' | 'alias', shorthand?: boolean, aliased?: boolean}[]} | {external: {source: string, name: string}} | null}
 */
export function referencesAt(files, path, index) {
  const ix = file(files, path);
  const at = ix && useAt(ix, index, files, path);
  if (!at) return null;
  if (at.kind === 'instance') {                                      // ship.fire: the same thing as fire in the class it comes from
    const own = thisDeclaration(file(files, at.classPath), at);
    return own ? referencesAt(files, at.classPath, own.index) : null;
  }
  const uses = [];
  const lineOf = (p, i) => {
    const f = file(files, p);
    const pos = f.position(i);
    return { ...pos, text: f.text.split('\n')[pos.line - 1].trim().slice(0, 200) };
  };
  const push = (p, o) => uses.push({ path: p, ...lineOf(p, o.index), ...o });
  if (at.kind === 'this') {                                          // a method or property of a class, used as this.name inside it
    const own = thisDeclaration(ix, at);
    if (!own) return null;
    const method = ix.methods.find((x) => x.cls === at.cls && x.name === at.name);
    if (method) push(path, { index: method.index, end: method.index + method.name.length, role: 'declaration' });
    for (const x of ix.members) {
      const mine = x.object === 'this' && x.name === at.name && at.cls.start < x.index && x.index < at.cls.end;
      if (mine) push(path, { index: x.index, end: x.end, role: 'member' });
    }
    // and the places that call it on a variable made with `new` (in any file)
    for (const p of Object.keys(files)) {
      const f = file(files, p);
      if (!f) continue;
      for (const x of f.members) {
        if (x.object === 'this' || x.name !== at.name) continue;
        const inst = instanceClass(files, p, f, x);
        if (inst && inst.path === path && inst.cls.start === at.cls.start) push(p, { index: x.index, end: x.end, role: 'member' });
      }
    }
    uses.sort((a, b) => a.path.localeCompare(b.path) || a.index - b.index);
    return { name: at.name, home: { path, index: own.index }, uses, scope: `the class ${at.cls.name}`, cls: at.cls };
  }
  let decl;
  let home;
  if (at.kind === 'member') {                                        // ns.name, where ns is `import * as ns`
    const target = resolveImport(files, path, at.ns.import.source);
    if (!target) return { external: { source: at.ns.import.source, name: at.name } };
    home = exportedDecl(files, target, at.name);
    if (!home) return null;
  } else {
    decl = at.kind === 'import' ? ix.decls.find((d) => d.kind === 'import' && d.import === at.import) : ix.resolve(at.name, at.index);
    if (!decl) return null;
    home = homeOf(files, path, decl);
  }
  if (!home) return null;
  if (home.external) return { external: home.external };
  const homeIx = file(files, home.path);
  const usesIn = (p, d, role) => {
    for (const o of file(files, p).occurrences) {
      if (file(files, p).resolve(o.name, o.index) !== d) continue;
      push(p, { index: o.index, end: o.end, role: o.index === d.index ? 'declaration' : role, shorthand: o.shorthand });
    }
  };
  usesIn(home.path, home.decl, 'use');
  // the name it is exported under, and who imports it
  const entries = homeIx.exportList.filter((e) => !e.source && e.local === home.decl.name);
  for (const e of entries) {
    push(home.path, { index: e.localIndex, end: e.localIndex + e.local.length, role: 'export', aliased: e.exported !== e.local });
  }
  const names = new Set(entries.map((e) => e.exported));
  if (home.decl.exported) names.add(home.decl.name);
  if (names.size) {
    for (const p of Object.keys(files)) {
      const f = file(files, p);
      if (!f) continue;
      for (const imp of f.imports) {
        if (!names.has(imp.imported) || resolveImport(files, p, imp.source) !== home.path) continue;
        const aliased = imp.imported !== imp.local;
        const sameName = imp.imported === home.decl.name;                    // imported under the name being used: a rename changes it
        push(p, { index: imp.importedIndex, end: imp.importedIndex + imp.imported.length, role: sameName ? 'import' : 'alias', aliased });
        const local = f.decls.find((d) => d.kind === 'import' && d.import === imp);
        if (local) usesIn(p, local, aliased || !sameName ? 'alias' : 'use');
      }
      // `import * as ns from home`: every ns.name is a use of the exported name
      for (const imp of f.imports.filter((i) => i.imported === '*' && resolveImport(files, p, i.source) === home.path)) {
        const local = f.decls.find((d) => d.kind === 'import' && d.import === imp);
        for (const x of f.members) {
          if (x.object !== imp.local || !names.has(x.name) || f.resolve(x.object, x.objectIndex) !== local) continue;
          push(p, { index: x.index, end: x.end, role: 'member', members: imp.local });
        }
      }
    }
  }
  const seen = new Set();
  const unique = uses.filter((u) => { const k = `${u.path}:${u.index}`; if (seen.has(k)) return false; seen.add(k); return true; });
  unique.sort((a, b) => a.path.localeCompare(b.path) || a.index - b.index);
  return { name: home.decl.name, home: { path: home.path, index: home.decl.index }, uses: unique };
}

/** Top-level things a file declares (for an outline and for "go to symbol"). */
export function symbolsOf(files, path) {
  const ix = file(files, path);
  if (!ix) return [];
  return ix.decls.filter((d) => d.scope === 0 && d.kind !== 'import' && d.kind !== 'parameter')
    .map((d) => ({ name: d.name, kind: d.kind, path, exported: d.exported, ...ix.position(d.index), index: d.index }))
    .sort((a, b) => a.index - b.index);
}

/**
 * Plan giving the name at a position another name, everywhere it is used. Nothing is changed: the result lists the edits and any clash, to be shown first.
 * @returns {{error: string} | {name: string, newName: string, edits: {path: string, from: number, to: number, text: string}[], files: number, clashes: string[]}}
 */
export function planRename(files, path, index, newName) {
  if (!IS_ID.test(newName)) return { error: 'A name starts with a letter, _ or $ and has only letters, digits, _ and $ in it.' };
  if (KEYWORDS.has(newName)) return { error: `“${newName}” is a word JavaScript keeps for itself.` };
  const refs = referencesAt(files, path, index);
  if (!refs) return { error: 'Nothing here to rename. Put the cursor on a name that is declared in this project.' };
  if (refs.external) return { error: `“${refs.external.name}” comes from ${refs.external.source}: it can be used here but not renamed.` };
  if (newName === refs.name) return { error: 'That is the name it already has.' };
  const edits = [];
  const clashes = [];
  for (const u of refs.uses) {
    if (u.role === 'alias') continue;                                      // `import { a as b }`: the uses of b keep their name
    if (u.role === 'import' && u.aliased) { edits.push({ path: u.path, from: u.index, to: u.end, text: newName }); continue; }
    if (u.role === 'export' && u.aliased) { edits.push({ path: u.path, from: u.index, to: u.end, text: newName }); continue; }
    edits.push({ path: u.path, from: u.index, to: u.end, text: u.shorthand ? `${refs.name}: ${newName}` : newName });
    if (u.role !== 'import' && u.role !== 'export' && u.role !== 'member' && !refs.cls) {
      const clash = file(files, u.path).resolve(newName, u.index);
      if (clash) clashes.push(`${u.path} line ${file(files, u.path).position(clash.index).line} already has a ${clash.kind} called ${newName}`);
    }
  }
  if (refs.cls) {                                                      // a class's own names: another method or property already called that
    const here = file(files, refs.home.path);
    const taken = here.methods.find((x) => x.cls === refs.cls && x.name === newName)
      ?? here.members.find((x) => x.object === 'this' && x.name === newName && refs.cls.start < x.index && x.index < refs.cls.end);
    if (taken) {
      const what = taken.cls ? 'method' : 'property';
      clashes.push(`${refs.cls.name} already has a ${what} called ${newName} (line ${here.position(taken.index).line})`);
    }
    edits.sort((a, b) => a.path.localeCompare(b.path) || a.from - b.from);
    return { name: refs.name, newName, edits, files: new Set(edits.map((e) => e.path)).size, clashes, scope: refs.scope };
  }
  const exported = exportedDecl(files, refs.home.path, newName);
  if (exported && refs.uses.some((u) => u.role === 'member')) clashes.push(`${refs.home.path} already exports something called ${newName}`);
  const home = file(files, refs.home.path);
  const same = home.decls.find((d) => d.name === newName && d.scope === home.decls.find((x) => x.index === refs.home.index).scope);
  if (same && !clashes.length) clashes.push(`${refs.home.path} line ${home.position(same.index).line} already has a ${same.kind} called ${newName}`);
  edits.sort((a, b) => a.path.localeCompare(b.path) || a.from - b.from);
  return { name: refs.name, newName, edits, files: new Set(edits.map((e) => e.path)).size, clashes: [...new Set(clashes)] };
}

/** Make the edits of a plan. @returns {Record<string, string>} the new text of each file that changed */
export function applyEdits(files, edits) {
  const byPath = new Map();
  for (const e of edits) (byPath.get(e.path) ?? byPath.set(e.path, []).get(e.path)).push(e);
  const out = {};
  for (const [p, list] of byPath) {
    let text = files[p];
    for (const e of list.sort((a, b) => b.from - a.from)) text = text.slice(0, e.from) + e.text + text.slice(e.to);
    out[p] = text;
  }
  return out;
}
