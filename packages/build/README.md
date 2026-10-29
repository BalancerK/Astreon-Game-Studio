# @engine/build

The production build and the development server for games made with the engine. Zero dependencies (Node 20+).

```
npx engine-build build            # bundle, minify, hash, write dist/
npx engine-build dev --port 8080  # serve the project with a live manifest and page reload
npx engine-build inspect src/main.js   # which modules weigh what
```

`engine.config.json` (or `engine.config.js` exporting the object):

```json
{ "pages": ["index.html"], "assets": ["assets/**"], "outDir": "dist", "publicPath": "", "minify": true,
  "compress": ["gzip", "brotli"], "define": { "DEBUG": "false" }, "alias": { "@game": "src" } }
```

## What a build does
- **Bundles** the code each page's `<script type="module" src>` reaches into one script (only modules actually imported are included), minifies it (comments and whitespace; names are not shortened — gzip does most of the work: the physics playground is 518 KB of source, 412 KB minified, 105 KB gzipped), and loads it with `defer`.
- **Hashes files**: everything in `assets` plus whatever the pages point at (stylesheets, icons, images, and `url()` in CSS) is copied as `name.<hash>.ext`. Same content, same name; different content, different name, so everything can be cached forever.
- **Manifest**: `manifest.json` maps `assets/level.json` to `{ url, hash, bytes }`; each page also carries it inline (`<script id="asset-manifest">`), so there is no extra request:
  ```js
  import { AssetManager, inlineManifest } from '@engine/assets';
  const { manifest, base } = inlineManifest();
  const assets = new AssetManager({ base, manifest });   // assets.load('json', 'assets/level.json') fetches the hashed file
  ```
- **Compresses**: `.gz` and `.br` copies next to files that shrink by at least 5 %.
- **Headers**: a `_headers` file (Netlify / Cloudflare Pages format): hashed files `immutable`, pages and manifest `no-cache`. Other hosts: do the same.
- **Reproducible**: same input, same bytes. Per-file `transforms` (`{ ".png": (bytes, path) => bytes }`) run before hashing — hook in texture or audio compression.

## What the bundler supports
`import`/`export` in all ordinary forms, `export … from`, `export *`, literal `import('./x.js')`, relative paths, package names through `node_modules` (`exports` / `main`), `alias`, and `define` (replaces identifiers in code only, never in strings). `import` and `export` must start a line. It stops with a message naming the file for: circular imports, `export let/var` (importers would see a stale value), destructuring exports, and `await` at the top level of any module except the entry.

### A bundle behaves like real modules
- Every `import` (and `export … from`) is read first, in the order written, before the module's own code runs, as in a real module; a call above an import line works.
- `this` at the top of a module is `undefined`; `import.meta.url` is the module's address (relative to the page in a browser).
- `build` stops with a message if the bundle it wrote would not parse.
- `checkBundle(entry, { root, alias, define, only })` loads every module both as it is (in Node) and through the bundle and compares what each exports; give `only(id)` to leave out the modules that need a page (they are skipped anyway when they cannot load in Node). Put it in a test.
- `node tools/built-smoke.js <project>` (in the engine repository) builds the project, serves the result and opens each page in headless Chrome; any thrown error, rejected promise or failed load fails it. Use `--allow=text,...` for messages that are expected.

## Development server
`serve({ root, assets, port })` serves files as they are (no bundling: the browser loads your modules directly), injects a page-reload client into HTML, and keeps `/manifest.json` current with an ETag. Change a texture or level file and a running game with `watchManifest(assets, { url: '/manifest.json' })` reloads just that asset; change code or a page and the browser reloads.

## API
`build(config)` → `{ outDir, files, manifest, bundles, warnings }`, `formatReport(result)`, `bundle(entry, { root, minify, alias, define, expose })`, `checkBundle(entry, options)`, `minifyJs / minifyJson / minifyCss`, `serve(options)`, `matchFiles(root, globs)`.
