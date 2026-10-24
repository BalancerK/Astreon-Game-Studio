import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine, sfx } from '../src/index.js';
import { FakeContext } from './fake-context.js';

const make = (opts = {}, state) => { const ctx = new FakeContext(state); return { ctx, audio: new AudioEngine({ context: ctx, unlock: false, pauseWhenHidden: false, ...opts }) }; };
const tone = (audio, name = 'tone') => audio.createSound({ duration: 0.1, layers: [{ wave: 'sine', freq: 440 }] }, name);

test('the mixer: buses feed a master that feeds a limiter and the output; volume and mute per bus', () => {
  const { ctx, audio } = make();
  const master = audio.buses.get('master').node;
  const masterDuck = audio.buses.get('master').duck;
  assert.equal(master.to[0], masterDuck, 'a bus runs through its effects (none here) to its ducking gain');
  assert.equal(masterDuck.to[0].kind, 'compressor'); assert.equal(masterDuck.to[0].to[0].kind, 'shaper'); assert.equal(masterDuck.to[0].to[0].to[0], ctx.destination);
  for (const name of ['sfx', 'music', 'ui', 'voice']) { const b = audio.buses.get(name); assert.equal(b.node.to[0], b.duck); assert.equal(b.duck.to[0], master, `${name} goes to master`); }
  audio.setVolume('music', 0.4);
  assert.equal(audio.getVolume('music'), 0.4); assert.equal(audio.buses.get('music').node.gain.value, 0.4);
  audio.setMuted('music', true);
  assert.equal(audio.buses.get('music').node.gain.value, 0); assert.equal(audio.getVolume('music'), 0.4, 'the setting is kept');
  audio.setMuted('music', false);
  assert.equal(audio.buses.get('music').node.gain.value, 0.4);
  ctx.currentTime = 2;
  audio.setVolume('sfx', 0.2, 1.5);
  const ramp = audio.buses.get('sfx').node.gain.calls.find((c) => c[0] === 'ramp');
  assert.deepEqual(ramp, ['ramp', 0.2, 3.5], 'a fade is a ramp over the given time');
  assert.throws(() => audio.setVolume('nope', 1), /no bus named "nope"/);
  assert.throws(() => audio.setVolume('sfx', -1), /0 or more/);
  assert.throws(() => new AudioEngine({ context: new FakeContext(), unlock: false, buses: ['sfx', 'sfx'] }), /listed twice/);
  const custom = new AudioEngine({ context: new FakeContext(), unlock: false, buses: ['ambience'], compressor: false });
  assert.ok(custom.buses.has('ambience'));
  assert.equal(custom.buses.get('master').duck.to[0].kind, 'destination', 'no limiter when switched off');
});

test('sounds can be made from specs, PCM samples or decoded buffers, and loaded from files', async () => {
  const { ctx, audio } = make();
  const a = audio.createSound({ duration: 0.25, sampleRate: 8000, layers: [{ wave: 'sine' }] }, 'a');
  assert.equal(a.buffer.length, 2000); assert.equal(a.duration, 0.25); assert.equal(a.name, 'a');
  assert.ok(a.buffer.getChannelData(0).some((v) => v !== 0), 'the samples were copied into the buffer');
  const b = audio.createSound({ sampleRate: 4000, data: new Float32Array([0.1, 0.2, 0.3, 0.4]) }, 'b');
  assert.equal(b.buffer.length, 4);
  const decoded = ctx.createBuffer(2, 100, 1000);
  assert.equal(audio.createSound(decoded, 'c').buffer, decoded, 'an AudioBuffer is used as it is');
  assert.notEqual(a.key, b.key);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: url !== 'missing.ogg', status: 404, arrayBuffer: async () => new ArrayBuffer(500) });
  try {
    const loaded = await audio.load('boom.ogg', 'boom');
    assert.equal(loaded.name, 'boom'); assert.equal(loaded.duration, 0.5);
    const all = await audio.loadAll({ x: 'x.ogg', y: 'y.ogg' });
    assert.deepEqual(Object.keys(all), ['x', 'y']);
    await assert.rejects(() => audio.load('missing.ogg'), /could not load missing\.ogg \(404\)/);
  } finally { globalThis.fetch = realFetch; }
});

