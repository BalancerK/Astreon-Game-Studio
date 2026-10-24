# @engine/fsm

Hierarchical state machines (events, timers, history, saving) and an animation graph with blend trees and cross-fades.

```
npm install @engine/fsm
```

Version 0.1.0. The package's own README ([packages/fsm](../../packages/fsm/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (3 of 3 documented)

| Name | Kind | Summary |
|---|---|---|
| [`AnimationGraph`](#class-animationgraph) | class | Blends animation clips driven by parameters and triggers: states that play a clip or a 1D blend tree, transitions on parameter conditions, triggers or finished clips, cross-fades and interrupts. |
| [`StateMachine`](#class-statemachine) | class | A hierarchical state machine: states with enter / update / exit, transitions on events, conditions and timers with priorities, "from any" transitions, nested machines inside states (with history), loop detection and save / load. |
| [`machineFromData`](#machinefromdata) | function | Build a machine from plain data (JSON), naming functions from a registry: `{ initial: 'idle', states: { idle: { enter: 'playIdle', transitions: [{ to: 'run', when: 'isMoving' }] } } }`. |

## Functions

### `machineFromData`

```js
function machineFromData(spec, registry)
```

Build a machine from plain data (JSON), naming functions from a registry: `{ initial: 'idle', states: { idle: { enter: 'playIdle', transitions: [{ to: 'run', when: 'isMoving' }] } } }`.
Any of enter, update, exit, when, action may be a name.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `object` |  |
| `registry` | `Record<string, Function>` |  |

<sub>src/machine.js:238</sub>

## Classes

### `class AnimationGraph`

```js
class AnimationGraph
```

Blends animation clips driven by parameters and triggers: states that play a clip or a 1D blend tree, transitions on parameter
conditions, triggers or finished clips, cross-fades and interrupts. `update(dt)` advances it and `sample(...)` gives the pose to
draw.

#### `AnimationGraph.constructor`

```js
constructor(config, { skeleton, sample, blend, duration = (c) => c.duration })
```

| Name | Type | Description |
|---|---|---|
| `config` | `object` |  |
| `config.parameters` (optional) | `Record<string, number \| boolean \| 'trigger'>` | Names and starting values; 'trigger' makes a one-shot flag. |
| `config.states` | `Record<string, GraphState>` |  |
| `config.transitions` (optional) | `GraphTransition[]` |  |
| `config.initial` | `string` |  |
| `io` | `object` |  |
| `io.skeleton` | `{createPose: () => any}` | Whatever makes a pose you can pass to `sample` and `blend`. |
| `io.sample` | `(skeleton: any, clip: any, time: number, out: any) => void` | Write the pose of `clip` at `time` seconds into `out`. |
| `io.blend` | `(out: any, a: any, b: any, weight: number) => void` | `out = a * (1 - weight) + b * weight`. |
| `io.duration` (optional) | `(clip: any) => number` | Clip length in seconds (default `clip.duration`). |

#### `AnimationGraph.set`

```js
set(name, value)
```

Set a parameter (a number or a boolean).

#### `AnimationGraph.get`

```js
get(name)
```

#### `AnimationGraph.trigger`

```js
trigger(name)
```

Raise a trigger: it stays up until a transition that waits for it is taken (or `reset`).

#### `AnimationGraph.progress`

```js
get progress
```

How far through its clip the current state is, 0..1 (for a looping clip it wraps; for a blend, relative to the blended length).

#### `AnimationGraph.update`

```js
update(dt)
```

Advance by `dt` seconds and return the pose (the same pose object every call: copy it if you need to keep it).

**Returns** `any`

#### `AnimationGraph.force`

```js
force(name, time = 0)
```

Jump to a state at once, without a cross-fade.

#### `AnimationGraph.save`

```js
save()
```

Save: the state, time, parameters and any running fade (as a snapshot-free state: the fade is dropped).

#### `AnimationGraph.load`

```js
load(d)
```

<sub>src/animation-graph.js:32</sub>

### `class StateMachine`

```js
class StateMachine
```

A hierarchical state machine: states with enter / update / exit, transitions on events, conditions and timers with priorities,
"from any" transitions, nested machines inside states (with history), loop detection and save / load. Can be defined from plain
data.

#### `StateMachine.constructor`

```js
constructor(config, { name = 'machine' } = {})
```

| Name | Type | Description |
|---|---|---|
| `config` | `{initial: string, states: Record<string, StateConfig>, any?: Transition[]}` |  |
| `o` (optional) | `{name?: string}` |  |

#### `StateMachine.path`

```js
get path
```

The active state path: "combat/aiming".

#### `StateMachine.is`

```js
is(path)
```

Is the machine in this state (a name, or a path prefix like "combat" while in "combat/aiming")?

#### `StateMachine.start`

```js
start(ctx)
```

Enter the initial state. Called for you by the first `update` or `send`.

#### `StateMachine.go`

```js
go(ctx, to, { action, history = false, event = null } = {})
```

Move to another state now. `to` is relative to this machine: a sibling ("run"), a state inside a sibling ("combat/aiming"), or up
through the machines around it ("../dead" from inside "combat").

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{action?: Function, history?: boolean, event?: string \| null}` |  |

#### `StateMachine.update`

```js
update(dt, ctx)
```

Advance time, follow transitions that are due, and run the current states' updates (parents first).

#### `StateMachine.send`

```js
send(event, ctx)
```

Tell the machine something happened. The deepest state that has a transition for it handles it.

**Returns** `boolean` — whether a transition was taken

#### `StateMachine.post`

```js
post(event)
```

Remember an event to be handled at the end of the next `update` (for code that runs mid-frame).

#### `StateMachine.save`

```js
save()
```

Where the machine is, as plain data (state path, time in each level, remembered history, memory).

#### `StateMachine.load`

```js
load(data)
```

Put the machine back where `save()` found it. Enter / exit functions are not called (the world is restored separately).

#### `StateMachine.describe`

```js
describe()
```

A readable outline of the machine's states and transitions.

<sub>src/machine.js:33</sub>

## Types

### `Condition`

Type: `{param?: string, op?: string, value?: number, equals?: any, trigger?: string}`

| Name | Type | Description |
|---|---|---|
| `clip` (optional) | `any` | One clip to play. |
| `blend1d` (optional) | `{param: string, clips: {clip: any, at: number}[]}` | Blend between clips by a parameter's value (sorted by `at`): the phase of all of them is kept in step, so walk and run cycles stay in sync. |
| `loop` (optional) | `boolean` | Default: the clip's own setting. |
| `speed` (optional) | `number` | Playback speed multiplier (1); a number or the name of a parameter. |
| `enter` (optional) | `(graph: AnimationGraph) => void` |  |
| `from` | `string` | A state name, or '*' for any state. |
| `to` | `string` |  |
| `when` (optional) | `Condition \| Condition[]` | All must hold. `{ param: 'speed', op: '>', value: 0.3 }`, `{ param: 'grounded', equals: true }`, `{ trigger: 'jump' }` (consumed when the transition is taken). |
| `exitTime` (optional) | `number` | Not before the source state has played this fraction of its clip (0..1). |
| `duration` (optional) | `number` | Cross-fade length in seconds (0.2). |
| `interrupt` (optional) | `boolean` | May start while another cross-fade is still running (the blend so far is frozen as the new "from"). |

### `GraphState`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `clip` (optional) | `any` | One clip to play. |
| `blend1d` (optional) | `{param: string, clips: {clip: any, at: number}[]}` | Blend between clips by a parameter's value (sorted by `at`): the phase of all of them is kept in step, so walk and run cycles stay in sync. |
| `loop` (optional) | `boolean` | Default: the clip's own setting. |
| `speed` (optional) | `number` | Playback speed multiplier (1); a number or the name of a parameter. |
| `enter` (optional) | `(graph: AnimationGraph) => void` |  |
| `from` | `string` | A state name, or '*' for any state. |
| `to` | `string` |  |
| `when` (optional) | `Condition \| Condition[]` | All must hold. `{ param: 'speed', op: '>', value: 0.3 }`, `{ param: 'grounded', equals: true }`, `{ trigger: 'jump' }` (consumed when the transition is taken). |
| `exitTime` (optional) | `number` | Not before the source state has played this fraction of its clip (0..1). |
| `duration` (optional) | `number` | Cross-fade length in seconds (0.2). |
| `interrupt` (optional) | `boolean` | May start while another cross-fade is still running (the blend so far is frozen as the new "from"). |

### `GraphTransition`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `clip` (optional) | `any` | One clip to play. |
| `blend1d` (optional) | `{param: string, clips: {clip: any, at: number}[]}` | Blend between clips by a parameter's value (sorted by `at`): the phase of all of them is kept in step, so walk and run cycles stay in sync. |
| `loop` (optional) | `boolean` | Default: the clip's own setting. |
| `speed` (optional) | `number` | Playback speed multiplier (1); a number or the name of a parameter. |
| `enter` (optional) | `(graph: AnimationGraph) => void` |  |
| `from` | `string` | A state name, or '*' for any state. |
| `to` | `string` |  |
| `when` (optional) | `Condition \| Condition[]` | All must hold. `{ param: 'speed', op: '>', value: 0.3 }`, `{ param: 'grounded', equals: true }`, `{ trigger: 'jump' }` (consumed when the transition is taken). |
| `exitTime` (optional) | `number` | Not before the source state has played this fraction of its clip (0..1). |
| `duration` (optional) | `number` | Cross-fade length in seconds (0.2). |
| `interrupt` (optional) | `boolean` | May start while another cross-fade is still running (the blend so far is frozen as the new "from"). |

### `StateConfig`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `to` | `string` | Target state: a sibling name, "combat/aiming" (a state inside a sibling), or "../dead" (a sibling of the machine this one is nested in). |
| `when` (optional) | `(ctx: any, m: StateMachine) => boolean` | Taken when this returns true (checked every update). |
| `after` (optional) | `number` | Taken once the state has lasted this many seconds. |
| `event` (optional) | `string` | Taken when `send(event)` arrives while in the state (and `when`, if given, holds). |
| `minTime` (optional) | `number` | Not before the state has lasted this long. |
| `priority` (optional) | `number` | Higher goes first when several are possible (default 0). |
| `action` (optional) | `(ctx: any, m: StateMachine) => void` | Runs between exit and enter. |
| `reenter` (optional) | `boolean` | A transition to the state you are in leaves and enters it again (default: it is ignored). |
| `history` (optional) | `boolean` | Enter the nested state that was active last time instead of the initial one. |
| `enter` (optional) | `(ctx: any, m: StateMachine, from: string \| null) => void` |  |
| `update` (optional) | `(ctx: any, dt: number, m: StateMachine) => void` |  |
| `exit` (optional) | `(ctx: any, m: StateMachine, to: string \| null) => void` |  |
| `transitions` (optional) | `Transition[]` |  |
| `on` (optional) | `Record<string, string \| Omit<Transition, 'event'>>` | Shorthand for event transitions: `{ hit: 'stunned' }`. |
| `machine` (optional) | `{initial: string, states: Record<string, StateConfig>, any?: Transition[]}` | A machine inside this state; it is active exactly while the state is. |

### `Transition`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `to` | `string` | Target state: a sibling name, "combat/aiming" (a state inside a sibling), or "../dead" (a sibling of the machine this one is nested in). |
| `when` (optional) | `(ctx: any, m: StateMachine) => boolean` | Taken when this returns true (checked every update). |
| `after` (optional) | `number` | Taken once the state has lasted this many seconds. |
| `event` (optional) | `string` | Taken when `send(event)` arrives while in the state (and `when`, if given, holds). |
| `minTime` (optional) | `number` | Not before the state has lasted this long. |
| `priority` (optional) | `number` | Higher goes first when several are possible (default 0). |
| `action` (optional) | `(ctx: any, m: StateMachine) => void` | Runs between exit and enter. |
| `reenter` (optional) | `boolean` | A transition to the state you are in leaves and enters it again (default: it is ignored). |
| `history` (optional) | `boolean` | Enter the nested state that was active last time instead of the initial one. |
| `enter` (optional) | `(ctx: any, m: StateMachine, from: string \| null) => void` |  |
| `update` (optional) | `(ctx: any, dt: number, m: StateMachine) => void` |  |
| `exit` (optional) | `(ctx: any, m: StateMachine, to: string \| null) => void` |  |
| `transitions` (optional) | `Transition[]` |  |
| `on` (optional) | `Record<string, string \| Omit<Transition, 'event'>>` | Shorthand for event transitions: `{ hit: 'stunned' }`. |
| `machine` (optional) | `{initial: string, states: Record<string, StateConfig>, any?: Transition[]}` | A machine inside this state; it is active exactly while the state is. |
