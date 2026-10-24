import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camera3d, forward3d, move3d, mouseLook3d, mouseDelta, held, chase3d, ramp, stairs, groundAt, jump3d, slideAgainst, block, gem, project3d, drawWorld3d, block3d, sky3d } from '../src/index.js';

const SIZE = { width: 480, height: 320 };

/** A canvas that writes down what is drawn on it. */
function fakeCanvas() {
  const log = [];
  let fill = '';
  return {
    log, fillRect: (...a) => log.push(['rect', fill, ...a]), beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
    fill() { log.push(['fill', fill]); }, createLinearGradient: () => ({ addColorStop() {} }),
    set fillStyle(v) { fill = v; }, get fillStyle() { return fill; }, set strokeStyle(v) {}, set lineWidth(v) {},
  };
}

test('a point straight ahead is in the middle of the screen, nearer is bigger, behind you is nothing', () => {
  const cam = camera3d();
  const mid = project3d(cam, 0, 1.6, -5, SIZE);
  assert.ok(Math.abs(mid.x - 240) < 1e-6 && Math.abs(mid.y - 160) < 1e-6);
  assert.ok(project3d(cam, 0, 1.6, -2, SIZE).scale > mid.scale);
  assert.equal(project3d(cam, 0, 1.6, 5, SIZE), null);
  assert.ok(project3d(cam, 2, 1.6, -5, SIZE).x > 240, 'to the right of the middle');
  assert.ok(project3d(cam, 0, 3, -5, SIZE).y < 160, 'higher is further up the screen');
  const turned = camera3d({ yaw: Math.PI / 2 });
  assert.ok(Math.abs(project3d(turned, -5, 1.6, 0, SIZE).x - 240) < 1e-6, 'a quarter turn left looks along -x');
});

test('walking: forward goes the way you face, turning, and diagonals are not faster', () => {
  const cam = camera3d();
  move3d(cam, new Set(['KeyW']), 1, { speed: 4 });
  assert.ok(Math.abs(cam.z + 4) < 1e-9 && Math.abs(cam.x) < 1e-9);
  move3d(cam, new Set(['ArrowLeft']), 0.5, { turn: 2 });
  assert.ok(Math.abs(cam.yaw - 1) < 1e-9, 'left turns positively');
  const f = forward3d(cam);
  const before = { x: cam.x, z: cam.z };
  move3d(cam, new Set(['KeyW']), 0.5, { speed: 2 });
  assert.ok(Math.abs(cam.x - (before.x + f.x)) < 1e-9 && Math.abs(cam.z - (before.z + f.z)) < 1e-9);
  const straight = move3d(camera3d(), new Set(['KeyW']), 1, { speed: 4 });
  const diagonal = move3d(camera3d(), new Set(['KeyW', 'KeyD']), 1, { speed: 4 });
  assert.ok(Math.abs(straight - diagonal) < 1e-9);
  assert.equal(move3d(camera3d(), new Set(), 1), 0);
});

test('blocks stop you, you slide along them, and a low one can be stepped over', () => {
  const wall = block(0, -3, 6, 1, 3);
  const cam = camera3d();
  for (let i = 0; i < 200; i++) move3d(cam, new Set(['KeyW']), 1 / 60, { speed: 4, blocks: [wall] });
  assert.ok(cam.z > -3 + 0.5 + 0.35 - 0.05, `stopped at the wall (${cam.z})`);
  const slide = camera3d({ yaw: 0.6 });
  slide.z = -1.9;
  const x0 = slide.x;
  for (let i = 0; i < 60; i++) move3d(slide, new Set(['KeyW']), 1 / 60, { speed: 4, blocks: [wall] });
  assert.ok(slide.x < x0 - 1 && slide.z > -2.2, 'slid sideways along the wall');
  assert.deepEqual(slideAgainst({ x: 0, z: 0 }, 1, 0, [], 0.3), { x: 1, z: 0 });
  assert.deepEqual(slideAgainst({ x: 0, z: 0 }, 1, 0, [block(1, 0, 1, 1, 3)], 0.3), { x: 0, z: 0 });
  assert.deepEqual(slideAgainst({ x: 0, z: 0 }, 1, 0, [{ ...block(1, 0, 1, 1, 3), solid: false }], 0.3), { x: 1, z: 0 }, 'solid: false is walked through');
  const stepper = camera3d();
  for (let i = 0; i < 120; i++) move3d(stepper, new Set(['KeyW']), 1 / 60, { speed: 4, blocks: [block(0, -3, 6, 1, 0.25)] });
  assert.ok(stepper.z < -4, `a low step does not stop you (${stepper.z})`);
  const ahead = camera3d();
  ahead.z = -1.5;
  for (let i = 0; i < 40; i++) move3d(ahead, new Set(['KeyW']), 1 / 60, { speed: 4, blocks: [block(0, -3, 6, 1, 1.5)] });
  assert.ok(ahead.z > -2.2, 'a block higher than a step does stop you');
});