test('playing a sound builds source -> volume -> pan -> bus, cleans up when it ends, and respects the options', () => {
  const { ctx, audio } = make();
  const s = tone(audio);
  const ended = [];
  const v = audio.play(s, { bus: 'ui', volume: 0.6, pitch: 1.5, pan: -0.5, delay: 0.25, offset: 0.01, onEnded: () => ended.push(1) });
  const src = ctx.sources[0];
  assert.equal(src.buffer, s.buffer); assert.equal(src.playbackRate.value, 1.5); assert.deepEqual(src.starts[0], [0.25, 0.01]);
  const gain = src.to[0], panner = gain.to[0];
  assert.equal(gain.kind, 'gain'); assert.equal(gain.gain.value, 0.6); assert.equal(panner.kind, 'panner'); assert.equal(panner.pan.value, -0.5);
  assert.equal(panner.to[0], audio.buses.get('ui').node, 'it plays on the bus asked for');
  assert.equal(audio.activeVoices, 1); assert.equal(audio.stats.played, 1); assert.ok(v.playing);
  src.finish();
  assert.ok(!v.playing); assert.equal(audio.activeVoices, 0); assert.equal(audio.pool.size, 0); assert.deepEqual(ended, [1]);
  assert.ok(src.disconnected && gain.disconnected, 'its nodes are released');
  src.finish(); assert.deepEqual(ended, [1], 'ending twice does nothing');
  assert.equal(audio.play(null), null);
  const looped = audio.play(s, { loop: true, fadeIn: 2 });
  assert.equal(ctx.sources[1].loop, true);
  assert.equal(ctx.sources[1].to[0].gain.calls.find((c) => c[0] === 'ramp')[1], 1, 'a fade-in ramps up to the volume');
  const jitter = new Set();
  for (let i = 0; i < 20; i++) { audio.play(s, { pitchVariation: 0.1 }); jitter.add(ctx.sources[ctx.sources.length - 1].playbackRate.value); }
  assert.ok(jitter.size > 5 && [...jitter].every((p) => p >= 0.9 && p <= 1.1), 'pitch variation stays within its bounds');
  assert.throws(() => audio.play(s, { bus: 'nope' }), /no bus/);
  void looped;
});

test('voices can be changed and stopped; stopping with a fade ramps out then stops', () => {
  const { ctx, audio } = make();
  const v = audio.play(tone(audio), { loop: true, volume: 0.8 });
  const src = ctx.sources[0], gain = src.to[0];
  ctx.currentTime = 10;
  v.setVolume(0.2, 2);
  assert.deepEqual(gain.gain.calls.slice(-1)[0], ['ramp', 0.2, 12]);
  v.setPitch(2);
  assert.equal(src.playbackRate.value, 2);
  v.setPan(0.7);
  assert.equal(gain.to[0].pan.value, 0.7);
  v.stop(1.5);
  assert.deepEqual(gain.gain.calls.slice(-1)[0], ['ramp', 0, 11.5], 'fades to nothing...');
  assert.ok(Math.abs(src.stops[0] - 11.52) < 1e-9, '...then stops just after');
  const w = audio.play(tone(audio));
  w.stop();
  assert.equal(ctx.sources[1].stops[0], 10, 'no fade: stop now');
  audio.stopAll(undefined, 0);
  assert.ok(ctx.sources.every((s) => s.stops.length > 0));
});

test('positioned sounds: loudness from distance, panning from direction, culled when out of earshot, updated as things move', () => {
  const { ctx, audio } = make();
  const s = tone(audio);
  audio.setListener(0, 0, 0, 0);
  const v = audio.play(s, { position: [10, 0, 0], refDistance: 1, maxDistance: 50 });
  const src = ctx.sources[0], user = src.to[0], spatial = user.to[0], panner = spatial.to[0];
  assert.equal(spatial.kind, 'gain'); assert.ok(Math.abs(spatial.gain.value - 1 / 10) < 1e-9, 'inverse distance: a tenth at 10 m'); assert.ok(panner.pan.value > 0.95, 'to the right');
  assert.equal(audio.play(s, { position: [60, 0, 0], maxDistance: 50 }), null, 'too far to hear: not started');
  assert.equal(audio.stats.culled, 1);
  v.setPosition(-20, 0, 0);
  ctx.currentTime = 5;
  audio.update();
  const target = (p) => p.calls.slice(-1)[0];
  assert.deepEqual(target(spatial.gain).slice(0, 3), ['target', 1 / 20, 5]); assert.ok(target(panner.pan)[1] < -0.95, 'now on the left');
  audio.setListener(-20, 0, 0, 0);
  audio.update();
  assert.ok(Math.abs(target(spatial.gain)[1] - 1) < 1e-9, 'standing on it: full volume'); assert.ok(Math.abs(target(panner.pan)[1]) < 0.01);
  audio.setListener(0, 0, 0, Math.PI); // turned around
  v.setPosition(10, 0, 0);
  audio.update();
  assert.ok(target(panner.pan)[1] < -0.95, 'what was on the right is now on the left');
  const plain = audio.play(s);
  assert.equal(ctx.sources[ctx.sources.length - 1].to[0].to[0].kind, 'panner', 'unpositioned sounds have no distance stage');
  void plain;
});

