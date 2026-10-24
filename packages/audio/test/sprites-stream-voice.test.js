import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AudioEngine, AudioSprite, packSounds, spriteMapFromMs, sfx, synthesize, Microphone, captureFrames, VoicePlayback, VoiceChat, VoiceSender, AdpcmCodec, Pcm16Codec,
  encodeVoicePacket, CODEC, rms, VoiceActivity,
} from '../src/index.js';
import { FakeContext, FakeNode, Param } from './fake-context.js';

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const engine = (ctx = new FakeContext()) => new AudioEngine({ context: ctx, unlock: false, pauseWhenHidden: false });
const sine = (n, hz, rate, amp = 0.5) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

// ------------------------------------------------------------------ sprites

test('sounds are packed into one buffer with a map of where each lies', () => {
  const shot = synthesize(sfx.shot()), boom = synthesize(sfx.explosion()), coin = synthesize(sfx.coin());
  const packed = packSounds({ shot, boom, coin }, { gap: 0.1, loop: ['coin'] });
  assert.equal(packed.sampleRate, shot.sampleRate);
  const [s, b, c] = ['shot', 'boom', 'coin'].map((n) => packed.map[n]);
  assert.equal(s[0], 0); near(s[1], shot.data.length / shot.sampleRate, 1e-9); near(b[0], s[0] + s[1] + 0.1, 1e-6, 'the next starts after a gap'); near(c[0], b[0] + b[1] + 0.1, 1e-6);
  assert.deepEqual([s[2], b[2], c[2]], [false, false, true]);
  assert.equal(packed.data.length, shot.data.length + boom.data.length + coin.data.length + 3 * Math.round(0.1 * shot.sampleRate));
  assert.deepEqual([...packed.data.subarray(Math.round(b[0] * packed.sampleRate), Math.round(b[0] * packed.sampleRate) + 50)], [...boom.data.subarray(0, 50)], 'the samples are where the map says');
  assert.throws(() => packSounds({ a: { sampleRate: 8000, data: new Float32Array(10) }, b: { sampleRate: 16000, data: new Float32Array(10) } }), /one rate/); assert.throws(() => packSounds({}), /at least one/);
  assert.deepEqual(spriteMapFromMs({ hit: [250, 500], music: [1000, 8000, true] }), { hit: [0.25, 0.5, false], music: [1, 8, true] });
});

test('a sprite plays one region of its sound: from its start, for its length, and loops inside itself when asked', () => {
  const audio = engine(), ctx = audio.context;
  const sprite = audio.createSprite(packSounds({ shot: synthesize(sfx.shot()), boom: synthesize(sfx.explosion()), hum: synthesize(sfx.alarm()) }, { loop: ['hum'] }), undefined, 'fx');
  assert.ok(sprite instanceof AudioSprite); assert.deepEqual(sprite.names, ['shot', 'boom', 'hum']); assert.equal(sprite.has('boom'), true); assert.equal(sprite.sound.name, 'fx');
  const boom = sprite.region('boom'); audio.playSprite(sprite, 'boom');
  const start = ctx.sources.at(-1).starts[0]; near(start[1], boom.start, 1e-9, 'offset'); near(start[2], boom.duration, 1e-9, 'duration'); assert.equal(ctx.sources.at(-1).loop, false);
  const hum = sprite.region('hum'); audio.playSprite(sprite, 'hum');
  const looped = ctx.sources.at(-1); assert.equal(looped.loop, true); near(looped.loopStart, hum.start, 1e-9); near(looped.loopEnd, hum.start + hum.duration, 1e-9); assert.equal(looped.starts[0].length, 2, 'a loop is not given a length');
  audio.playSprite(sprite, 'shot', { volume: 0.5, bus: 'ui', pitch: 2 }); assert.equal(ctx.sources.at(-1).playbackRate.value, 2);
  assert.throws(() => audio.playSprite(sprite, 'nope'), /no region "nope"/);
  assert.throws(() => audio.createSprite(sprite.sound, { late: [999, 1] }), /past the end/); assert.throws(() => new AudioSprite(sprite.sound, { bad: [0, 0] }), /length above 0/);
});

