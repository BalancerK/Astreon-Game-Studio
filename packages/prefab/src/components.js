// Built-in components for placing things in a world and in each other: where something is, what it is attached to, and what it is called.
// They are ordinary ECS components (typed arrays); games add their own and register them with the `ComponentRegistry`.
import { defineComponent } from '../../core/src/index.js';

/** Position, orientation (a quaternion) and scale in world space. */
export const Transform = defineComponent('transform', { x: 'f64', y: 'f64', z: 'f64', qx: 'f32', qy: 'f32', qz: 'f32', qw: 'f32', sx: 'f32', sy: 'f32', sz: 'f32' });
/** The entity this one is attached to (an entity id; 0 means none: ids start at slot 0 generation 0, so check `has(Parent)` instead of the value). */
export const Parent = defineComponent('parent', { id: 'u32' });
/** Pose relative to the parent; the `TransformSystem` turns it into a world `Transform`. */
export const LocalTransform = defineComponent('local', { x: 'f64', y: 'f64', z: 'f64', qx: 'f32', qy: 'f32', qz: 'f32', qw: 'f32', sx: 'f32', sy: 'f32', sz: 'f32' });
/** Up to 32 tags as bits (see `PrefabLibrary.tag(name)`): "enemy", "breakable". */
export const Tags = defineComponent('tags', { bits: 'u32' });

/** Identity values for Transform / LocalTransform (a new component starts all zero, which is not a valid rotation or scale). */
export const IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: 1 });
