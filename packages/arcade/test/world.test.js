import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, spawn, first, all } from '../src/things.js';
import { loadScene } from '../src/map.js';
import { makeWorld, cleanWorld, worldProblems } from '../src/world.js';

const caveScene = { w: 300, h: 200, things: [
  { kind: 'hero', x: 20, y: 20, w: 16, h: 16 }, { kind: 'rock', x: 100, y: 100, w: 20, h: 20 },
  { kind: 'door', x: 250, y: 150, w: 20, h: 30, extra: { name: 'cave-door' } },
] };
const forestScene = { w: 500, h: 200, things: [
  { kind: 'tree', x: 200, y: 50, w: 20, h: 40 }, { kind: 'door', x: 10, y: 120, w: 20, h: 30, extra: { name: 'forest-door' } },
] };
const DATA = {
  start: 'cave',
  rooms: { cave: { x: 0, y: 0, start: { x: 30, y: 30 } }, forest: { x: 1, y: 0 }, island: { x: 2, y: 0 } },
  links: [
    { from: 'cave', to: 'forest', via: { kind: 'edge', side: 'right' } },
    { from: 'forest', to: 'cave', via: { kind: 'edge', side: 'left' } },
    { from: 'cave', to: 'forest', via: { kind: 'thing', name: 'cave-door' }, arrive: { at: 'forest-door' } },
    { from: 'forest', to: 'island', via: { kind: 'edge', side: 'down' }, arrive: { x: 40, y: 60 } },
  ],
};
const loaders = () => ({
  cave: (g) => loadScene(g, caveScene),
  forest: (g) => loadScene(g, forestScene),
  island: (g) => { spawn(g, 'palm', { x: 5, y: 5, w: 10, h: 10 }); return { width: 160, height: 120 }; },
});
const make = () => {
  const game = newGame();
  const world = makeWorld(DATA, loaders());
  world.start(game);
  return { game, world, hero: first(game, 'hero') };
};
const kinds = (game) => all(game).map((t) => t.kind).sort().join();

test('the world starts in the first room, with its things and its size, and the hero at the room\'s start', () => {
  const { game, world, hero } = make();
  assert.equal(world.room(game), 'cave');
  assert.equal(kinds(game), 'door,hero,rock');
  assert.deepEqual(game.map, { width: 300, height: 200 });
  assert.deepEqual([hero.x, hero.y], [30, 30]);
  assert.deepEqual(world.visited(game), ['cave']);
});

test('leaving through an edge loads the next room and keeps the same hero, on the other side at the same height', () => {
  const { game, world, hero } = make();
  const id = hero.id;
  hero.x = 305;
  hero.y = 77;
  assert.equal(world.step(game), 'forest');
  assert.equal(world.room(game), 'forest');
  assert.equal(kinds(game), 'door,hero,tree', 'the cave\'s things are gone, and there is still one hero');
  const h = first(game, 'hero');
  assert.equal(h.id, id, 'the same hero');
  assert.deepEqual([h.x, h.y], [2, 77], 'just inside the left edge, at the same height');
  assert.deepEqual(game.map, { width: 500, height: 200 });
  assert.deepEqual(world.visited(game), ['cave', 'forest']);
  hero.x = -30;
  assert.equal(world.step(game), 'cave', 'and back again');
  assert.equal(first(game, 'hero').x, 300 - 16 - 2, 'on the right edge of the cave');
});

test('walking into a named door goes through it and arrives at the named door of the other room, and does not bounce back', () => {
  const { game, world, hero } = make();
  hero.x = 255;
  hero.y = 155;
  assert.equal(world.step(game), 'forest');
  const h = first(game, 'hero');
  const door = all(game, 'door')[0];
  assert.ok(Math.abs(h.x + 8 - (door.x + 10)) < 1 && Math.abs(h.y + 8 - (door.y + 15)) < 1, 'standing on the forest door');
  assert.equal(world.step(game), null, 'still on the door: nothing happens');
  assert.equal(world.room(game), 'forest');
  h.x = 300;
  world.step(game);
  assert.equal(game.world.armed, true, 'stepped off: the door works again');
});

