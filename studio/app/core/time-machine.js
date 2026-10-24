// The Time Machine as the studio uses it: what the panels ask for (pause, go back, replay with new code) goes to the game's worker through the runner, and
// this keeps the rest of the story: saving a recording as a file together with the code that made it, opening a recording somebody sent (into a new project,
// with its checksums re-checked on this computer), and watching only while a panel that shows the timeline or the state is on screen.
import { checkReplay } from '../../runner/timeline.js';
import { download } from '../ui/hub.js';

const MAX_FILE_BYTES = 12_000_000;
const WATCH_PANELS = ['time', 'inspect'];

export class TimeMachine {
  /** @param {import('./studio.js').Studio} studio */
  constructor(studio) {
    this.studio = studio;
    this.pending = null;                // a recording that is waiting for its game to load
    this.lastVerdict = null;            // what checking an opened recording found
    this.timer = setInterval(() => this.#syncWatching(), 400);
    studio.runner.on('verified', (v) => this.#verified(v));
    studio.runner.on('applied', () => this.#deliver());
  }

  get status() { return this.studio.runner.timeline; }

  /** Watch the game only while a panel that needs it can be seen (so a closed Time panel costs nothing). */
  #syncWatching() {
    const seen = WATCH_PANELS.some((id) => {
      const body = document.querySelector(`.panel-body[data-panel="${id}"]`);
      return !!body && body.offsetParent !== null && !body.hidden;
    });
    if (seen !== this.studio.runner.watching) this.studio.runner.watch(seen);
  }

  pause() { this.studio.runner.time('pause'); }

  play() { this.studio.runner.time('play'); }

  /** Pause or play, whichever is the other. */
  toggle() {
    if (this.status?.paused) this.play(); else this.pause();
  }

  step(n) { this.studio.runner.time('step', { n }); }

  seek(tick) { this.studio.runner.time('seek', { tick: Math.max(0, Math.trunc(tick)) }); }

  /** Run what was recorded again from here, with the code as it is now. */
  replay() { this.studio.runner.time('replay'); }

  /** Ask the game for its recording. @returns {Promise<object | null>} */
  #askForReplay() {
    return new Promise((resolve) => {
      const off = this.studio.runner.on('replay', (r) => { off(); clearTimeout(timer); resolve(r); });
      const timer = setTimeout(() => { off(); resolve(null); }, 5000);
      this.studio.runner.time('export');
    });
  }

  /** Save the recording and the game's code as one file that reproduces the game on any computer. */
  async save() {
    const st = this.studio;
    if (!st.project) return false;
    const replay = await this.#askForReplay();
    if (!replay) {
      st.toasts.show('There is nothing recorded yet. Let the game run for a moment first.', { kind: 'info' });
      return false;
    }
    const file = { ...replay, files: st.textFiles(), name: st.project.name };
    const bytes = new TextEncoder().encode(JSON.stringify(file));
    download(`${st.project.name}.replay.json`, bytes, 'application/json');
    st.log('system', `Saved a recording: ${Math.round(replay.endTick / 6) / 10} seconds of play, ${replay.events.length} key presses and edits. `
      + 'Anyone who opens it sees exactly what happened.');
    return true;
  }

  /** Open a recording file in a new project, paused at its start; the game's worker checks it matches on this computer. */
  async open(file) {
    const st = this.studio;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('This file is too big to be a recording.');
      const replay = checkReplay(JSON.parse(await file.text()));
      if (!replay.files?.['src/main.js']) throw new Error('This recording does not include the game\'s code, so it cannot be replayed here.');
      this.pending = replay;
      this.lastVerdict = null;
      const project = await st.store.create({ name: `Recording: ${replay.name ?? 'untitled'}`, template: 'blank', files: replay.files });
      await project.snapshot({ label: 'Start' });
      await st.openProject(project.id);
      st.setWorkspace('debug');
    } catch (error) {
      this.pending = null;
      st.toasts.show(String(error.message ?? error).slice(0, 300), { kind: 'error' });
    }
  }

  /** Once the game of an opened recording has loaded, give it the recording. */
  #deliver() {
    if (!this.pending) return;
    const replay = this.pending;
    this.pending = null;
    this.studio.runner.watch(true);
    this.studio.runner.loadReplay(replay);
  }

  #verified(v) {
    const st = this.studio;
    this.lastVerdict = v;
    if (v.error) st.log('error', `The recording could not be checked: ${v.error}`);
    else if (v.ok) {
      st.log('system', `Recording checked: all ${v.checked} checkpoints match over ${v.ticks} ticks. The game repeats exactly here too.`);
    }
    else st.log('warn', `The recording does not match from tick ${v.divergedAt}. Either the code is different, or the game uses chance or the clock `
      + '(Math.random, Date.now) so it cannot be reproduced exactly. In the kit, use random(game).');
    st.emit('verdict', v);
    const said = v.ok ? 'Recording reproduced exactly.' : 'This recording did not reproduce exactly. See the Console.';
    st.toasts.show(said, { kind: v.ok ? 'success' : 'info' });
  }

  dispose() { clearInterval(this.timer); }
}