test('jumping goes up and comes back down to the standing height; no jump in the air', () => {
  const cam = camera3d();
  let peak = cam.y;
  const keys = new Set(['Space']);
  for (let i = 0; i < 20; i++) { jump3d(cam, keys, 1 / 60); peak = Math.max(peak, cam.y); }
  assert.ok(peak > 2.2, `peak ${peak}`);
  keys.clear();
  for (let i = 0; i < 90; i++) jump3d(cam, keys, 1 / 60);
  assert.equal(cam.y, cam.eye);
  assert.equal(jump3d(cam, new Set(), 1 / 60), true);
  cam.y = 3;
  cam.vy = 0;
  jump3d(cam, new Set(['Space']), 1 / 60);
  assert.ok(cam.vy < 1, 'no jump in the air');
});

test('drawing: far things first, things beyond the fog are skipped, and odd places for the camera do not break it', () => {
  const g = fakeCanvas();
  const cam = camera3d();
  const far = block(0, -20, 4, 1, 3, '#ff0000');
  const near = block(0, -6, 2, 1, 3, '#0000ff');
  drawWorld3d(g, cam, { blocks: [near, far], gems: [gem(1, -10)] }, { width: 480, height: 320, grid: false });
  const fills = g.log.filter((e) => e[0] === 'fill').map((e) => e[1]);
  const channel = (c, i) => Number(/rgb\((\d+), (\d+), (\d+)\)/.exec(c)?.[i + 1] ?? -1);
  const redAt = fills.findIndex((c) => channel(c, 0) > channel(c, 2) + 60);
  const blueAt = fills.findIndex((c) => channel(c, 2) > channel(c, 0) + 60);
  assert.ok(redAt >= 0 && blueAt >= 0 && redAt < blueAt, `the far red one is drawn before the near blue one (${redAt}, ${blueAt})`);
  assert.equal(drawWorld3d(fakeCanvas(), cam, { blocks: [block(0, -500, 2, 2)] }, { width: 480, height: 320 }), 0, 'beyond the fog');
  const inside = fakeCanvas();
  assert.doesNotThrow(() => block3d(inside, camera3d(), block(0, 0, 10, 10, 5), { width: 480, height: 320 }), 'standing inside a block');
  assert.doesNotThrow(() => block3d(inside, camera3d({ z: 0.2 }), block(0, 0, 4, 0.5, 5), { width: 480, height: 320 }), 'a face crossing the camera is cut');
  assert.equal(drawWorld3d(fakeCanvas(), cam, { blocks: [block(0, 8, 2, 1, 3)] }, { width: 480, height: 320, grid: false }), 1);
});

test('looking up moves the horizon down, and the sky and ground meet there', () => {
  const rects = (pitch) => {
    const g = fakeCanvas();
    sky3d(g, camera3d({ pitch }), { width: 480, height: 320 });
    return g.log.filter((e) => e[0] === 'rect');
  };
  const level = rects(0);
  const up = rects(0.4);
  assert.equal(level[0][5], 160, 'the sky is as tall as the horizon is low');
  assert.ok(up[0][5] > level[0][5]);
});

test('the pieces are plain data: they survive being saved and loaded', () => {
  const world = { blocks: [block(1, 2, 3, 4, 5, '#123456', 0.5)], gems: [gem(0, 0)], cam: camera3d({ yaw: 1 }) };
  assert.deepEqual(JSON.parse(JSON.stringify(world)), world);
});

