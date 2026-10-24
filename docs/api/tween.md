# @engine/tween

Tweens and timelines: 30+ easings, delays, repeats, yoyo, relative values, labels, overlapping steps, seeking; deterministic.

```
npm install @engine/tween
```

Version 0.1.0. The package's own README ([packages/tween](../../packages/tween/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (10 of 10 documented)

| Name | Kind | Summary |
|---|---|---|
| [`EASINGS`](#easings) | constant | Every named easing, by name: `linear`, and `sineIn`, `sineOut`, `sineInOut` ... |
| [`EASING_NAMES`](#easing_names) | constant | The names of all the easings, in a fixed order. |
| [`Timeline`](#class-timeline) | class | Several tweens, calls and other timelines laid out on one clock, played, repeated, sped up, paused and sought as one. |
| [`Tween`](#class-tween) | class | Moves properties of `target` to new values. |
| [`Tweens`](#class-tweens) | class | Plays tweens and timelines: make them with `to`, `from`, `fromTo` or `timeline`, then call `update(dt)` once per step. |
| [`cubicBezier`](#cubicbezier) | function | The easing along a CSS `cubic-bezier(x1, y1, x2, y2)` curve (x1 and x2 in 0..1), solved by Newton's method with a bisection fallback. |
| [`exp2`](#exp2) | function | 2 to the power x, from + - * / only: the whole part by repeated doubling, the fraction by a series. |
| [`locate`](#locate) | function | Where a clock is within a repeating animation. |
| [`resolveEase`](#resolveease) | function | Turn an `EaseSpec` into a function. |
| [`steps`](#steps) | function | A staircase easing of `count` equal jumps (the value holds, then jumps at the end of each step): for sprite frames and ticking dials. |

## Functions

### `cubicBezier`

```js
function cubicBezier(x1, y1, x2, y2)
```

The easing along a CSS `cubic-bezier(x1, y1, x2, y2)` curve (x1 and x2 in 0..1), solved by Newton's method with a bisection fallback.

<sub>src/easing.js:84</sub>

### `exp2`

```js
function exp2(x)
```

2 to the power x, from + - * / only: the whole part by repeated doubling, the fraction by a series.

<sub>src/easing.js:8</sub>

### `locate`

```js
function locate(out, t, delay, duration, repeat, repeatDelay, yoyo)
```

Where a clock is within a repeating animation. Fills `out`: `active` (the delay has passed), `cycle` (0 is the first play), `local` (seconds into this
play, 0..duration), `eff` (the same but backwards on a yoyo's return trips), `done` (every repeat is over).

<sub>src/tween.js:12</sub>

### `resolveEase`

```js
function resolveEase(spec)
```

Turn an `EaseSpec` into a function. An unknown name throws and lists the names.

<sub>src/easing.js:71</sub>

### `steps`

```js
function steps(count)
```

A staircase easing of `count` equal jumps (the value holds, then jumps at the end of each step): for sprite frames and ticking dials.

<sub>src/easing.js:108</sub>

## Classes

### `class Timeline`

```js
class Timeline extends Animation
```

Several tweens, calls and other timelines laid out on one clock, played, repeated, sped up, paused and sought as one. Items go at the end by default,
or at a time (`2`), after a label (`'boom+=0.5'`), relative to the end (`'-=0.3'`, overlapping), or with the previous item (`'<'`, `'<+=0.2'`).

#### `Timeline.constructor`

```js
constructor(o = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` | The same `delay`, `repeat`, `repeatDelay`, `yoyo`, `timeScale`, `paused` and callbacks as a tween. |

#### `Timeline.duration`

```js
get duration
```

#### `Timeline.uses`

```js
uses(target)
```

#### `Timeline.label`

```js
label(name, at)
```

A name for a moment on the timeline, for later items to be placed relative to.

#### `Timeline.add`

```js
add(item, at)
```

Put a tween, a timeline or a function on the timeline. A function is called once as the clock passes its place (every lap of a repeat).

| Name | Type | Description |
|---|---|---|
| `item` | `Animation \| (() => void)` |  |
| `at` (optional) | `number \| string` |  |

#### `Timeline.to`

```js
to(target, to, o, at)
```

Tween properties of `target` to values: `timeline.to(box, { x: 100 }, { duration: 1 }, '+=0.2')`.

#### `Timeline.from`

```js
from(target, from, o, at)
```

Tween properties of `target` from values to where they are when it starts.

#### `Timeline.fromTo`

```js
fromTo(target, from, to, o, at)
```

Tween properties of `target` between two sets of values.

#### `Timeline.call`

```js
call(fn, at)
```

Call a function as the clock passes `at`.

#### `Timeline.wait`

```js
wait(seconds)
```

Leave a gap of `seconds` after everything so far.

#### `Timeline.seek`

```js
seek(t, events = false)
```

#### `Timeline.reset`

```js
reset()
```

<sub>src/tween.js:213</sub>

### `class Tween`

```js
class Tween extends Animation
```

Moves properties of `target` to new values. Make them with `Tweens.to(...)` (which also plays them), or directly and call `update(dt)` yourself.
Properties may be dotted paths (`'position.x'`), numbers, lists of numbers (`[r, g, b]` are tweened in place, also typed arrays), and relative (`'+=50'`).

#### `Tween.constructor`

```js
constructor(target, props, o = {})
```

| Name | Type | Description |
|---|---|---|
| `target` | `object` |  |
| `props` | `{ to?: object, from?: object }` | `to` only: from where it is now; `from` only: from these to where it is now; both: between them. |
| `o` (optional) | `object` |  |
| `o.duration` (optional) | `number` | Seconds (0.5). |
| `o.delay` (optional) | `number` | Seconds before it starts (0). |
| `o.ease` (optional) | `import('./easing.js').EaseSpec` | A name like `'cubicOut'`, a function of 0..1, or four numbers for a bezier (linear). |
| `o.repeat` (optional) | `number` | Extra plays (0); -1 for forever. |
| `o.repeatDelay` (optional) | `number` | Seconds between plays. |
| `o.yoyo` (optional) | `boolean` | Every second play runs backwards. |
| `o.timeScale` (optional) | `number` | Speed (1). |
| `o.paused` (optional) | `boolean` |  |
| `o.onStart` (optional) | `(t: Tween) => void` | Once, when the delay is over. |
| `o.onUpdate` (optional) | `(t: Tween) => void` |  |
| `o.onRepeat` (optional) | `(t: Tween) => void` |  |
| `o.onComplete` (optional) | `(t: Tween) => void` |  |

#### `Tween.duration`

```js
get duration
```

#### `Tween.uses`

```js
uses(target)
```

#### `Tween.seek`

```js
seek(t, events = false)
```

<sub>src/tween.js:128</sub>

### `class Tweens`

```js
class Tweens
```

Plays tweens and timelines: make them with `to`, `from`, `fromTo` or `timeline`, then call `update(dt)` once per step. Finished and killed ones are dropped.

```js
const tweens = new Tweens();
tweens.to(box, { x: 300, 'scale.y': 2 }, { duration: 1, ease: 'elasticOut', onComplete: () => spawnDust() });
tweens.timeline().to(a, { y: 0 }, { duration: 0.3 }).call(playSound).to(b, { alpha: 1 }, { duration: 0.2 }, '-=0.1');
// each step:  tweens.update(1 / 60);
```

#### `Tweens.constructor`

```js
constructor()
```

#### `Tweens.count`

```js
get count
```

How many are playing or waiting.

#### `Tweens.add`

```js
add(anim)
```

Play a tween or timeline you made yourself.

#### `Tweens.to`

```js
to(target, to, o)
```

Move properties of `target` to values. See `Tween` for the options.

#### `Tweens.from`

```js
from(target, from, o)
```

Move properties of `target` from values to where they are when it starts.

#### `Tweens.fromTo`

```js
fromTo(target, from, to, o)
```

Move properties of `target` between two sets of values.

#### `Tweens.timeline`

```js
timeline(o)
```

A new timeline that this plays.

#### `Tweens.killTweensOf`

```js
killTweensOf(target)
```

Stop and drop every tween that moves `target` (timelines holding one are dropped whole). Returns how many went.

#### `Tweens.killAll`

```js
killAll()
```

Stop and drop everything.

#### `Tweens.update`

```js
update(dt)
```

Move every animation on by `dt` seconds.

<sub>src/tween.js:365</sub>

## Constants

### `EASINGS`

```js
const EASINGS
```

Every named easing, by name: `linear`, and `sineIn`, `sineOut`, `sineInOut` ... for sine, quad, cubic, quart, quint, expo, circ, back, elastic and bounce.

Value: `{ linear: (t) => t }`

<sub>src/easing.js:49</sub>

### `EASING_NAMES`

```js
const EASING_NAMES
```

The names of all the easings, in a fixed order.

Value: `Object.keys(EASINGS)`

<sub>src/easing.js:63</sub>

## Types

### `EaseSpec`

Anything that can say how to ease: a name (`'cubicOut'`), your own function of 0..1, or `[x1, y1, x2, y2]` for a CSS-style cubic bezier.

Type: `string \| ((t: number) => number) \| number[]`
