# Writing mods for the arena (and any game on this engine)

A mod is a folder with a `mod.json` and, for script mods, a `main.js`. There are two kinds you can publish:

| Tier | What it is | Runs where | Can do |
|---|---|---|---|
| **data** | `rules` and `client` sections in `mod.json`, no code | applied by server *and* clients | change numbers the game exposes (speed, damage, cooldown, health) and presentation (colours, title) |
| **script** | `main.js` | only in a locked-down sandbox process on the server | read a plain-data frame each few ticks and return *commands* (heal, damage, teleport, message) |

Players never run mod code. Clients only download the data part, and they refuse to play if it does not match its SHA-256.

The engine's own game plugins (tier 3, trusted native code) are a different thing: see `docs/PLAN.md`.

## Quick start

```
cp -r examples/arena/mods/_template examples/arena/mods/my-mod
# edit mod.json (change the id) and main.js
node tools/mod.js validate examples/arena/mods/my-mod
node tools/mod.js run examples/arena/mods/my-mod --frames 120     # runs it in the real sandbox with fake players
node tools/mod.js sign ...                                          # optional, see "Signing"
node examples/arena/server/main.js --mods examples/arena/mods      # play with it: http://127.0.0.1:8080/?room=test
```

## mod.json

```json
{
  "id": "my-mod",              // a-z 0-9 -, starts with a letter, up to 32 characters
  "version": "1.0.0",          // semver
  "tier": "script",            // "data" or "script"
  "entry": "main.js",          // script mods only; a relative .js path inside the folder
  "engine": "^0.0.1",          // optional: engine versions this mod works with
  "dependencies": { "other-mod": "^1.0.0" },   // optional: loaded first; missing or wrong version = rejected
  "rules": { "weapon": { "damage": 30 } },     // optional, see below
  "client": { "theme": { "wall": [255, 0, 128] } },   // optional presentation data
  "limits": { "tickEvery": 30, "tickBudgetMs": 2, "memoryMb": 48 }   // optional requests; the server may clamp them
}
```

Unknown fields are errors (typos should not pass silently).

### Rules (data)

Only these keys exist; values outside the range are ignored (and logged on the server):

| Key | Range | Default |
|---|---|---|
| `playerSpeed` | 50 to 2000 | 420 |
| `dashMult` | 1 to 5 | 2.5 |
| `weapon.range` | 100 to 3000 | 900 |
| `weapon.damage` | 1 to 100 (integer) | 25 |
| `weapon.cooldownTicks` | 1 to 120 (integer) | 10 |
| `weapon.maxHp` | 1 to 255 (integer) | 100 |

If several mods set the same key, the later one in load order wins, and the server logs the conflict. Rules apply on the server and in every client at the same time, so movement prediction stays exact.

### Theme (data)

`client.theme` may contain `floor`, `wall`, `dot` (each `[r, g, b]`, integers 0 to 255) and `title` (printable ASCII, 40 characters). Anything else is ignored.

## Script mods

```js
engine.register({
  onInit({ id, savedState }) { },                 // once at start, and after a hot reload
  onFrame(frame) { return [/* commands */]; },    // every `tickEvery` ticks
  serialize() { return { /* state to keep across a hot reload */ }; },
});
engine.log('text');                                // at most 20 lines of 200 characters per call
```

Hooks are synchronous. Return plain JSON (at most 64 KB). `frame` is `{ tick, players: [{ id, x, y, hp }], kills: [{ killer, victim }] }` with at most 64 players.

Commands you may return (anything else is rejected, and mostly-invalid output earns a strike):

| Command | Fields | Notes |
|---|---|---|
| `heal` | `id` (int), `amount` (0 to 100) | capped at max health |
| `damage` | `id`, `amount` (0 to 100) | cannot kill: leaves at least 1 hp |
| `teleport` | `id`, `x`, `y` (inside the world) | refused if the spot is inside a wall |
| `message` | `text` (up to 120 characters) | shown to all players; control characters removed |

At most 32 commands per call are accepted.

### What the sandbox takes away

No `require` or `import()`, no `process`, no timers, no `eval` or `new Function`, no network, no files. The language's own built-ins (`Math`, `JSON`, `Array`, ...) are there, frozen. The server also enforces:

* a CPU budget per call (2 ms by default, 5 ms at most); going over is a strike and the call is abandoned,
* a memory cap per mod (48 MB default); exceeding it kills only that mod's process,
* strikes: timeouts, exceptions and invalid output each earn one; five inside a minute disable the mod. Repeated crashes (more than 3 restarts in a minute) disable it too.

A mod is never trusted: slow, crashing, hostile or buggy mods cost their own frames, never the game's tick time.

## Signing (optional)

```
node tools/mod.js keygen mykey              # writes mykey.pub (share) and mykey.key (keep secret)
node tools/mod.js sign examples/arena/mods/my-mod mykey.key
```

A server operator can require signatures (`policy: { requireSignature: 'script', trustedKeys: [<pub hex>] }`) or pin exact bundle hashes (`allowHashes`). A signature says who published the mod, not that it is safe: the sandbox is what limits damage. Any edit invalidates the signature.

## For server operators

```js
startArenaGateway({
  modsDir: 'mods',
  modPolicy: { allowScript: true, requireSignature: 'script', trustedKeys: ['...'], allowHashes: null, maxMods: 16 },
});
```

See `docs/SECURITY.md` for what is and is not protected (network egress in particular: run the server in a container).
