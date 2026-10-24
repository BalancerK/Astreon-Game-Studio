# @engine/debug

In-page debug overlay for networked games: live graphs, info lines and a **decoded packet inspector**. Browser-only view on top of a plain-data model that is fully tested in Node.

**May import:** `@engine/core`, `@engine/protocol`, `@engine/transport`.

```js
import { DebugOverlay } from '@engine/debug';

const debug = new DebugOverlay({ title: 'My game (F3)', open: false });       // F3 toggles, ?debug=1 style flags are up to you
const transport = debug.tap(connectWebSocket(url));                             // wrap OUTERMOST to see what the game sees
debug
  .addSeries('rtt',  { label: 'RTT', unit: 'ms', read: () => client.rttMs, warnAbove: 150 })
  .addSeries('down', { label: 'Download', unit: 'KB/s', read: () => client.stats.bytes, rate: true, scale: 1 / 1024 })
  .addInfo('state', () => client.state);
```

## What you get
- **Graphs**, one per series, 10 s of history sampled every 100 ms. `read` returns a gauge, or a running total with `rate: true` (plotted as change per second). Values above `warnAbove` turn red. A throwing or non-numeric reader just leaves a gap; a debug probe can never break the game.
- **Packet inspector**: every packet in and out, decoded by `describePacket` (from `@engine/protocol`), e.g. `SNAPSHOT 376B tick 343 full, 41 entities, input ack 279` and `INPUT 18B seq 286..288 (3), snapshot ack 343`. Newest first, with channel (R/U) and size. `pause packets` freezes the list so you can read it while totals keep counting.
- **Info lines** for state that is not a number over time.
- Sampling always runs (cheap) so history exists when you open the panel; drawing happens only while it is visible. With it open in the arena demo the frame rate stayed at 144 fps.

## Pieces (all usable without the DOM)
`TimeSeries` (ring buffer with NaN-aware stats), `drawGraph` (draws into any 2D context), `PacketLog`, `OverlayModel` (series, rates, info, `tap`), `niceCeil`.

## Tests
Node: ring buffer wrap-around, graph geometry via a recording fake context, rate maths, packet log pause/totals, tapping a real transport. Browser (`node tools/debug-selftest.js`, Chrome and Firefox): the DOM view paints its graphs, formats values, lists packets, toggles with F3 and pauses. `node tools/arena-debug-shot.js` plays the real demo with real key events in headless Chrome, opens the overlay and checks it against live traffic.
