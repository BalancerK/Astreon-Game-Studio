// The backpack: things you made in one project, kept on this computer so another project can use them. A sprite, a sound, a song, an effect, a state machine, a clip, a set of
// behaviours, a screen, a scene, a level, a story: each is lifted out of the project's files as one item, and put into another project under a name that is free there (so it never
// overwrites anything of yours). The backpack lives in the browser's own storage and is never sent anywhere; it can also be saved as a file and loaded on another computer. This is the
// logic, with no page in it, tested in Node.
import * as sounds from '../paint/sound-model.js';
import * as music from '../paint/music-model.js';
import * as particles from '../paint/particle-model.js';
import * as states from '../paint/state-model.js';
import * as clips from '../paint/clip-model.js';
import * as sequences from '../paint/sequence-model.js';
import * as behaviors from '../paint/behavior-model.js';
import * as ui from '../paint/ui-model.js';

export const BACKPACK_LIMITS = { items: 300, itemBytes: 120_000, totalBytes: 3_000_000, name: 40 };
export const FORMAT = 'studio-backpack';

/** Things that are one entry in a file that holds a table of them (sounds.js holds many sounds). `read` gets the table out of the file's text. */
const TABLES = {
  sound: { label: 'Sound', file: 'src/sounds.js', read: (t) => sounds.parseSounds(t), write: (o) => sounds.serializeSounds(o),
    free: sounds.freeName },
  song: { label: 'Song', file: 'src/music.js', read: (t) => music.parseSongs(t).songs, write: (o) => music.serializeSongs(o), free: music.freeName },
  effect: { label: 'Particle effect', file: 'src/particles.js', read: (t) => particles.parseParticles(t),
    write: (o) => particles.serializeParticles(o), free: particles.freeName },
  machine: { label: 'State machine', file: 'src/states.js', read: (t) => states.parseStates(t), write: (o) => states.serializeStates(o),
    free: states.freeName },
  clip: { label: 'Clip', file: 'src/clips.js', read: (t) => clips.parseClips(t), write: (o) => clips.serializeClips(o), free: clips.freeName },
  sequence: { label: 'Sequence', file: 'src/sequences.js', read: (t) => sequences.parseSequences(t), write: (o) => sequences.serializeSequences(o),
    free: sequences.freeName },
  behaviors: { label: 'Behaviours', file: 'src/behaviors.js', read: (t) => behaviors.parseBehaviors(t),
    write: (o) => behaviors.serializeBehaviors(o), free: behaviors.freeName },
  screen: { label: 'Screen', file: 'src/ui.js', read: (t) => ui.parseUi(t), write: (o) => ui.serializeUi(o), free: ui.freeName },
};

/** Things that are a file of their own, in a folder. */
const FILES = {
  sprite: { label: 'Sprite', dir: 'src/art' },
  scene: { label: 'Scene', dir: 'scenes' },
  level: { label: 'Level', dir: 'src/levels' },
};

/** Things that are the one file a panel reads (a project has one story, one set of controls): putting one in replaces the one there. */
const SINGLES = {
  story: { label: 'Story', path: 'src/dialogue.js' },
  controls: { label: 'Controls', path: 'src/controls.js' },
  layers: { label: 'Layers and camera', path: 'src/layers.js' },
  lights: { label: 'Lights and screen effects', path: 'src/lights.js' },
  kinds: { label: 'Kinds and their fields', path: 'src/kinds.js' },
  world: { label: 'World of linked rooms', path: 'src/world.js' },
};

export const KINDS = { ...Object.fromEntries(Object.entries(TABLES).map(([k, v]) => [k, v.label])),
  ...Object.fromEntries(Object.entries(FILES).map(([k, v]) => [k, v.label])),
  ...Object.fromEntries(Object.entries(SINGLES).map(([k, v]) => [k, v.label])) };

const stem = (path) => /([^/]+)\.js$/.exec(path)?.[1] ?? path;
const safe = (name) => String(name).replace(/[^\w-]/g, '').replace(/^[^a-z]+/i, '').slice(0, BACKPACK_LIMITS.name) || 'item';

/**
 * Everything in a project that could go in the backpack.
 * @param {Record<string, string>} files the project's text files
 * @returns {{kind: string, name: string}[]}
 */
export function itemsIn(files) {
  const out = [];
  for (const [kind, t] of Object.entries(TABLES)) {
    if (typeof files[t.file] !== 'string') continue;
    try { for (const name of Object.keys(t.read(files[t.file]))) out.push({ kind,
      name }); } catch { /* a damaged file offers nothing: its panel says what is wrong */ }
  }
  for (const [kind, f] of Object.entries(FILES)) {
    const inDir = new RegExp(`^${f.dir}/[\\w-]+\\.js$`);
    for (const path of Object.keys(files).sort()) if (inDir.test(path) && typeof files[path] === 'string') out.push({ kind, name: stem(path) });
  }
  for (const [kind, s] of Object.entries(SINGLES)) if (typeof files[s.path] === 'string') out.push({ kind, name: kind });
  return out;
}

/**
 * Lift one thing out of a project. Throws an Error that says what is wrong.
 * @returns {{kind: string, name: string, payload: unknown}} `payload` is the thing itself: an entry of a table (an object), or the text of a file
 */
