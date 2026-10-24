// The World panel's logic: the rooms of a game (levels and scenes) as boxes on a board, joined by links, kept in `src/world.js` as plain JSON:
//
//   export default { "start": "cave", "rooms": { "cave": { "file": "scenes/cave.js", "x": 40, "y": 40 } },
//                    "links": [{ "from": "cave", "to": "forest", "via": { "kind": "edge", "side": "right" } }] };
//
// A link leaves a room through an edge of the screen or through a named door, and arrives in the next room beside a door, at a place, or on the opposite edge. This builds and changes
// the world, finds how big each room is (from its scene or level file), and reads and writes the file. Judging a world is the kit's own `worldProblems`.
import { cleanWorld, worldProblems, WORLD_LIMITS, SIDES, OPPOSITE } from '../../../packages/arcade/src/world.js';
import { parseScene } from './scene-model.js';
import { findLevels } from './level-model.js';

export { cleanWorld, worldProblems, WORLD_LIMITS, SIDES, OPPOSITE };

const clone = (x) => JSON.parse(JSON.stringify(x));
export const NAME = /^[A-Za-z_][\w-]{0,31}$/;
const snap = (v) => Math.round(v / 10) * 10;

/** A world with nothing in it. */
export const newWorld = () => ({ start: '', rooms: {}, links: [] });

// ---------- the file ----------

/** The world as the text of a file (one room and one link to a line). */
export function serializeWorld(world) {
  const rooms = Object.entries(world.rooms).map(([n, r]) => `    ${JSON.stringify(n)}: ${JSON.stringify(r)}`).join(',\n');
  const links = world.links.map((l) => `    ${JSON.stringify(l)}`).join(',\n');
  const note = '// Made with the studio\'s World panel: the rooms of the game and how they join.';
  const use = '// Use it with makeWorld(world, { roomName: (game) => ...loads the room }) from @engine/arcade.';
  const start = `  "start": ${JSON.stringify(world.start)},`;
  return `${note}\n${use}\nexport default {\n${start}\n  "rooms": {\n${rooms}\n  },\n  "links": [\n${links}\n  ]\n};\n`;
}

/** Read a world file. Throws an Error that says what is wrong. */
export function parseWorld(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a world: it should say "export default { ... }".');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('This world file has been edited into something the World panel cannot read. '
      + 'Keep the part after "export default" as plain JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.rooms !== 'object') {
    throw new Error('The world file should hold "start", "rooms" and "links".');
  }
  return cleanWorld(data);
}

// ---------- the rooms' files ----------

/** The files a room can be: scenes and levels of the project. */
export const roomFiles = (paths) => paths.filter((p) => /^(scenes|src\/levels)\/[\w-]+\.js$/.test(p)).sort();

/** The name a room gets from its file ("scenes/dark-cave.js" is "dark-cave"). */
export const roomNameOf = (file) => /([\w-]+)\.js$/.exec(file)?.[1] ?? 'room';

/** How big a room is in game pixels, from its file: a scene says so; a level is rows of tiles (the file's TILE, 32 if it does not say). Null when the file cannot be read. */
export function roomSize(text, file) {
  try {
    if (file.startsWith('scenes/')) {
      const s = parseScene(text);
      return { w: s.w, h: s.h };
    }
    const level = findLevels(text)[0];
    if (!level) return null;
    const tile = Number(/\bconst\s+TILE\s*=\s*(\d+)/.exec(text)?.[1] ?? 32);
    return { w: level.rows[0].length * tile, h: level.rows.length * tile };
  } catch { return null; }
}

/** The names of the things in a room's scene that links can use (a level has none). */
export function namesIn(text, file) {
  if (!file?.startsWith('scenes/')) return [];
  try { return parseScene(text).things.map((t) => t.extra?.name).filter(Boolean); } catch { return []; }
}

/** The names of things, for every room that has a file: what `worldProblems` needs to say which doors do not exist. */
export function knownNames(world, readText) {
  const names = {};
  for (const [room, r] of Object.entries(world.rooms)) {
    if (!r.file) continue;
    let text = '';
    try { text = readText(r.file); } catch { text = ''; }
    names[room] = namesIn(text, r.file);
  }
  return { names };
}

// ---------- the rooms ----------

/** A room name that is free: the wanted one, then "forest2". */
export function freeName(world, wanted) {
  const base = String(wanted).replace(/[^\w-]/g, '').replace(/^[^A-Za-z_]+/, '') || 'room';
  if (!(base in world.rooms)) return base;
  for (let n = 2; n < 1000; n++) if (!(`${base}${n}` in world.rooms)) return `${base}${n}`;
  return `${base}${Date.now()}`;
}

/** Why a room name cannot be used, or null. */
export function nameProblem(world, name) {
  if (!NAME.test(name)) return 'Use letters, numbers, - and _, starting with a letter';
  return name in world.rooms ? 'There is already a room with that name' : null;
}

