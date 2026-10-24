// Talking to the server's HTTP API: sign in as a guest (the id and secret live in this browser), find games, make and join private tables.

export class Api {
  /**
   * @param {string} [base] Where the server is (default: the page's own origin).
   * @param {Storage | null} [storage] Where the account is remembered.
   */
  constructor(base = '', storage = globalThis.localStorage ?? null) { this.base = base; this.storage = storage; this.account = null; }

  #load() { try { return JSON.parse(this.storage?.getItem('crazy-eights.account') ?? 'null'); } catch { return null; } }
  #save(a) {
    try {
      this.storage?.setItem('crazy-eights.account', JSON.stringify(a));
    } catch {
      /* private window: the account lasts as long as the page */
    }
  }

  async #call(method, path, body) {
    const headers = { 'content-type': 'application/json' };
    if (this.account) headers.authorization = `Bearer ${this.account.playerId}.${this.account.secret}`;
    const r = await fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) { const e = new Error(data?.error ?? `the server said ${r.status}`); e.status = r.status; throw e; }
    return data;
  }

  /** Use the remembered account, or make a new guest account. @returns {Promise<{playerId: string, name: string}>} */
  async signIn(name) {
    this.account = this.#load();
    if (this.account) {
      try { const me = await this.me(); this.account.name = me.name; return this.account; }
      catch (e) { if (e.status !== 401) throw e; this.account = null; } // the server forgot us (a new database): start again
    }
    const a = await this.#call('POST', '/api/guest', name ? { name } : {});
    this.account = a; this.#save(a);
    return a;
  }

  /** The full WebSocket address for a table path from the server (`/ws/g-m1`): the page's own address, `wss` over https. */
  wsUrl(path) { const l = globalThis.location; return `${l.protocol === 'https:' ? 'wss:' : 'ws:'}//${l.host}${path}`; }
  me() { return this.#call('GET', '/api/me'); }
  async setName(name) { const r = await this.#call('PUT', '/api/me', { name }); this.account.name = r.name; this.#save(this.account); return r; }
  leaderboard(n = 10) { return this.#call('GET', `/api/leaderboard?n=${n}`); }
  /** Join the queue for `mode` (`"solo"` or `"table"`). @returns {Promise<string>} the ticket id */
  async queue(mode) { return (await this.#call('POST', '/mm/queue', { mode })).ticket; }
  ticket(id) { return this.#call('GET', `/mm/ticket/${id}`); }
  cancel(id) { return this.#call('DELETE', `/mm/ticket/${id}`); }
  createPrivate() { return this.#call('POST', '/api/private'); }
  join(code) { return this.#call('POST', '/api/join', { code }); }
}
