import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rms, peak, VoiceActivity, Resampler, FrameSlicer, Pcm16Codec, AdpcmCodec, createCodec, CODEC, encodeVoicePacket, decodeVoicePacket, VOICE_HEADER_BYTES,
  JitterBuffer, VoiceSender, VoiceRouter,
} from '../src/index.js';

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const sine = (n, hz, rate, amp = 0.5, phase = 0) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(phase + (2 * Math.PI * hz * i) / rate));
/** A bit like speech: a few harmonics whose loudness rises and falls like syllables. */
const speech = (n, rate) => Float32Array.from({ length: n }, (_, i) => { const t = i / rate, env = 0.35 + 0.3 * Math.sin(2 * Math.PI * 3 * t); return env * (0.6 * Math.sin(2 * Math.PI * 180 * t) + 0.3 * Math.sin(2 * Math.PI * 540 * t) + 0.2 * Math.sin(2 * Math.PI * 1500 * t)); });
const snr = (ref, got) => { let s = 0, e = 0; for (let i = 0; i < ref.length; i++) { s += ref[i] * ref[i]; e += (ref[i] - got[i]) ** 2; } return 10 * Math.log10(s / (e || 1e-20)); };
const lcg = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

test('levels: rms of a sine is 0.707 of its amplitude, silence is 0, peak is the biggest sample', () => {
  near(rms(sine(1600, 100, 16000, 1)), Math.SQRT1_2, 1e-3); assert.equal(rms(new Float32Array(100)), 0); assert.equal(rms(new Float32Array(0)), 0);
  near(peak(Float32Array.from([0.1, -0.7, 0.3])), 0.7, 1e-6); assert.equal(peak(new Float32Array(0)), 0);
});

test('voice activity needs the attack time to open and the hold time to close, so clicks and word endings are handled', () => {
  const v = new VoiceActivity({ threshold: 0.02, attackMs: 40, holdMs: 200 });
  assert.equal(v.update(0.5, 20), false, 'one loud frame is a click'); assert.equal(v.update(0, 20), false, 'and it forgets');
  assert.equal(v.update(0.5, 20), false); assert.equal(v.update(0.5, 20), true, 'two loud frames in a row open it');
  for (let i = 0; i < 9; i++) assert.equal(v.update(0, 20), true, `held through ${i * 20 + 20} ms of quiet`);
  assert.equal(v.update(0, 20), false, 'closed after 200 ms'); assert.equal(v.speaking, false);
  v.update(0.5, 40); assert.equal(v.speaking, true); v.reset(); assert.equal(v.speaking, false);
});

test('resampling keeps the pitch and the loudness, in chunks of any size', () => {
  const input = sine(48000, 1000, 48000, 0.8), r1 = new Resampler(48000, 16000), whole = r1.push(input);
  assert.ok(Math.abs(whole.length - 16000) <= 1, `${whole.length} samples`);
  let crossings = 0; for (let i = 1; i < whole.length; i++) if (whole[i - 1] < 0 && whole[i] >= 0) crossings++;
  near(crossings, 1000, 2, 'a 1 kHz tone still has 1000 cycles in a second'); near(peak(whole.subarray(100)), 0.8, 0.03, 'and its loudness');
  const r2 = new Resampler(48000, 16000), pieces = []; for (let i = 0; i < input.length; i += 128) pieces.push(...r2.push(input.subarray(i, i + 128)));
  assert.ok(Math.abs(pieces.length - whole.length) <= 1); for (let i = 0; i < Math.min(pieces.length, whole.length); i++) near(pieces[i], whole[i], 1e-5, `sample ${i}`);
  const odd = new Resampler(48000, 16000), o = []; for (let i = 0, k = 1; i < input.length; i += k, k = (k * 7 + 3) % 500 + 1) o.push(...odd.push(input.subarray(i, i + k)));
  assert.ok(Math.abs(o.length - whole.length) <= 1, 'odd chunk sizes too');
  const hi = new Resampler(44100, 16000).push(sine(44100, 440, 44100)); near(hi.length, 16000, 2); // a ratio that is not a whole number
  const same = new Resampler(16000, 16000), x = sine(10, 1, 16000); assert.equal(same.push(x), x);
  const up = new Resampler(8000, 16000).push(Float32Array.from({ length: 100 }, (_, i) => i / 100));
  near(up[10] - up[9], up[11] - up[10], 1e-5, 'going up draws straight lines'); assert.ok(up.length >= 190 && up.length <= 200);
  const alias = new Resampler(48000, 16000).push(sine(48000, 12000, 48000, 0.8)); assert.ok(rms(alias.subarray(50)) < 0.25, `a tone above the new Nyquist is attenuated, not folded back at full strength (rms ${rms(alias.subarray(50))})`);
});

