// What a pilot's points are made of. A match is still won by kills (or by points held, in control points), but each pilot also earns points for how they fight: a kill, a head shot, a blow with a
// blade, helping to bring down a mecha somebody else finished (an assist), runs of kills, several kills in a few seconds, the first kill of the round, getting back at whoever last destroyed you,
// ending somebody else's run, and holding a control point. Pure numbers and words, so a server and every browser count the same and the screens can show the same names. A game adds its own kinds (a parry, a flag capture) by spreading these tables: `POINTS`, `KINDS` and `PART_OF`, given to `createMatch` as `rules.points` and `rules.partOf`.

/** The points for each thing, one number each (the rest are built from these: see `streakBonus` and `multiBonus`). */
export const POINTS = Object.freeze({ kill: 100, head: 25, melee: 25, assist: 40, firstBlood: 50, revenge: 30, shutdown: 50, capture: 50 });

/** How many ticks a kill still counts as part of a multi-kill after the one before it (5 seconds). */
export const MULTI_WINDOW = 300;
/** How many ticks back damage counts for an assist (10 seconds). */
export const ASSIST_WINDOW = 600;
/** The least damage that makes an assist: the larger of this and a share of the victim armour, so a graze is not one. */
export const ASSIST_MIN = 40;
/** The share of the victim's health that damage must reach for an assist (or `ASSIST_MIN`, if that is more). */
export const ASSIST_SHARE = 0.08;

/** The extra points for a run of kills: 10 for the second in a row, 10 more for each after it, up to 50. @param {number} streak */
export const streakBonus = (streak) => Math.max(0, Math.min(5, streak - 1)) * 10;
/** The extra points for the nth kill in quick succession: 25 for a double, then 50, 75 and 100 for the largest. @param {number} n */
export const multiBonus = (n) => (n >= 2 ? Math.min(4, n - 1) * 25 : 0);
/** What ending a run of `streak` kills is worth: 50, and 10 more for each kill over 3 (up to 100). @param {number} streak */
export const shutdownBonus = (streak) => POINTS.shutdown + Math.min(5, Math.max(0, streak - 3)) * 10;

/** The runs of kills that are called out, and what they are called. */
export const STREAKS = Object.freeze({ 3: 'KILLING SPREE', 5: 'RAMPAGE', 7: 'UNSTOPPABLE', 10: 'LEGENDARY' });
/** The name of a run of kills if it is one that is called out, else null. @param {number} streak */
export const streakName = (streak) => STREAKS[streak] ?? null;
/** The name of the nth kill in quick succession. @param {number} n */
export const multiName = (n) => ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'QUAD KILL'][Math.min(n, 5)] ?? 'OVERKILL';

/** What each kind of award is called on the screen, and which colour it takes: 'main' (the usual), 'gold' (a good one), 'red' (a big one) or 'dim' (a small one). */
export const KINDS = Object.freeze({
  kill: { label: 'KILL', tone: 'main' }, head: { label: 'HEADSHOT', tone: 'gold' }, melee: { label: 'BLADE KILL', tone: 'gold' }, assist: { label: 'ASSIST', tone: 'main' },
  streak: { label: 'STREAK', tone: 'dim' }, multi: { label: 'MULTI KILL', tone: 'red' }, firstBlood: { label: 'FIRST BLOOD', tone: 'red' }, revenge: { label: 'REVENGE', tone: 'gold' },
  shutdown: { label: 'SHUTDOWN', tone: 'gold' }, capture: { label: 'POINT TAKEN', tone: 'main' },
});

/** The words for an award as it is shown: "KILL", "DOUBLE KILL", "KILLING SPREE"... @param {{kind: string, n?: number}} a @param {Record<string, {label: string}>} [kinds] a table with a game's own kinds added to `KINDS` */
export function awardLabel(a, kinds = KINDS) {
  if (a.kind === 'multi') return multiName(a.n ?? 2);
  if (a.kind === 'streak') return streakName(a.n ?? 0) ?? `${a.n} IN A ROW`;
  return kinds[a.kind]?.label ?? String(a.kind).toUpperCase();
}

/** Which part of a pilot's score each kind of award belongs to, and the name of the field in the score that keeps that part (what the results screen shows as "how you earned it"). */
export const PART_OF = Object.freeze({ kill: 'pk', head: 'pk', melee: 'pk', assist: 'pa', streak: 'ps', multi: 'ps', firstBlood: 'pb', revenge: 'pb', shutdown: 'pb', capture: 'pp' });

/**
 * How a pilot's score was made, largest part first: `{ key, label, points, note, tone }` for each part that is more than nothing. `row` is a pilot's row from the match summary.
 * @param {{pk?: number, pa?: number, ps?: number, pb?: number, pp?: number, kills?: number, heads?: number, blade?: number, assists?: number, bestStreak?: number, bestMulti?: number, revenges?: number, shutdowns?: number, firstBloods?: number}} row
 */
export function breakdown(row) {
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    { key: 'pk', label: 'Kills', points: row.pk ?? 0, tone: 'main', note: [plural(row.kills ?? 0, 'kill'), row.heads ? plural(row.heads, 'head shot') : '', row.blade ? plural(row.blade, 'blade kill') : ''].filter(Boolean).join(', ') },
    { key: 'pa', label: 'Assists', points: row.pa ?? 0, tone: 'gold', note: plural(row.assists ?? 0, 'assist') },
    { key: 'ps', label: 'Streaks and multi kills', points: row.ps ?? 0, tone: 'red', note: [row.bestStreak >= 2 ? `best run ${row.bestStreak}` : '', row.bestMulti >= 2 ? `best multi ${row.bestMulti}` : ''].filter(Boolean).join(', ') },
    { key: 'pb', label: 'Bonuses', points: row.pb ?? 0, tone: 'green', note: [row.firstBloods ? 'first blood' : '', row.revenges ? plural(row.revenges, 'revenge') : '', row.shutdowns ? plural(row.shutdowns, 'shutdown') : ''].filter(Boolean).join(', ') },
    { key: 'pp', label: 'Points taken', points: row.pp ?? 0, tone: 'main', note: '' },
  ];
  return parts.filter((p) => p.points > 0).sort((a, b) => b.points - a.points);
}
