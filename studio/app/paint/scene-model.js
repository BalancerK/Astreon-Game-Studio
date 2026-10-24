// The 2D scene editor's logic, with no page in it: a scene is the things of a level placed freely (a kind, a position, a size, how it looks, and any extra
// fields), kept as a file that a game loads with `loadScene`. Everything you can do to one (add, move, resize, duplicate, delete, reorder) is a plain function
// that returns a new scene, so undo is a list of earlier scenes. The file is a JavaScript module that holds a JSON object, like the sprite files:
//
//   export default { "w": 480, "h": 320, "things": [ { "kind": "coin", "x": 100, "y": 60, "w": 16, "h": 16, "color": "#ffd23c" } ] };

export const SCENE_LIMITS = { things: 500, min: 64, max: 8192, kind: 24, coordinate: 100_000 };
export const DEFAULT_THING = { w: 32, h: 32, color: '#5ac8ff' };
const clone = (s) => JSON.parse(JSON.stringify(s));
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,24}|rgba?\([\d\s,.%]+\)|hsla?\([\d\s,.%deg]+\))$/i;
const KIND = /^[A-Za-z_][\w-]*$/;
const IMAGE = /^assets\/[\w][\w .-]{0,79}$/;
/** A copy of a thing's extra fields without its name: two things must not have the same name, so a copy starts with none. */
function withoutName(extra) {
  if (!extra || !('name' in extra)) return extra;
  const { name: _name, ...rest } = extra;
  return Object.keys(rest).length ? rest : undefined;
}
const NOTE = 'Made with the studio\'s scene editor. Load it in your game with loadScene(game, scene).';

/** An empty scene. */
export function newScene(w = 480, h = 320) {
  return { w, h, things: [] };
}

const isNumber = (n) => Number.isFinite(n) && Math.abs(n) <= SCENE_LIMITS.coordinate;

/** What is wrong with a thing, or null. */
export function thingProblem(t) {
  if (!t || typeof t !== 'object') return 'a thing is an object';
  if (typeof t.kind !== 'string' || !KIND.test(t.kind) || t.kind.length > SCENE_LIMITS.kind) {
    return 'a thing needs a kind: letters, digits, _ and -, starting with a letter';
  }
  for (const k of ['x', 'y']) if (!isNumber(t[k])) return `${k} must be a number`;
  for (const k of ['w', 'h']) if (!(isNumber(t[k]) && t[k] > 0)) return `${k} must be a number above 0`;
  if (t.color !== undefined && !(typeof t.color === 'string' && COLOR.test(t.color))) return 'color must be a colour such as #5ac8ff or red';
  if (t.emoji !== undefined && !(typeof t.emoji === 'string' && t.emoji.length <= 8)) return 'emoji must be a short piece of text';
  if (t.image !== undefined && !(typeof t.image === 'string' && IMAGE.test(t.image) && !t.image.includes('..'))) {
    return 'image must be a picture in the assets folder';
  }
  if (t.extra !== undefined && (typeof t.extra !== 'object' || t.extra === null || Array.isArray(t.extra))) return 'extra must be an object';
  return null;
}

/** What is wrong with a scene, or null. */
export function problemWith(scene) {
  if (!scene || typeof scene !== 'object') return 'a scene is an object';
  for (const k of ['w', 'h']) {
    const ok = Number.isInteger(scene[k]) && scene[k] >= SCENE_LIMITS.min && scene[k] <= SCENE_LIMITS.max;
    if (!ok) return `${k} must be a whole number from ${SCENE_LIMITS.min} to ${SCENE_LIMITS.max}`;
  }
  if (!Array.isArray(scene.things)) return 'things must be a list';
  if (scene.things.length > SCENE_LIMITS.things) return `a scene can have at most ${SCENE_LIMITS.things} things`;
  for (const [i, t] of scene.things.entries()) {
    const p = thingProblem(t);
    if (p) return `thing ${i + 1}: ${p}`;
  }
  return null;
}

