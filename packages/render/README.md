# @engine/render

2D sprite rendering with three interchangeable backends: **WebGPU -> WebGL2 -> Canvas2D**, chosen automatically.

**May import:** `@engine/core` (currently nothing). The renderer never sees the network or the ECS: you hand it already-interpolated sprites.

## Pieces
| Export | Purpose |
|---|---|
| `createRenderer({ atlas, prefer? })` | Async. Tries each backend in order; each attempt uses a fresh canvas (a canvas locks to its first context type). Append `renderer.canvas` to the page; `renderer.kind` tells you which won. |
| `SpriteBatch` | Per-frame instance buffer: `clear()`, `push(x, y, w, h, rot, sprite, tint, key)`. 11 words per sprite (the last carries the atlas page and the SDF flag), identical for every backend. The optional `key` sorts draw order (below). |
| `sortKey(layer, y)` | A key for layered scenes: higher layer on top; within a layer, lower on screen (larger `y`) on top. |
| `Font` | Text through the same pipeline: `font.draw(batch, 'text', x, y, { tint, align, maxWidth, unit, size, key, shadow, snap })`, `font.measure(...)`, `font.wrap(...)`. `sdf: true` makes it **scalable**: sharp at any size, zoom or rotation. |
| `Atlas` / `ShelfPacker` | Sprite storage drawn at runtime with a 2D canvas: `atlas.add('name', w, h, (ctx, x, y, w, h) => ...)`. **Grows by itself**: when a page fills, the next page (up to `maxPages`, default 8) is started; all pages are layers of one texture array, so a scene is still one draw call. Only changed pages are re-uploaded. |
| `Camera` | Position, zoom, smooth `follow`, `shake`, `worldToScreen`, `screenToWorld`. World is +x right, +y down. `Camera.screen(w, h)` makes a screen-space camera (world unit = CSS pixel, origin top-left) for HUDs and text. |
| `packTint(r, g, b, a)` | Tint multiplies the sprite colour (white atlas shapes + tint = any colour). |

```js
const atlas = new Atlas({ size: 256 });
const dot = atlas.add('dot', 32, 32, (g, x, y, w) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(x + w / 2, y + w / 2, w / 2, 0, 7); g.fill(); });
const renderer = await createRenderer({ atlas });          // webgpu | webgl2 | canvas2d
document.body.append(renderer.canvas);
renderer.resize(innerWidth, innerHeight, devicePixelRatio);
const batch = new SpriteBatch(), camera = new Camera({ viewW: innerWidth, viewH: innerHeight });
batch.push(0, 0, 40, 40, 0, dot, packTint(255, 120, 0));
renderer.render({ camera, batch });                        // one draw call for the whole batch
```

## Sorting
Draw order is push order by default. Give sprites a `key` and they draw in ascending key order (ties keep push order), whatever order you pushed them in:
```js
batch.push(x, y, w, h, 0, sprite, tint, sortKey(0, y));   // world objects: lower on screen draws later (top-down depth)
batch.push(x, y, w, h, 0, ui, tint, sortKey(5));          // layer 5 is always on top
```
The renderer calls `batch.sort()` for you. It is a stable O(n) radix sort on the key bits (about 3 ms for 50,000 sprites), reuses its buffers, and does nothing at all when keys were pushed in ascending order, so scenes that do not use keys pay nothing. Keys are 32-bit floats and never reach the GPU.

