# @engine/mods

Load and run third-party mods safely. Pure JavaScript, no dependencies. Threat model: `docs/SECURITY.md`; author guide: `docs/MODDING.md`.

```js
// Anywhere (browser too): hashing, manifests, bundles, command and rule helpers.
import { validateManifest, validateBundle, hashBundle, hashClientView, clientView, verifyClientView, canonicalJson, sha256Hex } from '@engine/mods';

// Node only: sandboxes, the manager, signatures, loading from disk.
import { ModManager, ModSandbox, SandboxCore, loadCatalog, loadBundleDir, generateSigningKey, signHash, verifySignature } from '@engine/mods/node';
```

## The pieces

| Piece | Job |
|---|---|
| `validateManifest`, `validateBundle` | strict checks: unknown fields, unsafe paths, size limits |
| `hashBundle`, `hashClientView`, `verifyClientView` | content hashes (canonical JSON, SHA-256). The client hash covers only what clients receive |
| `SandboxCore` | one mod in a hardened `node:vm` context. Strings only cross the boundary |
| `ModSandbox` | `SandboxCore` in its own child process: `--permission` (no files, spawn or workers), heap limit, no code generation, scrubbed environment, below-normal priority, watchdog |
| `ModManager` | policy, dependency order, per-mod frames without blocking, strikes, restarts, command validation, hot reload, rules merge |
| `loadCatalog`, `loadBundleDir` | read mod folders (symlinks skipped, size limits) |
| `generateSigningKey`, `signHash`, `verifySignature` | optional Ed25519 provenance |

## Using the manager

```js
const mods = new ModManager({ commands: { heal: { id: { type: 'int', min: 0 }, amount: { type: 'number', min: 0, max: 100 } } },
                              policy: { requireSignature: 'script', trustedKeys }, mode: 'process' });
for (const b of loadCatalog('mods').bundles) mods.add(b);
await mods.start();

// each game tick:
for (const { mod, cmd } of mods.drainCommands()) apply(cmd);   // validated; you still re-check against live state
mods.emitFrame(() => buildFrame());                             // lazy and non-blocking: skipped if a mod is still busy
```

`mode: 'inline'` runs the same sandbox core in this process. Use it only for trusted mods and tests: it has no memory cap and no process confinement.

## Guarantees and limits

Measured on Node 24 (see `docs/SECURITY.md`): `while(true)` and microtask loops are cut off at the budget; a memory bomb dies within about 100 ms and only takes its own process; a mod that spins forever never delays the caller. Not covered: network egress from the sandbox process (Node's permission model does not block it), so run servers that load public mods in a container with egress rules.
