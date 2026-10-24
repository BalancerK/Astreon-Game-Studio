// The arena's sound: gunshots (yours with no position, other players' placed where they fired), hit pings and impacts, footsteps
// for everyone, jump and landing, a hurt grunt, a chime for server messages, and a calm music loop. Every sound is made in code
// (see `sfx` in @engine/audio): there are no audio files. DOM-free, so tests can drive it with a stand-in audio context.
import { AudioEngine, sfx, ambientLoop } from '../../../packages/audio/src/index.js';

/**
 * Counts distance walked and says when a footstep should sound. One per player.
 */
export class StepCounter {
  /** @param {number} [stride] Metres between footsteps when walking; running steps are a little longer. */
  constructor(stride = 1.7) { this.stride = stride; this.travelled = 0; this.lastX = NaN; this.lastZ = NaN; }

  /**
   * @param {number} x
   * @param {number} z
   * @param {boolean} grounded Steps only happen on the ground
   * @returns {boolean} true when a step falls in this frame
   */
  update(x, z, grounded) {
    if (Number.isNaN(this.lastX)) { this.lastX = x; this.lastZ = z; return false; }
    const d = Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x; this.lastZ = z;
    if (d > 4) { this.travelled = 0; return false; } // a respawn or teleport
    if (!grounded) { this.travelled = 0; return false; }
    this.travelled += d;
    if (this.travelled >= this.stride) { this.travelled -= this.stride; return true; }
    return false;
  }
}

/**
 * @param {object} [o]
 * @param {import('../../../packages/audio/src/index.js').AudioEngine} [o.engine] Use this engine (default: a new one)
 * @param {() => number} [o.random] For variations (default Math.random)
 */
export function createArenaAudio({ engine = new AudioEngine(), random = Math.random } = {}) {
  const audio = engine;
  const make = (spec, name) => audio.createSound(spec, name);
  const sounds = {
    shots: [0, 1, 2].map((i) => make(sfx.shot(i), `shot${i}`)),
    hit: make(sfx.hit(), 'hit'), ping: make(sfx.ping(), 'ping'), jump: make(sfx.jump(), 'jump'), land: make(sfx.land(), 'land'),
    steps: [0, 1, 2, 3].map((i) => make(sfx.footstep(i), `step${i}`)),
    message: make(sfx.coin(), 'message'), hurt: make(sfx.hit(), 'hurt'),
    music: make(ambientLoop(), 'music'),
  };
  const stepCounters = new Map(); // player id -> StepCounter
  const selfSteps = new StepCounter(1.6);
  const pick = (list) => list[Math.floor(random() * list.length) % list.length];
  let wasGrounded = true, fallSpeed = 0, lastHp = null;

  const api = {
    audio, sounds,

    /** Your own shot: right in your ears, no position. */
    ownShot() { audio.play(pick(sounds.shots), { bus: 'sfx', volume: 0.55, pitchVariation: 0.06, maxPerSound: 3 }); },
    /** Someone else's shot, placed where it was fired. */
    shotAt(x, y, z) { audio.play(pick(sounds.shots), { bus: 'sfx', volume: 0.9, position: [x, y, z], refDistance: 5, maxDistance: 90, pitchVariation: 0.06, maxPerSound: 6 }); },
    /** A bullet landing at a point. */
    impact(x, y, z) { audio.play(sounds.hit, { bus: 'sfx', volume: 0.6, position: [x, y, z], refDistance: 3, maxDistance: 60, pitchVariation: 0.1 }); },
    /** The hit marker: your shot hit someone. */
    hitConfirm() { audio.play(sounds.ping, { bus: 'ui', volume: 0.5 }); },
    /** You took damage. */
    hurt() { audio.play(sounds.hurt, { bus: 'sfx', volume: 0.7, pitch: 0.55, priority: 5 }); },
    /** A message from the server (a mod's announcement). */
    message() { audio.play(sounds.message, { bus: 'ui', volume: 0.4 }); },

    /**
     * Your own movement: footsteps, and a jump and landing sound. Call once per frame.
     * @param {number} x
     * @param {number} z
     * @param {boolean} grounded
     * @param {number} vy Vertical speed (negative = falling)
     */
    selfMove(x, z, grounded, vy) {
      if (selfSteps.update(x, z, grounded)) audio.play(pick(sounds.steps), { bus: 'sfx', volume: 0.3, pitchVariation: 0.12, maxPerSound: 2 });
      if (wasGrounded && !grounded && vy > 1) audio.play(sounds.jump, { bus: 'sfx', volume: 0.35, pitchVariation: 0.05 });
      if (!grounded) fallSpeed = Math.min(fallSpeed, vy);
      if (!wasGrounded && grounded) {
        if (fallSpeed < -4) audio.play(sounds.land, { bus: 'sfx', volume: Math.min(0.8, 0.2 - fallSpeed * 0.04), pitchVariation: 0.08 });
        fallSpeed = 0;
      }
      wasGrounded = grounded;
    },

    /** Another player's footsteps, placed at their feet. Call once per frame per visible player. */
    otherMove(id, x, y, z, grounded) {
      let c = stepCounters.get(id);
      if (!c) { c = new StepCounter(1.7); stepCounters.set(id, c); }
      if (c.update(x, z, grounded)) audio.play(pick(sounds.steps), { bus: 'sfx', volume: 0.5, position: [x, y, z], refDistance: 2, maxDistance: 28, pitchVariation: 0.12, maxPerSound: 5 });
    },

    /** Forget players that left. */
    forget(liveIds) { for (const id of stepCounters.keys()) if (!liveIds.has(id)) stepCounters.delete(id); },

    /** Watch your health: a grunt when it drops. */
    watchHealth(hp) {
      if (lastHp !== null && hp < lastHp - 0.5) api.hurt();
      lastHp = hp;
    },

    /** Put the listener where the camera is, and move positioned sounds. Call once per frame. */
    update(camera) {
      audio.setListener(camera.x, camera.y, camera.z, camera.yaw, camera.pitch);
      audio.update();
    },

    startMusic() { audio.playMusic(sounds.music, { volume: 0.35, fade: 2 }); },
    toggleMute() { audio.setMuted('master', !audio.isMuted('master')); return audio.isMuted('master'); },
    toggleMusic() { audio.setMuted('music', !audio.isMuted('music')); return audio.isMuted('music'); },
  };
  return api;
}
