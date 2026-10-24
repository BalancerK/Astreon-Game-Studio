// The 3D arena's rules, shared by the server and every client so prediction can reuse them. Keep this file deterministic:
// only + - * / and sqrt, and the engine's own sin/cos (`@engine/math`), never Math.sin or friends.
import { defineComponent } from '../../../packages/core/src/index.js';
import { NetSchema, InputSchema, q, u8, i8, u16 } from '../../../packages/protocol/src/index.js';
import { CharacterController } from '../../../packages/physics/src/index.js';
import { vec3, PI, HALF_PI } from '../../../packages/math/src/index.js';
import { DEFAULT_RULES, createRules } from './rules.js';

export { DEFAULT_RULES, createRules };

export const TICK_RATE = 60;
export const BUTTON_JUMP = 1;
export const BUTTON_RUN = 2;
export const BUTTON_FIRE = 4;

/** The play area: x and z in [-64, 64], y (up) in [-8, 56]. Everything replicated is quantized to these ranges. */
export const WORLD = Object.freeze({ min: -64, max: 64, minY: -8, maxY: 56 });
export const BODY = Object.freeze({ radius: 0.4, halfHeight: 0.9, eye: 0.7, stepHeight: 0.45 });

export const Pos3 = defineComponent('arena3d:pos', { x: 'f32', y: 'f32', z: 'f32' });
export const Look = defineComponent('arena3d:look', { yaw: 'f32', pitch: 'f32' });
export const Motion = defineComponent('arena3d:motion', { vy: 'f32', grounded: 'u8' });
export const Style = defineComponent('arena3d:style', { hue: 'u8' });
export const Health = defineComponent('arena3d:health', { hp: 'u8' });

// Positions: 128 m over 16 bits is 2 mm. Look: yaw 16 bits (0.006 degrees), pitch 8 bits (0.7 degrees, for other players' heads).
export const netSchema = new NetSchema([
  { component: Pos3, codecs: { x: q(WORLD.min, WORLD.max, 16), y: q(WORLD.minY, WORLD.maxY, 16), z: q(WORLD.min, WORLD.max, 16) } },
  { component: Look, codecs: { yaw: q(-PI, PI, 16), pitch: q(-HALF_PI, HALF_PI, 8) } },
  { component: Motion, codecs: { vy: q(-64, 64, 16), grounded: u8 } },
  { component: Style, codecs: { hue: u8 } },
  { component: Health, codecs: { hp: u8 } },
]);

/**
 * One input per tick. Move axes are integers (-127..127). `yaw` and `pitch` are the look direction the player had when they
 * pressed the keys, quantized: BOTH sides compute movement from the quantized angle, so prediction matches exactly.
 * `view` is only meaningful with the fire button: the server tick (in quarter ticks, modulo 65536) the shooter was
 * looking at, which the server rewinds to (lag compensation). 0 = unknown.
 */
export const inputSchema = new InputSchema({ moveX: i8, moveY: i8, buttons: u8, yaw: q(-PI, PI, 16), pitch: q(-HALF_PI, HALF_PI, 16), view: u16 });

/** @returns {CharacterController} A body with the arena's proportions and the rules' jump and gravity. */
export function createBody(x, y, z, rules = DEFAULT_RULES) {
  return new CharacterController({ x, y, z, radius: BODY.radius, halfHeight: BODY.halfHeight, stepHeight: BODY.stepHeight, gravity: rules.gravity, jumpSpeed: rules.jumpSpeed });
}

const fwd = [0, 0, 0], rgt = [0, 0, 0];

/**
 * One player input = one tick of movement. THE function both the server (authoritative) and the client (prediction) call.
 * `input` holds the values exactly as they travel on the wire (moveX, moveY: integers; buttons; yaw: dequantized angle).
 *
 * @param {import('../../../packages/physics/src/index.js').TriWorld} world
 * @param {CharacterController} body Updated in place.
 * @param {{moveX: number, moveY: number, buttons: number, yaw: number}} input
 * @param {number} dt
 * @param {ReturnType<typeof createRules>} [rules]
 */
export function stepPlayer(world, body, input, dt, rules = DEFAULT_RULES) {
  vec3.forward(fwd, input.yaw, 0);
  vec3.right(rgt, input.yaw);
  const f = input.moveY / 127, s = input.moveX / 127; // +moveY = forward, +moveX = right
  let wx = fwd[0] * f + rgt[0] * s, wz = fwd[2] * f + rgt[2] * s;
  const len = Math.sqrt(wx * wx + wz * wz);
  if (len > 1) { wx /= len; wz /= len; }
  const speed = (input.buttons & BUTTON_RUN) !== 0 ? rules.runSpeed : rules.walkSpeed;
  body.update(world, wx * speed, wz * speed, (input.buttons & BUTTON_JUMP) !== 0, dt);
}

/** Where a player's eyes (and shots) are. */
export function eyeY(body) { return body.y + BODY.eye; }

const dirOut = [0, 0, 0];
/** The unit direction a look angle points in (yaw 0, pitch 0 looks down -z). @returns {number[]} a shared scratch array */
export function lookDirection(yaw, pitch) { return vec3.forward(dirOut, yaw, pitch); }
