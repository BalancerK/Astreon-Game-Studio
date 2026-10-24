# Benchmarks

**Headline (2026-10-11): after fixing one real performance bug (see "The large-upload cliff" below) WebGPU is the faster backend for both 2D sprites and 3D meshes once a scene has more than a few thousand things in it: 1.7x to 2.3x faster than WebGL2 at 10,000 to 200,000 instances, and equal below that.** WebGL2 only wins on tiny scenes (under 5,000 instances, where both take well under 0.5 ms) and on main-thread time per frame. This supports keeping WebGPU first in the fallback order.

Reproduce with the npm scripts; raw results are in `docs/benchmarks/`.

## The large-upload cliff (found and fixed 2026-10-11)
Both the 2D and the 3D WebGPU renderers upload their per-frame instance data with `queue.writeBuffer`. In Chrome 154 **one writeBuffer of more than about 8 MB is several times slower than the same bytes written in pieces**: 100,000 3D instances (8 MB) took 7 to 8.6 ms against 2.0 ms once written in 640 KB chunks; 200,000 2D sprites (8.8 MB) took 5.2 ms against 2.2 ms. This is what made WebGPU look 1.5x slower than WebGL2 at 200,000 sprites in the earlier sessions below, and the odd jump between 100,000 and 200,000. Both renderers now write in chunks (`WRITE_CHUNK`). An obvious-looking optimisation, removing an intermediate copy, gave no gain on its own, and my first attempt at it broke WebGL2 rendering (uploading a mesh rebinds `ARRAY_BUFFER` in the middle of filling the instance buffer): the 3D self-test caught it.

## Rendering: WebGPU vs WebGL2 vs Canvas2D (`npm run bench:render`)

**Setup:** Chrome 154 (headless, real GPU), NVIDIA GeForce RTX 5060 Laptop GPU (Blackwell, D3D11 under ANGLE for WebGL2; native WebGPU adapter, not a fallback), 16 logical CPUs, 1280x720 canvas, device pixel ratio 1, 144 Hz display. 3 fresh browser runs with the backend order alternated (`webgl2,webgpu,canvas2d`, `webgpu,webgl2,canvas2d`, `canvas2d,webgpu,webgl2`) so neither backend always benefits from running second. Every figure is the median across runs; spread across runs was small (shown in the raw output). Full output: `docs/benchmarks/render-chrome-rtx5060-laptop.txt` (session A). **The whole benchmark was repeated later (session B, `...-session2.txt`) because session A ran while a stray runaway process of mine was using one CPU core and several GB of memory; session B is on a clean machine.** Both are shown below as A / B. Differences between sessions show how much run-to-run noise there is: treat gaps smaller than that as ties.

**What is measured.** The scene is one `SpriteBatch` rendered with a single instanced draw call, exactly as the engine does it, with the whole instance buffer re-uploaded every frame (as a game with moving entities must).
- *GPU throughput*: frames submitted back to back with one wait at the end: the sustained cost per frame with the GPU as the limit.
- *CPU time inside `render()`*: what the main thread pays per frame.
- *Synchronised frame*: waiting for the GPU after every frame. Reported in the raw output but not used for conclusions: it includes each API's own wait latency (about 3 ms for WebGPU's `onSubmittedWorkDone`, about 0.2 ms for a WebGL `readPixels`), so it says nothing about speed at small counts.
- *Small* sprites are 12 to 24 px (vertex and upload bound), *large* sprites 200 to 320 px (fill-rate bound, heavy overdraw), all with random tints and alpha.

### GPU throughput, ms per frame (median)

