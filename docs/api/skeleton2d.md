# @engine/skeleton2d

2D skeletal animation: bones, skins, weighted meshes with deformation, IK, keyframes with curves and events, crossfading tracks, drawn through the renderer's mesh batch.

```
npm install @engine/skeleton2d
```

Version 0.1.0. The package's own README ([packages/skeleton2d](../../packages/skeleton2d/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (29 of 29 documented)

| Name | Kind | Summary |
|---|---|---|
| [`Animation`](#class-animation) | class | One animation: its name, its length in seconds, and its timelines. |
| [`AnimationState`](#class-animationstate) | class | The tracks of one skeleton's animations: what plays, what waits, what is crossfading. |
| [`AttachmentTimeline`](#class-attachmenttimeline) | class | Switches which attachment a slot shows (or hides it with `null`). |
| [`BLEND`](#blend) | constant | Which way keys are applied. |
| [`Bone`](#class-bone) | class | A bone at run time: its pose now (`x`, `y`, `rotation`, `scaleX`, `scaleY`, `shearX`, `shearY` are relative to its parent) and where that puts it in the world (`worldX`, `worldY`, and `a b c d`, the matrix of its axes). |
| [`ColorTimeline`](#class-colortimeline) | class | Changes a slot's colour: keys of [r, g, b, a] in 0..1 (absolute). |
| [`DeformTimeline`](#class-deformtimeline) | class | Pushes a mesh's points around: keys of one offset for every point (two numbers per point, or for a weighted mesh two per bone influence), added to the setup positions. |
| [`DrawOrderTimeline`](#class-drawordertimeline) | class | Reorders the slots for drawing: keys of a full order (slot indexes back to front), or `null` for the setup order. |
| [`EventTimeline`](#class-eventtimeline) | class | Marks moments for the game to react to (a footstep, a sword hit): keys of an event. |
| [`INHERIT`](#inherit) | constant | How a bone takes on its parent's movement. |
| [`IkConstraint`](#class-ikconstraint) | class | The pose of a two-bone or one-bone IK constraint right now. |
| [`IkTimeline`](#class-iktimeline) | class | Changes an IK constraint: keys of its mix (0 off, 1 fully on) and bend direction (1 or -1). |
| [`RotateTimeline`](#class-rotatetimeline) | class | Turns a bone: keys of one angle (degrees, relative to the setup rotation). |
| [`Skeleton`](#class-skeleton) | class | The runtime copy of a skeleton: poses, slot colours and shown attachments, constraints. |
| [`SkeletonData`](#class-skeletondata) | class | The designed skeleton: bones, slots, constraints, skins, events and animations. |
| [`Skin`](#class-skin) | class | The pictures of one outfit: attachments by slot and name. |
| [`Slot`](#class-slot) | class | A place on a bone where a picture hangs: its colour now, which attachment it shows, and how that attachment is deformed. |
| [`TrackEntry`](#class-trackentry) | class | One animation playing (or waiting) on a track. |
| [`Vec2Timeline`](#class-vec2timeline) | class | Moves, resizes or shears a bone: keys of an (x, y) pair. |
| [`angleDelta`](#angledelta) | function | Shortest turn from angle `a` to angle `b`, in degrees (between -180 and 180). |
| [`attachmentWorldVertices`](#attachmentworldvertices) | function | Where an attachment's points are in the world right now. |
| [`curveFraction`](#curvefraction) | function | How far along the way from one key to the next a value is, once the curve is applied. |
| [`drawSkeleton`](#drawskeleton) | function | Put what a skeleton shows into a mesh batch, back to front, ready for `renderer.render({ camera, batch, meshes })`. |
| [`frameIndex`](#frameindex) | function | The index of the last key at or before `t`, or -1 before the first. |
| [`hitTest`](#hittest) | function | What is at a point: the first bounding box (from the front) that contains it, or, with `any: true`, the first region or mesh too. |
| [`parseSkeleton`](#parseskeleton) | function | Read a skeleton from the JSON format described at the top of this file. |
| [`parseSkeletonColor`](#parseskeletoncolor) | function | A colour as [r, g, b, a] in 0..1 from "rrggbb", "rrggbbaa" (with or without a #) or an array. |
| [`pointInPolygon`](#pointinpolygon) | function | Is the point inside the polygon of x, y pairs? |
| [`skeletonBounds`](#skeletonbounds) | function | The box that holds everything the skeleton is showing (regions and meshes; bounding boxes do not count). |

## Functions

### `angleDelta`

```js
function angleDelta(a, b)
```

Shortest turn from angle `a` to angle `b`, in degrees (between -180 and 180).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `a` | `number` |  |
| `b` | `number` |  |

<sub>src/skeleton.js:12</sub>

### `attachmentWorldVertices`

```js
function attachmentWorldVertices(skeleton, slot, att, out, outAt = 0, size)
```

Where an attachment's points are in the world right now. A region gives its four corners (top left, top right, bottom right, bottom left); a mesh or bounding box gives its points,
moved by its bones and by any deformation.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `skeleton` | `import('./skeleton.js').Skeleton` |  |
| `slot` | `import('./skeleton.js').Slot` |  |
| `att` | `import('./skeleton.js').Attachment` |  |
| `out` | `Float32Array \| number[]` | x, y for each point |
| `outAt` (optional) | `number` | Where in `out` to start writing. |
| `size` (optional) | `{width: number, height: number}` | For a region with no size of its own: the size of its sprite. |

**Returns** `number` — How many points were written.

<sub>src/geometry.js:10</sub>

### `curveFraction`

```js
function curveFraction(curve, f)
```

How far along the way from one key to the next a value is, once the curve is applied. `curve` is `null` for a straight line, `'stepped'` to hold the first value until the next key,
or `[cx1, cy1, cx2, cy2]` for a Bezier ease (control points in a 0..1 box of time and value, like CSS `cubic-bezier`).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `curve` | `null \| 'stepped' \| number[]` |  |
| `f` | `number` | 0..1, the time fraction |

<sub>src/animation.js:27</sub>

### `drawSkeleton`

```js
function drawSkeleton(skeleton, meshes, atlas, { tint = [1, 1, 1, 1] } = {})
```

Put what a skeleton shows into a mesh batch, back to front, ready for `renderer.render({ camera, batch, meshes })`. Regions become two triangles, meshes keep their own triangles, bounding
boxes are skipped. The colour of a point is the skeleton's colour times the slot's times the attachment's times `tint`; slots set to `additive` add their light instead of covering.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `skeleton` | `import('./skeleton.js').Skeleton` | Its world transforms must be up to date (`updateWorldTransform()`). |
| `meshes` | `import('../../render/src/meshbatch.js').MeshBatch2D` |  |
| `atlas` | `import('../../render/src/atlas.js').Atlas` | Where the attachments' sprites live. |
| `o` (optional) | `{tint?: number[]}` | `tint`: an extra [r, g, b, a] in 0..1. |

**Returns** `number` — How many triangles were added.

<sub>src/draw.js:31</sub>

### `frameIndex`

```js
function frameIndex(times, t)
```

The index of the last key at or before `t`, or -1 before the first.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `times` | `ArrayLike<number>` |  |
| `t` | `number` |  |

<sub>src/animation.js:14</sub>

### `hitTest`

```js
function hitTest(skeleton, x, y, { any = false, atlas } = {})
```

What is at a point: the first bounding box (from the front) that contains it, or, with `any: true`, the first region or mesh too.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `skeleton` | `import('./skeleton.js').Skeleton` |  |
| `x` | `number` |  |
| `y` | `number` |  |
| `o` (optional) | `{any?: boolean, atlas?: import('../../render/src/atlas.js').Atlas}` |  |

**Returns** `{slot: import('./skeleton.js').Slot, attachment: import('./skeleton.js').Attachment} \| null`

<sub>src/geometry.js:76</sub>

### `parseSkeleton`

```js
function parseSkeleton(source)
```

Read a skeleton from the JSON format described at the top of this file.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `source` | `string \| object` | The JSON text or the parsed object. |

**Returns** `SkeletonData`

<sub>src/loader.js:109</sub>

### `parseSkeletonColor`

```js
function parseSkeletonColor(c, fallback = [1, 1, 1, 1])
```

A colour as [r, g, b, a] in 0..1 from "rrggbb", "rrggbbaa" (with or without a #) or an array.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `c` | `string \| number[] \| undefined` |  |
| `fallback` (optional) | `number[]` |  |

<sub>src/loader.js:38</sub>

### `pointInPolygon`

```js
function pointInPolygon(poly, n, x, y)
```

Is the point inside the polygon of x, y pairs?

**Parameters**

| Name | Type | Description |
|---|---|---|
| `poly` | `ArrayLike<number>` |  |
| `n` | `number` | Points. |
| `x` | `number` |  |
| `y` | `number` |  |

<sub>src/geometry.js:62</sub>

### `skeletonBounds`

```js
function skeletonBounds(skeleton, { atlas } = {})
```

The box that holds everything the skeleton is showing (regions and meshes; bounding boxes do not count).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `skeleton` | `import('./skeleton.js').Skeleton` |  |
| `o` (optional) | `{atlas?: import('../../render/src/atlas.js').Atlas}` | The atlas gives regions without a size their sprite's size. |

**Returns** `{x0: number, y0: number, x1: number, y1: number} \| null` — `null` if nothing is shown.

<sub>src/geometry.js:46</sub>

## Classes

### `class Animation`

```js
class Animation
```

One animation: its name, its length in seconds, and its timelines.

#### `Animation.constructor`

```js
constructor(name, timelines, duration)
```

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `timelines` | `Timeline[]` |  |
| `duration` (optional) | `number` | Defaults to the time of the last key. |

#### `Animation.apply`

```js
apply(skeleton, time, alpha = 1, blend = BLEND.replace, loop = false, only = null, except = false)
```

Pose a skeleton as this animation has it at `time`.

| Name | Type | Description |
|---|---|---|
| `skeleton` | `import('./skeleton.js').Skeleton` |  |
| `time` | `number` | Seconds; with `loop`, wrapped to the length. |
| `alpha` (optional) | `number` | How strongly (0..1). |
| `blend` (optional) | `'replace' \| 'add'` |  |
| `loop` (optional) | `boolean` |  |
| `only` (optional) | `Set<string> \| null` | When given, only timelines whose key is in (or, with `except`, not in) the set are applied. |
| `except` (optional) | `boolean` |  |

#### `Animation.collectEvents`

```js
collectEvents(lastTime, time, loop, out = [])
```

The events that happen in (`lastTime`, `time`], in order; with `loop`, every pass through the animation counts, across the wrap from the end back to the start. A first call with `lastTime` below zero includes events at time 0.

| Name | Type | Description |
|---|---|---|
| `lastTime` | `number` |  |
| `time` | `number` |  |
| `loop` | `boolean` |  |
| `out` (optional) | `object[]` |  |

<sub>src/animation.js:165</sub>

### `class AnimationState`

```js
class AnimationState
```

The tracks of one skeleton's animations: what plays, what waits, what is crossfading. One state poses any `Skeleton` made from the same data.

#### `AnimationState.constructor`

```js
constructor(data, { defaultMix = 0 } = {})
```

| Name | Type | Description |
|---|---|---|
| `data` | `import('./loader.js').SkeletonData` |  |
| `o` (optional) | `{defaultMix?: number}` | `defaultMix`: crossfade seconds when nothing more specific is set. |

#### `AnimationState.on`

```js
on(type, fn)
```

Subscribe: `'start'`, `'end'` (left the track), `'interrupt'` (replaced by another), `'complete'` (a pass through finished), `'event'`. The callback gets `(entry, event?)`. Returns a function that unsubscribes.

| Name | Type | Description |
|---|---|---|
| `type` | `string` |  |
| `fn` | `(entry: TrackEntry, event?: object) => void` |  |

#### `AnimationState.setMix`

```js
setMix(from, to, seconds)
```

Crossfade time (seconds) between two named animations, replacing the default.

| Name | Type | Description |
|---|---|---|
| `from` | `string` |  |
| `to` | `string` |  |
| `seconds` | `number` |  |

#### `AnimationState.getMix`

```js
getMix(from, to)
```

#### `AnimationState.setAnimation`

```js
setAnimation(track, animation, { loop = false, mix, alpha = 1, blend = BLEND.replace, timeScale = 1, trackEnd = Infinity } = {})
```

Play an animation on a track now, crossfading from what was there.

| Name | Type | Description |
|---|---|---|
| `track` | `number` |  |
| `animation` | `string \| Animation` |  |
| `o` (optional) | `{loop?: boolean, mix?: number, alpha?: number, blend?: 'replace' \| 'add', timeScale?: number, trackEnd?: number}` |  |

**Returns** `TrackEntry`

#### `AnimationState.addAnimation`

```js
addAnimation(track, animation, { loop = false, delay = 0, mix, alpha = 1, blend = BLEND.replace, timeScale = 1 } = {})
```

Queue an animation after the one playing (and after anything already queued). It starts `delay` seconds after the one before finishes, less the crossfade, so they overlap.

| Name | Type | Description |
|---|---|---|
| `track` | `number` |  |
| `animation` | `string \| Animation` |  |
| `o` (optional) | `{loop?: boolean, delay?: number, mix?: number, alpha?: number, blend?: 'replace' \| 'add', timeScale?: number}` |  |

#### `AnimationState.setEmptyAnimation`

```js
setEmptyAnimation(track, mix = 0.2)
```

Fade a track out to nothing over `mix` seconds, then clear it.

| Name | Type | Description |
|---|---|---|
| `track` | `number` |  |
| `mix` (optional) | `number` |  |

#### `AnimationState.clearTrack`

```js
clearTrack(track)
```

Stop a track at once, leaving the pose to whatever else is playing.

| Name | Type | Description |
|---|---|---|
| `track` | `number` |  |

#### `AnimationState.clearTracks`

```js
clearTracks()
```

#### `AnimationState.getCurrent`

```js
getCurrent(track)
```

What is playing on a track, if anything.

| Name | Type | Description |
|---|---|---|
| `track` | `number` |  |

#### `AnimationState.update`

```js
update(dt)
```

Move time forward: advance the animations and crossfades, start queued ones, call the listeners. Returns the events that fired.

| Name | Type | Description |
|---|---|---|
| `dt` | `number` | Seconds. |

**Returns** `object[]`

#### `AnimationState.apply`

```js
apply(skeleton)
```

Pose a skeleton from the tracks: it is set to its setup pose, then each track in order is applied on top. Call `skeleton.updateWorldTransform()` afterwards.

| Name | Type | Description |
|---|---|---|
| `skeleton` | `import('./skeleton.js').Skeleton` |  |

<sub>src/state.js:44</sub>

### `class AttachmentTimeline`

```js
class AttachmentTimeline extends Timeline
```

Switches which attachment a slot shows (or hides it with `null`). A switch needs at least half the animation's weight, so a fade does not flicker.

#### `AttachmentTimeline.constructor`

```js
constructor(slot, times, names)
```

| Name | Type | Description |
|---|---|---|
| `slot` | `number` |  |
| `times` | `ArrayLike<number>` |  |
| `names` | `(string \| null)[]` |  |

#### `AttachmentTimeline.apply`

```js
apply(skeleton, time, alpha)
```

<sub>src/animation.js:100</sub>

### `class Bone`

```js
class Bone
```

A bone at run time: its pose now (`x`, `y`, `rotation`, `scaleX`, `scaleY`, `shearX`, `shearY` are relative to its parent) and where that puts it in the world (`worldX`, `worldY`, and `a b c d`, the matrix of its axes).

#### `Bone.constructor`

```js
constructor(data, skeleton, parent)
```

| Name | Type | Description |
|---|---|---|
| `data` | `BoneData` |  |
| `skeleton` | `Skeleton` |  |
| `parent` | `Bone \| null` |  |

#### `Bone.setToSetupPose`

```js
setToSetupPose()
```

Put this bone back to the pose it was designed in.

#### `Bone.updateWorld`

```js
updateWorld()
```

Work out where this bone is in the world from its pose and its parent's (the parent must be up to date).

#### `Bone.worldRotation`

```js
get worldRotation
```

The direction of the bone's x axis in the world, in degrees.

#### `Bone.tip`

```js
tip(out = { x: 0, y: 0 })
```

The world position of the far end of the bone (its origin plus its length along its x axis).

| Name | Type | Description |
|---|---|---|
| `out` (optional) | `{x: number, y: number}` |  |

#### `Bone.worldToLocal`

```js
worldToLocal(wx, wy, out = { x: 0, y: 0 })
```

A point in the world to the same point as this bone sees it (relative to its origin and axes).

| Name | Type | Description |
|---|---|---|
| `wx` | `number` |  |
| `wy` | `number` |  |
| `out` (optional) | `{x: number, y: number}` |  |

#### `Bone.localToWorld`

```js
localToWorld(lx, ly, out = { x: 0, y: 0 })
```

A point in this bone's space to the world.

| Name | Type | Description |
|---|---|---|
| `lx` | `number` |  |
| `ly` | `number` |  |
| `out` (optional) | `{x: number, y: number}` |  |

#### `Bone.localRotationFor`

```js
localRotationFor(worldDegrees)
```

The local `rotation` that makes this bone's x axis point along `worldDegrees`, given where its parent is now.

| Name | Type | Description |
|---|---|---|
| `worldDegrees` | `number` |  |

<sub>src/skeleton.js:31</sub>

### `class ColorTimeline`

```js
class ColorTimeline extends Timeline
```

Changes a slot's colour: keys of [r, g, b, a] in 0..1 (absolute).

#### `ColorTimeline.constructor`

```js
constructor(slot, times, values, curves)
```

| Name | Type | Description |
|---|---|---|
| `slot` | `number` | Slot index |
| `times` | `ArrayLike<number>` |  |
| `values` | `ArrayLike<number>` | r, g, b, a for each key |
| `curves` (optional) | `(null \| 'stepped' \| number[])[]` |  |

#### `ColorTimeline.apply`

```js
apply(skeleton, time, alpha, blend)
```

<sub>src/animation.js:89</sub>

### `class DeformTimeline`

```js
class DeformTimeline extends Timeline
```

Pushes a mesh's points around: keys of one offset for every point (two numbers per point, or for a weighted mesh two per bone influence), added to the setup positions.

#### `DeformTimeline.constructor`

```js
constructor(slot, attachment, times, frames, curves)
```

| Name | Type | Description |
|---|---|---|
| `slot` | `number` |  |
| `attachment` | `object` | The mesh this deforms |
| `times` | `ArrayLike<number>` |  |
| `frames` | `Float32Array[]` | One offset array per key |
| `curves` (optional) | `(null \| 'stepped' \| number[])[]` |  |

#### `DeformTimeline.apply`

```js
apply(skeleton, time, alpha, blend)
```

<sub>src/animation.js:113</sub>

### `class DrawOrderTimeline`

```js
class DrawOrderTimeline extends Timeline
```

Reorders the slots for drawing: keys of a full order (slot indexes back to front), or `null` for the setup order.

#### `DrawOrderTimeline.constructor`

```js
constructor(times, orders)
```

| Name | Type | Description |
|---|---|---|
| `times` | `ArrayLike<number>` |  |
| `orders` | `(number[] \| null)[]` |  |

#### `DrawOrderTimeline.apply`

```js
apply(skeleton, time, alpha)
```

<sub>src/animation.js:132</sub>

### `class EventTimeline`

```js
class EventTimeline extends Timeline
```

Marks moments for the game to react to (a footstep, a sword hit): keys of an event. Not applied to the pose; `Animation.collectEvents` finds the ones that passed.

#### `EventTimeline.constructor`

```js
constructor(times, events)
```

| Name | Type | Description |
|---|---|---|
| `times` | `ArrayLike<number>` |  |
| `events` | `{name: string, int: number, float: number, string: string}[]` |  |

#### `EventTimeline.apply`

```js
apply()
```

<sub>src/animation.js:158</sub>

### `class IkConstraint`

```js
class IkConstraint
```

The pose of a two-bone or one-bone IK constraint right now.

#### `IkConstraint.constructor`

```js
constructor(data, skeleton)
```

| Name | Type | Description |
|---|---|---|
| `data` | `object` |  |
| `skeleton` | `Skeleton` |  |

#### `IkConstraint.setToSetupPose`

```js
setToSetupPose()
```

#### `IkConstraint.apply`

```js
apply()
```

Turn the bones so the end of the chain reaches the target (as far as it can). Call after the bones' world transforms are up to date; the chain is brought up to date again.

<sub>src/skeleton.js:124</sub>

### `class IkTimeline`

```js
class IkTimeline extends Timeline
```

Changes an IK constraint: keys of its mix (0 off, 1 fully on) and bend direction (1 or -1).

#### `IkTimeline.constructor`

```js
constructor(ik, times, mixes, bends, curves)
```

| Name | Type | Description |
|---|---|---|
| `ik` | `number` |  |
| `times` | `ArrayLike<number>` |  |
| `mixes` | `ArrayLike<number>` |  |
| `bends` | `ArrayLike<number>` |  |
| `curves` (optional) | `(null \| 'stepped' \| number[])[]` |  |

#### `IkTimeline.apply`

```js
apply(skeleton, time, alpha)
```

<sub>src/animation.js:145</sub>

### `class RotateTimeline`

```js
class RotateTimeline extends Timeline
```

Turns a bone: keys of one angle (degrees, relative to the setup rotation).

#### `RotateTimeline.constructor`

```js
constructor(bone, times, values, curves)
```

| Name | Type | Description |
|---|---|---|
| `bone` | `number` | Bone index |
| `times` | `ArrayLike<number>` |  |
| `values` | `ArrayLike<number>` |  |
| `curves` (optional) | `(null \| 'stepped' \| number[])[]` |  |

#### `RotateTimeline.apply`

```js
apply(skeleton, time, alpha, blend)
```

<sub>src/animation.js:60</sub>

### `class Skeleton`

```js
class Skeleton
```

The runtime copy of a skeleton: poses, slot colours and shown attachments, constraints. Animations change its bones' and slots' fields; `updateWorldTransform()` then works out where everything is.

```js
const skeleton = new Skeleton(data);
skeleton.x = 200; skeleton.y = 300;                // where its root bone stands
state.update(dt); state.apply(skeleton);            // an AnimationState poses it
skeleton.updateWorldTransform();
drawSkeleton(skeleton, meshes, atlas);
```

#### `Skeleton.constructor`

```js
constructor(data)
```

| Name | Type | Description |
|---|---|---|
| `data` | `import('./loader.js').SkeletonData` |  |

#### `Skeleton.findBone`

```js
findBone(name)
```

#### `Skeleton.findSlot`

```js
findSlot(name)
```

#### `Skeleton.findIk`

```js
findIk(name)
```

#### `Skeleton.setToSetupPose`

```js
setToSetupPose()
```

Everything back to how it was designed: bones, slot colours and attachments, draw order, constraint settings.

#### `Skeleton.setSkin`

```js
setSkin(name)
```

Show a skin (a different set of pictures for the same bones: another outfit). Slots keep their attachment names, so a name the new skin has is shown from the new skin.

| Name | Type | Description |
|---|---|---|
| `name` | `string \| null` | `null` goes back to the default skin. |

#### `Skeleton.attachmentOf`

```js
attachmentOf(slot)
```

The attachment a slot is showing now (from the current skin, else the default), or null.

| Name | Type | Description |
|---|---|---|
| `slot` | `Slot` |  |

**Returns** `Attachment \| null`

#### `Skeleton.setAttachment`

```js
setAttachment(slotName, name)
```

Make a slot show the attachment called `name` (or none).

| Name | Type | Description |
|---|---|---|
| `slotName` | `string` |  |
| `name` | `string \| null` |  |

#### `Skeleton.updateWorldTransform`

```js
updateWorldTransform()
```

Work out where every bone is in the world (and apply the IK constraints). Call after posing and after moving the skeleton.

#### `Skeleton.boneWorld`

```js
boneWorld(boneName)
```

Where a bone's tip or origin is: handy for attaching a sword, a particle emitter or a camera.

| Name | Type | Description |
|---|---|---|
| `boneName` | `string` |  |

**Returns** `{x: number, y: number, rotation: number}`

<sub>src/skeleton.js:180</sub>

### `class SkeletonData`

```js
class SkeletonData
```

The designed skeleton: bones, slots, constraints, skins, events and animations. Shared by every `Skeleton` made from it.

#### `SkeletonData.constructor`

```js
constructor(name = '')
```

#### `SkeletonData.findBone`

```js
findBone(name)
```

#### `SkeletonData.findSlot`

```js
findSlot(name)
```

#### `SkeletonData.animation`

```js
animation(name)
```

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |

**Returns** `Animation`

<sub>src/loader.js:58</sub>

### `class Skin`

```js
class Skin
```

The pictures of one outfit: attachments by slot and name.

#### `Skin.constructor`

```js
constructor(name)
```

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |

#### `Skin.set`

```js
set(slot, name, attachment)
```

| Name | Type | Description |
|---|---|---|
| `slot` | `number` |  |
| `name` | `string` |  |
| `attachment` | `import('./skeleton.js').Attachment` |  |

#### `Skin.get`

```js
get(slot, name)
```

| Name | Type | Description |
|---|---|---|
| `slot` | `number` |  |
| `name` | `string` |  |

<sub>src/loader.js:48</sub>

### `class Slot`

```js
class Slot
```

A place on a bone where a picture hangs: its colour now, which attachment it shows, and how that attachment is deformed.

#### `Slot.constructor`

```js
constructor(data, bone)
```

| Name | Type | Description |
|---|---|---|
| `data` | `SlotData` |  |
| `bone` | `Bone` |  |

#### `Slot.setToSetupPose`

```js
setToSetupPose()
```

<sub>src/skeleton.js:111</sub>

### `class TrackEntry`

```js
class TrackEntry
```

One animation playing (or waiting) on a track. Change `timeScale`, `alpha`, `blend` or `time` to steer it.

#### `TrackEntry.constructor`

```js
constructor(animation, track, loop)
```

| Name | Type | Description |
|---|---|---|
| `animation` | `Animation` |  |
| `track` | `number` |  |
| `loop` | `boolean` |  |

#### `TrackEntry.finished`

```js
get finished
```

Is this the animation that has finished playing (non-looping and at its end)?

<sub>src/state.js:23</sub>

### `class Vec2Timeline`

```js
class Vec2Timeline extends Timeline
```

Moves, resizes or shears a bone: keys of an (x, y) pair. `kind` is `'translate'` (relative to the setup position), `'scale'` (a multiplier of the setup scale) or `'shear'` (degrees, relative).

#### `Vec2Timeline.constructor`

```js
constructor(kind, bone, times, values, curves)
```

| Name | Type | Description |
|---|---|---|
| `kind` | `'translate' \| 'scale' \| 'shear'` |  |
| `bone` | `number` |  |
| `times` | `ArrayLike<number>` |  |
| `values` | `ArrayLike<number>` | x, y for each key |
| `curves` (optional) | `(null \| 'stepped' \| number[])[]` |  |

#### `Vec2Timeline.apply`

```js
apply(skeleton, time, alpha, blend)
```

<sub>src/animation.js:73</sub>

## Constants

### `BLEND`

```js
const BLEND
```

Which way keys are applied. `replace` moves the pose toward the animation (with `alpha` 1, to it); `add` adds the animation's change from the setup pose on top of the pose.

Value: `Object.freeze({ replace: 'replace', add: 'add' })`

<sub>src/animation.js:11</sub>

### `INHERIT`

```js
const INHERIT
```

How a bone takes on its parent's movement. `normal` follows all of it; `onlyTranslation` follows only where the parent is; `noRotationOrReflection` ignores the parent's turning; `noScale` ignores its size; `noScaleOrReflection` ignores its size and mirroring.

Value: `Object.freeze({ normal: 0, onlyTranslation: 1, noRotationOrReflection: 2, noScal`

<sub>src/skeleton.js:9</sub>

## Types

### `Attachment`

A picture hung on a slot. `region`: one sprite from the atlas. `mesh`: a sprite cut into triangles whose points follow bones and can be pushed around by deform animations. `boundingbox`: an invisible outline for hit tests.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `type` | `'region' \| 'mesh' \| 'boundingbox'` |  |
| `name` | `string` |  |
| `path` | `string` | The atlas sprite name |
| `color` | `number[]` |  |

### `BoneData`

One bone of the skeleton as designed (its pose at rest: the "setup pose").

Type: `object`

| Name | Type | Description |
|---|---|---|
| `index` | `number` |  |
| `name` | `string` |  |
| `parent` | `BoneData \| null` |  |
| `length` | `number` | Length along its own x axis (for drawing and for IK) |
| `x` | `number` |  |
| `y` | `number` |  |
| `rotation` | `number` |  |
| `scaleX` | `number` |  |
| `scaleY` | `number` |  |
| `shearX` | `number` |  |
| `shearY` | `number` |  |
| `inherit` | `number` | One of `INHERIT`. |

### `SlotData`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `index` | `number` |  |
| `name` | `string` |  |
| `bone` | `BoneData` |  |
| `color` | `number[]` | Setup colour [r, g, b, a] in 0..1 |
| `attachment` | `string \| null` | The attachment shown at rest |
| `blend` | `'normal' \| 'additive'` |  |
