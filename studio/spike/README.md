# Studio spike (S0)

A feasibility prototype for the browser studio designed in [`docs/STUDIO.md`](../../docs/STUDIO.md). It is not the studio: it exists to find out, with measurements, whether the riskiest ideas hold. Throw-away in shape, but its parts are written to be reused.

```
npm run studio:spike      # then open http://localhost:8090/studio/spike/index.html  (note: localhost, not 127.0.0.1)
```

Edit the code on the left; the game on the right updates as you type and keeps its place. Break the code on purpose: a typo shows the file and line, a mistake while running shows where, and `while (true) {}` is caught and recovered.

| File | What it is |
|---|---|
| `index.html`, `studio.js` | The studio page: project in IndexedDB, tabs, editor, console, the frame |
| `editor.js` | A code editor with no dependencies: a real textarea over a highlighted layer; only visible lines are coloured |
| `runner.html`, `runner.js` | The page in the frame on **another origin**: stores files, checks them, runs the game in a worker, watches for hangs |
| `worker-host.js` | The game's own thread: loads the project's code, runs the fixed loop, draws to an OffscreenCanvas, copies its state out |
| `sw.js` | The runner's service worker: serves the project's files (and a syntax-check copy) from the cache |
| `starter.js` | The two-file project a new studio begins with |
| `selftest.js` | The same checks run inside the page, for browsers without a driver |

Tests: `node tools/studio-spike-test.js` (Chrome, 34 checks with timings), `node tools/studio-spike-compat.js` (the self-test in Chrome and Firefox).
