// Behaviours: ready-made things a thing can do, with no code to write. Give a kind of thing a list of them ("enemies pace back and forth, follow the hero when it is near
// and lose a life when they touch it") and call `behave(game, dt, keys)` once a tick. A behaviour is plain data (made in the studio's Behaviours panel and kept in
// `src/behaviors.js`), and everything a behaviour remembers lives on the thing itself (`thing.bs`), so saving, hot reload, rewinding and recordings just work.
// Things get them by their `kind`, or one by one in `thing.behaviors`.
//
//   behaviors({ enemy: [{ type: 'pace', speed: 40, distance: 80 }, { type: 'follow', target: 'hero', speed: 60, range: 120 }, { type: 'health', hp: 2 }] });
//   spawn(game, 'enemy', { x: 100, y: 100 });
//   behave(game, dt, keys);                // every tick
//   hurt(game, enemy, 1);                  // when a bullet hits it; at 0 it is gone
import { all, spawn, despawn, touching, random, randomBetween } from './things.js';
import { held, patrol } from './control.js';
import { navGrid, route, isBlocked } from './paths.js';

/**
 * @typedef {{type: string, [param: string]: any}} Behavior
 * @typedef {{label: string, help: string, params: Object<string, {label: string, kind: 'number' | 'text' | 'choice' | 'flag', default: any, min?: number, max?: number, step?: number, choices?: string[]}>}} BehaviorKind
 */

const SCREEN = [0, 0, 480, 320];
const num = (label, def, min, max, step = 1) => ({ label, kind: 'number', default: def, min, max, step });
const text = (label, def) => ({ label, kind: 'text', default: def });

/** Every behaviour: what it is called, what it does, and its settings (name, kind, the starting value and the range a number may take). */
export const BEHAVIORS = {
  pace: {
    label: 'Pace back and forth', help: 'Walks left and right around where it started, turning round at each end.',
    params: { speed: num('Speed', 40, 0, 600, 5), distance: num('How far each way', 80, 0, 1000, 5) },
  },
  patrol: {
    label: 'Patrol the ground', help: 'For a platformer: walks along the ground and turns round at a wall or at the end of a ledge.',
    params: { speed: num('Speed', 60, 0, 600, 5), solid: text('Blocked by', 'wall') },
  },
  follow: {
    label: 'Follow something', help: 'Moves toward the nearest thing of a kind, when it is close enough.',
    params: { target: text('Follows', 'hero'), speed: num('Speed', 70, 0, 600, 5), range: num('Notices from (0 is anywhere)', 0, 0, 2000, 10),
      stopAt: num('Stops this close', 8, 0, 500, 1) },
  },
  goTo: {
    label: 'Go to something, round walls', help: 'Finds its way to the nearest thing of a kind, walking round walls instead of into them. It uses the level grid.',
    params: { target: text('Goes to', 'hero'), speed: num('Speed', 70, 0, 600, 5), range: num('Notices from (0 is anywhere)', 0, 0, 4000, 10),
      stopAt: num('Stops this close', 12, 0, 500, 1), solid: text('Blocked by', 'wall'), rethink: num('Looks for a new way every (s)', 0.4, 0.05, 5, 0.05),
      tile: num('Grid size (when there is no level)', 32, 8, 128, 4) },
  },
  keepAway: {
    label: 'Keep away from something', help: 'Runs from the nearest thing of a kind when it gets close, round the sides of walls, and stops when it is cornered.',
    params: { from: text('Runs from', 'hero'), speed: num('Speed', 80, 0, 600, 5), range: num('Runs when closer than (0 is always)', 140, 0, 4000, 10),
      solid: text('Blocked by', 'wall'), tile: num('Grid size (when there is no level)', 32, 8, 128, 4) },
  },
  wander: {
    label: 'Wander', help: 'Walks in a random direction for a while, then picks another, staying on the screen.',
    params: { speed: num('Speed', 40, 0, 600, 5), changeEvery: num('Changes its mind every (s)', 1.5, 0.2, 20, 0.1) },
  },
  bounce: {
    label: 'Bounce around', help: 'Flies in a straight line and bounces off the edges of the screen.',
    params: { speed: num('Speed', 120, 0, 900, 5), angle: num('Starts going (degrees)', 45, -360, 360, 5) },
  },
  shoot: {
    label: 'Shoot', help: 'Fires bullets (things of another kind) now and then, or when a key is held. They fly straight and are gone after a while.',
    params: {
      bullet: text('Bullet kind', 'bullet'), every: num('Every (s)', 1, 0.05, 20, 0.05), speed: num('Bullet speed', 260, 10, 1500, 10),
      aim: { label: 'Aims', kind: 'choice', default: 'right', choices: ['right', 'left', 'up', 'down', 'target'] },
        target: text('Target (when it aims at one)', 'hero'),
      key: text('Only while this key is held (empty: always)', ''), life: num('Bullet lasts (s)', 1.5, 0.1, 20, 0.1), size: num('Bullet size', 6, 1,
        64, 1),
    },
  },
  health: {
    label: 'Has health',
      help: 'Hit points. Use hurt(game, thing, 1) when it is hit: it flashes, cannot be hurt again for a moment, and is removed at 0.',
    params: { hp: num('Hit points', 3, 1, 999, 1), safeFor: num('Safe after a hit (s)', 0.6, 0, 10, 0.1), removeAtZero: { label: 'Removed at 0',
      kind: 'flag', default: true } },
  },
  hurtOnTouch: {
    label: 'Hurt on touch', help: 'Takes hit points off a thing of another kind when they touch (it needs the "Has health" behaviour).',
    params: { target: text('Hurts', 'hero'), amount: num('How much', 1, 1, 99, 1) },
  },
  collect: {
    label: 'Collected on touch', help: 'Disappears when a thing of another kind touches it, and adds to the score.',
    params: { by: text('Collected by', 'hero'), score: num('Score', 1, -999, 999, 1) },
  },
  lifetime: {
    label: 'Disappears after a while', help: 'Removed after some seconds.',
    params: { seconds: num('Seconds', 3, 0.1, 3600, 0.1) },
  },
};
export const BEHAVIOR_LIMITS = { perKind: 12, name: 32 };