test('frames are cut to an exact size from chunks of any size', () => {
  const s = new FrameSlicer(320), all = [], src = sine(1600, 200, 16000);
  for (let i = 0; i < src.length; i += 77) all.push(...s.push(src.subarray(i, i + 77)));
  assert.equal(all.length, 5); assert.ok(all.every((f) => f.length === 320)); for (let k = 0; k < 5; k++) for (let i = 0; i < 320; i++) assert.equal(all[k][i], src[k * 320 + i]);
  assert.equal(new FrameSlicer(4).push(new Float32Array(3)).length, 0); assert.notEqual(all[0], all[1]);
});

test('pcm16 round trips to within one step, and clips instead of wrapping', () => {
  const c = new Pcm16Codec(), x = sine(320, 300, 16000, 0.9), y = c.decode(c.encode(x));
  assert.equal(c.encode(x).length, 640); for (let i = 0; i < x.length; i++) near(y[i], x[i], 1 / 32768 + 1e-9);
  const loud = c.decode(c.encode(Float32Array.from([2, -2, 0.5]))); near(loud[0], 32767 / 32768, 1e-6); near(loud[1], -1, 1e-6); near(loud[2], 0.5, 1e-4);
});

test('ADPCM is a quarter the size of PCM and keeps speech clear; a lost frame does not harm the next', () => {
  const rate = 16000, src = speech(rate * 2, rate), enc = new AdpcmCodec(), dec = new AdpcmCodec();
  const frames = []; for (let i = 0; i + 320 <= src.length; i += 320) frames.push(src.subarray(i, i + 320));
  const packets = frames.map((f) => enc.encode(f)); assert.equal(packets[0].length, 3 + 160);
  const out = packets.map((p) => dec.decode(p, 320)), flat = Float32Array.from(out.flatMap((f) => [...f]));
  const ref = Float32Array.from(frames.flatMap((f) => [...f]));
  assert.ok(snr(ref, flat) > 20, `signal to noise ${snr(ref, flat).toFixed(1)} dB`);
  const pcm = new Pcm16Codec().encode(frames[0]).length; near(packets[0].length / pcm, 0.255, 0.01, 'about a quarter');
  const lossy = new AdpcmCodec(), got = []; for (let i = 0; i < packets.length; i++) if (i % 7 !== 3) got.push([i, lossy.decode(packets[i], 320)]);
  const after = got.filter(([i]) => i % 7 === 4); const worst = Math.min(...after.map(([i, f]) => snr(frames[i], f)));
  assert.ok(worst > 12, `the frame after a lost one is still good: ${worst.toFixed(1)} dB`);
  const silent = new AdpcmCodec(), q = silent.decode(silent.encode(new Float32Array(320)), 320); assert.ok(peak(q) < 0.001, 'silence stays silent');
  const edge = new AdpcmCodec(); const e = edge.decode(edge.encode(Float32Array.from({ length: 320 }, (_, i) => (i % 2 ? 1 : -1))), 320); assert.ok(peak(e) <= 1 && e.every(Number.isFinite), 'full-scale square wave does not blow up');
  assert.equal(createCodec('adpcm').id, CODEC.adpcm); assert.equal(createCodec('pcm16').id, CODEC.pcm16); assert.throws(() => createCodec('mp3'), /unknown codec/);
});

test('voice packets round trip, wrap their sequence number, and anything malformed is refused without a throw', () => {
  const payload = Uint8Array.from([1, 2, 3, 4, 5]);
  const p = encodeVoicePacket({ codec: CODEC.adpcm, seq: 65537, timestamp: 4294967299, payload, end: false });
  assert.equal(p.length, VOICE_HEADER_BYTES + 5);
  const d = decodeVoicePacket(p); assert.deepEqual([d.codec, d.seq, d.timestamp, d.end, [...d.payload]], [CODEC.adpcm, 1, 3, false, [1, 2, 3, 4, 5]]);
  const e = decodeVoicePacket(encodeVoicePacket({ codec: 0, seq: 9, timestamp: 0, payload: new Uint8Array(0), end: true })); assert.equal(e.end, true); assert.equal(e.payload.length, 0);
  assert.equal(decodeVoicePacket(new Uint8Array(3)), null); assert.equal(decodeVoicePacket(new Uint8Array(5000)), null); assert.equal(decodeVoicePacket('x'), null);
  const bad = p.slice(); bad[0] = 0x80; assert.equal(decodeVoicePacket(bad), null, 'unknown flags'); const bad2 = p.slice(); bad2[1] = 9; assert.equal(decodeVoicePacket(bad2), null, 'unknown codec');
  const r = lcg(5); let accepted = 0; for (let i = 0; i < 2000; i++) { const b = Uint8Array.from({ length: Math.floor(r() * 40) }, () => Math.floor(r() * 256)); assert.doesNotThrow(() => { if (decodeVoicePacket(b)) accepted++; }); }
  assert.ok(accepted < 2000);
});

