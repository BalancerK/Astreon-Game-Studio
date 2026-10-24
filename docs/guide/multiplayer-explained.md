# Multiplayer, explained

Real-time multiplayer is mostly one problem: **information takes time to travel**. If your friend is 100 ms away, everything you learn about them is already 100 ms old, and anything you tell the server arrives 50 ms late. This page explains how the engine hides that, using ideas you can play with. No networking knowledge is assumed.

## The simplest design, and why it feels bad

Let the server run the game. Every time you press a key, send it up; every time the world changes, the server sends the new world down; the browser draws what it is told.

It is correct, and nobody can cheat because the server decides everything. But press *right* and your character starts moving only after the message goes up and the answer comes back: a full **round trip**. At 100 ms that is a visible delay on every action, and it feels like walking through mud. Three tricks fix it.

## Trick 1: client prediction (your own character)

Your browser already knows the rules, so it does not wait. It moves your character *immediately*, as if the server had said yes, and sends the same input to the server. The server runs the same step and later reports where you really are. If the two agree (almost always), nothing visible happens. If they disagree (the server saw you hit a wall you did not know about), the browser takes the server's position and **replays** the inputs the server has not seen yet on top of it. That is *reconciliation*.

For this to work the client and the server must compute the exact same step from the same input, which is why the engine uses fixed timesteps and its own deterministic maths.

## Trick 2: interpolation (everyone else)

You cannot predict other people, because you do not know what they will press. And the server sends updates only 20 or so times per second, so if you draw each update as it arrives, other players jump from place to place.

So the browser deliberately draws other players a little in the **past** (about 100 ms), always between two snapshots it already has, and blends from one to the next. The motion is smooth, even when a packet is lost, because there are usually snapshots on both sides of the moment being drawn. The cost is that others appear slightly behind, which is the right trade: smoothness beats accuracy for things you do not control. `InterpolationClock` in [`client`](../../packages/client) picks the delay and adapts it to the connection's jitter.

## Try it

Slide the latency up. With both tricks off you see the raw problem; turn them on one by one.

<div id="lag-lab" class="lab">
<div class="lab-controls">
<label>Round-trip latency <input type="range" id="lab-lat" min="0" max="400" value="160" step="10"><output id="lab-lat-out">160 ms</output></label>
<label>Packet loss <input type="range" id="lab-loss" min="0" max="40" value="10" step="5"><output id="lab-loss-out">10%</output></label>
<label><input type="checkbox" id="lab-pred"> Client prediction</label>
<label><input type="checkbox" id="lab-interp"> Interpolation</label>
<label><input type="checkbox" id="lab-auto" checked> Move automatically</label>
<button type="button" id="lab-push">Server disagrees</button>
</div>
<canvas id="lab-canvas" width="760" height="270" aria-label="Lag lab: your character and another player on a track"></canvas>
<p class="lab-help">Hold <kbd>←</kbd> / <kbd>→</kbd> (untick <em>Move automatically</em>) to steer yourself. The ring is where the server says the character is <em>right now</em>; the filled dot is what your screen shows.</p>
</div>

What to notice:

- **Everything off, high latency.** Your dot trails your input by a full round trip, and the other player moves in steps.
- **Prediction on.** Your dot follows your input instantly. The ring (the server) is still behind, and that is fine.
- **Press "Server disagrees".** The server pushes your character. With prediction you see the correction arrive after the round trip and your dot jump: reconciliation at work.
- **Interpolation on, with 30% loss.** The other player still moves smoothly. Off, it freezes and teleports.

## Trick 3: send less, send smart

At 60 ticks per second, sending the whole world every tick would be far too much data. Two things keep the packets small:

{{diagram:delta}}

- **Delta snapshots.** The server sends only what changed since a state the client has *confirmed* (it acks the last snapshot it got). Values are packed as small integers (a position in a known range needs about 12 bits, not a 64-bit float). If the client lost its baseline it asks for a full snapshot and carries on.
- **Interest management.** Each player is told only about things *near* them. The cost per player depends on what is around them, not on how big the world is or how many people are connected.

The [debug overlay](../../packages/debug) (press <kbd>F3</kbd> in the arena example) shows all of this live: round-trip time, bandwidth, snapshot size, how late the snapshots are, and a decoded view of every packet.

## Hits and fairness: lag compensation

You aim at what you *see*, which is 100 ms old. If the server checked your shot against where the target is *now*, you would miss things you hit on your screen. So the shot carries the tick you were looking at, and the server briefly rewinds the other players to that moment and checks the hit there. The arena example does this for its hitscan weapon.

## What the server never trusts

Prediction means the client does a lot of work, and none of it is believed. Movement is limited by the same step the server runs. A hit counts only if the *server's* rewound world agrees. A client that sends a position past a wall is corrected back. A client that floods messages is dropped. The result is that the worst a cheating client can usually do is look wrong to itself.

## Dropped connections

A dropped player stays in the world, frozen, for a while (15 seconds in the arena). The client reconnects with a session token and gets its character back. The server can also hand a missing player's seat to a robot (the card game does this), so a game does not stop because one person's Wi-Fi did.

## Where to see it in the code

| Idea | Look at |
|---|---|
| Fixed step shared by client and server | `FixedLoop` in [`core`](../../packages/core) |
| Packet format, deltas, acks | [`protocol`](../../packages/protocol) |
| Simulated lag and loss for tests | [`transport`](../../packages/transport) (`MemoryNetwork`) |
| Interest management, rooms | [`server`](../../packages/server) |
| Interpolation clock | [`client`](../../packages/client) |
| All of it together, with prediction and lag compensation | The [arena example](../../examples/arena) |
| The turn-based version, where none of this is needed | [`turns`](../../packages/turns) and the [card game tutorial](../tutorials/multiplayer-card-game.md) |
