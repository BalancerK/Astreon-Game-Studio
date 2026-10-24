# @engine/tween

Tweens and timelines: move numbers on any object from one value to another over time, with an easing, and lay several of them out on one clock. It has no rendering or DOM in it, so it works for sprites, 3D transforms, UI, camera and volume alike. It uses only `+ - * /`, `sqrt` and the deterministic sine of `@engine/math`, so a tween inside a replayed or networked game lands on the same bits in Node, Chrome and Firefox (checked by `tools/determinism.js`).

```js
import { Tweens, Tween, Timeline } from '@engine/tween';

const tweens = new Tweens();
tweens.to(box, { x: 300, 'scale.y': 2 }, { duration: 1, ease: 'elasticOut', onComplete: () => spawnDust() });

// a sequence: steps go one after another unless you place them
tweens.timeline({ repeat: 2, yoyo: true })
  .to(door, { y: -3 }, { duration: 0.6, ease: 'cubicInOut' })
  .call(() => playSound('creak'))                         // called once as the clock passes it
  .label('open')
  .to(light, { intensity: 4, color: [1, 0.8, 0.4] }, { duration: 0.4 }, '-=0.2')   // overlaps the last step by 0.2 s
  .to(dust, { alpha: 0 }, { duration: 1 }, 'open+=0.5');

// each fixed step (or each frame; tweens only read the dt you give them):
tweens.update(1 / 60);
```

- **What can move:** numbers, dotted paths (`'position.y'`), lists of numbers (tweened in place: colours, vectors, typed arrays), and relative values (`'+=50'`, `'-=2'`). The starting value is read when the delay ends, so a tween made early starts from where the thing is when it begins.
- **Ways to make one:** `to(target, values, options)`, `from(target, values, options)` (from these to where it is), `fromTo(target, from, to, options)`. Options: `duration` (0.5), `delay`, `ease`, `repeat` (extra plays; -1 for forever), `repeatDelay`, `yoyo`, `timeScale`, `paused`, and `onStart` / `onUpdate` / `onRepeat` / `onComplete`.
- **Easings:** `linear` and `sine`, `quad`, `cubic`, `quart`, `quint`, `expo`, `circ`, `back`, `elastic`, `bounce`, each as `…In`, `…Out` and `…InOut` (31 names, in `EASING_NAMES`). An `ease` can also be your own function of 0..1, or four numbers for a CSS-style cubic bezier (`[0.25, 0.1, 0.25, 1]`). `steps(4)` is a staircase for frame-by-frame things.
- **Timelines:** `add`, `to`, `from`, `fromTo`, `call`, `wait`, `label`. A place is a number of seconds, `'+=0.5'` / `'-=0.5'` (from the end so far), `'<'` (with the previous item), `'<+=0.2'`, or a label (`'open'`, `'open+=1'`). Timelines nest, and repeat, yoyo, delay and speed up like tweens do. A timeline cannot hold something that repeats forever (give it a number of repeats).
- **Seeking:** every tween and timeline is a function of its clock: `seek(t)` puts everything exactly where it belongs at time `t` (forwards or back) without calling any callback, and `progress = 0.5` does the same by fraction. A later step starts from where the earlier one left off even when you seek straight to the end, and seeking back puts everything back. This is what makes cutscenes scrubbable and replays exact.
- **Control:** `pause()`, `resume()`, `restart()`, `kill()`, `timeScale`; on the manager `timeScale` (slow motion), `paused`, `killTweensOf(target)`, `killAll()`. Finished and killed animations are dropped by the manager.
- **Callbacks:** called going forward only (rewinding is silent). A step over several repeats calls `onRepeat` once for each; a `call()` on a timeline fires once per lap, on yoyo's way back as well, in order, however large the time step.
- **Mistakes are named:** an unknown easing lists the valid names, a path through something that is not an object, a value that is not a number, and a bad relative value all throw with the property named; a wrong path fails when the tween is made, not on the first frame.

Not done: tweens of colours as strings, per-property easing inside one tween (use two tweens or a timeline), motion along a path, springs, and `onStart` firing again when a timeline repeats.
