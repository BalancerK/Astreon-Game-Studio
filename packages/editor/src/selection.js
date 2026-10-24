// What is selected. The last one picked is the "primary" (the one the inspector shows and the gizmo sits on).

/**
 * What is selected in the editor. The last one picked is the primary (shown in the inspector, carries the gizmo). `follow(doc)`
 * drops entities that no longer exist; `roots(doc)` leaves out those inside another selected entity.
 */
export class Selection {
  constructor() { this.ids = []; this.listeners = []; }
  get primary() { return this.ids.length ? this.ids[this.ids.length - 1] : null; }
  get size() { return this.ids.length; }
  has(id) { return this.ids.includes(id); }
  onChange(fn) { this.listeners.push(fn); return () => { this.listeners.splice(this.listeners.indexOf(fn), 1); }; }
  #set(ids) {
    const next = [...new Set(ids)];
    if (next.length === this.ids.length && next.every((v, i) => v === this.ids[i])) return false;
    this.ids = next; for (const fn of [...this.listeners]) fn(this.ids); return true;
  }
  set(ids) { return this.#set(Array.isArray(ids) ? ids : ids === null ? [] : [ids]); }
  clear() { return this.#set([]); }
  add(id) { return this.#set([...this.ids.filter((x) => x !== id), id]); }
  toggle(id) { return this.has(id) ? this.#set(this.ids.filter((x) => x !== id)) : this.add(id); }
  /** Select everything between the primary and `id` in the order of `list` (hierarchy shift-click). */
  range(id, list) {
    const a = list.indexOf(this.primary), b = list.indexOf(id);
    if (a < 0 || b < 0) return this.set(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return this.#set([...list.slice(lo, hi + 1).filter((x) => x !== id), id]);
  }
  /** Keep the selection valid as a scene changes: drop what no longer exists. Returns an unsubscribe function. */
  follow(doc) {
    return doc.onChange(() => { const alive = this.ids.filter((id) => doc.has(id)); if (alive.length !== this.ids.length) this.#set(alive); });
  }
  /** The selected entities that are not inside another selected entity (what move / copy / delete act on). */
  roots(doc) {
    const sel = new Set(this.ids);
    return this.ids.filter((id) => !doc.ancestors(id).some((a) => sel.has(a)));
  }
}
