// A world of linked rooms. A room is a level or a scene; a link says "leave THIS room through the right edge (or through THAT door) and arrive in the other room, over there". The
// world is plain data made in the studio's World panel and kept in `src/world.js`. The game says how to load each room (it already knows how: `loadScene`, `loadMap`, or the
// function an imported level has) and the world does the rest: it swaps the room, carries the hero across and puts it where the link says. What it remembers (`game.world`) is
// plain data in the game, so saving, rewinding and recordings follow.
//
//   import data from './world.js';
//   const world = makeWorld(data, { cave: (game) => loadMap(game, CAVE, legend), forest: (game) => loadScene(game, forestScene, kinds) });
//   world.start(game);                    // in create(): loads the first room
//   world.step(game);                     // every tick: the hero left through an edge or touched a door? then the next room is loaded
//   world.goTo(game, 'forest');           // or go to a room yourself, whenever you like

import { first, touching } from './things.js';
import { named } from './kinds.js';
import { screen } from './screen.js';

/**
 * @typedef {{kind: 'edge', side: 'left' | 'right' | 'up' | 'down'} | {kind: 'thing', name: string}} Via
 * @typedef {{at?: string, x?: number, y?: number, side?: 'left' | 'right' | 'up' | 'down'}} Arrive
 * @typedef {{from: string, to: string, via: Via, arrive?: Arrive}} Link
 * @typedef {{start: string, rooms: Object<string, {file?: string, x?: number, y?: number, start?: {x: number, y: number}}>, links: Link[]}} WorldData
 */

/** The limits a world is held to. */
export const WORLD_LIMITS = { rooms: 40, links: 200, name: 32 };

/** The four sides, and the one across from each. */
export const SIDES = ['left', 'right', 'up', 'down'];
export const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' };

const NAME = /^[A-Za-z_][\w-]{0,31}$/;
const PLACE = /^[A-Za-z_][\w-]{0,31}$/;

/**
 * Make a world safe: room names that fit, links between rooms that exist, edges that are sides, and a start that is a room.
 * @param {unknown} data
 * @returns {WorldData}
 */
export function cleanWorld(data) {
  const rooms = {};
  for (const [name, r] of Object.entries(data?.rooms && typeof data.rooms === 'object' ? data.rooms : {}).slice(0, WORLD_LIMITS.rooms)) {
    if (!NAME.test(name) || !r || typeof r !== 'object') continue;
    const room = {};
    if (typeof r.file === 'string' && r.file.length <= 80) room.file = r.file;
    for (const k of ['x', 'y']) if (Number.isFinite(r[k])) room[k] = Math.round(r[k]);
    if (r.start && Number.isFinite(r.start.x) && Number.isFinite(r.start.y)) room.start = { x: r.start.x, y: r.start.y };
    rooms[name] = room;
  }
  const links = [];
  for (const l of (Array.isArray(data?.links) ? data.links : []).slice(0, WORLD_LIMITS.links)) {
    if (!l || !(l.from in rooms) || !(l.to in rooms)) continue;
    const via = l.via?.kind === 'edge' && SIDES.includes(l.via.side) ? { kind: 'edge', side: l.via.side }
      : l.via?.kind === 'thing' && PLACE.test(String(l.via.name)) ? { kind: 'thing', name: l.via.name } : null;
    if (!via) continue;
    const link = { from: l.from, to: l.to, via };
    const a = l.arrive;
    if (a && typeof a === 'object') {
      if (typeof a.at === 'string' && PLACE.test(a.at)) link.arrive = { at: a.at };
      else if (Number.isFinite(a.x) && Number.isFinite(a.y)) link.arrive = { x: a.x, y: a.y };
      else if (SIDES.includes(a.side)) link.arrive = { side: a.side };
    }
    links.push(link);
  }
  const start = data?.start in rooms ? data.start : Object.keys(rooms)[0] ?? '';
  return { start, rooms, links };
}