/** The scene as the text of a file (one thing to a line, so a change in git is easy to read). */
export function serializeScene(scene, note = NOTE) {
  const things = scene.things.map((t) => `    ${JSON.stringify(t)}`).join(',\n');
  return `// ${note}\nexport default {\n  "w": ${scene.w},\n  "h": ${scene.h},\n  "things": [${things ? `\n${things}\n  ` : ''}]\n};\n`;
}

/** Read a scene file. Throws an Error that says what is wrong. */
export function parseScene(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a scene: it should say "export default { ... }".');
  let scene;
  try {
    scene = JSON.parse(m[1]);
  } catch {
    throw new Error('This scene file has been edited into something the scene editor cannot read. '
      + 'Keep the part after "export default" as plain JSON.');
  }
  const problem = problemWith(scene);
  if (problem) throw new Error(`This scene has a problem: ${problem}.`);
  return scene;
}

/** The scene files of a project (a plain list of paths). `scenes/*.json` belong to the 3D editor. */
export const sceneFiles = (paths) => paths.filter((p) => /^scenes\/[\w-]+\.js$/.test(p)).sort();

/** Round to the nearest grid line (a grid of 0 or less means no snapping). */
export const snap = (v, grid) => (grid > 0 ? Math.round(v / grid) * grid : Math.round(v));

/** Put a thing in the scene (on top). `props` may leave out anything: it takes the look of the last thing of that kind, or a plain square. */
export function addThing(scene, kind, x, y, props = {}) {
  if (scene.things.length >= SCENE_LIMITS.things) return scene;
  const next = clone(scene);
  const like = [...next.things].reverse().find((t) => t.kind === kind);
  const looks = ['w', 'h', 'color', 'emoji', 'image', 'extra'];
  const base = like
    ? Object.fromEntries(looks.filter((k) => like[k] !== undefined).map((k) => [k, clone(like[k])]))
    : { ...DEFAULT_THING };
  if (base.extra) base.extra = withoutName(base.extra);
  if (base.extra === undefined) delete base.extra;
  next.things.push({ kind, x: Math.round(x), y: Math.round(y), ...base, ...props });
  return next;
}

/** Change fields of a thing. Fields that would make it invalid are ignored. */
export function setThing(scene, i, patch) {
  if (!scene.things[i]) return scene;
  const next = clone(scene);
  const candidate = { ...next.things[i], ...patch };
  for (const k of Object.keys(candidate)) {
    const blank = candidate[k] === undefined || candidate[k] === '' || (k === 'extra' && !Object.keys(candidate[k] ?? {}).length);
    if (blank) delete candidate[k];
  }
  if (thingProblem(candidate)) return scene;
  next.things[i] = candidate;
  return next;
}

/** Move a thing by a distance, then onto the grid. */
export function moveThing(scene, i, dx, dy, grid = 0) {
  const t = scene.things[i];
  return t ? setThing(scene, i, { x: snap(t.x + dx, grid), y: snap(t.y + dy, grid) }) : scene;
}

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The rectangle a thing becomes when a handle is dragged by (dx, dy). A thing stays at least 1 pixel big. */
export function resizeRect(rect, handle, dx, dy, grid = 0) {
  let { x, y, w, h } = rect;
  let right = x + w;
  let bottom = y + h;
  if (handle.includes('w')) x = Math.min(snap(x + dx, grid), right - 1);
  if (handle.includes('e')) right = Math.max(snap(right + dx, grid), x + 1);
  if (handle.includes('n')) y = Math.min(snap(y + dy, grid), bottom - 1);
  if (handle.includes('s')) bottom = Math.max(snap(bottom + dy, grid), y + 1);
  w = right - x;
  h = bottom - y;
  return { x, y, w, h };
}

/** Which handle of a thing is under a point (in scene units; `reach` is how close counts)? */
export function handleAt(t, px, py, reach = 5) {
  if (!t) return null;
  const xs = { w: t.x, c: t.x + t.w / 2, e: t.x + t.w };
  const ys = { n: t.y, c: t.y + t.h / 2, s: t.y + t.h };
  for (const handle of HANDLES) {
    const hx = handle.includes('w') ? xs.w : handle.includes('e') ? xs.e : xs.c;
    const hy = handle.includes('n') ? ys.n : handle.includes('s') ? ys.s : ys.c;
    if (Math.abs(px - hx) <= reach && Math.abs(py - hy) <= reach) return handle;
  }
  return null;
}

