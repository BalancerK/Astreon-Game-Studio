# @engine/camera

The small things that make a 3D game's view feel physical, taken from a competitive mech game: a **follow camera** (third person or over the shoulder) that pulls in at walls and changes shoulder smoothly, a **spring kick** for landings and blows, **trauma shake**, a **wider view at speed**, and **hit-stop** with the punch of the view that goes with it. All of it is pure arithmetic on small plain objects: no renderer, no browser, nothing to mock in a test. You give it what the world says (a ray test, the height of the ground) and it gives you numbers to put on your camera.

**May import:** nothing.

```js
import { createFollowRig, stepFollowRig, createKick, kick, stepKick, traumaShake, rushFov, createHitStop } from '@engine/camera';

const rig = createFollowRig(), kicker = createKick(), hitStop = createHitStop();

// every frame:
const p = stepFollowRig(rig, {
  pivot: [me.x, me.y + 4.7, me.z],                    // what it orbits: shoulder height over the player
  yaw: look.yaw, pitch: look.pitch,                   // the camera sits at pivot + (sin yaw cos pitch, sin pitch, cos yaw cos pitch) * distance
  distance: 12, side: shoulder /* -1 or 1 */, reach: 5, dt,
  blocked: (from, to) => world.rayFraction(from, to), // how far along (0 to 1) a wall is, or null
  ground: (x, z) => world.heightAt(x, z),
});
camera.x = p.x; camera.y = p.y; camera.z = p.z;

stepKick(kicker, dt);                                  // after kick(kicker, { pitch: -12, dip: 9 }) on a landing: swings back with one small overshoot
const sh = traumaShake(trauma, clock, settings.shake); // trauma 0 to 1: a tremor for a little, felt for a lot
camera.x += sh.x; camera.y += sh.y; camera.z += sh.z; camera.roll = kicker.roll + sh.roll;
camera.fovY = baseFov * rushFov(speed, topSpeed) * (1 - hitStop.amount);

// in the fixed-step loop: a heavy blow freezes the game for a few ticks
while (acc >= DT) { if (!hitStop.skip()) tick(); acc -= DT; }   // hitStop.freeze(4); hitStop.punch(0.1) when it lands; hitStop.fade(dt) each frame
```

## What is in it
- **`createFollowRig(options)` / `stepFollowRig(rig, input)`**: the camera sits a wanted distance back, pulls in quickly (18 a second) when `blocked` says a wall is in the way and eases out slowly (6 a second) when it is clear, never closer than `minDistance` and never lower than `clearance` over `ground`. `side` (−1 to 1) eases the camera to a shoulder, `reach` metres at 1 (0 for straight behind). It returns `{ x, y, z, distance }`; the look direction is yours.
- **`createKick` / `kick` / `stepKick`**: a spring a little under critical damping on pitch, yaw, roll and dip: it swings once past rest and settles in about half a second. Limits and stiffness can be changed (`createKick({ stiffness, damping, maxAngle, maxDip })`). Steps are sliced, so a stalled page cannot make it unstable. How hard a landing or a blow pushes is the game's choice.
- **`traumaShake(trauma, clock, strength)`**: offsets and roll for a trauma squared, scaled by what the player allows.
- **`rushFov(speed, topSpeed, { widen, from, over })`**: a factor for the field of view: 1 up to 1.2 times top speed, 1.32 at 3.4 times.
- **`createHitStop()`**: `freeze(ticks)` (the longest wins), `skip()` once for each fixed tick, `punch(amount)` and `fade(dt)` for the view that is pulled in for a moment, `frozen`, `amount`, `reset()`.

## Tests
`packages/camera/test/camera.test.js`, including a run of two thousand frames that checks the follow rig gives exactly what the original inline code of the game it came from gave.
