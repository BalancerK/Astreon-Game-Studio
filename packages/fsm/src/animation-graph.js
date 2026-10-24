// An animation state machine: states that play a clip or blend several (idle - walk - run by speed), transitions with cross-fades driven by
// parameters, triggers and the state's own progress. It does not know about skeletons: you give it functions to sample a clip into a pose and
// to blend two poses (the render package's `samplePose` and `blendPoses`), so it works with any rig.
//
// Presentation only: it uses ordinary maths and floating-point time, and never feeds back into a simulation.

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * @typedef {object} GraphState
 * @property {any} [clip] One clip to play.
 * @property {{param: string, clips: {clip: any, at: number}[]}} [blend1d] Blend between clips by a parameter's value (sorted by `at`): the phase of all of them is kept in step, so walk and run cycles stay in sync.
 * @property {boolean} [loop] Default: the clip's own setting.
 * @property {number} [speed] Playback speed multiplier (1); a number or the name of a parameter.
 * @property {(graph: AnimationGraph) => void} [enter]
 *
 * @typedef {{param?: string, op?: string, value?: number, equals?: any, trigger?: string}} Condition
 * @typedef {object} GraphTransition
 * @property {string} from A state name, or '*' for any state.
 * @property {string} to
 * @property {Condition | Condition[]} [when] All must hold. `{ param: 'speed', op: '>', value: 0.3 }`, `{ param: 'grounded', equals: true }`, `{ trigger: 'jump' }` (consumed when the transition is taken).
 * @property {number} [exitTime] Not before the source state has played this fraction of its clip (0..1).
 * @property {number} [duration] Cross-fade length in seconds (0.2).
 * @property {boolean} [interrupt] May start while another cross-fade is still running (the blend so far is frozen as the new "from").
 */

/**
 * Blends animation clips driven by parameters and triggers: states that play a clip or a 1D blend tree, transitions on parameter
 * conditions, triggers or finished clips, cross-fades and interrupts. `update(dt)` advances it and `sample(...)` gives the pose to
 * draw.
 */
export class AnimationGraph {
  /**
   * @param {object} config
   * @param {Record<string, number | boolean | 'trigger'>} [config.parameters] Names and starting values; 'trigger' makes a one-shot flag.
   * @param {Record<string, GraphState>} config.states
   * @param {GraphTransition[]} [config.transitions]
   * @param {string} config.initial
   * @param {object} io
   * @param {{createPose: () => any}} io.skeleton Whatever makes a pose you can pass to `sample` and `blend`.
   * @param {(skeleton: any, clip: any, time: number, out: any) => void} io.sample Write the pose of `clip` at `time` seconds into `out`.
   * @param {(out: any, a: any, b: any, weight: number) => void} io.blend `out = a * (1 - weight) + b * weight`.
   * @param {(clip: any) => number} [io.duration] Clip length in seconds (default `clip.duration`).
   */
  constructor(config, { skeleton, sample, blend, duration = (c) => c.duration }) {
    if (!config.states[config.initial]) throw new Error(`animation graph: the initial state "${config.initial}" is not one of ${Object.keys(config.states).join(', ')}`);
    this.config = config; this.skeleton = skeleton; this.sampleFn = sample; this.blendFn = blend; this.durationOf = duration;
    for (const t of config.transitions ?? []) {
      if (t.from !== '*' && !config.states[t.from]) throw new Error(`animation graph: transition from unknown state "${t.from}"`);
      if (!config.states[t.to]) throw new Error(`animation graph: transition to unknown state "${t.to}"`);
    }
    this.params = {}; this.triggers = new Set();
    for (const [k, v] of Object.entries(config.parameters ?? {})) { if (v === 'trigger') this.params[k] = false; else this.params[k] = v; }
    this.triggerNames = new Set(Object.entries(config.parameters ?? {}).filter(([, v]) => v === 'trigger').map(([k]) => k));
    this.state = config.initial; this.time = 0;
    /** The state being faded out, if a cross-fade is running: { state, time, snapshot }. */
    this.fade = null; this.fadeTime = 0; this.fadeDuration = 0;
    this.pose = skeleton.createPose();
    this.poseA = skeleton.createPose(); this.poseB = skeleton.createPose(); this.poseOld = skeleton.createPose(); this.poseNew = skeleton.createPose();
    this.onEnter = null;
    config.states[config.initial].enter?.(this);
  }

  /** Set a parameter (a number or a boolean). */
  set(name, value) {
    if (!(name in this.params)) throw new Error(`animation graph: no parameter "${name}" (it has ${Object.keys(this.params).join(', ') || 'none'})`);
    if (this.triggerNames.has(name)) { if (value) this.triggers.add(name); else this.triggers.delete(name); } else this.params[name] = value;
  }
  get(name) { return this.triggerNames.has(name) ? this.triggers.has(name) : this.params[name]; }
  /** Raise a trigger: it stays up until a transition that waits for it is taken (or `reset`). */
  trigger(name) { this.set(name, true); }