let table = {};

/**
 * Give kinds of things their behaviours, once, at the top of the game's file.
 * @param {Object<string, Behavior[]>} byKind for example what you made in the Behaviours panel
 */
export function behaviors(byKind) {
  table = {};
  for (const [kind,
    list] of Object.entries(byKind ?? {})) table[kind] = (Array.isArray(list) ? list : []).map(cleanBehavior).filter(Boolean).slice(0,
    BEHAVIOR_LIMITS.perKind);
}

/**
 * Make one behaviour safe: a known type, every setting there and within its range (a missing one gets its starting value).
 * @param {unknown} spec
 * @returns {Behavior | null}
 */
export function cleanBehavior(spec) {
  const kind = BEHAVIORS[spec?.type];
  if (!kind) return null;
  const out = { type: spec.type };
  for (const [name, p] of Object.entries(kind.params)) {
    const v = spec[name];
    if (p.kind === 'number') out[name] = Math.max(p.min, Math.min(p.max, Number.isFinite(v) ? v : p.default));
    else if (p.kind === 'flag') out[name] = typeof v === 'boolean' ? v : p.default;
    else if (p.kind === 'choice') out[name] = p.choices.includes(v) ? v : p.default;
    else out[name] = typeof v === 'string' && v.length <= BEHAVIOR_LIMITS.name ? v.trim() : p.default;
  }
  return out;
}

/**
 * Say what is wrong with a list of behaviours, in plain words (they are always made safe when used; this says what was changed or will not work).
 * @param {Behavior[]} list
 * @returns {{index: number, message: string}[]}
 */
export function behaviorProblems(list) {
  const out = [];
  if (!Array.isArray(list)) return [{ index: -1, message: 'A kind has a list of behaviours.' }];
  if (list.length > BEHAVIOR_LIMITS.perKind) out.push({ index: -1, message: `At most ${BEHAVIOR_LIMITS.perKind} behaviours for one kind are used.` });
  const seen = new Set();
  list.forEach((spec, index) => {
    if (!BEHAVIORS[spec?.type]) { out.push({ index, message: `"${spec?.type}" is not a behaviour.` }); return; }
    const clean = cleanBehavior(spec);
    for (const [k, v] of Object.entries(clean)) if (k !== 'type' && spec[k] !== undefined && spec[k] !== v) out.push({ index,
      message: `${BEHAVIORS[spec.type].label}: "${k}" was ${JSON.stringify(spec[k])}; it is kept to ${JSON.stringify(v)}.` });
    if (seen.has(spec.type)) out.push({ index, message: `${BEHAVIORS[spec.type].label} is there twice; they will fight each other.` });
    seen.add(spec.type);
  });
  return out;
}

const nearest = (game, thing, kind) => {
  let best = null;
  let bestD = Infinity;
  for (const t of all(game, kind)) {
    if (t === thing) continue;
    const d = Math.hypot(t.x + t.w / 2 - (thing.x + thing.w / 2), t.y + t.h / 2 - (thing.y + thing.h / 2));
    if (d < bestD) { best = t; bestD = d; }
  }
  return { thing: best, distance: bestD };
};

