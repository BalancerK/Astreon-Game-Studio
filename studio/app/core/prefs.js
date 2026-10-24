// Small things the studio remembers for this person on this computer (which layout each workspace had, recently used commands, shortcut choices), kept as
// JSON in localStorage. Reading is forgiving: anything unreadable becomes the fallback, and a full or blocked storage never breaks the studio: what could
// not be written is kept in memory for as long as the page is open.
export class Prefs {
  /** @param {{getItem(k: string): string | null, setItem(k: string, v: string): void} | null} storage */
  constructor(storage) {
    this.storage = storage;
    this.memory = new Map();             // values that could not be stored (or no storage at all)
  }

  get(key, fallback) {
    try {
      const raw = this.memory.has(key) ? this.memory.get(key) : this.storage?.getItem(`studio.${key}`);
      return raw === null || raw === undefined ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  set(key, value) {
    const raw = JSON.stringify(value);
    try {
      if (!this.storage) throw new Error('no storage');
      this.storage.setItem(`studio.${key}`, raw);
      this.memory.delete(key);
    } catch {
      this.memory.set(key, raw);
    }
  }
}
