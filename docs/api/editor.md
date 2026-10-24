# @engine/editor

Browser scene editor: viewport with gizmos, hierarchy, inspector generated from prefabs, undo, saving, Play-in-editor; the pieces also work without a page.

```
npm install @engine/editor
```

Version 0.1.0. The package's own README ([packages/editor](../../packages/editor/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (66 of 66 documented)

| Name | Kind | Summary |
|---|---|---|
| [`ALIGNS`](#aligns) | constant | How a new block is turned when it is added: standing straight, or turned like the 3D cursor. |
| [`Gizmo`](#class-gizmo) | class | The move / rotate / scale handles of the scene editor, as maths: where the handles are for the camera, which one a ray hits, and what a drag does (`begin` / `update`), with snapping and world or local space. |
| [`HttpSceneStore`](#class-httpscenestore) | class | Scenes served by `serve({ writable: [{ route: '/__scenes', dir, ext: '.json' }] })` from `@engine/build`. |
| [`MIN_HALF`](#min_half) | constant | The smallest a half size may get: a box can be flattened but never turned inside out. |
| [`MemorySceneStore`](#class-memoryscenestore) | class | Scenes kept in memory (tests, demos). |
| [`Modal`](#class-modal) | class | One modal transform, from the key press to Enter or Esc. |
| [`NAME_MAX`](#name_max) | constant | The longest a name may be. |
| [`NO_TURN`](#no_turn) | constant | No turn. |
| [`ORIENTATIONS`](#orientations) | constant | The ways a lock to X, Y or Z can choose its directions: the world's, or the 3D cursor's own. |
| [`OrbitController`](#class-orbitcontroller) | class | The editor camera: orbits around a target, pans, zooms, flies and frames a box, and `apply` puts a `Camera3D` where it says. |
| [`PIVOTS`](#pivots) | constant | The ways a rotation or a stretch can pick its centre. |
| [`SceneView`](#class-sceneview) | class | A scene document seen as things to draw and pick. |
| [`Selection`](#class-selection) | class | What is selected in the editor. |
| [`Shortcuts`](#class-shortcuts) | class | Keyboard shortcuts such as `ctrl+z` or `delete`. |
| [`WEDGE_FACES`](#wedge_faces) | constant | The corners of the faces, each three or four, going round counter-clockwise as seen from outside. |
| [`aabbOf`](#aabbof) | function | The world box that holds an oriented box (its matrix and half sizes). |
| [`applyField`](#applyfield) | function | Apply an edit from the inspector as one undoable step. |
| [`atMatrix`](#atmatrix) | function | `at` (or a local pose) as a matrix. |
| [`atPatch`](#atpatch) | function | Remove the keys of `at` that a patch should clear (`yaw`, `rotation`, `scale` not in the new at) as `null`s for `SceneDocument.update`. |
| [`atRotation`](#atrotation) | function | The rotation of an `at` as a quaternion [x, y, z, w]. |
| [`axesOf`](#axesof) | function | The cursor's own x, y and z directions in the world, from its turn. |
| [`boxFeatures`](#boxfeatures) | function | Every face and edge of a box (6 and 12), with the place of its middle in the box's own frame. |
| [`canApply`](#canapply) | function | Are there changes to make, and none of them wrong? |
| [`copyText`](#copytext) | function | The text for the clipboard: the given entities and their descendants. |
| [`createBoxMode`](#createboxmode) | function | Shape edit for the box that is selected: the handles on its faces and edges, dragging them, and moving one with G. |
| [`createWedge`](#createwedge) | function | The ramp as a mesh for the 3D renderers (flat shaded). |
| [`cursorNote`](#cursornote) | function | The cursor as the note kept in the scene file (`editor.cursor`): only what is not the usual, or `null` when everything is the usual (so a scene nobody touched the cursor in stays as it was). |
| [`cursorText`](#cursortext) | function | The cursor as words for a message: `x, y, z` to two decimals. |
| [`decompose`](#decompose) | function | Position, rotation (quaternion) and uniform scale of a matrix. |
| [`defaultDescribe`](#defaultdescribe) | function | The default way to give a prefab part a shape and colour: a rigid body's shape (`extras.body.shape`), a door's slab, and the `colour` component if there is one. |
| [`describeFeature`](#describefeature) | function | The name of a feature in words: "right face", "top front edge". |
| [`describeKey`](#describekey) | function | The shortcut text for an event, e.g. |
| [`effectiveSpec`](#effectivespec) | function | The prefab data of an entity as it will really be: parameters and overrides applied (children's overrides too). |
| [`eulerFromQuat`](#eulerfromquat) | function | Euler angles in degrees (rotate about x, then y, then z in the world's frame: R = Rz·Ry·Rx) from a quaternion. |
| [`halfExtents`](#halfextents) | function | Half extents of a shape's bounding box, in the part's own frame. |
| [`inRect`](#inrect) | function | Entities whose parts' screen-space bounds fall inside a rectangle (for box selection). |
| [`inspect`](#inspect) | function | What the inspector shows for an entity: sections of fields (transform, the prefab's parameters, components, extras) with their values, the prefab's own values and which are overridden. |
| [`installBlender`](#installblender) | function | Switch the editor to the Blender-style keys and mouse. |
| [`medianOf`](#medianof) | function | The middle (the average) of some points, or null when there are none. |
| [`moveFeature`](#movefeature) | function | Move a face or an edge by a vector in the box's own frame (only the parts along the feature's axes count) and say what the box becomes. |
| [`nearestFeature`](#nearestfeature) | function | The feature nearest to a point on the screen, within a distance in pixels. |
| [`offsetToCursor`](#offsettocursor) | function | How far the selection has to move for its middle to be at the cursor. |
| [`parseValue`](#parsevalue) | function | Turn what was typed into the value the field needs. |
| [`pasteText`](#pastetext) | function | Paste text made by `copyText`: fresh ids, internal parents kept, the pasted roots placed under `parent` (default: where they were copied from) and moved by `offset`. |
| [`pick`](#pick) | function | The nearest hit among items with `matrix` and `half` (half extents of the local box). |
| [`pivotFor`](#pivotfor) | function | The point a rotation or stretch turns about for one object. |
| [`pointsOf`](#pointsof) | function | The points of a thing that can snap to a point: the corners and the middle of a box (the real corners, so a turned box has turned ones), the six corners of a ramp, the middle and the two ends of a capsule, the middle of a ball. |
| [`previewRename`](#previewrename) | function | What each of the selected entities would be renamed to. |
| [`quatFromEuler`](#quatfromeuler) | function | The quaternion for Euler degrees (inverse of `eulerFromQuat`). |
| [`rayAabb`](#rayaabb) | function | Distance along a ray to a box (slab test), or null. |
| [`rayFromScreen`](#rayfromscreen) | function | The ray through a pixel. |
| [`rayLine`](#rayline) | function | The closest approach of a ray to an infinite line: parameters along each and their distance. |
| [`rayOrientedBox`](#rayorientedbox) | function | Distance along a ray to a box that is moved, turned and scaled by `matrix`, or null. |
| [`rayPlane`](#rayplane) | function | Where a ray meets a plane (point and normal), or null if parallel or behind. |
| [`readCursorNote`](#readcursornote) | function | Read the note back, forgiving a bad one (anything wrong is the usual value). |
| [`resetField`](#resetfield) | function | Put a field back to what the prefab says (removes the entity's own value). |
| [`shapeHandles`](#shapehandles) | function | The size parameters of an entity that a stretch can change. |
| [`sizeOf`](#sizeof) | function | The width, height and depth of an entity's shape, in its own axes (twice the half sizes), or null. |
| [`snapAngle`](#snapangle) | function | Snap the angle of a turn about an axis so that the turned thing's sides run parallel to the sides of something else (the world's axes, another object, the 3D cursor). |
| [`snapCoordinate`](#snapcoordinate) | function | Snap one coordinate (the place of a face being dragged) to the sides and middles of other boxes on the same axis. |
| [`snapMove`](#snapmove) | function | Nudge a move so that the moving box lines up with the other boxes: its near side, middle or far side meets a near side, middle or far side of another box, on each axis that is allowed to move. |
| [`snapPoints`](#snappoints) | function | Snap a move so that one of the moving thing's points lands exactly on a point of another thing (corner to corner, middle to middle, corner to middle). |
| [`snapStretch`](#snapstretch) | function | Snap the size of a box that is being stretched about its middle. |
| [`snapTo`](#snapto) | function | Round `v` to the nearest multiple of `step` (`step` of 0 or less leaves it as it is). |
| [`stretch`](#stretch) | function | The parameters to set when an object is stretched along its own axes. |
| [`worldToLocalAt`](#worldtolocalat) | function | The `at` that puts something at a world pose when its parent has the given world matrix (null: no parent). |

## Functions

### `aabbOf`

```js
function aabbOf(matrix, half)
```

The world box that holds an oriented box (its matrix and half sizes).

**Returns** `{min: number[], max: number[]}`

<sub>src/snap.js:6</sub>

### `applyField`

```js
function applyField(doc, id, field, raw, { merge } = {})
```

Apply an edit from the inspector as one undoable step. `merge` folds a series of changes (dragging a number) into one step.

**Returns** `void`

<sub>src/inspector.js:109</sub>

### `atMatrix`

```js
function atMatrix(at = {}, out = new Float64Array(16))
```

`at` (or a local pose) as a matrix.

<sub>src/transform.js:16</sub>

### `atPatch`

```js
function atPatch(oldAt, newAt)
```

Remove the keys of `at` that a patch should clear (`yaw`, `rotation`, `scale` not in the new at) as `null`s for `SceneDocument.update`.

<sub>src/transform.js:76</sub>

### `atRotation`

```js
function atRotation(at = {})
```

The rotation of an `at` as a quaternion [x, y, z, w].

<sub>src/transform.js:9</sub>

### `axesOf`

```js
function axesOf(rotation = NO_TURN)
```

The cursor's own x, y and z directions in the world, from its turn.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `rotation` | `number[]` | a quaternion |

<sub>src/cursor.js:62</sub>

### `boxFeatures`

```js
function boxFeatures(half)
```

Every face and edge of a box (6 and 12), with the place of its middle in the box's own frame.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `half` | `number[]` |  |

<sub>src/box-edit.js:12</sub>

### `canApply`

```js
function canApply(rows)
```

Are there changes to make, and none of them wrong?

<sub>src/batch-rename.js:68</sub>

### `copyText`

```js
function copyText(doc, ids)
```

The text for the clipboard: the given entities and their descendants. Pass the selection's roots.

<sub>src/clipboard.js:7</sub>

### `createBoxMode`

```js
function createBoxMode(editor, { pointer, say, changed })
```

Shape edit for the box that is selected: the handles on its faces and edges, dragging them, and moving one with G. Returns what the keymap needs to run it.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `editor` | `any` | the object `startEditor` makes |
| `io` | `{pointer: () => {x: number, y: number}, say: (text: string) => void, changed: () => void}` |  |

<sub>src/box-mode.js:22</sub>

### `createWedge`

```js
function createWedge()
```

The ramp as a mesh for the 3D renderers (flat shaded).

<sub>src/wedge.js:16</sub>

### `cursorNote`

```js
function cursorNote({ position, rotation, pivot, orientation, align = 'world' })
```

The cursor as the note kept in the scene file (`editor.cursor`): only what is not the usual, or `null` when everything is the usual (so a scene nobody touched the cursor in
stays as it was).

<sub>src/cursor.js:73</sub>

### `cursorText`

```js
function cursorText(cursor)
```

The cursor as words for a message: `x, y, z` to two decimals.

<sub>src/cursor.js:42</sub>

### `decompose`

```js
function decompose(m)
```

Position, rotation (quaternion) and uniform scale of a matrix.

<sub>src/transform.js:22</sub>

### `defaultDescribe`

```js
function defaultDescribe(spec)
```

The default way to give a prefab part a shape and colour: a rigid body's shape (`extras.body.shape`), a door's slab, and the `colour`
component if there is one. Return `null` for a part that has no shape of its own.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `any` | The part's resolved prefab data. |

**Returns** `{shape: {type: 'box' \| 'sphere' \| 'capsule', hx?: number, hy?: number, hz?: number, radius?: number, halfHeight?: number}, color: number[]} \| null`

<sub>src/visuals.js:17</sub>

### `describeFeature`

```js
function describeFeature(feature)
```

The name of a feature in words: "right face", "top front edge".

<sub>src/box-edit.js:60</sub>

### `describeKey`

```js
function describeKey(e)
```

The shortcut text for an event, e.g. 'ctrl+shift+z'. `ctrl` also means the Command key.

<sub>src/shortcuts.js:4</sub>

### `effectiveSpec`

```js
function effectiveSpec(library, entity)
```

The prefab data of an entity as it will really be: parameters and overrides applied (children's overrides too).

<sub>src/visuals.js:36</sub>

### `eulerFromQuat`

```js
function eulerFromQuat(q)
```

Euler angles in degrees (rotate about x, then y, then z in the world's frame: R = Rz·Ry·Rx) from a quaternion.

<sub>src/transform.js:37</sub>

### `halfExtents`

```js
function halfExtents(shape)
```

Half extents of a shape's bounding box, in the part's own frame.

<sub>src/visuals.js:28</sub>

### `inRect`

```js
function inRect(camera, items, x0, y0, x1, y1)
```

Entities whose parts' screen-space bounds fall inside a rectangle (for box selection).

<sub>src/picking.js:75</sub>

### `inspect`

```js
function inspect(doc, id, { library })
```

What the inspector shows for an entity: sections of fields (transform, the prefab's parameters, components, extras) with their
values, the prefab's own values and which are overridden.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `doc` | `import('../../scene/src/document.js').SceneDocument` |  |
| `id` | `string` |  |
| `o` | `{library: import('../../prefab/src/library.js').PrefabLibrary}` |  |

**Returns** `{id: string, prefab: string, error: string \| null, sections: Array<{title: string, fields: any[]}>} \| null`

<sub>src/inspector.js:28</sub>

### `installBlender`

```js
function installBlender(editor)
```

Switch the editor to the Blender-style keys and mouse.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `editor` | `any` | the object `startEditor` makes |

**Returns** `{begin: (kind: 'grab' \| 'rotate' \| 'scale') => boolean, active: () => Modal \| null, dispose: () => void}`

<sub>src/blender.js:60</sub>

### `medianOf`

```js
function medianOf(points)
```

The middle (the average) of some points, or null when there are none.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `points` | `number[][]` |  |

<sub>src/cursor.js:15</sub>

### `moveFeature`

```js
function moveFeature(half, feature, delta)
```

Move a face or an edge by a vector in the box's own frame (only the parts along the feature's axes count) and say what the box becomes.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `half` | `number[]` | the half sizes now |
| `feature` | `{axes: number[], signs: number[]}` |  |
| `delta` | `number[]` | how far to move it, in the box's frame |

**Returns** `{half: number[], shift: number[], moved: number[]}` — the new half sizes, how far the box's middle moves (in its frame), and how far the feature really moved (less than asked when a side was stopped by the smallest size)

<sub>src/box-edit.js:45</sub>

### `nearestFeature`

```js
function nearestFeature(projected, x, y, reach = 12)
```

The feature nearest to a point on the screen, within a distance in pixels.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `projected` | `{id: string, kind?: string, x: number, y: number, depth: number}[]` | features with their screen place and how far they are from the camera |
| `x` | `number` |  |
| `y` | `number` |  |
| `reach` (optional) | `number` | pixels |

**Returns** `string \| null` — the id, preferring a nearer one when two are as close

<sub>src/box-edit.js:74</sub>

### `offsetToCursor`

```js
function offsetToCursor(points, cursor)
```

How far the selection has to move for its middle to be at the cursor.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `points` | `number[][]` | the objects' origins |

<sub>src/cursor.js:36</sub>

### `parseValue`

```js
function parseValue(field, raw)
```

Turn what was typed into the value the field needs. Throws a message fit to show next to the input.

<sub>src/inspector.js:90</sub>

### `pasteText`

```js
function pasteText(doc, text, { parent, offset = { x: 1, y: 0, z: 1 } } = {})
```

Paste text made by `copyText`: fresh ids, internal parents kept, the pasted roots placed under `parent` (default: where they were copied from)
and moved by `offset`. One undo step.

**Returns** `string[]` — the ids of the new roots (empty if the text is not a clip)

<sub>src/clipboard.js:18</sub>

### `pick`

```js
function pick(ray, items)
```

The nearest hit among items with `matrix` and `half` (half extents of the local box).

**Returns** `{item: any, t: number} \| null`

<sub>src/picking.js:65</sub>

### `pivotFor`

```js
function pivotFor(mode, median, cursor, own)
```

The point a rotation or stretch turns about for one object.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `mode` | `'median' \| 'cursor' \| 'individual'` |  |
| `median` | `number[]` | the middle of the selection |
| `cursor` | `number[]` |  |
| `own` | `number[]` | the object's own origin |

<sub>src/cursor.js:29</sub>

### `pointsOf`

```js
function pointsOf(item)
```

The points of a thing that can snap to a point: the corners and the middle of a box (the real corners, so a turned box has turned ones), the six corners of a ramp,
the middle and the two ends of a capsule, the middle of a ball.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `item` | `{matrix: ArrayLike<number>, half: number[], shape?: {type: string, radius?: number, halfHeight?: number}, ramp?: boolean}` |  |

**Returns** `number[][]`

<sub>src/snap.js:95</sub>

### `previewRename`

```js
function previewRename(items, o = {}, taken = [])
```

What each of the selected entities would be renamed to.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `items` | `{id: string, name?: string, prefab?: string}[]` | the selection, in the order that matters for numbering |
| `o` | `object` |  |
| `o.target` (optional) | `'name' \| 'id'` | what to rename: the name people see (default), or the unique id |
| `o.mode` (optional) | `'pattern' \| 'replace'` | a pattern with numbers, or find and replace |
| `o.pattern` (optional) | `string` | with `{n}` (a number), `{name}` (what it shows now), `{id}` and `{prefab}` |
| `o.start` (optional) | `number` | the first number (default 1) |
| `o.step` (optional) | `number` | how much each next number grows (default 1) |
| `o.digits` (optional) | `number` | pad numbers with zeros to this many digits (default 1: none) |
| `o.find` (optional) | `string` | the text to find (find and replace) |
| `o.replace` (optional) | `string` | what to put instead |
| `o.matchCase` (optional) | `boolean` | whether capitals matter when finding (default no) |
| `taken` (optional) | `Iterable<string>` | every id in the scene (to say which new ids would clash) |

**Returns** `{id: string, from: string, to: string, changed: boolean, error: string \| null}[]`

<sub>src/batch-rename.js:28</sub>

### `quatFromEuler`

```js
function quatFromEuler(deg)
```

The quaternion for Euler degrees (inverse of `eulerFromQuat`).

<sub>src/transform.js:46</sub>

### `rayAabb`

```js
function rayAabb(origin, dir, min, max)
```

Distance along a ray to a box (slab test), or null.

<sub>src/picking.js:20</sub>

### `rayFromScreen`

```js
function rayFromScreen(camera, sx, sy)
```

The ray through a pixel.

**Returns** `{origin: number[], dir: number[]}`

<sub>src/picking.js:13</sub>

### `rayLine`

```js
function rayLine(origin, dir, linePoint, lineDir)
```

The closest approach of a ray to an infinite line: parameters along each and their distance.

**Returns** `{s: number, t: number, distance: number} \| null` — `s` along the ray, `t` along the line (in units of `lineDir`, which should be unit length)

<sub>src/picking.js:54</sub>

### `rayOrientedBox`

```js
function rayOrientedBox(origin, dir, matrix, halfExtents)
```

Distance along a ray to a box that is moved, turned and scaled by `matrix`, or null.

<sub>src/picking.js:33</sub>

### `rayPlane`

```js
function rayPlane(origin, dir, point, normal)
```

Where a ray meets a plane (point and normal), or null if parallel or behind.

**Returns** `{t: number, point: number[]} \| null`

<sub>src/picking.js:42</sub>

### `readCursorNote`

```js
function readCursorNote(note)
```

Read the note back, forgiving a bad one (anything wrong is the usual value).

**Returns** `{position: number[], rotation: number[], pivot: string, orientation: string, align: string}`

<sub>src/cursor.js:84</sub>

### `resetField`

```js
function resetField(doc, id, field)
```

Put a field back to what the prefab says (removes the entity's own value).

<sub>src/inspector.js:128</sub>

### `shapeHandles`

```js
function shapeHandles(library, entity)
```

The size parameters of an entity that a stretch can change.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `library` | `import('../../prefab/src/library.js').PrefabLibrary` |  |
| `entity` | `any` | an entity of a scene |

**Returns** `{name: string, axes: string[], value: number}[] \| null` — null when the entity's prefab has no shape with size parameters

<sub>src/shape-edit.js:16</sub>

### `sizeOf`

```js
function sizeOf(library, entity)
```

The width, height and depth of an entity's shape, in its own axes (twice the half sizes), or null.

<sub>src/shape-edit.js:51</sub>

### `snapAngle`

```js
function snapAngle(axis, start, angle, targets, { threshold })
```

Snap the angle of a turn about an axis so that the turned thing's sides run parallel to the sides of something else (the world's axes, another object, the 3D cursor).
For each side of the thing and each side of a target it works out the angle that makes them parallel (in the plane the turn happens in; a side that points along the axis
does not turn and is left out), and takes the one nearest the angle asked for if it is within reach. Sides count in both directions, so a box also meets a target a quarter
turn away.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `axis` | `number[]` | the unit axis of the turn (world) |
| `start` | `number[]` | the thing's orientation before the turn, a quaternion [x, y, z, w] |
| `angle` | `number` | the turn asked for, radians |
| `targets` | `number[][]` | orientations to line up with (quaternions) |
| `o` | `{threshold: number}` | how close (radians) before it jumps |

**Returns** `{angle: number, target: number, from: number[], to: number[]} \| null` — the snapped angle, which target it met (an index into `targets`), and the directions of the thing's side and the target's side (after the turn) that are now parallel; null when nothing is in reach

<sub>src/snap.js:171</sub>

### `snapCoordinate`

```js
function snapCoordinate(value, axis, self, targets, { threshold, near = 3 } = {})
```

Snap one coordinate (the place of a face being dragged) to the sides and middles of other boxes on the same axis.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `value` | `number` | where the face is now, along world axis `axis` |
| `axis` | `number` | 0, 1 or 2 |
| `self` | `{min: number[], max: number[]}` | the box being edited, as it is now (to say which others are near) |
| `targets` | `{min: number[], max: number[]}[]` |  |
| `o` | `{threshold: number, near?: number}` |  |

**Returns** `{value: number, target: {min: number[], max: number[]}} \| null` — the place to snap to, or null

<sub>src/snap.js:78</sub>

### `snapMove`

```js
function snapMove(box, vector, targets, { threshold, axes = [true, true, true], near = 3 } = {})
```

Nudge a move so that the moving box lines up with the other boxes: its near side, middle or far side meets a near side, middle or far side of another box, on each axis
that is allowed to move.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `box` | `{min: number[], max: number[]}` | where the moving thing was at the start |
| `vector` | `number[]` | how far it is being moved now |
| `targets` | `{min: number[], max: number[]}[]` | the other boxes |
| `o` | `{threshold: number, axes?: boolean[], near?: number}` | `threshold`: how close (world units) before it jumps; `axes`: which axes may snap; `near`: how far away on the other axes a box may be and still count |

**Returns** `{vector: number[], guides: {axis: number, value: number, from: number[], to: number[]}[]}` — the nudged move and a line to draw for each snap

<sub>src/snap.js:40</sub>

### `snapPoints`

```js
function snapPoints(mine, vector, targets, { threshold })
```

Snap a move so that one of the moving thing's points lands exactly on a point of another thing (corner to corner, middle to middle, corner to middle).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `mine` | `number[][]` | the moving thing's points, where they were at the start |
| `vector` | `number[]` | how far it is being moved now |
| `targets` | `{min: number[], max: number[], points?: number[][]}[]` | the other things (a box that holds them, and their points) |
| `o` | `{threshold: number}` | how close (world units) a point must come before it jumps |

**Returns** `{vector: number[], guide: {from: number[], to: number[]}} \| null` — null when no point is close enough

<sub>src/snap.js:124</sub>

### `snapStretch`

```js
function snapStretch(factor, axes, targets, self, { threshold, near = 3, floor = true })
```

Snap the size of a box that is being stretched about its middle. Each side of the box moves out (or in) by the same amount, so the question is how far from the middle a side may
be: it snaps to a place where it meets a side or the middle of another box, to the floor and the world's other planes (zero), or to the other box's own half size (the same width,
height or depth).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `factor` | `number` | the stretch asked for (1 leaves the box as it is); the same on every axis that is stretching |
| `axes` | `{half: number, centre: number, k: number \| null}[]` | the axes that stretch: the half size now, where the middle is along the world axis `k` (null when the box's axis does not run along a world axis: nothing can snap on it) |
| `targets` | `{min: number[], max: number[], id?: string}[]` | the other boxes |
| `self` | `{min: number[], max: number[]}` | the box that holds the stretching one now (to say which others are near) |
| `o` | `{threshold: number, near?: number, floor?: boolean}` | `threshold`: how close (world units) before it jumps; `near`: how far away on the other axes a box may be and still count |

**Returns** `{factor: number, kind: 'side' \| 'size', axis: number, k: number, value: number, target: object \| null} \| null` — the snapped stretch, or null when nothing is in reach

<sub>src/snap.js:224</sub>

### `snapTo`

```js
function snapTo(v, step)
```

Round `v` to the nearest multiple of `step` (`step` of 0 or less leaves it as it is).

<sub>src/gizmo.js:10</sub>

### `stretch`

```js
function stretch(handles, factors)
```

The parameters to set when an object is stretched along its own axes.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `handles` | `{name: string, axes: string[], value: number}[]` | from {@link shapeHandles} |
| `factors` | `number[]` | how much along x, y and z (1 leaves it) |

**Returns** `Record<string, number>` — parameter name -> new value (only those that change)

<sub>src/shape-edit.js:40</sub>

### `worldToLocalAt`

```js
function worldToLocalAt(parentWorld, position, rotation, scale, previous = {})
```

The `at` that puts something at a world pose when its parent has the given world matrix (null: no parent).
Keeps `yaw` if the old `at` used yaw and the new rotation is still about the vertical axis; otherwise writes a `rotation` quaternion.

<sub>src/transform.js:59</sub>

## Classes

### `class Gizmo`

```js
class Gizmo
```

The move / rotate / scale handles of the scene editor, as maths: where the handles are for the camera, which one a ray hits, and
what a drag does (`begin` / `update`), with snapping and world or local space. Draws nothing and knows no DOM.

#### `Gizmo.constructor`

```js
constructor({ mode = 'translate', space = 'world', snap = {}, screenSize = 0.16 } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{mode?: 'translate' \| 'rotate' \| 'scale', space?: 'world' \| 'local', snap?: {move?: number, rotate?: number, scale?: number}, screenSize?: number}` | `snap`: grid step in metres, degrees, and scale factor (0 = off). `screenSize`: handle length as a fraction of the distance to the camera. |

#### `Gizmo.basis`

```js
basis(rotation)
```

The three axis directions (the object's own when `space` is local).

#### `Gizmo.size`

```js
size(origin, cameraPos)
```

World length of the handles so they look the same size at any distance.

#### `Gizmo.geometry`

```js
geometry(origin, rotation, cameraPos)
```

What to draw: `lines` ({id, from, to}) and `rings` ({id, points}).

#### `Gizmo.hit`

```js
hit(ray, origin, rotation, cameraPos)
```

The handle under a ray, or null.

#### `Gizmo.begin`

```js
begin(handle, ray, origin, rotation, scaleNow = 1, cameraPos = [0, 0, 0])
```

Start dragging a handle.

**Returns** `object \| null` — state for `update`

#### `Gizmo.update`

```js
update(st, ray)
```

The new pose for the current ray: `{position}`, `{rotation}` or `{scale}` (only the one the drag changes).

<sub>src/gizmo.js:16</sub>

### `class HttpSceneStore`

```js
class HttpSceneStore
```

Scenes served by `serve({ writable: [{ route: '/__scenes', dir, ext: '.json' }] })` from `@engine/build`.

#### `HttpSceneStore.constructor`

```js
constructor(base = '/__scenes', { fetch: f = globalThis.fetch?.bind(globalThis) } = {})
```

#### `HttpSceneStore.list`

```js
async list()
```

#### `HttpSceneStore.load`

```js
async load(name)
```

#### `HttpSceneStore.save`

```js
async save(name, scene)
```

#### `HttpSceneStore.remove`

```js
async remove(name)
```

<sub>src/store.js:13</sub>

### `class MemorySceneStore`

```js
class MemorySceneStore
```

Scenes kept in memory (tests, demos). Has the same `list / load / save / remove` as the other scene stores.

#### `MemorySceneStore.constructor`

```js
constructor(scenes = {})
```

#### `MemorySceneStore.list`

```js
async list()
```

#### `MemorySceneStore.load`

```js
async load(name)
```

#### `MemorySceneStore.save`

```js
async save(name, scene)
```

#### `MemorySceneStore.remove`

```js
async remove(name)
```

<sub>src/store.js:4</sub>

### `class Modal`

```js
class Modal
```

One modal transform, from the key press to Enter or Esc.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.kind` | `'grab' \| 'rotate' \| 'scale'` |  |
| `o.start` | `{x: number, y: number}` | where the mouse was (pixels in the viewport) when it began |
| `o.pivotScreen` | `{x: number, y: number} \| null` | where the objects' middle is on the screen (for rotating and scaling) |
| `o.view` | `{right: number[], up: number[], forward: number[], unitsPerPixel: number}` | the camera's directions and how big a pixel is at the objects |
| `o.local` (optional) | `number[][]` | the objects' own axes when there is one object ([[x], [y], [z]] unit vectors); the world's otherwise |
| `o.world` (optional) | `number[][] \| null` | other directions for the first press of X, Y or Z (the 3D cursor's axes); the world's when null |
| `o.snap` (optional) | `{move?: number, rotate?: number, scale?: number}` | steps used while Ctrl is held: metres, degrees, a scale factor |

#### `Modal.constructor`

```js
constructor({ kind, start, pivotScreen = null, view, local = null, world = null, snap = { move: 0.5, rotate: 15, scale: 0.1 } })
```

#### `Modal.name`

```js
get name
```

#### `Modal.axisVector`

```js
axisVector()
```

The axis (as a world direction) that is locked, or null.

#### `Modal.pointer`

```js
pointer(x, y, { shift = false, ctrl = false } = {})
```

Mouse moved to a pixel. `fine` (Shift) makes the mouse move a tenth as much, `ctrl` snaps.

#### `Modal.key`

```js
key(code, { shift = false, ctrl = false } = {})
```

A key pressed while it runs. Returns true when the key was for this transform (the page must not use it for anything else).

| Name | Type | Description |
|---|---|---|
| `code` | `string` | a key name: 'x', 'y', 'z', '0'..'9', '.', '-', 'Backspace', 'Enter', 'Escape' |
| `mods` (optional) | `{shift?: boolean, ctrl?: boolean}` |  |

#### `Modal.number`

```js
get number
```

The number typed so far, or null.

#### `Modal.result`

```js
result()
```

What the transform is right now.
- grab: `{vector}`, how far to move, in world units, as x y z
- rotate: `{axis, angle}`, a world axis and radians (counter-clockwise looking against the axis)
- scale: `{factors}`, how much to scale along each of the object's own x, y and z (1 leaves it)

#### `Modal.header`

```js
header()
```

The words for the top of the viewport, the way Blender's header says what is going on.

<sub>src/modal.js:25</sub>

### `class OrbitController`

```js
class OrbitController
```

The editor camera: orbits around a target, pans, zooms, flies and frames a box, and `apply` puts a `Camera3D` where it says.

#### `OrbitController.constructor`

```js
constructor({ target = [0, 1, 0], yaw = 0.6, pitch = 0.45, distance = 20, minDistance = 0.5, maxDistance = 500 } = {})
```

#### `OrbitController.setView`

```js
setView(name)
```

Look from the front, back, right, left, top or bottom, in an orthographic view.

| Name | Type | Description |
|---|---|---|
| `name` | `'front' \| 'back' \| 'right' \| 'left' \| 'top' \| 'bottom'` |  |

#### `OrbitController.viewName`

```js
get viewName
```

The name of the view when it is exactly one of the six, else null.

#### `OrbitController.toggleOrtho`

```js
toggleOrtho()
```

Switch between perspective and orthographic (number pad 5).

#### `OrbitController.orthoHeight`

```js
orthoHeight(fovY)
```

Half the height of the view in an orthographic view, so switching does not change how big things look at the target.

#### `OrbitController.forward`

```js
forward()
```

The direction the camera looks (from the camera towards the target).

#### `OrbitController.axes`

```js
axes()
```

The camera's right and up directions.

#### `OrbitController.orbit`

```js
orbit(dx, dy)
```

Drag in pixels.

#### `OrbitController.pan`

```js
pan(dx, dy, fovY, viewH)
```

Slide the view with a drag in pixels: what you grab follows the pointer.

#### `OrbitController.zoom`

```js
zoom(deltaY)
```

Mouse wheel: each notch changes the distance by 10 %.

#### `OrbitController.fly`

```js
fly(move, dt)
```

Fly: `move` = [right, up, forward], each -1..1; faster when further out.

#### `OrbitController.focus`

```js
focus(min, max, fovY = 1, aspect = 1)
```

Frame a world-space box so it fills the view (the narrower side of the view decides, so it fits in a tall, narrow viewport too).

#### `OrbitController.apply`

```js
apply(camera)
```

Put a `Camera3D` where this controller says (call `camera.update()` after).

<sub>src/orbit.js:13</sub>

### `class SceneView`

```js
class SceneView
```

A scene document seen as things to draw and pick. Cheap to ask repeatedly: it only recomputes what changed.

#### `SceneView.constructor`

```js
constructor(doc, { library, describe = defaultDescribe })
```

| Name | Type | Description |
|---|---|---|
| `doc` | `import('../../scene/src/document.js').SceneDocument` |  |
| `o` | `{library: import('../../prefab/src/library.js').PrefabLibrary, describe?: (spec: any) => ReturnType<typeof defaultDescribe>}` |  |

#### `SceneView.invalidate`

```js
invalidate()
```

#### `SceneView.worldMatrix`

```js
worldMatrix(id)
```

World matrix of an entity (its own pose on top of its parents').

#### `SceneView.items`

```js
items()
```

Every drawable part in the scene: `{id, path, matrix, shape, color, half, marker}`; `matrix` is the part's world matrix without any size.

#### `SceneView.itemsOf`

```js
itemsOf(ids)
```

#### `SceneView.bounds`

```js
bounds(ids)
```

World-space box around some entities, or null.

**Returns** `{min: number[], max: number[]} \| null`

<sub>src/visuals.js:78</sub>

### `class Selection`

```js
class Selection
```

What is selected in the editor. The last one picked is the primary (shown in the inspector, carries the gizmo). `follow(doc)`
drops entities that no longer exist; `roots(doc)` leaves out those inside another selected entity.

#### `Selection.constructor`

```js
constructor()
```

#### `Selection.primary`

```js
get primary
```

#### `Selection.size`

```js
get size
```

#### `Selection.has`

```js
has(id)
```

#### `Selection.onChange`

```js
onChange(fn)
```

#### `Selection.set`

```js
set(ids)
```

#### `Selection.clear`

```js
clear()
```

#### `Selection.add`

```js
add(id)
```

#### `Selection.toggle`

```js
toggle(id)
```

#### `Selection.range`

```js
range(id, list)
```

Select everything between the primary and `id` in the order of `list` (hierarchy shift-click).

#### `Selection.follow`

```js
follow(doc)
```

Keep the selection valid as a scene changes: drop what no longer exists. Returns an unsubscribe function.

#### `Selection.roots`

```js
roots(doc)
```

The selected entities that are not inside another selected entity (what move / copy / delete act on).

<sub>src/selection.js:7</sub>

### `class Shortcuts`

```js
class Shortcuts
```

Keyboard shortcuts such as `ctrl+z` or `delete`. Pass key events to `handle(e)`; typing in a text box is never hijacked (except
save).

#### `Shortcuts.constructor`

```js
constructor()
```

#### `Shortcuts.bind`

```js
bind(keys, fn, label = '')
```

`bind('ctrl+z', fn, 'Undo')`; several keys at once with an array.

#### `Shortcuts.handle`

```js
handle(e)
```

Returns true if the event was handled (and then its default is prevented).

#### `Shortcuts.list`

```js
list()
```

A list for a help panel: [{keys, label}].

<sub>src/shortcuts.js:19</sub>

## Constants

### `ALIGNS`

```js
const ALIGNS
```

How a new block is turned when it is added: standing straight, or turned like the 3D cursor.

Value: `[`

<sub>src/cursor.js:47</sub>

### `MIN_HALF`

```js
const MIN_HALF
```

The smallest a half size may get: a box can be flattened but never turned inside out.

Value: `0.025`

<sub>src/box-edit.js:9</sub>

### `NAME_MAX`

```js
const NAME_MAX
```

The longest a name may be.

Value: `80`

<sub>src/batch-rename.js:6</sub>

### `NO_TURN`

```js
const NO_TURN
```

No turn.

Value: `[0, 0, 0, 1]`

<sub>src/cursor.js:53</sub>

### `ORIENTATIONS`

```js
const ORIENTATIONS
```

The ways a lock to X, Y or Z can choose its directions: the world's, or the 3D cursor's own.

Value: `[`

<sub>src/cursor.js:56</sub>

### `PIVOTS`

```js
const PIVOTS
```

The ways a rotation or a stretch can pick its centre.

Value: `[`

<sub>src/cursor.js:8</sub>

### `WEDGE_FACES`

```js
const WEDGE_FACES
```

The corners of the faces, each three or four, going round counter-clockwise as seen from outside.

Value: `[[A, B, C, D], [F, E, D, C], [E, F, B, A], [E, A, D], [B, F, C]]`

<sub>src/wedge.js:13</sub>