let pass = 0;
const grids = new WeakMap();
/** The grid for a kind of wall, made once for each pass of `behave` however many things ask for it. */
function gridFor(game, solid, tile) {
  let byKind = grids.get(game);
  if (!byKind) grids.set(game, byKind = new Map());
  const key = `${solid}:${tile}`;
  const made = byKind.get(key);
  if (made?.pass === pass) return made.grid;
  const grid = navGrid(game, solid, tile);
  byKind.set(key, { pass, grid });
  return grid;
}

const state = (thing, type) => ((thing.bs ??= {})[type] ??= {});
const within = (thing, [x, y, w, h]) => {
  thing.x = Math.max(x, Math.min(x + w - thing.w, thing.x));
  thing.y = Math.max(y, Math.min(y + h - thing.h, thing.y));
};

/** Hurt a thing that has the health behaviour. Returns true if that was the end of it. A thing that was hurt a moment ago is safe, and nothing happens. */
export function hurt(game, thing, amount = 1) {
  if (thing.hp === undefined || (thing.hurtLeft ?? 0) > 0 || thing.hp <= 0) return false;
  thing.hp = Math.max(0, thing.hp - amount);
  thing.hurtLeft = thing.safeFor ?? 0.6;
  return thing.hp <= 0;
}

/** Give hit points back (never above what it started with). */
export function heal(thing, amount = 1) {
  if (thing.hp === undefined) return;
  thing.hp = Math.min(thing.maxHp ?? thing.hp + amount, thing.hp + amount);
}