test('voice limits count each region separately: a machine gun is limited, other regions of the same file are not', () => {
  const audio = engine(), sprite = audio.createSprite(packSounds({ shot: synthesize(sfx.shot()), boom: synthesize(sfx.explosion()) }), undefined, 'fx');
  assert.ok(audio.playSprite(sprite, 'shot', { maxPerSound: 1 })); assert.equal(audio.stats.stolen, 0);
  assert.ok(audio.playSprite(sprite, 'shot', { maxPerSound: 1 })); assert.equal(audio.stats.stolen, 1, 'a second shot takes over from the first');
  assert.ok(audio.playSprite(sprite, 'boom', { maxPerSound: 1 })); assert.equal(audio.stats.stolen, 1, 'a different region is its own sound');
  const sound = audio.createSound(synthesize(sfx.click()), 'k'); audio.play(sound, { maxPerSound: 1 }); audio.play(sound, { maxPerSound: 1 }); assert.equal(audio.stats.stolen, 2, 'plain sounds still work as before');
});

// ------------------------------------------------------------------ streaming music

class FakeMedia {
  constructor() { this.listeners = new Map(); this.paused = true; this.currentTime = 0; this.duration = 200; this.loop = false; this.crossOrigin = null; this.calls = []; this.attrs = { src: '' }; this.playResult = Promise.resolve(); }
  set src(v) { this.attrs.src = v; } get src() { return this.attrs.src; }
  addEventListener(t, fn) { (this.listeners.get(t) ?? this.listeners.set(t, []).get(t)).push(fn); }
  removeEventListener(t, fn) { const l = this.listeners.get(t); if (l) l.splice(l.indexOf(fn), 1); }
  emit(t, e) { for (const fn of [...(this.listeners.get(t) ?? [])]) fn(e); }
  play() { this.calls.push('play'); this.paused = false; return this.playResult; }
  pause() { this.calls.push('pause'); this.paused = true; }
  load() { this.calls.push('load'); }
  removeAttribute(k) { delete this.attrs[k]; this.calls.push(`remove ${k}`); }
}
const stream = (audio, url, o = {}) => { const el = new FakeMedia(); const t = audio.streamMusic(url, { createElement: () => el, ...o }); return { t, el }; };
const tick = () => new Promise((r) => setTimeout(r, 5));

test('streamed music plays through the music bus without being decoded: it starts, fades in, can pause and seek', async () => {
  const audio = engine(), ctx = audio.context;
  const { t, el } = stream(audio, 'music/theme.ogg', { fade: 2, volume: 0.6 });
  assert.equal(el.src, 'music/theme.ogg'); assert.equal(el.loop, true); assert.equal(el.preload, 'auto'); assert.equal(el.crossOrigin, 'anonymous'); assert.deepEqual(el.calls, ['play']);
  const source = ctx.mediaSources[0]; assert.equal(source.element, el);
  assert.equal(source.to[0], t.gain, 'media -> gain'); assert.equal(t.gain.to[0], audio.buses.get('music').node, 'gain -> the music bus');
  assert.equal(t.gain.gain.calls.at(-1)[1], 0.6, 'a fade ramps up to the volume'); assert.equal(t.gain.gain.calls.at(-1)[2] > 0, true);
  assert.equal(audio.music, t); assert.equal(t.playing, true); assert.equal(t.paused, false); assert.equal(t.duration, 200);
  t.seek(42); assert.equal(el.currentTime, 42); t.seek(-5); assert.equal(el.currentTime, 0); el.currentTime = 12; assert.equal(t.currentTime, 12);
  t.pause(); assert.equal(t.paused, true); assert.equal(t.playing, true, 'paused is still the current track'); t.resume(); assert.equal(el.calls.at(-1), 'play');
  t.setVolume(0.2, 1); assert.equal(t.volume, 0.2); await tick();
  assert.equal(audio.streamMusic('music/theme.ogg', { createElement: () => { throw new Error('should not make another'); } }), t, 'the same track again does nothing');
  audio.setVolume('music', 0.5); assert.equal(audio.buses.get('music').node.gain.value, 0.5, 'and the bus controls it');
});

