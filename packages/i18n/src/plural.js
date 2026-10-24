// Plural rules written the gettext way: `nplurals=2; plural=(n != 1);` in a .po file's header says how many forms a language has and which form a count uses.
// The expression is read by a small parser and turned into a function (nothing is ever passed to eval), so a translator's file cannot run code.

const TOKEN = /\s*(?:(\d+)|(&&|\|\||==|!=|<=|>=|[-+*/%<>!?:()])|(n))/y;

/**
 * Turn a gettext plural expression (`n != 1`, `n%10==1 && n%100!=11 ? 0 : 1`, ...) into a function from a count to a form number.
 * Only `n`, whole numbers, `( ) ! * / % + - < > <= >= == != && || ? :` are allowed.
 * @param {string} source
 * @returns {(n: number) => number}
 */
export function parsePluralExpression(source) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  const text = String(source).trim();
  let at = 0;
  while (at < text.length) {
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(text);
    if (!m) throw new Error(`plural rule "${source}": cannot read "${text.slice(at, at + 8)}" (allowed: n, numbers, ( ) ! * / % + - < > <= >= == != && || ? :)`);
    tokens.push(m[1] !== undefined ? { num: Number(m[1]) } : m[3] ? { n: true } : { op: m[2] });
    at = TOKEN.lastIndex;
    while (text[at] === ' ') at++;
  }
  let i = 0;
  const peek = () => tokens[i], isOp = (o) => tokens[i]?.op === o;
  const need = (o) => { if (!isOp(o)) throw new Error(`plural rule "${source}": expected "${o}"`); i++; };
  // each parse function returns a closure of n; precedence follows C
  function primary() {
    const t = tokens[i++];
    if (!t) throw new Error(`plural rule "${source}": ends too early`);
    if (t.num !== undefined) return () => t.num;
    if (t.n) return (n) => n;
    if (t.op === '(') { const e = ternary(); need(')'); return e; }
    if (t.op === '!') { const e = primary(); return (n) => (e(n) ? 0 : 1); }
    if (t.op === '-') { const e = primary(); return (n) => -e(n); }
    throw new Error(`plural rule "${source}": unexpected "${t.op}"`);
  }
  const level = (next, ops) => () => {
    let left = next();
    while (peek()?.op && ops[peek().op]) {
      const f = ops[tokens[i++].op], l = left, r = next();
      left = (n) => f(l(n), r(n));
    }
    return left;
  };
  const mul = level(primary, { '*': (a, b) => a * b, '/': (a, b) => Math.floor(a / b), '%': (a, b) => (b === 0 ? 0 : a % b) });
  const add = level(mul, { '+': (a, b) => a + b, '-': (a, b) => a - b });
  const rel = level(add, { '<': (a, b) => +(a < b), '>': (a, b) => +(a > b), '<=': (a, b) => +(a <= b), '>=': (a, b) => +(a >= b) });
  const eq = level(rel, { '==': (a, b) => +(a === b), '!=': (a, b) => +(a !== b) });
  const and = level(eq, { '&&': (a, b) => +(a !== 0 && b !== 0) });
  const or = level(and, { '||': (a, b) => +(a !== 0 || b !== 0) });
  function ternary() {
    const c = or();
    if (!isOp('?')) return c;
    i++;
    const a = ternary(); need(':'); const b = ternary();
    return (n) => (c(n) ? a(n) : b(n));
  }
  const fn = ternary();
  if (i < tokens.length) throw new Error(`plural rule "${source}": unexpected "${tokens[i].op ?? tokens[i].num}"`);
  return (n) => { const r = fn(Math.floor(Math.abs(n))); return r > 0 ? Math.floor(r) : 0; };
}

/** Read a header's `Plural-Forms` line: `{ count, index }` where `index(n)` is the form for a count. */
export function parsePluralForms(line) {
  const m = /nplurals\s*=\s*(\d+)\s*;\s*plural\s*=\s*([^;]+)/.exec(String(line));
  if (!m) throw new Error(`cannot read Plural-Forms "${line}" (expected "nplurals=2; plural=(n != 1);")`);
  const count = Number(m[1]), expr = parsePluralExpression(m[2]);
  return { count, index: (n) => { const r = expr(n); return r < count ? r : count - 1; } };
}

const CATEGORY_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * The plural rules of a language from the CLDR data the platform ships (`Intl.PluralRules`): `categories` in the order zero, one, two, few, many, other
 * (only the ones the language uses), `select(n)` giving the category name and `index(n)` the position in `categories` (what a list of forms is indexed by).
 */
export function cldrRules(language) {
  let pr;
  try { pr = new Intl.PluralRules(language); } catch { pr = new Intl.PluralRules('en'); }
  const used = new Set(pr.resolvedOptions().pluralCategories);
  const categories = CATEGORY_ORDER.filter((c) => used.has(c));
  return { categories, select: (n) => pr.select(n), index: (n) => categories.indexOf(pr.select(n)) };
}
