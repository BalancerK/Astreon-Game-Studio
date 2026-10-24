import { parseVersion, satisfies } from './semver.js';

/**
 * @typedef {Object} PluginDef
 * @property {string} id Lowercase id, e.g. `my-mod`. Namespaces everything the plugin registers.
 * @property {string} version `x.y.z`
 * @property {string} [engine] Engine version range this plugin supports (default `*`).
 * @property {Record<string, string>} [dependencies] Plugin id -> version range.
 * @property {(app: import('./app.js').PluginApp) => void} setup
 */

const ID_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Validate and freeze a plugin definition.
 * @param {PluginDef} def
 * @returns {Readonly<PluginDef>}
 */
export function definePlugin(def) {
  if (!def || !ID_RE.test(def.id ?? '')) throw new Error(`invalid plugin id "${def?.id}" (use lowercase letters, digits, dashes)`);
  parseVersion(def.version);
  if (typeof def.setup !== 'function') throw new Error(`plugin "${def.id}" needs a setup(app) function`);
  return Object.freeze({ engine: '*', dependencies: {}, ...def });
}

/**
 * Check dependencies and return plugins in load order (dependencies first).
 * @param {Readonly<PluginDef>[]} plugins
 * @param {string} engineVersion
 * @returns {Readonly<PluginDef>[]}
 */
export function resolvePlugins(plugins, engineVersion) {
  const byId = new Map();
  for (const p of plugins) {
    if (byId.has(p.id)) throw new Error(`duplicate plugin "${p.id}"`);
    byId.set(p.id, p);
  }
  for (const p of plugins) {
    if (!satisfies(engineVersion, p.engine)) {
      throw new Error(`plugin "${p.id}" requires engine ${p.engine}, running ${engineVersion}`);
    }
    for (const [dep, range] of Object.entries(p.dependencies)) {
      const d = byId.get(dep);
      if (!d) throw new Error(`plugin "${p.id}" needs missing plugin "${dep}" (${range})`);
      if (!satisfies(d.version, range)) {
        throw new Error(`plugin "${p.id}" needs "${dep}" ${range}, found ${d.version}`);
      }
    }
  }
  const order = [];
  const state = new Map(); // id -> 1 visiting, 2 done
  const visit = (p, path) => {
    if (state.get(p.id) === 2) return;
    if (state.get(p.id) === 1) throw new Error(`plugin dependency cycle: ${[...path, p.id].join(' -> ')}`);
    state.set(p.id, 1);
    for (const dep of Object.keys(p.dependencies)) visit(byId.get(dep), [...path, p.id]);
    state.set(p.id, 2);
    order.push(p);
  };
  for (const p of plugins) visit(p, []);
  return order;
}
