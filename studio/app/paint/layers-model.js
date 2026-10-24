// The Layers panel's logic: the camera settings and the layers behind and in front of the game, kept in `src/layers.js` as plain JSON:
//
//   export default { "camera": { "smooth": 0.15, "lookAhead": 40, "deadZone": 0 }, "layers": [{ "name": "sky", "kind": "gradient", "color": "#5ac8ff", "color2": "#e8f6ff" }] };
//
// This builds and changes the layers, keeps every number in the range the kit draws well, and reads and writes the file. Judging a set of layers is the kit's own
// `layerProblems`, so the panel and the game agree.
import { layerProblems, LAYER_KINDS, LAYER_LIMITS, CAMERA_DEFAULTS } from '../../../packages/arcade/src/camera.js';

export { layerProblems, LAYER_KINDS, LAYER_LIMITS, CAMERA_DEFAULTS };

const clone = (x) => JSON.parse(JSON.stringify(x));
const COLOR = /^#[0-9a-f]{6}$/i;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : lo));

/** Each kind of layer as it starts, so adding one gives something that already looks like it. */
export const KIND_START = {
  gradient: { color: '#4aa8e8', color2: '#dff3ff', parallax: [0, 0] },
  color: { color: '#2d6a4f', y: 260, height: 40, parallax: [0.9, 0] },
  stars: { color: '#ffffff', size: 120, y: 0, height: 200, parallax: [0.05, 0], seed: 1 },
  clouds: { color: '#ffffff', size: 260, y: 20, height: 100, parallax: [0.2, 0], scroll: [-8, 0], alpha: 0.9, seed: 2 },
  hills: { color: '#7fb77e', size: 420, y: 170, height: 70, parallax: [0.35, 0] },
  buildings: { color: '#3d4660', size: 70, y: 100, height: 160, parallax: [0.5, 0], seed: 3 },
  image: { image: '', size: 256, height: 256, y: 0, parallax: [0.5, 0] },
  sprite: { sprite: '', size: 256, height: 256, y: 0, parallax: [0.5, 0] },
};

/** Ready-made sets to start from. */
export const STARTERS = {
  day: () => ({ camera: { smooth: 0.15, lookAhead: 30, deadZone: 0 }, layers: [
    { name: 'sky', kind: 'gradient', ...clone(KIND_START.gradient) },
    { name: 'clouds', kind: 'clouds', ...clone(KIND_START.clouds) },
    { name: 'far hills', kind: 'hills', ...clone(KIND_START.hills), color: '#a9d4a4', y: 150, parallax: [0.2, 0] },
    { name: 'near hills', kind: 'hills', ...clone(KIND_START.hills), color: '#5fa36a', y: 200, size: 300, parallax: [0.45, 0] },
  ] }),
  night: () => ({ camera: { smooth: 0.2, lookAhead: 0, deadZone: 0 }, layers: [
    { name: 'sky', kind: 'gradient', ...clone(KIND_START.gradient), color: '#0b1030', color2: '#3a2a6a' },
    { name: 'stars', kind: 'stars', ...clone(KIND_START.stars) },
    { name: 'hills', kind: 'hills', ...clone(KIND_START.hills), color: '#1a2147', y: 190, parallax: [0.3, 0] },
  ] }),
  city: () => ({ camera: { smooth: 0.12, lookAhead: 40, deadZone: 20 }, layers: [
    { name: 'sky', kind: 'gradient', ...clone(KIND_START.gradient), color: '#ff9a6b', color2: '#ffe3b8' },
    { name: 'far buildings', kind: 'buildings', ...clone(KIND_START.buildings), color: '#c78a86', parallax: [0.25, 0], y: 90 },
    { name: 'near buildings', kind: 'buildings', ...clone(KIND_START.buildings), color: '#5b4766', size: 90, parallax: [0.5, 0], y: 130, seed: 8 },
  ] }),
};

/** A new set: the camera as the kit has it, and a sky. */
export function newLayers() {
  return STARTERS.day();
}

// ---------- changing it ----------

const NAMES = /^[\w -]{1,32}$/;