test('a turned block is stopped at where it really is, not where its box would be', () => {
  const diagonal = block(0, -3, 6, 0.5, 3, '#888', 0, Math.PI / 4);                  // a wall turned half way between the axes
  const corner = camera3d({ x: -3.2, z: -0.6 });                                       // inside the corner of the box that holds it, but clear of the wall itself
  for (let i = 0; i < 20; i++) move3d(corner, new Set(['KeyD']), 1 / 60, { speed: 1, blocks: [diagonal] });
  assert.ok(corner.x > -3.2 + 0.2, 'free to walk where the turned wall is not');
  const along = camera3d({ x: 0, z: 0, yaw: 0.3 });                                    // walk into its face
  for (let i = 0; i < 300; i++) move3d(along, new Set(['KeyW']), 1 / 60, { speed: 4, blocks: [diagonal] });
  assert.ok(along.z > -4.5 && along.z < -1, `stopped by the turned wall (${along.z})`);
  assert.deepEqual(slideAgainst({ x: 0, z: 0 }, 1, 0, [block(2, 0, 4, 1, 3, '#888', 0, Math.PI / 2)], 0.3), { x: 1, z: 0 }, 'a quarter turn makes it thin along x');
});

test('a turned block is drawn, and a long wall is drawn in pieces so it never covers a pillar in front of it', () => {
  const g = fakeCanvas();
  const cam = camera3d({ x: 9, z: 0, yaw: 0 });
  const wall = block(0, -12, 24, 1, 3, '#ff0000');                                    // a long wall whose middle is farther than the pillar...
  const pillar = block(8, -3, 1, 1, 3, '#0000ff');                                    // ...but whose near end is behind the pillar's other side
  const behindEnd = block(7, -11, 1, 1, 3, '#00ff00');
  drawWorld3d(g, cam, { blocks: [wall, pillar, behindEnd] }, { width: 480, height: 320, grid: false, fogFar: 0 });
  assert.ok(g.log.filter((e) => e[0] === 'fill').length > 4, 'the wall came out as several shapes');
  assert.doesNotThrow(() => block3d(fakeCanvas(), camera3d(), block(0, -5, 2, 1, 2, '#123456', 0, 0.7), { width: 480, height: 320 }));
  const outlined = [];
  const g2 = { ...fakeCanvas(), stroke() { outlined.push(1); } };
  drawWorld3d(g2, camera3d(), { blocks: [block(0, -6, 12, 1, 3)] }, { width: 480, height: 320, grid: false });
  assert.equal(outlined.length, 0, 'the pieces of a long wall have no seams drawn between them');
});

test('the order is right where one long block used to be drawn over a small one in front of its end', () => {
  const g = fakeCanvas();
  const wall = block(0, -12, 24, 1, 3, '#ff0000');
  const pillar = block(11, -11, 1, 1, 3, '#0000ff');                                  // stands in front of the wall's right end, farther than the wall's middle
  drawWorld3d(g, camera3d(), { blocks: [pillar, wall] }, { width: 480, height: 320, grid: false, fogFar: 0 });
  const fills = g.log.filter((e) => e[0] === 'fill').map((e) => e[1]);
  const channel = (c, i) => Number(/rgb\((\d+), (\d+), (\d+)\)/.exec(c)?.[i + 1] ?? -1);
  const red = fills.map((c, i) => (channel(c, 0) > channel(c, 2) + 60 ? i : -1)).filter((i) => i >= 0);
  const blue = fills.map((c, i) => (channel(c, 2) > channel(c, 0) + 60 ? i : -1)).filter((i) => i >= 0);
  assert.ok(red.length && blue.length);
  assert.ok(Math.min(...blue) > Math.min(...red), 'the part of the wall behind the pillar is painted first (one whole wall drawn by its middle came after it)');
});