test('a new track cross-fades from the old one, and the old one is released when its fade is over', async () => {
  const audio = engine();
  const a = stream(audio, 'a.ogg', { fade: 0 });
  const b = stream(audio, 'b.ogg', { fade: 0.05 });
  assert.equal(audio.music, b.t); assert.equal(a.t.stopped, true); assert.equal(a.t.playing, false);
  const ramp = a.t.gain.gain.calls.filter((c) => c[0] === 'ramp').at(-1); assert.equal(ramp[1], 0, 'fading out');
  assert.equal(a.el.paused, false, 'still sounding while it fades'); await new Promise((r) => setTimeout(r, 120));
  assert.equal(a.el.paused, true); assert.ok(a.el.calls.includes('remove src') && a.el.calls.includes('load'), 'the element lets go of the file'); assert.equal(a.t.source.disconnected, true);
  audio.stopMusic(0); assert.equal(audio.music, null); assert.equal(b.el.paused, true); assert.equal(b.t.playing, false);
  audio.playMusic(audio.createSound(synthesize(sfx.coin()), 'x'), { fade: 0 }); const c = stream(audio, 'c.ogg', { fade: 0 }); assert.equal(audio.music, c.t, 'streams and buffer music replace each other');
});

test('a track that ends, fails, or is blocked until the first gesture is handled', async () => {
  const audio = engine(); let ended = 0, failed = null;
  const once = stream(audio, 'jingle.ogg', { loop: false, fade: 0, onEnded: () => { ended++; }, onError: (e) => { failed = e; } });
  once.el.emit('ended'); assert.equal(ended, 1); assert.equal(once.t.playing, false); assert.equal(once.el.paused, true);
  const looping = stream(audio, 'loop.ogg', { fade: 0, onEnded: () => { ended++; } }); looping.el.emit('ended'); assert.equal(ended, 1, 'a looping track does not end'); assert.equal(looping.t.playing, true);
  const bad = stream(audio, 'missing.ogg', { fade: 0, onError: (e) => { failed = e.type; } }); bad.el.emit('error', { type: 'error' }); assert.equal(failed, 'error'); assert.equal(bad.t.playing, false);
  const refuse = new FakeMedia(); refuse.playResult = Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  const blocked = audio.streamMusic('later.ogg', { createElement: () => refuse, fade: 0 }); await tick();
  assert.equal(blocked.blocked, true, 'the browser refused until the player does something'); assert.equal(blocked.playing, true);
  refuse.playResult = Promise.resolve(); blocked.start(); await tick(); assert.equal(blocked.blocked, false);
  const throws = new FakeMedia(); throws.play = () => { throw new Error('no'); }; let thrown; const bad2 = audio.streamMusic('x.ogg', { createElement: () => throws, fade: 0, onError: (e) => { thrown = e.message; } }); assert.equal(thrown, 'no'); assert.equal(bad2.failed, true);
});

// ------------------------------------------------------------------ the microphone and the capture

class RichContext extends FakeContext {
  constructor() { super(); this.sampleRate = 48000; }
  createMediaStreamSource(stream) { const n = new FakeNode('streamsource'); n.stream = stream; return n; }
  createAnalyser() { const n = new FakeNode('analyser'); n.fftSize = 512; n.signal = new Float32Array(1024); n.getFloatTimeDomainData = (a) => a.set(n.signal.subarray(0, a.length)); return n; }
  createScriptProcessor() { const n = new FakeNode('script'); return n; }
}
const fakeStream = () => { const track = { enabled: true, stopped: false, stop() { this.stopped = true; } }; return { track, getAudioTracks: () => [track], getTracks: () => [track] }; };

