import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanMask, shapesOf, frameFor, masksFor, masksFromGrid, shade, drawAutoTile, makeAutotileSprite, AUTOTILE_MODES,
} from '../src/autotile.js';
import { loadMap, retile } from '../src/map.js';
import { newGame, all, despawn } from '../src/things.js';
import { drawThings } from '../src/draw.js';
import { spriteProblem } from '../src/art.js';

const N = 1;
const E = 2;
const S = 4;
const W = 8;
const NE = 16;
const SE = 32;
const SW = 64;
const NW = 128;
const walls = (ch) => (ch === '#' ? 'wall' : null);

test('there are 16 shapes with four sides and 47 once corners are counted, and every neighbour mask has one', () => {
  assert.deepEqual(AUTOTILE_MODES, { edges4: 16, blob47: 47 });
  assert.equal(shapesOf('edges4').length, 16);
  assert.equal(shapesOf('blob47').length, 47);
  assert.equal(shapesOf('blob47')[0], 0, 'frame 0 is a tile on its own');
  assert.equal(new Set(shapesOf('blob47')).size, 47);
  for (let m = 0; m < 256; m++) {
    const f = frameFor(m, 'blob47');
    assert.ok(Number.isInteger(f) && f >= 0 && f < 47, `mask ${m}`);
    assert.equal(shapesOf('blob47')[f], cleanMask(m), 'the frame stands for the cleaned mask');
    assert.ok(frameFor(m, 'edges4') >= 0 && frameFor(m, 'edges4') < 16);
  }
  assert.equal(frameFor(N | E | S | W | NE | SE | SW | NW, 'blob47'), 46, 'surrounded on all sides is the last shape');
  assert.equal(frameFor(255, 'edges4'), 15);
});

test('a corner counts only when both sides next to it are there', () => {
  assert.equal(cleanMask(NE), 0, 'a corner alone is not seen');
  assert.equal(cleanMask(N | NE), N);
  assert.equal(cleanMask(N | E | NE), N | E | NE);
  assert.equal(cleanMask(N | E | S | W | NE | SW), N | E | S | W | NE | SW);
  assert.equal(cleanMask(S | W | NE), S | W, 'north-east is next to north and east, which are missing');
  assert.equal(frameFor(N | NE | SW, 'blob47'), frameFor(N, 'blob47'), 'masks that look the same share a picture');
});

test('the neighbours of every tile are found, with the map edge counting as more of the same (or as nothing)', () => {
  const rows = ['###', '###', '..#'];
  const m = masksFor(rows, walls);
  assert.equal(m[0][0], 255, 'the top-left tile: everything beyond the edge of the map joins, and so do its three neighbours');
  assert.equal(m[2][0], null, 'a letter with no terrain has no mask');
  const open = masksFor(rows, walls, { outside: 'open' });
  assert.equal(open[0][0], E | S | SE, 'with the edge open, the top-left tile has only east, south and south-east');
  assert.equal(open[1][1], N | E | W | NE | SE | NW, 'the middle: the south and south-west are gaps');
  assert.equal(open[2][2], N | NW, 'bottom-right: north, and the middle tile north-west of it');
  const lone = masksFor(['.#.'], walls, { outside: 'open' });
  assert.equal(lone[0][1], 0);
  assert.deepEqual(masksFromGrid([['a', 'b', 'a']], { outside: 'open' }), [[0, 0, 0]], 'different terrains do not join');
  assert.deepEqual(masksFromGrid([['a', 'a']], { outside: 'open' })[0], [E, W]);
  assert.deepEqual(masksFromGrid([]), []);
});

test('terrains join across letters: "=" and "#" in one terrain look connected, and two terrains side by side do not', () => {
  const sameTerrain = (ch) => (ch === '#' || ch === '=' ? 'stone' : ch === '~' ? 'water' : null);
  const m = masksFor(['#=~'], sameTerrain, { outside: 'open' });
  assert.equal(m[0][0], E);
  assert.equal(m[0][1], W);
  assert.equal(m[0][2], 0);
});

test('shade makes a colour darker or lighter and leaves what it does not understand', () => {
  assert.equal(shade('#808080', 0.5), '#404040');
  assert.equal(shade('#fff', 0.5), '#808080');
  assert.equal(shade('#101010', 100), '#ffffff');
  assert.equal(shade('red', 0.5), 'red');
  assert.equal(shade(undefined, 0.5), undefined);
});