test('voice limits: priorities decide who is stopped, per-sound caps keep a machine gun from taking every slot', () => {
  const { ctx, audio } = make({ maxVoices: 2 });
  const s = tone(audio, 'a'), t = tone(audio, 'b');
  const v1 = audio.play(s, { priority: 0 }), v2 = audio.play(t, { priority: 1 });
  const v3 = audio.play(t, { priority: 2 });
  assert.ok(v3);
  assert.ok(ctx.sources[0].stops.length === 1, 'the lowest priority voice was stopped to make room');
  assert.equal(audio.stats.stolen, 1);
  ctx.sources[0].finish();
  assert.equal(audio.play(s, { priority: -5 }), null, 'less important than everything playing: not started');
  assert.equal(audio.stats.denied, 1);
  void v2;
  const { ctx: c2, audio: a2 } = make();
  const shot = tone(a2, 'shot');
  for (let i = 0; i < 5; i++) a2.play(shot, { maxPerSound: 2 });
  assert.equal(c2.sources.filter((x) => x.stops.length === 0).length, 2, 'only two shots are left sounding');
});

test('before the page is allowed to make noise: one-shots are skipped, music waits, and the first gesture starts it', async () => {
  const { ctx, audio } = make({}, 'suspended');
  const s = tone(audio);
  assert.equal(audio.state, 'suspended');
  assert.equal(audio.play(s), null); assert.equal(audio.stats.skipped, 1);
  assert.ok(audio.play(s, { loop: true }), 'a looping sound is kept waiting');
  await audio.resume();
  assert.equal(audio.state, 'running');
  assert.ok(audio.play(s));
  const offline = make({ skipWhenSuspended: false }, 'suspended');
  assert.ok(offline.audio.play(tone(offline.audio)), 'unless told otherwise (offline rendering)');
  // the gesture hook
  const events = new Map();
  const target = { addEventListener: (e, h) => events.set(e, h), removeEventListener: (e) => events.delete(e) };
  const g = make({}, 'suspended');
  g.audio.unlockOnGesture(target);
  assert.deepEqual([...events.keys()].sort(), ['click', 'keydown', 'mousedown', 'pointerdown', 'pointerup', 'touchend']);
  events.get('pointerdown')({ type: 'pointerdown', pointerType: 'touch' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(g.audio.state, 'suspended', 'a finger landing is not yet a gesture the browser accepts');
  events.get('keydown')();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(g.audio.state, 'running');
  assert.equal(events.size, 0, 'the listeners remove themselves once audio runs');
});

test('music: one track at a time, cross-fading; asking for the same track again changes nothing', () => {
  const { ctx, audio } = make();
  const a = tone(audio, 'a'), b = tone(audio, 'b');
  const m1 = audio.playMusic(a, { volume: 0.5, fade: 2 });
  assert.equal(ctx.sources[0].loop, true); assert.equal(ctx.sources[0].to[0].to[0].to[0], audio.buses.get('music').node, 'on the music bus');
  assert.equal(audio.playMusic(a), m1); assert.equal(ctx.sources.length, 1);
  ctx.currentTime = 4;
  const m2 = audio.playMusic(b, { volume: 0.5, fade: 2 });
  assert.notEqual(m2, m1);
  assert.ok(ctx.sources[0].stops.length === 1 && Math.abs(ctx.sources[0].stops[0] - 6.02) < 1e-9, 'the old track fades out over the same time');
  ctx.sources[0].finish();
  assert.equal(audio.music, m2, 'the finishing old track does not forget the new one');
  audio.stopMusic(1);
  assert.equal(audio.music, null);
  assert.ok(ctx.sources[1].stops.length === 1);
});

test('stopAll by bus, and dispose releases everything', () => {
  const { ctx, audio } = make();
  audio.play(tone(audio), { bus: 'sfx' }); audio.play(tone(audio), { bus: 'ui' }); audio.play(tone(audio), { bus: 'ui' });
  audio.stopAll('ui');
  assert.deepEqual(ctx.sources.map((s) => s.stops.length), [0, 1, 1]);
  const owned = new AudioEngine({ context: ctx, unlock: false, pauseWhenHidden: false });
  owned.ownsContext = true;
  owned.dispose();
  assert.ok(ctx.closed, 'a context the engine made is closed');
  assert.ok(sfx.shot, 'presets are exported');
});
