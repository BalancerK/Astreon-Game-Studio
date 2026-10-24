// Where scenes are kept while editing. The editor only needs list / load / save: in memory (tests), or on the dev server's scene folder.

/** Scenes kept in memory (tests, demos). Has the same `list / load / save / remove` as the other scene stores. */
export class MemorySceneStore {
  constructor(scenes = {}) { this.scenes = new Map(Object.entries(scenes).map(([k, v]) => [k, JSON.stringify(v)])); }
  async list() { return [...this.scenes.keys()].sort().map((name) => ({ name })); }
  async load(name) { const t = this.scenes.get(name); if (t === undefined) throw new Error(`there is no scene "${name}"`); return JSON.parse(t); }
  async save(name, scene) { this.scenes.set(name, JSON.stringify(scene)); }
  async remove(name) { this.scenes.delete(name); }
}

/** Scenes served by `serve({ writable: [{ route: '/__scenes', dir, ext: '.json' }] })` from `@engine/build`. */
export class HttpSceneStore {
  constructor(base = '/__scenes', { fetch: f = globalThis.fetch?.bind(globalThis) } = {}) { this.base = base.replace(/\/$/, ''); this.fetch = f; }
  async list() { const r = await this.fetch(`${this.base}/`); if (!r.ok) throw new Error(`could not list scenes (${r.status})`); return r.json(); }
  async load(name) { const r = await this.fetch(`${this.base}/${encodeURIComponent(name)}`); if (!r.ok) throw new Error(`could not load "${name}" (${r.status})`); return r.json(); }
  async save(name, scene) {
    const r = await this.fetch(`${this.base}/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(scene, null, 2) });
    if (!r.ok) throw new Error(`could not save "${name}" (${r.status}: ${await r.text()})`);
  }
  async remove(name) { const r = await this.fetch(`${this.base}/${encodeURIComponent(name)}`, { method: 'DELETE' }); if (!r.ok && r.status !== 404) throw new Error(`could not delete "${name}" (${r.status})`); }
}
