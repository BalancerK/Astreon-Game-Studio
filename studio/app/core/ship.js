// Getting a game to players: measuring it (the web-health report), holding it to limits (budgets), and exporting it as a web page anyone can play. This is
// the studio's side; the pure parts (what an export contains, what a budget means) live in studio/export and are tested in Node.
import { buildWebExport, slug } from '../../export/export.js';
import { sizeReport, evaluate, cleanBudgets, defaultBudgets } from '../../export/health.js';
import { writeZip } from '../store/zip.js';
import { assetsOf } from '../store/assets.js';
import { settingsOf } from '../store/project-settings.js';
import * as P from '../../export/profiles.js';
import { download } from '../ui/hub.js';

const SLOWDOWNS = [1, 2, 4, 6];
const MEASURE_TIMEOUT_MS = 9000;

/** The size of some bytes after gzip, using the browser's own compressor. */
async function gzipSize(bytes) {
  if (typeof CompressionStream === 'undefined') return bytes.length;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return (await new Response(stream).arrayBuffer()).byteLength;
}

export class Ship {
  /** @param {import('./studio.js').Studio} studio */
  constructor(studio) {
    this.studio = studio;
    this.budgets = defaultBudgets();
    this.slowdown = studio.prefs.get('slowdown', 4);
    this.last = null;                  // { metrics, sizes, evaluation, at }
    this.measuring = false;
    this.lastExport = null;            // { title, files, bytes, at }
    this.runtimeText = null;
    this.controlsText = null;
  }

  /** Read this project's limits. Called when a project opens. */
  async load() {
    const id = this.studio.project?.id;
    this.last = null;
    this.lastExport = null;
    this.budgets = id ? cleanBudgets(await this.studio.store.getMeta(`budgets:${id}`).catch(() => null)) : defaultBudgets();
    this.studio.emit('ship');
  }

  setSlowdown(n) {
    if (!SLOWDOWNS.includes(n)) return;
    this.slowdown = n;
    this.studio.prefs.set('slowdown', n);
    this.#reevaluate();
  }

  /** Change one limit (a number above zero, or null to turn it off). */
  setBudget(id, value) {
    this.budgets = cleanBudgets({ ...this.budgets, [id]: value });
    const pid = this.studio.project?.id;
    if (pid) this.studio.store.setMeta(`budgets:${pid}`, this.budgets).catch(() => {});
    this.studio.emit('ship-event', 'budget-set');
    this.#reevaluate();
  }

  #reevaluate() {
    if (this.last) {
      this.last.metrics.slowdown = this.slowdown;
      this.last.evaluation = evaluate(this.last.metrics, this.budgets);
      this.studio.emit('ship-event', this.last.evaluation.passed ? 'budgets-pass' : 'budgets-fail');
    }
    this.studio.emit('ship');
  }

  /** Read an engine file from where the engine is served; null if there is none. */
  async #readEngine(path) {
    try {
      const res = await fetch(`${this.studio.engineRoot}/${path}`);
      return res.ok ? await res.text() : null;
    } catch { return null; }
  }

  async #runtime() {
    this.runtimeText ??= await (await fetch(new URL('../../export/runtime.js', import.meta.url))).text();
    return this.runtimeText;
  }

  async #controls() {
    this.controlsText ??= await (await fetch(new URL('../../runner/controls.js', import.meta.url))).text();
    return this.controlsText;
  }

  /** The project's build profiles (from build.json) and which one is chosen. */
  get profiles() {
    return P.buildOf(this.studio.project ? this.studio.textFiles() : {});
  }

  /** Change the profiles: written to build.json (the file is removed when they are the usual two again). */
  setProfiles(next) {
    const st = this.studio;
    if (!st.project) return;
    const text = P.serializeBuild(next);
    if (text === null) { if (st.project.has(P.FILE)) st.project.remove(P.FILE); } else st.project.write(P.FILE, text);
    st.emit('files');
    st.emit('ship');
  }

  /** What a profile does to the project: the files it keeps and leaves out, and anything it would break. */
  previewProfile(name) {
    const st = this.studio;
    const build = this.profiles;
    const profile = build.profiles[name ?? build.selected];
    return { profile, ...P.applyProfile(st.textFiles(), st.project ? assetsOf(st.project) : [], profile) };
  }

  /** Make the exported game's files from the open project, with the chosen build profile (what it leaves out, whether it works offline, whether it is a debug build). */
  async build({ title, offline, profile: name } = {}) {
    const st = this.studio;
    if (!st.project) throw new Error('Open a project first.');
    await st.project.flush();
    const all = this.profiles;
    const chosen = name ?? all.selected;
    const profile = all.profiles[chosen];
    const { settings } = settingsOf(st.textFiles());
    const kept = P.applyProfile(st.textFiles(), assetsOf(st.project), profile);
    if (kept.problems.length) {
      const first = kept.problems[0];
      throw new Error(`The "${chosen}" profile leaves out ${first.path}, which ${first.from} imports. Change what it leaves out.`);
    }
    return buildWebExport({
      files: kept.files, title: title || profile.title || settings.title || st.project.name, readEngine: (p) => this.#readEngine(p),
      runtime: await this.#runtime(), controls: await this.#controls(), assets: kept.assets, settings, offline: offline ?? profile.offline,
      build: P.buildNote(chosen, profile),
    });
  }

  /** Measure the game: start it fresh, let it run a moment, read what its frames cost, and size what a player would download. */
  async measure() {
    const st = this.studio;
    if (!st.project || this.measuring) return null;
    this.measuring = true;
    st.emit('ship');
    try {
      st.runner.perf = null;
      st.run({ restart: true });
      const started = performance.now();
      while (performance.now() - started < MEASURE_TIMEOUT_MS) {
        const p = st.runner.perf;
        if (p?.frame && p.frame.samples >= 100 && p.firstFrameMs !== null) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      const perf = st.runner.perf;
      const built = await this.build({ title: st.project.name });
      const sizes = await sizeReport(built.files, gzipSize);
      const metrics = {
        gzipBytes: sizes.gzipBytes, files: sizes.files, frameMs: perf?.frame?.p95 ?? undefined, slowdown: this.slowdown,
        firstFrameMs: perf?.firstFrameMs ?? undefined, memoryMB: perf?.heapMB ?? undefined, avgFrameMs: perf?.frame?.avg ?? undefined,
      };
      this.last = { metrics, sizes, evaluation: evaluate(metrics, this.budgets), at: Date.now() };
      st.emit('ship-event', 'health-run');
      st.emit('ship-event', this.last.evaluation.passed ? 'budgets-pass' : 'budgets-fail');
      return this.last;
    } finally {
      this.measuring = false;
      st.emit('ship');
    }
  }

  /** Export the game as a zip of static files and download it. Returns what was made. */
  async exportZip({ title, offline, profile } = {}) {
    const st = this.studio;
    const built = await this.build({ title, offline, profile });
    const bytes = writeZip(built.files);
    const name = `${slug(title || st.project.name)}-${profile ?? this.profiles.selected}.zip`;
    download(name, bytes);
    this.lastExport = { title: title || st.project.name, files: Object.keys(built.files).length, bytes: bytes.length, at: Date.now(), name,
      report: built.report };
    const made = this.lastExport;
    st.log('system', `Exported "${made.title}" as ${name}: ${made.files} files, ${Math.round(bytes.length / 1000)} KB. `
      + 'Upload the unzipped folder to any web host.');
    st.emit('ship-event', 'exported');
    st.emit('ship');
    return this.lastExport;
  }
}
