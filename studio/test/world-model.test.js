import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../app/paint/world-model.js';
import { serializeScene } from '../app/paint/scene-model.js';

const build = () => {
  let w = W.newWorld();
  w = W.addRoom(w, 'scenes/cave.js').world;
  w = W.addRoom(w, 'scenes/dark-forest.js').world;
  w = W.addRoom(w, 'src/levels/island.js').world;
  return w;
};

test('rooms are added for files, to the right of the others, and the first is the start', () => {
  const w = build();
  assert.deepEqual(Object.keys(w.rooms), ['cave', 'dark-forest', 'island']);
  assert.equal(w.start, 'cave');
  assert.ok(w.rooms['dark-forest'].x > w.rooms.cave.x && w.rooms.island.x > w.rooms['dark-forest'].x);
  assert.equal(W.addRoom(w, 'scenes/cave.js').room, 'cave2', 'a free name');
  assert.deepEqual(W.roomFiles(['scenes/a.js', 'src/levels/b.js', 'src/main.js', 'scenes/c.json', 'src/levels/x/y.js']), ['scenes/a.js',
    'src/levels/b.js']);
});

test('a world writes out and reads back the same, and a hand-edited one is cleaned', () => {
  let w = build();
  w = W.addLink(w, { from: 'cave', to: 'dark-forest', via: { kind: 'edge', side: 'right' } }, true).world;
  w = W.addLink(w, { from: 'cave', to: 'island', via: { kind: 'thing', name: 'boat' }, arrive: { at: 'dock' } }).world;
  assert.deepEqual(W.parseWorld(W.serializeWorld(w)), w);
  const t = W.parseWorld('export default { "start": "zz", "rooms": { "a": {}, "9": {} }, "links": [{ "from": "a", "to": "q", "via": { "kind": "edge", "side": "up" } }] };');
  assert.deepEqual([t.start, Object.keys(t.rooms), t.links.length], ['a', ['a'], 0]);
  assert.throws(() => W.parseWorld('nothing'), /not a world/);
  assert.throws(() => W.parseWorld('export default { oops };'), /plain JSON/);
  assert.throws(() => W.parseWorld('export default { "start": "a" };'), /"start", "rooms" and "links"/);
});

test('moving, renaming, starting and removing keep the links in step', () => {
  let w = build();
  w = W.addLink(w, { from: 'cave', to: 'dark-forest', via: { kind: 'edge', side: 'right' } }, true).world;
  assert.equal(W.moveRoom(w, 'cave', 33, 47).rooms.cave.x, 30, 'snapped to the nearest 10');
  assert.equal(W.moveRoom(w, 'cave', -50, -50).rooms.cave.x, 0);
  const renamed = W.renameRoom(w, 'cave', 'grotto');
  assert.equal(renamed.start, 'grotto');
  assert.deepEqual(renamed.links.map((l) => [l.from, l.to]), [['grotto', 'dark-forest'], ['dark-forest', 'grotto']]);
  assert.throws(() => W.renameRoom(w, 'cave', 'island'), /already a room/);
  assert.throws(() => W.renameRoom(w, 'cave', '9x'), /Use letters/);
  assert.equal(W.setStart(w, 'island').start, 'island');
  const gone = W.removeRoom(w, 'cave');
  assert.deepEqual(Object.keys(gone.rooms), ['dark-forest', 'island']);
  assert.equal(gone.links.length, 0, 'links to and from it go');
  assert.equal(gone.start, 'dark-forest');
  assert.equal(W.removeRoom(W.removeRoom(W.removeRoom(w, 'cave'), 'dark-forest'), 'island').start, '');
});

test('links are added (two ways with their opposite edge), changed and removed', () => {
  let w = build();
  const r = W.addLink(w, { from: 'cave', to: 'dark-forest', via: { kind: 'edge', side: 'right' } }, true);
  w = r.world;
  assert.deepEqual(r.indexes, [0, 1]);
  assert.deepEqual(w.links[1], { from: 'dark-forest', to: 'cave', via: { kind: 'edge', side: 'left' } });
  assert.throws(() => W.addLink(w, { from: 'cave', to: 'moon', via: { kind: 'edge', side: 'up' } }), /two rooms/);
  w = W.setLink(w, 0, { arrive: { side: 'down' } });
  assert.deepEqual(w.links[0].arrive, { side: 'down' });
  w = W.setLink(w, 0, { arrive: null });
  assert.equal(w.links[0].arrive, undefined);
  assert.equal(W.setLink(w, 0, { via: { kind: 'edge', side: 'nowhere' } }), w, 'a link that would not be one is refused');
  assert.throws(() => W.setLink(w, 0, { colour: 'red' }), /not part of a link/);
  assert.deepEqual(W.linksOf(w, 'cave'), [0, 1]);
  assert.equal(W.removeLink(w, 0).links.length, 1);
  assert.equal(W.suggestSide(w, 'cave', 'dark-forest'), 'right');
  assert.equal(W.suggestSide(w, 'dark-forest', 'cave'), 'left');
});

test('a room\'s size comes from its scene or its level, and a scene gives the names of its things', () => {
  const scene = serializeScene({ w: 640, h: 360, things: [{ kind: 'door', x: 0, y: 0, w: 10, h: 10, extra: { name: 'gate' } }, { kind: 'rock', x: 0,
    y: 0, w: 5, h: 5 }] });
  assert.deepEqual(W.roomSize(scene, 'scenes/a.js'), { w: 640, h: 360 });
  assert.deepEqual(W.namesIn(scene, 'scenes/a.js'), ['gate']);
  const level = "const TILE = 16;\nconst LEVEL = [\n  '#####',\n  '#...#',\n  '#####',\n];\n";
  assert.deepEqual(W.roomSize(level, 'src/levels/b.js'), { w: 80, h: 48 });
  assert.deepEqual(W.roomSize("const LEVEL = [\n  '#####',\n  '#...#',\n  '#####',\n];\n", 'src/levels/b.js'), { w: 160, h: 96 },
    'tiles are 32 when the file does not say');
  assert.equal(W.roomSize('nonsense', 'scenes/a.js'), null);
  assert.deepEqual(W.namesIn('x', 'src/levels/b.js'), []);
});

test('the checker knows which doors exist in which room', () => {
  let w = build();
  w = W.addRoom(W.removeRoom(w, 'island'), 'scenes/hall.js').world;
  w.rooms.cave.file = 'scenes/cave.js';
  w = W.addLink(w, { from: 'cave', to: 'hall', via: { kind: 'thing', name: 'gate' }, arrive: { at: 'mat' } }).world;
  const texts = { 'scenes/cave.js': serializeScene({ w: 100, h: 100, things: [{ kind: 'd', x: 0, y: 0, w: 1, h: 1, extra: { name: 'gate' } }] }),
    'scenes/hall.js': serializeScene({ w: 100, h: 100, things: [] }) };
  w.rooms.hall.file = 'scenes/hall.js';
  const known = W.knownNames(w, (p) => texts[p] ?? '');
  assert.deepEqual(known.names, { cave: ['gate'], 'dark-forest': [], hall: [] });
  const found = W.worldProblems(w, known).map((p) => p.message).join(' | ');
  assert.match(found, /no thing called "mat" in "hall" to arrive at/);
  assert.match(found, /"dark-forest" cannot be reached/);
  assert.equal(W.describeLink(w.links[0]), 'cave through the door "gate" to hall to "mat"');
});
