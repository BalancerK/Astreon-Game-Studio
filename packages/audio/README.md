# @engine/audio

Sound for games on the Web Audio API, with no files needed to get started. A mixer of named buses, positional sound, voice limiting with priorities, music with cross-fades, and sounds made in code. Zero dependencies.

```js
import { AudioEngine, onUserGesture, sfx, ambientLoop } from '@engine/audio';

// Browsers allow sound only after a click, key press or touch: create the engine there.
onUserGesture(async () => {
  const audio = new AudioEngine();
  const shot = audio.createSound(sfx.shot(), 'shot');     // made in code
  const boom = await audio.load('sounds/boom.ogg');       // or a file (wav, mp3, ogg: whatever the browser plays)
  audio.playMusic(audio.createSound(ambientLoop(), 'music'), { volume: 0.4 });

  audio.play(shot, { pitchVariation: 0.05 });                                  // plain
  audio.play(boom, { position: [x, y, z], refDistance: 4, maxDistance: 80 });  // placed in the world
  // every frame, after moving your camera:
  audio.setListener(camera.x, camera.y, camera.z, camera.yaw, camera.pitch);
  audio.update();
});
```

## What it does

| | |
|---|---|
| **Mixer** | Buses `master` plus `sfx`, `music`, `ui`, `voice` (or your own list). `setVolume(bus, v, fadeSeconds)`, `setMuted(bus, bool)`. The master bus ends in a limiter (a compressor, then a soft clipper that never exceeds +-1): eight loud sounds at once peak above 5 without it and stay below 1 with it. The compressor adds about 3 dB of make-up gain to quiet sounds (that is how Web Audio compressors work); pass `compressor: false` for the plain level. |
| **Playing** | `play(sound, options)` returns a voice (or `null` if it was not started). Options: `bus`, `volume`, `pitch` (playback speed), `pitchVariation` (random +-fraction, so repeated sounds differ), `loop`, `pan`, `position`, `priority`, `maxPerSound`, `fadeIn`, `delay`, `offset`, `onEnded`. A voice has `stop(fade)`, `setVolume(v, time)`, `setPitch(p, time)`, `setPosition(x, y, z)`, `setPan(p)`, `playing`. |
| **Positional sound** | Give `position: [x, y, z]` and the sound is placed relative to the listener: loudness from distance (`inverse` like real sound, `linear`, or `exponential`; full volume inside `refDistance`, a smooth fade to nothing at `maxDistance`, `rolloff` for steepness) and left-right panning from direction (equal-power stereo). Sounds beyond `maxDistance` are not started at all. The listener uses the camera conventions of the rest of the engine (right-handed, +y up, yaw 0 looks down -z, positive yaw turns left). Add `velocity: [vx, vy, vz]` (or `voice.setVelocity`) and the pitch is Doppler shifted against the listener's own `setListenerVelocity` (`engine.speedOfSound`, `doppler: 0..1` for less); `absorption: 0..1` makes the air take the highs off distant sounds (on top of any `occlusion`). `dopplerRatio` is the pure maths. Not done: HRTF, reverb zones. |
| **Voice limits** | At most `maxVoices` (default 48) at once. When full, the lowest `priority` and then the oldest gives way (a fade of 20 ms), and a new sound less important than everything playing is refused. `maxPerSound` stops a machine gun taking every slot. Counters in `audio.stats`. |
| **Music** | `playMusic(sound, { volume, fade })` cross-fades from the current track; asking for the track that is playing does nothing; `stopMusic(fade)`. |
| **Layered music** | `audio.playLayers({ pad, bass, drums, lead }, { bpm, levels, fade })` plays the stems of one tune (all the same length) from one start instant, looping together so they never drift. `music.setIntensity(0..1, fade)` brings layers in as it rises (`levels`: the intensity each starts at, or `{ at, width, max }`), `setLayer(name, level, fade)` sets one by hand, `setVolume`. `music.stinger(sound, { quantize: 'beat' \| 'bar' })` plays a jingle exactly on the next beat or bar line (needs `bpm`), `untilBeat()`, `position`. It cross-fades from whatever music was playing and `stopMusic` stops it. |
| **Starting up** | An `AudioContext` made before the first gesture is refused (and logged) by browsers. `onUserGesture(cb)` runs `cb` at the first click, key press or touch: create the engine inside it. An engine made earlier still works: `unlockOnGesture` resumes it at the first gesture, one-shot sounds are skipped until then (a burst of stale sounds would otherwise play at once) and looping music waits. The context is suspended while the tab is hidden. |
| **Sounds in code** | `synthesize(spec)` renders layers of sine, square, saw, triangle or noise with an attack/decay envelope, pitch glides, a low-pass filter (which can sweep) and vibrato, into mono samples; the same spec and seed always give the same sound, and it runs in Node. `sfx` is a library of game sounds (`shot`, `hit`, `ping`, `explosion`, `jump`, `land`, `footstep`, `click`, `coin`, `powerup`, `alarm`), many taking a variation number. `sequence({ bpm, tracks })` plays note lists (`['A3', 1]`, `[null, 2]` for a rest) into a loop that starts and ends silent so it repeats without a click; `ambientLoop()` is a ready-made calm 8-second tune. `noteFrequency('A4')` is 440. |
| **Files** | `load(url)` / `loadAll({ name: url })` fetch and decode with the browser's decoder. |
| **Effects** | `addEffect(bus, effect)` puts an effect on any bus (master too); everything on the bus passes through, in the order added. Make one with `lowpass(hz)`, `highpass(hz)`, `bandpass(hz)`, `filter(type, hz, { q, gain })` (also notch, shelves, peaking), `reverb({ seconds, damping, wet, preDelay })`, `echo({ time, feedback, wet })` or `compressor({ threshold, ratio })`. The handle changes it while it plays: `fx.set({ frequency: 300 }, 0.5)` glides, `fx.enabled = false` bypasses (and costs nothing), `fx.remove()`. The reverb's room is made from a seeded impulse response (`reverbImpulse`), the same every time, falling 60 dB over `seconds` with the highs dying first. |
| **Ducking** | `addDuck({ target: 'music', trigger: 'voice', amount: 0.3, attack, hold, release })` turns the target bus down while anything plays on the trigger bus and brings it back after the hold and release; several rules on one target: the quietest wins. `setDuck(bus, level, fade)` does it by hand. |
| **Occlusion** | A sound behind a wall: `play(sound, { position, occlusion: 0.8 })` or `voice.setOcclusion(1, 0.2)` (0 clear, 1 a thick wall) dulls it with a low-pass filter and makes it quieter. The engine does not know your walls: cast a ray from the listener to the source (the physics `raycast`) and pass how much is in the way. |
| **Sprites** | Many sounds in one buffer: `packSounds({ shot, boom, ... })` joins sounds made in code (or any `{ sampleRate, data }`) with a short gap and returns the map of where each lies; `audio.createSprite(packed)` (or `createSprite(sound, { name: [start, length, loop?] })` for a file from another tool, `spriteMapFromMs` reads the common millisecond form) and `audio.playSprite(sprite, 'boom', options)` play one region with all the usual options. A region marked `loop` loops inside itself, and voice limits (`maxPerSound`) count each region as its own sound. |
| **Streaming music** | `audio.streamMusic(url, { volume, fade, loop })` plays a long track through a media element instead of decoding it whole (a five-minute song is about 50 MB of samples), routed through the `music` bus so volume, effects, ducking and cross-fades all apply. It starts at once. The track has `pause()`, `resume()`, `seek(seconds)`, `currentTime`, `duration`, `setVolume`, `stop(fade)`, `onEnded`, `onError`; a browser that refuses to start it before a gesture is retried at the first one (`blocked`). It replaces whatever music is playing, buffer or stream. A looping stream loops by the element's own `loop`, which can leave a tiny gap: for a seamless loop use a decoded sound. |
| **Microphone** | `await Microphone.open({ context: audio.context })` asks the player (rejects with `NotAllowedError` or `NotFoundError`), with the browser's echo cancellation, noise suppression and automatic gain on. `mic.update()` each frame keeps `level` (smoothed loudness) and `speaking` (voice activity: needs `attackMs` of sound to open, `holdMs` to close) up to date; `mic.muted`, `mic.close()` (the browser's indicator goes off), `Microphone.devices()`. `captureFrames(mic, onFrame, { sampleRate: 16000, frameMs: 20 })` delivers fixed frames, read by an audio worklet (a script processor where there is none) and resampled. |
| **Voice chat** | `VoiceChat` is transport-agnostic: you give it `onPacket` (send these) and call `receive(playerId, bytes)` (these came in). `await chat.start()` opens the microphone; it sends while someone is speaking (or by `pushToTalk`), marks the end of each burst, and for each remote player runs a jitter buffer (puts packets in order, covers losses with a repeat and a gap, drops duplicates and late ones, adapts its delay to the network), a decoder and playback on the `voice` bus, so a speaker can be placed in the world (`setSpeakerPosition`: distance and left-right like any positioned sound) or heard evenly (a team radio), and ducking and effects on `voice` apply. Per-player `setSpeakerVolume`, `muteSpeaker`, whole-chat `deafen` and `muted`, `onSpeaking(id, on)`, `onTransmit(on)`, `level`, `stats`. Call `chat.update()` each frame. |
| **Voice codecs and packets** | `'opus'` (the browser's WebCodecs, where it has them: about 1.7 KB/s in the browser test at 24 kbit/s), `'adpcm'` (IMA ADPCM in plain JavaScript, 8 KB/s, 25 dB or better signal-to-noise, each frame starts with the encoder state so a lost frame never damages the next) and `'pcm16'` (32 KB/s). The default is Opus where it exists, else ADPCM; a listener decodes whichever codec a packet says it uses. A packet is 8 bytes of header (flags, codec, sequence, time) and the audio; `decodeVoicePacket` returns null for anything malformed and never throws (fuzz-tested). |
| **Who hears whom** | `VoiceRouter` is the server's decision, with no sockets: `route(speaker, listeners)` returns `[{ id, gain, distance }]` for `'proximity'` (within `maxDistance`, fading with distance), `'team'` or `'global'`, a private `channel` (a party, heard only on the same one), and honours each listener's `deaf` and `muted`. |
| **Pure helpers** | `spatialize(listener, x, y, z, options)`, `distanceGain`, `VoicePool`: no Web Audio, so they work in Node and are easy to test. |

## Voice chat in a game

```js
import { VoiceChat } from '@engine/audio';
const chat = new VoiceChat({ engine: audio, onPacket: (bytes) => net.send(VOICE, bytes) });   // codec: Opus where the browser has it, else ADPCM
audio.addDuck({ target: 'music', trigger: 'voice', amount: 0.4 });                           // the music dips while someone talks
try { await chat.start(); } catch { /* no microphone, or the player said no: they can still listen */ }
net.onVoice = (fromId, bytes) => chat.receive(fromId, bytes);
// every frame:
for (const p of players) chat.setSpeakerPosition(p.id, [p.x, p.y, p.z]);
chat.update(); mic.level; chat.isSpeaking(id);
```

On the server, `VoiceRouter.route(speaker, listeners)` says who should be sent each packet (the server forwards the bytes unchanged). Over a WebSocket this costs the server only the forwarding; over WebRTC data channels (see `@engine/transport`) the players can send to each other directly. Voice is real time, so send it unreliably where the transport allows (a resent voice packet is a late one, which the jitter buffer throws away).

Not done: echo cancellation of your own (the browser's is used: wear headphones if it fails), loss-resilient Opus features (in-band FEC and packet loss concealment from the decoder: the buffer covers a lost frame by repeating the last one), noise gate tuning beyond the `vad` thresholds, recording or transcribing voice, and an audio level per speaker for a meter beyond `isSpeaking`.

## Tests

- `npm test` runs the unit tests: synthesis (pitch, envelopes, determinism, seamless loops), spatial maths, the voice pool, and the engine against a stand-in Web Audio context that records the graph and every parameter change.
- `node tools/audio-effects-test.js` renders sounds through the effects in headless Chrome and measures them: a low-pass takes a 4 kHz tone down by more than 30 dB and leaves 100 Hz alone, a high-pass the reverse, a filter that glides and is bypassed, a reverb tail that fades 60 dB over its length, echoes at 0.3 s and 0.6 s each quieter, ducking to exactly a quarter (-12 dB) and back, occlusion by a wall (39 dB at full), a master-bus filter, and a compressor narrowing the gap between loud and quiet.
- `node tools/audio-voice-test.js` runs sprites, streaming and voice in headless Chrome with a **fake microphone** (Chrome's own beeping test device) and autoplay allowed: a sprite region renders at its own pitch and stops at its end, the microphone opens and an audio worklet delivers 130 frames of 320 samples in 2.6 s, ADPCM (32 dB) and Opus (WebCodecs, under 90 bytes a frame, 440 Hz in and out) round trip, whole chats loop back (125 packets, none rejected, heard on the voice bus: ADPCM at 8 KB/s, Opus at 1.7 KB/s), and a streamed track is heard on the music bus, pauses, seeks, obeys the bus volume and ends.
- `node tools/audio-selftest.js` runs the engine through a real Web Audio graph in headless Chrome (an `OfflineAudioContext`) and measures the output samples: pitch, volume, left and right speakers, turning the listener, distance (an eighth as loud at 8 m as at 1 m), culling beyond the maximum, moving sources, bus volume and mute, pitch change, fades, the limiter, the built-in sounds, and decoding a real WAV file.

Not done (yet): distortion, chorus, pitch-shift and per-voice effect chains other than occlusion, convolution with your own recorded rooms, HRTF, streaming of long music files, an audio asset manager with bundles, voice chat.