| Sprites per frame | WebGL2 (A / B) | WebGPU (A / B) | Canvas2D |
|---|---|---|---|
| 1,000 small | 0.04 / 0.05 | 0.11 / 0.20 | 187 (11 to 188) |
| 10,000 small | 0.28 / 0.34 | 0.23 / 0.24 | 4,083 |
| 50,000 small | 1.22 / 1.03 | 0.53 / 0.76 | n/a |
| 100,000 small | 1.57 / 2.00 | 1.04 / **3.56** | n/a |
| 200,000 small | **3.42 / 4.38** | 5.23 / 5.69 | n/a |
| 500 large (overdraw) | 0.27 / 0.32 | 0.30 / 0.34 | 267 |
| 2,000 large (overdraw) | 1.11 / 1.29 | 1.14 / 1.26 | n/a |
| 8,000 large (overdraw) | 4.38 / 5.18 | 4.37 / 5.07 | n/a |
| 50,000 small, re-sorted every frame | 4.35 / 5.01 | 3.68 / 4.62 | n/a |

### CPU time inside `render()`, ms (median)

| Sprites per frame | WebGL2 | WebGPU |
|---|---|---|
| 10,000 small | 0.00 / 0.00 | 0.20 / 0.20 |
| 50,000 small | 0.10 / 0.10 | 0.70 / 0.80 |
| 100,000 small | 0.30 / 0.30 | 1.30 / 0.60 |
| 200,000 small | 0.50 / 0.60 | 0.90 / 1.00 |

### Session C: after chunking the WebGPU upload (same machine, 3 runs)

| Sprites per frame | WebGL2 | WebGPU |
|---|---|---|
| 10,000 small | 0.28 | 0.31 |
| 50,000 small | 0.98 | 0.86 |
| 100,000 small | 1.88 | **1.16** |
| 200,000 small | 4.45 | **2.22** |
| 8,000 large (overdraw) | 5.08 | 5.00 |

WebGPU is now ahead from 50,000 sprites up and 2x ahead at 200,000; everything else (overdraw-bound scenes, small counts) is a tie. Raw data: `render-chrome-rtx5060-laptop-session3-chunked.json`. The tables for sessions A and B above are kept as they were measured, before the fix.

### Other numbers
- **Player-visible frame rate** (`requestAnimationFrame` while rendering): **144 fps (the display's refresh) with a worst frame gap of 7.2 to 7.5 ms for both WebGL2 and WebGPU** at 10k small, 50k small and 2,000 large sprites (one 13.9 ms gap, a single missed frame, in session B's WebGL2 10k run). Neither backend is a limit.
- **Startup** (create the renderer and present the first frame): WebGL2 **38 / 42 ms**, WebGPU **133 / 127 ms**, Canvas2D 70 / 72 ms.
- **CPU side, any backend** (`SpriteBatch`): filling 50,000 sprites takes 2.8 ms and sorting them by key 2.5 ms (200,000: 11 and 16 ms).
- **Firefox 157** (quick, one run; WebGPU is unavailable there): WebGL2 0.55 ms for 10k small and 1.85 ms for 50k, 6.4 ms for 200k; timer resolution is 1 ms so small figures are coarse (`render-firefox-quick.json`).

### What it means
**Decision (2026-10-11): the default order stays WebGPU first, then WebGL2, then Canvas2D.** The 3D milestone needs WebGPU; with the upload fix (above) WebGPU is also the faster backend for large scenes in 2D and 3D. Revisit with mobile numbers.

1. **For this 2D sprite workload there is no performance reason to prefer either API.** Up to 10,000 sprites both cost well under 0.5 ms a frame, and both hold the display's 144 fps with large headroom (even 200,000 sprites take 3 to 5 ms). Realistic scenes (hundreds to a few thousand sprites) are nowhere near the limits.
2. **Between 50k and 100k sprites the ranking is not stable**: WebGPU was ahead at 50k in both sessions (0.5 to 0.8 ms against 1.0 to 1.2), but at 100k it was 1.0 ms in session A and 3.6 ms in session B (WebGL2: 1.6 and 2.0), so no claim is made there. What is consistent: **WebGL2 is faster at 200k sprites (3.4 to 4.4 ms against 5.2 to 5.7)**, WebGL2 costs less main-thread time (0.0 to 0.5 ms against 0.1 to 1.3), and WebGL2 **starts about 3x faster**. The WebGPU cost grows sharply between 100k and 200k (an 8 MB upload each frame; unexplored).
3. Fill-rate bound scenes are identical (the GPU does the same work either way), as expected for a single draw call with trivial shaders.
4. **Canvas2D is a true last resort**: 10,000 sprites with distinct tints took about 4 seconds per frame (it builds a tinted copy of the sprite for every distinct tint). It only has to work, not be fast.