function recorder() {
  const log = [];
  const g = new Proxy({}, { get: (_, n) => (n === 'log' ? log : (...a) => { log.push([n, ...a]); }), set: (_, n, v) => { log.push([`set:${n}`, v]); return true; } });
  return g;
}

test('a tile with no picture draws its colour, an edge on each side with no neighbour, and a notch at a missing corner', () => {
  const rects = (mask, o) => { const g = recorder(); drawAutoTile(g, 0, 0, 20, mask, '#808080', o); return g.log.filter((c) => c[0] === 'fillRect'); };
  assert.equal(rects(N | E | S | W | NE | SE | SW | NW).length, 1, 'surrounded: only the colour');
  assert.equal(rects(N | E | S | W | NE | SE | SW | NW)[0].slice(1).join(), '0,0,20,20');
  assert.equal(rects(N | E | S | NE | SE).length, 2, 'one missing side: the colour and one edge');
  assert.equal(rects(0).length, 5, 'alone: the colour and four edges');
  assert.equal(rects(N | E | S | W | NE | SE | SW).length, 2, 'a missing corner between neighbours: a notch');
  assert.equal(rects(N | E | S | W | NE | SE | SW)[1].slice(1).join(), '0,0,2,2');
  const g = recorder();
  drawAutoTile(g, 0, 0, 20, 0, '#808080', { edge: '#ff0000', width: 5 });
  assert.ok(g.log.some((c) => c[0] === 'set:fillStyle' && c[1] === '#ff0000'));
  assert.ok(g.log.some((c) => c[0] === 'fillRect' && c[4] === 5));
  const d = recorder();
  drawAutoTile(d, 0, 0, 20, 0, '#808080');
  assert.ok(d.log.some((c) => c[0] === 'set:fillStyle' && c[1] === '#535353'), 'the usual edge is a darker colour');
});

test('loadMap gives auto-tiled tiles their mask and picture number, leaves other tiles alone, and a game can read what it needs', () => {
  const game = newGame();
  loadMap(game, ['####', '#..#', '####'], { '#': { kind: 'wall', color: '#345', autotile: 'blob47' }, '.': { kind: 'floor' } });
  const walls = all(game, 'wall');
  assert.equal(walls.length, 10);
  assert.ok(walls.every((w) => Number.isInteger(w.mask) && Number.isInteger(w.frame) && w.autotile === 'blob47'));
  const corner = walls.find((w) => w.x === 0 && w.y === 0);
  assert.equal(corner.mask, 255 - SE, 'the map edge joins, so the corner has every neighbour except the open floor diagonally inside');
  const inner = all(game, 'floor');
  assert.ok(inner.every((f) => f.mask === undefined));
  const plain = newGame();
  loadMap(plain, ['##'], { '#': { kind: 'wall' } });
  assert.equal(all(plain, 'wall')[0].mask, undefined, 'no autotile in the legend: nothing changes');
  assert.deepEqual(plain.mapInfo, { columns: 2, rows: 1, tile: 32, openEdge: false });
});

test('openEdge makes the border of the map an edge; terrain makes different letters join', () => {
  const game = newGame();
  loadMap(game, ['#=#'], { '#': { kind: 'wall', autotile: 'edges4', terrain: 'stone', openEdge: true }, '=': { kind: 'wall', autotile: 'edges4', terrain: 'stone' } });
  const [a, b, c] = all(game, 'wall');
  assert.equal(a.frame, E, 'edges4: only the east neighbour');
  assert.equal(b.frame, E | W);
  assert.equal(c.frame, W);
});

test('retile works out the shapes again after tiles come and go, and tiles that were never auto-tiled are left alone', () => {
  const game = newGame();
  loadMap(game, ['###', '###', '###'], { '#': { kind: 'wall', color: '#345', autotile: 'blob47', openEdge: true } });
  const middle = all(game, 'wall').find((w) => w.x === 32 && w.y === 32);
  assert.equal(middle.frame, shapesOf('blob47').length - 1);
  despawn(game, all(game, 'wall').find((w) => w.x === 32 && w.y === 0));
  retile(game);
  assert.equal(middle.mask & N, 0, 'the tile above is gone: the middle has no north neighbour');
  assert.equal(middle.frame, frameFor(middle.mask, 'blob47'));
  const topLeft = all(game, 'wall').find((w) => w.x === 0 && w.y === 0);
  assert.equal(topLeft.mask & E, 0);
  assert.doesNotThrow(() => retile({}));
  const plain = newGame();
  loadMap(plain, ['##'], { '#': { kind: 'wall' } });
  retile(plain);
  assert.equal(all(plain, 'wall')[0].mask, undefined);
});