export function take(files, kind, name) {
  if (kind in TABLES) {
    const t = TABLES[kind];
    if (typeof files[t.file] !== 'string') throw new Error(`There is no ${t.file} in this project.`);
    const table = t.read(files[t.file]);
    if (!(name in table)) throw new Error(`There is no ${t.label.toLowerCase()} called "${name}".`);
    return { kind, name, payload: JSON.parse(JSON.stringify(table[name])) };
  }
  const path = kind in FILES ? `${FILES[kind].dir}/${name}.js` : SINGLES[kind]?.path;
  if (!path) throw new Error(`"${kind}" is not something the backpack carries.`);
  if (typeof files[path] !== 'string') throw new Error(`There is no ${path} in this project.`);
  return { kind, name, payload: files[path] };
}

/**
 * Put an item into a project: where it goes and what the file becomes. A thing in a table gets a name that is free there; a file gets a free file name; the one story or set of
 * controls replaces the one there (`replaces` says so, so the person can be asked first).
 * @param {Record<string, string>} files the project's text files
 * @param {{kind: string, name: string, payload: unknown}} item
 * @returns {{path: string, text: string, name: string, replaces: boolean}}
 */
export function put(files, item) {
  const { kind, payload } = item;
  if (kind in TABLES) {
    const t = TABLES[kind];
    let table = {};
    if (typeof files[t.file] === 'string') table = t.read(files[t.file]);
    const name = t.free(table, safe(item.name));
    table[name] = JSON.parse(JSON.stringify(payload));
    return { path: t.file, text: t.write(table), name, replaces: false };
  }
  if (kind in FILES) {
    const { dir } = FILES[kind];
    let name = safe(item.name);
    for (let n = 2; typeof files[`${dir}/${name}.js`] === 'string' && n < 1000; n++) name = `${safe(item.name)}${n}`;
    return { path: `${dir}/${name}.js`, text: String(payload), name, replaces: false };
  }
  const single = SINGLES[kind];
  if (!single) throw new Error(`"${kind}" is not something the backpack carries.`);
  return { path: single.path, text: String(payload), name: kind, replaces: typeof files[single.path] === 'string' };
}

// ---------- the backpack itself ----------

const sizeOf = (item) => JSON.stringify(item.payload).length;
const total = (items) => items.reduce((n, i) => n + sizeOf(i), 0);
const same = (a, b) => a.kind === b.kind && a.name === b.name && JSON.stringify(a.payload) === JSON.stringify(b.payload);

/** An item added to a backpack (a list). The same thing twice is kept once. Throws an Error that says what is too big or too many. */
export function addItem(items, item, { from = '', now = Date.now() } = {}) {
  if (!(item.kind in KINDS)) throw new Error(`"${item.kind}" is not something the backpack carries.`);
  if (items.some((i) => same(i, item))) return items;
  if (sizeOf(item) > BACKPACK_LIMITS.itemBytes) {
    throw new Error(`This is too big for the backpack (over ${Math.round(BACKPACK_LIMITS.itemBytes / 1000)} KB).`);
  }
  if (items.length >= BACKPACK_LIMITS.items) throw new Error(`The backpack holds at most ${BACKPACK_LIMITS.items} things. Take some out first.`);
  if (total(items) + sizeOf(item) > BACKPACK_LIMITS.totalBytes) throw new Error('The backpack is full. Take some things out first.');
  const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return [{ id, kind: item.kind, name: safe(item.name), payload: item.payload, from: String(from).slice(0, 60), added: now }, ...items];
}

/** An item taken out of the backpack. */
export const removeItem = (items, id) => items.filter((i) => i.id !== id);

/** The items that match a search (the words are looked for in the name, the kind and the project it came from) and a kind. */
export function search(items, query = '', kind = '') {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((i) => (!kind || i.kind === kind) && words.every((w) => `${i.name} ${KINDS[i.kind]} ${i.from}`.toLowerCase().includes(w)));
}

/** The backpack as a file's text. */
export function serializeBackpack(items) {
  return `${JSON.stringify({ format: FORMAT, version: 1, items }, null, 1)}\n`;
}

/** Read a backpack file, keeping what is usable. Throws an Error that says what is wrong. */
export function parseBackpack(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('This is not a backpack file: it is not JSON.'); }
  if (data?.format !== FORMAT || !Array.isArray(data.items)) throw new Error('This is not a studio backpack file.');
  const out = [];
  for (const i of data.items) {
    if (!i || typeof i !== 'object' || !(i.kind in KINDS) || typeof i.name !== 'string' || i.payload === undefined) continue;
    const isFile = i.kind in FILES || i.kind in SINGLES;
    if (isFile !== (typeof i.payload === 'string')) continue;
    if (!isFile && (typeof i.payload !== 'object' || i.payload === null)) continue;
    if (sizeOf(i) > BACKPACK_LIMITS.itemBytes) continue;
    out.push({ id: typeof i.id === 'string' ? i.id.slice(0, 20) : `${out.length}`, kind: i.kind, name: safe(i.name), payload: i.payload,
      from: String(i.from ?? '').slice(0, 60), added: Number(i.added) || 0 });
  }
  return out.slice(0, BACKPACK_LIMITS.items);
}

/** Add what is in a backpack file to a backpack (things already there are not repeated). Returns the new list and how many were new. */
export function mergeBackpack(items, incoming) {
  let next = items;
  let added = 0;
  for (const i of incoming) {
    const before = next.length;
    try { next = addItem(next, i, { from: i.from, now: i.added || Date.now() }); } catch { break; }
    if (next.length > before) added++;
  }
  return { items: next, added };
}