test('the microphone gives a level, a speaking flag, mute and a clean close; devices are listed', async () => {
  const ctx = new RichContext(), stream = fakeStream();
  const mic = await Microphone.open({ context: ctx, getStream: async () => stream, vad: new VoiceActivity({ threshold: 0.05, attackMs: 40, holdMs: 100 }) });
  assert.equal(mic.level, 0); mic.update(0.02); assert.equal(mic.speaking, false);
  mic.analyser.signal.set(sine(1024, 300, 48000, 0.5)); for (let i = 0; i < 5; i++) mic.update(0.02);
  assert.ok(mic.level > 0.2, `level ${mic.level}`); assert.equal(mic.speaking, true);
  mic.analyser.signal.fill(0); for (let i = 0; i < 12; i++) mic.update(0.02);
  assert.ok(mic.level < 0.05); assert.equal(mic.speaking, false, 'and stops after the hold');
  assert.equal(mic.muted, false); mic.muted = true; assert.equal(stream.track.enabled, false); assert.equal(mic.muted, true); mic.muted = false; assert.equal(stream.track.enabled, true);
  mic.close(); assert.equal(stream.track.stopped, true); mic.update(0.02);
  await assert.rejects(Microphone.open({}), /audio context/);
  await assert.rejects(Microphone.open({ context: ctx, getStream: async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); } }), (e) => e.name === 'NotAllowedError');
  const list = await Microphone.devices({ enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'a', label: 'Headset' }, { kind: 'videoinput', deviceId: 'v', label: 'Cam' }, { kind: 'audioinput', deviceId: 'b', label: '' }] });
  assert.deepEqual(list, [{ deviceId: 'a', label: 'Headset' }, { deviceId: 'b', label: '' }]); assert.deepEqual(await Microphone.devices({}), []);
});

test('captured samples come out as 20 ms frames at the wanted rate (here from a script processor at 48 kHz)', async () => {
  const ctx = new RichContext(), mic = await Microphone.open({ context: ctx, getStream: async () => fakeStream() });
  const frames = []; const cap = await captureFrames(mic, (f) => frames.push(f), { sampleRate: 16000, frameMs: 20 });
  const node = mic.source.to.find((n) => n.kind === 'script'); assert.ok(node, 'a processor is connected to the microphone');
  const signal = sine(48000, 500, 48000, 0.6);
  for (let i = 0; i < signal.length; i += 2048) node.onaudioprocess({ inputBuffer: { getChannelData: () => signal.subarray(i, i + 2048) } });
  assert.ok(frames.length >= 48 && frames.length <= 50, `${frames.length} frames in a second`); assert.ok(frames.every((f) => f.length === 320));
  near(rms(frames[20]), 0.6 / Math.SQRT2, 0.03, 'the loudness survives');
  cap.stop(); assert.equal(node.onaudioprocess, null); assert.equal(node.disconnected, true);
});

// ------------------------------------------------------------------ playback of other players, and the chat

const clockAt = (t = 0) => { const f = () => t; f.advance = (ms) => { t += ms; }; return f; };
const speechFrame = (i) => sine(320, 200 + (i % 5) * 40, 16000, 0.4);

test('a speaker is played frame after frame without gaps; a missing frame is covered; position makes it quieter and moves it left or right', () => {
  const audio = engine(); const ctx = audio.context;
  const p = new VoicePlayback(audio, { sampleRate: 16000, lead: 0.04, maxDistance: 40, refDistance: 3 });
  ctx.currentTime = 1; p.play(speechFrame(0)); p.play(speechFrame(1)); p.play(speechFrame(2));
  const starts = ctx.sources.map((s) => s.starts[0][0]); near(starts[0], 1.04, 1e-9); near(starts[1] - starts[0], 0.02, 1e-9, 'each begins where the last ends'); near(starts[2] - starts[1], 0.02, 1e-9);
  p.skip(320); p.play(speechFrame(3)); near(ctx.sources.at(-1).starts[0][0] - starts[2], 0.04, 1e-9, 'a skipped frame leaves a gap of 20 ms');
  p.repeat(); assert.equal(p.lastFrame, null); p.play(speechFrame(4)); p.repeat(); const n = ctx.sources.length; p.repeat(); assert.equal(ctx.sources.length, n, 'nothing to repeat twice');
  ctx.currentTime = 5; p.play(speechFrame(5)); near(ctx.sources.at(-1).starts[0][0], 5.04, 1e-9, 'after a pause it restarts from now, not in the past');
  p.volume = 0.3; assert.equal(p.volumeNode.gain.value, 0.3);
  audio.setListener(0, 0, 0, 0, 0);
  p.setPosition(0, 0, -10); assert.ok(p.spatialNode.gain.value < 1 && p.spatialNode.gain.value > 0.05); const near10 = p.spatialNode.gain.value;
  p.setPosition(0, 0, -30); assert.ok(p.spatialNode.gain.value < near10); p.setPosition(0, 0, -100); assert.equal(p.inaudible, true);
  p.setPosition(10, 0, -1); assert.ok(p.panner.pan.value > 0.5, 'to the right'); p.setPosition(-10, 0, -1); assert.ok(p.panner.pan.value < -0.5, 'to the left');
  p.setPosition(null); assert.equal(p.spatialNode.gain.value, 1); assert.equal(p.inaudible, false); assert.equal(p.panner.pan.value, 0);
  const n2 = p.sources.size; p.close(); assert.equal(p.sources.size, 0); assert.ok(n2 >= 0);
});