### Caveats
- One machine (an NVIDIA laptop GPU, headless Chrome, desktop Windows). Integrated GPUs, other vendors and **mobile GPUs (the Android case) can rank the two APIs differently**, in particular because of upload bandwidth and driver quality; re-run `npm run bench:render` on each target (add `--visible` for a real window).
- The scene is deliberately the simplest possible. WebGPU's advantages (compute shaders for culling and particles, more explicit resource control, lower overhead with many draw calls and pipelines) are not exercised by one draw call; they would matter for the planned 3D milestone.
- Timings include the engine's own per-frame full upload; a renderer that uploads only changed sprites would favour whichever API uploads cheaper.

## 3D rendering: WebGPU vs WebGL2 (`npm run bench:render3d`)

Same machine and method (Chrome 154, RTX 5060 laptop, 1280x720, median of 3 runs with alternating backend order, frames submitted back to back; raw data `render3d-chrome-rtx5060-laptop.json`). Scenes: a lit, fogged, depth-tested ground plane plus N instanced meshes with per-instance colour, drawn with one instanced draw call per mesh. GPU ms per frame:

| Scene | WebGPU | WebGL2 | WebGPU +4x MSAA | WebGL2 +MSAA |
|---|---|---|---|---|
| 1,000 cubes | 0.16 | 0.08 | 0.14 | 0.06 |
| 10,000 cubes | 0.21 | 0.43 | 0.23 | 0.29 |
| 50,000 cubes (0.6 M triangles) | **1.11** | 1.73 | 0.99 | 1.58 |
| 100,000 cubes (1.2 M triangles) | **1.99** | 3.68 | 2.05 | 3.53 |
| 200,000 cubes (2.4 M triangles) | **5.78** | 8.86 | 5.83 | 7.88 |
| 10,000 low-poly spheres (1.9 M triangles) | **0.28** | 0.51 | 0.31 | 0.51 |
| 50,000 low-poly spheres (9.6 M triangles) | **1.27** | 2.98 | 1.35 | 3.03 |
| 1,000 high-poly spheres (6.1 M triangles) | 0.73 | 0.87 | 0.72 | 0.86 |
| 4,000 high-poly spheres (24.6 M triangles) | **2.80** | 3.40 | 2.73 | 3.38 |

- **WebGPU is 1.2x to 2.3x faster from 10,000 instances up, and the lead grows with the number of instances**; with very heavy meshes (24 M triangles) the GPU is the limit and the gap narrows to 1.2x. Below about 5,000 instances both take under 0.5 ms and WebGL2's lower fixed cost wins (0.08 against 0.16 ms for 1,000 cubes): irrelevant for the frame rate.
- **4x MSAA is nearly free here** on both (an RTX laptop GPU; do not assume this for mobile).
- **Main-thread cost** (CPU time inside `render()`): WebGL2 0.0 to 1.1 ms, WebGPU 0.1 to 4.0 ms (200,000 instances); the chunked copy of the instance data is the cost. Both stay far below a frame.
- Startup (create the renderer and show a frame): WebGL2 51 ms (12 ms with MSAA, a plain context), WebGPU 193 ms the first time and 74 ms with a second renderer.
- **Capacity:** 200,000 lit cubes (2.4 M triangles) at 173 fps on WebGPU, 50,000 low-poly spheres (9.6 M triangles) at 787 fps, 24 M triangles at 357 fps. A game scene of a few thousand objects costs well under 1 ms of GPU time.
- Caveats as for 2D: one NVIDIA desktop-class GPU, headless Chrome on Windows. Integrated and mobile GPUs can differ (especially MSAA cost and upload bandwidth).
