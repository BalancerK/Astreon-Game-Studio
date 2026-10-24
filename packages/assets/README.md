# @engine/assets

Loading, caching and hot reloading game files. Zero dependencies; the decoders for images, sound and models are passed in, so it runs in the browser, Node and tests alike.

```js
import { AssetManager, basicLoaders, imageLoader, audioLoader, gltfLoader, watchManifest } from '@engine/assets';

const assets = new AssetManager({ base: '/assets/', manifest })   // manifest from the build step (hashed file names)
  .registerAll({ ...basicLoaders(), image: imageLoader(), sound: audioLoader({ context }), gltf: gltfLoader(parseGltf) });

await assets.loadAll(['tex/bricks.png', { type: 'sound', path: 'sfx/hit.ogg' }], { onProgress: ({ loaded, total }) => bar(loaded / total) });
const bricks = assets.acquire('image', 'tex/bricks.png');   // a handle: read bricks.value each time, it follows hot reloads
assets.release(bricks); assets.collect();                  // frees what nobody uses (calls the loader's dispose)
```

- **Once only**: concurrent requests share one fetch; later ones come from the cache. A type is guessed from the extension if you leave it out.
- **Manifest**: logical path -> `{ url, hash, bytes }`, so you ask for `tex/bricks.png` and the file `tex/bricks.3f2a9c.png` is fetched (cache forever, change the name when the content changes).
- **Failures**: 404 and other client errors are not retried; network errors and 5xx are (twice, with growing waits). `loadAll` collects every failure into one `AggregateError`. Asking again after a failure tries again.
- **Dependencies**: a loader can load other assets (`ctx.load('binary', ctx.sibling('tree.bin'))`); they are kept while the owner is, and released with it.
- **Hot reload**: `assets.update(newManifest)` reloads every loaded asset whose hash changed; `watchManifest(assets, { url })` polls for it. A broken new file keeps the old value. Handles keep their identity, `handle.version` counts reloads and `assets.on('reload', fn)` tells you.
- **Your own types**: `assets.register('level', { extensions: ['lvl'], load: async (ctx) => parse(await ctx.text()), dispose: (v) => v.free() })`. The context offers `bytes()`, `text()`, `json()`, `load()`, `sibling()`, `url`, `signal`.
- Node: `fileFetch(root)` from `@engine/assets/src/node.js` serves a directory through the same interface.
