# How the 3D in the studio works

The studio's **Gem hall (3D)** template and the **Make a 3D game** pathway use a small 3D drawing kit that is part of `@engine/arcade`. This page explains what it does and where it stops, so you know when to use it and when to reach for the GPU renderer.

## A world is a list and a camera

There is no model file and no scene to load. A 3D world is two plain lists and one camera, all numbers:

```js
const BLOCKS = [block(0, -8, 4, 1, 3, '#5b6b8c')];   // x, z, width, depth, height, colour
const GEMS = [gem(0, 0, 1, '#ffd23c')];               // x, z, height, colour
const cam = camera3d({ x: 0, z: 9, fov: 70 });
```

`x` goes right, `y` goes up and `z` comes towards you; one unit is about a metre. A camera at yaw 0 looks along -z, and a positive yaw turns it to the left. Because everything is plain data, the Time Machine can rewind it, the studio can save it, and hot reload keeps it while you edit the code.

## What happens in a frame

1. **`move3d`** turns the camera with the arrow keys and moves it with W, A, S and D. It tries to move along x and then along z, so walking at a wall at an angle slides along it. A block lower than a step above your feet does not stop you, which is how you climb onto a crate after `jump3d`.
2. **`drawWorld3d`** paints the sky and the floor lines, then every block and gem from the **farthest to the nearest**. Each block shows only the faces that look towards you, each lit a different amount from one side, and fading into fog with distance. A face that crosses the camera is cut at the near plane so it does not break.
3. You draw your own text on top with `label`, in screen pixels.

This is called the painter's algorithm: nearer things are painted over farther ones.

## Build the world by dragging

The **Gem hall from a scene (3D)** template reads its level from `scenes/hall.json`, the file the studio's **3D** workspace edits. Move a wall, add a pillar or a crate there, press Save, run the game again. `loadWorld3d(hall)` turns the scene into the same blocks, gems and start place you would write by hand: cubes, floors, walls, pillars, balls and capsules become blocks (a turned one stays turned), a marker called `start` is where you begin and every other marker is a gem. The studio makes the module `scenes/hall.json.js` for the copy that runs and for an export, so the project keeps one scene file.

## Stairs, ramps and things to stand on

`move3d` also does up and down. You stand on the floor, on a block, or on a ramp; you walk up anything up to half a unit high without jumping (so a low step or a stair just works), and you can jump onto something higher, like a crate a metre high, with Space. Walk off an edge and you fall and land. `ramp(x, z, w, d, h)` is a slope that is low at its +z end and `h` high at its -z end (turn it with `yaw`), `stairs(x, z, w, d, h, steps)` makes the blocks of a staircase to spread into your list (`...stairs(0, -4, 2, 4, 1, 4)`), and in the 3D panel the **ramp** block gives the same slope to a scene.

## The editor feels like Blender

In the studio's **3D** workspace the keys are Blender's. Click a block, press **G** and move the mouse: it follows at once; press **X** to slide it along x only, type **2** for exactly two metres, **Enter** to keep it (**Esc** puts it back). **R** turns it (type 90 for a quarter turn) and **S** stretches it: **S**, **Y** makes it taller by changing its real height, so a wall stays a wall. Press **Tab** on a box to drag its sides: a handle appears on every face and edge, and dragging a face moves that one side while the opposite side stays put. **Shift+D** copies, **X** deletes, **Shift+A** adds, the number pad changes the view, and **?** lists every key.

## Looking with the mouse

Call `mouseLook3d(game.cam, keys)` every tick, as the templates do. The first call tells the page this game wants the mouse: a click on the game takes hold of it (the pointer disappears), moving it turns and tilts the camera, and **Esc** lets go. Use **Full screen** (or Alt+Enter) above the game to test it as a player would. The mouse is just one more held key, `Mouse:<x>:<y>`, so the Time Machine records it and a replay looks the same way; the buttons are `Mouse0` (left) and `Mouse2` (right), and `held(keys, 'click')` reads the left one.

## A guardian to run from

`chase3d(guardian, game.cam, speed, dt, blocks)` walks something a little towards you each tick and slides it along walls. The templates start it after three seconds, take a life when it gets within a metre, send you back to the start, and give you two safe seconds. You walk faster than it does, so you can always get away.

## Where it stops

It is made for a first 3D game, not for a big one.

- **Blocks are boxes** that stand on the floor (or on a height you give) and can be turned (`yaw`), plus one slope, the ramp. There are no curved or tipped surfaces and no models. A block that hangs above you stops your head, and you can walk under a bridge higher than your head; but a block is judged by its footprint, so an arch is a box.
- **Sorting is by pieces.** A long block is drawn in pieces about three units long, each in its own far-to-near place, so a wall no longer lands over a pillar in front of one end. Two big blocks that cross each other, or a block that wraps round another, can still be painted in the wrong order.
- **Flat colours.** There are no textures and no shadows.
- **Speed.** The 2D canvas draws a few hundred shapes a frame comfortably. A hall of fifty blocks is easy; a city is not. The Profiler shows the cost, and **Time every function** shows which of your functions it is.

For models, textures, lights and shadows on the graphics card, use the engine's own renderer (`@engine/render`) in a project made with `create-game --template 3d`, and the 3D scene panel in the studio to lay out a scene.

## Things to try

- Change the `fov` while you run (a wider view when you walk fast feels quick).
- Make a maze: a list of blocks that a few lines of code place from a picture of letters, as the 2D levels are.
- Put a gem on top of a crate (`gem(7, -8, 2.4)`) and add `jump3d` to reach it.
- Open the Profiler and add fifty more blocks: watch which function grows.