## Text
```js
const font = new Font(atlas, { family: 'system-ui, sans-serif', size: 16, weight: 'bold', scale: devicePixelRatio });
const hud = new SpriteBatch(), screen = Camera.screen(innerWidth, innerHeight);
font.draw(hud, 'Score 120', 12, 12, { shadow: {} });
renderer.render({ camera: world, batch: worldBatch });                 // the game
renderer.render({ camera: screen, batch: hud, clear: null });          // overlay pass: `clear: null` keeps what is already drawn
```
Glyphs are drawn once, in white, into the shared atlas by the browser's own text engine (any font, accents, CJK, emoji), then drawn as ordinary sprites coloured by the tint: no extra draw call, identical in all three backends. Rasterise at `scale: devicePixelRatio` and draw with a screen-space camera for crisp small text; plain text in a zoomed world camera is bilinear-scaled and blurs. Layout is deliberately simple: per-glyph advances (no kerning, no complex-script shaping), `
` and word wrap, left/center/right alignment. A full atlas degrades to `?` instead of throwing (`font.atlasFull`). Use an atlas of 1024 or more if you use text.

### Rich text, right-to-left text, fallback fonts and bitmap fonts
`Font` now lays text out with a real paragraph engine: **accents and emoji sequences** are drawn as one unit (`graphemes`), **Arabic, Hebrew, Thai and Indic words** are shaped by the browser as whole words (one sprite per word, so letters join properly), and **mixed direction text** follows the Unicode bidirectional algorithm (`resolveBidi`, `visualRuns`; checked against Chrome on 6,762 strings). Plain Latin and CJK text keeps the old fast path. East Asian text breaks between characters, but never before closing punctuation or after an opening bracket.

```js
const family = new FontFamily(atlas, { family: 'system-ui, sans-serif', size: 18 });       // makes bold and italic on demand
const rich = new RichText({ family, atlas, fonts: { mono: new Font(atlas, { family: 'monospace', size: 16 }) } });
const layout = rich.layout('[b]Quest:[/b] bring [color=gold]3 coins[/color] [img=coin w=16 h=16 valign=middle] to [url=npc:mill]the mill[/url]', { maxWidth: 320 });
rich.draw(batch, layout, 20, 20, { time, visible: Math.floor(time * 30) });     // typewriter reveal, animated effects
const link = rich.linkAt(layout, mouseX - 20, mouseY - 20);                       // 'npc:mill' or null
```
Tags: `[b] [i] [u] [s] [color=red|#rrggbb[aa]] [size=28|+6] [shadow=dx,dy,#color] [outline=w,#color] [url=..] [font=name] [img=name w= h= valign=baseline|middle|top dy=] [wave] [shake] [rainbow] [fade] [center] [left] [right]`; `[[` or `\[` is a literal bracket; an unknown tag stays text, unclosed tags close themselves. `layout(text, { markup: false })` takes player chat literally. `FontStack` falls back from one font to the next for the characters a font lacks (found by measuring, or say `ranges` yourself). `BitmapFont` loads BMFont files (text, XML, JSON) with kerning, or a grid font sheet; it works inside `RichText` and `FontStack`.

### 2D filters (blur, glow, outline, pixelate, gradient map...)
Filters run over one batch: sprites, text, a whole camera. The renderer draws the batch into a picture of its own, runs the filters in order, and lays the result over the frame (so give a group its own batch, then draw it with `clear: null`, or use `renderLayers`).

```js
renderer.render({ camera, batch: world, filters: [Filter.sepia(0.6), Filter.vignette()] });                        // the whole camera
renderer.render({ camera, batch: ghosts, clear: null, filters: [Filter.glow({ color: '#60a0ff', radius: 10 })] });  // one group over what is drawn
renderer.renderLayers({ camera, layers: [{ batch: world }, { batch: boss, filters: [Filter.outline({ color: '#ff0', width: 2 })] }, { batch: hud }] });
wave.phase = time * 3;                                                                                              // filters are plain objects: change them each frame
```
`Filter.blur(radius)`, `glow({ color, radius, strength })`, `dropShadow({ dx, dy, color, alpha, blur })`, `outline({ color, width })`, `pixelate(size)`, `gradientMap([[0, '#000'], [0.5, '#c00'], [1, '#ff0']])` (up to 8 stops), `vignette(...)`, `wave({ amplitude, wavelength, phase, axis })`, and colour changes: `grayscale`, `sepia`, `saturate`, `hueRotate`, `brightness`, `contrast`, `invert`, `tint` (a hit flash) and any 4x5 `colorMatrix`. Sizes are in CSS pixels and follow the device pixel ratio. A chain needs three canvas-sized pictures; each step is one full-screen pass (a blur is two, a wide blur a few more), so a handful of filters is cheap and a dozen on a 4K screen is not. WebGPU and WebGL2 give the same result as `runFilters`, the CPU reference (checked in Chrome for every filter at pixel ratios 1 and 2); the Canvas2D fallback uses that CPU path, which is exact but slow, so keep filters small there.

### 2D lighting (normal maps, shadows, many lights)
Point lights, spot lights and a sun, with relief from **normal maps**, **shadows** from anything you draw into an occluder batch, and up to 64 lights at once (16 of them casting shadows), all in one pass of the sprite shader.

```js
atlas.add('floor', 64, 64, paintFloor, { normal: paintFloorNormals });        // a normal map beside the picture (red right, green up the picture, blue out)
atlas.add('lamp-glow', 32, 32, paintGlow, { unlit: true });                    // sprites that ignore the light
const lighting = new Lighting2D({ ambient: '#202838', specular: 0.3 });
const torch = lighting.add(Light2D.point({ x: 120, y: 90, radius: 160, color: '#ffb060', shadows: true }));
lighting.add(Light2D.spot({ x: 300, y: 40, angle: Math.PI / 2, cone: 0.9, radius: 260 }));
lighting.add(Light2D.directional({ angle: Math.PI / 4, elevation: 0.8, shadows: true, shadowLength: 120 }));   // a sun
renderer.render({ camera, batch: world, lighting, occluders: walls });          // `walls`: sprites whose shapes block light; drawn in the same camera
torch.x = player.x;                                                             // lights are plain objects: move them every frame
```
A light's `height` is how far it hangs above the picture: a low light rakes across relief, a high one lights it from above. A flat surface is lit exactly by the light's falloff; a normal map adds relief to that. Shadows come from the **alpha** of the sprites in the occluder batch; each shadow-casting light finds, for 512 directions, how far it gets before something blocks it, so a shadow costs one lookup per pixel rather than a search, and a bigger `size` makes a softer edge. A sprite that is itself an occluder is lit on top rather than shadowed by itself (`selfShadow: true` changes that). Everything drawn in that `render` call is lit; use another call (or `renderLayers`, with `lighting` per layer) for things that are not, such as a HUD. Lighting works with `filters`. Checked in Chrome against `lightPixel`, a CPU version of the same maths, on WebGPU and WebGL2 at pixel ratios 1 and 2 (within 1/255 away from soft shadow edges). The Canvas2D fallback draws unlit (`renderer.lightingSupported` says which you got).

### Triangle meshes
Anything a quad cannot do (a skeleton that bends, a rope, a flag) is drawn as triangles with a `MeshBatch2D`: each point has a position, a place in the atlas, a tint and an atlas page, and the whole batch is one draw call. `renderer.render({ camera, batch: sprites, meshes })` draws the meshes after the sprites of that call, under the same camera, filters and pixel ratio (lighting does not apply to meshes); `renderLayers` takes `meshes` per layer to interleave them. A slot or mesh can be `additive` (its light is added to what is behind it).

```js
const meshes = new MeshBatch2D();
meshes.pushQuad(sprite, [x0, y0, x1, y1, x2, y2, x3, y3], packTint(255, 255, 255, 200));      // a sprite squeezed into any four corners, clockwise from the top left
meshes.push(positions, uvs, triangles, sprite.page, tint, /* additive */ false);                // any triangle mesh (uvs are in the atlas page, 0..1)
renderer.render({ camera, batch: sprites, meshes });
```
`@engine/skeleton2d` is built on this. On Canvas2D each triangle is drawn by clipping and mapping the atlas, which is slow and uses only a tint's alpha, not its colour.

### Terrain, water, decals and a procedural sky
All plain data until you draw it, and all drawn through the same 3D pipeline (so lights, shadows, fog and the sky work on them), identically on WebGPU and WebGL2.

```js
// terrain: a grid of heights, cut into chunks with levels of detail, blended from four pictures by a splat map
const map = Heightmap.fromNoise({ size: 257, cell: 1, seed: 7, amplitude: 40, frequency: 2 });       // or fromImageData / fromFunction; sculpt, smooth, erode, raycast, heightAt, normalAt, toTriangles
const terrain = new Terrain(map, { chunkCells: 32, lods: 4 });
const splat = textures.add({ width: 256, height: 256, data: splatMap(map, { size: 256, rock: { slope: [28, 42] }, snow: { height: [26, 34] } }) });   // red = grass, green = rock, blue = sand, alpha = snow
list.setTerrain(splat, firstOfFourPictures, 0.25); terrain.addToDrawList(list, camera);
terrain.sculpt(x, z, 4, 0.5, 'raise');                               // paint with a brush: only the chunks it touches are rebuilt; renderer.releaseMesh(m) for terrain.takeDiscarded()

// a decal: the surface cut to a box and given projected texture coordinates, so it follows bumps and corners (a bullet hole, a scorch, a footprint)
const hole = terrain.createDecal({ position: [hit.x, hit.y, hit.z], size: 1.5, depth: 1.5, rotation: Math.random() * 6.28 });   // or createDecal(triangles, ...) for any geometry
list.setSurface(holeMaterial); list.add(hole, IDENTITY, 1, 1, 1, 1);

// the sky: a real atmosphere, drawn per pixel, with the lighting that goes with it
const sky = createSky({ sun: sunDirection({ hour: 17.5, latitude: 45 }), turbidity: 3, clouds: { coverage: 0.5 }, stars: true, moon: true });
renderer.render({ camera, list, lighting: { ...createLighting(), ...skyLighting(sky), sky } });         // advance sky.time for drifting clouds and twinkling stars
renderer.setEnvironment(proceduralSkyEnvironment(sky));              // now and then: shiny surfaces reflect this sky

// water (WebGL2 needs createRenderer3D({ water: true }): the water shading is a lot of shader code to compile): waves, depth colour, reflections of the sky, sun glints and shore froth
const sea = createWaterMesh({ x0: -200, z0: -200, x1: 200, z1: 200, level: 0, cell: 2, ground: (x, z) => map.heightAt(x, z) });
const lighting = { ...createLighting(), ...skyLighting(sky), sky, water: [createWaterStyle({ shallow: [0.1, 0.5, 0.5], deep: [0, 0.1, 0.25] })] };
list.setWater(0, time); list.add(sea, IDENTITY, 1, 1, 1, 0.4);       // after the solid things; waterHeightAt(x, z, time, style, depth) says where a boat floats
```
Terrain chunks are meshes with skirts hanging from their edges, so neighbouring levels of detail never show a crack; lighting uses the full-resolution normals at every level, so it does not change as a chunk coarsens. The splat map is a layer of the texture set whose four channels are the weights of four consecutive layers, tiled planar by the axis the ground faces (steep slopes are not stretched); `paintSplat` paints on it. The sky is single scattering through a spherical atmosphere (Rayleigh and Mie), the same in the shaders and in `skyRadiance` on the CPU; clouds, stars and the moon are in the shader too. Water needs a depth in each of its points (`createWaterMesh` takes it from a ground function): that is what makes the shallows pale and the shore white. Checked in Chrome by `tools/render-terrain-test.js`: splat colours, no cracks between levels of detail, a decal's alpha, every sample of the sky against the CPU model in six situations, and water's colour, froth, waves, reflections and that both backends draw the same picture.

### Pixel art, kerning and emptying a full atlas
- `createRenderer({ atlas, filter: 'nearest' })` (or `renderer.setFilter('nearest')`) draws scaled sprites, meshes and normal maps with hard pixels instead of smoothing them, on all three backends. Scalable (SDF) text needs the default `'linear'`; for pixel games use `BitmapFont` or ordinary `Font`s at whole sizes.
- `new Font(atlas, { kerning: true })` pulls pairs like "AV" and "To" together the way the font says (measured by the browser once per pair). It is off by default, which keeps plain text on the fast path.
- When a long-running game fills a text atlas (`font.atlasFull`), give text an atlas of its own and, between frames, call `atlas.clear()` then `font.reset()` on every font (and `richText.reset()`): the glyphs are drawn again as they are needed.
- Terrain for physics: `new TriWorld().addTriangles(terrain.map.toTriangles())`.

### Scalable text (SDF)
```js
const title = new Font(atlas, { family: 'system-ui', weight: 'bold', size: 18, sdf: true });   // stored once at 48 px
title.draw(batch, 'Round 3', x, y, { size: 24, tint });      // any size from about 8 to several hundred world units
title.draw(batch, 'VICTORY', x, y, { size: 200, align: 'center' });   // same glyphs, still sharp
```
Glyphs are stored as **signed distance fields** (the distance to the outline, in the alpha channel; computed once per glyph with an exact Euclidean distance transform, `computeSdf`), and the shader (WGSL and GLSL) draws the edge by thresholding with a width taken from the screen-space derivative, so the edge is one anti-aliased pixel wide whatever the scale. Measured in headless Chrome at 10x the stored size: 0 soft edge pixels with WebGL2 and WebGPU, against 16 for the same raster text scaled up. SDF sprites ride in the same instance buffer (a flag in the meta word), so sorting, tinting, shadow and wrapping work unchanged. Trade-offs: a little softer than hinted raster text under about 14 px (use plain `Font` for small UI), no per-glyph outline or glow yet, and the Canvas2D fallback can only scale the stored 48 px shape (sharper than scaled raster text, softer than the GPU backends). In the arena the "you" label under the local player is SDF text in world space.

## How it stays fast and simple
- One instanced draw call per frame; per-sprite data is a single typed array, so there is no per-sprite object or GC churn.
- Backends differ only in upload and draw calls. Shaders are the same maths in WGSL and GLSL.
- Premultiplied alpha everywhere; tint multiplies sprite colour in all three backends (verified by pixel checks).
- `renderer.lost` / `onLost` signal device or context loss so the app can recreate the renderer.

## Tests
- `npm test` covers batch layout, camera maths, packing and atlas logic in Node.
- `node tools/render-selftest.js` (needs Chrome or Edge) renders a known scene with each backend in headless Chrome, reads pixels back and checks rotation, tint, alpha blending, y-down camera and camera movement, sort order, overlay passes and rendered text, plus the automatic fallback.

## Not done yet
Kerning for per-glyph (non-shaped) text from system fonts, justified and vertical text, an atlas that frees glyphs it no longer uses, nearest-neighbour sampling for pixel fonts (they blend slightly at edges when scaled), SDF outlines and glow, separate user textures (photos, tilemaps) beyond atlas pages, particles, rendering in a worker (OffscreenCanvas, WebGL2 only), and benchmark numbers on integrated and mobile GPUs (only one desktop NVIDIA machine is measured so far).

## Performance
`npm run bench:render` and `npm run bench:render3d` (details and raw data: `docs/BENCHMARKS.md`). On an RTX 5060 laptop in Chrome 154: 2D, 10,000 sprites cost under 0.35 ms on either API and 200,000 sprites 2.2 ms on WebGPU against 4.5 ms on WebGL2; 3D, 100,000 lit instanced cubes 2.0 ms on WebGPU against 3.7 ms on WebGL2. WebGPU is the faster backend from about 10,000 instances up; WebGL2 has the lower fixed cost on tiny scenes and less main-thread time. (A single large `writeBuffer` is several times slower than the same bytes in chunks in Chrome, so both WebGPU renderers upload in chunks.) Canvas2D is a last resort (seconds per frame at 10,000 distinctly tinted sprites).

## 3D (WebGPU, with a WebGL2 fallback)
```js
import { createRenderer3D, Camera3D, DrawList3D, createBox, createSphere, createPlane, createLighting } from '@engine/render';

const renderer = await createRenderer3D();                 // webgpu -> webgl2 (Canvas2D cannot draw 3D); { antialias: true } is the default
document.body.append(renderer.canvas);
renderer.resize(innerWidth, innerHeight, devicePixelRatio);

const camera = new Camera3D({ fovY: 1.1, near: 0.1, far: 500, viewW: innerWidth, viewH: innerHeight });
const list = new DrawList3D();
const box = createBox(1, 1, 1), ball = createSphere(0.5), floor = createPlane(100, 100);

camera.x = player.x; camera.y = player.y + 0.7; camera.z = player.z; camera.yaw = yaw; camera.pitch = pitch;
list.clear();
list.addTransform(floor, 0, 0, 0, null, 1, 1, 1, 0.4, 0.5, 0.4);              // mesh, position, rotation quaternion or null, scale, colour
list.addTransform(box, 2, 0.5, -3, null, 1, 1, 1, 0.9, 0.2, 0.2);
renderer.render({ camera, list, clear: [0.6, 0.7, 0.85, 1], lighting: { ...createLighting(), fogDensity: 0.01 } });
```
| Export | Purpose |
|---|---|
| `createRenderer3D({ prefer?, antialias? })` | Async; tries WebGPU then WebGL2 on fresh canvases; `renderer.kind` says which won. `render({ camera, list, clear, lighting })`, `resize`, `releaseMesh`, `destroy`; `lastError` holds the last GPU validation or shader error (they are also logged: a WebGPU error otherwise just gives an empty frame). |
| `Camera3D` | Position, yaw/pitch/roll (the `@engine/math` conventions: right-handed, +y up, looks down -z), field of view, near/far. `update()`, `screenToRay(x, y)` for picking and aiming, `worldToScreen(x, y, z)`, `forward()`. |
| `DrawList3D` | The frame's instances grouped by mesh (one instanced draw per mesh): `clear()`, `add(mesh, matrix, r, g, b, a)`, `addTransform(mesh, x, y, z, quat, sx, sy, sz, r, g, b, a)`. Reuse one every frame. **Frustum culling:** after `camera.update()`, `list.setCamera(camera)` and every `add` drops instances whose bounding sphere is outside the view (`list.culled` counts them; `camera.sphereVisible(x, y, z, r)` and `camera.planes` are there for your own tests, e.g. skipping an animation update for a character you will not draw). The test is conservative (never drops anything on screen, checked against the projection on thousands of random cameras and the picture is pixel-identical with and without it) and costs about the same CPU as it saves in `add`; the gain is in what is uploaded and drawn: in a 600 m wide field of 100,000 boxes, 76% are dropped. |
| `createBox`, `createSphere`, `createPlane`, `createCylinder`, `createCapsule` | Primitive meshes. `createMeshFromTriangles(array)` makes a flat-shaded mesh from raw triangles (e.g. a `TriWorld`'s `verts`), `createMesh`, `computeNormals`. |
| `parseGltf`, `loadGltf`, `addGltfToDrawList` | glTF 2.0 and GLB models: triangle meshes, normals (computed if absent), texture coordinates and base colour textures, base colour factors, node transforms, and skeletal animation (skins with joint weights become `Skeleton`s and skinned meshes; the file's animations become `AnimationClip`s per skin in `model.skins[i].clips`). Materials are read in full (see `loadGltfMaterials` below). A second set of texture coordinates, texture transforms, double-sided surfaces, sorting of blended surfaces, and animation of plain nodes are reported in `warnings` and ignored; cubic-spline animation is played as linear; Draco compression throws (meshopt and quantised meshes are read, and so are sparse accessors). Morph targets are read (see below). |
| `Skeleton`, `Pose`, `AnimationClip`, `Animator`, `samplePose`, `blendPoses` | Skeletal animation (client-side presentation, not simulation). A `Skeleton` is a joint hierarchy (up to 255 joints) with rest transforms and inverse bind matrices; `skeleton.computePalette(pose)` gives the skinning matrices. A clip has translation / rotation / scale tracks per joint (linear or step); `samplePose` evaluates one, `blendPoses` mixes two (rotations take the short way round), and `Animator` plays a clip and cross-fades when you switch. |
| `TextureSet`, `proceduralTexture`, `renderer.setTextures(set)`, `list.setMaterial(layer, mapping, scale)` | **Textures.** A `TextureSet` is up to 256 square RGBA images of one size (a power of two from 16 to 2048; 256 by default), mipmaps included, living in one GPU texture array (WebGPU and WebGL2 alike; it is plain data, so it works in Node too). `set.add(image)` takes anything with `width`, `height` and RGBA `data` (an `ImageData` fits; other sizes are resampled) and returns the layer number. `list.setMaterial(layer, 'uv' \| 'planar', scale)` then textures every instance you add until the next call (or `clear()`): `'uv'` uses the mesh's texture coordinates times `scale`; `'planar'` needs none: the texture is projected along whichever world axis a surface faces most, `scale` repeats per metre, which suits ground, walls and boxes (and skinned meshes). The instance colour multiplies the texture. Textures repeat, are trilinear filtered (anisotropic where available), and use explicit gradients so box edges do not pick the wrong mip level. Texture coordinates start at the top left of the image, as in glTF. `proceduralTexture(kind, size, options)` makes tileable images in code, no files needed: `grass`, `brick`, `concrete`, `plates`, `checker`, `solid`. Meshes from `createBox`, `createPlane`, `createSphere`, `createCylinder`, `createCapsule` have `uv`; `createMesh(vertices, indices, name, uv)` and `createSkinnedMesh(..., name, uv)` take your own; a mesh without any reads (0, 0). Layers never added read black. Not done: sRGB-correct filtering and lighting (colours and textures are used as stored, like vertex colours), normal/roughness/emissive maps, texture compression, atlases of mixed sizes, cube maps. |
| `loadGltfTextures(model, set)` | Decodes the images a glTF uses (all five kinds of picture its materials refer to, and the base colour pictures of simply lit instances; browser decoder by default, or pass your own `decode(bytes, mimeType)`) into a set and returns image index to layer; hand that map to `addGltfToDrawList(list, model, transform, palettes, layers, materialIds)`. `loadGltf` also fetches external image files. |
| `MaterialSet`, `renderer.setMaterials(set)`, `list.setSurface(id)`, `loadGltfMaterials(model, layers, set)` | **Physically based materials** (up to 127). A material has a base colour (and picture), `metallic` and `roughness` (and a picture whose green is roughness and blue metalness), a **normal map**, an **occlusion** picture, an **emissive** colour (and picture), an alpha cut-off for leaves and fences, and `uvScale`; the pictures are layers of the `TextureSet` given to `setTextures`. `list.setSurface(id)` makes the instances you add next use one (0 goes back to the simple lighting, and both kinds can share a scene); the instance colour still tints it. `set.set(id, { roughness: 0.1 })` changes one live. Shading is Cook-Torrance (GGX distribution, Smith height-correlated visibility, Schlick fresnel) with Lambert diffuse, lit by the sun (with its shadows) and the point lights, plus the sky and ground ambient light seen directly and reflected in the surface (Karis' approximation of how much it reflects), so a metal is not black; bump comes from a tangent frame worked out in the shader from how the texture coordinates change across the screen, so meshes need no tangents. Pictures are read as sRGB (base colour, emissive) or as data (the rest), the lighting is done in linear light, and the result is converted back, so a surface with a material sits correctly beside one with the simple lighting. `pbrLight` and `pbrAmbient` are the same maths on the CPU. `loadGltfMaterials` turns a glTF's materials into set entries (once each, with the file's alpha mode and `KHR_materials_emissive_strength`), and `addGltfToDrawList(..., layers, materialIds)` draws with them; without that last argument a model is drawn as before. |
| `skyEnvironment`, `environmentFromImage`, `loadEnvironment`, `parseHdr`, `uniformEnvironment`, `renderer.setEnvironment(env)`, `lighting.environment` | **Environment lighting and a sky.** An `Environment` is the light that comes from all around, as a small cube of colours (plain data, made in Node or the browser, no GPU in it). `skyEnvironment({ zenith, horizon, ground, sun: { direction, intensity } })` makes one from a few colours and a sun; `loadEnvironment(url)` or `environmentFromImage(picture)` makes one from a panorama (a Radiance `.hdr` file keeps a bright sun bright; PNG and JPEG are read as sRGB; the -z direction is the middle of the picture). Making one costs a few tens of milliseconds, once: it becomes **spherical harmonics** (nine colours that give the soft diffuse light facing any direction) and a **prefiltered chain** of blurrier cubes, one for each step of roughness, found with GGX importance sampling taken from a pyramid of the cube so a very bright sun spreads smoothly and never speckles; it is deterministic. Give it to the renderer with `renderer.setEnvironment(env)` and surfaces **with a physically based material** are lit by it and reflect it (a polished metal shows the sky, a rough stone is lit softly from where the light really is); it is also drawn **as the sky** behind everything. Each frame's `lighting.environment = { intensity, rotation, sky, skyBlur }` turns it about the vertical axis, dims it, hides the sky (`sky: false`, keeping the lighting), or blurs the sky (0 to 1); `lighting.environment = false` turns it all off, and `setEnvironment(null)` takes it away. Surfaces without a material keep the plain ambient colours (`ambientFromEnvironment(env)` gives colours for `ambientSky` and `ambientGround` that roughly match, so the two sit comfortably together). `environmentIrradiance`, `sampleEnvironment` and `pbrAmbientEnvironment` are the same maths on the CPU. Fog does not touch the sky. |
| `lighting.pointLights` | **Point lights**: `{ x, y, z, radius, color: [r, g, b], intensity }` (lamps, muzzle flashes, fires). Light reaches `radius` metres and fades smoothly to nothing there (`(1 - (d / radius)^2)^2`); surfaces facing a light get diffuse and specular light from it, and the sun, hemisphere ambient and fog work as before. Lights are added on top of the sun, are not blocked by anything and cast no shadows. The renderers use the first 32 (`MAX_POINT_LIGHTS`); `nearestLights(lights, x, y, z)` picks the 32 that matter most to a viewpoint. Every pixel loops over the active lights (forward shading), so cost grows with lights times covered pixels: a few dozen are cheap. Checked per backend against the same formula on the CPU (falloff, overlap, tint, the radius cut-off, the cap) and the two backends' images are identical. |
| `render({ ..., shadows })` | **Sun shadows** (`shadows: true` or `{ size, radius, bias, strength }`; off by default). One orthographic depth map from the directional light, fitted to a box of `radius` metres (default 45) ahead of the camera, 2048 x 2048 by default (so about 4 cm texels), snapped to whole texels so shadows do not shimmer as you move. Plain and skinned meshes both cast; instances with alpha below 0.5 cast nothing. The main pass does a 3x3 percentage-closer lookup with a normal offset and a slope-scaled bias (no acne on open ground, no self-shadowing of lit faces, both checked by the self-test), fades to lit at the edge of the box, and `strength` (default 0.75) is how much of the sun a shadow removes: ambient light is never shadowed. With a camera on the draw list, pass `list.setCamera(camera, { light: lighting.direction })` so that things behind you that throw their shadow into view are still kept. |
| `createSkinnedMesh(vertices, indices, joints, weights, jointCount)`, `DrawList3D.addSkinned(mesh, matrix, palette, r, g, b, a)` | A mesh whose vertices follow up to four joints each, deformed on the GPU (WebGPU: palettes in a storage buffer; WebGL2: in a float texture). Every skinned instance carries its own palette, so hundreds of differently posed characters are still one draw call per mesh. Skinned instances are drawn after the plain ones. |
| `createLighting()` | The lighting settings: one directional light (with specular), a sky/ground hemisphere of ambient light, exponential-squared fog. |

Rendering model: depth-tested, back faces culled, counter-clockwise triangles face out, alpha blending (no sorting: draw transparent things last or accept ordering artefacts), 4x MSAA by default, lighting computed per pixel. Normals use the model matrix's rotation, so scale uniformly where shading matters. Meshes are uploaded on first draw and cached. The matrices come from `@engine/math` (deterministic, column-major, depth 0..1; the WebGL2 shader remaps it).

**The two backends produce identical images**: the self-test renders a lit scene (ground, cubes, spheres, a cylinder and a capsule, a distant copy of an object for perspective) on both and the mean pixel difference is 0.00 of 255. `node tools/render3d-selftest.js` also checks, per backend, that a bent skinned tube drawn by the GPU matches the same tube skinned on the CPU and drawn as a plain mesh, that hundreds of differently posed instances draw together, and: the shading against the same formula written out on the CPU (flat and smooth normals, specular, fog), depth ordering across draws, back-face culling, alpha blending, thousands of instances, resizing (a new depth buffer), and a transparent 2D canvas (`createRenderer({ transparent: true })`) stacked over the 3D view as a HUD.

Try it: `npm run walk3d` (a first-person walk around a test level with ramps, stairs and a jump, using physics, math and the 3D renderer together) and open the printed address.

Not done in 3D (yet): materials beyond a colour and a colour texture, soft (blurred) shadows, many-light scenes (clustered or deferred shading), animation blending trees (blend poses yourself, as the arena's `locomotion.js` does), more than four joints per vertex, transparency sorting, text in the 3D world (the SDF fonts can be drawn in a HUD pass).

### Post-processing (bloom, tone mapping, colour grading)

Pass `post` to `render` and the scene is drawn into a floating-point (HDR) target instead of straight to the canvas, then finished on a second stage: bloom, exposure, tone mapping, grading, vignette. Without `post` none of this runs and the scene goes to the canvas exactly as before. Both backends give the same picture.

```js
renderer.render({ camera, list, lighting, post: {
  bloom: { threshold: 0.85, knee: 0.5, intensity: 0.5, levels: 5 },   // or false
  exposure: 1, tonemap: 'aces',          // 'none' | 'reinhard' | 'aces' | 'filmic'
  contrast: 1, saturation: 1, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],   // grading
  vignette: { strength: 0.4, radius: 0.55 }, dither: 1,
} });
```

- **Why HDR:** lights, flashes and additive particles can be brighter than 1 and keep that brightness until the tone map squeezes them into what a screen can show (without `post` they clip to white). Bloom picks out what is brighter than `threshold` (softly, `knee`), blurs it through `levels` halvings of the image (a 13-tap downsample and a tent upsample, so there is no visible blockiness and the cost is a few small passes) and adds it back.
- **Grading order:** exposure, tone map, then lift / gamma / gain per colour channel, saturation, contrast around mid grey, vignette, and a hair of dither noise so smooth skies do not band.
- **Costs:** one extra half-float render target (with the same multisampling as before), `levels` small textures, and a full-screen pass or two. `post: true` uses the defaults (ACES, 5-level bloom).
- Particles are drawn into the HDR target too, so additive sparks and flashes bloom.

### Ambient occlusion, depth of field and FXAA

Three more effects in the same `post` object. Each is **off unless you give it**, costs nothing when off, and gives the same picture on WebGPU and WebGL2.

```js
renderer.render({ camera, list, lighting, post: {
  ao: { radius: 0.5, intensity: 1, power: 1.5, bias: 0.03, samples: 12, scale: 1 },   // or true
  dof: { focus: 10, range: 0, aperture: 1, maxBlur: 8, taps: 24 },                    // or true
  fxaa: true,
} });
```

- **Ambient occlusion (`ao`)** darkens creases, the feet of things and the undersides of overhangs. It works from the depth buffer alone (no normals are stored: they are rebuilt from the depth around each pixel), looks for things in the way within `radius` world units, and blurs the result without smearing across edges. `scale: 0.5` works at half the resolution for a quarter of the cost. It multiplies the lit picture, not only the ambient light, so keep `intensity` modest on bright scenes. Make `radius` about the size of the things you want to touch each other: 0.3 to 1 for a room, several metres for a landscape.
- **Depth of field (`dof`)** blurs what is away from `focus` (distance from the camera, in world units). `range` is a band either side that stays sharp, `aperture` how fast the blur grows, `maxBlur` the biggest blur radius in pixels. Blur follows the thin-lens shape: the same distance in front of the focus blurs more than behind it. Things in front blur over what is behind, and a sharp thing in front does not bleed into the blurred background. `circleOfConfusion(distance, dof)` gives the same number the shader uses, for an autofocus that eases `focus` towards whatever is under the cursor.
- **FXAA (`fxaa: true`)** smooths the staircase edges of the finished picture in one cheap pass. Use it instead of multisampling (`createRenderer3D({ antialias: false })` saves memory and works everywhere), or on top of it for the edges multisampling cannot see (inside textures, on hard tone-mapped highlights). It softens very fine detail a little.
- **Costs:** a depth effect keeps the scene's depth (resolved from the multisampled one if there is multisampling) and draws one to four full-screen passes. FXAA adds a render target of the canvas's size and one pass. Order: occlusion and depth of field, then bloom, tone mapping and grading, then FXAA.
- **Not done:** temporal anti-aliasing (it needs per-object motion vectors), screen-space reflections, an orthographic camera (the depth effects are skipped for it, FXAA still runs), occlusion from things off screen (it only sees what is in the depth buffer, so a thing just out of view casts none), and a foreground blur that spreads out over the sharp background (a blurred near thing keeps a hard outline against a sharp far one).

### Spot lights, area lights and shadows from lamps

`lighting.pointLights` takes three kinds of light, all in the same list (the first 32 are used) and all lighting simple and physically based surfaces alike:

```js
lighting.pointLights = [
  { x: 0, y: 3, z: 0, radius: 12, color: [1, 0.9, 0.7], intensity: 2 },                                   // point: lights all round
  { x: 4, y: 5, z: 0, radius: 20, direction: [0, -1, 0], angle: 0.6, penumbra: 0.4, castShadow: true },   // spot: a cone
  { type: 'area', x: 0, y: 3, z: -6, radius: 15, direction: [0, 0, 1], width: 4, height: 1.5, intensity: 3 }, // area: a panel
];
renderer.render({ camera, list, lighting, localShadows: { size: 1024, layers: 12 } });
```

- **Spot lights** (a `direction`, or `type: 'spot'`): `angle` is the half-angle of the cone in radians (0.7), `penumbra` the fraction of it, from the edge inwards, over which the light fades (0.3).
- **Area lights** (`type: 'area'`): a `width` by `height` panel (1 by 1) facing along `direction`, lighting what is in front of it and nothing behind (a window, a screen, a strip light; make `height` small for a tube). `right` says which way the width runs (default: level). `intensity` is how bright the panel itself is, so a bigger panel lights more (2 to 5 is a bright window). The light is shaded as if it came from the nearest point of the panel (the highlight from the point nearest the mirror direction), scaled by how much of the sky the panel fills: soft, believable and cheap, but not the exact integral over the panel's shape (no corner highlights shaped like the panel).
- **Shadows** (`castShadow: true`, point and spot lights only): a spot light renders one depth map, a point light six (a cube). They live in their own array of `localShadows.layers` maps (up to 12; `size` texels each, 1024), separate from the sun's cascades, so they work with or without `shadows`, and cost one depth pass per layer. If more lights ask than the budget holds, the ones nearest the camera get maps (a spot light is 1 layer, a point light 6; one that does not fit is skipped). `localShadows.bias` (0.03 m) and `strength` (0.9) tune the look; `localShadows: false` turns them all off. The map is compared with a 3x3 filter, with the surface nudged toward the light and off itself by about a texel, so there is little acne and little peter-panning.
- **Tell the draw list**: `list.setCamera(camera, { lights: lighting.pointLights })`, so that things out of view but within reach of a shadow-casting light are still drawn into its maps (a wall behind you still throws its shadow in front of you). Without it those casters are culled and their shadows go missing. Occlusion culling is switched off while such lights are present, as it is for the sun's shadows.
- **Costs:** every light is still a few dozen shader instructions per pixel (a spot light outside its cone, or any light out of reach, costs a distance test); a shadow layer is one more pass over the draw list, as a sun cascade is. 12 layers at 1024 x 1024 are 48 MB, allocated the first time a light casts a shadow.
- **Not done:** soft (penumbra) shadows that widen with distance from the caster (the filter is a fixed 3 x 3), shadows from area lights, light cookies and IES profiles, tube and sphere shapes of their own (a thin panel stands in for a tube), and a way to bake lights into the scene.

### Inverse kinematics and retargeting

After the `Animator` has made a pose, these change its local rotations so a hand, a foot or a head goes where the game says. They run on clients, in the skeleton's model space (the space of `skeleton.jointWorld(i)`; move a world point into it with the inverse of the matrix you draw the character with).

```js
animator.update(dt);
solveTwoBone(skeleton, animator.pose, { root: hip, mid: knee, end: ankle, target: footSpot, pole: kneeForward, weight: grounded ? 1 : 0 });
aimJoint(skeleton, animator.pose, head, lookAtPoint, { axis: [0, 0, 1], limit: 1.0, weight: 0.8 });
solveChain(skeleton, animator.pose, [tail0, tail1, tail2, tail3], tailTarget);
skeleton.computePalette(animator.pose, palette);
```

- **`solveTwoBone`** is the exact solution for an arm or a leg: the middle joint bends in the plane that holds the `pole` point (a knee points forward, so put the pole in front of it), the limb stretches straight toward a target out of reach and never folds past straight. `endRotation` sets the world rotation of the end joint (a foot flat on a slope). Fade it with `weight`.
- **`solveChain`** moves any chain of joints (a tail, a spine, a tentacle) onto a target (FABRIK): bone lengths are kept, the root of the chain stays put.
- **`aimJoint`** turns a joint's `axis` toward a point, no further than `limit` radians from where the pose has it.
- **Retargeting:** `retargetClip(clip, sourceSkeleton, destinationSkeleton)` makes a copy of a clip for another rig; `retargetPose` does one pose (use it every frame to drive one rig from another's animator). Each joint gets the change from rest the source joint has *in the world*, applied to its own rest orientation, so an A-pose rig can play a T-pose rig's animation. The hips also copy the source's movement scaled by the hip heights, so a short character does not slide. Joints are paired by what their names mean (`autoMapJoints`, from `humanoidKey`: it knows Mixamo, Unity, Blender, 3ds Max Biped and VRM naming for the spine, head, arms, legs, feet and fingers); pass `overrides: { 'Source name': 'Destination name' }` for the odd ones.
- **Ragdolls:** `poseToRagdoll(skeleton, pose, ragdoll, { velocity })` starts a physics ragdoll (`@engine/physics`) from the pose being animated, `poseFromRagdoll(skeleton, pose, ragdoll)` writes the bodies back onto a pose to draw, and `ragdollSpecFromSkeleton(skeleton, humanoidRagdollSpec())` fits the bones to the skeleton's own joints.
- **Not done:** joint limits and twist for IK chains (a hinge knee that cannot bend backwards: constrain it yourself by choosing the pole), IK against the physics world (find the ground with a ray cast, then hand the point to `solveTwoBone`), retargeting between skeletons that do not share the humanoid layout (quadrupeds: give an explicit map), and facial or finger-curl retargeting beyond the mapped joints.

### Cascaded shadows

`shadows: { size: 2048, radius: 60, cascades: 3 }` splits the shadowed area into nested boxes, each with its own `size` x `size` map: the nearest is `radius * ratio^2` wide (ratio 0.35: about 7 m of half-width, texels of 3 mm), then 21 m, then `radius`. Shadows near the camera get an order of magnitude more detail for the same pixel cost, and distant ones stay soft. A pixel uses the nearest cascade that contains it and blends into the next one near the border, so there is no visible seam; the farthest fades to lit at its edge. `cascades: 1` (the default) is exactly the single map used before. Up to 4. Each cascade costs one more depth pass of the shadow casters.

### Physically based materials: an example
```js
import { TextureSet, MaterialSet, loadGltf, loadGltfTextures, loadGltfMaterials, addGltfToDrawList } from '@engine/render';

const textures = new TextureSet({ size: 512, maxLayers: 32 });       // a model with five pictures per material needs room
const materials = new MaterialSet();
renderer.setTextures(textures);
renderer.setMaterials(materials);

const model = await loadGltf('assets/helmet.glb');                    // warnings: model.warnings
const layers = await loadGltfTextures(model, textures);               // every picture, decoded once
const ids = loadGltfMaterials(model, layers, materials);              // metal, roughness, bump, occlusion, glow

// every frame
list.clear();
addGltfToDrawList(list, model, placement, {}, layers, ids);

// or by hand, for your own meshes
const gold = materials.add({ baseColor: [1, 0.77, 0.34, 1], metallic: 1, roughness: 0.25 });
list.setSurface(gold);
list.addTransform(ball, 0, 1, 0);
list.setSurface(0);                                                    // back to the simple lighting
```
`tools/render-pbr-test.js` checks 40-odd pixels on both backends against the shading model written out on the CPU (agreement within 1/255), including all five kinds of picture, cut-outs, point lights with fog, a skinned mesh and a real glTF file with embedded PNGs.

### Environment lighting: an example
```js
import { skyEnvironment, loadEnvironment } from '@engine/render';

const env = await loadEnvironment('assets/field.hdr', { size: 128 });       // or: skyEnvironment({ sun: { direction: [0.5, 0.6, 0.3] } })
renderer.setEnvironment(env);

// every frame: nothing more to do for the lighting and the sky; to turn it with the player's camera, or dim it at dusk:
renderer.render({ camera, list, lighting: { ...createLighting(), environment: { rotation: yaw, intensity: 0.8 } } });
```
`tools/render-env-test.js` checks, on both backends, about forty pixels against the shading model written out on the CPU: a white environment, a sky with a sun reflected in five spheres from mirror to chalk, the sky behind them pixel by pixel, the six faces of the cube looking along each axis, rotation, intensity, blur, `sky: false`, `environment: false`, and that surfaces without a material look the same with and without an environment. The two backends draw the same image.

### Smaller downloads: compressed models and textures
```js
import { loadGltf, parseKtx2, TextureSet } from '@engine/render';

const model = await loadGltf('assets/hero.glb');      // meshopt-compressed (gltfpack) and quantised files load like any other

const set = new TextureSet({ size: 512, format: 'bc7' });   // 'rgba8' (default), 'bc1', 'bc3', 'bc7', 'etc2', 'astc4x4'
set.addKtx2(await parseKtx2(await (await fetch('assets/wall.ktx2')).arrayBuffer()), 'wall');
renderer.setTextures(set);                            // stays compressed on the card: 1/4 to 1/8 of the memory
```
Models: `EXT_meshopt_compression` and `KHR_mesh_quantization` are read (a JavaScript port of the reference decoder, checked byte for byte against the real encoder). Textures: `parseKtx2` reads RGBA8 and card-compressed pictures (BC1, BC3, BC7, ETC2 RGBA8, ASTC 4x4) with zlib supercompression undone; a compressed `TextureSet` needs exactly-sized pictures with every mip level, and the renderer throws "this graphics card cannot read bc7 textures" if the card lacks the format (desktop cards read BC, phones ETC2 and ASTC, so ship the format that fits the player, or fall back to a plain set). **Not read:** Draco, Basis Universal (ETC1S/UASTC) and Zstandard supercompression; they need WebAssembly decoders, which this engine does not carry. Compress with `gltfpack -cc` for models and `toktx --encode bc7 --t2 --zcmp 5` for textures.


### Tile maps
```js
import { TileMap, TileSet, drawTileMap, tileMapFromTiled } from '@engine/render';

// by hand: a sheet is one atlas sprite holding a grid of tiles
const map = new TileMap({ tileW: 16 });
map.addTileset(TileSet.fromSheet(atlas.get('town'), { tileW: 16, tileH: 16 }).animate(7, [{ id: 7, ms: 200 }, { id: 8, ms: 200 }]));
const ground = map.addLayer({ name: 'ground' });
ground.fill(0, 0, 1000, 1000, 1);                      // a million tiles is fine
ground.set(10, 4, 3 | FLIP_H);                         // tile 3, mirrored

// or from Tiled (File > Export As > JSON): embedded tilesets, CSV or base64 data
const { map: level, warnings } = tileMapFromTiled(await (await fetch('level.json')).json(), { sheet: (tileset) => atlas.get(tileset.name) });

// every frame, before renderer.render: only the chunks in view are copied into the batch
batch.clear();
drawTileMap(batch, map, camera, { time: game.time, key: 0 });   // layer n sorts at key + n, among your own sprites
```
Drawing copies cached chunks, so cost follows what is on screen, not the size of the map; `layer.set` rebuilds only the chunk it touches. Layers take `offsetX/Y`, `parallaxX/Y` (0.5 moves at half the camera's speed), `opacity`, `tint` and `visible`. Tiled maps: orthogonal only, tile data as CSV/array or uncompressed base64 (set "Tile Layer Format" in Tiled; compressed data is refused with a message), tilesets embedded in the map. A negative sprite width now draws mirrored on every 2D renderer, which is how flipped tiles are drawn.

### Morph targets, animation events and root motion
```js
import { parseGltf, createGltfMorph, MorphTargets, addGltfToDrawList, Animator } from '@engine/render';

// blend shapes from a glTF: each character makes its own, so each can have its own face
const model = await loadGltf('face.glb');
const face = createGltfMorph(model.instances[0]);          // face.names: ['smile', 'blink', ...]
face.set('smile', 0.8).set('blink', 1);
face.update();                                             // rebuilds the vertices only if a weight changed
addGltfToDrawList(list, model, transform, palettes, layers, materialIds, new Map([[model.instances[0], face.mesh]]));

// the file's own animation of weights
const talk = model.morphClips.find((c) => c.node === model.instances[0].node).clip;
face.setWeights(talk.sample(time)); face.update();

// or by hand from any mesh: targets are offsets for every vertex
const m = new MorphTargets(mesh, [{ name: 'fat', position: offsets, normal: normalOffsets }]);
face.approach([0, 1], 4, dt);                              // ease the weights toward a goal at 4 per second

// events: tell the game when a clip passes a moment
clip.addEvent(0.25, 'footstep', { foot: 'left' });
const animator = new Animator(skeleton, { rootMotion: { joint: 'root', axes: 'xz' } });
animator.onEvent = (name, data, clip) => { if (name === 'footstep') playStep(data.foot); };
animator.play(clip);
animator.update(dt);                                       // events fire here, once each, every lap of a loop
character.x += animator.motion[0]; character.z += animator.motion[2];   // root motion: how far the root moved this update
```
- **Morph targets:** `MorphTargets(mesh, targets)` keeps a copy of the vertices that is yours: `mixed = base + sum(weight * offset)`, normals mixed and made unit length again, bounds widened so culling does not drop a mesh whose shape grows. Both renderers upload the new vertices when `mesh.version` goes up (plain and skinned meshes, the shape changes first and the skeleton then moves it). The glTF loader reads targets (positions and normals), their names, the starting weights (node weights win over the mesh's), **sparse accessors**, and animations of `weights` into `model.morphClips` (`MorphClip.sample(time)`). Cost is on the CPU: vertices x active targets per update, only when a weight changed; fine for characters, not for a hundred faces at once.
- **Events:** `clip.addEvent(time, name, data)` (or `new AnimationClip(name, tracks, { events })`); the animator calls `onEvent(name, data, clip)` when playback passes each one, in order, including every lap of a loop (an event at time 0 fires when a lap starts, so the first update and each wrap), however big the step. glTF has no standard event track, so add them in code after loading (`model.skins[0].clips`). Forward playback only; the clip you are fading away from fires nothing.
- **Root motion:** with `rootMotion`, the animator takes the root joint's movement on the chosen axes out of the pose (so the feet do not slide) and reports it as `animator.motion` (x, y, z, in the skeleton's space: turn it by the character's facing). Laps of a loop, and steps longer than a lap, add up exactly. Translation only (no turning), and from the current clip.


### Video as a texture
```js
import { TextureSet, VideoTexture, VideoSprite, Atlas } from '@engine/render';

const video = document.createElement('video');
video.src = 'intro.webm'; video.muted = true; video.loop = true; video.playsInline = true;   // muted videos may start without a tap
await video.play();

// 3D: a layer of the texture set shows the video; use it like any other texture
const set = new TextureSet({ size: 256 });
const tv = new VideoTexture(set, video, { name: 'tv', fit: 'cover' });
renderer.setTextures(set);
list.setMaterial(tv.layer, 'uv', 1);               // the screen of a television mesh

// 2D: a sprite whose picture is the video (give it an atlas of its own: the whole page is uploaded again for each frame)
const screens = new Atlas({ size: 512 });
const screen = new VideoSprite(screens, video, { name: 'screen', width: 320, height: 180, fit: 'contain' });
batch.push(x, y, 320, 180, 0, screen.sprite);

// each frame, before drawing:
tv.update(); screen.update();                      // do nothing while the video is paused or has no new picture
```
- **What counts as a video:** a `<video>` (also one playing a live camera or canvas stream), a canvas, an `ImageBitmap` or a `VideoFrame`. A video is asked whether it has a new picture (`requestVideoFrameCallback`; browsers without it are judged by the video's clock), so a paused video, or a 24 fps film on a 144 Hz screen, costs nothing between frames. Canvases and bitmaps are copied on every `update()`.
- **Fit:** the layer is square, so `cover` (default) fills it and crops the sides, `contain` shows all of the picture with bars in `background` (black), `stretch` squeezes. For a 16:9 screen use a mesh whose texture coordinates are 16:9 and `stretch`, or `contain`.
- **Cost:** each new frame is drawn into a canvas the size of the texture, read back, given mip levels and uploaded: a few tenths of a millisecond at 256 x 256, a few milliseconds at 1024 x 1024. Pick the smallest size that looks right on screen, and a `TextureSet` of its own if the others are large (all layers share one size). `destroy()` stops watching the video (it keeps playing).
- **Underneath:** `TextureSet.update(layer, image)` replaces any layer's pixels (rebuilding its mips in place, allocating nothing; each layer has its own `version` that both renderers check), so painted-on screens and damaged decals work the same way; `Atlas.redraw(name, draw)` clears and repaints a sprite's rectangle.
- **Not done:** playback control and sound (the element is yours: starting it, seeking, volume), decoding files without an element (WebCodecs), a partial upload for 2D (the whole atlas page goes up each frame), and video in a compressed texture set.

### Running on a slow graphics card: quality levels, render scale and dynamic resolution
A game that must run on integrated graphics needs the same few rules, so they are here.
```js
import { createRenderer3D, qualityOf, reducePost, createDynamicResolution, gpuClass, gpuName } from '@engine/render';

const q = qualityOf('low');                                // { shadowSize: 1024, pixelRatioCap: 1, antialias: false, lights: 6, particles: 0.7, post: 'plain' }
const renderer = await createRenderer3D({ antialias: q.antialias });       // multisampling can only be chosen here
const drs = createDynamicResolution();                     // aims for 60 frames a second
// every half second, with the frame rate over that time and the slowest frame in it:
if (drs.update(fps, worstFrameMs, performance.now() / 1000)) renderer.setRenderScale(drs.scale);
renderer.render({ camera, list, shadows: { size: q.shadowSize }, post: reducePost(fullPost, 'low') });
```
- `QUALITY_LEVELS` / `qualityOf(level)`: what `low`, `medium` and `high` cost (shadow map, most pixels per screen pixel, multisampling, lights, share of particles, which finishing pass); anything else is `low`.
- `reducePost(post, level)`: `high` keeps the pass; `medium` drops shading in the creases, reflections, depth of field and haze (keeps glow and colour); `low` keeps only the colour work and FXAA.
- `renderer.setRenderScale(0.25 to 1)`: draw with that share of the pixels the screen has and let the browser stretch it (it applies to the size given to `resize`; the 2D and HUD layers on top stay sharp).
- `createDynamicResolution({ target, min, step, grace })`: the share of the screen's size that keeps the frame rate. The picture shrinks by about the square root of how far the frame rate is below the target, grows back slowly, tries again less and less often after a try that failed, and ignores loading, a hidden page and a single long stall (`pause(seconds)` says the page was hidden).
- `gpuClass(name)` (`strong`, `weak` or `unknown`) and `gpuName(renderer)` guess how strong the card is, to choose a first level or to say that better pictures are possible.
- `renderer.resize` does nothing when the size has not changed: setting a canvas's size, even to what it is, empties it and every picture buffer is made again (a lobby that asked every few seconds stuttered).

### Drawing less
Three ways to make a big scene cheaper without changing how it looks (or, for levels of detail, changing it only where nobody can tell).

```js
import { createLod, simplifyMesh, OcclusionBuffer, StaticBatcher } from '@engine/render';

// 1. Levels of detail: coarser copies for when the thing is small on screen
const tree = createLod({ mesh: highTree, ratios: [0.35, 0.1], screens: [0.25, 0.08], cullBelow: 0.01 });
// the full mesh while taller than 25% of the view, 35% of its triangles down to 8%, 10% below that, nothing under 1%
list.addLod(tree, model);                         // picks the level from the camera set with list.setCamera(camera)
list.lodBias = 1.5;                               // optional: prefer coarser levels sooner on a slow machine

// 2. Occlusion culling: do not draw what a wall hides
const occ = new OcclusionBuffer();                // 128 x 72 depth image on the CPU
occ.begin(camera).addBox(-10, 0, -22, 10, 12, -20).addMesh(hillMesh, hillModel);   // every frame: the big solid things
list.setCamera(camera); list.setOcclusion(occ);   // add() now drops instances behind them; list.occluded counts them

// 3. Merging: static scenery as a handful of draws instead of hundreds
const batcher = new StaticBatcher({ cellSize: 40 });
for (const piece of level) batcher.add(piece.mesh, piece.model, { color: piece.color, layer: piece.texture });
const batches = batcher.build();                  // once, at load
for (const batch of batches) list.addBatch(batch);   // each frame; far batches are skipped by the frustum test like any instance
```
- **Simplifying:** `simplifyMesh(mesh, { ratio })` cuts the mesh into a grid and merges the vertices in each cell (position, normal, uv and skin weights averaged), dropping triangles that collapse. It is quick, never fails on messy input, and suits distant levels; it rounds off small features and sharp corners as the cells grow (`keepEdges: true` keeps vertices with different normals apart for hard-edged props), and texture seams smear at coarse levels. Look at your coarsest level at the distance where it takes over. It is not an edge-collapse simplifier: do the hero models by hand.
- **Choosing a level:** by the thing's size on screen (its bounding sphere's height as a fraction of the view's), so a big building holds its detail further out than a rock, and a narrow field of view (zoomed in) uses finer levels. Levels switch with no cross-fade, so pick thresholds where the pop is invisible; skinned meshes work if every level shares the skeleton (`addSkinnedLod`).
- **Occlusion:** use closed, solid, simple occluders (a box per building, the terrain mesh, a cliff), not the detailed models. An instance is dropped only if every pixel of its bounding sphere's enlarged outline is covered by an occluder nearer than the sphere's nearest point (plus 2%); when in doubt it is drawn. Pixel-centre sampling means a gap narrower than one buffer pixel between two occluders can hide a sliver of something behind it; a bigger buffer shrinks that. Triangles with a corner behind the near plane are skipped (they hide less, never wrongly). Orthographic views drop nothing. With `setCamera(camera, { light })` (shadows on) nothing is dropped for being hidden, because the shadow map is drawn from the same list. Cost grows with the pixels the occluders cover and the number of tests, and stays well under a millisecond for a few dozen occluders and thousands of instances.
- **Merging:** pieces merge when they share colour, texture, mapping and surface, and are in the same grid cell (a bigger `cellSize` merges more and culls less), up to `maxVertices` per batch. A merged piece cannot move, change colour, or be skinned; keep those as ordinary instances. Mirrored pieces (negative scale) are re-wound and non-uniform scales get correct lighting, which instancing alone does not give. The cost is memory: the merged vertices are a copy of each piece's.
- **Not done:** cross-fading between levels, GPU occlusion queries, occluders that cross the near plane, per-vertex colours so that different colours can merge, and finding occluders automatically.
