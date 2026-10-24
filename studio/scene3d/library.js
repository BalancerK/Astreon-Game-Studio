// The building blocks the studio's 3D scene panel offers: a few shapes with a colour and a size. A scene file only says WHAT to place and WHERE (and any
// size or colour you changed); your game reads `scenes/<name>.json` and decides what the shapes mean. These are plain data, so they run in Node tests too.
import { defineComponent } from '../../packages/core/src/index.js';
import { PrefabLibrary, ComponentRegistry } from '../../packages/prefab/src/index.js';

/** The colour a shape is drawn with. */
export const Colour = defineComponent('colour', { r: 'f32', g: 'f32', b: 'f32' });

const box = (name, hx, hy, hz, [r, g, b]) => ({
  name,
  extends: 'thing',
  components: { colour: { r, g, b } },
  extras: { shape: { type: 'box', hx, hy, hz } },
  params: { halfWidth: 'extras.shape.hx', halfHeight: 'extras.shape.hy', halfDepth: 'extras.shape.hz' },
});

export const PREFABS = [
  { name: 'thing', components: { transform: {} } },
  box('cube', 0.5, 0.5, 0.5, [0.82, 0.62, 0.35]),
  box('floor', 4, 0.1, 4, [0.45, 0.55, 0.45]),
  box('wall', 2, 1.5, 0.15, [0.6, 0.6, 0.65]),
  box('pillar', 0.3, 1.5, 0.3, [0.75, 0.72, 0.65]),
  { ...box('ramp', 1, 0.5, 1.5, [0.62, 0.56, 0.45]), extras: { shape: { type: 'box', hx: 1, hy: 0.5, hz: 1.5 }, ramp: true } },
  {
    name: 'ball',
    extends: 'thing',
    components: { colour: { r: 0.35, g: 0.65, b: 0.9 } },
    extras: { shape: { type: 'sphere', radius: 0.5 } },
    params: { radius: 'extras.shape.radius' },
  },
  {
    name: 'capsule',
    extends: 'thing',
    components: { colour: { r: 0.8, g: 0.8, b: 0.4 } },
    extras: { shape: { type: 'capsule', radius: 0.3, halfHeight: 0.5 } },
    params: { radius: 'extras.shape.radius', halfHeight: 'extras.shape.halfHeight' },
  },
  {
    name: 'marker',
    extends: 'thing',
    components: { colour: { r: 0.95, g: 0.3, b: 0.25 } },
    extras: { shape: { type: 'sphere', radius: 0.2 }, marker: true },
  },
];

export function createLibrary() {
  const library = new PrefabLibrary(new ComponentRegistry().add(Colour)).define(PREFABS);
  library.validate();
  return library;
}

/** How a block looks in the editor: the shape and colour it says it has. */
export function describe(spec) {
  const c = spec.components?.colour;
  const shape = spec.extras?.shape;
  return shape ? { shape, color: c ? [c.r ?? 0.6, c.g ?? 0.6, c.b ?? 0.6] : [0.6, 0.6, 0.7], ramp: !!spec.extras?.ramp } : null;
}

export const HIDDEN = ['thing'];