/** Simulate a sender and a network and a playout clock; returns what came out of the jitter buffer. */
function simulate({ frames = 400, jitter = 30, loss = 0.05, reorder = 0, startSeq = 0, seed = 1, jb = new JitterBuffer() } = {}) {
  const r = lcg(seed), arrivals = [];
  for (let i = 0; i < frames; i++) {
    if (r() < loss) continue;
    const at = i * 20 + 10 + r() * jitter + (r() < reorder ? 45 : 0);
    arrivals.push({ at, seq: (startSeq + i) & 0xffff, id: i });
    if (r() < 0.02) arrivals.push({ at: at + 5, seq: (startSeq + i) & 0xffff, id: i });                 // a duplicate
  }
  arrivals.sort((a, b) => a.at - b.at);
  const played = [], log = []; let a = 0;
  for (let t = 0; t < frames * 20 + 800; t += 20) {
    while (a < arrivals.length && arrivals[a].at <= t) { jb.push(arrivals[a].seq, arrivals[a].id); a++; }
    const out = jb.pull(); log.push(out.kind);
    if (out.kind === 'frame') played.push(out.frame);
  }
  return { jb, played, log };
}

test('the jitter buffer puts frames in order, covers losses, drops duplicates and late packets', () => {
  const { jb, played, log } = simulate({ frames: 500, jitter: 30, loss: 0.05, reorder: 0.05 });
  for (let i = 1; i < played.length; i++) assert.ok(played[i] > played[i - 1], `in order at ${i}: ${played[i - 1]} then ${played[i]}`);
  assert.equal(new Set(played).size, played.length, 'no frame twice');
  assert.ok(played.length > 400 && played.length < 500, `${played.length} of 500 played`);
  assert.ok(jb.stats.duplicate > 0 && jb.stats.late >= 0 && jb.stats.lost > 10, JSON.stringify(jb.stats));
  const firstFrame = log.indexOf('frame'); assert.ok(firstFrame >= 2 && firstFrame <= 4, `it waited for ${firstFrame} frames before starting`);
  assert.ok(log.slice(firstFrame, firstFrame + 400).filter((k) => k === 'idle').length === 0, 'once started it never goes idle in the middle of speech');
  assert.ok(jb.stats.lost <= 500 - played.length + 12, 'what it called lost really was (plus the few frames it covers after the speech ends)');
});

test('sequence numbers wrap at 65536 without a hiccup', () => {
  const { played, jb } = simulate({ frames: 300, loss: 0, jitter: 20, startSeq: 65450, seed: 3 });
  assert.equal(played.length, 300); for (let i = 0; i < 300; i++) assert.equal(played[i], i); assert.equal(jb.stats.late, 0); assert.ok(jb.stats.lost <= 9, 'only the cover after the last frame');
});

