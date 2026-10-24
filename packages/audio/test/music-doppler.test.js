import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine, LayeredMusic, createListener, dopplerRatio } from '../src/index.js';
import { FakeContext } from './fake-context.js';

const make = () => { const ctx = new FakeContext(); return { ctx, audio: new AudioEngine({ context: ctx, unlock: false, pauseWhenHidden: false }) }; };
const tone = (audio, seconds, name) => audio.createSound({ duration: seconds, sampleRate: 8000, layers: [{ wave: 'sine', freq: 440 }] }, name);

test('Doppler: toward you is higher, away is lower, sideways is unchanged, and it is held to an octave either way', () => {
  const l = createListener();
  assert.ok(dopplerRatio(l, [0, 0, 0], [0, 0, -100], [0, 0, 60]) > 1.15, 'coming at the listener');
  assert.ok(dopplerRatio(l, [0, 0, 0], [0, 0, -100], [0, 0, -60]) < 0.88, 'going away');
  assert.ok(Math.abs(dopplerRatio(l, [0, 0, 0], [0, 0, -100], [60, 0, 0]) - 1) < 1e-9, 'across the line of sight');
  assert.ok(dopplerRatio(l, [0, 0, -40], [0, 0, -100], [0, 0, 0]) > 1.1, 'the listener moving toward a still source');
  assert.equal(dopplerRatio(l, [0, 0, 0], [0, 0, -100], [0, 0, 5000]), 2);
  assert.ok(dopplerRatio(l, [0, 0, 0], [0, 0, -100], [0, 0, 60], 343, 0.5) < dopplerRatio(l, [0, 0, 0], [0, 0, -100], [0, 0, 60]), 'a weaker strength shifts less');
  assert.equal(dopplerRatio(l, [0, 0, 0], [0, 0, -100], [0, 0, 60], 343, 0), 1);
});

test('a voice with a velocity has its pitch shifted every update, and keeps the pitch it was given underneath', () => {
  const { ctx, audio } = make();
  audio.setListener(0, 0, 0, 0);
  const v = audio.play(tone(audio, 1, 'engine'), { position: [0, 0, -80], maxDistance: 500, velocity: [0, 0, 70], pitch: 1 });
  audio.update();
  const rate = ctx.sources[0].playbackRate;
  assert.ok(rate.value > 1.2, `approaching: ${rate.value}`);
  v.setVelocity(0, 0, -70); audio.update();
  assert.ok(rate.value < 0.85, `leaving: ${rate.value}`);
  v.setPitch(2); v.setVelocity(0, 0, 0); audio.update();
  assert.ok(Math.abs(rate.value - 2) < 1e-9, 'the base pitch is kept');
  audio.setListenerVelocity(0, 0, -50); v.setPitch(1); audio.update();
  assert.ok(rate.value > 1.1, 'the listener moving at it');
});

test('absorption: the air dulls a sound more the further it is, and a wall adds to it', () => {
  const { ctx, audio } = make();
  audio.setListener(0, 0, 0, 0);
  const near = audio.play(tone(audio, 1, 'a'), { position: [0, 0, -40], maxDistance: 400, refDistance: 20, absorption: 1 });
  const far = audio.play(tone(audio, 1, 'b'), { position: [0, 0, -350], maxDistance: 400, refDistance: 20, absorption: 1 });
  const none = audio.play(tone(audio, 1, 'c'), { position: [0, 0, -350], maxDistance: 400, refDistance: 20 });
  audio.update();
  assert.ok(near.occ && far.occ, 'a filter is built for the sounds that need it');
  assert.ok(far.occ.frequency.value < near.occ.frequency.value, 'further is duller');
  assert.equal(none.occ, null, 'no absorption: no filter');
  const before = far.occ.frequency.value;
  far.setOcclusion(0.8); audio.update();
  assert.ok(far.occ.frequency.value < before, 'a wall on top of the air');
  far.setOcclusion(0); audio.update();
  assert.ok(Math.abs(far.occ.frequency.value - before) < before * 0.1, 'the wall removed: the air alone again');
  void ctx;
});

test('layered music: every layer starts in the same instant, intensity brings layers in, and a layer can be set by hand', () => {
  const { ctx, audio } = make();
  const layers = { pad: tone(audio, 4, 'pad'), bass: tone(audio, 4, 'bass'), drums: tone(audio, 4, 'drums'), lead: tone(audio, 4, 'lead') };
  ctx.currentTime = 10;
  const music = audio.playLayers(layers, { bpm: 120, levels: { bass: 0.2, drums: 0.5, lead: { at: 0.8, width: 0.1, max: 0.7 } } });
  assert.ok(music instanceof LayeredMusic && audio.music === music);
  const starts = ctx.sources.map((s) => s.starts[0][0]);
  assert.equal(new Set(starts).size, 1, 'one start time for all');
  assert.ok(ctx.sources.every((s) => s.loop), 'all loop');
  assert.deepEqual(music.levelsNow(), { pad: 1, bass: 0, drums: 0, lead: 0 }, 'calm: only the pad');
  music.setIntensity(0.6, 0.5);
  const now = music.levelsNow();
  assert.equal(now.pad, 1); assert.equal(now.bass, 1); assert.ok(now.drums > 0.2 && now.drums < 1, 'drums partway'); assert.equal(now.lead, 0);
  music.setIntensity(1);
  assert.ok(Math.abs(music.levelsNow().lead - 0.7) < 1e-9, 'the lead tops out at its max');
  music.setLayer('drums', 0, 2);
  assert.equal(music.levelsNow().drums, 0, 'set by hand'); assert.equal(music.levelsNow().bass, 1, 'the others still follow the intensity');
  music.setIntensity(1);
  assert.equal(music.levelsNow().drums, 1, 'the intensity takes over again');
  music.setVolume(0.5);
  assert.ok(Math.abs(music.levelsNow().pad - 0.5) < 1e-9);
  assert.throws(() => audio.playLayers({ a: tone(audio, 4, 'x'), b: tone(audio, 3, 'y') }), /same length/);
});

test('a stinger waits for the next beat or bar; stopping the music stops every layer; a new tune replaces it', () => {
  const { ctx, audio } = make();
  const layers = { pad: tone(audio, 8, 'pad'), bass: tone(audio, 8, 'bass') };
  ctx.currentTime = 0;
  const music = audio.playLayers(layers, { bpm: 120, fade: 0 });          // a beat is 0.5 s, a bar 2 s; the music starts at 0.06
  ctx.currentTime = 1.0;
  assert.ok(Math.abs(music.untilBeat('beat') - 0.06) < 1e-9 || Math.abs(music.untilBeat('beat') - 0.44) < 1e-9, `beat in ${music.untilBeat('beat')}`);
  assert.ok(Math.abs(music.untilBeat('bar') - 1.06) < 1e-9, `bar in ${music.untilBeat('bar')}`);
  const hit = tone(audio, 0.3, 'hit');
  const before = ctx.sources.length;
  music.stinger(hit, { quantize: 'bar' });
  assert.ok(Math.abs(ctx.sources[before].starts[0][0] - (1.0 + 1.06)) < 1e-9, 'starts on the bar line');
  assert.ok(Math.abs(music.position - 0.94) < 1e-9);
  const second = audio.playLayers({ pad: tone(audio, 8, 'pad2') }, { fade: 0 });
  assert.equal(music.playing, false, 'the old tune was stopped');
  assert.ok(ctx.sources.slice(0, 2).every((s) => s.stops.length === 1));
  audio.stopMusic(0);
  assert.equal(second.playing, false); assert.equal(audio.music, null);
});
