# @engine/core

The foundation: fixed-timestep loop, typed-array ECS, plugin system. Runs identically in Node and browsers; no DOM, no timers, no network.

**May import:** nothing. **Never import:** any other engine package.

## Public API (`src/index.js`)
| Export | Purpose |
|---|---|
| `FixedLoop` | `advance(elapsedSeconds)` runs fixed ticks, passes interpolation `alpha` to `render`. Caps catch-up at 0.25 s. |
| `World`, `defineComponent` | Struct-of-arrays components. `world.data(Comp).x[id & INDEX_MASK]` in hot loops; `world.query(out, [A, B])` fills a `Uint32Array` without allocating. |
| `entityIndex`, `entityGeneration`, `INDEX_MASK` | Entity ids are 20-bit slot + 12-bit generation, so stale ids are never mistaken for recycled entities. |
| `App`, `PluginApp`, `definePlugin` | Everything is a plugin. Components, systems, resources and events are namespaced with the plugin id. |
| `Scheduler` | Orders systems by `before`/`after`; constraints on absent systems are ignored (headless-friendly); cycles produce a readable error. |
| `EventBus` | Plugins talk through events and public components, not each other's internals. |

## Example
```js
import { App, definePlugin } from '@engine/core';

const movement = definePlugin({
  id: 'movement', version: '1.0.0',
  setup(p) {
    const Pos = p.defineComponent('pos', { x: 'f32', y: 'f32' }); // "movement:pos"
    p.addSystem('step', (dt) => { /* iterate p.world.data(Pos) */ });
  },
});

new App().use(movement).update(1 / 60, 0);
```

## Rules for shared (client + server) systems
Use only `+ - * /` and `sqrt` (exactly specified; also `floor`, `round`, `abs`, `fround`); never `Math.sin/cos/tan/pow/exp/log/hypot/...`, `**`, `Date.now`, `Math.random`. Prediction depends on it: `node tools/determinism.js` shows Node, Chrome and Firefox disagree on those functions (even sin/cos/tan), while everything restricted to the safe set is bit-identical. `tools/check-shared-math.js` enforces the rule in `npm test` (opt out render-only lines with a `determinism-ok: reason` comment).