/** A name not used by another layer: "hills", then "hills 2". */
export function freeName(layers, base) {
  const taken = new Set(layers.map((l) => l.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  return name;
}

/** Add a layer of a kind. Returns the new set and the place of the new layer. */
export function addLayer(file, kind) {
  if (!LAYER_KINDS[kind]) throw new Error(`There is no kind of layer called "${kind}".`);
  if (file.layers.length >= LAYER_LIMITS.layers) throw new Error(`A set can have up to ${LAYER_LIMITS.layers} layers.`);
  const next = clone(file);
  next.layers.push({ name: freeName(next.layers, kind), kind, ...clone(KIND_START[kind]) });
  return { file: next, index: next.layers.length - 1 };
}

/** Take a layer out. */
export function removeLayer(file, index) {
  const next = clone(file);
  next.layers.splice(index, 1);
  return next;
}

/** Move a layer up (towards the back of the picture) or down (towards the front) by one place, or to a place. */
export function moveLayer(file, index, to) {
  const next = clone(file);
  const at = clamp(to, 0, next.layers.length - 1) | 0;
  const [layer] = next.layers.splice(index, 1);
  next.layers.splice(at, 0, layer);
  return { file: next, index: at };
}

/** A copy of a layer, right after it. */
export function duplicateLayer(file, index) {
  if (file.layers.length >= LAYER_LIMITS.layers) throw new Error(`A set can have up to ${LAYER_LIMITS.layers} layers.`);
  const next = clone(file);
  const copy = clone(next.layers[index]);
  copy.name = freeName(next.layers, copy.name);
  next.layers.splice(index + 1, 0, copy);
  return { file: next, index: index + 1 };
}

/** Change fields of a layer, held to what draws well. Colours must be #rrggbb; a name must not be taken. */
export function setLayer(file, index, props) {
  const next = clone(file);
  const layer = next.layers[index];
  for (const [key, value] of Object.entries(props)) {
    if (key === 'name') {
      if (!NAMES.test(String(value))) throw new Error('A layer name is 1 to 32 letters, numbers, spaces, dashes or underscores.');
      if (next.layers.some((l, i) => i !== index && l.name === value)) throw new Error(`There is already a layer called "${value}".`);
      layer.name = String(value);
    } else if (key === 'color' || key === 'color2') {
      if (!COLOR.test(String(value))) throw new Error('A colour looks like #5ac8ff.');
      layer[key] = String(value).toLowerCase();
    } else if (key === 'parallax' || key === 'scroll') {
      const lim = key === 'parallax' ? LAYER_LIMITS.parallax : 400;
      layer[key] = [clamp(value[0], -lim, lim), clamp(value[1], -lim, lim)];
    } else if (key === 'size') layer.size = clamp(value, 4, LAYER_LIMITS.size);
    else if (key === 'height') layer.height = clamp(value, 0, LAYER_LIMITS.size);
    else if (key === 'y') layer.y = clamp(value, -LAYER_LIMITS.size, LAYER_LIMITS.size);
    else if (key === 'alpha') layer.alpha = clamp(value, 0, 1);
    else if (key === 'seed') layer.seed = clamp(value, 0, 9999) | 0;
    else if (key === 'front' || key === 'hidden') layer[key] = !!value;
    else if (key === 'image' || key === 'sprite') layer[key] = String(value).slice(0, 120);
    else throw new Error(`"${key}" is not something a layer has.`);
  }
  return next;
}

/** Change the camera's settings. */
export function setCamera(file, props) {
  const next = clone(file);
  next.camera = { ...CAMERA_DEFAULTS, ...next.camera };
  for (const [key, value] of Object.entries(props)) {
    if (!(key in CAMERA_DEFAULTS)) throw new Error(`"${key}" is not a camera setting.`);
    next.camera[key] = clamp(value, 0, key === 'smooth' ? 3 : 400);
  }
  return next;
}

// ---------- the file ----------

/** The layers as the text of a file. */
export function serializeLayers(file) {
  const camera = JSON.stringify({ ...CAMERA_DEFAULTS, ...file.camera });
  const body = file.layers.map((l) => `    ${JSON.stringify(l)}`).join(',\n');
  return `// Made with the studio's Layers panel: the camera settings and the layers behind and in front of the game.\n`
    + `// Use them with followSmooth(game, hero, map, dt, layers.camera) and drawLayers(g, game, layers) from @engine/arcade.\n`
    + `export default {\n  "camera": ${camera},\n  "layers": [\n${body}\n  ]\n};\n`;
}

/** Read a layers file. Throws an Error that says what is wrong. */
export function parseLayers(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a set of layers: it should say "export default { ... }".');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('This layers file has been edited into something the Layers panel cannot read. '
      + 'Keep the part after "export default" as plain JSON.');
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.layers)) {
    throw new Error('The layers file should hold "camera" and a list of "layers".');
  }
  const layers = data.layers.slice(0, LAYER_LIMITS.layers).filter((l) => l && typeof l === 'object' && LAYER_KINDS[l.kind]);
  const seen = new Set();
  layers.forEach((l, i) => {
    let name = NAMES.test(String(l.name)) ? String(l.name) : `${l.kind} ${i + 1}`;
    while (seen.has(name)) name += ' 2';
    seen.add(l.name = name.slice(0, 32));
  });
  const camera = { ...CAMERA_DEFAULTS };
  for (const key of Object.keys(CAMERA_DEFAULTS)) if (Number.isFinite(data.camera?.[key]) && data.camera[key] >= 0) camera[key] = data.camera[key];
  return { camera, layers };
}

/** The sprites the layers use that are not in the project, as names. */
export function missingSprites(file, spriteNames) {
  return file.layers.filter((l) => l.kind === 'sprite' && l.sprite && !spriteNames.includes(l.sprite)).map((l) => l.sprite);
}
