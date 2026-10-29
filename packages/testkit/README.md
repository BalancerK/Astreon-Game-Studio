# @engine/testkit

Test a game in a real browser from a script, without a test framework: drive headless Chrome (keys, mouse, touch, screenshots, any DevTools call), time a page's frames, and check that a project's **built** pages load. It started as the engine's own `tools/cdp.js`; a game outside the engine checkout no longer has to import a path into it.

**May import:** `@engine/build`. Node 20 or later; it needs Chrome (or Edge) installed (`CHROME_PATH` names it if it is somewhere unusual). No dependencies.

```js
import { withChromePage, measureFrames, builtSmoke, CPU_RENDER_ARGS, UNTHROTTLED_ARGS } from '@engine/testkit';

await withChromePage('http://127.0.0.1:8080/game.html', async (page) => {
  await page.waitFor('!!window.game', 30_000);
  await page.key('KeyW', 'down');                                   // real key events ('KeyW', 'Tab', 'Escape'...), not letters
  console.log(await page.eval('window.game.score'));                // any expression, awaited, returned as plain data
  writeFileSync('shot.png', await page.screenshot());
  console.log(page.errors);                                         // uncaught exceptions and console errors so far
  console.log(await measureFrames(page, { seconds: 10, warmSeconds: 5 }));   // { frames, ms, fps }
}, { width: 1280, height: 720, args: [...UNTHROTTLED_ARGS] });

const { ok, results } = await builtSmoke('.', { pages: ['index.html'], allow: ['favicon', 'WebSocket connection'] });   // build, serve, open each page, fail on any error
```

## What you get
- `withChromePage(url, fn, { width, height, args })`: starts a browser with a fresh profile, hands `fn` a page and **always** ends the browser (`guardBrowser`: it finds the browser by its own profile folder, so a launcher that exits early cannot leave hundreds behind, and a watcher process cleans up if the test process is killed outright). The page has `eval`, `waitFor`, `key`, `type`, `mouse`, `touch`, `screenshot`, `setViewport(w, h, dpr)`, `errors`, and `send(method, params)` for any other DevTools call.
- `measureFrames(page, { seconds, warmSeconds })`: the average time of animation frames. `UNTHROTTLED_ARGS` stop the display's pace from capping the frame rate; `CPU_RENDER_ARGS` draw on the CPU, which is far slower than a real card and balances work differently, so it shows what scales with the picture (pixels, passes) but cannot say how fast the game runs on a given card (use a long `warmSeconds`: a software renderer takes tens of seconds to compile big shaders).
- `builtSmoke(root, { pages, wait, allow, args })`: builds the project the way it ships (its `engine.config.json`), serves the output and opens every page; a page that throws, rejects a promise, logs an error or cannot load a file fails. Node tests of the source cannot see what the bundler did to it; this can. `allow` lists texts of messages that are expected.
- `findBrowser(name)`, `guardBrowser`, `killProfile`: the pieces underneath.

## Tests
`npm test` runs the Node-side tests; the browser checks are `node tools/built-smoke-test.js` and `node tools/testkit-test.js` in the engine repository.
