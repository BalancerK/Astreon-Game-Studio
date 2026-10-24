# @engine/fsm

State machines for gameplay and for animation. Zero dependencies.

- **`StateMachine`**: named states with enter / update / exit, transitions guarded by conditions, timers or events, "from any state" transitions, machines nested inside states, history, saving and restoring.
- **`AnimationGraph`**: states that play a clip or blend several (idle to walk to run by speed), cross-fades driven by parameters, triggers and the clip's own progress. It does not know about skeletons: you give it functions to sample a clip into a pose and blend two poses (the render package's `samplePose` and `blendPoses`), so it works with any rig.

## State machine

```js
import { StateMachine } from '@engine/fsm';

const door = new StateMachine({
  initial: 'closed',
  any: [{ to: 'broken', when: (c) => c.hp <= 0, priority: 100 }],          // from every state
  states: {
    closed: { on: { near: 'opening' } },                                    // shorthand for { event: 'near', to: 'opening' }
    opening: { update: (c, dt) => { c.lift += dt * 4; }, transitions: [{ to: 'open', when: (c) => c.lift >= 3 }] },
    open: { transitions: [{ to: 'closing', after: 1.5 }] },
    closing: { enter: (c) => c.sound('creak'), on: { near: 'opening' }, transitions: [{ to: 'closed', when: (c) => c.lift <= 0 }] },
    broken: {},
  },
});
door.update(dt, ctx);        // every tick: transitions, then the current state's update (parents first)
door.send('near', ctx);      // an event, handled now; returns whether a transition was taken. door.post('near') defers it to the end of the next update
```

- A transition has `to`, and any of: `when(ctx, machine)`, `after` (seconds in the state), `minTime`, `event`, `priority` (higher first; ties in listed order), `action` (runs between exit and enter), `reenter` (a transition to the same state restarts it; otherwise it is ignored), `history`.
- **Nested machines:** a state can contain `machine: { initial, states }`; it is active exactly while the state is. Enter and exit run outer then inner (inner then outer on the way out). A parent's transitions win over the child's; an event goes to the deepest state that handles it. `to` is relative to the machine it is declared in: `"reload"` (a sibling), `"combat/aim"` (a state inside a sibling), `"../patrol"` (a sibling of the machine this one is nested in). `machine.path` is `"combat/aim"`, `machine.is('combat')` is true inside it.
- **History:** `{ to: 'combat', history: true }` re-enters the nested state that was active last time.
- **Safety:** more than 16 instant transitions in one update is reported as a loop (naming the state), not left to hang. Bad configurations (unknown initial state, a transition without `to`) fail up front; `go` to an unknown state or a path through a state with no machine inside says so.
- **Saving:** `save()` is plain JSON (the state path, time in each level, remembered history, the machine's `data`); `load()` puts it back without calling enter or exit (the world is restored separately), and the restored timers carry on.
- **Data:** `machineFromData(spec, registry)` builds a machine from JSON, naming functions from a registry (`{ "to": "run", "when": "isMoving" }`). `describe()` prints an outline; `onTransition(from, to, event)` reports every change.

The machine uses only `+ - * /`, so it may run in shared simulation code (it is in the determinism lint's scope).

## Animation graph

```js
import { AnimationGraph } from '@engine/fsm';
import { samplePose, blendPoses } from '@engine/render';

const graph = new AnimationGraph({
  parameters: { speed: 0, grounded: true, jump: 'trigger' },
  initial: 'loco',
  states: {
    loco: { blend1d: { param: 'speed', clips: [{ clip: idle, at: 0 }, { clip: walk, at: 3 }, { clip: run, at: 6.5 }] } },
    jump: { clip: jumpClip }, air: { clip: airClip },
  },
  transitions: [
    { from: 'loco', to: 'jump', when: { trigger: 'jump' }, duration: 0.15 },
    { from: 'jump', to: 'air', exitTime: 0.9, duration: 0.1 },                         // when 90% of the jump clip has played
    { from: 'air', to: 'loco', when: { param: 'grounded', equals: true }, duration: 0.2 },
    { from: '*', to: 'dead', when: { param: 'dead', equals: true }, duration: 0, interrupt: true },
  ],
}, { skeleton, sample: samplePose, blend: blendPoses });

graph.set('speed', 4.2);  graph.trigger('jump');
const pose = graph.update(dt);                  // every frame; skeleton.computePalette(pose, palette) for skinning
```

- **States:** one `clip`, or `blend1d` (clips sorted by `at`; the phase of all of them is kept in step so walk and run cycles never drift apart, and the blended cycle length is the blend of their lengths). `speed` (a number or a parameter's name), `loop`, `enter`.
- **Transitions:** `when` is one condition or a list that must all hold: `{ param, op: '>' | '>=' | '<' | '<=' | '==' | '!=', value }`, `{ param, equals }`, `{ trigger }` (a one-shot flag, used up when the transition is taken). `exitTime` waits for a fraction of the source state's clip. `from: '*'` is any state. `duration` is the cross-fade in seconds (smoothstep); the old state keeps playing while it fades out. A transition with `interrupt: true` may start in the middle of a fade: what is on screen is frozen and fades into the new state.
- `progress`, `force(state)`, `save()` / `load()`, `onEnter(state, from)`.
- Poses are the graph's own (one `pose` object returned each call: copy it if you need to keep it); nothing is allocated per frame.

## Tests

`npm test`: 14 state machine tests (priorities, timers, events and guards, posted events, actions and reenter, from-any, nested enter / exit order and paths, history and direct paths, loops, save and load, `describe`, bad configurations, data-defined machines) and 10 animation graph tests (clips looping and holding, the 1D blend and its phase sync, trigger transitions and cross-fade values checked exactly, exit time, numeric and all-of conditions, interrupts, speed and saving, error messages, and a run with the real renderer functions on the arena's character that checks the poses are different per speed, the cross-fade moves from the old pose to the new, and the skinning palette stays valid). The sliding door in `examples/physics3d` is a state machine, tested live in Chrome.

Not done (yet): animation layers and masks (upper body aiming over legs running), additive clips, 2D blend spaces, clip events (footsteps), root motion, a visual editor.
