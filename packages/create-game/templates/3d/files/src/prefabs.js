// What things exist in the game, as data. A prefab is a template; a scene file (scenes/main.json) says which ones to place and where.
// Components are small bundles of numbers an entity has: `shape` and `colour` say how it looks, `spin` makes it turn.
import { defineComponent } from '@engine/core';
import { PrefabLibrary, ComponentRegistry } from '@engine/prefab';

export const Colour = defineComponent('colour', { r: 'f32', g: 'f32', b: 'f32' });
export const Shape = defineComponent('shape', { kind: 'u8', sx: 'f32', sy: 'f32', sz: 'f32' });
export const Spin = defineComponent('spin', { speed: 'f32', angle: 'f32' });

export const PREFABS = [
  { name: 'thing', components: { transform: {} } },
  { name: 'ground', extends: 'thing', components: { shape: { kind: 'box', sx: 60, sy: 0.2, sz: 60 }, colour: { r: 0.36, g: 0.5, b: 0.36 } } },
  // `params` are the knobs the editor shows: a name and which value it sets
  {
    name: 'cube', extends: 'thing',
    components: { shape: { kind: 'box', sx: 1, sy: 1, sz: 1 }, colour: { r: 0.85, g: 0.55, b: 0.3 } },
    params: { width: 'components.shape.sx', height: 'components.shape.sy', depth: 'components.shape.sz' },
  },
  {
    name: 'ball', extends: 'thing',
    components: { shape: { kind: 'sphere', sx: 1, sy: 1, sz: 1 }, colour: { r: 0.35, g: 0.65, b: 0.9 } },
    params: { size: 'components.shape.sx' },
  },
  {
    name: 'spinner', extends: 'cube',
    components: { spin: { speed: 1.5 }, colour: { r: 0.9, g: 0.35, b: 0.45 } },
    params: { speed: 'components.spin.speed' },
  },
  // a prefab can be made of other prefabs: three cubes stacked, each a child at a place relative to the tower
  {
    name: 'tower', extends: 'thing',
    children: [0, 1, 2].map((i) => ({
      name: `block${i}`, prefab: 'cube', local: { y: 0.5 + i * 1.05 },
      components: { colour: { r: 0.6 + i * 0.12, g: 0.5, b: 0.45 } },
    })),
  },
];

/** The library on its own (the editor only reads it). */
export function createLibrary() {
  const registry = new ComponentRegistry().add(Colour).add(Shape, { enums: { kind: { box: 0, sphere: 1 } } }).add(Spin);
  const library = new PrefabLibrary(registry).define(PREFABS);
  library.validate();
  return library;
}
