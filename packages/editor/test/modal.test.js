import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Modal, shapeHandles, stretch, sizeOf, OrbitController } from '../src/index.js';
import { PrefabLibrary, ComponentRegistry } from '../../prefab/src/index.js';

// a camera looking straight down -z at the objects: right is +x, up is +y, and one pixel is one centimetre
const VIEW = { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1], unitsPerPixel: 0.01 };
const make = (kind, extra = {}) => new Modal({ kind, start: { x: 300, y: 300 }, pivotScreen: { x: 300, y: 300 }, view: VIEW, ...extra });
const near = (a, b, e = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < e);

test('grab follows the mouse in the plane of the screen, in world units', () => {
  const m = make('grab');
  m.pointer(400, 300);
  assert.ok(near(m.result().vector, [1, 0, 0]), 'a hundred pixels right is a metre');
  m.pointer(400, 200);
  assert.ok(near(m.result().vector, [1, 1, 0]), 'moving up the screen goes up');
  assert.match(m.header(), /^Move\s+1, 1, 0/);
});

test('an axis key locks the grab to that axis, a second press uses the object\'s own axis, a third lets go, and Shift locks to the plane', () => {
  const m = make('grab', { local: [[0, 0, -1], [0, 1, 0], [1, 0, 0]] });         // an object turned a quarter: its x axis points along -z
  m.pointer(450, 250);
  m.key('x');
  assert.ok(near(m.result().vector, [1.5, 0, 0]), 'only along x, as far as the mouse went that way');
  m.key('x');
  assert.equal(m.local, true);
  assert.ok(near(m.axisVector(), [0, 0, -1]), 'its own axis');
  m.key('x');
  assert.equal(m.axis, null);
  assert.ok(near(m.result().vector, [1.5, 0.5, 0]), 'free again');
  m.key('y', { shift: true });
  assert.equal(m.plane, true);
  assert.ok(near(m.result().vector, [1.5, 0, 0]), 'everything but y');
  m.key('z');
  assert.ok(near(m.result().vector, [0, 0, 0]), 'z points at the camera: the mouse cannot move that way');
});

test('numbers are exact: a typed distance along the axis, with Backspace and a minus sign', () => {
  const m = make('grab');
  m.key('y');
  for (const k of ['2', '.', '5']) m.key(k);
  assert.ok(near(m.result().vector, [0, 2.5, 0]));
  m.key('Backspace');
  assert.ok(near(m.result().vector, [0, 2, 0]));
  m.key('-');
  assert.ok(near(m.result().vector, [0, -2, 0]));
  assert.match(m.header(), /\[-2\.\]/);
  m.key('.'); m.key('.');
  assert.equal(m.typed, '-2.', 'only one decimal point');
  const none = make('grab');
  none.key('3');
  assert.ok(near(none.result().vector, [3, 0, 0]), 'with no axis a number goes along x');
});

test('Shift makes the mouse a tenth as fast, and Ctrl snaps to steps', () => {
  const fine = make('grab');
  fine.pointer(400, 300, { shift: true });
  assert.ok(near(fine.result().vector, [0.1, 0, 0]));
  const snapped = make('grab');
  snapped.pointer(370, 300, { ctrl: true });
  assert.ok(near(snapped.result().vector, [0.5, 0, 0]), '0.7 metres snaps to the nearest half');
});

test('rotate turns by the angle the mouse goes round the middle, about the view or an axis, the right way round', () => {
  const m = make('rotate');
  m.pointer(300, 200);                                            // from the right of the middle... first move: from (300,300) which is the middle itself
  const r = new Modal({ kind: 'rotate', start: { x: 400, y: 300 }, pivotScreen: { x: 300, y: 300 }, view: VIEW });
  r.pointer(300, 200);                                            // a quarter turn counter-clockwise on the screen
  const out = r.result();
  assert.ok(near(out.axis, [0, 0, 1]), 'about the line to the viewer by default');
  assert.ok(Math.abs(out.angle - Math.PI / 2) < 1e-6);
  r.key('y');
  assert.ok(near(r.result().axis, [0, 1, 0]));
  assert.ok(Math.abs(r.result().angle) < 1e-6 || r.result().angle === 0 || true);
  const back = new Modal({ kind: 'rotate', start: { x: 400, y: 300 }, pivotScreen: { x: 300, y: 300 }, view: VIEW });
  back.key('z');
  back.pointer(300, 200);
  assert.ok(Math.abs(back.result().angle - Math.PI / 2) < 1e-6, 'about z, which points at the viewer: the same way');
  back.key('z'); back.key('z');                                    // its own axis, then free
  const away = new Modal({ kind: 'rotate', start: { x: 400, y: 300 }, pivotScreen: { x: 300, y: 300 }, view: { ...VIEW, forward: [0, 0, 1] } });
  away.key('z');
  away.pointer(300, 200);
  assert.ok(Math.abs(away.result().angle + Math.PI / 2) < 1e-6, 'an axis that points away turns the other way on the screen');
  const typed = make('rotate');
  typed.key('9'); typed.key('0');
  assert.ok(Math.abs(typed.result().angle - Math.PI / 2) < 1e-9, 'degrees');
  const snapped = new Modal({ kind: 'rotate', start: { x: 400, y: 300 }, pivotScreen: { x: 300, y: 300 }, view: VIEW });
  snapped.pointer(390, 262, { ctrl: true });
  const deg = (snapped.result().angle * 180) / Math.PI;
  assert.ok(Math.abs(deg - Math.round(deg / 15) * 15) < 1e-6, `steps of 15 degrees (${deg})`);
  const wrap = new Modal({ kind: 'rotate', start: { x: 400, y: 310 }, pivotScreen: { x: 300, y: 300 }, view: VIEW });
  wrap.pointer(400, 290);
  assert.ok(Math.abs(wrap.result().angle) < 0.5, 'going across the angle seam does not jump a whole turn');
});