/** A chat with the sender side driven by hand (no real microphone). */
function chatPair({ vad = false } = {}) {
  const audio = engine(), clock = clockAt(1000), sent = [];
  const chat = new VoiceChat({ engine: audio, codec: 'adpcm', onPacket: (p) => sent.push(p), vad, clock, jitterFrames: 2 });
  chat.sender = new VoiceSender({ codec: new AdpcmCodec(), vad: chat.vad, onPacket: (p) => chat.onPacket(p), clock });
  return { audio, chat, clock, sent };
}

test('voice chat: packets from others are decoded, buffered and played, and who is speaking is reported', async () => {
  const { audio, chat, clock } = chatPair(); const ctx = audio.context;
  const talk = new VoiceSender({ codec: new AdpcmCodec(), vad: null, onPacket: () => {}, clock });
  const packets = []; talk.onPacket = (p) => packets.push(p);
  for (let i = 0; i < 12; i++) talk.push(speechFrame(i)); talk.pushToTalk = false; talk.push(speechFrame(12));
  const events = []; chat.onSpeaking = (id, on) => events.push([id, on]);
  for (const p of packets) await chat.receive('ann', p);
  assert.equal(chat.stats.received, 13); assert.equal(chat.stats.decoded, 12);
  for (let i = 0; i < 12; i++) { clock.advance(20); chat.update(); }
  assert.ok(ctx.sources.length >= 10, `${ctx.sources.length} frames reached the audio`); assert.deepEqual(events[0], ['ann', true]); assert.equal(chat.isSpeaking('ann'), true);
  const first = ctx.sources[0].starts[0][0]; ctx.sources.slice(1).forEach((s, i) => near(s.starts[0][0] - ctx.sources[i].starts[0][0], 0.02, 1e-6, 'even spacing'));
  assert.ok(first >= 0);
  for (let i = 0; i < 40; i++) { clock.advance(20); chat.update(); }
  assert.equal(chat.isSpeaking('ann'), false); assert.deepEqual(events.at(-1), ['ann', false]);
  await chat.receive('ann', Uint8Array.from([1, 2, 3])); await chat.receive('ann', new Uint8Array(0)); assert.equal(chat.stats.rejected, 2, 'garbage is counted, not played');
  await chat.receive('bob', encodeVoicePacket({ codec: CODEC.pcm16, seq: 1, timestamp: 0, payload: new Pcm16Codec().encode(speechFrame(0)) })); assert.equal(chat.speakers.size, 2, 'another codec, from another speaker, works too');
});