/**
 * Make a world a game can use.
 * @param {WorldData} data what the World panel made (the default export of `src/world.js`)
 * @param {Object<string, (game: object) => ({width: number, height: number} | void)>} loaders one for each room: puts the room's things in the game and, if it can, returns the room's size
 * @param {{player?: string, keep?: string[]}} [opts] `player`: the kind of thing that walks between rooms (default `hero`); `keep`: other kinds that go with it
 */
export function makeWorld(data, loaders, { player = 'hero', keep = [] } = {}) {
  const world = cleanWorld(data);
  const carried = [player, ...keep];

  function enter(game, room, link, side, previous) {
    if (!(room in world.rooms)) throw new Error(`There is no room called "${room}" in the world (the rooms are: ${Object.keys(world.rooms).join(', ') || 'none yet'}).`);
    const load = loaders?.[room];
    if (typeof load !== 'function') throw new Error(`The world has the room "${room}" but the game gave it no way to load it. Give makeWorld a function for "${room}".`);
    const bring = (game.things ?? []).filter((t) => carried.includes(t.kind));
    const walker = bring.find((t) => t.kind === player);
    const before = walker ? { x: walker.x, y: walker.y } : null;
    game.things = [];
    const size = load(game) ?? {};
    game.map = { width: size.width ?? screen().width, height: size.height ?? screen().height };
    // a scene may hold its own hero for when it is played alone: the one that walked in is the one that stays
    const brought = new Set(bring.map((t) => t.kind));
    game.things = game.things.filter((t) => !brought.has(t.kind));
    game.things.push(...bring);
    const hero = walker ?? first(game, player);                              // at the very start the hero is the one the room loaded
    if (hero) place(game, hero, world.rooms[room], link, side, before);
    const seen = game.world?.visited ?? [];
    game.world = { room, from: previous ?? '', visited: seen.includes(room) ? seen : [...seen, room],
      armed: !(link && (link.via?.kind === 'thing' || link.arrive?.at)) };
    game.camera = { x: 0, y: 0 };
    return room;
  }

  function place(game, hero, room, link, side, before) {
    const { width, height } = game.map;
    const arrive = link?.arrive;
    const into = { x: hero.x, y: hero.y };
    if (arrive?.at) {
      const spot = named(game, arrive.at);
      if (spot) { into.x = spot.x + spot.w / 2 - hero.w / 2; into.y = spot.y + spot.h / 2 - hero.h / 2; }
    } else if (arrive && Number.isFinite(arrive.x)) {
      into.x = arrive.x;
      into.y = arrive.y;
    } else if (arrive?.side || side) {
      const s = arrive?.side ?? side;
      if (s === 'left') into.x = 2;
      if (s === 'right') into.x = width - hero.w - 2;
      if (s === 'up') into.y = 2;
      if (s === 'down') into.y = height - hero.h - 2;
      if (s === 'left' || s === 'right') into.y = before?.y ?? hero.y;
      else into.x = before?.x ?? hero.x;
    } else if (room.start) {
      into.x = room.start.x;
      into.y = room.start.y;
    }
    hero.x = Math.max(0, Math.min(into.x, width - hero.w));
    hero.y = Math.max(0, Math.min(into.y, height - hero.h));
    hero.vx = 0;
    hero.vy = 0;
  }

  const api = {
    /** The world as it was made safe. */
    data: world,
    /** Load the first room (call it in `create`). */
    start(game, room = world.start) {
      game.world = undefined;
      return enter(game, room, null, null, '');
    },
    /**
     * Go to a room now: it is loaded, and the hero is put where the link says (or at the room's start when there is no link).
     * @param {object} game
     * @param {string} room
     * @param {Arrive} [arrive] where to arrive: `{ at: 'door2' }` (a named thing), `{ x, y }`, or `{ side: 'left' }`
     */
    goTo(game, room, arrive) {
      return enter(game, room, arrive ? { arrive } : null, null, game.world?.room);
    },
    /** The name of the room the game is in. */
    room: (game) => game.world?.room ?? '',
    /** The names of the rooms the hero has been in. */
    visited: (game) => [...(game.world?.visited ?? [])],
    /**
     * Look for the hero leaving the room: through an edge of the room, or touching a door a link names. Call it every tick. Returns the name of the room it moved to, or `null`.
     * After arriving through a door the hero has to step off it before it works again, so the hero does not go back and forth.
     */
    step(game) {
      const state = game.world;
      const hero = first(game, player);
      if (!state || !hero || !game.map) return null;
      const here = world.links.filter((l) => l.from === state.room);
      if (!state.armed && !here.some((l) => l.via.kind === 'thing' && touching(hero, named(game, l.via.name) ?? { x: 1e9, y: 1e9, w: 0,
        h: 0 }))) state.armed = true;
      const cx = hero.x + hero.w / 2;
      const cy = hero.y + hero.h / 2;
      for (const link of here) {
        if (link.via.kind === 'edge') {
          const s = link.via.side;
          const out = (s === 'left' && cx < 0) || (s === 'right' && cx > game.map.width) || (s === 'up' && cy < 0) || (s === 'down' && cy > game.map.height);
          if (out) return enter(game, link.to, link, OPPOSITE[s], state.room);
        } else if (state.armed) {
          const door = named(game, link.via.name);
          if (door && touching(hero, door)) return enter(game, link.to, link, null, state.room);
        }
      }
      return null;
    },
  };
  return api;
}

