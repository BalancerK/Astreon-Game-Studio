import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesize, sfx, sequence, ambientLoop, noteFrequency, createListener, setListenerFromYawPitch, spatialize, distanceGain, VoicePool } from '../src/index.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const crossings = (data, from = 0, to = data.length) => { let n = 0; for (let i = from + 1; i < to; i++) if ((data[i - 1] < 0) !== (data[i] < 0)) n++; return n; };
const rms = (data, from = 0, to = data.length) => { let s = 0; for (let i = from; i < to; i++) s += data[i] * data[i]; return Math.sqrt(s / (to - from)); };

test('a sine layer has the pitch it was asked for, and a seed gives the same sound every time', () => {
  const a = synthesize({ duration: 0.5, sampleRate: 44100, layers: [{ wave: 'sine', freq: 440, decay: 10 }] });
  assert.equal(a.data.length, 22050);
  near(crossings(a.data) / 2 / 0.5, 440, 12, 'Hz measured from zero crossings');
  const n1 = synthesize({ duration: 0.1, seed: 4, layers: [{ wave: 'noise', decay: 1 }] }), n2 = synthesize({ duration: 0.1, seed: 4, layers: [{ wave: 'noise', decay: 1 }] }), n3 = synthesize({ duration: 0.1, seed: 5, layers: [{ wave: 'noise', decay: 1 }] });
  assert.deepEqual(n1.data, n2.data); assert.notDeepEqual(n1.data, n3.data);
});

test('envelopes, glides, filters, layers and the peak limit', () => {
  const dec = synthesize({ duration: 0.4, layers: [{ wave: 'sine', freq: 300, decay: 0.05 }] });
  assert.ok(rms(dec.data, 0, 4000) > rms(dec.data, 8000, 12000) * 5, 'it dies away');
  assert.ok(Math.abs(dec.data[dec.data.length - 1]) < 1e-3, 'and ends silent (no click)');
  assert.equal(dec.data[0], 0, 'and starts at zero');
  const glide = synthesize({ duration: 0.6, layers: [{ wave: 'sine', freq: 1200, freqEnd: 200, decay: 5 }] });
  assert.ok(crossings(glide.data, 0, 8000) > crossings(glide.data, 18000, 26000) * 1.5, 'pitch falls over time');
  const bright = synthesize({ duration: 0.2, seed: 2, layers: [{ wave: 'noise', decay: 5 }] }), dull = synthesize({ duration: 0.2, seed: 2, layers: [{ wave: 'noise', lowpass: 300, decay: 5 }] });
  assert.ok(crossings(dull.data) < crossings(bright.data) / 3, 'a low-pass filter calms the noise down');
  const loud = synthesize({ duration: 0.1, gain: 5, layers: [{ wave: 'square', freq: 200, decay: 5 }], peak: 0.8 });
  near(Math.max(...loud.data.map(Math.abs)), 0.8, 1e-6, 'peak limited');
  const later = synthesize({ duration: 0.4, layers: [{ wave: 'sine', freq: 500, start: 0.3, decay: 1 }] });
  assert.equal(rms(later.data, 0, 10000), 0, 'a layer that starts later leaves the beginning silent');
  assert.ok(rms(later.data, 14000, 17000) > 0.1);
  for (const wave of ['square', 'saw', 'triangle']) assert.ok(rms(synthesize({ duration: 0.05, layers: [{ wave, freq: 220, decay: 1 }] }).data) > 0.1, wave);
  assert.throws(() => synthesize({ duration: 0 }), /duration/);
  assert.throws(() => synthesize({ sampleRate: 100 }), /sampleRate/);
  assert.throws(() => synthesize({ layers: [{ wave: 'harp' }] }), /unknown wave/);
});

test('the built-in sound effects are all audible, in range, and varied where they should be', () => {
  for (const [name, make] of Object.entries(sfx)) {
    const { data } = synthesize(make(1));
    assert.ok(data.every(Number.isFinite), `${name}: finite`);
    const peak = Math.max(...data.map(Math.abs));
    assert.ok(peak > 0.2 && peak <= 0.9 + 1e-6, `${name}: audible but not clipping (${peak.toFixed(2)})`);
    assert.ok(Math.abs(data[data.length - 1]) < 1e-3, `${name}: ends silent`);
  }
  assert.notDeepEqual(synthesize(sfx.footstep(1)).data, synthesize(sfx.footstep(2)).data, 'footsteps vary');
});

test('notes and sequences: frequencies, exact length, and a seamless loop', () => {
  near(noteFrequency('A4'), 440, 1e-9); near(noteFrequency('C4'), 261.6256, 1e-3); near(noteFrequency('A3'), 220, 1e-9); near(noteFrequency('Bb2'), noteFrequency('A#2'), 1e-9);
  assert.throws(() => noteFrequency('H4'), /not a note/); assert.throws(() => noteFrequency('A'), /not a note/);
  const tune = sequence({ bpm: 120, sampleRate: 8000, tracks: [{ wave: 'sine', notes: [['A4', 2], [null, 1], ['E5', 1]] }] });
  assert.equal(tune.data.length, 4 * 0.5 * 8000, 'four beats at 120 bpm is two seconds');
  assert.ok(rms(tune.data, 0, 3000) > 0.05 && rms(tune.data, 9000, 11000) < 1e-3 && rms(tune.data, 12000, 15000) > 0.05, 'note, rest, note');
  const loop = ambientLoop(22050);
  assert.equal(loop.data.length, 8 * 22050, 'eight seconds');
  assert.ok(Math.abs(loop.data[0]) < 0.02 && Math.abs(loop.data[loop.data.length - 1]) < 0.02, 'the ends meet at silence, so it loops without a click');
  assert.ok(loop.data.every(Number.isFinite) && loop.data.reduce((m, v) => Math.max(m, Math.abs(v)), 0) <= 0.85 + 1e-6);
});

