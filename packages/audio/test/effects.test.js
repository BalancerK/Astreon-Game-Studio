import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine, lowpass, highpass, filter, reverb, echo, compressor, reverbImpulse, occlusionFrequency } from '../src/index.js';
import { FakeContext } from './fake-context.js';

const make = () => { const ctx = new FakeContext(); return { ctx, audio: new AudioEngine({ context: ctx, unlock: false, pauseWhenHidden: false }) }; };
const sound = (audio) => audio.createSound({ sampleRate: 1000, data: new Float32Array(500) });

test('effects sit between a bus and its ducking gain, in the order added; off means bypassed', () => {
  const { audio } = make();
  const bus = audio.buses.get('sfx');
  const lp = audio.addEffect('sfx', lowpass(800)), hp = audio.addEffect('sfx', highpass(100));
  assert.equal(bus.node.to[0], lp.built.input);
  assert.equal(lp.built.output.to[0], hp.built.input);
  assert.equal(hp.built.output.to[0], bus.duck);
  assert.deepEqual(audio.effects('sfx').map((e) => e.kind), ['lowpass', 'highpass']);
  lp.enabled = false;
  assert.equal(bus.node.to[0], hp.built.input, 'the filter is skipped');
  assert.equal(lp.enabled, false);
  lp.enabled = true;
  assert.equal(bus.node.to[0], lp.built.input);
  lp.remove();
  assert.equal(bus.node.to[0], hp.built.input);
  assert.equal(audio.effects('sfx').length, 1);
  hp.remove();
  assert.equal(bus.node.to[0], bus.duck, 'back to straight through');
});

test('an effect can be changed while it plays, gliding over a time', () => {
  const { ctx, audio } = make();
  const lp = audio.addEffect('music', lowpass(5000, 1));
  const f = lp.built.nodes[0];
  assert.equal(f.type, 'lowpass'); assert.equal(f.frequency.value, 5000);
  ctx.currentTime = 4;
  lp.set({ frequency: 300 }, 2);
  assert.deepEqual(f.frequency.calls.find((c) => c[0] === 'ramp'), ['ramp', 300, 6]);
  lp.set({ q: 3 });
  assert.equal(f.Q.value, 3);
});

test('every effect kind builds, and bad ones are named', () => {
  const { audio } = make();
  for (const e of [lowpass(), highpass(), filter('peaking', 1000, { gain: 6 }), filter('notch', 60), reverb({ seconds: 0.5 }), echo({ time: 0.2 }), compressor()]) audio.addEffect('ui', e);
  assert.equal(audio.effects('ui').length, 7);
  assert.throws(() => filter('wobble'), /filter type must be one of/);
  assert.throws(() => audio.addEffect('ui', { kind: 'flange' }), /unknown effect "flange"/);
  assert.throws(() => audio.addEffect('nope', lowpass()), /no bus named/);
  const master = audio.addEffect('master', lowpass(9000));
  assert.equal(audio.buses.get('master').node.to[0], master.built.input, 'master takes effects too');
});

test('the reverb impulse decays by 60 dB, is the same every time, is stereo, and is damped', () => {
  const a = reverbImpulse(8000, 1, 0.5, 3), b = reverbImpulse(8000, 1, 0.5, 3), other = reverbImpulse(8000, 1, 0.5, 4);
  assert.deepEqual(a[0], b[0]); assert.notDeepEqual(a[0], other[0]); assert.notDeepEqual(a[0], a[1]);
  const rms = (x, from, to) => { let e = 0; for (let i = from; i < to; i++) e += x[i] * x[i]; return Math.sqrt(e / (to - from)); };
  const early = rms(a[0], 200, 1000), late = rms(a[0], 7000, 8000);
  assert.ok(late < early / 30, `the tail fades: ${early} to ${late}`);
  // damping: a damped tail has fewer fast changes (less high-frequency energy) than an undamped one
  const roughness = (x) => { let e = 0; for (let i = 1; i < x.length; i++) e += (x[i] - x[i - 1]) ** 2; return e / (rms(x, 0, x.length) ** 2 * x.length); };
  assert.ok(roughness(reverbImpulse(8000, 1, 0.9, 1)[0]) < roughness(reverbImpulse(8000, 1, 0, 1)[0]));
});

test('ducking: the target dips while the trigger bus plays, holds, then recovers', () => {
  const { ctx, audio } = make();
  const music = audio.buses.get('music').duck.gain;
  const rule = audio.addDuck({ target: 'music', trigger: 'voice', amount: 0.25, attack: 0.06, release: 0.9, hold: 0.2 });
  const say = sound(audio);
  const v = audio.play(say, { bus: 'voice' });
  const dip = music.calls.filter((c) => c[0] === 'target').pop();
  assert.deepEqual(dip, ['target', 0.25, 0, 0.02], 'dips at once with a time constant of attack / 3');
  const v2 = audio.play(say, { bus: 'voice' });
  ctx.sources[0].finish();
  assert.equal(music.calls.filter((c) => c[0] === 'target').pop()[1], 0.25, 'still ducked while the second line plays');
  ctx.currentTime = 1;
  ctx.sources[1].finish();
  const up = music.calls.filter((c) => c[0] === 'target').pop();
  assert.equal(up[1], 1); assert.equal(up[2], 1.2, 'recovers after the hold'); assert.ok(Math.abs(up[3] - 0.3) < 1e-9);
  void v; void v2;
  rule.remove();
  assert.equal(audio.duckRules.length, 0);
  assert.throws(() => audio.addDuck({ target: 'music', trigger: 'voice', amount: 2 }), /fraction/);
  assert.throws(() => audio.addDuck({ target: 'nope', trigger: 'voice' }), /no bus named/);
});

test('two ducking rules on one target: the quietest wins', () => {
  const { audio } = make();
  audio.addDuck({ target: 'music', trigger: 'voice', amount: 0.5 });
  audio.addDuck({ target: 'music', trigger: 'ui', amount: 0.2 });
  const s = sound(audio);
  audio.play(s, { bus: 'voice' });
  assert.equal(audio.buses.get('music').duckLevel, 0.5);
  audio.play(s, { bus: 'ui' });
  assert.equal(audio.buses.get('music').duckLevel, 0.2);
});

test('occlusion dulls and quietens a voice, from the start or later, and is undone with 0', () => {
  const { ctx, audio } = make();
  assert.ok(occlusionFrequency(0) > 21000 && occlusionFrequency(1) < 500 && occlusionFrequency(0.5) > occlusionFrequency(1));
  const s = sound(audio);
  const walled = audio.play(s, { occlusion: 1 });
  assert.ok(walled.occ && walled.occ.frequency.value < 500);
  assert.ok(Math.abs(walled.occGain.gain.value - 0.5) < 1e-9);
  assert.equal(walled.gain.to[0], walled.occ, 'the voice runs through the filter');
  const clear = audio.play(s);
  assert.equal(clear.occ, null, 'no filter unless asked for');
  clear.setOcclusion(0);
  assert.equal(clear.occ, null, 'asking for none costs nothing');
  ctx.currentTime = 1;
  clear.setOcclusion(0.6, 0.5);
  assert.ok(clear.occ, 'made when first needed');
  assert.deepEqual(clear.occ.frequency.calls.find((c) => c[0] === 'ramp').slice(0, 1), ['ramp']);
  walled.setOcclusion(0);
  assert.ok(walled.occ.frequency.value > 21000);
  ctx.sources[0].finish();
  assert.equal(walled.occ.to.length, 0, 'cleaned up when it ends');
});
