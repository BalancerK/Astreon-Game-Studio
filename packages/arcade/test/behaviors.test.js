import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, spawn, all, first } from '../src/things.js';
import { behaviors, behave, hurt, heal, cleanBehavior, behaviorProblems, BEHAVIORS } from '../src/behaviors.js';

const DT = 1 / 60;
const run = (game, seconds, keys) => { for (let i = 0; i < Math.round(seconds / DT); i++) behave(game, DT, keys); };
const copy = (x) => JSON.parse(JSON.stringify(x));

test('every behaviour has words, help, and settings that clean to themselves', () => {
  for (const [type, kind] of Object.entries(BEHAVIORS)) {
    assert.ok(kind.label && kind.help.length > 15 && Object.keys(kind.params).length, type);
    const clean = cleanBehavior({ type });
    assert.equal(clean.type, type);
    assert.deepEqual(cleanBehavior(clean), clean, `${type}: cleaning twice changes nothing`);
    assert.deepEqual(behaviorProblems([{ type }]), [], type);
  }
  assert.ok(Object.keys(BEHAVIORS).length >= 10);
});

test('settings are made safe: unknown types are dropped, numbers kept in range, choices and text checked', () => {
  assert.equal(cleanBehavior({ type: 'explode' }), null);
  assert.equal(cleanBehavior(null), null);
  const c = cleanBehavior({ type: 'shoot', every: -5, speed: 'fast', aim: 'sideways', bullet: 'x'.repeat(99), size: 9999, junk: 1 });
  assert.equal(c.every, 0.05);
  assert.equal(c.speed, 260);
  assert.equal(c.aim, 'right');
  assert.equal(c.bullet, 'bullet');
  assert.equal(c.size, 64);
  assert.ok(!('junk' in c));
  assert.equal(cleanBehavior({ type: 'health', removeAtZero: 'yes' }).removeAtZero, true);
  const problems = behaviorProblems([{ type: 'pace', speed: 99999 }, { type: 'pace' }, { type: 'nope' }]).map((p) => p.message);
  assert.equal(problems.length, 3);
  assert.ok(problems.some((m) => /twice/.test(m)) && problems.some((m) => /not a behaviour/.test(m)) && problems.some((m) => /kept to 600/.test(m)));
});

test('pace walks back and forth around where it started and faces the way it goes', () => {
  const g = newGame();
  behaviors({ walker: [{ type: 'pace', speed: 60, distance: 30 }] });
  const t = spawn(g, 'walker', { x: 100, y: 50 });
  const xs = [];
  for (let i = 0; i < 240; i++) { behave(g, DT); xs.push(t.x); }
  assert.ok(Math.max(...xs) <= 130.0001 && Math.min(...xs) >= 69.9999, `${Math.min(...xs)}..${Math.max(...xs)}`);
  assert.ok(Math.max(...xs) > 125 && Math.min(...xs) < 75, 'it goes the whole way each side');
  assert.equal(t.y, 50);
  assert.equal(typeof t.flip, 'boolean');
});

test('follow moves toward the nearest thing of a kind, only when near enough, and stops close to it', () => {
  const g = newGame();
  behaviors({ chaser: [{ type: 'follow', target: 'hero', speed: 100, range: 150, stopAt: 20 }] });
  const hero = spawn(g, 'hero', { x: 300, y: 100, w: 20, h: 20 });
  const far = spawn(g, 'chaser', { x: 0, y: 100, w: 20, h: 20 });
  run(g, 1);
  assert.equal(far.x, 0, 'out of range: it does not notice');
  const near = spawn(g, 'chaser', { x: 200, y: 100, w: 20, h: 20 });
  run(g, 0.5);
  assert.ok(near.x > 200 && near.x < 260, `${near.x}`);
  run(g, 3);
  assert.ok(Math.hypot(near.x - hero.x, near.y - hero.y) <= 20.5 && Math.hypot(near.x - hero.x, near.y - hero.y) > 15, 'it stops at its distance');
  assert.equal(near.flip, false);
  behaviors({ chaser: [{ type: 'follow', target: 'nobody' }] });
  const lost = spawn(g, 'chaser', { x: 5, y: 5 });
  assert.doesNotThrow(() => run(g, 0.2));
  assert.equal(lost.x, 5, 'nothing to follow: it stays');
});