test('distance fall-off: three models, a smooth cut at the maximum, and bad input', () => {
  const o = { refDistance: 2, maxDistance: 100, rolloff: 1 };
  assert.equal(distanceGain(1, o), 1, 'closer than the reference distance: full volume');
  near(distanceGain(4, o), 2 / (2 + 2), 1e-9, 'inverse: half at twice the reference... plus offset');
  near(distanceGain(10, { ...o, model: 'inverse' }), 2 / (2 + 8), 1e-9);
  near(distanceGain(52, { ...o, model: 'linear' }), 1 - 50 / 98, 1e-9);
  near(distanceGain(8, { ...o, model: 'exponential', rolloff: 2 }), 1 / 16, 1e-9, 'exponential: (d / ref)^-rolloff');
  assert.equal(distanceGain(100, o), 0, 'silent at the maximum distance');
  assert.equal(distanceGain(500, o), 0);
  assert.ok(distanceGain(95, o) < distanceGain(75, o) && distanceGain(95, o) > 0, 'a smooth fade over the last fifth, no pop');
  assert.throws(() => distanceGain(1, { model: 'cubic' }), /unknown distance model/);
  for (let d = 0; d < 200; d += 7) assert.ok(distanceGain(d, { model: 'linear', maxDistance: 80 }) >= 0);
});

test('panning follows where the source is relative to which way the listener faces', () => {
  const l = createListener();
  const pan = (x, y, z, o) => spatialize(l, x, y, z, o).pan;
  assert.ok(pan(5, 0, 0) > 0.95, 'to the right');
  assert.ok(pan(-5, 0, 0) < -0.95, 'to the left');
  near(pan(0, 0, -5), 0, 1e-9, 'straight ahead'); near(pan(0, 0, 5), 0, 1e-9, 'straight behind'); near(pan(0, 5, 0), 0, 1e-9, 'straight above');
  near(pan(5, 0, -5), Math.SQRT1_2, 1e-6, 'front right at 45 degrees');
  setListenerFromYawPitch(l, 0, 0, 0, Math.PI / 2); // turned left: now facing -x
  near(pan(-5, 0, 0), 0, 1e-6, 'what was to the left is now ahead'); assert.ok(pan(0, 0, -5) > 0.95, 'and what was ahead is now to the right');
  setListenerFromYawPitch(l, 10, 0, 10, 0);
  assert.ok(pan(15, 0, 10) > 0.95, 'the listener position matters');
  setListenerFromYawPitch(l, 0, 0, 0, 0, 0.8); // looking up does not swap left and right
  assert.ok(pan(5, 0, 0) > 0.9);
  setListenerFromYawPitch(l, 0, 0, 0, 0);
  assert.equal(pan(0, 0, 0), 0, 'a source on the listener has no direction');
  assert.ok(Math.abs(pan(0.05, 0, 0)) < 0.5, 'a source almost on top of the listener eases to the centre instead of flipping');
  const s = spatialize(l, 3, 4, 0, { refDistance: 1, maxDistance: 50 });
  near(s.distance, 5, 1e-9); near(s.gain, 1 / 5, 1e-9);
});

test('the voice pool: a cap with priorities, oldest first among equals, and a limit per sound', () => {
  const pool = new VoicePool({ max: 3 });
  const a = pool.request({ key: 'x', priority: 0, now: 1 }), b = pool.request({ key: 'x', priority: 5, now: 2 }), c = pool.request({ key: 'y', priority: 0, now: 3 });
  assert.ok(a.granted && b.granted && c.granted && !a.steal);
  const d = pool.request({ key: 'z', priority: 1, now: 4 }); // full: the oldest lowest-priority voice (a) gives way
  assert.ok(d.granted); assert.equal(d.steal.id, a.id); assert.equal(pool.size, 3);
  const e = pool.request({ key: 'w', priority: -1, now: 5 }); // less important than everything running: refused
  assert.ok(!e.granted && !e.steal);
  const f = pool.request({ key: 'w', priority: 5, now: 6 }); // equal to the best: steals the weakest (c, priority 0)
  assert.ok(f.granted); assert.equal(f.steal.id, c.id);
  assert.ok(pool.release(b.id) && !pool.release(b.id));
  const per = new VoicePool({ max: 10 });
  const s1 = per.request({ key: 'shot', maxPerSound: 2, now: 1 }), s2 = per.request({ key: 'shot', maxPerSound: 2, now: 2 }), s3 = per.request({ key: 'shot', maxPerSound: 2, now: 3 });
  assert.ok(s3.granted && s3.steal.id === s1.id, 'the third shot replaces the oldest of its own kind');
  assert.equal(per.size, 2);
  const other = per.request({ key: 'other', maxPerSound: 2, now: 4 });
  assert.ok(other.granted && !other.steal, 'other sounds are unaffected');
  const high = new VoicePool({ max: 1 }); high.request({ key: 'a', priority: 9 });
  assert.ok(!high.request({ key: 'b', priority: 1 }).granted);
  assert.throws(() => new VoicePool({ max: 0 }), /at least 1/);
  void s2;
});