/** A room added for a file, to the right of the others (the first room is the start). Returns the world and the room's name. */
export function addRoom(world, file, name = roomNameOf(file)) {
  if (Object.keys(world.rooms).length >= WORLD_LIMITS.rooms) throw new Error(`At most ${WORLD_LIMITS.rooms} rooms.`);
  const out = clone(world);
  const room = freeName(out, name);
  const xs = Object.values(out.rooms).map((r) => (r.x ?? 0));
  out.rooms[room] = { file, x: xs.length ? Math.max(...xs) + 180 : 20, y: 20 };
  if (!out.start) out.start = room;
  return { world: out, room };
}

/** A room taken away, with every link that left it or came to it (and the start moves to another room if it was the start). */
export function removeRoom(world, room) {
  const out = clone(world);
  delete out.rooms[room];
  out.links = out.links.filter((l) => l.from !== room && l.to !== room);
  if (out.start === room) out.start = Object.keys(out.rooms)[0] ?? '';
  return out;
}

/** A room renamed, with its links and the start. */
export function renameRoom(world, from, to) {
  const problem = nameProblem(world, to);
  if (problem) throw new Error(problem);
  const out = clone(world);
  out.rooms = Object.fromEntries(Object.entries(out.rooms).map(([n, r]) => [n === from ? to : n, r]));
  for (const l of out.links) { if (l.from === from) l.from = to; if (l.to === from) l.to = to; }
  if (out.start === from) out.start = to;
  return out;
}

/** A room moved on the board (to the nearest 10). */
export function moveRoom(world, room, x, y) {
  const out = clone(world);
  out.rooms[room].x = Math.max(0, snap(x));
  out.rooms[room].y = Math.max(0, snap(y));
  return out;
}

/** Make a room the one the game starts in. */
export function setStart(world, room) {
  return { ...clone(world), start: room };
}

/** Where the hero stands when the game starts in this room, or null to leave it where the room puts it. */
export function setRoomStart(world, room, spot) {
  const out = clone(world);
  if (spot) out.rooms[room].start = { x: Math.round(spot.x), y: Math.round(spot.y) }; else delete out.rooms[room].start;
  return out;
}

// ---------- the links ----------

/** Which side of a room another room is on the board, to suggest where to leave it. */
export function suggestSide(world, from, to) {
  const a = world.rooms[from];
  const b = world.rooms[to];
  if (!a || !b) return 'right';
  const dx = (b.x ?? 0) - (a.x ?? 0);
  const dy = (b.y ?? 0) - (a.y ?? 0);
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up');
}

/** A link added. With `twoWay` an edge link also adds the way back from the opposite edge. Returns the world and the places of the new links. */
export function addLink(world, link, twoWay = false) {
  const out = clone(world);
  if (!(link.from in out.rooms) || !(link.to in out.rooms)) throw new Error('A link joins two rooms that are in the world.');
  if (out.links.length + (twoWay ? 2 : 1) > WORLD_LIMITS.links) throw new Error(`At most ${WORLD_LIMITS.links} links.`);
  const made = [];
  const add = (l) => { out.links.push(clone(l)); made.push(out.links.length - 1); };
  add(link);
  if (twoWay && link.via.kind === 'edge') add({ from: link.to, to: link.from, via: { kind: 'edge', side: OPPOSITE[link.via.side] } });
  return { world: out, indexes: made };
}

/** Change a link: where it leaves from, where it arrives. */
export function setLink(world, index, patch) {
  const out = clone(world);
  const link = out.links[index];
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'arrive' && (v === null || v === undefined)) delete link.arrive;
    else if (['from', 'to', 'via', 'arrive'].includes(k)) link[k] = v;
    else throw new Error(`"${k}" is not part of a link.`);
  }
  return cleanWorld({ ...out, links: out.links }).links.length === out.links.length ? out : world;
}

/** A link taken away. */
export function removeLink(world, index) {
  const out = clone(world);
  out.links.splice(index, 1);
  return out;
}

/** The links that leave a room or arrive in it, as places in the list. */
export function linksOf(world, room) {
  return world.links.map((l, i) => ({ l, i })).filter(({ l }) => l.from === room || l.to === room).map(({ i }) => i);
}

/** A short description of a link, for the panel. */
export function describeLink(l) {
  const way = l.via.kind === 'edge' ? `through the ${l.via.side} edge` : `through the door "${l.via.name}"`;
  let there = '';
  if (l.arrive?.at) there = ` to "${l.arrive.at}"`;
  else if (l.arrive?.side) there = ` on the ${l.arrive.side} edge`;
  else if (l.arrive) there = ` at ${l.arrive.x}, ${l.arrive.y}`;
  return `${l.from} ${way} to ${l.to}${there}`;
}
