# @engine/audio

Web Audio mixer with buses and a limiter, positional sound, voice limits, music cross-fades, and sounds made in code (no files needed).

```
npm install @engine/audio
```

Version 0.1.0. The package's own README ([packages/audio](../../packages/audio/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (48 of 48 documented)

| Name | Kind | Summary |
|---|---|---|
| [`AdpcmCodec`](#class-adpcmcodec) | class | IMA ADPCM: four bits a sample, about 8 KB/s at 16 kHz mono, a quarter of 16-bit PCM and cheap enough to run in plain JavaScript anywhere. |
| [`AudioEngine`](#class-audioengine) | class | Sound for games on the Web Audio API: a mixer of named buses (master, sfx, music, ui, voice, or your own), voice limiting with priorities, positional sound relative to a listener (distance fall-off and left/right panning), music with cross-fades, and sounds that can be made in code (see `synth.js`) so a game needs no audio files to start. |
| [`AudioSprite`](#class-audiosprite) | class | One sound with named regions. |
| [`CODEC`](#codec) | constant | Codec numbers on the wire. |
| [`FrameSlicer`](#class-frameslicer) | class | Cuts a stream arriving in chunks of any size into frames of exactly `frameSamples`. |
| [`JitterBuffer`](#class-jitterbuffer) | class | Packets cross a network late, out of order, twice or not at all; speech has to come out at an even pace. |
| [`LayeredMusic`](#class-layeredmusic) | class | Layers of one tune that play in time together, with a volume each that follows an intensity, and stingers that land on the beat. |
| [`Microphone`](#class-microphone) | class | The microphone: asks the player's permission, gives a level meter and a speaking flag, and a stream of samples for a voice chat. |
| [`OpusCodec`](#class-opuscodec) | class | Opus through the browser's WebCodecs: speech in 2 to 3 KB/s (24 kbit/s here) with the loss handling Opus is known for. |
| [`Pcm16Codec`](#class-pcm16codec) | class | 16-bit samples, uncompressed: the plainest, 32 KB/s at 16 kHz. |
| [`Resampler`](#class-resampler) | class | Changes the sample rate of a stream that arrives in chunks of any size (an audio worklet's 128 samples, say). |
| [`StreamedTrack`](#class-streamedtrack) | class | A track being streamed. |
| [`VOICE_HEADER_BYTES`](#voice_header_bytes) | constant | Bytes before the payload of a voice packet. |
| [`VoiceActivity`](#class-voiceactivity) | class | Voice activity detection: says when someone is speaking from the level of each frame. |
| [`VoiceChat`](#class-voicechat) | class | Voice chat for a game: send your voice, hear the others. |
| [`VoicePlayback`](#class-voiceplayback) | class | One remote speaker being played: decoded frames are laid end to end on the audio clock, through a volume and (placed in the world) a distance gain and a left-right pan, onto the voice bus. |
| [`VoicePool`](#class-voicepool) | class | Decides which sounds may play. |
| [`VoiceRouter`](#class-voicerouter) | class | The server's side of voice chat: given who is talking and who is listening, decides who hears them and how loudly. |
| [`VoiceSender`](#class-voicesender) | class | Turns frames from a microphone into packets: decides whether to send (voice activity, push-to-talk or muted), encodes, numbers the packets, and marks the end of each burst of speech. |
| [`ambientLoop`](#ambientloop) | function | A ready-made calm loop for menus and ambience: a slow bass line under a soft arpeggio (8 seconds at 120 bpm). |
| [`bandpass`](#bandpass) | function | A filter that keeps a band of sounds around `frequency`. |
| [`captureFrames`](#captureframes) | function | Get the samples of a microphone as frames of `frameMs` at `sampleRate`: they are read by an audio worklet (off the main thread) and brought to the wanted rate. |
| [`compressor`](#compressor) | function | Evens out loudness: sound over `threshold` dB is turned down by `ratio`. |
| [`createCodec`](#createcodec) | function | Make a synchronous codec by name (`'pcm16'` or `'adpcm'`); for Opus use `OpusCodec.create`. |
| [`createListener`](#createlistener) | function | Where the listener is and which way it faces. |
| [`decodeVoicePacket`](#decodevoicepacket) | function | Read a voice packet. |
| [`distanceGain`](#distancegain) | function | Loudness of a source at a distance: the chosen model between `refDistance` and `maxDistance`, then a smooth fade to zero over the last fifth of that range so nothing pops out of existence. |
| [`dopplerRatio`](#dopplerratio) | function | Doppler shift: how much higher (above 1) or lower (below 1) a moving source sounds to a moving listener. |
| [`echo`](#echo) | function | Echo: the sound repeats every `time` seconds, each repeat `feedback` times as loud (below 1), mixed in at `wet`. |
| [`encodeVoicePacket`](#encodevoicepacket) | function | A voice packet: 8 bytes of header (flags, codec, sequence number, time in milliseconds) and the encoded audio. |
| [`filter`](#filter) | function | Any filter: `type` is lowpass, highpass, bandpass, notch, lowshelf, highshelf, peaking or allpass; `gain` in dB is used by the shelves and peaking. |
| [`highpass`](#highpass) | function | A filter that lets high sounds through and takes the lows off (a thin, tinny, telephone sound). |
| [`lowpass`](#lowpass) | function | A filter that lets low sounds through and takes the highs off (a muffled, underwater, behind-a-wall sound). |
| [`noteFrequency`](#notefrequency) | function | Frequency in Hz of a note name like 'A4', 'C#3' or 'Bb2' (A4 = 440). |
| [`occlusionFrequency`](#occlusionfrequency) | function | The cut-off frequency (Hz) that dulls a sound by `amount` (0 untouched, 1 fully muffled, as if heard through a thick wall). |
| [`onUserGesture`](#onusergesture) | function | Run `callback` once, at the first click, key press or touch. |
| [`opusAvailable`](#opusavailable) | function | Is Opus available here (the WebCodecs `AudioEncoder` / `AudioDecoder`, in recent Chrome, Edge and Firefox)? |
| [`packSounds`](#packsounds) | function | Join sounds into one buffer with a little silence between them, and say where each is. |
| [`peak`](#peak) | function | Largest absolute sample. |
| [`reverb`](#reverb) | function | Reverberation: the sound of a room. |
| [`reverbImpulse`](#reverbimpulse) | function | The impulse response of a room: decaying noise, made the same way every time from `seed` (a tiny generator, no `Math.random`). |
| [`rms`](#rms) | function | Root-mean-square level of a block of samples (0 silence, about 0.7 for a full-scale sine). |
| [`sequence`](#sequence) | function | Render a looping tune. |
| [`setListenerFromYawPitch`](#setlistenerfromyawpitch) | function | Put a listener at a position, facing the way a camera with this yaw and pitch looks. |
| [`sfx`](#sfx) | constant | A small library of game sounds as specs, so a prototype has sound from the first minute. |
| [`spatialize`](#spatialize) | function | How a source at (x, y, z) sounds to a listener. |
| [`spriteMapFromMs`](#spritemapfromms) | function | Read a sprite map written in milliseconds, the form many sprite tools and libraries use: `{ shot: [0, 450], music: [1000, 8000, true] }`. |
| [`synthesize`](#synthesize) | function | Render a spec into mono samples. |

## Functions

### `ambientLoop`

```js
function ambientLoop(sampleRate = 44100)
```

A ready-made calm loop for menus and ambience: a slow bass line under a soft arpeggio (8 seconds at 120 bpm).

<sub>src/synth.js:159</sub>

### `bandpass`

```js
function bandpass(frequency = 1000, q = 1)
```

A filter that keeps a band of sounds around `frequency`.

<sub>src/effects.js:19</sub>

### `captureFrames`

```js
async function captureFrames(mic, onFrame, { sampleRate = 16000, frameMs = 20 } = {})
```

Get the samples of a microphone as frames of `frameMs` at `sampleRate`: they are read by an audio worklet (off the main thread) and brought to the wanted rate. Falls back to a script
processor where worklets are missing. Returns `{ stop }`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `mic` | `Microphone` |  |
| `onFrame` | `(frame: Float32Array) => void` |  |
| `o` (optional) | `{sampleRate?: number, frameMs?: number}` | sampleRate 16000, frameMs 20. |

**Returns** `Promise<{stop: () => void}>`

<sub>src/voice.js:82</sub>

### `compressor`

```js
function compressor({ threshold = -24, ratio = 4, attack = 0.01, release = 0.2, knee = 12 } = {})
```

Evens out loudness: sound over `threshold` dB is turned down by `ratio`.

<sub>src/effects.js:33</sub>

### `createCodec`

```js
function createCodec(name)
```

Make a synchronous codec by name (`'pcm16'` or `'adpcm'`); for Opus use `OpusCodec.create`.

<sub>src/voice-core.js:195</sub>

### `createListener`

```js
function createListener()
```

Where the listener is and which way it faces. Create with `createListener()`.

<sub>src/spatial.js:8</sub>

### `decodeVoicePacket`

```js
function decodeVoicePacket(bytes)
```

Read a voice packet. Anything malformed returns null (a network boundary: never throws).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array` |  |

**Returns** `{codec: number, seq: number, timestamp: number, payload: Uint8Array, end: boolean} \| null`

<sub>src/voice-core.js:219</sub>

### `distanceGain`

```js
function distanceGain(distance, { model = 'inverse', refDistance = 1, maxDistance = 50, rolloff = 1 } = {})
```

Loudness of a source at a distance: the chosen model between `refDistance` and `maxDistance`, then a smooth fade to zero over
the last fifth of that range so nothing pops out of existence.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `distance` | `number` |  |
| `o` (optional) | `DistanceOptions` |  |

<sub>src/spatial.js:40</sub>

### `dopplerRatio`

```js
function dopplerRatio(listener, listenerVelocity, position, velocity, speedOfSound = 343, strength = 1)
```

Doppler shift: how much higher (above 1) or lower (below 1) a moving source sounds to a moving listener. A source coming at you, or you going at it, raises the pitch; going
away lowers it. Only the speeds along the line between the two count. The result is held to 0.5..2 so a shout across a supersonic gap cannot make noise.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `listener` | `ReturnType<typeof createListener>` |  |
| `listenerVelocity` | `number[]` | [vx, vy, vz] in metres per second |
| `position` | `number[]` | where the source is |
| `velocity` | `number[]` | how the source moves |
| `speedOfSound` (optional) | `number` | metres per second (343 in air; a game with huge, fast things can raise it) |
| `strength` (optional) | `number` | 0 no shift .. 1 the true shift (a game may want less) |

<sub>src/spatial.js:89</sub>

### `echo`

```js
function echo({ time = 0.3, feedback = 0.4, wet = 0.3 } = {})
```

Echo: the sound repeats every `time` seconds, each repeat `feedback` times as loud (below 1), mixed in at `wet`.

<sub>src/effects.js:31</sub>

### `encodeVoicePacket`

```js
function encodeVoicePacket({ codec, seq, timestamp, payload, end = false })
```

A voice packet: 8 bytes of header (flags, codec, sequence number, time in milliseconds) and the encoded audio. A packet with `end` set and no audio marks the end of a burst of speech.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `p` | `{codec: number, seq: number, timestamp: number, payload: Uint8Array, end?: boolean}` |  |

**Returns** `Uint8Array`

<sub>src/voice-core.js:211</sub>

### `filter`

```js
function filter(type, frequency = 1000, { q = 0.7, gain = 0 } = {})
```

Any filter: `type` is lowpass, highpass, bandpass, notch, lowshelf, highshelf, peaking or allpass; `gain` in dB is used by the shelves and peaking.

<sub>src/effects.js:21</sub>

### `highpass`

```js
function highpass(frequency = 400, q = 0.7)
```

A filter that lets high sounds through and takes the lows off (a thin, tinny, telephone sound).

<sub>src/effects.js:17</sub>

### `lowpass`

```js
function lowpass(frequency = 800, q = 0.7)
```

A filter that lets low sounds through and takes the highs off (a muffled, underwater, behind-a-wall sound). `frequency` in Hz is where the sound starts to dull.

<sub>src/effects.js:15</sub>

### `noteFrequency`

```js
function noteFrequency(name)
```

Frequency in Hz of a note name like 'A4', 'C#3' or 'Bb2' (A4 = 440).

<sub>src/synth.js:130</sub>

### `occlusionFrequency`

```js
function occlusionFrequency(amount)
```

The cut-off frequency (Hz) that dulls a sound by `amount` (0 untouched, 1 fully muffled, as if heard through a thick wall).

<sub>src/effects.js:139</sub>

### `onUserGesture`

```js
function onUserGesture(callback, target = globalThis)
```

Run `callback` once, at the first click, key press or touch. Browsers only let a page make sound after such a gesture (and log a
warning if you create an `AudioContext` earlier), so the cleanest way to start audio is to create the engine in here.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `callback` | `() => void` |  |
| `target` (optional) | `EventTarget` |  |

**Returns** `() => void` — cancel

<sub>src/engine.js:56</sub>

### `opusAvailable`

```js
function opusAvailable()
```

Is Opus available here (the WebCodecs `AudioEncoder` / `AudioDecoder`, in recent Chrome, Edge and Firefox)?

<sub>src/voice-core.js:150</sub>

### `packSounds`

```js
function packSounds(sounds, { gap = 0.05, loop = [] } = {})
```

Join sounds into one buffer with a little silence between them, and say where each is. Give it what `synthesize` returns (`{ sampleRate, data }`), keyed by name; all must share one sample rate.
Pass the result to `AudioEngine.createSprite` (or `createSound` and `new AudioSprite`).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `sounds` | `Record<string, {sampleRate: number, data: Float32Array}>` |  |
| `o` (optional) | `{gap?: number, loop?: string[]}` | `gap`: seconds of silence between sounds (0.05); `loop`: names that loop. |

**Returns** `{sampleRate: number, data: Float32Array, map: Record<string, [number, number, boolean]>}`

<sub>src/sprites.js:57</sub>

### `peak`

```js
function peak(samples)
```

Largest absolute sample.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `samples` | `Float32Array` |  |

<sub>src/voice-core.js:17</sub>

### `reverb`

```js
function reverb({ seconds = 1.5, damping = 0.5, wet = 0.3, preDelay = 0.01, seed = 1 } = {})
```

Reverberation: the sound of a room. `seconds` is how long the tail lasts (0.3 a small room, 2 a hall, 5 a cathedral), `damping` 0 to 1 how much the highs die first (dull
rooms), `wet` how much reverb is mixed in (0 none, 1 only reverb), `preDelay` seconds before it starts.

<sub>src/effects.js:29</sub>

### `reverbImpulse`

```js
function reverbImpulse(sampleRate, seconds, damping = 0.5, seed = 1)
```

The impulse response of a room: decaying noise, made the same way every time from `seed` (a tiny generator, no `Math.random`). It falls by 60 dB in `seconds`, and with
`damping` the highs fall faster than the lows. Returned as two channels (left and right differ, which is what makes it sound wide).

**Returns** `Float32Array[]`

<sub>src/effects.js:40</sub>

### `rms`

```js
function rms(samples)
```

Root-mean-square level of a block of samples (0 silence, about 0.7 for a full-scale sine).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `samples` | `Float32Array` |  |

<sub>src/voice-core.js:9</sub>

### `sequence`

```js
function sequence({ bpm = 120, sampleRate = 44100, tracks })
```

Render a looping tune. Each track is a list of `[note, beats]` (note `null` is a rest, a list of names is a chord); tracks play together. The result is
exactly `beats * 60 / bpm` seconds long and starts and ends silent, so it loops without a click.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `{bpm?: number, sampleRate?: number, tracks: {wave?: SynthLayer['wave'], gain?: number, decay?: number, lowpass?: number, notes: [string \| null, number][]}[]}` |  |

**Returns** `PcmSound`

<sub>src/synth.js:142</sub>

### `setListenerFromYawPitch`

```js
function setListenerFromYawPitch(listener, x, y, z, yaw, pitch = 0)
```

Put a listener at a position, facing the way a camera with this yaw and pitch looks.

**Returns** `ReturnType<typeof createListener>` — the same listener

<sub>src/spatial.js:16</sub>

### `spatialize`

```js
function spatialize(listener, x, y, z, o = {}, out = { gain: 0, pan: 0, distance: 0 })
```

How a source at (x, y, z) sounds to a listener.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `listener` | `ReturnType<typeof createListener>` |  |
| `x` | `number` |  |
| `y` | `number` |  |
| `z` | `number` |  |
| `o` (optional) | `DistanceOptions` |  |
| `out` (optional) | `{gain: number, pan: number, distance: number}` |  |

**Returns** `{gain: number, pan: number, distance: number}` — gain 0..1; pan -1 (full left) .. 1 (full right); distance in metres

<sub>src/spatial.js:64</sub>

### `spriteMapFromMs`

```js
function spriteMapFromMs(ms)
```

Read a sprite map written in milliseconds, the form many sprite tools and libraries use: `{ shot: [0, 450], music: [1000, 8000, true] }`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `ms` | `Record<string, [number, number] \| [number, number, boolean]>` |  |

**Returns** `Record<string, [number, number, boolean]>` — the same in seconds

<sub>src/sprites.js:44</sub>

### `synthesize`

```js
function synthesize({ duration = 0.3, sampleRate = 44100, seed = 1, gain = 1, peak = 0.9, layers = [] } = {})
```

Render a spec into mono samples.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `SynthSpec` |  |

**Returns** `PcmSound`

<sub>src/synth.js:39</sub>

## Classes

### `class AdpcmCodec`

```js
class AdpcmCodec
```

IMA ADPCM: four bits a sample, about 8 KB/s at 16 kHz mono, a quarter of 16-bit PCM and cheap enough to run in plain JavaScript anywhere. Each frame starts with the encoder's state, so a lost
frame never damages the next one. Speech comes through clearly; it is not as small as Opus.

#### `AdpcmCodec.constructor`

```js
constructor()
```

#### `AdpcmCodec.encode`

```js
encode(frame)
```

#### `AdpcmCodec.decode`

```js
decode(bytes, samples = (bytes.length - 3) * 2)
```

<sub>src/voice-core.js:112</sub>

### `class AudioEngine`

```js
class AudioEngine
```

Sound for games on the Web Audio API: a mixer of named buses (master, sfx, music, ui, voice, or your own), voice limiting
with priorities, positional sound relative to a listener (distance fall-off and left/right panning), music with cross-fades,
and sounds that can be made in code (see `synth.js`) so a game needs no audio files to start.

Browsers keep audio silent until the player has interacted with the page; the engine listens for the first click, key press
or touch and starts then (`unlockOnGesture`). Until it is running, one-shot sounds are skipped (a burst of stale sounds
would play the moment it unlocks) while looping music is kept waiting.

#### `AudioEngine.constructor`

```js
constructor({ context, buses = DEFAULT_BUSES, maxVoices = 48, compressor = true, unlock = true, pauseWhenHidden = true, skipWhenSuspended = true } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.context` (optional) | `BaseAudioContext` | Use this context (for example an `OfflineAudioContext` in a test); default: a new `AudioContext` |
| `o.buses` (optional) | `string[]` | Extra bus names besides 'master' |
| `o.maxVoices` (optional) | `number` | Sounds playing at once (default 48) |
| `o.compressor` (optional) | `boolean` | A limiter on the master output so loud pile-ups do not clip: a compressor, then a soft clipper that never exceeds +-1 (default true). It adds about 3 dB of make-up gain to quiet sounds (that is how Web Audio compressors work). |
| `o.unlock` (optional) | `boolean` | Start on the first user gesture (default true when there is a page) |
| `o.pauseWhenHidden` (optional) | `boolean` | Suspend audio while the tab is hidden (default true) |
| `o.skipWhenSuspended` (optional) | `boolean` | Skip one-shot sounds while the context is not running (default true; an offline context renders from 'suspended', so give it false) |

#### `AudioEngine.state`

```js
get state
```

'running', 'suspended' or 'closed'. Sounds only play while 'running'.

#### `AudioEngine.activeVoices`

```js
get activeVoices
```

Number of voices playing right now.

#### `AudioEngine.resume`

```js
resume()
```

#### `AudioEngine.suspend`

```js
suspend()
```

#### `AudioEngine.unlockOnGesture`

```js
unlockOnGesture(target = globalThis)
```

Start the audio at the first click, key press or touch on `target` (browsers require a gesture).

| Name | Type | Description |
|---|---|---|
| `target` (optional) | `EventTarget` |  |

#### `AudioEngine.setVolume`

```js
setVolume(bus, volume, fade = 0)
```

Set a bus's volume (0..1+), optionally fading over `fade` seconds.

#### `AudioEngine.getVolume`

```js
getVolume(bus)
```

#### `AudioEngine.setMuted`

```js
setMuted(bus, muted, fade = 0)
```

Mute or unmute a bus without losing its volume setting.

#### `AudioEngine.isMuted`

```js
isMuted(bus)
```

#### `AudioEngine.addEffect`

```js
addEffect(bus, spec)
```

Put an effect on a bus: everything that plays on it passes through (effects run in the order added). Make the description with `lowpass`, `highpass`, `bandpass`, `filter`,
`reverb`, `echo` or `compressor`. Returns a handle: `handle.set({ frequency: 400 }, 0.5)` glides a setting, `handle.enabled = false` bypasses it, `handle.remove()` takes it out.

| Name | Type | Description |
|---|---|---|
| `bus` | `string` |  |
| `spec` | `import('./effects.js').EffectSpec` |  |

**Returns** `import('./effects.js').EffectHandle & {remove: () => void, bus: string}`

#### `AudioEngine.removeEffect`

```js
removeEffect(handle)
```

Take an effect off its bus.

#### `AudioEngine.effects`

```js
effects(bus)
```

The effects on a bus, in order.

#### `AudioEngine.addDuck`

```js
addDuck({ target, trigger, amount = 0.3, attack = 0.05, release = 0.6, hold = 0.15 })
```

Ducking: turn the `target` bus down while anything plays on the `trigger` bus (music quieter while someone speaks). The target dips to `amount` of its volume over `attack`
seconds, holds for `hold` seconds after the last trigger sound ends, and recovers over `release`. Several rules can share a target; the quietest wins.

| Name | Type | Description |
|---|---|---|
| `o` | `{target: string, trigger: string, amount?: number, attack?: number, release?: number, hold?: number}` |  |

**Returns** `{remove: () => void}`

#### `AudioEngine.setDuck`

```js
setDuck(bus, level, fade = 0)
```

Set a bus's ducking level by hand (1 normal, 0.3 dipped), gliding over `fade` seconds. Rules from `addDuck` take over again the next time a trigger starts or ends.

#### `AudioEngine.createSound`

```js
createSound(source, name = `sound${nextSoundKey}`)
```

Make a playable sound from a decoded `AudioBuffer`, PCM samples (`{sampleRate, data}`, e.g. from `synthesize`) or a synth spec.

| Name | Type | Description |
|---|---|---|
| `source` | `AudioBuffer \| {sampleRate: number, data: Float32Array} \| import('./synth.js').SynthSpec` |  |
| `name` (optional) | `string` |  |

**Returns** `Sound`

#### `AudioEngine.load`

```js
async load(url, name = url)
```

Download and decode an audio file (anything the browser plays: wav, mp3, ogg...).

#### `AudioEngine.loadAll`

```js
async loadAll(files)
```

Load several files at once: `{ shot: 'sfx/shot.ogg', ... }` gives `{ shot: Sound, ... }`.

#### `AudioEngine.play`

```js
play(sound, opts = {})
```

Play a sound. Returns a voice you can adjust or stop, or null when the sound was not started (the engine is not running yet,
the sound is too far away to hear, or every voice is busy with something more important).

| Name | Type | Description |
|---|---|---|
| `sound` | `Sound` |  |
| `opts` (optional) | `PlayOptions` |  |

#### `AudioEngine.stopAll`

```js
stopAll(bus, fade = 0)
```

Stop every voice (on one bus, or all of them), optionally fading out.

#### `AudioEngine.createSprite`

```js
createSprite(source, map, name = 'sprite')
```

Make a sprite: one sound with named regions. Give it a `Sound` and a map `{ name: [start, duration, loop?] }` in seconds, or what `packSounds` returned.

| Name | Type | Description |
|---|---|---|
| `source` | `Sound \| {sampleRate: number, data: Float32Array, map: Record<string, any>}` |  |
| `map` (optional) | `Record<string, any>` |  |
| `name` (optional) | `string` |  |

**Returns** `AudioSprite`

#### `AudioEngine.playSprite`

```js
playSprite(sprite, regionName, opts = {})
```

Play one region of a sprite by name, with the usual play options (position, pitch, bus, volume...). A region marked `loop` loops within itself.

| Name | Type | Description |
|---|---|---|
| `sprite` | `AudioSprite` |  |
| `regionName` | `string` |  |
| `opts` (optional) | `PlayOptions` |  |

#### `AudioEngine.playMusic`

```js
playMusic(sound, { volume = 1, fade = 1.5, bus = 'music' } = {})
```

Play a looping track on the 'music' bus, cross-fading from the current one. Asking for the track that already plays does nothing.

| Name | Type | Description |
|---|---|---|
| `sound` | `Sound` |  |
| `o` (optional) | `{volume?: number, fade?: number, bus?: string}` |  |

#### `AudioEngine.streamMusic`

```js
streamMusic(url, { volume = 1, fade = 1.5, bus = 'music', loop = true, createElement, onEnded, onError } = {})
```

Stream a long track from a file through the 'music' bus, cross-fading from the current one: it starts at once and keeps almost nothing in memory (see `StreamedTrack`).
Asking for the track that is already streaming does nothing. The result also has `pause`, `resume`, `seek`, `currentTime` and `duration`.

| Name | Type | Description |
|---|---|---|
| `url` | `string` |  |
| `o` (optional) | `{volume?: number, fade?: number, bus?: string, loop?: boolean, createElement?: () => HTMLMediaElement, onEnded?: () => void, onError?: (e: any) => void}` |  |

**Returns** `StreamedTrack`

#### `AudioEngine.playLayers`

```js
playLayers(layers, o = {})
```

Play music in layers that always stay in time with each other (stems of one tune, all the same length): drums, bass, a pad, a lead. All start at the same instant and loop together,
and you decide which are heard, so the music can follow the game: `music.setIntensity(0.8)` brings layers in as it rises, `music.setLayer('drums', 0, 2)` fades one out over two seconds.
Cross-fades from the music that is playing. See `LayeredMusic`.

| Name | Type | Description |
|---|---|---|
| `layers` | `Record<string, Sound>` |  |
| `o` (optional) | `import('./music.js').LayeredOptions` |  |

**Returns** `LayeredMusic`

#### `AudioEngine.stopMusic`

```js
stopMusic(fade = 1)
```

#### `AudioEngine.setListener`

```js
setListener(x, y, z, yaw, pitch = 0)
```

Put the listener (your camera) somewhere and facing a direction (yaw and pitch as for `Camera3D`).

#### `AudioEngine.setListenerVelocity`

```js
setListenerVelocity(vx, vy, vz)
```

How fast the listener moves, metres per second, for the Doppler effect on sounds that have a `velocity`.

#### `AudioEngine.update`

```js
update()
```

Call once per frame after moving the listener and any sound sources: updates loudness and panning of positioned voices.

#### `AudioEngine.dispose`

```js
dispose()
```

Stop everything and release the audio device (if the engine made it).

<sub>src/engine.js:74</sub>

### `class AudioSprite`

```js
class AudioSprite
```

One sound with named regions. Make it with `AudioEngine.createSprite`.

#### `AudioSprite.constructor`

```js
constructor(sound, map)
```

| Name | Type | Description |
|---|---|---|
| `sound` | `import('./engine.js').Sound` | The one sound holding everything. |
| `map` | `Record<string, [number, number] \| [number, number, boolean] \| {start: number, duration: number, loop?: boolean}>` | Region by name, in seconds: `[start, duration, loop?]` or `{ start, duration, loop }`. |

#### `AudioSprite.names`

```js
get names
```

The names of the regions.

#### `AudioSprite.has`

```js
has(name)
```

#### `AudioSprite.region`

```js
region(name)
```

**Returns** `SpriteRegion`

<sub>src/sprites.js:13</sub>

### `class FrameSlicer`

```js
class FrameSlicer
```

Cuts a stream arriving in chunks of any size into frames of exactly `frameSamples`.

#### `FrameSlicer.constructor`

```js
constructor(frameSamples)
```

| Name | Type | Description |
|---|---|---|
| `frameSamples` | `number` |  |

#### `FrameSlicer.push`

```js
push(chunk)
```

| Name | Type | Description |
|---|---|---|
| `chunk` | `Float32Array` |  |

**Returns** `Float32Array[]` — the frames completed (each a fresh array)

<sub>src/voice-core.js:67</sub>

### `class JitterBuffer`

```js
class JitterBuffer
```

Packets cross a network late, out of order, twice or not at all; speech has to come out at an even pace. The jitter buffer holds a few frames back (the *delay*), puts them in order, and
on each tick of the playback clock (`pull`, once per frame) gives the next frame, or says one is missing so the player can cover the gap. The delay adapts: it grows when packets keep
arriving too late to use and shrinks again when the network is steady. A burst of speech ends with an `end` packet, after which the buffer goes quiet until the next burst.

#### `JitterBuffer.constructor`

```js
constructor({ targetFrames = 3, minFrames = 2, maxFrames = 15, maxBuffered = 30, maxConceal = 8, adaptive = true } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.targetFrames` (optional) | `number` | How many frames to hold back to start (3, which is 60 ms of 20 ms frames). |
| `o.minFrames` (optional) | `number` | The least the adaptive delay goes down to (2). |
| `o.maxFrames` (optional) | `number` | The most it goes up to (15). |
| `o.maxBuffered` (optional) | `number` | Frames held before the oldest are dropped to catch up (30). |
| `o.maxConceal` (optional) | `number` | Missing frames in a row before it gives up and goes quiet (8). |
| `o.adaptive` (optional) | `boolean` |  |

#### `JitterBuffer.buffered`

```js
get buffered
```

Frames waiting.

#### `JitterBuffer.push`

```js
push(seq, frame, end = false)
```

A packet arrived.

| Name | Type | Description |
|---|---|---|
| `seq` | `number` |  |
| `frame` | `any` | What `pull` will hand back (decoded samples, or the payload). |
| `end` (optional) | `boolean` |  |

#### `JitterBuffer.pull`

```js
pull()
```

One tick of the playback clock. Returns `{ kind: 'frame', frame }`, `{ kind: 'lost' }` (cover the gap: a frame was due and has not come), or `{ kind: 'idle' }` (nothing to play: before
the first burst, between bursts, or after the sender went quiet).

**Returns** `{kind: 'frame' \| 'lost' \| 'idle', frame?: any, end?: boolean}`

#### `JitterBuffer.reset`

```js
reset()
```

<sub>src/voice-core.js:235</sub>

### `class LayeredMusic`

```js
class LayeredMusic
```

Layers of one tune that play in time together, with a volume each that follows an intensity, and stingers that land on the beat. Made by `AudioEngine.playLayers`.

#### `LayeredMusic.constructor`

```js
constructor(engine, layers, { bus = 'music', volume = 1, fade = 1.5, bpm = 0, beatsPerBar = 4, levels = {}, intensity = 0 } = {})
```

| Name | Type | Description |
|---|---|---|
| `engine` | `import('./engine.js').AudioEngine` |  |
| `layers` | `Record<string, import('./engine.js').Sound>` |  |
| `o` (optional) | `LayeredOptions` |  |

#### `LayeredMusic.playing`

```js
get playing
```

True until `stop` is called.

#### `LayeredMusic.levelsNow`

```js
levelsNow()
```

How loud each layer is meant to be right now (0..1+).

#### `LayeredMusic.setIntensity`

```js
setIntensity(value, fade = 1)
```

Set the intensity, 0 (calm) to 1 (everything), gliding over `fade` seconds. Layers set by hand with `setLayer` follow the intensity again.

#### `LayeredMusic.setLayer`

```js
setLayer(name, level, fade = 1)
```

Set one layer's level by hand, gliding over `fade` seconds.

#### `LayeredMusic.setVolume`

```js
setVolume(volume, fade = 0)
```

The overall level of the whole tune (its layers keep their balance).

#### `LayeredMusic.position`

```js
get position
```

Seconds into the loop now.

#### `LayeredMusic.untilBeat`

```js
untilBeat(unit = 'beat')
```

Seconds until the next beat (or bar, with `'bar'`). Needs the tempo (`bpm`).

#### `LayeredMusic.stinger`

```js
stinger(sound, { quantize = 'beat', bus = this.bus, volume = 1, duckMusic = 0 } = {})
```

Play a short sound so that it lands on the next beat or bar of the music (`quantize: 'beat' | 'bar'`; null plays it at once).

| Name | Type | Description |
|---|---|---|
| `sound` | `import('./engine.js').Sound` |  |
| `o` (optional) | `{quantize?: 'beat' \| 'bar' \| null, bus?: string, volume?: number, duckMusic?: number}` |  |

**Returns**  — the voice, or null

#### `LayeredMusic.stop`

```js
stop(fade = 1)
```

Fade out and stop every layer.

<sub>src/music.js:26</sub>

### `class Microphone`

```js
class Microphone
```

The microphone: asks the player's permission, gives a level meter and a speaking flag, and a stream of samples for a voice chat. The browser's own echo cancellation, noise suppression and
automatic gain are on by default (they matter a great deal for voice, especially without headphones).

#### `Microphone.open`

```js
static async open({ context, deviceId, echoCancellation = true, noiseSuppression = true, autoGainControl = true, vad = new VoiceActivity(), getStream } = {})
```

Ask for the microphone. Rejects if the player refuses or there is none (`error.name` is `NotAllowedError` or `NotFoundError`).

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.context` | `BaseAudioContext` | The audio context (usually `audio.context`). |
| `o.deviceId` (optional) | `string` | A device from `Microphone.devices()`. |
| `o.echoCancellation` (optional) | `boolean` |  |
| `o.noiseSuppression` (optional) | `boolean` |  |
| `o.autoGainControl` (optional) | `boolean` | (all true) |
| `o.vad` (optional) | `VoiceActivity` |  |
| `o.getStream` (optional) | `() => Promise<MediaStream>` | Replaces `getUserMedia` (tests). |

**Returns** `Promise<Microphone>`

#### `Microphone.devices`

```js
static async devices(mediaDevices = globalThis.navigator?.mediaDevices)
```

The microphones and headsets the player has: `[{ deviceId, label }]` (labels are empty until permission has been given).

#### `Microphone.constructor`

```js
constructor(context, stream, vad)
```

#### `Microphone.update`

```js
update(dt)
```

Read the level and the speaking state: call it each frame (or every 50 ms or so).

| Name | Type | Description |
|---|---|---|
| `dt` (optional) | `number` | Seconds since the last call (measured from the audio clock if left out). |

#### `Microphone.muted`

```js
set muted(v)
```

Mute the microphone itself (the browser stops using it: the indicator goes off).

#### `Microphone.muted`

```js
get muted
```

#### `Microphone.close`

```js
close()
```

Let go of the microphone and the permission indicator.

<sub>src/voice.js:15</sub>

### `class OpusCodec`

```js
class OpusCodec
```

Opus through the browser's WebCodecs: speech in 2 to 3 KB/s (24 kbit/s here) with the loss handling Opus is known for. Asynchronous; make it with `await OpusCodec.create(...)`, and
only where `opusAvailable()`.

#### `OpusCodec.create`

```js
static async create({ sampleRate = 16000, bitrate = 24000 } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{sampleRate?: number, bitrate?: number}` | sampleRate 16000 (8000, 12000, 16000, 24000 or 48000), bitrate 24000. |

#### `OpusCodec.constructor`

```js
constructor(sampleRate, bitrate)
```

#### `OpusCodec.encode`

```js
encode(frame)
```

| Name | Type | Description |
|---|---|---|
| `frame` | `Float32Array` | 2.5, 5, 10, 20, 40 or 60 ms of samples |

**Returns** `Promise<Uint8Array>`

#### `OpusCodec.decode`

```js
decode(bytes)
```

| Name | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array` |  |

**Returns** `Promise<Float32Array>`

#### `OpusCodec.close`

```js
close()
```

<sub>src/voice-core.js:156</sub>

### `class Pcm16Codec`

```js
class Pcm16Codec
```

16-bit samples, uncompressed: the plainest, 32 KB/s at 16 kHz. Good for testing and for a fast local network.

#### `Pcm16Codec.constructor`

```js
constructor()
```

#### `Pcm16Codec.encode`

```js
encode(frame)
```

#### `Pcm16Codec.decode`

```js
decode(bytes)
```

<sub>src/voice-core.js:91</sub>

### `class Resampler`

```js
class Resampler
```

Changes the sample rate of a stream that arrives in chunks of any size (an audio worklet's 128 samples, say). Going down (48 kHz to 16 kHz) it averages over each output sample's span,
which also removes what the lower rate could not hold; going up it interpolates.

#### `Resampler.constructor`

```js
constructor(fromRate, toRate)
```

| Name | Type | Description |
|---|---|---|
| `fromRate` | `number` |  |
| `toRate` | `number` |  |

#### `Resampler.push`

```js
push(chunk)
```

| Name | Type | Description |
|---|---|---|
| `chunk` | `Float32Array` |  |

**Returns** `Float32Array` — the samples that are now complete

#### `Resampler.reset`

```js
reset()
```

<sub>src/voice-core.js:41</sub>

### `class StreamedTrack`

```js
class StreamedTrack
```

A track being streamed. It looks like a voice to the engine (`playing`, `stop(fade)`, `setVolume`), and adds what a long track needs: `pause`, `resume`, `seek`, `currentTime`, `duration`.

#### `StreamedTrack.constructor`

```js
constructor(engine, url, { volume = 1, fade = 0, bus = 'music', loop = true, element, createElement, crossOrigin = 'anonymous', onEnded = null, onError = null } = {})
```

| Name | Type | Description |
|---|---|---|
| `engine` | `import('./engine.js').AudioEngine` |  |
| `url` | `string` |  |
| `o` (optional) | `{volume?: number, fade?: number, bus?: string, loop?: boolean, element?: HTMLMediaElement, createElement?: () => HTMLMediaElement, crossOrigin?: string \| null, onEnded?: () => void, onError?: (e: any) => void}` |  |

#### `StreamedTrack.start`

```js
start()
```

Begin (or retry) playback: browsers may refuse until the page has had a gesture, in which case `blocked` is true and the engine retries at the next gesture.

#### `StreamedTrack.playing`

```js
get playing
```

True while the track is on (paused counts: it is still the current track).

#### `StreamedTrack.paused`

```js
get paused
```

#### `StreamedTrack.currentTime`

```js
get currentTime
```

Where it is, in seconds.

#### `StreamedTrack.duration`

```js
get duration
```

How long it is, in seconds (NaN until the browser knows).

#### `StreamedTrack.pause`

```js
pause()
```

#### `StreamedTrack.resume`

```js
resume()
```

#### `StreamedTrack.seek`

```js
seek(seconds)
```

Jump to a time in seconds.

#### `StreamedTrack.setVolume`

```js
setVolume(v, time = 0)
```

Change the volume now or over `time` seconds.

#### `StreamedTrack.stop`

```js
stop(fade = 0)
```

Fade out over `fade` seconds and stop.

<sub>src/stream.js:10</sub>

### `class VoiceActivity`

```js
class VoiceActivity
```

Voice activity detection: says when someone is speaking from the level of each frame. It needs the level above `threshold` for `attackMs` before it says yes (so a click or a cough does not
open it), and keeps saying yes for `holdMs` after the level drops (so the ends of words are not cut).

#### `VoiceActivity.constructor`

```js
constructor({ threshold = 0.015, attackMs = 40, holdMs = 300 } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{threshold?: number, attackMs?: number, holdMs?: number}` | threshold is an RMS level (0.015), attackMs 40, holdMs 300. |

#### `VoiceActivity.update`

```js
update(level, frameMs)
```

Feed the level of one frame lasting `frameMs`; returns whether speech is on.

#### `VoiceActivity.reset`

```js
reset()
```

<sub>src/voice-core.js:23</sub>

### `class VoiceChat`

```js
class VoiceChat
```

Voice chat for a game: send your voice, hear the others. You give it the audio engine, a codec and a place to send packets; it runs the microphone capture, voice detection or push-to-talk,
encoding, and for each remote player a jitter buffer, decoder and positioned playback on the engine's `voice` bus (which also takes part in the engine's ducking and effects: the music can
duck while players talk).

```js
const chat = new VoiceChat({ engine: audio, codec: 'adpcm', onPacket: (bytes) => net.sendVoice(bytes) });
await chat.start();                                   // asks for the microphone
net.onVoice = (fromId, bytes) => chat.receive(fromId, bytes);
// each frame: chat.setSpeakerPosition(id, [x, y, z]) for those in the world, then chat.update()
```

#### `VoiceChat.constructor`

```js
constructor({ engine, codec, onPacket, sampleRate = 16000, frameMs = 20, bitrate = 24000, vad = true, spatial = true, maxDistance = 40, jitterFrames = 3, clock = () => globalThis.performance?.now() ?? Date.now() })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.engine` | `import('./engine.js').AudioEngine` |  |
| `o.codec` (optional) | `'pcm16' \| 'adpcm' \| 'opus'` | Default 'opus' where the browser has it, else 'adpcm'. Others' packets are decoded by whatever codec they say they use. |
| `o.onPacket` | `(packet: Uint8Array) => void` | Your network: send this to the other players (or to the server, which routes it: see `VoiceRouter`). |
| `o.sampleRate` (optional) | `number` | 16000. |
| `o.frameMs` (optional) | `number` | 20. |
| `o.bitrate` (optional) | `number` | For Opus, 24000. |
| `o.vad` (optional) | `boolean \| {threshold?: number, attackMs?: number, holdMs?: number}` | Send only while speaking (default true); false sends everything while not muted. |
| `o.spatial` (optional) | `boolean` | Voices come from where their speakers are (default true; `setSpeakerPosition`). |
| `o.maxDistance` (optional) | `number` | How far a voice carries (40). |
| `o.jitterFrames` (optional) | `number` | Starting delay in frames (3). |
| `o.clock` (optional) | `() => number` | Milliseconds (default `performance.now`). |

#### `VoiceChat.start`

```js
async start(mic)
```

Ask for the microphone and start sending. Rejects if the player says no (the chat can still be used to listen: call `receive` without `start`).

| Name | Type | Description |
|---|---|---|
| `mic` (optional) | `Microphone \| Parameters<typeof Microphone.open>[0]` | An open microphone, or options for `Microphone.open` (`deviceId`, ...). |

#### `VoiceChat.transmitting`

```js
get transmitting
```

Are you transmitting now?

#### `VoiceChat.level`

```js
get level
```

Your microphone level, 0 to 1ish (for a meter).

#### `VoiceChat.pushToTalk`

```js
set pushToTalk(v)
```

Push-to-talk: `true` transmits, `false` does not, `null` goes back to voice detection.

#### `VoiceChat.muted`

```js
set muted(v)
```

Stop sending (you still hear others).

#### `VoiceChat.muted`

```js
get muted
```

#### `VoiceChat.deafen`

```js
set deafen(v)
```

Stop hearing everyone.

#### `VoiceChat.setSpeakerPosition`

```js
setSpeakerPosition(id, position)
```

Where a speaker is in the world (their voice comes from there). Pass `null` to hear them evenly (a teammate on a radio).

| Name | Type | Description |
|---|---|---|
| `id` | `any` |  |
| `position` | `number[] \| null` |  |

#### `VoiceChat.setSpeakerVolume`

```js
setSpeakerVolume(id, v)
```

Their volume, 0 to 1 and up.

#### `VoiceChat.muteSpeaker`

```js
muteSpeaker(id, muted = true)
```

Stop hearing one player.

#### `VoiceChat.isSpeaking`

```js
isSpeaking(id)
```

#### `VoiceChat.removeSpeaker`

```js
removeSpeaker(id)
```

Forget a speaker (they left).

#### `VoiceChat.receive`

```js
async receive(id, bytes)
```

A voice packet arrived from player `id`. Malformed packets are counted and ignored.

| Name | Type | Description |
|---|---|---|
| `id` | `any` |  |
| `bytes` | `Uint8Array` |  |

**Returns** `Promise<void>`

#### `VoiceChat.update`

```js
update()
```

Move playback along: call once per frame (or a few times a second at least). Pulls the frames that have come due from each speaker's jitter buffer and plays them.

#### `VoiceChat.dispose`

```js
dispose()
```

Stop everything: the microphone, the capture and every speaker.

<sub>src/voice.js:168</sub>

### `class VoicePlayback`

```js
class VoicePlayback
```

One remote speaker being played: decoded frames are laid end to end on the audio clock, through a volume and (placed in the world) a distance gain and a left-right pan, onto the voice bus.
`skip()` covers a missing frame with a moment of silence, `repeat()` with the last frame fading out.

#### `VoicePlayback.constructor`

```js
constructor(engine, { bus = 'voice', sampleRate = 16000, lead = 0.04, position = null, refDistance = 3, maxDistance = 40 } = {})
```

| Name | Type | Description |
|---|---|---|
| `engine` | `import('./engine.js').AudioEngine` |  |
| `o` (optional) | `{bus?: string, sampleRate?: number, lead?: number, position?: number[] \| null, maxDistance?: number, refDistance?: number}` |  |

#### `VoicePlayback.volume`

```js
set volume(v)
```

| Name | Type | Description |
|---|---|---|
| `v` | `number` | 0..1+ |

#### `VoicePlayback.volume`

```js
get volume
```

#### `VoicePlayback.setPosition`

```js
setPosition(x, y, z)
```

Re-aim the sound at the world position of the speaker (or `null` to hear them in your head, as for a team channel).

#### `VoicePlayback.update`

```js
update()
```

Call each frame so a moving speaker or listener stays in the right place.

#### `VoicePlayback.inaudible`

```js
get inaudible
```

Is this speaker out of earshot (so there is no point decoding them)?

#### `VoicePlayback.play`

```js
play(frame)
```

Lay a frame of samples at the end of what is already queued.

| Name | Type | Description |
|---|---|---|
| `frame` | `Float32Array` |  |

#### `VoicePlayback.skip`

```js
skip(samples)
```

A frame is missing: leave a gap the length of one.

| Name | Type | Description |
|---|---|---|
| `samples` | `number` |  |

#### `VoicePlayback.repeat`

```js
repeat()
```

A frame is missing: cover it with the last one played, fading out (one repeat sounds better than a hole).

#### `VoicePlayback.close`

```js
close()
```

Stop and let go.

<sub>src/voice.js:106</sub>

### `class VoicePool`

```js
class VoicePool
```

Decides which sounds may play. A mix can carry only so many voices at once, and a machine gun should not take every slot with
the same shot: `request` says whether a new sound may start and which running one has to give way (the least important, then the
oldest). Pure bookkeeping, it never touches Web Audio.

#### `VoicePool.constructor`

```js
constructor({ max = 48 } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.max` (optional) | `number` | Voices playing at once (default 48) |

#### `VoicePool.size`

```js
get size
```

#### `VoicePool.request`

```js
request({ key, priority = 0, maxPerSound = Infinity, now = 0 })
```

Ask to start a sound.

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.key` | `string` |  |
| `o.priority` (optional) | `number` |  |
| `o.maxPerSound` (optional) | `number` | At most this many copies of one sound at a time (default: no limit) |
| `o.now` (optional) | `number` | Time in seconds (for "oldest") |

**Returns** `{granted: boolean, id: number, steal: VoiceEntry \| null}` — If `steal` is set, stop that voice; if not granted, do not play.

#### `VoicePool.release`

```js
release(id)
```

A voice ended or was stopped.

#### `VoicePool.clear`

```js
clear()
```

<sub>src/voices.js:20</sub>

### `class VoiceRouter`

```js
class VoiceRouter
```

The server's side of voice chat: given who is talking and who is listening, decides who hears them and how loudly. Pure logic (no sockets): your game sends the packet to each returned id.
Modes: `'proximity'` (within `maxDistance`, fading with distance), `'team'` (same team, any distance), `'global'` (everyone). A speaker can also be on a private `channel` (a party), heard only
by listeners on the same one.

#### `VoiceRouter.constructor`

```js
constructor({ mode = 'proximity', maxDistance = 40, falloff = 'linear' } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{mode?: 'proximity' \| 'team' \| 'global', maxDistance?: number, falloff?: 'linear' \| 'inverse'}` |  |

#### `VoiceRouter.route`

```js
route(speaker, listeners)
```

| Name | Type | Description |
|---|---|---|
| `speaker` | `{id: any, x?: number, y?: number, z?: number, team?: any, channel?: any}` |  |
| `listeners` | `Iterable<{id: any, x?: number, y?: number, z?: number, team?: any, channel?: any, deaf?: boolean, muted?: Set<any>}>` |  |

**Returns** `{id: any, gain: number, distance: number}[]`

<sub>src/voice-core.js:367</sub>

### `class VoiceSender`

```js
class VoiceSender
```

Turns frames from a microphone into packets: decides whether to send (voice activity, push-to-talk or muted), encodes, numbers the packets, and marks the end of each burst of speech.
Frames are a fixed number of samples (`frameSamples`, 20 ms at the codec's rate). Works with synchronous codecs and with Opus (the packets then come out a moment later, in order).

#### `VoiceSender.constructor`

```js
constructor({ codec, frameMs = 20, onPacket, vad = new VoiceActivity(), clock = () => globalThis.performance?.now() ?? Date.now() })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.codec` | `{id: number, encode(frame: Float32Array): Uint8Array \| Promise<Uint8Array>}` |  |
| `o.frameMs` | `number` | Length of a frame in milliseconds (20). |
| `o.onPacket` | `(packet: Uint8Array) => void` | Where packets go: your network. |
| `o.vad` (optional) | `VoiceActivity \| null` | Send only while speech is detected (default: a standard detector); null sends everything. |
| `o.clock` (optional) | `() => number` | Milliseconds (default `performance.now`). |

#### `VoiceSender.speaking`

```js
get speaking
```

Is a burst of speech going out?

#### `VoiceSender.push`

```js
push(frame)
```

Feed one frame of microphone samples.

<sub>src/voice-core.js:313</sub>

## Constants

### `CODEC`

```js
const CODEC
```

Codec numbers on the wire.

Value: `Object.freeze({ pcm16: 0, adpcm: 1, opus: 2 })`

<sub>src/voice-core.js:86</sub>

### `VOICE_HEADER_BYTES`

```js
const VOICE_HEADER_BYTES
```

Bytes before the payload of a voice packet.

Value: `8`

<sub>src/voice-core.js:204</sub>

### `sfx`

```js
const sfx
```

A small library of game sounds as specs, so a prototype has sound from the first minute. Each takes an optional `variation`
(any number) so repeated sounds (footsteps, shots) are not identical.

Value: `{`

<sub>src/synth.js:91</sub>

## Types

### `DistanceOptions`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `model` (optional) | `'inverse' \| 'linear' \| 'exponential'` | How loudness falls with distance (default 'inverse', like real sound) |
| `refDistance` (optional) | `number` | Closer than this a sound is at full volume (default 1 m) |
| `maxDistance` (optional) | `number` | Beyond this a sound is silent and not worth playing (default 50 m) |
| `rolloff` (optional) | `number` | How fast it falls (default 1) |

### `EffectHandle`

Effects for audio buses: filters, reverb, echo and a compressor, made from standard Web Audio nodes. A factory such as `lowpass(800)` only describes the effect (plain data);
`AudioEngine.addEffect(bus, effect)` builds it on a bus and gives back a handle to change it while it plays.

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `kind` | `string` |  |
| `enabled` | `boolean` | Turn the effect on and off (it is taken out of the chain while off, so it costs nothing) |
| `set` | `(values: Record<string, number>, fade?: number) => void` | Change settings, optionally gliding over `fade` seconds (for example `{ frequency: 400 }`) |

### `EffectSpec`

Effects for audio buses: filters, reverb, echo and a compressor, made from standard Web Audio nodes. A factory such as `lowpass(800)` only describes the effect (plain data);
`AudioEngine.addEffect(bus, effect)` builds it on a bus and gives back a handle to change it while it plays.

Type: `{kind: string, [key: string]: any}`

| Name | Type | Description |
|---|---|---|
| `kind` | `string` |  |
| `enabled` | `boolean` | Turn the effect on and off (it is taken out of the chain while off, so it costs nothing) |
| `set` | `(values: Record<string, number>, fade?: number) => void` | Change settings, optionally gliding over `fade` seconds (for example `{ frequency: 400 }`) |

### `LayeredOptions`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `bus` (optional) | `string` | default 'music' |
| `volume` (optional) | `number` | overall level 0..1+ (default 1) |
| `fade` (optional) | `number` | seconds the music takes to fade in (default 1.5) |
| `bpm` (optional) | `number` | The tempo, for `stinger` and `untilBeat` |
| `beatsPerBar` (optional) | `number` | default 4 |
| `levels` (optional) | `Record<string, number \| {at: number, width?: number, max?: number}>` | When each layer is heard as the intensity (0..1) rises. A number is the intensity at which the layer starts (it is full over the next 0.2); an object gives `at`, `width` (the rise) and `max` (its top level). A layer with no entry is always full. Default intensity 0. |
| `intensity` (optional) | `number` | The starting intensity (default 0) |

### `PcmSound`

Mono samples in -1..1

Type: `{sampleRate: number, data: Float32Array}`

### `PlayOptions`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `buffer` | `AudioBuffer` |  |
| `duration` | `number` | Seconds |
| `key` | `string` | Unique id (the per-sound voice limit counts by it) |
| `bus` (optional) | `string` | Which bus it plays on (default 'sfx') |
| `volume` (optional) | `number` | 0..1+ (default 1) |
| `pitch` (optional) | `number` | Playback speed: 2 is an octave up (default 1) |
| `pitchVariation` (optional) | `number` | Random pitch change, +/- this fraction (0.05 = 5%): repeated sounds stop sounding identical |
| `loop` (optional) | `boolean` |  |
| `pan` (optional) | `number` | 1 (left) .. 1 (right) for sounds with no position |
| `position` (optional) | `number[] \| null` | [x, y, z] in the world: the sound is placed relative to the listener (distance and left/right) |
| `model` (optional) | `'inverse' \| 'linear' \| 'exponential'` | Distance model for positioned sounds (default 'inverse') |
| `refDistance` (optional) | `number` | Full volume closer than this (default 1) |
| `maxDistance` (optional) | `number` | Silent beyond this (default 50); one-shots that far away are not started at all |
| `rolloff` (optional) | `number` | How fast volume falls with distance (default 1) |
| `priority` (optional) | `number` | When voices run out, lower priority gives way first (default 0) |
| `maxPerSound` (optional) | `number` | At most this many copies of this sound at once |
| `fadeIn` (optional) | `number` | Seconds |
| `delay` (optional) | `number` | Seconds from now |
| `offset` (optional) | `number` | Start this many seconds into the sound |
| `duration` (optional) | `number` | Play only this many seconds from `offset` (a region of a longer sound; `playSprite` sets it). Without `loop`. |
| `loopStart` (optional) | `number` | With `loop`: go back to this time (seconds into the sound) at the end of the loop. |
| `loopEnd` (optional) | `number` | With `loop`: the end of the looped part. |
| `key` (optional) | `string` | What the per-sound voice limit counts this by (default: the sound; `playSprite` uses the sprite and the region) |
| `occlusion` (optional) | `number` | 0 (clear) to 1 (heard through a thick wall): dulls and quietens this sound; change it later with `voice.setOcclusion` |
| `velocity` (optional) | `number[]` | [vx, vy, vz] metres per second of a positioned source: its pitch is shifted by the Doppler effect against the listener's own velocity (`setListenerVelocity`); move it later with `voice.setVelocity` |
| `doppler` (optional) | `number` | How much of the true Doppler shift to apply, 0..1 (default 1) |
| `absorption` (optional) | `number` | 0..1: the air takes the highs off a distant sound: at 1 a sound at its `maxDistance` is as dull as one behind a thick wall. Combines with `occlusion`. |
| `onEnded` (optional) | `() => void` |  |

### `Sound`

A sound ready to play. Make one with `AudioEngine.createSound` or `load`.

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `buffer` | `AudioBuffer` |  |
| `duration` | `number` | Seconds |
| `key` | `string` | Unique id (the per-sound voice limit counts by it) |
| `bus` (optional) | `string` | Which bus it plays on (default 'sfx') |
| `volume` (optional) | `number` | 0..1+ (default 1) |
| `pitch` (optional) | `number` | Playback speed: 2 is an octave up (default 1) |
| `pitchVariation` (optional) | `number` | Random pitch change, +/- this fraction (0.05 = 5%): repeated sounds stop sounding identical |
| `loop` (optional) | `boolean` |  |
| `pan` (optional) | `number` | 1 (left) .. 1 (right) for sounds with no position |
| `position` (optional) | `number[] \| null` | [x, y, z] in the world: the sound is placed relative to the listener (distance and left/right) |
| `model` (optional) | `'inverse' \| 'linear' \| 'exponential'` | Distance model for positioned sounds (default 'inverse') |
| `refDistance` (optional) | `number` | Full volume closer than this (default 1) |
| `maxDistance` (optional) | `number` | Silent beyond this (default 50); one-shots that far away are not started at all |
| `rolloff` (optional) | `number` | How fast volume falls with distance (default 1) |
| `priority` (optional) | `number` | When voices run out, lower priority gives way first (default 0) |
| `maxPerSound` (optional) | `number` | At most this many copies of this sound at once |
| `fadeIn` (optional) | `number` | Seconds |
| `delay` (optional) | `number` | Seconds from now |
| `offset` (optional) | `number` | Start this many seconds into the sound |
| `duration` (optional) | `number` | Play only this many seconds from `offset` (a region of a longer sound; `playSprite` sets it). Without `loop`. |
| `loopStart` (optional) | `number` | With `loop`: go back to this time (seconds into the sound) at the end of the loop. |
| `loopEnd` (optional) | `number` | With `loop`: the end of the looped part. |
| `key` (optional) | `string` | What the per-sound voice limit counts this by (default: the sound; `playSprite` uses the sprite and the region) |
| `occlusion` (optional) | `number` | 0 (clear) to 1 (heard through a thick wall): dulls and quietens this sound; change it later with `voice.setOcclusion` |
| `velocity` (optional) | `number[]` | [vx, vy, vz] metres per second of a positioned source: its pitch is shifted by the Doppler effect against the listener's own velocity (`setListenerVelocity`); move it later with `voice.setVelocity` |
| `doppler` (optional) | `number` | How much of the true Doppler shift to apply, 0..1 (default 1) |
| `absorption` (optional) | `number` | 0..1: the air takes the highs off a distant sound: at 1 a sound at its `maxDistance` is as dull as one behind a thick wall. Combines with `occlusion`. |
| `onEnded` (optional) | `() => void` |  |

### `SpriteRegion`

A region of a sprite, in seconds.

Type: `{start: number, duration: number, loop: boolean}`

### `SynthLayer`

One voice of a sound: an oscillator or noise with an envelope.

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `wave` (optional) | `'sine' \| 'square' \| 'saw' \| 'triangle' \| 'noise'` |  |
| `freq` (optional) | `number` | Hz (default 440) |
| `freqEnd` (optional) | `number` | Hz at the end of the layer: the pitch glides there exponentially |
| `gain` (optional) | `number` | 0..1 (default 1) |
| `start` (optional) | `number` | Seconds into the sound the layer begins (default 0) |
| `length` (optional) | `number` | Seconds the layer lasts (default: until the end of the sound) |
| `attack` (optional) | `number` | Seconds to rise to full level (default 0.002) |
| `decay` (optional) | `number` | Time constant of the exponential fall after the attack, seconds (default: a quarter of the length) |
| `duty` (optional) | `number` | Square wave pulse width 0..1 (default 0.5) |
| `lowpass` (optional) | `number` | Cut-off in Hz of a one-pole low-pass filter |
| `lowpassEnd` (optional) | `number` | Cut-off at the end (the filter sweeps there) |
| `vibrato` (optional) | `{rate: number, depth: number}` | Pitch wobble: `depth` is the fraction of the frequency (0.02 = 2%) |
| `duration` (optional) | `number` | Seconds (default 0.3) |
| `sampleRate` (optional) | `number` | Default 44100 |
| `seed` (optional) | `number` | Seed for noise (default 1): the same spec always makes the same sound |
| `gain` (optional) | `number` | Overall level before the peak limit (default 1) |
| `peak` (optional) | `number` | The result is scaled down if it would peak above this (default 0.9) |
| `layers` (optional) | `SynthLayer[]` |  |

### `SynthSpec`

Sound effects and music made in code: no audio files needed. Everything here is plain maths on `Float32Array`s, so it runs in
Node (tests, tools) as well as in the browser; `AudioEngine.createSound` turns the result into a playable sound.

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `wave` (optional) | `'sine' \| 'square' \| 'saw' \| 'triangle' \| 'noise'` |  |
| `freq` (optional) | `number` | Hz (default 440) |
| `freqEnd` (optional) | `number` | Hz at the end of the layer: the pitch glides there exponentially |
| `gain` (optional) | `number` | 0..1 (default 1) |
| `start` (optional) | `number` | Seconds into the sound the layer begins (default 0) |
| `length` (optional) | `number` | Seconds the layer lasts (default: until the end of the sound) |
| `attack` (optional) | `number` | Seconds to rise to full level (default 0.002) |
| `decay` (optional) | `number` | Time constant of the exponential fall after the attack, seconds (default: a quarter of the length) |
| `duty` (optional) | `number` | Square wave pulse width 0..1 (default 0.5) |
| `lowpass` (optional) | `number` | Cut-off in Hz of a one-pole low-pass filter |
| `lowpassEnd` (optional) | `number` | Cut-off at the end (the filter sweeps there) |
| `vibrato` (optional) | `{rate: number, depth: number}` | Pitch wobble: `depth` is the fraction of the frequency (0.02 = 2%) |
| `duration` (optional) | `number` | Seconds (default 0.3) |
| `sampleRate` (optional) | `number` | Default 44100 |
| `seed` (optional) | `number` | Seed for noise (default 1): the same spec always makes the same sound |
| `gain` (optional) | `number` | Overall level before the peak limit (default 1) |
| `peak` (optional) | `number` | The result is scaled down if it would peak above this (default 0.9) |
| `layers` (optional) | `SynthLayer[]` |  |

### `VoiceEntry`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `id` | `number` |  |
| `key` | `string` | Which sound it is (for the per-sound limit) |
| `priority` | `number` | Higher survives longer |
| `startedAt` | `number` |  |
