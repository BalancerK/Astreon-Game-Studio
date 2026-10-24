import { World, defineComponent } from './world.js';
import { Scheduler } from './scheduler.js';
import { EventBus } from './events.js';
import { resolvePlugins } from './plugin.js';

/** The engine version plugins are checked against (their `engine` range must accept it). */
export const ENGINE_VERSION = '0.0.1';

/**
 * What a plugin sees in `setup(app)`. Everything it registers is namespaced
 * with the plugin id, so two plugins can never collide by accident.
 */
export class PluginApp {
  /**
   * @param {App} app
   * @param {string} id
   */
  constructor(app, id) {
    this.app = app;
    this.id = id;
    this.world = app.world;
    this.events = app.events;
  }

  #q(name) { return name.includes(':') ? name : `${this.id}:${name}`; }

  /**
   * @param {string} name
   * @param {Record<string, 'f32'|'f64'|'i8'|'u8'|'i16'|'u16'|'i32'|'u32'>} schema
   */
  defineComponent(name, schema) {
    const comp = defineComponent(this.#q(name), schema);
    this.app.registerComponent(comp);
    return comp;
  }

  /**
   * @param {string} name System name (namespaced automatically; before/after
   *   entries without a `:` refer to this plugin's own systems).
   * @param {Function} fn Called as `fn(dt, tick)`.
   * @param {import('./scheduler.js').SystemOptions} [opts]
   */
  addSystem(name, fn, { before = [], after = [] } = {}) {
    this.app.scheduler.add(this.#q(name), fn, {
      before: before.map((n) => this.#q(n)),
      after: after.map((n) => this.#q(n)),
    });
  }

  /** Store a shared value other plugins can read by its namespaced name. */
  setResource(name, value) { this.app.resources.set(this.#q(name), value); }
  /** @param {string} name Full namespaced name, e.g. `physics:grid`. */
  getResource(name) { return this.app.resources.get(this.#q(name)); }
  on(name, fn) { return this.events.on(this.#q(name), fn); }
  emit(name, payload) { this.events.emit(this.#q(name), payload); }
}

/**
 * The application: a world, a scheduler of systems, an event bus, shared resources and the plugins that set them up. `use(plugin)`
 * loads plugins (dependencies resolved, setup run in load order); `update(dt, tick)` runs every system once.
 */
export class App {
  /** @param {{capacity?: number}} [opts] */
  constructor({ capacity } = {}) {
    this.world = new World(capacity);
    this.scheduler = new Scheduler();
    this.events = new EventBus();
    /** @type {Map<string, import('./world.js').Component>} */
    this.components = new Map();
    /** @type {Map<string, any>} */
    this.resources = new Map();
    this.plugins = [];
  }

  /** @param {import('./world.js').Component} comp */
  registerComponent(comp) {
    if (this.components.has(comp.name)) throw new Error(`duplicate component "${comp.name}"`);
    this.components.set(comp.name, comp);
    this.world.register(comp);
  }

  /**
   * Resolve dependencies, then run each plugin's setup in load order.
   * @param {...Readonly<import('./plugin.js').PluginDef>} plugins
   * @returns {this}
   */
  use(...plugins) {
    for (const p of resolvePlugins([...this.plugins, ...plugins], ENGINE_VERSION)) {
      if (this.plugins.includes(p)) continue;
      p.setup(new PluginApp(this, p.id));
      this.plugins.push(p);
    }
    return this;
  }

  /**
   * Run all systems once.
   * @param {number} dt Seconds
   * @param {number} tick
   */
  update(dt, tick) {
    this.scheduler.run(dt, tick);
  }
}
