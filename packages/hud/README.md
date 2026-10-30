# @engine/hud

Widgets for a HUD drawn on **one 2D canvas over a 3D view**, taken from a competitive mech game: panels with cut corners, segmented gauges, bars, a cooldown sweep, a compass tape, a **radar that turns with the view**, arrows that point to things off the screen, and a frame-time overlay. Each is a function of a canvas context and a scale; the maths (where a place lands on the radar, which way an arrow points) is pure and tested without a browser.

**May import:** nothing.

```js
import { panel, segments, bar, sweep, compassTape, screenDirection, drawRadar, createFrameStats, statsRows, drawStatsPanel, HUD_THEME } from '@engine/hud';

const g = hudCanvas.getContext('2d'), u = Math.min(innerWidth / 1280, innerHeight / 720);      // u: the scale the numbers were chosen for

panel(g, 20 * u, 20 * u, 200 * u, 60 * u, u);                                               // dark glass, a thin edge, an accent line
segments(g, 28 * u, 56 * u, 184 * u, 8 * u, energy / max, HUD_THEME.main, 24);              // a gauge made of cells
sweep(g, x, y, 48 * u, 6 * u, cooldownLeft);                                                // shades the part of a cell still cooling, from the top round
compassTape(g, innerWidth, cameraYaw, u);

drawRadar(g, {
  cx: innerWidth - 91, cy: 91, size: 150, range: 300, center: [me.x, me.z], yaw: cameraYaw, wedge: halfFov,
  drawWorld: (g) => g.drawImage(terrainImage, -half - me.x, -half - me.z, size, size),     // origin at you, in metres, already turned to the view
  drawMarkers: (g, to) => { for (const e of enemies) { const p = to(e.x, e.z); /* p.edge: far, pulled in to the rim */ dot(g, p.x, p.y); } },
});

const hit = screenDirection(eyePos, attacker, cameraYaw, cameraPitch);                      // { angle, front, off }: the arrow round the crosshair, and how far in front it is

const stats = createFrameStats({ onWindow: (s) => adapt(s.fps, s.worst) });                  // every frame: stats.mark('render') after each part, stats.frame(now)
drawStatsPanel(g, statsRows(stats, { head: 'WebGPU' }), stats.fps, 12, 108, u);
```

## What is in it
- **`HUD_THEME`**: the colours and the font (a cool blue-green on dark glass, amber for markers). Every widget takes a `theme` option, so a game changes the look in one place.
- **`chamfer`, `panel`, `segments`, `bar`, `sweep`, `compassTape`**: draw, and leave the context as they found it (`save` and `restore` always match).
- **`screenDirection(eye, target, yaw, pitch)`**: which way (an angle, 0 to the right, a quarter turn down) a place is from the crosshair, and how far in front it is. It works in the camera's own right, up and forward, so it is true at any pitch. For the arrows that point to whoever hit you, to an objective, to a sound.
- **`radarProject` / `drawRadar`**: `to(x, z, inset)` says where a world place lands (`{ x, y, edge, dist }`: far ones are pulled in to the rim, so none is lost), and `drawRadar` draws the circle, the picture you give it, a wedge for how wide the camera sees, your markers, your own mark, the rim with ticks and the north.
- **`createFrameStats`, `statsRows`, `drawStatsPanel`, `watchGpuTime`**: frames a second, the slowest frame, the smoothed time of each named part of a frame, and (on WebGPU) the card's own time; the numbers are plain data, so they can feed `createDynamicResolution` in `@engine/render`.

Yaw 0 looks along −z and a positive pitch looks up (the renderer's own convention).

## Tests
`packages/hud/test/hud.test.js` draws on a context that writes down what is done to it, and checks the maths on its own.
