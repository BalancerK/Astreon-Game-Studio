// A student's way through a pathway, as plain logic with no page in it: which mission they are on, what the game looked like when it began, how many hints
// they have asked for, and what is done. The studio calls `evaluate` when something changes; the session answers whether the mission is complete and tells
// whoever is listening. Progress is a small plain object (`save()`), kept with the project, so it survives closing the tab and works offline.
//
// Guidance, never gates: a student can skip any mission, go back, show the answer, or turn the guide off, and a professional never has to see it.
import { Emitter } from '../util/emitter.js';

/**
 * @typedef {Object} Mission
 * @property {string} id unique within the pathway
 * @property {string} title a short name
 * @property {string[]} task what to do, one paragraph per entry (`code` and **bold** are shown)
 * @property {(ctx: object) => {done: boolean, note?: string}} check
 * @property {string[]} watch the files whose text is remembered when the mission starts
 * @property {string[]} [hints] up to three, each a little more help than the one before
 * @property {string} [answer] the full answer, shown last
 * @property {(files: Record<string, string>) => Record<string, string>} [apply] makes the change for the student (offered after the answer is shown)
 * @property {{file: string, pattern: string}} [focus] a line to open and highlight when the mission starts
 * @property {string} [prepare] a name for things the studio does when the mission begins (adds a file, for example)
 * @property {string} [open] a panel to show when the mission begins (for example 'netlab')
 * @property {boolean} [manual] the student does it outside the studio and says so with a button
 * @property {string} why "Why does this work?", shown when the mission is done
 * @property {{label: string, href: string}} [deeper] where to read more
 */

/**
 * @typedef {Object} Stage
 * @property {string} id
 * @property {string} title
 * @property {string} intro what the student will make
 * @property {string} done what they made, and what comes next
 * @property {Mission[]} missions
 */

/**
 * @typedef {Object} Progress
 * @property {string} pathway
 * @property {boolean} on whether the guide is showing
 * @property {number} index which mission, counted over all stages
 * @property {string[]} done ids of missions finished
 * @property {string[]} skipped ids of missions skipped
 * @property {number} hints how many hints have been shown for this mission
 * @property {boolean} answerShown
 * @property {{files: Record<string, string>, summary: object | null} | null} start what things looked like when this mission began
 * @property {boolean} complete the whole pathway is finished
 */

export class LearnSession extends Emitter {
  /**
   * @param {{id: string, title: string, stages: Stage[]}} pathway
   * @param {Partial<Progress> | null} [saved] progress from an earlier visit
   * @param {{now?: () => number}} [o]
   */
  constructor(pathway, saved = null, { now = () => Date.now() } = {}) {
    super();
    this.pathway = pathway;
    this.now = now;
    this.missions = pathway.stages.flatMap((stage) => stage.missions.map((mission) => ({ stage, mission })));
    this.progress = {
      pathway: pathway.id, on: true, index: 0, done: [], skipped: [], hints: 0, answerShown: false, start: null, complete: false, ...(saved ?? {}),
    };
    this.progress.index = Math.max(0, Math.min(this.progress.index, this.missions.length - 1));
    this.note = '';                 // what is still missing, when the student is close
    this.since = now();             // when something last changed (the nudge waits for a quiet moment)
    this.completedNow = false;      // the current mission is done and waiting for the student to move on
    this.completedNow = this.progress.done.includes(this.mission.id);
  }

  get current() { return this.missions[this.progress.index]; }
  get mission() { return this.current.mission; }
  get stage() { return this.current.stage; }
  get enabled() { return this.progress.on; }
  get total() { return this.missions.length; }
  get finished() { return this.progress.complete; }