test('arriving at a place, going to a room by hand, and the hero keeps what it has', () => {
  const { game, world, hero } = make();
  hero.hp = 3;
  world.goTo(game, 'forest');
  hero.y = 210;
  assert.equal(world.step(game), 'island');
  const h = first(game, 'hero');
  assert.deepEqual([h.x, h.y], [40, 60]);
  assert.equal(h.hp, 3, 'the hero is the same thing, with everything it had');
  assert.deepEqual(game.map, { width: 160, height: 120 });
  world.goTo(game, 'cave', { x: 10, y: 10 });
  assert.deepEqual([first(game, 'hero').x, first(game, 'hero').y], [10, 10]);
  assert.deepEqual(world.visited(game), ['cave', 'forest', 'island']);
});

test('the hero stays inside the new room', () => {
  const { game, world } = make();
  world.goTo(game, 'island', { x: 9999, y: -50 });
  const h = first(game, 'hero');
  assert.deepEqual([h.x, h.y], [160 - 16, 0]);
});

test('what it remembers is plain data and the run is the same each time', () => {
  const play = () => {
    const { game, world, hero } = make();
    hero.x = 305;
    world.step(game);
    return JSON.stringify(game);
  };
  assert.equal(play(), play());
  assert.doesNotThrow(() => JSON.parse(play()));
});

test('a room with no loader, or a room that is not there, is explained', () => {
  const game = newGame();
  const world = makeWorld(DATA, { cave: () => ({}) });
  world.start(game);
  assert.throws(() => world.goTo(game, 'forest'), /gave it no way to load it/);
  assert.throws(() => world.goTo(game, 'moon'), /no room called "moon"/);
});

test('a world is made safe', () => {
  const clean = cleanWorld({ start: 'zzz', rooms: { a: { x: 1.4, file: 'scenes/a.js' }, '9bad': {}, b: null, c: { start: { x: 1, y: 2 } } },
    links: [{ from: 'a', to: 'c', via: { kind: 'edge', side: 'up' } }, { from: 'a', to: 'nope', via: { kind: 'edge', side: 'up' } }, { from: 'a',
      to: 'c', via: { kind: 'edge', side: 'sideways' } },
      { from: 'a', to: 'c', via: { kind: 'thing', name: 'd' }, arrive: { at: 'e' } }] });
  assert.deepEqual(Object.keys(clean.rooms), ['a', 'c']);
  assert.equal(clean.rooms.a.x, 1);
  assert.equal(clean.start, 'a', 'the start falls back to the first room');
  assert.equal(clean.links.length, 2);
  assert.deepEqual(clean.links[1].arrive, { at: 'e' });
  assert.deepEqual(cleanWorld(cleanWorld(DATA)), cleanWorld(DATA));
  assert.deepEqual(cleanWorld(null), { start: '', rooms: {}, links: [] });
});

test('worldProblems finds a start that is not a room, rooms nothing leads to, repeated edges and doors that are not there', () => {
  assert.deepEqual(worldProblems(DATA, { names: { cave: ['cave-door'], forest: ['forest-door'] } }), []);
  const text = (data, known) => worldProblems(data, known).map((p) => p.message).join(' | ');
  assert.match(text({ start: 'x', rooms: { a: {} }, links: [] }), /start "x" is not a room/);
  assert.match(text({ start: 'a', rooms: { a: {}, b: {} }, links: [] }), /"b" cannot be reached/);
  assert.match(text({ start: 'a', rooms: { a: {}, b: {} }, links: [{ from: 'a', to: 'b', via: { kind: 'edge', side: 'up' } }, { from: 'a', to: 'b',
    via: { kind: 'edge', side: 'up' } }] }),
    /up edge of "a" already leads somewhere/);
  assert.match(text(DATA, { names: { cave: [], forest: [] } }), /no thing called "cave-door" in "cave"/);
  assert.match(text(DATA, { names: { cave: ['cave-door'], forest: ['x'] } }), /no thing called "forest-door" in "forest" to arrive at/);
  assert.match(worldProblems({ start: '', rooms: {}, links: [] })[0].message, /no rooms/);
});