/**
 * Look a world over and say what is wrong, in plain words. Give it the names of the things in each room (`known.names`, by room) and it also says which doors do not exist.
 * @param {WorldData} data
 * @param {{names?: Object<string, string[]>}} [known]
 * @returns {{where: string, message: string}[]}
 */
export function worldProblems(data, known = {}) {
  const out = [];
  const add = (where, message) => out.push({ where, message });
  const rooms = Object.keys(data?.rooms ?? {});
  if (!rooms.length) { add('', 'The world has no rooms yet.'); return out; }
  if (rooms.length > WORLD_LIMITS.rooms) add('', `At most ${WORLD_LIMITS.rooms} rooms.`);
  if (!(data.start in data.rooms)) add('', `The start "${data.start}" is not a room.`);
  const links = data.links ?? [];
  if (links.length > WORLD_LIMITS.links) add('', `At most ${WORLD_LIMITS.links} links.`);
  const edges = new Set();
  links.forEach((l, i) => {
    const where = `link ${i + 1}`;
    if (!(l.from in data.rooms)) add(where, `A link leaves "${l.from}", which is not a room.`);
    if (!(l.to in data.rooms)) add(where, `A link goes to "${l.to}", which is not a room.`);
    if (l.via?.kind === 'edge') {
      const key = `${l.from}/${l.via.side}`;
      if (edges.has(key)) add(where, `The ${l.via.side} edge of "${l.from}" already leads somewhere: only the first link is used.`);
      edges.add(key);
    }
    const names = known.names ?? {};
    if (l.via?.kind === 'thing' && names[l.from] && !names[l.from].includes(l.via.name)) add(where,
      `There is no thing called "${l.via.name}" in "${l.from}" to walk into.`);
    if (l.arrive?.at && names[l.to] && !names[l.to].includes(l.arrive.at)) add(where,
      `There is no thing called "${l.arrive.at}" in "${l.to}" to arrive at.`);
  });
  const reached = new Set([data.start]);
  for (let grew = true; grew;) {
    grew = false;
    for (const l of links) if (reached.has(l.from) && !reached.has(l.to)) { reached.add(l.to); grew = true; }
  }
  for (const r of rooms) if (!reached.has(r)) add(r, `The room "${r}" cannot be reached from the start: no link leads to it.`);
  return out;
}
