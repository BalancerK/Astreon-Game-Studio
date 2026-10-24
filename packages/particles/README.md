# @engine/particles

Particle effects for the 3D renderer: muzzle flashes, sparks, smoke, dust, explosions, bullet holes, trails and glows. A small CPU simulation (a fixed pool in typed arrays, no allocation while running) driven by plain-data effect descriptions, drawn by `@engine/render` as soft camera-facing sprites, streaks stretched along their velocity, and flat decals, in one instanced draw call on WebGPU and WebGL2 (identical images). No textures: the shapes are computed in the shader. Zero dependencies; it writes into anything with a `push(...)`, so it does not import the renderer.

```js
import { ParticleSystem, effects } from '@engine/particles';
import { ParticleBatch } from '@engine/render';

const system = new ParticleSystem({ capacity: 3000, floorY: 0 });   // sparks bounce on y = 0
const batch = new ParticleBatch();

system.burst(effects.impact, x, y, z, { dir: surfaceNormal });      // sparks, dust and a flash
system.burst(effects.bulletHole, x, y, z, { dir: surfaceNormal });  // a decal lying on the surface

// every frame:
batch.clear();
system.update(dt);
system.writeTo(batch);
renderer.render({ camera, list, particles: batch });                 // drawn after the solid scene
```

## Effects are data

```js
const spark = {
  count: [6, 10],            // per burst; every number may be [min, max]
  life: [0.25, 0.55],        // seconds
  speed: [3, 8], spread: 1,  // along a random direction within `spread` radians of `dir` (Math.PI: every direction)
  size: 0.02, sizeEnd: 0.5,  // radius in metres, and a multiplier at the end of life
  color: [1, 0.7, 0.3, 1], colorEnd: [1, 0.3, 0.05, 0], hold: 0.4,   // fades over the last 60% of life
  additive: 1,               // 0 alpha blended .. 1 adds light (fire, sparks, glow)
  orient: 'stretch', stretch: 0.017,     // streaks along their velocity ('billboard' faces the camera, 'flat' lies on a surface)
  gravity: 1, drag: 0, bounce: 0.35, spin: [-2, 2], hardness: 0.5, fadeIn: 0, radius: 0,
};
system.burst(spark, x, y, z, { dir, scale: 2, amount: 0.5, tint: [1, 0.5, 0.5], velocity: [vx, vy, vz] });
```

An effect may be an array (the flash, fireball, sparks and smoke of one explosion). `effects` holds ready-made ones: `muzzleFlash`, `impact`, `bulletHole`, `hit`, `dust`, `landDust`, `smoke`, `explosion`, `tracerGlow`, `lampHalo`. Spread them and change what you like: `{ ...effects.impact, count: 30 }`.

- **Trails and glows:** `system.line(effect, x0, y0, z0, x1, y1, z1, spacing)` puts bursts along a segment; `system.emitter(effect, { rate, spacing, x, y, z, life })` is a continuous source (`rate` bursts per second and/or one burst per `spacing` metres moved; call `emitter.move(x, y, z)` as the source moves, `emitter.stop()` to end it).
- **Decals** (`orient: 'flat'`) take their normal from `dir`, do not move, and are lifted a centimetre off the surface so they do not flicker. They are particles, so they fade and are recycled with everything else (the arena keeps bullet holes for 20 s).
- **Limits:** when the pool is full new particles are dropped and counted in `system.dropped`, so a burst of effects can never stall a frame.
- **Reproducible:** randomness comes from a seedable generator (`seededRandom`), so a test can reproduce an effect exactly. This is presentation only: use ordinary maths and never feed particle state back into the simulation.

## In the renderer

`new ParticleBatch()` holds one frame's particles (16 floats each); `batch.push(x, y, z, size, r, g, b, a, vx, vy, vz, stretch, rot, additive, hardness, orient)` adds one directly, for effects you compute yourself (the arena draws a halo around each lamp this way). `render({ ..., particles: batch })` draws them after the solid scene, depth-tested but never written (so they blend with each other and sort by draw order, not by distance), unlit, with premultiplied blending, additive ones keeping their colour and adding no coverage.

## Tests

`npm test`: 14 simulation tests (cones, ranges, lifetimes and swap-removal, gravity, drag, floor bounce, capacity, fades, decals, emitters, every preset stays finite, seeding). `node tools/render3d-selftest.js` renders particles on both backends and measures the pixels: solid and soft discs, additive light, depth testing against walls, no depth writes, streak shape, flat decals on the ground, billboards round from the side; the two backends' images match exactly. `node tools/arena3d-test.js` fires in the real arena and checks particles, bullet holes and `?particles=0`.

Not done (yet): sorting back to front (alpha-blended smoke in front of other smoke can draw in the wrong order), soft depth fading where particles meet geometry, textured sprites and flipbooks, lit particles, GPU simulation (this one is CPU; thousands per frame are fine), collision with the level beyond a floor plane, sub-emitters and ribbons.
