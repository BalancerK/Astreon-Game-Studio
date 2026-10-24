// Skill ratings (Elo). A team's rating is the average of its players'; every player on a team moves by the same amount.

/** The chance (0 to 1) that a side rated `a` beats a side rated `b`: 400 points apart means about 10 to 1. */
export function expectedScore(a, b, scale = 400) {
  return 1 / (1 + 10 ** ((b - a) / scale));
}

/**
 * New ratings after a match between two or more teams.
 * With more than two teams each pair counts once and a player's change is the average over their opponents, so a four-team free-for-all
 * is fair to everyone. Rating points are zero-sum between equal-sized teams.
 * @param {Array<{players: Array<{id: string, rating: number, games?: number}>, place: number}>} teams `place` 1 is the winner; equal places are a draw.
 * @param {{k?: number | ((player: {games?: number}) => number), scale?: number, floor?: number}} [o]
 *   `k`: the most a rating can move in one match (default 32, or 40 for a player's first 10 games and 24 after 100); `floor`: the lowest rating (default 100).
 * @returns {Map<string, {before: number, after: number, delta: number}>} by player id
 */
export function updateRatings(teams, { k, scale = 400, floor = 100 } = {}) {
  const kOf = typeof k === 'function' ? k : typeof k === 'number' ? () => k : (p) => ((p.games ?? 100) < 10 ? 40 : (p.games ?? 100) >= 100 ? 24 : 32);
  const mean = (t) => t.players.reduce((a, p) => a + p.rating, 0) / Math.max(1, t.players.length);
  const out = new Map();
  for (let i = 0; i < teams.length; i++) {
    const t = teams[i], mine = mean(t);
    let sum = 0, n = 0;
    for (let j = 0; j < teams.length; j++) {
      if (i === j) continue;
      const score = t.place < teams[j].place ? 1 : t.place > teams[j].place ? 0 : 0.5;
      sum += score - expectedScore(mine, mean(teams[j]), scale); n++;
    }
    const surprise = n ? sum / n : 0;
    for (const p of t.players) {
      const after = Math.max(floor, Math.round(p.rating + kOf(p) * surprise));
      out.set(p.id, { before: p.rating, after, delta: after - p.rating });
    }
  }
  return out;
}
