# @engine/save

Save and load for any game: slots, quick and automatic saves, versioned data with upgrades, damage detection, and storage in memory, the browser, files on a server, or over HTTP. Zero dependencies, optional, and it works with the engine's other packages only through their `save()`/`load()` methods.

The smallest use: keep a best score between visits (this is what the `2d` template does).
```js
import { SaveGame, LocalStorageStorage, valueSection } from '@engine/save';

const progress = { best: 0 };
const saves = new SaveGame({ game: 'my-game', version: 1, storage: new LocalStorageStorage('my-game:') });
saves.section('progress', valueSection(() => progress, (d) => Object.assign(progress, d)));
try { await saves.load('best'); } catch { /* nothing saved yet */ }
// later, when the score improves:
progress.best = Math.max(progress.best, score);
await saves.save('best');
```

The full feature set:
```js
import { SaveGame, AutoSaver, LocalStorageStorage, sceneSection, physicsSection, objectsSection } from '@engine/save';

const saves = new SaveGame({ game: 'my-game', version: 1, storage: new LocalStorageStorage('my-game:'), compress: true });
saves.section('scene', sceneSection(spawner));          // prefab instances, by name + what changed
saves.section('physics', physicsSection(world));        // bodies, joints, sleep, impulses
saves.section('machines', objectsSection(() => machines)); // anything with save() / load()
saves.section('progress', valueSection(() => state, (s) => Object.assign(state, s)));

await saves.save('slot1', { title: 'Level 3', thumbnail: dataUrl });
await saves.list();            // newest first: slot, title, savedAt, playtime, size (cheap: headers only)
await saves.load('slot1');     // all-or-nothing
await saves.quicksave(); await saves.quickload();
const auto = new AutoSaver(saves, { every: 120, canSave: () => !inFight }); // auto.tick(dt) each frame
```

## What makes it safe
- **Checksum** in every file: a cut-off or damaged file is reported (`SaveError` code `corrupt`) instead of loaded. It is not protection against editing on purpose.
- **Backup**: each write first keeps the previous file as `.bak`. If the main file is damaged, `load` uses the backup (`recovered: true`).
- **All-or-nothing loads**: the file is read, checked and upgraded before the game is touched. If a section fails while being applied, the sections are put back as they were (`apply` error).
- **Versions**: `game` and `version` are checked (`game`, `newer`). Each section has its own version and `migrations: { 1: (old) => v2 }` upgrades one step at a time; whole-file steps go in `new SaveGame({ migrations })`. A missing path is a `migration` error, never a guess.
- Error codes: `missing`, `corrupt`, `newer`, `game`, `migration`, `section`, `apply`, `storage`.

## Sections
Registered in order, loaded in order. Register the scene before the physics that refers to its bodies.

| Section | Saves |
|---|---|
| `sceneSection(spawner)` | every prefab instance: id, how it was spawned, what changed since. Loading destroys and respawns them with the same ids, so your extras handlers run as the first time |
| `physicsSection(world)` | `world.getState()/setState()`; bodies and joints are matched by `key`, so set `body.key = \`${instance.id}:${path}\`` in the handler that creates them |
| `objectsSection(map)` | things with `save()`/`load()` by name: state machines, animation graphs, `BehaviorTree.save(bbKeys)`, `Memory.save()` |
| `valueSection(get, set)` | plain game values (score, level, flags) |
| `rngSection(rng)` | a random generator's `state` |
| `ecsSection(world, components)` | games without prefabs: all entities and components, with `refs` fields remapped to the new entity ids |

## Storage
`MemoryStorage`, `LocalStorageStorage` (about 5 MB: use `compress`), `IndexedDbStorage`, `HttpStorage` (client) and, from `@engine/save/src/node.js`, `FileStorage` (atomic writes) and `createSaveHandler({ storageFor, userOf })` (server side: size limits, key checks, `If-Match` ETags so two devices cannot silently overwrite each other; put your own authentication in `userOf`). Anything with async `get/set/delete/keys` works.

## Cloud saves: `CloudSync`
```js
import { CloudSync, HttpStorage } from '@engine/save';
const cloud = new CloudSync({ local: deviceStorage, remote: new HttpStorage('https://example.com/saves', { headers: { authorization } }), strategy: 'newest' });
const report = await cloud.sync();      // { uploaded, downloaded, deleted, conflicts, failed, same, results: [{ slot, action, ... }] }
```
It compares each slot on the device with the server's using a small record, kept on the device, of the file both held when they last agreed: only the device changed, upload; only the server, download; both, a **conflict** (played offline on two devices), settled by `strategy`: `'newest'` (later `savedAt`), `'local'`, `'remote'`, `'ask'` (nothing is written; `resolve(slot, 'local' | 'remote' | mergedFile)` once the player chooses), or a function `(localFile, remoteFile) => 'local' | 'remote' | mergedFile`. The replaced file is kept as `.bak`; a damaged file is reported and never uploaded; an unreachable server fails each slot without throwing; a write that races another device is refused by the server (`If-Match`) and reported, and the next sync sees both changes. `deletions: true` carries deletions across (off by default: a slot missing on one side is brought back). Where the server runs is up to you (`createSaveHandler` in `node.js` is one); nothing here chooses a host.

Tips: save `meta` (title, level, thumbnail) for the load screen; pass `clock` for exact tests; `saves.on('afterLoad', fn)` to refresh caches; keep bullets and effects out of the scene with `sceneSection(spawner, { filter })`.
