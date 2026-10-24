# {{title}}

A 3D game made of data: prefabs (what things are), a scene file (where they are), and a few lines of code that run and draw them.

```
npm install
npm run dev       # http://127.0.0.1:8080/ (the game) and http://127.0.0.1:8080/editor.html (the scene editor)
npm test          # the scene is valid and runs
npm run build     # bundle, minify, hash: dist/ (the scene is hashed and cached like any asset)
```

## Where things are
- `src/prefabs.js`: the things that exist (`cube`, `ball`, `spinner`, `tower`…) as plain data, and the components they use.
- `scenes/main.json`: the level. Edit it by hand, or in the editor.
- `src/play.js`: spawns a scene into a world, updates it (the spinners turn) and draws it. The page and the editor's Play button share it.
- `src/main.js`: the page: loads the scene, orbit camera, fixed timestep.
- `src/editor.js` and `editor.html`: the scene editor for this game.

## The editor
Open `/editor.html` while `npm run dev` is running. Click things to select them, drag the arrows to move, `W`/`E`/`R` switch move / rotate / scale, `Ctrl+Z` undoes, `Ctrl+S` saves into `scenes/main.json`, `P` plays the scene. Add things from the Prefabs list. The inspector shows each prefab's parameters (`width`, `speed`…), components and anything else you can change; a ↺ puts a value back to the prefab's own.

## Next
- Add a prefab: a new entry in `PREFABS`, then it appears in the editor's list.
- Add behaviour: a component and a loop in `step` (see how `spin` works).
- Physics, AI, menus, sound, saving: `@engine/physics`, `@engine/ai`, `@engine/ui`, `@engine/audio`, `@engine/save`.