test('drawThings draws auto-tiles with edges, and a picture when there is one', () => {
  const game = newGame();
  loadMap(game, ['#.'], { '#': { kind: 'wall', color: '#345', autotile: 'edges4', openEdge: true }, '.': { kind: 'gap', color: '#000' } });
  const g = recorder();
  drawThings(g, game, {});
  const fills = g.log.filter((c) => c[0] === 'fillRect');
  assert.ok(fills.length >= 4, 'the wall drew its colour and three edges');
  const sprite = makeAutotileSprite({ w: 4, h: 4, palette: { a: '#336699' }, frames: [['aaaa', 'aaaa', 'aaaa', 'aaaa']] }, 'edges4');
  const pictured = newGame();
  loadMap(pictured, ['#'], { '#': { kind: 'wall', sprite: 'ground', autotile: 'edges4' } });
  assert.equal(all(pictured, 'wall')[0].frame, 15 & frameFor(255, 'edges4'));
  assert.equal(spriteProblem(sprite), null);
});

test('an auto-tile sprite is made from one plain tile: the right number of frames, edges only where a side has no neighbour, a notch for a missing corner', () => {
  const base = { w: 8, h: 8, palette: { a: '#336699' }, frames: [Array(8).fill('aaaaaaaa')] };
  for (const mode of ['edges4', 'blob47']) {
    const s = makeAutotileSprite(base, mode);
    assert.equal(s.frames.length, AUTOTILE_MODES[mode], mode);
    assert.equal(spriteProblem(s), null, `${mode} is a sprite the kit accepts`);
    assert.ok(Object.keys(s.palette).length === 2, 'one new colour: the edge');
    assert.deepEqual(s.palette.a, '#336699');
  }
  const blob = makeAutotileSprite(base, 'blob47');
  const edge = Object.keys(blob.palette).find((k) => k !== 'a');
  const plain = blob.frames[shapesOf('blob47').indexOf(0xff)];
  assert.ok(plain.every((r) => r === 'aaaaaaaa'), 'surrounded on all sides: the plain tile');
  const alone = blob.frames[0];
  assert.equal(alone[0][3], edge, 'on its own: edges on every side');
  assert.equal(alone[3][0], edge);
  assert.equal(alone[0][0], '.', 'the outer corner pixel is rounded away');
  const noNorth = blob.frames[shapesOf('blob47').indexOf(E | S | W | SE | SW)];
  assert.equal(noNorth[0][4], edge);
  assert.equal(noNorth[7][4], 'a', 'the south has a neighbour: no edge');
  const notch = blob.frames[shapesOf('blob47').indexOf(N | E | S | W | SE | SW | NW)];
  assert.equal(notch[0][7], edge, 'the missing north-east corner shows as a notch');
  assert.equal(notch[0][0], 'a');
  const thick = makeAutotileSprite(base, 'edges4', { width: 3, edge: '#ffffff', round: false });
  assert.equal(thick.palette[Object.keys(thick.palette).find((k) => k !== 'a')], '#ffffff');
  assert.equal(thick.frames[0][0][0], Object.keys(thick.palette).find((k) => k !== 'a'), 'rounding can be switched off');
  assert.throws(() => makeAutotileSprite(base, 'blob99'), /two modes/);
  const used = makeAutotileSprite({ w: 4, h: 4, palette: Object.fromEntries([...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].slice(0, 20).map((c, i) => [c, `#${(i + 16).toString(16)}0000`])), frames: [['aaaa', 'aaaa', 'aaaa', 'aaaa']] }, 'edges4');
  assert.ok(!(Object.keys(used.palette).length > 21), 'a free letter is found even when many are taken');
  const transparent = makeAutotileSprite({ w: 4, h: 4, palette: { a: '#336699' }, frames: [['.aa.', 'aaaa', 'aaaa', '.aa.']] }, 'edges4');
  assert.equal(transparent.frames[0][0][0], '.', 'see-through pixels stay see-through');
});