test('wander and bounce stay on the screen, and are repeatable with the seeded random', () => {
  const play = () => {
    const g = newGame();
    behaviors({ w: [{ type: 'wander', speed: 200, changeEvery: 0.5 }], b: [{ type: 'bounce', speed: 400, angle: 30 }] });
    const w = spawn(g, 'w', { x: 10, y: 10, w: 16, h: 16 });
    const b = spawn(g, 'b', { x: 200, y: 100, w: 16, h: 16 });
    const path = [];
    for (let i = 0; i < 600; i++) {
      behave(g, DT);
      path.push([w.x, w.y, b.x, b.y]);
      assert.ok(w.x >= 0 && w.y >= 0 && w.x + 16 <= 480 && w.y + 16 <= 320, 'wander stays inside');
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + 16 <= 480 && b.y + 16 <= 320, 'bounce stays inside');
    }
    return path;
  };
  assert.deepEqual(play(), play());
  const g = newGame();
  behaviors({ b: [{ type: 'bounce', speed: 100, angle: 0 }] });
  const b = spawn(g, 'b', { x: 440, y: 100, w: 16, h: 16 });
  run(g, 1);
  assert.ok(b.x < 440, 'it turned round at the right edge');
});

test('shoot fires bullets that fly straight, at a rate, in a direction or at a target, only while a key is held if asked, and are removed after their time', () => {
  const g = newGame();
  behaviors({ gun: [{ type: 'shoot', bullet: 'shot', every: 0.5, speed: 200, aim: 'right', life: 1, size: 8 }] });
  const gun = spawn(g, 'gun', { x: 100, y: 100, w: 20, h: 20 });
  run(g, 2.01);
  const shots = all(g, 'shot');
  assert.ok(shots.length >= 2 && shots.length <= 3, `${shots.length} bullets alive (2 seconds, one every half second, each lasting 1)`);
  assert.ok(shots.every((s) => s.vx === 200 && s.vy === 0 && s.w === 8));
  assert.ok(shots[shots.length - 1].x > 110, 'they fly');
  behaviors({});
  assert.ok(gun.bs.shoot.wait >= 0, 'what it remembers is on the thing');
  run(g, 1.1);
  assert.equal(all(g, 'shot').length, 0, 'with no behaviours left, the bullets that were fired still fly and then go');
  const h = newGame();
  behaviors({ turret: [{ type: 'shoot', bullet: 'b', every: 0.2, aim: 'target', target: 'hero', speed: 100 }] });
  spawn(h, 'turret', { x: 0, y: 0, w: 10, h: 10 });
  run(h, 0.1);
  assert.equal(all(h, 'b').length, 0, 'no target: no shot');
  spawn(h, 'hero', { x: 200, y: 0, w: 10, h: 10 });
  run(h, 0.1);
  const b = first(h, 'b');
  assert.ok(b && Math.abs(b.vx - 100) < 1e-6 && Math.abs(b.vy) < 1e-6, 'aimed at the hero');
  const k = newGame();
  behaviors({ player: [{ type: 'shoot', bullet: 'bolt', every: 0.1, key: 'space' }] });
  spawn(k, 'player', { x: 0, y: 0 });
  run(k, 0.5, new Set());
  assert.equal(all(k, 'bolt').length, 0, 'key not held: no shots');
  run(k, 0.5, new Set(['Space']));
  assert.ok(all(k, 'bolt').length >= 4, 'key held: shots');
});