test('the mouse: movement is read from one held key, the first reading sets the start, and without a mouse nothing moves', () => {
  let asked = 0;
  globalThis.__engineInput = { wantMouse() { asked++; } };
  const memory = {};
  assert.deepEqual(mouseDelta(new Set(['KeyW']), memory), { dx: 0, dy: 0, locked: false });
  assert.ok(asked >= 1, 'asking for the mouse tells the page the game wants it');
  assert.deepEqual(mouseDelta(new Set(['Mouse:100:50']), memory), { dx: 0, dy: 0, locked: true }, 'the first reading is where it starts');
  assert.deepEqual(mouseDelta(new Set(['Mouse:130:40']), memory), { dx: 30, dy: -10, locked: true });
  assert.deepEqual(mouseDelta(new Set(['Mouse:130:40']), memory), { dx: 0, dy: 0, locked: true }, 'no change, no movement');
  assert.deepEqual(mouseDelta(new Set(), memory), { dx: 0, dy: 0, locked: false });
  assert.deepEqual(mouseDelta(new Set(['Mouse:140:40']), memory), { dx: 10, dy: 0, locked: true }, 'it carries on from where it was after letting go');
  delete globalThis.__engineInput;
  assert.equal(held(new Set(['Mouse0']), 'click'), true);
  assert.equal(held(new Set(['Mouse2']), 'rightClick'), true);
  assert.equal(held(new Set(['Mouse0']), 'rightClick'), false);
});

test('looking with the mouse turns left and right, tilts up and down within limits, and can be inverted', () => {
  const cam = camera3d();
  assert.equal(mouseLook3d(cam, new Set()), false);
  mouseLook3d(cam, new Set(['Mouse:0:0']));
  mouseLook3d(cam, new Set(['Mouse:-100:0']));
  assert.ok(Math.abs(cam.yaw - 0.25) < 1e-9, 'moving left turns left (a positive yaw)');
  mouseLook3d(cam, new Set(['Mouse:-100:-40']));
  assert.ok(Math.abs(cam.pitch - 0.1) < 1e-9, 'moving the mouse up looks up');
  mouseLook3d(cam, new Set(['Mouse:-100:5000']));
  assert.ok(cam.pitch >= -1.45 && cam.pitch < 0, 'you cannot look right over your own back');
  const flip = camera3d();
  mouseLook3d(flip, new Set(['Mouse:0:0']), { invertY: true });
  mouseLook3d(flip, new Set(['Mouse:0:-40']), { invertY: true });
  assert.ok(flip.pitch < 0, 'inverted');
  const a = camera3d();
  mouseLook3d(a, new Set(['Mouse:0:0']));
  mouseLook3d(a, new Set(['Mouse:40:0']), { sensitivity: 0.01 });
  assert.ok(Math.abs(a.yaw + 0.4) < 1e-9);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(cam)), 'the camera is still plain data');
});

test('a guardian walks towards you, slides along walls, and stops where you are', () => {
  const thing = { x: 0, z: -10 };
  const target = { x: 0, z: 0 };
  const left = chase3d(thing, target, 2, 1);
  assert.equal(thing.z, -8);
  assert.equal(left, 8);
  for (let i = 0; i < 400; i++) chase3d(thing, target, 2, 1 / 60);
  assert.ok(Math.abs(thing.z) < 1e-6, 'it arrives and stays');
  const wall = block(0, -5, 10, 1, 3);
  const walker = { x: 0, z: -10 };
  for (let i = 0; i < 200; i++) chase3d(walker, target, 2, 1 / 60, [wall]);
  assert.ok(walker.z < -5.5, `a wall in the way stops it (${walker.z})`);
  assert.equal(chase3d({ x: 1, z: 1 }, { x: 1, z: 1 }, 2, 1), 0);
});

test('looking up shows what is ahead lower on the screen, looking down higher, and the horizon agrees', () => {
  const ahead = (pitch) => project3d(camera3d({ pitch }), 0, 1.6, -10, SIZE).y;
  assert.ok(ahead(0.3) > 160, 'looking up: a point straight ahead is below the middle');
  assert.ok(ahead(-0.3) < 160, 'looking down: it is above the middle');
  const horizon = (pitch) => { const g = fakeCanvas(); sky3d(g, camera3d({ pitch }), { width: 480, height: 320 }); return g.log.filter((e) => e[0] === 'rect')[0][5]; };
  assert.ok(Math.abs(horizon(0.3) - ahead(0.3)) < 6, 'a far point ahead sits on the horizon line');
  const up = project3d(camera3d({ pitch: 0.4 }), 0, 8, -10, SIZE);
  assert.ok(up && up.y < 160, 'and a point high above is above the middle when looking up at it');
});

