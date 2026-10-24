// How the 3D scene editor (a page in a frame) keeps its scenes in the project: it asks the studio through messages, and the studio answers from the project's
// `scenes/*.json` files. `answer` is the studio's side, pure so it can be tested; `BridgeSceneStore` is the editor's side (the same `list / load / save / remove`
// every scene store has).

export const SCENES_DIR = 'scenes/';
export const MAX_SCENE_BYTES = 2_000_000;
const NAME = /^[A-Za-z0-9][\w-]{0,40}$/;

/**
 * Answer one request from the editor.
 * @param {{list(): string[], has(p: string): boolean, readText(p: string): string, write(p: string, t: string): void, remove(p: string): void}} project
 * @param {any} message {op: 'list' | 'load' | 'save' | 'remove', name?, scene?}
 * @returns {{ok: true, value?: any} | {ok: false, error: string}}
 */
export function answer(project, message) {
  try {
    const op = message?.op;
    if (op === 'list') {
      const names = project.list()
        .filter((p) => p.startsWith(SCENES_DIR) && p.endsWith('.json'))
        .map((p) => p.slice(SCENES_DIR.length, -5))
        .filter((n) => NAME.test(n));
      return { ok: true, value: names.sort().map((name) => ({ name })) };
    }
    if (!['load', 'save', 'remove'].includes(op)) return { ok: false, error: 'Unknown request.' };
    if (typeof message.name !== 'string' || !NAME.test(message.name)) {
      return { ok: false, error: 'A scene name uses letters, numbers, - and _ (up to 41 characters).' };
    }
    const path = `${SCENES_DIR}${message.name}.json`;
    if (op === 'load') {
      if (!project.has(path)) return { ok: false, error: `There is no scene "${message.name}".` };
      return { ok: true, value: JSON.parse(project.readText(path)) };
    }
    if (op === 'remove') {
      if (project.has(path)) project.remove(path);
      return { ok: true };
    }
    const scene = message.scene;
    if (!scene || typeof scene !== 'object' || scene.format !== 'engine-scene' || !Array.isArray(scene.entities)) {
      return { ok: false, error: 'That is not a scene.' };
    }
    const text = JSON.stringify(scene, null, 2);
    if (text.length > MAX_SCENE_BYTES) return { ok: false, error: 'That scene is too big to keep in a project.' };
    project.write(path, `${text}\n`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error).slice(0, 200) };
  }
}

/** The editor's side: talks to the studio through `request(message) -> Promise<reply>`. */
export class BridgeSceneStore {
  constructor(request) { this.request = request; }

  async #ask(message) {
    const reply = await this.request(message);
    if (!reply?.ok) throw new Error(reply?.error ?? 'The studio did not answer.');
    return reply.value;
  }

  list() { return this.#ask({ op: 'list' }); }

  load(name) { return this.#ask({ op: 'load', name }); }

  save(name, scene) { return this.#ask({ op: 'save', name, scene }).then(() => {}); }

  remove(name) { return this.#ask({ op: 'remove', name }).then(() => {}); }
}