  /** Where the student is, for the progress display: the stages, and for each mission whether it is done, skipped or current. */
  outline() {
    return this.pathway.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      missions: stage.missions.map((m) => ({
        id: m.id,
        title: m.title,
        state: this.#stateOf(m),
      })),
    }));
  }

  #stateOf(m) {
    if (this.progress.done.includes(m.id)) return 'done';
    if (this.progress.skipped.includes(m.id)) return 'skipped';
    return m.id === this.mission.id && !this.finished ? 'current' : 'todo';
  }

  /** Is this the first mission of its stage, and has it not been started? (The studio shows the stage's introduction then.) */
  get atStageStart() {
    return this.stage.missions[0].id === this.mission.id;
  }

  /** The saved progress, as plain data. */
  save() { return JSON.parse(JSON.stringify(this.progress)); }

  /** Remember how things look right now: the mission's files and the game's numbers. Called when a mission begins. */
  begin(files, summary) {
    const mine = {};
    for (const path of this.mission.watch ?? []) mine[path] = files[path] ?? '';
    this.progress.start = { files: mine, summary: summary ? JSON.parse(JSON.stringify(summary)) : null };
    this.progress.hints = 0;
    this.progress.answerShown = false;
    this.note = '';
    this.since = this.now();
    this.completedNow = false;
    this.#changed();
  }

  /** Has this mission been started (are its starting values remembered)? */
  get started() { return !!this.progress.start; }

  /**
   * Look at the project and the game; if the mission is done, mark it.
   * @param {{files: Record<string, string>, summary: object | null, ok: boolean, events: Set<string>}} ctx
   * @returns {boolean} whether the mission is (now) complete
   */
  evaluate(ctx) {
    if (!this.enabled || this.finished) return false;
    if (this.completedNow) return true;
    if (!this.started) return false;
    if (!this.progress.start.summary && ctx.summary) {
      // the game was not reporting yet when the mission began: the first report is the start
      this.progress.start.summary = JSON.parse(JSON.stringify(ctx.summary));
      this.#changed();
    }
    let result;
    try {
      result = this.mission.check({ ...ctx, start: this.progress.start });
    } catch {
      result = { done: false, note: '' };                        // a broken check must never trap a student
    }
    const note = result.done ? '' : (result.note ?? '');
    if (result.done) {
      this.completedNow = true;
      if (!this.progress.done.includes(this.mission.id)) this.progress.done.push(this.mission.id);
      this.progress.skipped = this.progress.skipped.filter((id) => id !== this.mission.id);
      this.since = this.now();
      this.note = '';
      this.#changed('done');
      return true;
    }
    if (note !== this.note) { this.note = note; this.#changed(); }
    return false;
  }

  /** Is it time for a nudge? (A quiet moment: nothing has changed for a while, and the mission is not done.) */
  needsNudge(quietMs = 45_000) {
    return this.enabled && !this.finished && this.started && !this.completedNow && this.now() - this.since >= quietMs;
  }

  /** The hints shown so far (the mission's own, in order). */
  shownHints() { return (this.mission.hints ?? []).slice(0, this.progress.hints); }

  /** Show the next hint. Returns false when there are none left (the answer is next). */
  hint() {
    const all = this.mission.hints ?? [];
    if (this.progress.hints >= all.length) return false;
    this.progress.hints++;
    this.since = this.now();
    this.#changed();
    return true;
  }

  /** Are there hints still to show? */
  get hasMoreHints() { return this.progress.hints < (this.mission.hints ?? []).length; }

  /** Show the full answer. */
  showAnswer() {
    this.progress.answerShown = true;
    this.#changed();
  }

  /** Move on to the next mission (after finishing or skipping). Returns false when it was the last one. */
  next({ skip = false } = {}) {
    const id = this.mission.id;
    if (skip && !this.progress.done.includes(id) && !this.progress.skipped.includes(id)) this.progress.skipped.push(id);
    if (this.progress.index >= this.missions.length - 1) {
      this.progress.complete = true;
      this.completedNow = false;
      this.progress.start = null;
      this.#changed('complete');
      return false;
    }
    this.progress.index++;
    this.progress.start = null;
    this.progress.hints = 0;
    this.progress.answerShown = false;                                 // the studio calls begin() with the files as they are now
    this.completedNow = this.progress.done.includes(this.mission.id);
    this.note = '';
    this.#changed('mission');
    return true;
  }

  /** Go back one mission. */
  back() {
    if (this.progress.complete) { this.progress.complete = false; this.#changed('mission'); return true; }
    if (this.progress.index === 0) return false;
    this.progress.index--;
    this.progress.start = null;
    this.progress.hints = 0;
    this.progress.answerShown = false;
    this.completedNow = this.progress.done.includes(this.mission.id);
    this.note = '';
    this.#changed('mission');
    return true;
  }

  /** Turn the guide on or off (it keeps its place). */
  setOn(on) {
    this.progress.on = !!on;
    this.#changed();
  }

  /** Start again from the beginning. */
  restart() {
    Object.assign(this.progress, { index: 0, done: [], skipped: [], hints: 0, answerShown: false, start: null, complete: false, on: true });
    this.completedNow = false;
    this.note = '';
    this.#changed('mission');
  }

  #changed(kind = 'change') {
    this.emit('change', kind);
  }
}
