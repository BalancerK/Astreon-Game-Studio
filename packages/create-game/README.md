# @engine/create-game

Start a game: `npx create-game my-game` makes a folder with a working project, installs the engine, and tells you what to type next.

```
npx create-game my-game                  # the 2D starter
npx create-game my-world --template 3d   # the 3D starter, with the scene editor
npx create-game --list
cd my-game && npm run dev                # http://127.0.0.1:8080/ with live reload
```

## Templates
| Template | What you get |
|---|---|
| `2d` | A small top-down game: move, collect coins, dodge hazards. The rules are in `src/game.js` with no page code (and tests), the page in `src/main.js`: fixed timestep, keyboard and gamepad through actions, a best score saved in the browser. |
| `3d` | A game made of data: a prefab library (`src/prefabs.js`), a scene file (`scenes/main.json`), code that spawns, updates and draws it (`src/play.js`), an orbit-camera page and the browser **scene editor** (`/editor.html`) already wired to your prefabs, with Play. |

Every project has the same commands: `npm run dev`, `npm test` (the game's own tests), `npm run build` (one hashed, minified script, a manifest of hashed assets, compressed copies and a `_headers` file: the folder to upload).

## Options
- `--template 2d|3d`
- `--no-install`: do not run `npm install`.
- `--engine-path <dir>`: link the packages from a checkout of the engine (`file:` dependencies, including what they need in turn) instead of installing from npm. For working on the engine itself.

## From code
```js
import { createProject, listTemplates } from '@engine/create-game';
createProject({ dir: 'my-game', template: '3d', install: true });
```

Adding a template: a folder in `templates/` with `template.json` (description, the engine packages it uses, extra scripts) and `files/` (copied; `{{name}}` and `{{title}}` are filled in; name `.gitignore` as `_gitignore`).