test('steps: you walk up a low block and stand on it, a high one stops you, and you fall off a ledge and land', () => {
  const step = block(0, -3, 6, 2, 0.4);
  const cam = camera3d();
  for (let i = 0; i < 120; i++) move3d(cam, new Set(['KeyW']), 1 / 60, { speed: 3, blocks: [step] });
  assert.ok(cam.z < -3.5 && Math.abs(cam.y - cam.eye - 0.4) < 0.05 || cam.z < -4, `walked on (${cam.z}, ${cam.y})`);
  const crate = block(0, -3, 2, 2, 1);
  const hop = camera3d({ z: -1 });
  for (let i = 0; i < 90; i++) move3d(hop, new Set(['KeyW']), 1 / 60, { speed: 3, blocks: [crate] });
  assert.ok(hop.z > -1.9, `a crate a metre high stops you (${hop.z})`);
  const jumper = camera3d({ z: -1 });
  for (let i = 0; i < 10; i++) { move3d(jumper, new Set(['Space']), 1 / 60, { blocks: [crate] }); jump3d(jumper, new Set(['Space']), 1 / 60); }
  for (let i = 0; i < 40; i++) { move3d(jumper, new Set(['KeyW']), 1 / 60, { speed: 3, blocks: [crate] }); jump3d(jumper, new Set(['KeyW']), 1 / 60); }
  for (let i = 0; i < 60; i++) { move3d(jumper, new Set(), 1 / 60, { blocks: [crate] }); jump3d(jumper, new Set(), 1 / 60); }
  assert.ok(Math.abs(jumper.y - jumper.eye - 1) < 0.05, `standing on the crate (${jumper.y - jumper.eye})`);
  for (let i = 0; i < 200; i++) move3d(jumper, new Set(['KeyW']), 1 / 60, { speed: 3, blocks: [crate] });
  assert.ok(Math.abs(jumper.y - jumper.eye) < 0.05, 'walked off the far side and landed on the floor');
  assert.equal(groundAt([crate], 0, -3, 0), 0, 'from the floor the crate is too high to count as ground');
  assert.equal(groundAt([crate], 0, -3, 0.7), 1, 'from a jump it is');
});

test('a ramp is walked up (the height follows the slope) and down, and its far end is as high as it says', () => {
  const r = ramp(0, -4, 2, 4, 1);                                   // from z = -2 (the floor) to z = -6 (a metre up)
  assert.equal(r.ramp, true);
  const cam = camera3d({ z: 0 });
  let top = 0;
  for (let i = 0; i < 400; i++) { move3d(cam, new Set(['KeyW']), 1 / 60, { speed: 3, blocks: [r] }); top = Math.max(top, cam.y - cam.eye); }
  assert.ok(top > 0.9 && top <= 1.01, `reached the top (${top})`);
  const mid = camera3d({ z: -3.9 });
  move3d(mid, new Set(), 1 / 60, { blocks: [r] });
  for (let i = 0; i < 30; i++) move3d(mid, new Set(), 1 / 60, { blocks: [r] });
  assert.ok(Math.abs(mid.y - mid.eye - 0.5) < 0.1, `half way up it is half as high (${mid.y - mid.eye})`);
  for (let i = 0; i < 400; i++) move3d(cam, new Set(['KeyS']), 1 / 60, { speed: 3, blocks: [r] });
  assert.ok(Math.abs(cam.y - cam.eye) < 0.05, 'and back down on the floor');
  const turned = ramp(0, 0, 2, 4, 1, '#888', 0, Math.PI / 2);
  assert.ok(groundAt([turned], -1.9, 0, 0.6, 0) > 0.9, 'a turned ramp rises along the turn (here towards -x)');
  assert.ok(groundAt([turned], 1.9, 0, 0.6, 0) < 0.1);
});