const RUN = {
  pace(game, t, p, dt) {
    const s = state(t, 'pace');
    s.home ??= t.x;
    s.dir ??= 1;
    t.x += s.dir * p.speed * dt;
    if (t.x > s.home + p.distance) { t.x = s.home + p.distance; s.dir = -1; } else if (t.x < s.home - p.distance) { t.x = s.home - p.distance; s.dir = 1; }
    t.flip = s.dir < 0;
  },
  patrol(game, t, p, dt) { patrol(game, t, dt, p.speed, p.solid); },
  follow(game, t, p, dt) {
    const { thing: goal, distance } = nearest(game, t, p.target);
    if (!goal || (p.range > 0 && distance > p.range) || distance <= p.stopAt) return;
    const dx = goal.x + goal.w / 2 - (t.x + t.w / 2);
    const dy = goal.y + goal.h / 2 - (t.y + t.h / 2);
    t.x += (dx / distance) * p.speed * dt;
    t.y += (dy / distance) * p.speed * dt;
    t.flip = dx < 0;
  },
  goTo(game, t, p, dt) {
    const s = state(t, 'goTo');
    const { thing: goal, distance } = nearest(game, t, p.target);
    if (!goal || (p.range > 0 && distance > p.range) || distance <= p.stopAt) { s.way = null; return; }
    const grid = gridFor(game, p.solid, p.tile);
    const at = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
    const to = { x: goal.x + goal.w / 2, y: goal.y + goal.h / 2 };
    s.wait = (s.wait ?? 0) - dt;
    if (!s.way || s.wait <= 0) {
      s.way = route(grid, at, to).map((n) => [n.x, n.y]);
      s.wait = p.rethink;
    }
    let step = p.speed * dt;
    while (step > 0) {
      const next = s.way.length ? { x: s.way[0][0], y: s.way[0][1] } : to;     // at the end of the way it is in the goal's own square: walk straight to it
      const dx = next.x - (t.x + t.w / 2);
      const dy = next.y - (t.y + t.h / 2);
      const d = Math.hypot(dx, dy);
      if (d <= step) {
        t.x += dx;
        t.y += dy;
        step -= d;
        if (!s.way.length) break;
        s.way.shift();
      } else {
        t.x += (dx / d) * step;
        t.y += (dy / d) * step;
        t.flip = dx < 0;
        break;
      }
      if (dx < 0) t.flip = true; else if (dx > 0) t.flip = false;
    }
  },
  keepAway(game, t, p, dt) {
    const { thing: threat, distance } = nearest(game, t, p.from);
    if (!threat || (p.range > 0 && distance > p.range)) return;
    const grid = gridFor(game, p.solid, p.tile);
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    const tx = threat.x + threat.w / 2;
    const ty = threat.y + threat.h / 2;
    const reach = Math.max(grid.tile * 0.75, p.speed * dt * 3);
    let best = null;
    let bestScore = distance;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const half = Math.max(t.w, t.h) / 2;
      if (isBlocked(grid, cx + ux * (reach + half), cy + uy * (reach + half)) || isBlocked(grid, cx + ux * (p.speed * dt + half), cy + uy * (p.speed * dt + half))) continue;
      const score = Math.hypot(cx + ux * reach - tx, cy + uy * reach - ty);
      if (score > bestScore + 0.001) { best = [ux, uy]; bestScore = score; }
    }
    if (!best) return;                                                          // cornered: nowhere to go that is further away
    t.x += best[0] * p.speed * dt;
    t.y += best[1] * p.speed * dt;
    t.flip = best[0] < 0;
  },
  wander(game, t, p, dt) {
    const s = state(t, 'wander');
    s.left = (s.left ?? 0) - dt;
    if (s.left <= 0) { s.left = p.changeEvery * randomBetween(game, 0.6, 1.4); s.angle = random(game) * Math.PI * 2; }
    t.x += Math.cos(s.angle) * p.speed * dt;
    t.y += Math.sin(s.angle) * p.speed * dt;
    within(t, SCREEN);
    t.flip = Math.cos(s.angle) < 0;
  },
  bounce(game, t, p, dt) {
    const s = state(t, 'bounce');
    if (s.vx === undefined) { s.vx = Math.cos((p.angle * Math.PI) / 180) * p.speed; s.vy = Math.sin((p.angle * Math.PI) / 180) * p.speed; }
    t.x += s.vx * dt;
    t.y += s.vy * dt;
    if (t.x < 0 || t.x + t.w > SCREEN[2]) { s.vx = -s.vx; within(t, SCREEN); }
    if (t.y < 0 || t.y + t.h > SCREEN[3]) { s.vy = -s.vy; within(t, SCREEN); }
  },
  shoot(game, t, p, dt, keys) {
    const s = state(t, 'shoot');
    s.wait = Math.max(0, (s.wait ?? 0) - dt);
    if (s.wait > 0 || (p.key && !held(keys ?? new Set(), p.key))) return;
    let vx = 0;
    let vy = 0;
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    if (p.aim === 'target') {
      const { thing: goal, distance } = nearest(game, t, p.target);
      if (!goal) return;
      vx = ((goal.x + goal.w / 2 - cx) / (distance || 1)) * p.speed;
      vy = ((goal.y + goal.h / 2 - cy) / (distance || 1)) * p.speed;
    } else {
      vx = { right: p.speed, left: -p.speed }[p.aim] ?? 0;
      vy = { down: p.speed, up: -p.speed }[p.aim] ?? 0;
    }
    s.wait = p.every;
    spawn(game, p.bullet, { x: cx - p.size / 2, y: cy - p.size / 2, w: p.size, h: p.size, vx, vy, ttl: p.life, drift: true, color: '#ffd23c',
      shape: 'circle' });
  },
  health(game, t, p, dt) {
    if (t.hp === undefined) { t.hp = p.hp; t.maxHp = p.hp; t.safeFor = p.safeFor; }
    if ((t.hurtLeft ?? 0) > 0) { t.hurtLeft = Math.max(0,
      t.hurtLeft - dt); t.alpha = Math.floor(t.hurtLeft * 12) % 2 ? 0.35 : 1; } else if (t.alpha !== undefined && t.alpha < 1 && t.hp > 0) t.alpha = 1;
    if (t.hp <= 0 && p.removeAtZero) despawn(game, t);
  },
  hurtOnTouch(game, t, p) {
    for (const other of all(game, p.target)) if (touching(t, other)) hurt(game, other, p.amount);
  },
  collect(game, t, p) {
    if (all(game, p.by).some((other) => touching(t, other))) { game.score = (game.score ?? 0) + p.score; despawn(game, t); }
  },
  lifetime(game, t, p, dt) {
    const s = state(t, 'lifetime');
    s.left = (s.left ?? p.seconds) - dt;
    if (s.left <= 0) despawn(game, t);
  },
};

/**
 * Run every behaviour: call it once a tick. Things get the behaviours of their `kind` (from `behaviors(...)`) and any of their own in `thing.behaviors`. Things made by
 * `shoot` fly on their own and are removed when their time (`ttl`) is up.
 * @param {object} game
 * @param {number} dt
 * @param {Set<string>} [keys] the keys held (for `shoot` with a key)
 */
export function behave(game, dt, keys) {
  pass++;
  for (const t of all(game)) {
    const list = [...(table[t.kind] ?? []), ...(Array.isArray(t.behaviors) ? t.behaviors.map(cleanBehavior).filter(Boolean) : [])];
    for (const spec of list) {
      if (!game.things.includes(t)) break;
      RUN[spec.type](game, t, spec, dt, keys);
    }
    if (t.drift && game.things.includes(t)) { t.x += t.vx * dt; t.y += t.vy * dt; }
    if (t.ttl !== undefined && game.things.includes(t)) { t.ttl -= dt; if (t.ttl <= 0) despawn(game, t); }
  }
}
