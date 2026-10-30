// A camera that follows from behind and to one side (a third-person or over-the-shoulder view): it sits a wanted distance back along the way the player looks, pulls in quickly when a wall is in the way
// and eases out slowly when it is clear, never goes below the ground, and moves to the other shoulder smoothly when told to. It gives a position; the look direction is the player's own. Pure steps of a
// small state, given what the world says (a ray test and the height of the ground), so the same rig works in any game and can be tested without one.
//
//   const rig = createFollowRig();
//   // every frame:
//   const { x, y, z } = stepFollowRig(rig, { pivot: [p.x, p.y + 4.7, p.z], yaw, pitch, distance: 12, side: 1, reach: 5, dt,
//     blocked: (from, to) => world.rayFraction(from, to), ground: (x, z) => world.heightAt(x, z) });
//   camera.x = x; camera.y = y; camera.z = z; camera.yaw = yaw; camera.pitch = pitch;

const sin = Math.sin, cos = Math.cos;

/**
 * Make the state of a follow camera (see `stepFollowRig`).
 * @param {{minDistance?: number, margin?: number, pullIn?: number, pullOut?: number, sideEase?: number, clearance?: number}} [o] `minDistance` the closest it will come (2), `margin` how far in front of a wall it
 * stays (1.5), `pullIn` / `pullOut` how fast it comes in when blocked and goes out when clear, per second (18 and 6), `sideEase` how fast it changes shoulder (9), `clearance` the least height above the ground (1.5)
 */
export function createFollowRig({ minDistance = 2, margin = 1.5, pullIn = 18, pullOut = 6, sideEase = 9, clearance = 1.5 } = {}) {
  return { distance: 4, sideNow: 1, minDistance, margin, pullIn, pullOut, sideEase, clearance };
}

/**
 * Move the camera for one frame.
 * @param {ReturnType<typeof createFollowRig>} rig
 * @param {object} o
 * @param {number[]} o.pivot the point it looks at and orbits, `[x, y, z]` (a shoulder height over the body)
 * @param {number} o.yaw @param {number} o.pitch the orbit angles, in radians: the camera sits at `pivot + (sin yaw cos pitch, sin pitch, cos yaw cos pitch) * distance`, looking back at the pivot (a game's look angles, when the camera looks the opposite way; give the angles it uses for that)
 * @param {number} o.distance how far back it wants to be
 * @param {number} [o.side] which shoulder: -1 to 1 (it eases toward it) @param {number} [o.reach] how far to the side that is at 1, in metres (0: straight behind)
 * @param {number} o.dt seconds since the last frame
 * @param {(from: number[], to: number[]) => (number | null)} [o.blocked] how far along `from` to `to` (0 to 1) a wall is, or null for a clear way
 * @param {(x: number, z: number) => number} [o.ground] the height of the ground
 * @returns {{x: number, y: number, z: number, distance: number}}
 */
export function stepFollowRig(rig, { pivot, yaw, pitch, distance, side = 0, reach = 0, dt, blocked = () => null, ground = () => -Infinity }) {
  const cp = cos(pitch), dir = [sin(yaw) * cp, sin(pitch), cos(yaw) * cp];
  rig.sideNow += (side - rig.sideNow) * Math.min(1, rig.sideEase * dt);
  const shift = rig.sideNow * reach, target = [pivot[0] + cos(yaw) * shift, pivot[1], pivot[2] - sin(yaw) * shift];
  const hit = blocked(target, [target[0] + dir[0] * distance, target[1] + dir[1] * distance, target[2] + dir[2] * distance]);
  const room = hit === null || hit === undefined ? distance : Math.max(rig.minDistance, hit * distance - rig.margin);
  rig.distance += (room - rig.distance) * Math.min(1, (room < rig.distance ? rig.pullIn : rig.pullOut) * dt);
  const d = Math.min(rig.distance, room), x = target[0] + dir[0] * d, z = target[2] + dir[2] * d;
  return { x, y: Math.max(ground(x, z) + rig.clearance, target[1] + dir[1] * d), z, distance: d };
}