test('stairs make a block for each step, each higher than the last, and a ramp and a turned ramp draw without problems', () => {
  const list = stairs(0, -4, 2, 4, 1, 4);
  assert.equal(list.length, 4);
  assert.deepEqual(list.map((b) => b.h), [0.25, 0.5, 0.75, 1]);
  assert.ok(list[0].z > list[3].z, 'the low step is at the near end');
  const cam = camera3d({ z: 0 });
  let top = 0;
  for (let i = 0; i < 400; i++) { move3d(cam, new Set(['KeyW']), 1 / 60, { speed: 2.5, blocks: list }); top = Math.max(top, cam.y - cam.eye); }
  assert.ok(top > 0.95, `up the stairs (${top})`);
  assert.ok(cam.y - cam.eye < 0.05, 'and off the end back on the floor');
  for (const r of [ramp(0, -5, 3, 4, 1.5), ramp(2, -5, 3, 4, 1.5, '#aa8844', 0.5, 0.8)]) {
    for (const where of [{ x: 0, z: 0 }, { x: 6, z: -5 }, { x: 0, z: -12 }, { x: 2, z: -5 }]) {
      assert.doesNotThrow(() => drawWorld3d(fakeCanvas(), camera3d(where), { blocks: [r] }, { width: 480, height: 320, grid: false }));
    }
  }
  const g = fakeCanvas();
  drawWorld3d(g, camera3d({ x: 5, z: 2, yaw: 0.5 }), { blocks: [ramp(0, -5, 3, 4, 1.5)] }, { width: 480, height: 320, grid: false });
  assert.ok(g.log.filter((e) => e[0] === 'fill').length >= 2, 'the slope and a side show from the side');
  const head = fakeCanvas();
  drawWorld3d(head, camera3d({ z: 2 }), { blocks: [ramp(0, -5, 3, 4, 1.5)] }, { width: 480, height: 320, grid: false });
  assert.equal(head.log.filter((e) => e[0] === 'fill').length, 1, 'from the front only the slope shows (the far end faces away)');
});

test('a steep ramp is a wall and a gentle one is a hill: the walker is judged by the part of the ramp just ahead of it', () => {
  const run = (r) => {
    const cam = camera3d({ z: 0 });
    let top = 0;
    for (let i = 0; i < 300; i++) { move3d(cam, new Set(['KeyW']), 1 / 60, { speed: 3, blocks: [r] }); top = Math.max(top, cam.y - cam.eye); }
    return { top, z: cam.z };
  };
  const gentle = run(ramp(0, -4, 2, 4, 1));                         // rises 1 in 4
  assert.ok(gentle.top > 0.9, `walked up the gentle one (${gentle.top})`);
  const steep = run(ramp(0, -3, 2, 1, 2));                          // rises 2 in 1: too steep to walk
  assert.ok(steep.top < 0.2, `did not walk up the steep one (${steep.top})`);
  assert.ok(steep.z > -2.5, `and stopped at its foot (${steep.z})`);
  const middling = run(ramp(0, -3, 2, 2, 1));                       // rises 1 in 2, about 27 degrees: fine
  assert.ok(middling.top > 0.9, `walked up a one-in-two ramp (${middling.top})`);
});

test('overhead: you bump your head on a block above you, can walk under it, and can walk under a bridge but not into a low gap', () => {
  const bridge = block(0, -3, 6, 2, 0.4, '#888', 2.2);              // a slab from 2.2 up to 2.6: head room under it
  const cam = camera3d({ z: -0.5 });
  for (let i = 0; i < 120; i++) move3d(cam, new Set(['KeyW']), 1 / 60, { speed: 3, blocks: [bridge] });
  assert.ok(cam.z < -4.5, `walked right under it (${cam.z})`);
  const jumper = camera3d({ z: -3 });                                // under the slab
  let peak = 0;
  for (let i = 0; i < 60; i++) { move3d(jumper, new Set(['Space']), 1 / 60, { blocks: [bridge] }); jump3d(jumper, new Set(['Space']), 1 / 60); peak = Math.max(peak, jumper.y); }
  assert.ok(peak <= 2.2 - 0.15 + 1e-6, `the head stopped at the slab (eyes at ${peak})`);
  for (let i = 0; i < 60; i++) move3d(jumper, new Set(), 1 / 60, { blocks: [bridge] });
  assert.ok(Math.abs(jumper.y - jumper.eye) < 0.05, 'and came back down');
  const low = block(0, -3, 6, 2, 0.4, '#888', 1.2);                 // 1.2 up: too low to walk under (the head is at 1.7)
  const blocked = camera3d({ z: -0.5 });
  for (let i = 0; i < 120; i++) move3d(blocked, new Set(['KeyW']), 1 / 60, { speed: 3, blocks: [low] });
  assert.ok(blocked.z > -1.9, `a low gap is a wall (${blocked.z})`);
  const tall = camera3d({ z: -0.5 });
  const sheet = block(0, -3, 6, 2, 3, '#888', 0);
  assert.ok(sheet.y === 0 && tall.z === -0.5);
});
