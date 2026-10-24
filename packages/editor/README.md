# @engine/editor

A browser scene editor for games built on the engine: a viewport with move / rotate / scale handles, a hierarchy, an inspector generated from your prefabs, undo and redo, saving scene files, and Play to run the scene for real. The scene file is the one `@engine/scene` loads, so what you edit is what ships.

```
npm run editor        # physics playground: open the printed address (examples/physics3d/editor.html)
```

## Putting it in your game
Two files: a page and a config. The page is empty (`<script type="module" src="./editor.js">`); `editor.js`:

```js
import { startEditor, HttpSceneStore } from '@engine/editor/src/browser.js';

window.__editor = await startEditor({
  title: 'My game',
  library,                                   // your PrefabLibrary (no physics world needed: it is only read)
  scenes: new HttpSceneStore('/__scenes'),   // list / load / save, here on the dev server
  scene: 'level1',                           // opened first
  hidePrefabs: ['thing'],                    // abstract bases left out of the palette
  describe(spec) { return spec.components.sprite && { shape: { type: 'box', hx: 1, hy: 1, hz: 0.1 }, color: [1, 1, 1] }; }, // optional: how a prefab looks
  scenery: (list, meshes) => drawGroundAndWalls(list),      // optional: things that are not entities
  createRuntime(scene, { library }) {        // optional: what Play does
    const game = buildGame({ scene });
    return { step: (dt) => game.step(dt), draw: (list, meshes) => game.draw(list), dispose() {} };
  },
});
```
Serve it with `serve({ root, writable: [{ route: '/__scenes', dir: 'scenes' }] })` from `@engine/build` (`node tools/editor.js <example>` does it for an example). The editor never needs your game's code to run to show a scene: prefabs are drawn from their data (`extras.body.shape`, the `colour` component, a door's slab, parts of child prefabs; anything else is a small marker so it can still be picked). `describe(spec)` says more.

## Using it
- **Viewport**: right-drag orbits (hold, then `W A S D Q E` to fly), middle-drag pans, wheel zooms, `F` frames the selection. Click selects, shift / ctrl-click adds, dragging on empty space box-selects.
- **Handles**: `Q` select, `W` move, `E` rotate, `R` scale (uniform: the entity has one scale). `X` switches world / local handles, `G` snaps (0.5 m, 15°, 0.1). A whole drag is one undo step. With several selected, they move together; rotation and scale are about their centre.
- **Hierarchy**: click, shift-click (range), ctrl-click; drag a row onto another to make it a child, onto its top or bottom edge to reorder; double-click frames it.
- **Inspector**: transform, the prefab's parameters, its components (colours show a swatch) and extras. Values you have changed are marked and have a ↺ to go back to the prefab's. Typing or dragging a number is one undo step. Errors appear under the field.
- **Prefabs panel**: click to add at the view centre, or drag into the viewport to drop on the ground; the new thing rests on the ground.
- `Ctrl+Z` / `Ctrl+Y` undo and redo, `Ctrl+D` duplicate, `Ctrl+C` / `Ctrl+V` copy and paste (as text, so it works between scenes and windows), `Delete`, `Ctrl+S` save, `P` play / stop, `Esc` deselect or stop, `?` the key list.
- **Problems**: the status bar counts validation errors and warnings (`validateScene`); click it for the list, click a line to select that entity.
- **Play** runs the scene through your `createRuntime`; editing is locked while it plays, and Stop returns to the editor with the scene untouched. A scene with errors does not play.

## Pieces you can use without the page
Everything in `src/index.js` runs anywhere (Node tests, other tools): `Selection`, `SceneView` (what to draw and pick for a scene document), picking (`rayFromScreen`, `pick`, `inRect`), `Gizmo` (hit testing and drag maths for move / rotate / scale with snapping), `OrbitController`, `inspect` / `applyField` / `resetField` (the inspector as data), `copyText` / `pasteText`, `Shortcuts`, scene stores (`MemorySceneStore`, `HttpSceneStore`), and the pose helpers in `transform.js`.

## Not done yet
Editing several entities at once in the inspector, non-uniform scale, a scene-asset list editor and asset browser, editing prefabs themselves, hot-reloading prefab changes into a running Play, and touch input.
