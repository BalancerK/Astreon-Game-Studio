/**
 * Entity ids are 32-bit: low 20 bits = slot index, high 12 bits = generation.
 * Destroying an entity bumps its slot's generation, so a stale id held
 * somewhere (client, network message) is never mistaken for a recycled entity.
 */
export const INDEX_BITS = 20;
/** Mask that keeps the slot-index bits of an entity id (the low 20 bits): `id & INDEX_MASK`. */
export const INDEX_MASK = (1 << INDEX_BITS) - 1;
/** The most entities that can exist at once (2^20). */
export const MAX_ENTITIES = INDEX_MASK + 1;
const GEN_MASK = 0xfff;

/**
 * The slot index part of an entity id (its low 20 bits): where its data lives in the component arrays.
 *
 * @param {number} id
 */
export const entityIndex = (id) => id & INDEX_MASK;
/**
 * The generation part of an entity id (its high 12 bits). Destroying an entity bumps its slot's generation, so a stale id is never
 * mistaken for a recycled one.
 *
 * @param {number} id
 */
export const entityGeneration = (id) => id >>> INDEX_BITS;

export class EntityAllocator {
  /** @param {number} capacity Max simultaneous entities (<= MAX_ENTITIES). */
  constructor(capacity) {
    if (capacity > MAX_ENTITIES) throw new RangeError(`capacity exceeds ${MAX_ENTITIES}`);
    this.capacity = capacity;
    this.generations = new Uint16Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.free = new Uint32Array(capacity);
    this.freeCount = 0;
    /** One past the highest slot ever used; bounds query loops. */
    this.highWater = 0;
  }

  /** @returns {number} A new entity id. */
  create() {
    let index;
    if (this.freeCount > 0) index = this.free[--this.freeCount];
    else if (this.highWater < this.capacity) index = this.highWater++;
    else throw new RangeError('entity capacity exhausted');
    this.alive[index] = 1;
    return ((this.generations[index] << INDEX_BITS) | index) >>> 0;
  }

  /**
   * @param {number} id
   * @returns {boolean} False if the id was already dead or stale.
   */
  destroy(id) {
    if (!this.isAlive(id)) return false;
    const index = id & INDEX_MASK;
    this.alive[index] = 0;
    this.generations[index] = (this.generations[index] + 1) & GEN_MASK;
    this.free[this.freeCount++] = index;
    return true;
  }

  /** @param {number} id */
  isAlive(id) {
    const index = id & INDEX_MASK;
    return index < this.highWater && this.alive[index] === 1 && this.generations[index] === id >>> INDEX_BITS;
  }
}