test('a burst ends with its end packet, and the next burst starts fresh', () => {
  const jb = new JitterBuffer({ targetFrames: 3 });
  const kinds = []; const tick = () => kinds.push(jb.pull().kind);
  for (let s = 10; s < 16; s++) jb.push(s, `a${s}`); jb.push(16, '', true);
  for (let i = 0; i < 8; i++) tick();
  assert.deepEqual(kinds, ['frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'idle'], 'six frames and the end marker, then quiet');
  for (let s = 17; s < 22; s++) jb.push(s, `b${s}`);
  const next = []; for (let i = 0; i < 6; i++) next.push(jb.pull()); assert.equal(next[0].frame, 'b17'); assert.equal(jb.stats.bursts, 2);
  const tiny = new JitterBuffer({ targetFrames: 5 }); tiny.push(1, 'x'); tiny.push(2, '', true);
  assert.equal(tiny.pull().kind, 'frame', 'a short burst that has already ended need not wait to fill'); assert.equal(tiny.pull().kind, 'frame');
});

test('when the sender goes quiet the buffer covers a few frames and then gives up; when far behind it skips ahead', () => {
  const jb = new JitterBuffer({ targetFrames: 2, maxConceal: 4 });
  jb.push(0, 'a'); jb.push(1, 'b'); jb.push(2, 'c');
  const k = []; for (let i = 0; i < 12; i++) k.push(jb.pull().kind);
  assert.deepEqual(k.slice(0, 3), ['frame', 'frame', 'frame']); assert.ok(k.slice(3, 8).filter((x) => x === 'lost').length >= 3 && k.at(-1) === 'idle', k.join());
  const behind = new JitterBuffer({ targetFrames: 2, maxBuffered: 10 }); for (let s = 0; s < 40; s++) behind.push(s, s);
  assert.ok(behind.buffered <= 10 && behind.stats.dropped >= 30, JSON.stringify(behind.stats)); assert.equal(behind.pull().frame >= 30, true, 'it plays the newest, not 40 frames of old speech');
});

test('the delay grows when packets keep arriving late and shrinks again on a calm network', () => {
  const rough = simulate({ frames: 800, jitter: 140, loss: 0.02, seed: 8, jb: new JitterBuffer({ targetFrames: 2, minFrames: 2, maxFrames: 12 }) });
  assert.ok(rough.jb.target > 3, `a rough network raised the delay to ${rough.jb.target} frames`); assert.ok(rough.jb.target <= 12);
  const calm = new JitterBuffer({ targetFrames: 8, minFrames: 2 }); for (let s = 0; s < 8; s++) calm.push(s, s); for (let s = 8; s < 3400; s++) { calm.push(s & 0xffff, s); calm.pull(); }
  assert.equal(calm.target, 2, 'a steady one brought it back down');
  const fixed = simulate({ frames: 400, jitter: 140, seed: 8, jb: new JitterBuffer({ targetFrames: 3, adaptive: false }) }); assert.equal(fixed.jb.target, 3);
});

test('the sender opens on speech, holds through gaps, marks the end of a burst once, and numbers its packets', () => {
  const sent = [], clock = (() => { let t = 1000; return () => (t += 20); })();
  const s = new VoiceSender({ codec: new AdpcmCodec(), frameMs: 20, vad: new VoiceActivity({ threshold: 0.02, attackMs: 40, holdMs: 100 }), onPacket: (p) => sent.push(decodeVoicePacket(p)), clock });
  const loud = sine(320, 300, 16000, 0.4), quiet = new Float32Array(320);
  for (let i = 0; i < 5; i++) s.push(quiet); assert.equal(sent.length, 0, 'silence sends nothing');
  s.push(loud); assert.equal(sent.length, 0, 'one loud frame is not yet speech'); s.push(loud);
  assert.equal(sent.length, 1); assert.equal(s.speaking, true);
  for (let i = 0; i < 4; i++) s.push(loud);
  for (let i = 0; i < 4; i++) s.push(quiet);                                              // inside the hold
  assert.equal(s.speaking, true);
  for (let i = 0; i < 2; i++) s.push(quiet);
  assert.equal(s.speaking, false); const ends = sent.filter((p) => p.end); assert.equal(ends.length, 1, 'exactly one end packet'); assert.equal(ends[0].payload.length, 0);
  assert.deepEqual(sent.map((p) => p.seq), sent.map((_, i) => i + 1), 'consecutive numbers'); assert.ok(sent[0].timestamp >= 1000);
  assert.equal(s.stats.bursts, 1); assert.equal(s.stats.packets, sent.length); assert.ok(s.stats.bytes > 0 && s.level === 0);
  s.push(loud); s.push(loud); assert.equal(s.stats.bursts, 2); assert.equal(sent.at(-1).seq, sent.length);
});

test('push-to-talk and mute override detection; an asynchronous codec keeps packets in order, the end packet last', async () => {
  const sent = [];
  const s = new VoiceSender({ codec: new Pcm16Codec(), vad: new VoiceActivity(), onPacket: (p) => sent.push(decodeVoicePacket(p)) });
  const loud = sine(320, 300, 16000, 0.4);
  s.pushToTalk = false; for (let i = 0; i < 6; i++) s.push(loud); assert.equal(sent.length, 0, 'push-to-talk released: even loud speech stays home');
  s.pushToTalk = true; s.push(new Float32Array(320)); assert.equal(sent.length, 1, 'held: even silence goes out'); s.pushToTalk = null;
  s.muted = true; s.push(loud); s.push(loud); assert.equal(sent.at(-1).end, true, 'muting ends the burst'); const n = sent.length; s.push(loud); assert.equal(sent.length, n);
  const out = [], slow = { id: CODEC.opus, encode: (f) => new Promise((r) => setTimeout(() => r(Uint8Array.from([f[0] * 100])), f[0] > 0.2 ? 15 : 1)) };
  const a = new VoiceSender({ codec: slow, vad: null, onPacket: (p) => out.push(decodeVoicePacket(p)) });
  a.push(Float32Array.from([0.9])); a.push(Float32Array.from([0.1])); a.push(Float32Array.from([0.9])); a.pushToTalk = false; a.push(Float32Array.from([0.1]));
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(out.map((p) => p.seq), [1, 2, 3, 4], 'in the order they were made, though the first took longest'); assert.equal(out[3].end, true);
});

test('the router decides who hears whom: by distance, by team, by channel, with mutes and deafness', () => {
  const players = [{ id: 'a', x: 0, y: 0, z: 0, team: 1 }, { id: 'b', x: 10, y: 0, z: 0, team: 1 }, { id: 'c', x: 30, y: 0, z: 0, team: 2 }, { id: 'd', x: 60, y: 0, z: 0, team: 2 }];
  const prox = new VoiceRouter({ mode: 'proximity', maxDistance: 40 });
  const heard = prox.route(players[0], players); assert.deepEqual(heard.map((h) => h.id), ['b', 'c']);
  near(heard[0].gain, 0.75, 1e-9); near(heard[1].gain, 0.25, 1e-9); assert.ok(heard[0].gain > heard[1].gain && heard[0].distance === 10);
  assert.deepEqual(new VoiceRouter({ mode: 'team' }).route(players[0], players).map((h) => h.id), ['b'], 'team: any distance, own team');
  assert.deepEqual(new VoiceRouter({ mode: 'team' }).route(players[2], players).map((h) => h.id), ['d']);
  assert.equal(new VoiceRouter({ mode: 'global' }).route(players[0], players).length, 3);
  const party = [{ ...players[0], channel: 'p1' }]; const withChannel = [...players.slice(1).map((p) => ({ ...p })), { id: 'e', x: 500, channel: 'p1' }];
  assert.deepEqual(prox.route(party[0], withChannel).map((h) => h.id), ['e'], 'a party channel ignores distance and is heard by the party only');
  const muted = [{ ...players[1], muted: new Set(['a']) }, { ...players[2], deaf: true }, players[3]]; assert.deepEqual(prox.route(players[0], muted), [], 'mutes and deafness are respected');
  assert.deepEqual(prox.route(players[0], [players[0]]), [], 'you do not hear yourself');
  assert.ok(new VoiceRouter({ falloff: 'inverse' }).route(players[0], players)[0].gain < 0.75);
});

test('end to end in memory: speech through the sender, a lossy jittery network and the jitter buffer comes out clear and complete', () => {
  const rate = 16000, src = speech(rate * 3, rate), frames = []; for (let i = 0; i + 320 <= src.length; i += 320) frames.push(src.slice(i, i + 320));
  const dec = new AdpcmCodec(), jb = new JitterBuffer(), r = lcg(9), arrivals = [];
  const sender = new VoiceSender({ codec: new AdpcmCodec(), vad: null, onPacket: (p) => { if (r() < 0.04) return; arrivals.push({ at: arrivals.length * 20 + 20 + r() * 40, p }); }, clock: () => 0 });
  for (const f of frames) sender.push(f);
  arrivals.sort((a, b) => a.at - b.at);
  const out = []; let a = 0, t = 0, frame = 0;
  for (; t < frames.length * 20 + 600; t += 20) {
    while (a < arrivals.length && arrivals[a].at <= t) { const p = decodeVoicePacket(arrivals[a].p); jb.push(p.seq, dec.decode(p.payload, 320), p.end); a++; }
    const o = jb.pull(); if (o.kind === 'frame') out.push(o.frame); else if (o.kind === 'lost') out.push(new Float32Array(320));
  }
  assert.ok(out.length >= frames.length - 5, `${out.length} frames out for ${frames.length} in`);
  assert.ok(jb.stats.lost >= 5 && jb.stats.lost <= 40, `about 4% were lost: ${jb.stats.lost}`);
  frame = frames.length; assert.ok(rms(Float32Array.from(out.slice(10, 60).flatMap((f) => [...f]))) > 0.1, 'it is not silent');
});
