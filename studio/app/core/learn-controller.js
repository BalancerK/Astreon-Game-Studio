// Connects a pathway (learn/session.js: plain logic) to the studio: it looks at the project and the running game when something changes, begins missions
// (adding a file when the mission says so, opening and highlighting the line to look at), keeps the student's place with the project, and does what the
// student asks (a hint, the answer, skip, back). The Learn panel only draws what this says.
import { LearnSession } from '../learn/session.js';
import { PATHWAYS, PREPARE, DEFAULT_PATHWAY } from '../learn/pathways.js';

const CHECK_DELAY_MS = 250;

export class LearnController {
  /** @param {import('./studio.js').Studio} studio */
  constructor(studio) {
    this.studio = studio;
    this.session = null;
    this.events = new Set();
    this.timers = {};
    this.nudging = false;
    for (const ev of ['runner-applied', 'runner-summary', 'diagnostics', 'file-changed', 'files', 'restore-point']) {
      studio.on(ev, (e) => {
        if (ev === 'restore-point') this.events.add('restore-point');
        if (ev === 'runner-applied' && e?.restarted) this.events.add('restarted');      // the game was started again (Run)
        if (ev === 'file-changed') this.events.delete('restarted');                      // ...and an edit after that needs another Run
        this.#soon();
      });
    }
    // things done in the network lab and the Ship panel
    studio.runner.on('mouse', (locked) => { if (locked) { this.events.add('mouse-locked'); this.#soon(); } });
    for (const ev of ['lab-event', 'ship-event', 'plugin-event']) studio.on(ev, (name) => { this.events.add(name); this.#soon(); });
    this.timers.nudge = setInterval(() => this.#tickNudge(), 5000);
  }

  /** The pathway definitions on offer. */
  get pathways() { return Object.values(PATHWAYS); }

  /** Read this project's saved place, if it has one. Called after a project opens. */
  async load() {
    this.unload();
    const id = this.studio.project?.id;
    if (!id) return;
    const saved = await this.studio.store.getMeta(`learn:${id}`).catch(() => null);
    if (!saved || !PATHWAYS[saved.pathway]) { this.#changed(); return; }
    this.session = this.#wire(new LearnSession(PATHWAYS[saved.pathway], saved));
    if (!this.session.started && !this.session.atStageStart && !this.session.finished) this.begin();
    else this.#highlightCurrent();
    this.#changed();
  }

  /** Stop guiding (the project closed). */
  unload() {
    this.session = null;
    this.studio.highlights = new Map();
    this.studio.emit('highlights');
    this.#changed();
  }

  /** Start a pathway on a new project made from its template. */
  async start(pathwayId = DEFAULT_PATHWAY) {
    const pathway = PATHWAYS[pathwayId];
    if (!pathway) return;
    await this.studio.createProject({ name: pathway.projectName ?? 'My first game', template: pathway.template });
    this.session = this.#wire(new LearnSession(pathway));
    this.#save();
    this.studio.setWorkspace('learn');
    this.studio.dock?.show('learn');
    this.#changed();
  }

  /** Begin guiding the project that is open (for one made from the pathway's template). */
  turnOn(pathwayId = DEFAULT_PATHWAY) {
    const pathway = PATHWAYS[pathwayId];
    if (!pathway || !this.studio.project) return;
    this.session = this.#wire(new LearnSession(pathway));
    this.#save();
    this.studio.dock?.show('learn');
    this.#changed();
  }

  /** Begin the current mission: remember how things look now, add its files, open the place to look at. */
  begin() {
    const s = this.session;
    const project = this.studio.project;
    if (!s || !project) return;
    const m = s.mission;
    const add = m.prepare ? PREPARE[m.prepare]?.(this.studio.textFiles()) ?? {} : {};
    for (const [path, text] of Object.entries(add)) project.write(path, text);
    if (Object.keys(add).length) this.studio.emit('files');
    if (m.open) this.studio.dock?.show(m.open, { focus: false });
    this.events.clear();
    s.begin(this.studio.textFiles(), this.studio.runner.summary);
    this.#highlightCurrent({ go: true });
    this.#soon();
  }

  hint() { this.session?.hint(); }

  /** The student says they have done a step that happens outside the studio. */
  markDone() {
    this.events.add('manual');
    this.#soon();
  }

  showAnswer() { this.session?.showAnswer(); }

  /** Make the change the answer describes (offered only once the answer has been shown). */
  applyAnswer() {
    const s = this.session;
    const m = s?.mission;
    if (!m?.apply || !s.progress.answerShown || !this.studio.project) return;
    const changes = m.apply(this.studio.textFiles());
    for (const [path, text] of Object.entries(changes)) if (this.studio.project.read(path) !== text) this.studio.project.write(path, text);
    this.studio.log('system', 'The guide made that change for you. Read it, and try changing it yourself.');
    this.studio.run({ restart: false });
    this.#soon();
  }

  /** Go on to the next mission (skip = leave this one unfinished). */
  next({ skip = false } = {}) {
    const s = this.session;
    if (!s) return;
    const more = s.next({ skip });
    this.#clearHighlights();
    if (more && !s.atStageStart) this.begin();
  }

  back() {
    const s = this.session;
    if (!s?.back()) return;
    this.#clearHighlights();
    if (!s.atStageStart) this.begin();
  }

  setEnabled(on) {
    this.session?.setOn(on);
    if (!on) this.#clearHighlights(); else this.#highlightCurrent();
  }

  restart() {
    this.session?.restart();
    this.#clearHighlights();
  }

  /** What the checks are given. */
  #context() {
    const st = this.studio;
    return {
      files: st.textFiles(),
      summary: st.runner.summary,
      ok: st.runner.status === 'running' && st.diagnostics.size === 0,
      events: this.events,
    };
  }

  #wire(session) {
    session.on('change', (kind) => {
      if (kind === 'done') this.#clearHighlights();
      this.nudging = false;
      this.#save();
      this.#changed();
    });
    return session;
  }

  #soon() {
    if (!this.session || this.timers.check) return;            // one look every CHECK_DELAY_MS at most, however often things change
    this.timers.check = setTimeout(() => {
      this.timers.check = 0;
      this.session?.evaluate(this.#context());
    }, CHECK_DELAY_MS);
  }

  #tickNudge() {
    const now = !!this.session?.needsNudge();
    if (now !== this.nudging) { this.nudging = now; this.#changed(); }
  }

  #save() {
    const id = this.studio.project?.id;
    if (id && this.session) this.studio.store.setMeta(`learn:${id}`, this.session.save()).catch(() => {});
  }

  #changed() { this.studio.emit('learn'); }

  #clearHighlights() {
    if (!this.studio.highlights.size) return;
    this.studio.highlights = new Map();
    this.studio.emit('highlights');
  }

  /** Highlight the line a mission points at, and (when asked) show it. */
  #highlightCurrent({ go = false } = {}) {
    const s = this.session;
    const focus = s?.mission.focus;
    this.#clearHighlights();
    if (!s?.enabled || s.finished || !focus || !this.studio.project?.has(focus.file)) return;
    const lines = this.studio.project.readText(focus.file).split('\n');
    const at = lines.findIndex((l) => new RegExp(focus.pattern).test(l));
    if (at < 0) return;
    this.studio.highlights = new Map([[focus.file, [at + 1]]]);
    this.studio.emit('highlights');
    if (go) this.studio.goto(focus.file, at + 1, 1);
  }
}
