# @engine/persist

Keeping what outlives a match: player profiles, leaderboards, accounts and logs. Everything sits on one small contract, a **versioned key-value store**, with a memory implementation for tests and a file implementation for a server; a database adapter implements the same five methods.

```js
import { MemoryStore, Profiles, Leaderboard } from '@engine/persist';
import { FileStore, GuestAccounts, AppendLog } from '@engine/persist/src/node.js';
```

## The store
```js
const store = new FileStore('./data');
await store.put('players', 'ann', { coins: 5 });                 // { version: 1 }
await store.get('players', 'ann');                               // { value: { coins: 5 }, version: 1 }
await store.put('players', 'ann', { coins: 9 }, { ifVersion: 1 });   // only if nobody changed it since
await store.update('players', 'ann', (v) => { v.coins += 1; });  // read, change, write; retries if someone else wrote in between
await store.list('players', { prefix: 'a', limit: 50, after: lastKey });
```
Every write bumps the version; `ifVersion` says which one you expect (`0` means "create only"), and a mismatch throws `StoreConflictError`, so two servers cannot silently overwrite each other. Names are letters, digits and `_ . @ : -`. `FileStore` writes each record to its own file via a temporary file and a rename (a crash never leaves half a record), queues writes per record, reports a damaged file instead of ignoring it, and is for one server per folder.

## Profiles: `Profiles`
```js
const profiles = new Profiles({ store, spec: { version: 2, create: (id) => ({ name: id, coins: 0 }), migrations: { 1: (d) => ({ ...d, unlocked: [] }) } } });
const p = await profiles.openProfile(playerId);   // when they connect: created the first time, upgraded if old
p.change((d) => { d.coins += 5; });               // in memory: no database round trip per action
await profiles.close(playerId);                   // when they leave: written
await profiles.closeAll();                        // on shutdown
```
Changed profiles are also written every `flushMs` (5 s). Old layouts are upgraded as they are read (and saved in the new layout); a profile saved by a newer game is refused. If another server changed the same profile in between, `spec.merge(mine, theirs, base)` combines the two (add up both sides' earnings); without it yours is kept and the conflict is counted in `stats`.

## Leaderboards: `Leaderboard`
`submit(id, score, { mode: 'best' | 'replace' | 'add' })`, `rank(id)`, `top(10, offset)`, `around(id, 3)` (you and your neighbours), `remove`, `reset()` for a new season; `order: 'asc'` for race times, `maxEntries` to keep only the best. Ties go to whoever got the score first. Sorted in memory (100 000 players submit in well under a second), saved as one record with `save(store, ns, key)` and restored with `Leaderboard.load`.

## Accounts and logs (Node)
`GuestAccounts`: `create()` returns a player id and a secret for the browser to keep; `authenticate(id, secret)` proves it is the same player (only a hash is stored, compared in constant time); `rotateSecret`, `link('google', externalId)` ties an outside login to one player (so progress follows them to another device), `findByLink`, `delete`.

`AppendLog`: JSON lines for match results, purchases or moderation, appended in order, rotated by size, `tail(100)` to read back.

Matchmaking uses this for ratings: see `examples/arena/test/matchmaking.test.js`.