test('mute one player, deafen everyone, change volumes, place a speaker, forget one who left', async () => {
  const { audio, chat, clock } = chatPair();
  const feed = async (id) => { const t = new VoiceSender({ codec: new AdpcmCodec(), vad: null, onPacket: () => {}, clock }); const out = []; t.onPacket = (p) => out.push(p); for (let i = 0; i < 4; i++) t.push(speechFrame(i)); for (const p of out) await chat.receive(id, p); };
  await feed('ann'); await feed('bob');
  const ann = chat.speakers.get('ann'), bob = chat.speakers.get('bob');
  chat.setSpeakerVolume('ann', 0.4); assert.equal(ann.playback.volume, 0.4);
  chat.muteSpeaker('ann'); assert.equal(ann.playback.volume, 0); chat.muteSpeaker('ann', false); assert.equal(ann.playback.volume, 0.4);
  const before = chat.stats.received; chat.muteSpeaker('bob'); await feed('bob'); assert.ok(chat.stats.received > before); assert.equal(bob.jitter.buffered, 4, 'a muted speaker is not decoded or buffered further');
  chat.deafen = true; assert.equal(ann.playback.volume, 0); assert.equal(chat.deafened, true); chat.deafen = false; assert.equal(ann.playback.volume, 0.4); assert.equal(bob.playback.volume, 0, 'bob is still muted');
  audio.setListener(0, 0, 0, 0, 0); chat.setSpeakerPosition('ann', [0, 0, -20]); assert.ok(ann.playback.spatialNode.gain.value < 1); chat.setSpeakerPosition('ann', null); assert.equal(ann.playback.spatialNode.gain.value, 1);
  chat.removeSpeaker('bob'); assert.equal(chat.speakers.has('bob'), false); chat.removeSpeaker('nobody');
  const flat = new VoiceChat({ engine: audio, codec: 'pcm16', onPacket() {}, spatial: false }); flat.setSpeakerPosition('x', [0, 0, -999]); assert.equal(flat.speakers.size, 0, 'spatial off: positions are ignored');
  chat.dispose(); assert.equal(chat.speakers.size, 0);
});

test('chat sending: voice detection, push-to-talk and mute decide what goes out, and the microphone and capture are released', async () => {
  const ctx = new RichContext(), audio = new AudioEngine({ context: ctx, unlock: false, pauseWhenHidden: false });
  const stream = fakeStream(), sent = [], transitions = [];
  const chat = new VoiceChat({ engine: audio, codec: 'adpcm', onPacket: (p) => sent.push(p), clock: clockAt(0), vad: { threshold: 0.03, attackMs: 40, holdMs: 100 } });
  chat.onTransmit = (on) => transitions.push(on);
  const mic = await Microphone.open({ context: ctx, getStream: async () => stream });
  await chat.start(mic);
  assert.equal(chat.transmitting, false); assert.equal(chat.level, 0);
  const node = mic.source.to.find((n) => n.kind === 'script'), feed = (sig) => { for (let i = 0; i < sig.length; i += 2048) node.onaudioprocess({ inputBuffer: { getChannelData: () => sig.subarray(i, i + 2048) } }); };
  feed(new Float32Array(48000 / 2)); assert.equal(sent.length, 0, 'silence sends nothing');
  feed(sine(48000 / 2, 300, 48000, 0.5)); assert.ok(sent.length > 10, `${sent.length} packets for half a second of speech`); assert.deepEqual(transitions, [true]); assert.equal(chat.transmitting, true);
  feed(new Float32Array(48000 / 2)); assert.equal(chat.transmitting, false); assert.deepEqual(transitions, [true, false]); assert.equal(sent.filter((p) => (p[0] & 1) === 1).length, 1, 'one end packet');
  chat.pushToTalk = false; const n = sent.length; feed(sine(48000 / 4, 300, 48000, 0.5)); assert.equal(sent.length, n, 'held back by push-to-talk'); chat.pushToTalk = true; feed(new Float32Array(48000 / 10)); assert.ok(sent.length > n, 'sends even silence while the key is held');
  chat.pushToTalk = null; chat.muted = true; assert.equal(stream.track.enabled, false); assert.equal(chat.muted, true);
  chat.dispose(); assert.equal(stream.track.stopped, true); assert.equal(node.disconnected, true);
  const listener = new VoiceChat({ engine: audio, codec: 'adpcm', onPacket() {} }); chat.muted = false; assert.equal(listener.transmitting, false, 'a chat that never started can still listen');
});