test('health: hurt takes points off, protects for a moment, flashes, and the thing is removed at 0; heal never goes over the start', () => {
  const g = newGame();
  behaviors({ foe: [{ type: 'health', hp: 3, safeFor: 0.5, removeAtZero: true }] });
  const foe = spawn(g, 'foe', {});
  behave(g, DT);
  assert.equal(foe.hp, 3);
  assert.equal(hurt(g, foe, 1), false);
  assert.equal(foe.hp, 2);
  assert.equal(hurt(g, foe, 1), false);
  assert.equal(foe.hp, 2, 'safe right after a hit');
  const alphas = new Set();
  for (let i = 0; i < 20; i++) { behave(g, DT); alphas.add(foe.alpha); }
  assert.ok(alphas.has(1) && [...alphas].some((a) => a < 1), 'it flashes while it is safe');
  run(g, 0.6);
  assert.equal(foe.alpha, 1, 'solid again');
  assert.equal(hurt(g, foe, 5), true, 'that was the end of it');
  behave(g, DT);
  assert.equal(all(g, 'foe').length, 0, 'removed at 0');
  const h = { hp: 1, maxHp: 3 };
  heal(h, 10);
  assert.equal(h.hp, 3);
  assert.equal(hurt(g, {}, 1), false, 'a thing without health is unaffected');
  const keep = newGame();
  behaviors({ boss: [{ type: 'health', hp: 1, removeAtZero: false }] });
  const boss = spawn(keep, 'boss', {});
  behave(keep, DT);
  hurt(keep, boss, 1);
  behave(keep, DT);
  assert.equal(all(keep, 'boss').length, 1, 'not removed when asked to stay');
});

test('hurtOnTouch hurts the other kind (which is safe for a moment after), and collect removes the coin and adds to the score', () => {
  const g = newGame();
  behaviors({ hero: [{ type: 'health', hp: 3, safeFor: 1 }], spike: [{ type: 'hurtOnTouch', target: 'hero', amount: 1 }], coin: [{ type: 'collect', by: 'hero', score: 5 }] });
  const hero = spawn(g, 'hero', { x: 0, y: 0, w: 20, h: 20 });
  spawn(g, 'spike', { x: 10, y: 10, w: 20, h: 20 });
  spawn(g, 'coin', { x: 5, y: 5, w: 10, h: 10 });
  spawn(g, 'coin', { x: 300, y: 5, w: 10, h: 10 });
  run(g, 0.5);
  assert.equal(hero.hp, 2, 'hurt once, then safe');
  assert.equal(g.score, 5);
  assert.equal(all(g, 'coin').length, 1, 'only the touched coin went');
  run(g, 1.2);
  assert.equal(hero.hp, 1, 'hurt again after the safe time');
});

test('lifetime removes a thing after its seconds; behaviours kept on one thing work too; everything lives on the things (plain data, copyable)', () => {
  const g = newGame();
  behaviors({});
  spawn(g, 'puff', { behaviors: [{ type: 'lifetime', seconds: 0.5 }] });
  const e = spawn(g, 'e', { x: 0, y: 0, behaviors: [{ type: 'pace', speed: 50, distance: 10 }, { type: 'bogus' }] });
  run(g, 0.3);
  assert.equal(all(g, 'puff').length, 1);
  const snapshot = copy(g);
  run(g, 0.4);
  assert.equal(all(g, 'puff').length, 0);
  assert.ok(e.x !== 0, 'its own behaviour ran, the bogus one was ignored');
  const again = copy(snapshot);
  run(again, 0.4);
  assert.equal(all(again, 'puff').length, 0, 'a saved copy carries on from where it was');
  assert.deepEqual(again.things.map((t) => t.x), g.things.map((t) => t.x), 'and ends in the same place');
});

test('patrol uses the ground logic of the kit and turns at a wall', () => {
  const g = newGame();
  behaviors({ walker: [{ type: 'patrol', speed: 80, solid: 'wall' }] });
  for (let x = 0; x < 200; x += 20) spawn(g, 'wall', { x, y: 100, w: 20, h: 20 });
  const w = spawn(g, 'walker', { x: 60, y: 80, w: 16, h: 20 });
  const xs = [];
  for (let i = 0; i < 300; i++) { behave(g, DT); xs.push(w.x); }
  assert.ok(Math.min(...xs) >= -1 && Math.max(...xs) <= 200, 'it stays on the ledge');
  assert.ok(Math.max(...xs) - Math.min(...xs) > 60, 'and walks along it');
});
