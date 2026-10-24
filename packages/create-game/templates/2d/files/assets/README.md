Put sounds, images and data here. Everything in this folder is copied into the build under a name that contains its content hash,
and listed in `manifest.json`, so it can be cached forever. Load it with `@engine/assets`:

```js
import { AssetManager, basicLoaders, inlineManifest } from '@engine/assets';
const { manifest, base } = inlineManifest();
const assets = new AssetManager({ base, manifest }).registerAll(basicLoaders());
const level = await assets.load('json', 'assets/level.json');
```
(Add `@engine/assets` to the dependencies in package.json first.)
