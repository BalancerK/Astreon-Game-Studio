// A limit on how much one connection may ask of a server: a bucket that fills at `rate` a second up to `burst`, and a request takes one. Pure: it is told the time.

/**
 * Make a bucket.
 * @param {{rate: number, burst: number, now?: number}} o `rate` requests a second it earns, `burst` the most it holds (and starts with), `now` the time in milliseconds it starts at
 */
export function createTokenBucket({ rate, burst, now = 0 }) {
  let tokens = burst, refilled = now;
  return {
    /** Take one request's worth if there is one. @param {number} at milliseconds @returns {boolean} whether the request may go ahead */
    take(at) {
      tokens = Math.min(burst, tokens + ((at - refilled) / 1000) * rate); refilled = at;
      if (tokens < 1) return false;
      tokens--; return true;
    },
    /** How many requests it holds now. */
    get tokens() { return tokens; },
  };
}
