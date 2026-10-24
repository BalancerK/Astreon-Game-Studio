# @engine/skeleton2d

2D skeletal animation: bones, slots and skins, pictures that ride the bones (regions) and pictures that bend with them (meshes whose points follow several bones, and can be pushed around by animation), IK, keyframe animations with curves and events, and tracks that crossfade and layer. It poses and draws through the renderer's `MeshBatch2D`, so a skeleton is one draw call on WebGPU, WebGL2 and Canvas2D alike.

No dependencies beyond `@engine/render`, which it only uses to put triangles into a batch. Everything here is plain objects and numbers: you can build, pose, animate and hit-test a skeleton in Node with no browser.

```js
import { parseSkeleton, Skeleton, AnimationState, drawSkeleton } from '@engine/skeleton2d';
import { MeshBatch2D } from '@engine/render';

const data = parseSkeleton(await (await fetch('hero.skeleton.json')).json());   // shared by every hero on screen
const hero = new Skeleton(data);
hero.x = 400; hero.y = 500;                                                     // where its root bone stands; a negative scaleX faces it the other way
const state = new AnimationState(data, { defaultMix: 0.2 });
state.setAnimation(0, 'idle', { loop: true });
state.on('event', (entry, e) => { if (e.name === 'footstep') sounds.play('step'); });

const meshes = new MeshBatch2D();
function frame(dt) {
  state.update(dt);                       // time moves on, events fire, queued animations start
  state.apply(hero);                      // the tracks pose the bones
  hero.updateWorldTransform();            // bones to world positions, IK solved
  meshes.clear();
  drawSkeleton(hero, meshes, atlas);      // back to front, into the batch
  renderer.render({ camera, batch: sprites, meshes });   // meshes are drawn after the sprites of the same call (use renderLayers to interleave)
}
```

## The pieces

- **Bones** form a tree. A bone has a pose relative to its parent (`x`, `y`, `rotation` in degrees, `scaleX`, `scaleY`, `shearX`, `shearY`) and, once `updateWorldTransform()` has run, a place in the world. The world is y down like the rest of the engine, so a positive angle turns clockwise on the screen. A bone can take on only some of its parent's movement (`inherit`: `normal`, `onlyTranslation`, `noRotationOrReflection`, `noScale`, `noScaleOrReflection`): a weapon that keeps its size when the arm is squashed, a shadow that stays level.
- **Slots** hang on bones and show one **attachment** at a time, with a colour and a blend (`normal` or `additive`). **Skins** are sets of attachments (another outfit): a slot keeps its attachment's *name*, and a skin that has that name shows its own picture.
- **Attachments**: a `region` is one atlas sprite placed on a bone; a `mesh` is a sprite cut into triangles, each point either fixed to the slot's bone or *weighted* across several bones (an arm that bends at the elbow, a tail); a `boundingbox` is an invisible outline for hit tests.
- **IK constraints** (one or two bones) turn the chain so its end reaches a target bone, with a mix (0 off, 1 on) and a bend direction, and can themselves be animated.
- **Animations** are timelines of keys: bone rotate / translate / scale / shear (relative to the setup pose, so an animation survives a change to the rest pose), slot colour and attachment, mesh deformation, draw order, IK mix and bend, and events. Between keys: a straight line, `"stepped"`, or a Bezier ease.
- **`AnimationState`** plays them on **tracks**. Track 0 is the body; higher tracks layer (an arm wave, a hit flash) with their own `alpha` and a `replace` or `add` blend. Starting an animation crossfades from the one before over the mix time (a default, or per pair with `setMix`): what both animate is blended, what only the old one moved eases back to rest, what only the new one moves eases in. `addAnimation` queues. `setEmptyAnimation` fades a track out. Events reach `on('event', ...)`; so do `start`, `end`, `interrupt` and `complete`.

## The file format

JSON, documented at the top of `src/loader.js`: bones, slots, ik, skins (regions, meshes, bounding boxes), events and animations. Colours are `"rrggbb"` or `"rrggbbaa"`. A mesh whose `vertices` list is longer than two numbers per point is weighted: for each point a count of bones, then for each bone its number, the point's position in that bone's space, and its weight. `parseSkeleton` checks everything and says what and where when something is wrong ("animation "walk": no bone "tail"").

This is the engine's own format, not Spine's or anyone else's; it has the same ideas, so an exporter from another tool's data is a small script.

## Hit tests, bounds, attaching things

`hitTest(skeleton, x, y)` finds the front-most bounding box under a point (`{ any: true }` counts regions and meshes too); `skeletonBounds` gives the box round what is shown; `skeleton.boneWorld('hand')` gives a bone's world position and angle for holding a sword or emitting particles; `bone.tip()` gives its far end.

## Not done yet

Clipping attachments (clipping a mesh to a shape), path constraints and transform constraints, physics on bones, `multiply` and `screen` blends (slots draw `normal` or `additive`), crossfading more than two animations deep on one track (starting a third animation mid-fade drops the oldest), IK stretch and softness, linked meshes, and sequences (frame animation inside an attachment; use the attachment timeline to swap pictures). Skeletons are drawn unlit and unfiltered only when drawn with the renderer's plain `render`; lighting does not apply to meshes.

## Tests

`npm test` covers the bone maths for every inherit mode, IK (reach, out of reach, bend, mix, mirrored and moved skeletons), every timeline, curves, event timing across loops, crossfades, queues and layers, loading and its error messages, mesh deformation and weighting, and the exact vertices, colours and uvs `drawSkeleton` writes. `node tools/skeleton2d-test.js` (needs Chrome or Edge) draws a bending weighted ribbon on WebGPU, WebGL2 and Canvas2D and checks where the pixels are.
