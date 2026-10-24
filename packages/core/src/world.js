import { EntityAllocator, INDEX_BITS, INDEX_MASK } from './entity.js';

const ARRAYS = {
  f32: Float32Array, f64: Float64Array,
  i8: Int8Array, u8: Uint8Array,
  i16: Int16Array, u16: Uint16Array,
  i32: Int32Array, u32: Uint32Array,
};

/**
 * @typedef {Object} Component
 * @property {string} name Namespaced name, e.g. `engine:transform`.
 * @property {Record<string, keyof ARRAYS>} schema Field name -> numeric type.
 * @property {string[]} fields
 */

/**
 * Declare a component: a name and a schema of typed fields (`{ x: "f32", hp: "u8" }`). Components are stored as one typed array
 * per field; read them with `world.data(Component).x[id & INDEX_MASK]`.
 *
 * @param {string} name
 * @param {Record<string, keyof ARRAYS>} schema
 * @returns {Component}
 */
export function defineComponent(name, schema) {
  for (const [field, type] of Object.entries(schema)) {
    if (!ARRAYS[type]) throw new TypeError(`component ${name}.${field}: unknown type "${type}"`);
  }
  return Object.freeze({ name, schema: Object.freeze({ ...schema }), fields: Object.keys(schema) });
}

/**
 * Entities + struct-of-arrays component storage. Hot loops should grab
 * `world.data(Comp)` once and index its typed arrays by `id & INDEX_MASK`.
 */
export class World {
  /** @param {number} [capacity] */
  constructor(capacity = 65536) {
    this.entities = new EntityAllocator(capacity);
    this.capacity = capacity;
    /** @type {Map<Component, {data: Record<string, any>, present: Uint8Array}>} */
    this.stores = new Map();
  }

  /** @param {Component} comp */
  register(comp) {
    if (this.stores.has(comp)) return;
    const data = {};
    for (const f of comp.fields) data[f] = new ARRAYS[comp.schema[f]](this.capacity);
    this.stores.set(comp, { data, present: new Uint8Array(this.capacity) });
  }

  #store(comp) {
    const s = this.stores.get(comp);
    if (!s) throw new Error(`component "${comp.name}" is not registered`);
    return s;
  }

  create() { return this.entities.create(); }
  isAlive(id) { return this.entities.isAlive(id); }

  destroy(id) {
    if (!this.entities.destroy(id)) return false;
    const index = id & INDEX_MASK;
    for (const s of this.stores.values()) s.present[index] = 0;
    return true;
  }

  /**
   * Attach a component; unspecified fields reset to 0.
   * @param {number} id
   * @param {Component} comp
   * @param {Record<string, number>} [values]
   */
  add(id, comp, values) {
    if (!this.entities.isAlive(id)) throw new Error(`entity ${id} is not alive`);
    const s = this.#store(comp);
    const index = id & INDEX_MASK;
    for (const f of comp.fields) s.data[f][index] = values?.[f] ?? 0;
    s.present[index] = 1;
  }

  remove(id, comp) {
    if (this.entities.isAlive(id)) this.#store(comp).present[id & INDEX_MASK] = 0;
  }

  has(id, comp) {
    return this.entities.isAlive(id) && this.#store(comp).present[id & INDEX_MASK] === 1;
  }

  /** Typed arrays for a component, keyed by field. Index with `id & INDEX_MASK`. */
  data(comp) { return this.#store(comp).data; }

  /**
   * Fill `out` with ids of live entities that have all `comps`. No allocation.
   * @param {Uint32Array} out Must hold at least `capacity` ids.
   * @param {Component[]} comps
   * @returns {number} Number of ids written.
   */
  query(out, comps) {
    const { alive, generations, highWater } = this.entities;
    const presents = comps.map((c) => this.#store(c).present);
    let n = 0;
    outer: for (let i = 0; i < highWater; i++) {
      if (alive[i] !== 1) continue;
      for (let p = 0; p < presents.length; p++) if (presents[p][i] !== 1) continue outer;
      out[n++] = ((generations[i] << INDEX_BITS) | i) >>> 0;
    }
    return n;
  }
}