/** The topmost thing under a point, or -1 (later things are drawn on top). */
export function hitTest(scene, px, py) {
  for (let i = scene.things.length - 1; i >= 0; i--) {
    const t = scene.things[i];
    if (px >= t.x && px < t.x + t.w && py >= t.y && py < t.y + t.h) return i;
  }
  return -1;
}

/** Remove a thing. */
export function removeThing(scene, i) {
  if (!scene.things[i]) return scene;
  const next = clone(scene);
  next.things.splice(i, 1);
  return next;
}

/** A copy of a thing, a little to one side and on top. @returns {{scene: object, index: number}} */
export function duplicateThing(scene, i, offset = 16) {
  if (!scene.things[i] || scene.things.length >= SCENE_LIMITS.things) return { scene, index: i };
  const next = clone(scene);
  const copy = clone(next.things[i]);
  if (copy.extra) copy.extra = withoutName(copy.extra);
  if (copy.extra === undefined) delete copy.extra;
  copy.x += offset;
  copy.y += offset;
  next.things.push(copy);
  return { scene: next, index: next.things.length - 1 };
}

/** Move a thing up or down in the drawing order (later is on top). @returns {{scene: object, index: number}} */
export function reorderThing(scene, i, direction) {
  const j = i + direction;
  if (!scene.things[i] || j < 0 || j >= scene.things.length) return { scene, index: i };
  const next = clone(scene);
  [next.things[i], next.things[j]] = [next.things[j], next.things[i]];
  return { scene: next, index: j };
}

/** Change the size of the scene. */
export function resizeScene(scene, w, h) {
  const ok = (n) => Number.isInteger(n) && n >= SCENE_LIMITS.min && n <= SCENE_LIMITS.max;
  return ok(w) && ok(h) ? { ...clone(scene), w, h } : scene;
}

/** The kinds in a scene, with how many of each. */
export function kindsOf(scene) {
  const counts = new Map();
  for (const t of scene.things) counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => ({ kind, count })).sort((a, b) => a.kind.localeCompare(b.kind));
}

/** Things worth a warning: outside the scene, or on top of each other exactly. */
export function warnings(scene) {
  const out = [];
  scene.things.forEach((t, i) => {
    if (t.x + t.w <= 0 || t.y + t.h <= 0 || t.x >= scene.w || t.y >= scene.h) out.push(`${t.kind} ${i + 1} is completely outside the scene`);
    const twin = scene.things.findIndex((o, j) => j < i && o.kind === t.kind && o.x === t.x && o.y === t.y && o.w === t.w && o.h === t.h);
    if (twin >= 0) out.push(`${t.kind} ${i + 1} is exactly on top of ${t.kind} ${twin + 1}`);
  });
  return out.slice(0, 5);
}

/** The code that loads a scene, for the panel to show. */
export function usageCode(path, scene, withKinds = false) {
  const name = path.replace(/^scenes\//, '').replace(/\.js$/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
  const kinds = withKinds ? "import kinds from './kinds.js';\n" : '';
  const call = `loadScene(game, ${name}${withKinds ? ', kinds' : ''})`;
  return `import ${name} from '../${path}';\n${kinds}\n`
    + `// in create():  const world = ${call};   // world.width and world.height are ${scene.w} and ${scene.h}`;
}

/** Read the extra fields box: JSON that is an object (or empty). @returns {{value: object | undefined} | {error: string}} */
export function parseExtra(text) {
  const t = String(text ?? '').trim();
  if (!t) return { value: undefined };
  let v;
  try { v = JSON.parse(t); } catch { return { error: 'Extra fields must be JSON, for example {"vx": 40, "hp": 3}.' }; }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { error: 'Extra fields must be an object, for example {"vx": 40}.' };
  for (const k of ['kind', 'x', 'y', 'w', 'h', 'color', 'emoji', 'image', 'id']) {
    if (k in v) return { error: `"${k}" has its own box above: take it out of the extra fields.` };
  }
  return { value: v };
}
