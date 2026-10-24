import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../../../packages/audio/src/index.js';
import { FakeContext } from '../../../packages/audio/test/fake-context.js';
import { StepCounter, createArenaAudio } from '../client/sound.js';

const setup = () => {
  const ctx = new FakeContext();
  const engine = new AudioEngine({ context: ctx, unlock: false, pauseWhenHidden: false });
  const arena = createArenaAudio({ engine, random: () => 0.5 });
  const played = () => ctx.sources.map((s) => ({ s, bus: s.to[0].to.at(-1).to[0], gain: s.to[0].gain.value, positioned: s.to[0].to[0].kind === 'gain' }));
  return { ctx, engine, arena, played };
};

test('footsteps: one per stride walked on the ground, none in the air, none for a teleport', () => {
  const c = new StepCounter(2);
  assert.equal(c.update(0, 0, true), false, 'the first sighting only records the position');
  let steps = 0;
  for (let i = 1; i <= 100; i++) if (c.update(0, i * 0.1, true)) steps++; // 10 m
  assert.equal(steps, 5, 'ten metres at a 2 m stride');
  steps = 0;
  for (let i = 1; i <= 50; i++) if (c.update(0, 10 + i * 0.1, false)) steps++;
  assert.equal(steps, 0, 'no steps while airborne');
  assert.equal(c.update(50, 50, true), false, 'a jump of tens of metres (respawn) is not walking');
  const slow = new StepCounter(2); slow.update(0, 0, true);
  let n = 0; for (let i = 1; i <= 20; i++) if (slow.update(i * 0.1, 0, true)) n++;
  assert.equal(n, 1, 'standing nearly still gives almost none');
});

test('shots, hits and messages use the right bus, place other players\' shots in the world and keep your own centred', () => {
  const { engine, arena, played, ctx } = setup();
  arena.ownShot();
  arena.shotAt(10, 1, -5);
  arena.hitConfirm();
  arena.impact(3, 0, 3);
  arena.message();
  arena.hurt();
  const p = played();
  assert.equal(p.length, 6);
  assert.deepEqual(p.map((x) => x.positioned), [false, true, false, true, false, false], 'only other players\' shots and impacts are positioned');
  assert.equal(p[2].bus, engine.buses.get('ui').node, 'the hit marker is a UI sound'); assert.equal(p[4].bus, engine.buses.get('ui').node);
  assert.equal(p[0].bus, engine.buses.get('sfx').node);
  assert.ok(p[5].s.playbackRate.value < 0.7, 'the hurt sound is pitched down');
  void ctx;
});

test('your own movement: steps on the ground, a jump sound leaving it, a landing sound scaled by the fall; nothing for a tiny drop', () => {
  const { arena, played } = setup();
  arena.selfMove(0, 0, true, 0);
  for (let i = 1; i <= 40; i++) arena.selfMove(0, -i * 0.1, true, 0); // 4 m: two steps at 1.6 m
  assert.equal(played().length, 2);
  arena.selfMove(0, -4, false, 7); // leaves the ground rising
  assert.equal(played().length, 3, 'jump');
  arena.selfMove(0, -4, false, -2);
  arena.selfMove(0, -4, true, 0); // landed after a small fall
  assert.equal(played().length, 3, 'a short fall makes no landing sound');
  arena.selfMove(0, -4, false, 0); // walked off a ledge: no jump (not rising)
  assert.equal(played().length, 3);
  arena.selfMove(0, -4, false, -12);
  arena.selfMove(0, -4, true, 0);
  assert.equal(played().length, 4, 'a long fall lands with a thud');
  assert.ok(played()[3].gain > 0.5, 'and it is loud');
});

test('other players\' footsteps are placed at their feet and forgotten when they leave', () => {
  const { arena, played } = setup();
  arena.otherMove(7, 0, 0, 0, true);
  for (let i = 1; i <= 40; i++) arena.otherMove(7, i * 0.1, 0, 0, true);
  const steps = played();
  assert.equal(steps.length, 2);
  assert.ok(steps.every((s) => s.positioned), 'placed in the world');
  arena.forget(new Set());
  arena.otherMove(7, 100, 0, 0, true); // after being forgotten, the first sighting starts afresh
  assert.equal(played().length, 2);
});

test('health: a grunt only when it goes down; the listener follows the camera; music loops and mutes', () => {
  const { arena, played, engine } = setup();
  arena.watchHealth(100); arena.watchHealth(100); arena.watchHealth(100.2);
  assert.equal(played().length, 0);
  arena.watchHealth(75);
  assert.equal(played().length, 1);
  arena.watchHealth(100); // healed: silent
  assert.equal(played().length, 1);
  arena.update({ x: 4, y: 1.6, z: -2, yaw: Math.PI / 2, pitch: 0 });
  assert.deepEqual([engine.listener.x, engine.listener.y, engine.listener.z], [4, 1.6, -2]);
  assert.ok(Math.abs(engine.listener.fx + 1) < 1e-9, 'turned left: facing -x');
  arena.startMusic();
  const music = played().at(-1).s;
  assert.equal(music.loop, true);
  arena.startMusic();
  assert.equal(played().length, 2, 'asking again does not start a second copy');
  assert.equal(arena.toggleMusic(), true); assert.equal(engine.isMuted('music'), true);
  assert.equal(arena.toggleMusic(), false);
  assert.equal(arena.toggleMute(), true); assert.equal(engine.isMuted('master'), true);
});