  #cond(c) {
    if (c.trigger !== undefined) return this.triggers.has(c.trigger);
    const v = this.params[c.param];
    if (v === undefined) throw new Error(`animation graph: no parameter "${c.param}"`);
    if (c.equals !== undefined) return v === c.equals;
    const x = c.value;
    switch (c.op ?? '>') {
      case '>': return v > x; case '>=': return v >= x; case '<': return v < x; case '<=': return v <= x;
      case '==': return v === x; case '!=': return v !== x;
      default: throw new Error(`animation graph: unknown comparison "${c.op}"`);
    }
  }

  /** How far through its clip the current state is, 0..1 (for a looping clip it wraps; for a blend, relative to the blended length). */
  get progress() { const d = this.#length(this.state); return d > 0 ? Math.min(1, this.time / d) : 1; }

  #speed(s) { return typeof s.speed === 'string' ? this.params[s.speed] : (s.speed ?? 1); }

  #length(name) {
    const s = this.config.states[name];
    if (s.clip) return this.durationOf(s.clip);
    const { clips } = s.blend1d, w = this.#weights(s);
    return this.durationOf(clips[w.i].clip) * (1 - w.t) + this.durationOf(clips[w.j].clip) * w.t;
  }

  #weights(s) {
    const { param, clips } = s.blend1d, v = this.params[param];
    if (v <= clips[0].at) return { i: 0, j: 0, t: 0 };
    const last = clips.length - 1;
    if (v >= clips[last].at) return { i: last, j: last, t: 0 };
    let i = 0; while (v > clips[i + 1].at) i++;
    return { i, j: i + 1, t: (v - clips[i].at) / (clips[i + 1].at - clips[i].at) };
  }

  /** Pose of a state at its time, into `out`. */
  #evaluate(name, time, out) {
    const s = this.config.states[name];
    if (s.clip) { this.sampleFn(this.skeleton, s.clip, this.#wrap(s, s.clip, time), out); return; }
    const { clips } = s.blend1d, w = this.#weights(s);
    const phase = (() => { const d = this.#length(name); return d > 0 ? time / d : 0; })();
    const dur = (c) => this.durationOf(c);
    this.sampleFn(this.skeleton, clips[w.i].clip, this.#wrapPhase(s, clips[w.i].clip, phase * dur(clips[w.i].clip)), w.t === 0 && w.i === w.j ? out : this.poseA);
    if (w.t === 0 && w.i === w.j) return;
    this.sampleFn(this.skeleton, clips[w.j].clip, this.#wrapPhase(s, clips[w.j].clip, phase * dur(clips[w.j].clip)), this.poseB);
    this.blendFn(out, this.poseA, this.poseB, w.t);
  }
  #wrap(s, clip, time) { return this.#wrapPhase(s, clip, time); }
  #wrapPhase(s, clip, time) {
    const d = this.durationOf(clip), loop = s.loop ?? clip.loop ?? true;
    if (d <= 0) return 0;
    return loop ? ((time % d) + d) % d : Math.min(time, d);
  }

  /**
   * Advance by `dt` seconds and return the pose (the same pose object every call: copy it if you need to keep it).
   * @returns {any}
   */
  update(dt) {
    const cfg = this.config;
    this.time += dt * this.#speed(cfg.states[this.state]);
    if (this.fade) {
      this.fadeTime += dt;
      if (!this.fade.snapshot) this.fade.time += dt * this.#speed(cfg.states[this.fade.state]);
      if (this.fadeTime >= this.fadeDuration) this.fade = null;
    }
    // transitions: the first (in the order listed) whose conditions hold
    if (!this.fade || this.#interruptible()) {
      for (const t of cfg.transitions ?? []) {
        if (t.from !== '*' && t.from !== this.state) continue;
        if (t.to === this.state && t.from === '*') continue;
        if (this.fade && !t.interrupt) continue;
        if (t.exitTime !== undefined && this.progress < t.exitTime) continue;
        const conds = t.when === undefined ? [] : Array.isArray(t.when) ? t.when : [t.when];
        if (!conds.every((c) => this.#cond(c))) continue;
        if (conds.length === 0 && t.exitTime === undefined) continue;
        for (const c of conds) if (c.trigger !== undefined) this.triggers.delete(c.trigger);
        this.#start(t);
        break;
      }
    }
    // the pose
    if (this.fade) {
      const k = smooth(this.fadeDuration > 0 ? this.fadeTime / this.fadeDuration : 1);
      if (this.fade.snapshot) this.poseOld.copy(this.fade.snapshot); else this.#evaluate(this.fade.state, this.fade.time, this.poseOld);
      this.#evaluate(this.state, this.time, this.poseNew);
      this.blendFn(this.pose, this.poseOld, this.poseNew, k);
    } else this.#evaluate(this.state, this.time, this.pose);
    return this.pose;
  }

  #interruptible() { return (this.config.transitions ?? []).some((t) => t.interrupt); }

  #start(t) {
    const cfg = this.config;
    const duration = t.duration ?? 0.2;
    if (this.fade && !this.fade.snapshot) { // a fade is running: freeze what is on screen as the starting point
      this.fade = { snapshot: this.skeleton.createPose().copy(this.pose), state: null, time: 0 };
    } else this.fade = duration > 0 ? { snapshot: null, state: this.state, time: this.time } : null;
    const from = this.state;
    this.state = t.to; this.time = 0;
    this.fadeTime = 0; this.fadeDuration = duration;
    if (duration <= 0) this.fade = null;
    cfg.states[t.to].enter?.(this);
    this.onEnter?.(t.to, from);
  }

  /** Jump to a state at once, without a cross-fade. */
  force(name, time = 0) {
    if (!this.config.states[name]) throw new Error(`animation graph: no state "${name}"`);
    this.state = name; this.time = time; this.fade = null; this.triggers.clear();
    this.config.states[name].enter?.(this);
  }

  /** Save: the state, time, parameters and any running fade (as a snapshot-free state: the fade is dropped). */
  save() { return { state: this.state, time: this.time, params: { ...this.params }, triggers: [...this.triggers] }; }
  load(d) { this.state = d.state; this.time = d.time; this.params = { ...d.params }; this.triggers = new Set(d.triggers); this.fade = null; return this; }
}
