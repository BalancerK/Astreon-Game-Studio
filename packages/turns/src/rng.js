// A small seeded random number generator whose position can be saved: a game that is saved in the middle and loaded again deals the same cards
// as one that never stopped. Only integer maths, so the same seed gives the same numbers in every JavaScript engine.

/**
 * A small seeded random number generator whose position (`state`) can be saved and restored, so a game saved in the middle
 * deals the same cards as one that never stopped. Integer maths only: the same seed gives the same numbers in every JavaScript
 * engine.
 */
export class Rng {
  /** @param {number} [seed] Any whole number. */
  constructor(seed = 1) { this.seed = seed >>> 0; /** The position in the sequence: save it, set it to go back there. */ this.state = this.seed; }
  /** The next number, 0 up to (not including) 1. */
  random() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** A whole number from 0 up to (not including) `n`. */
  int(n) { return Math.floor(this.random() * n); }
  /** A random element of a list. */
  pick(list) { return list[this.int(list.length)]; }
  /** Put a list in random order, in place (every order equally likely). Returns the list. */
  shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) { const j = this.int(i + 1); [list[i], list[j]] = [list[j], list[i]]; }
    return list;
  }
}
