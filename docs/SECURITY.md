# Security model

This engine accepts code and data from people the server operator does not control (public mods) and traffic from anyone on the internet (players). This document says what we defend against, how, and, just as important, what we do **not** defend against. Facts marked *(measured)* were tested on Node 24.14 / Windows 11; rerun `node tools/mod.js selftest` after upgrading Node.

Reporting vulnerabilities: open a private security advisory on the repository (see `SECURITY.md` at the root once the repo is public). Do not file a public issue for an exploitable bug.

## 1. Assets and adversaries

| Asset | Threat |
|---|---|
| Server availability (tick rate, memory) | Mod that loops, allocates, or floods; client that floods packets; a crashing room |
| Server host (files, secrets, network position) | Mod code escaping its sandbox; malicious bundle contents |
| Game integrity (fairness) | Cheating client (speed, aim, fire rate, wallhack), mod that grants itself unlimited power |
| Players' machines | Malicious *client-side* mod code (we do **not** run mod code on clients, see 4) |
| Other rooms / other mods | A bad room or mod disturbing neighbours |

Adversaries: a malicious or buggy **mod author** (the main reason for this document), a **malicious client**, a **network attacker** (tampering with downloads), and a **curious server operator** is out of scope (the operator is trusted: they choose which mods run and own the machine).

## 2. Trust tiers for mods

| Tier | What it is | Trust required | Where it runs |
|---|---|---|---|
| 1 data | JSON: rule values (speed, damage, cooldown...) and presentation (theme) | None. Values are whitelisted and range-checked; there is no code. | Server and client both read it; the client verifies its hash first |
| 2 script | JavaScript hooks (`onFrame`...) that return *commands* | Low. Runs in the sandbox below, can only act through validated commands | Server only, in a separate process per mod |
| 3 native | A normal plugin (`definePlugin`) with full access | Full. Only for first-party code or a private server you control | In the engine process |

Public mods must be tier 1 or 2. Tier 3 is never loaded from a public source.

## 3. Tier-2 sandbox: four layers

No single layer is trusted alone.

**Layer 1: language sandbox (`node:vm`).** Each mod gets a fresh context created with `codeGeneration: { strings: false, wasm: false }` and `microtaskMode: 'afterEvaluate'`, then hardened: `Atomics`, `SharedArrayBuffer`, `WebAssembly`, `console`, `WeakRef`, `FinalizationRegistry` are deleted, `Error.prepareStackTrace` is locked, `Error.captureStackTrace` is removed, and the intrinsics are frozen so a mod cannot tamper with shared prototypes. *(measured)*: with this, `eval`, `new Function`, and every `constructor.constructor(...)` variant (functions, async functions, generators) throw `EvalError`; `process`, `require`, `fetch`, `setTimeout` do not exist; `import()` fails with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`; prototype pollution stays inside the mod's own realm.
- **The boundary carries strings only.** *(measured)*: if a host function or object is ever put into the context, `hostFn.constructor("return process")()` returns the real `process`. So the host never passes objects or functions in; it calls into the context with a script containing a JSON string literal and receives a JSON string back. This is a hard rule for anyone modifying the sandbox.

**Layer 2: CPU budget and watchdog.** Every call runs with `vm` `timeout` (default 2 ms for a frame, 5 ms at most; 250 ms for loading, which also covers a cold start under load). *(measured)*: `while(true){}`, microtask loops, promise chains, catastrophic regexes and `Atomics.wait` are all interrupted at the limit (about +4 ms). A mod that overruns gets a strike. The host also keeps a hard watchdog: if the sandbox process does not answer within a multiple of the budget, it is killed and restarted.

**Layer 3: process confinement.** Each mod runs in its own child process started with:
- `--permission` and no `--allow-*` except reading its own runtime file. *(measured)*: file read, file write, directory listing, spawning processes and starting workers all fail with `ERR_ACCESS_DENIED`.
- `--max-old-space-size=<memoryMb>`. *(measured)*: a runaway allocation is killed in about 110 ms (exit 134). Without the flag the same loop consumed gigabytes for over 3 seconds. **The vm timeout alone does not bound memory.**
- A scrubbed environment (`env: {}`), so secrets in the server's environment are not inherited. *(measured on Windows)*: the OS still adds its own standard variables (HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERDOMAIN, USERNAME, USERPROFILE, WINDIR); none of the server's own variables arrive (tested with a planted secret). Mod code cannot read any of them anyway: it has no `process` object.
- Below-normal OS priority, so a busy mod cannot starve the game loop.
- No inherited stdio; the only channel is the IPC message port.

**Layer 4: API boundary.** Results are size-capped before parsing; only whitelisted *commands* with typed, range-checked fields are accepted (unknown fields and unknown operations are rejected); commands per call are capped; the game, not the mod, decides what each command does (a `teleport` into a wall is refused; a `heal` cannot exceed max health). Violations are **strikes**: too many strikes in a window disable the mod, and crashes restart it a bounded number of times, then disable it. Strikes never affect other mods or the server tick.

## 4. What clients run

Clients never execute mod code. A client downloads the **client bundle** of each mod the server advertises (`{id, version, rules, client}`, pure data) from a content-addressed URL, recomputes its SHA-256, and refuses to play if it does not match the hash in the server's WELCOME. So a network attacker or a compromised file host cannot change the rules a client predicts with. (If the page is not a secure context, the browser has no `crypto.subtle`; the engine falls back to a pure-JS SHA-256, tested against the same vectors.)

## 5. Provenance (optional)

Bundles can carry an Ed25519 signature over their hash. A server policy can require a signature from a trusted key, or pin allowed hashes. A signature proves *who published a bundle*, not that it is safe; the sandbox is what limits damage.

## 6. Residual risks (read this before exposing mods to the public)

1. **`node:vm` is not a security boundary against a determined attacker.** It is a strong language-level sandbox when used as above, but V8 or Node bugs can allow escapes. Layer 3 exists to contain that case, and is also not absolute.
2. **Network egress is not blocked.** *(measured)*: under `--permission`, a child can still open TCP connections and call `fetch` (Node 24 does not cover the network). An attacker who first escapes the vm could send data out or probe the internal network. Mitigation: run the game server in a container or network namespace with egress rules, as an unprivileged user, ideally on a host without secrets. Environment variables are scrubbed (apart from the OS's standard ones on Windows), but anything the process can reach is reachable.
3. **Resource limits are per process, not per OS job.** A mod cannot exceed its heap or per-call CPU budget, but a determined attacker with many mods could still consume aggregate CPU/memory. `maxMods`, per-mod caps and below-normal priority bound this; OS-level limits (cgroups/Job Objects) are the real fix and are not implemented here.
4. **Side channels.** Timing measurements from inside a mod are coarse (no `Atomics`, no `SharedArrayBuffer`, `Date` is available) but not eliminated.
5. **Supply chain of the runtime:** the sandbox is only as good as the Node version running it. Keep Node patched.
6. **Worker-thread rooms** (see `RoomManager`) isolate stalls and crashes between rooms; they are **not** a security boundary between rooms. Do not treat one room as a trust boundary against another.
7. **Client-side script mods are not supported** precisely because there is no equivalent of layer 3 in a browser that we control. Presentation is data-only.

## 7. Reviewing this

When changing the sandbox: re-run `node tools/mod.js selftest`, keep the escape-attempt tests (`packages/mods/test`) passing, and add a test for every new capability. Never add a host object or function to the mod context.