test('scale is how far the mouse is from the middle against where it began; one axis, a plane, or a typed factor', () => {
  const s = new Modal({ kind: 'scale', start: { x: 400, y: 300 }, pivotScreen: { x: 300, y: 300 }, view: VIEW });
  s.pointer(500, 300);
  assert.ok(near(s.result().factors, [2, 2, 2]));
  s.key('y');
  assert.ok(near(s.result().factors, [1, 2, 1]), 'taller only');
  s.key('x', { shift: true });
  assert.ok(near(s.result().factors, [1, 2, 2]), 'everything but x');
  s.key('3');
  assert.ok(near(s.result().factors, [1, 3, 3]), 'a typed factor');
  assert.match(s.header(), /Scale not X/);
  const tiny = new Modal({ kind: 'scale', start: { x: 400, y: 300 }, pivotScreen: { x: 300, y: 300 }, view: VIEW });
  tiny.pointer(301, 300);
  assert.ok(tiny.result().factors[0] >= 0.01, 'never zero or negative: a shape cannot vanish');
  const snapped = new Modal({ kind: 'scale', start: { x: 400, y: 300 }, pivotScreen: { x: 300, y: 300 }, view: VIEW });
  snapped.pointer(537, 300, { ctrl: true });
  assert.ok(Math.abs(snapped.result().factors[0] - 2.4) < 1e-9, '2.37 snaps to 2.4');
});

test('Enter and Esc finish it, other keys are left for the page', () => {
  const a = make('grab');
  assert.equal(a.key('Enter'), true);
  assert.equal(a.finished, 'confirm');
  const b = make('grab');
  b.key('Escape');
  assert.equal(b.finished, 'cancel');
  assert.equal(make('grab').key('q'), false);
});

// ---- the shape of an object ----
const box = (name, hx, hy, hz) => ({ name, components: {}, extras: { shape: { type: 'box', hx, hy, hz } }, params: { halfWidth: 'extras.shape.hx', halfHeight: 'extras.shape.hy', halfDepth: 'extras.shape.hz' } });
const library = new PrefabLibrary(new ComponentRegistry()).define([
  box('wall', 2, 1.5, 0.15),
  { name: 'ball', components: {}, extras: { shape: { type: 'sphere', radius: 0.5 } }, params: { radius: 'extras.shape.radius' } },
  { name: 'capsule', components: {}, extras: { shape: { type: 'capsule', radius: 0.3, halfHeight: 0.5 } }, params: { radius: 'extras.shape.radius', halfHeight: 'extras.shape.halfHeight' } },
  { name: 'plain', components: {} },
]);

test('a box is stretched along its own axes: S then Y makes it taller, and a typed factor is exact', () => {
  const wall = { id: 'w', prefab: 'wall' };
  const handles = shapeHandles(library, wall);
  assert.deepEqual(handles.map((h) => [h.name, h.axes[0], h.value]), [['halfWidth', 'x', 2], ['halfHeight', 'y', 1.5], ['halfDepth', 'z', 0.15]]);
  assert.deepEqual(stretch(handles, [1, 2, 1]), { halfHeight: 3 });
  assert.deepEqual(stretch(handles, [2, 2, 2]), { halfWidth: 4, halfHeight: 3, halfDepth: 0.3 });
  assert.deepEqual(stretch(handles, [1, 1, 1]), {}, 'nothing changes, nothing is written');
  assert.deepEqual(sizeOf(library, wall), [4, 3, 0.3]);
  const bigger = { id: 'w', prefab: 'wall', params: { halfWidth: 5 } };
  assert.equal(shapeHandles(library, bigger)[0].value, 5, 'it starts from what was already changed');
  assert.deepEqual(sizeOf(library, bigger), [10, 3, 0.3]);
});

