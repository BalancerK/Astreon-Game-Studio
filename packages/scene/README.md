# @engine/scene

Levels as data: a scene file lists prefab instances (with a name, a place, parameters, overrides and a parent), the assets it needs, prefabs only it uses, and free-form settings. It loads into a running game, and `SceneDocument` is the editable, undoable model that the editor is built on.

```js
import { loadScene, SceneDocument, validateScene } from '@engine/scene';

const scene = await loadScene(json, spawner, { assets, offset: { x: 200 }, onProgress });  // assets first, then entities
scene.get('door-1');      // the prefab instance of that scene entity
scene.unload();           // destroys everything it spawned and releases its assets

const doc = new SceneDocument(json, { library });
doc.add({ prefab: 'crate', at: { x: 3 } });  doc.set('crate-1', 'at.y', 2);  doc.reparent('crate-1', 'room-1');
doc.undo(); doc.redo(); doc.dirty; doc.toJSON();   // save as a file
```

File format (`format: "engine-scene"`, `version: 1`):

```json
{ "format": "engine-scene", "version": 1, "name": "Warehouse", "settings": { "gravity": -9.8 },
  "assets": [ { "type": "image", "path": "tex/brick.png" } ],
  "prefabs": [ ],
  "entities": [ { "id": "door-1", "prefab": "sliding_door", "at": { "x": 0, "z": 22, "yaw": 1.57 }, "params": {}, "overrides": {}, "parent": null } ] }
```

- `at`: `x y z`, `yaw` (radians), `rotation` (quaternion), `scale`. For a child it is relative to the parent.
- Entities spawn parents first wherever they are in the file; `disabled: true` skips one (and its children); `loadScene(..., { filter })` skips by your rule.
- `validateScene(data, { library })` lists every problem at once (`entities[3].prefab: no prefab called "crat" (did you mean "crate"?)`); `loadScene` refuses a scene with errors before spawning anything, and a failed load leaves nothing behind.
- Older files go through `migrateScene(data, { 1: (scene) => ... })`; files from a newer editor are refused.
- `SceneDocument` operations: `add`, `remove` (`keepChildren`), `update` (a merge patch, `null` removes), `set(id, 'a.b.c', v)`, `reparent`, `rename`, `duplicate`, scene settings / assets / local prefabs. Each is one undo step; `batch(label, fn)` groups several (and rolls back if one throws); `{ merge: 'drag' }` folds a drag into one step. `onChange` says what changed; `dirty` follows the saved point.
- Saves and scenes: the `save` package stores spawned instances by prefab and what changed, so a loaded game restores the scene's entities; parent links of scene children are in the scene file, not the save.