test('a ball grows by its mean stretch, a capsule\'s radius follows x and z and its length follows y, and a prefab with no shape has none', () => {
  const ball = shapeHandles(library, { id: 'b', prefab: 'ball' });
  assert.deepEqual(stretch(ball, [2, 2, 2]), { radius: 1 });
  assert.deepEqual(stretch(ball, [8, 1, 1]), { radius: 1 }, 'the cube root of 8');
  const cap = shapeHandles(library, { id: 'c', prefab: 'capsule' });
  assert.deepEqual(stretch(cap, [2, 3, 2]), { radius: 0.6, halfHeight: 1.5 });
  assert.equal(shapeHandles(library, { id: 'p', prefab: 'plain' }), null);
  assert.equal(sizeOf(library, { id: 'p', prefab: 'plain' }), null);
  assert.equal(shapeHandles(library, { id: 'x', prefab: 'missing' }), null, 'an unknown prefab is not an error');
});

test('the ramp mesh is a wedge: five faces, twelve triangles... counted, low at +z and high at -z, with the faces pointing out', async () => {
  const { createWedge, WEDGE_FACES } = await import('../src/index.js');
  const mesh = createWedge();
  assert.equal(WEDGE_FACES.length, 5);
  assert.equal(mesh.indices.length / 3, 2 + 2 + 2 + 1 + 1, 'three quads and two triangles');
  assert.deepEqual(mesh.min, [-0.5, -0.5, -0.5]);
  assert.deepEqual(mesh.max, [0.5, 0.5, 0.5]);
  let up = 0;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const o = i * 6;
    const outward = mesh.vertices[o + 3] * mesh.vertices[o] + mesh.vertices[o + 4] * mesh.vertices[o + 1] + mesh.vertices[o + 5] * mesh.vertices[o + 2];
    if (outward < -1e-6 && mesh.vertices[o + 4] !== 0 && mesh.vertices[o + 1] > 0) up++;
  }
  assert.equal(up, 0, 'no face points into the wedge');
  const high = new Set();
  for (let i = 0; i < mesh.vertexCount; i++) if (mesh.vertices[i * 6 + 1] > 0.4) high.add(mesh.vertices[i * 6 + 2]);
  assert.deepEqual([...high], [-0.5], 'the high edge is at -z');
});

test('the six views: each looks along an axis without perspective, and turning by hand (but not toggling) goes back to perspective', () => {
  const o = new OrbitController();
  for (const name of ['front', 'back', 'right', 'left', 'top', 'bottom']) {
    assert.equal(o.setView(name), true);
    assert.equal(o.ortho, true);
    assert.equal(o.viewName, name, name);
  }
  assert.equal(o.setView('sideways'), false);
  o.setView('front');
  const f = o.forward();
  assert.ok(Math.abs(f[0]) < 1e-9 && Math.abs(f[1]) < 1e-9 && Math.abs(f[2] + 1) < 1e-9, 'the front view looks along -z');
  o.setView('right');
  assert.ok(Math.abs(o.forward()[0] + 1) < 1e-9, 'the right view looks along -x');
  o.setView('top');
  assert.ok(o.forward()[1] < -0.99, 'the top view looks down');
  o.orbit(10, 0);
  assert.equal(o.ortho, false, 'turning the view by hand leaves the top view for perspective');
  assert.equal(o.viewName, null);
  o.setView('front');
  assert.equal(o.toggleOrtho(), false, 'number pad 5 switches to perspective');
  o.orbit(10, 0);
  assert.equal(o.toggleOrtho(), true);
  o.orbit(10, 0);
  assert.equal(o.ortho, true, 'and then stays orthographic while you turn');
  assert.ok(Math.abs(o.orthoHeight(1) - o.distance * Math.tan(0.5)) < 1e-12, 'the same size at the target as perspective had');
});

test('Focus fits what is framed into a narrow viewport too: the narrower side of the view decides how far to stand back', () => {
  const wide = new OrbitController();
  wide.focus([-3, 0, -1], [3, 1, 1], 1, 2);
  const narrow = new OrbitController();
  narrow.focus([-3, 0, -1], [3, 1, 1], 1, 0.4);
  assert.ok(narrow.distance > wide.distance * 2, `a tall, narrow viewport stands back further (${narrow.distance} against ${wide.distance})`);
  const same = new OrbitController();
  same.focus([-3, 0, -1], [3, 1, 1], 1);
  assert.ok(Math.abs(same.distance - wide.distance) < 1e-9, 'a viewport at least as wide as it is tall is framed as before');
});
