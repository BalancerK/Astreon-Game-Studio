# @engine/arcade

A small kit for a first game (the studio's pathway starts here): things as plain objects, easy key names, walking, jumping and walls, levels drawn with letters, boxes and emoji, a camera.

```
npm install @engine/arcade
```

Version 0.1.0. The package's own README ([packages/arcade](../../packages/arcade/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (223 of 223 documented)

| Name | Kind | Summary |
|---|---|---|
| [`ANIMATION_MODES`](#animation_modes) | constant | How an animation plays: round and round, once and stop on the last frame, backwards round and round, or forwards then backwards. |
| [`AUTOTILE_MODES`](#autotile_modes) | constant | The two kinds of auto-tiling and how many pictures each needs: 'edges4' looks at the four sides (16), 'blob47' also at the corners (47). |
| [`BEHAVIORS`](#behaviors) | constant | Every behaviour: what it is called, what it does, and its settings (name, kind, the starting value and the range a number may take). |
| [`CAMERA_DEFAULTS`](#camera_defaults) | constant | The camera settings and what they mean. |
| [`EVENT_KINDS`](#event_kinds) | constant | Everything that can happen at a moment of a sequence: what it is called, what it does, and its settings (name, kind, the starting value and the range). |
| [`FIELD_TYPES`](#field_types) | constant | What each type of field is. |
| [`KIND_LIMITS`](#kind_limits) | constant | The limits a kinds file is held to. |
| [`LAYER_KINDS`](#layer_kinds) | constant | What each kind of layer draws. |
| [`LAYER_LIMITS`](#layer_limits) | constant | The limits a layers file is held to. |
| [`LIGHT_LIMITS`](#light_limits) | constant | The limits a lights file is held to. |
| [`Lockstep`](#class-lockstep) | class | The agreement between two (or more) computers about whose keys count on which tick. |
| [`SCREEN_DEFAULTS`](#screen_defaults) | constant | What the darkness, the tint and the vignette are when they are not set. |
| [`SEQUENCE_LIMITS`](#sequence_limits) | constant | The limits a sequence is held to. |
| [`SETTING_SPEC`](#setting_spec) | constant | The settings: what each is called, what it can be, and what it starts as. |
| [`SIDES`](#sides) | constant | The four sides, and the one across from each. |
| [`SPECIAL_TARGETS`](#special_targets) | constant | The numbers the two special targets have: the camera's place, and the screen's fade to black and black bars (each from 0 to 1). |
| [`WORLD_LIMITS`](#world_limits) | constant | The limits a world is held to. |
| [`actionsList`](#actionslist) | function | Every action the game has, with its keys now and its usual keys. |
| [`advanceStory`](#advancestory) | function | Go on from a line (nothing happens while a choice is waiting). |
| [`all`](#all) | function | All the things of one kind (or every thing). |
| [`animate`](#animate) | function | Move a thing's picture along its animation: set `thing.anim` to a name from the sprite (`'run'`) and call this every tick; it sets `thing.frame`. |
| [`animationDone`](#animationdone) | function | Has a `once` animation reached its last frame? |
| [`animationFrame`](#animationframe) | function | Which frame of a sprite an animation shows after some time. |
| [`behave`](#behave) | function | Run every behaviour: call it once a tick. |
| [`behaviorProblems`](#behaviorproblems) | function | Say what is wrong with a list of behaviours, in plain words (they are always made safe when used; this says what was changed or will not work). |
| [`behaviors`](#behaviors) | function | Give kinds of things their behaviours, once, at the top of the game's file. |
| [`block`](#block) | function | A block to build with: its middle (`x`, `z`), its size (`w` wide, `d` deep, `h` tall, standing on `y`, the floor by default), colour, and how far it is turned (`yaw` in radians, positive turns it to the left): a turned wall is stopped at and drawn as it stands. |
| [`block3d`](#block3d) | function | Draw the faces of one block that face the camera. |
| [`build`](#build) | function | The build the game is running as. |
| [`burst`](#burst) | function | Throw a burst of small sparks from a point. |
| [`camera3d`](#camera3d) | function | A first-person camera: where the eyes are, which way they look, and how wide they see. |
| [`caption`](#caption) | function | Words for a sound or something only heard, shown for a moment when the player has captions on. |
| [`chase3d`](#chase3d) | function | Walk something towards a place along the floor, sliding along blocks, for a guardian that chases you. |
| [`chooseStory`](#choosestory) | function | Pick one of the choices on offer (by its place in the list shown). |
| [`cleanBehavior`](#cleanbehavior) | function | Make one behaviour safe: a known type, every setting there and within its range (a missing one gets its starting value). |
| [`cleanEvent`](#cleanevent) | function | Make one event safe: a known kind, a time in the sequence, every setting there and within its range. |
| [`cleanField`](#cleanfield) | function | Make one field safe: a known type, its settings there and in range, and a default that fits. |
| [`cleanKinds`](#cleankinds) | function | Make a kinds table safe: every kind with a name that fits, a template that is plain (a size, a colour, an emoji or a picture) and fields that are clean. |
| [`cleanMask`](#cleanmask) | function | Keep a corner only when both sides next to it are there (a corner next to a gap would not be seen), so 256 shapes become 47. |
| [`cleanRecipe`](#cleanrecipe) | function | Make a recipe safe to use: known fields only, numbers kept in a sane range, at most 6 colors, a pair of numbers for the ranges. |
| [`cleanSong`](#cleansong) | function | Clean up a song that came from outside (the game's worker is not trusted by the page that plays it): known fields only, notes that are note names such as 'A4' or 'C#3' (or null for a rest, or a list of up to six names for a chord), lengths in a sane range, at most 8 tracks, 600 notes a track and a minute of music. |
| [`cleanSound`](#cleansound) | function | Clean up a sound recipe that came from outside (the game's worker is not trusted by the page that plays it): only known fields, numbers that are numbers and in a safe range, at most 3 seconds and 8 layers. |
| [`cleanUi`](#cleanui) | function | Make a whole screen safe (at most 60 widgets). |
| [`cleanWidget`](#cleanwidget) | function | Make one widget safe: a known type, an anchor from the list, numbers kept in range, colors that are colors, short text, paths that look like paths. |
| [`cleanWorld`](#cleanworld) | function | Make a world safe: room names that fit, links between rooms that exist, edges that are sides, and a start that is a room. |
| [`clear`](#clear) | function | Fill the whole screen with one colour (the background colour from the project's settings unless you give one). |
| [`clearSequence`](#clearsequence) | function | Forget the sequence, and with it the fade and the black bars it left behind. |
| [`clearThings`](#clearthings) | function | Take every thing out of the game (to start a level again), except the kinds you name. |
| [`clipProblems`](#clipproblems) | function | Look a clip over and say what is wrong, in plain words. |
| [`clipTime`](#cliptime) | function | The time inside the clip: a looping clip wraps round, another stops at its end. |
| [`closeSettingsMenu`](#closesettingsmenu) | function | Close the menu. |
| [`conflictsFor`](#conflictsfor) | function | The other actions that already use a key. |
| [`controls`](#controls) | function | Give the game its own actions, each with the keys it uses by default. |
| [`describe`](#describe) | function | A transition in plain words: "when vx != 0", "after 0.5 s", "on hit", or several joined with "and". |
| [`despawn`](#despawn) | function | Take a thing out of the game (a coin that was picked up). |
| [`drawAutoTile`](#drawautotile) | function | Draw one auto-tiled tile with no picture: the colour, an edge on each side that has no neighbour, and a small notch where a corner is missing between two neighbours. |
| [`drawCaptions`](#drawcaptions) | function | Draw the captions at the bottom of the screen, as big as the player's text size says. |
| [`drawImage`](#drawimage) | function | Draw a picture file. |
| [`drawLayers`](#drawlayers) | function | Draw the layers. |
| [`drawLights`](#drawlights) | function | Draw the lights and screen effects. |
| [`drawMarkup`](#drawmarkup) | function | Draw lines made by `layoutMarkup`, showing only the first `shown` letters (all of them when left out). |
| [`drawSequence`](#drawsequence) | function | Draw what a sequence puts over the picture: the fade to black and the black bars at the top and bottom. |
| [`drawSettingsMenu`](#drawsettingsmenu) | function | Draw the menu over the game. |
| [`drawSprite`](#drawsprite) | function | Draw one frame of a sprite, crisp (no smoothing), stretched to a size. |
| [`drawStory`](#drawstory) | function | Draw the dialogue box at the bottom of the screen (the speaker, the words as they are typed, and the choices), as big as the player's text size says. |
| [`drawThings`](#drawthings) | function | Draw every thing: its picture file if it has one (`thing.image = 'assets/hero.png'`, see {@link drawImage}; `frames` and `frame` pick from a strip, or `cols`, `rows` and `frame` from a sheet), its sprite if it has one (`thing.sprite = 'hero'`, drawn from the `art` you pass, mirrored when `thing.flip` is true), its emoji, or a box in its colour (`shape: 'circle'` makes a round one). |
| [`drawUi`](#drawui) | function | Draw a screen. |
| [`drawWorld3d`](#drawworld3d) | function | Draw the whole world: the sky, the floor lines, then every block and gem from the farthest to the nearest, fading into fog in the distance. |
| [`ease`](#ease) | function | How far along a segment a number is, 0 to 1, made slow at the start ('in'), the end ('out') or both ('inout'). |
| [`effects`](#effects) | function | Move the sparks, fade them out, remove the ones that are done, and settle the shake. |
| [`emit`](#emit) | function | Throw one burst of an effect from a point. |
| [`enterState`](#enterstate) | function | Put a thing into a state: sets `state`, restarts `stateTime`, and starts the state's animation. |
| [`eventsOf`](#eventsof) | function | The event names a machine reacts to, in the order they appear. |
| [`every`](#every) | function | Do something every so many seconds. |
| [`expect`](#expect) | function | Matchers for a value: `expect(x).toBe(3)`. |
| [`fieldDefaults`](#fielddefaults) | function | The starting values of a kind's fields, as `{ locked: true, delay: 0 }` (a pointer starts with nothing). |
| [`fieldsOf`](#fieldsof) | function | The thing fields a machine looks at in its conditions, in the order they appear. |
| [`first`](#first) | function | The first thing of a kind, or undefined when there is none (for example the only 'hero'). |
| [`fitValue`](#fitvalue) | function | Make a value fit a field: a number is held between its smallest and largest, a choice must be one of the list, a flag is yes or no. |
| [`flicker`](#flicker) | function | How bright a flickering light is at a moment, from 0 to 1 (1 when it does not flicker). |
| [`floor3d`](#floor3d) | function | Lines on the floor around you, so you can see yourself move. |
| [`follow`](#follow) | function | Point the camera at a thing so it stays in the middle of the screen, without showing anything outside the map. |
| [`followSmooth`](#followsmooth) | function | Keep the camera on a thing, with a delay and a look ahead. |
| [`forward3d`](#forward3d) | function | Which way a camera looks along the floor, as `{x, z}` (a unit step), and which way is to its right. |
| [`frameCanvas`](#framecanvas) | function | One frame of a sprite as a small canvas, made once and kept. |
| [`frameFor`](#framefor) | function | The frame (the number of the picture) for a tile with these neighbours. |
| [`gem`](#gem) | function | A gem to collect: where it floats (`x`, `z`, height `y`), its size (`r`) and colour. |
| [`gem3d`](#gem3d) | function | Draw one gem as a diamond that faces you. |
| [`getSetting`](#getsetting) | function | The value of a setting. |
| [`gravity`](#gravity) | function | Pull a thing downwards (call it every tick, before {@link moveAndCollide}). |
| [`groundAt`](#groundat) | function | The height of the ground under a walker: the highest top of the blocks under it that it can step onto (no more than a step above its feet), or the floor, 0. |
| [`heal`](#heal) | function | Give hit points back (never above what it started with). |
| [`held`](#held) | function | Is a key held down? |
| [`holds`](#holds) | function | Whether one condition holds for a thing. |
| [`hurt`](#hurt) | function | Hurt a thing that has the health behaviour. |
| [`image`](#image) | function | The picture at a path, or null when there is none. |
| [`imageSize`](#imagesize) | function | The size of a picture in pixels, or null when there is none. |
| [`isAssetPath`](#isassetpath) | function | Is this a path the studio keeps pictures and sounds at? |
| [`isOnline`](#isonline) | function | Is the game being played with someone else over the network? |
| [`isReservedField`](#isreservedfield) | function | Is this word one that a field cannot be called, because things already have it? |
| [`isWaiting`](#iswaiting) | function | True while the game is waiting for the other player's keys (draw a "waiting for your friend" message). |
| [`jump`](#jump) | function | Jump if a jump key is held and the thing is standing on something. |
| [`jump3d`](#jump3d) | function | Jump with the space bar: it starts a jump when you are on the ground (the floor, a ledge, a ramp). |
| [`keyList`](#keylist) | function | The key codes of a set, in a fixed order, so the same keys always look the same. |
| [`keyName`](#keyname) | function | A key code in plain words: "Left arrow", "A", "Space", "Enter", "Shift (left)". |
| [`kindProblems`](#kindproblems) | function | Say what is wrong with a kinds table, in plain words. |
| [`label`](#label) | function | Write text on the screen (it does not move with the camera). |
| [`language`](#language) | function | The language now chosen ('' before `text()` is called). |
| [`languages`](#languages) | function | The language codes in a table, the first one being the one every other falls back to. |
| [`layerProblems`](#layerproblems) | function | Say what is wrong with a set of layers, as short sentences (an empty list when it is fine). |
| [`layoutMarkup`](#layoutmarkup) | function | Break marked-up words into lines that fit a width, as runs of letters that share a look. |
| [`layoutUi`](#layoutui) | function | Every widget of a screen with the box it covers: `[{ widget, x, y, w, h }]`, in drawing order (the last is on top). |
| [`lightProblems`](#lightproblems) | function | Say what is wrong with a lights file, as short sentences (an empty list when it is fine). |
| [`loadMap`](#loadmap) | function | Fill the game with things from a picture made of letters. |
| [`loadProgress`](#loadprogress) | function | What was saved last time, or an empty object when nothing was saved. |
| [`loadScene`](#loadscene) | function | Fill the game with the things of a scene made in the studio's Scene panel (a file in `scenes/`): each thing is spawned where it was placed, with the size, colour, picture and any extra fields it was given. |
| [`loadWorld3d`](#loadworld3d) | function | Turn a scene from the studio's 3D panel into a world for the 3D kit. |
| [`machineProblems`](#machineproblems) | function | Look a machine over and say what is wrong, in plain words: no states, an initial state that is not there, transitions to states that do not exist, a transition with nothing to wait for (it would be taken at once), states that nothing leads to, and states with no way out. |
| [`makeAutotileSprite`](#makeautotilesprite) | function | Make the picture for an auto-tiled terrain from one plain tile: a sprite with a frame for every shape, with an edge drawn on the sides that have no neighbour and a notch at the corners that are missing. |
| [`makeWorld`](#makeworld) | function | Make a world a game can use. |
| [`masksFor`](#masksfor) | function | The neighbour mask of every tile of a level made of letters. |
| [`masksFromGrid`](#masksfromgrid) | function | The neighbour mask of every cell of a grid of terrains. |
| [`me`](#me) | function | Which player this computer is, counting from 0. |
| [`mouseDelta`](#mousedelta) | function | How far the mouse has moved since the last time you asked. |
| [`mouseLook3d`](#mouselook3d) | function | Look around with the mouse: moving it turns the camera (left and right) and tilts it (up and down). |
| [`move`](#move) | function | Move a thing by its speed for one tick (no collisions: use {@link moveAndCollide} for things that must not pass through walls). |
| [`move3d`](#move3d) | function | Walk and turn with the keys, one tick: the left and right arrows (or Q and E) turn, up and down arrow (or W and S) walk, A and D sidestep. |
| [`moveAndCollide`](#moveandcollide) | function | Move a thing by its speed without going into solid things. |
| [`music`](#music) | function | Give songs names, so a game can say `playMusic('calm')`. |
| [`named`](#named) | function | The first thing in the game with this name (`thing.name`), or undefined. |
| [`navGrid`](#navgrid) | function | Make the grid of a game: every square that a thing of a blocking kind covers is blocked. |
| [`newGame`](#newgame) | function | A new game state with everything the kit uses. |
| [`newKey`](#newkey) | function | The key that was pressed since the last time this was asked (for "press the key you want"), or null. |
| [`openSettingsMenu`](#opensettingsmenu) | function | Open the menu. |
| [`overlaps`](#overlaps) | function | Every thing of a kind that overlaps this one. |
| [`parseMarkup`](#parsemarkup) | function | Read marked-up words into one entry per visible letter. |
| [`parseStory`](#parsestory) | function | Read a story into instructions for each node, with everything wrong with it. |
| [`patrol`](#patrol) | function | Walk back and forth along the ground: an enemy that turns round at a wall and at the end of a ledge. |
| [`placeOf`](#placeof) | function | Where a widget is on a screen of this size: the corner, edge or middle it is pinned to, then pushed in by x and y. |
| [`play`](#play) | function | Play a sound: a name given to {@link sounds}, or a recipe. |
| [`playMusic`](#playmusic) | function | Start a song (a name given to {@link music}) and let it repeat. |
| [`playSequence`](#playsequence) | function | Begin a sequence (one that is already going is replaced). |
| [`playerCount`](#playercount) | function | How many players the game is being played by (1 when played alone). |
| [`project3d`](#project3d) | function | Where a point of the world is on the screen. |
| [`pseudo`](#pseudo) | function | Test text: every letter becomes an accented one, the words grow by about a third (other languages are often longer) and sit in brackets, so a word that does not fit its space, or a font that lacks accents, is seen at once. |
| [`ramp`](#ramp) | function | A ramp: like a block, but its top rises from the floor at the near end (the +z side, where you walk up from when you face -z) to its full height `h` at the far end, turned by `yaw` like a block. |
| [`random`](#random) | function | A random number from 0 up to (not including) 1. |
| [`randomBetween`](#randombetween) | function | A random number between two values. |
| [`ready`](#ready) | function | Whether a transition can be taken now: its event arrived (if it has one), the state has lasted long enough (if `after`), and every condition holds. |
| [`recipeProblems`](#recipeproblems) | function | Look an effect over and say what is wrong, in plain words (it is always made safe by `cleanRecipe`; this tells the person what was changed). |
| [`refOf`](#refof) | function | The thing that one of a thing's pointer fields points at: `refOf(game, button, 'opens')` is the door the button opens, or undefined if it points at nothing or the thing is gone. |
| [`resetBindings`](#resetbindings) | function | Put one action (or all) back to the game's usual keys. |
| [`resetSettings`](#resetsettings) | function | Put every setting (and every key) back to what the game started with. |
| [`retile`](#retile) | function | Work out the shape of every auto-tiled tile again, after the game has added or removed some (breaking a block, growing a bridge). |
| [`route`](#route) | function | Find the shortest way from one place to another across a grid, moving to the next square, up, down, left, right or across (not round the corner of a wall). |
| [`runChecks`](#runchecks) | function | Run the checks that have been added since the last run, one after another, and clear the list. |
| [`sampleClip`](#sampleclip) | function | Every number of a clip at a time, as `{ y: 96.5, alpha: 1 }`. |
| [`sampleTrack`](#sampletrack) | function | The value of one track at a time: before the first key it is the first value, after the last key the last. |
| [`saveProgress`](#saveprogress) | function | Keep this (numbers, text, true/false, lists and objects of them; at most about 20 KB) for next time. |
| [`sceneFieldProblems`](#scenefieldproblems) | function | Look over a scene against the kinds and say what is wrong with its things' fields: a pointer to a name nothing has, to a thing of the wrong kind, a name used twice, a number out of its range. |
| [`screen`](#screen) | function | How big the screen is and what colour its background is. |
| [`sequenceActive`](#sequenceactive) | function | Is a sequence going? |
| [`sequenceProblems`](#sequenceproblems) | function | Look a sequence over and say what is wrong, in plain words. |
| [`setAssetHost`](#setassethost) | function | Choose where pictures come from (for tests, or a host that is not the studio). |
| [`setBinding`](#setbinding) | function | Choose the keys for an action (up to three) and keep them for next time. |
| [`setCanvasFactory`](#setcanvasfactory) | function | Choose how small canvases are made (the default is an OffscreenCanvas, which the game's worker and modern browsers have). |
| [`setLanguage`](#setlanguage) | function | Choose the language: 'fr', 'pt-BR' (falls back to 'pt' when only that is in the table), or 'auto'. |
| [`setNetInfo`](#setnetinfo) | function | Tell the kit about the game being played. |
| [`setProgressHost`](#setprogresshost) | function | Where saved progress goes and where it is read from (for tests, or a host that is not the studio). |
| [`setPseudo`](#setpseudo) | function | Turn on (or off) the stretched, accented test text that shows which words are not in the table and which are too long for their space. |
| [`setSetting`](#setsetting) | function | Change a setting (kept in range) and keep it for next time. |
| [`setSoundSink`](#setsoundsink) | function | Choose where played sounds go (for tests, or a host that is not the studio). |
| [`setStoryVar`](#setstoryvar) | function | Set one of the story's numbers or flags from the game (the story can then ask about it with `<<if hasKey>>`). |
| [`settings`](#settings) | function | Start the settings: loads what the player chose last time, and sets what the game would like as the starting values. |
| [`settingsMenuOpen`](#settingsmenuopen) | function | Is the menu open? |
| [`settingsMenuScreen`](#settingsmenuscreen) | function | The menu as a UI screen (plain data), for drawing and for finding what was clicked. |
| [`settingsValues`](#settingsvalues) | function | Every setting's value. |
| [`shade`](#shade) | function | A colour made darker (or lighter, with a factor above 1): `#3b4a6b` to `#24304a`. |
| [`shadowShapes`](#shadowshapes) | function | The shadow a set of boxes throws from a light: for each side of a box that faces the light, the four corners of the area behind that side, stretching out to `reach`. |
| [`shake`](#shake) | function | Shake the screen for a moment. |
| [`shakeOffset`](#shakeoffset) | function | Where the screen is pushed by the shake right now (zero when nothing is shaking). |
| [`shapesOf`](#shapesof) | function | The shapes of a mode, as the neighbour masks they stand for, in frame order (frame 0 is a tile on its own). |
| [`simulate`](#simulate) | function | Play a game's own `create` and `update` for some ticks without drawing, and give back its state, so a check can say what happened. |
| [`sky3d`](#sky3d) | function | Fill the screen with a sky above the horizon and ground below it (the horizon moves when the camera looks up or down). |
| [`slideAgainst`](#slideagainst) | function | Move a point along the floor and slide along blocks instead of going through them. |
| [`solidAt`](#solidat) | function | Is there a solid thing at this point? |
| [`sounds`](#sounds) | function | Give the sounds names, so a game can say `play('coin')`. |
| [`spawn`](#spawn) | function | Add a thing to the game. |
| [`spriteProblem`](#spriteproblem) | function | Check that something is a usable sprite. |
| [`stairs`](#stairs) | function | Stairs: `steps` blocks, each higher than the last, as a list to put in your blocks (`...stairs(...)`). |
| [`startStory`](#startstory) | function | Begin a story at a node. |
| [`steer`](#steer) | function | Move in four directions with the keys (for a game seen from above): sets both speeds, and keeps diagonals from being faster. |
| [`stepCaptions`](#stepcaptions) | function | Age the captions and remove the ones that are done. |
| [`stepClip`](#stepclip) | function | Play a clip on a thing: call it every tick. |
| [`stepLayers`](#steplayers) | function | Move the layers' clock on, so layers that scroll by themselves (clouds) keep moving. |
| [`stepSequence`](#stepsequence) | function | Move a sequence on: call it every tick. |
| [`stepSettingsMenu`](#stepsettingsmenu) | function | Handle the keys (and the mouse) for one tick. |
| [`stepState`](#stepstate) | function | Move a thing along its machine: call it every tick. |
| [`stepStory`](#stepstory) | function | Handle one tick: Enter, Space or a click finishes the line being typed, then goes on; the arrow keys and the number keys choose. |
| [`stopMusic`](#stopmusic) | function | Fade the music out. |
| [`story`](#story) | function | Read a story and keep it for `startStory`. |
| [`storyActive`](#storyactive) | function | Is a story going? |
| [`storyProblems`](#storyproblems) | function | Look a parsed story over: what could not be read, nodes nothing leads to, variables that are asked about but never set (probably a typo), nodes with nothing in them, and a node that only sends you to itself. |
| [`storyState`](#storystate) | function | What the story is saying now: `{ line: {speaker, text, id} \| null, choices: [{text, id, index}] \| null, ended, node }`. |
| [`storyVar`](#storyvar) | function | The story's own numbers and flags (`trust`, `hasKey`): read one from the game. |
| [`stream`](#stream) | function | Keep an effect going: call it every tick and it makes `rate` particles a second (the part of a particle that does not fit in this tick is kept for the next, so the rate is right at any frame rate). |
| [`stripMarkup`](#stripmarkup) | function | The words with the tags taken out. |
| [`t`](#t) | function | The words for a key in the chosen language. |
| [`takeSequenceCommands`](#takesequencecommands) | function | What the sequence has asked the game to do (`command` events), once: the list is emptied. |
| [`takeStoryCommands`](#takestorycommands) | function | What the story has asked the game to do (`<<do open-door>>`), once: the list is emptied. |
| [`test`](#test) | function | Add a check. |
| [`text`](#text) | function | Give the game its words. |
| [`textOf`](#textof) | function | The words a widget shows: `{score}` filled from the game, `@key` looked up in the language table. |
| [`textProblems`](#textproblems) | function | Look over a table and say what is wrong or missing, in plain words. |
| [`timed`](#timed) | function | Run a function and, when the studio's Profiler is recording, add how long it took to the frame's time under `name`. |
| [`touches`](#touches) | function | The first thing of a kind that overlaps this one, or undefined. |
| [`touching`](#touching) | function | Do two things overlap? |
| [`uiButtons`](#uibuttons) | function | The ids of the buttons that show, in the order they are listed. |
| [`uiHit`](#uihit) | function | The id of the top-most button under a point, or null. |
| [`uiNext`](#uinext) | function | The button after (or before) the focused one, going round; with nothing focused it is the first (or last). |
| [`uiProblems`](#uiproblems) | function | Say what is wrong with a screen, in plain words: two widgets with the same id, a button with no id, widgets off the screen, words that probably will not fit, a bar with nothing to show. |
| [`walk`](#walk) | function | Walk left and right with the keys: sets the sideways speed. |
| [`worldProblems`](#worldproblems) | function | Look a world over and say what is wrong, in plain words. |

## Functions

### `actionsList`

```js
function actionsList()
```

Every action the game has, with its keys now and its usual keys.

<sub>src/settings.js:130</sub>

### `advanceStory`

```js
function advanceStory(game)
```

Go on from a line (nothing happens while a choice is waiting).

<sub>src/story.js:391</sub>

### `all`

```js
function all(game, kind)
```

All the things of one kind (or every thing). The list is a copy, so it is safe to {@link despawn} while looping over it.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` |  |
| `kind` (optional) | `string` |  |

**Returns** `Thing[]`

<sub>src/things.js:49</sub>

### `animate`

```js
function animate(thing, art, dt)
```

Move a thing's picture along its animation: set `thing.anim` to a name from the sprite (`'run'`) and call this every tick; it sets `thing.frame`.
The animation restarts when the name changes. It plays the way the animation's `mode` says (see {@link animationFrame}), and `thing.animDone` becomes true when a `once` animation has reached its end.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `thing` | `import('./things.js').Thing & {anim?: string}` |  |
| `art` | `Object<string, Sprite>` | the game's sprites |
| `dt` | `number` |  |

<sub>src/art.js:154</sub>

### `animationDone`

```js
function animationDone(animation, time)
```

Has a `once` animation reached its last frame? (Any other kind never ends.)

<sub>src/art.js:143</sub>

### `animationFrame`

```js
function animationFrame(animation, time)
```

Which frame of a sprite an animation shows after some time. The animation's `mode` says how it plays: `loop` (the default) goes round and round, `once` stops on its last frame,
`reverse` goes backwards round and round, and `pingpong` goes to the end and back again without showing the end frames twice.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `animation` | `{frames: number[], fps: number, mode?: string}` |  |
| `time` | `number` | seconds since it began |

**Returns** `number` — the frame number

<sub>src/art.js:128</sub>

### `behave`

```js
function behave(game, dt, keys)
```

Run every behaviour: call it once a tick. Things get the behaviours of their `kind` (from `behaviors(...)`) and any of their own in `thing.behaviors`. Things made by
`shoot` fly on their own and are removed when their time (`ttl`) is up.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `object` |  |
| `dt` | `number` |  |
| `keys` (optional) | `Set<string>` | the keys held (for `shoot` with a key) |

<sub>src/behaviors.js:327</sub>

### `behaviorProblems`

```js
function behaviorProblems(list)
```

Say what is wrong with a list of behaviours, in plain words (they are always made safe when used; this says what was changed or will not work).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `list` | `Behavior[]` |  |

**Returns** `{index: number, message: string}[]`

<sub>src/behaviors.js:125</sub>

### `behaviors`

```js
function behaviors(byKind)
```

Give kinds of things their behaviours, once, at the top of the game's file.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `byKind` | `Object<string, Behavior[]>` | for example what you made in the Behaviours panel |

<sub>src/behaviors.js:94</sub>

### `block`

```js
function block(x, z, w, d, h = 3, color = '#8a93a6', y = 0, yaw = 0)
```

A block to build with: its middle (`x`, `z`), its size (`w` wide, `d` deep, `h` tall, standing on `y`, the floor by default), colour, and how far it is turned
(`yaw` in radians, positive turns it to the left): a turned wall is stopped at and drawn as it stands.

<sub>src/view3d.js:228</sub>

### `block3d`

```js
function block3d(g, cam, b, o = {}, view = null)
```

Draw the faces of one block that face the camera. Used by {@link drawWorld3d}; call it yourself to draw a block by itself.

<sub>src/view3d.js:399</sub>

### `build`

```js
function build()
```

The build the game is running as.

**Returns** `{name: string, debug: boolean}` — the profile's name ('dev' inside the studio) and whether it is a debug build

<sub>src/build.js:8</sub>

### `burst`

```js
function burst(game, x, y, { count = 12, color = '#ffd23c', speed = 160, life = 0.5, size = 4, gravity = 400 } = {})
```

Throw a burst of small sparks from a point.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` |  |
| `x` | `number` |  |
| `y` | `number` |  |
| `o` (optional) | `{count?: number, color?: string, speed?: number, life?: number, size?: number, gravity?: number}` | `count` how many, `speed` how fast they fly out (pixels per second), `life` seconds before they are gone, `gravity` how hard they fall |

<sub>src/effects.js:16</sub>

### `camera3d`

```js
function camera3d({ x = 0, y, z = 0, yaw = 0, pitch = 0, fov = 70, eye = 1.6 } = {})
```

A first-person camera: where the eyes are, which way they look, and how wide they see.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{x?: number, y?: number, z?: number, yaw?: number, pitch?: number, fov?: number, eye?: number}` | `y` is the height of the eyes (`eye` is how high they are when standing: jumping raises `y`), `yaw` and `pitch` are in radians (up and down is `pitch`), `fov` is the field of view in degrees |

**Returns** `{x: number, y: number, z: number, yaw: number, pitch: number, fov: number, eye: number, vy: number}`

<sub>src/view3d.js:23</sub>

### `caption`

```js
function caption(game, text, seconds = 2.5)
```

Words for a sound or something only heard, shown for a moment when the player has captions on. Call `stepCaptions` every tick and `drawCaptions` when drawing.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `object` |  |
| `text` | `string` | for example `[door creaks]` or `Sam: Watch out!` |
| `seconds` (optional) | `number` |  |

<sub>src/settings.js:188</sub>

### `chase3d`

```js
function chase3d(thing, target, speed, dt, blocks = [], radius = 0.4)
```

Walk something towards a place along the floor, sliding along blocks, for a guardian that chases you. Changes `thing.x` and `thing.z`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `thing` | `{x: number, z: number}` |  |
| `target` | `{x: number, z: number}` |  |
| `speed` | `number` | units a second |
| `dt` | `number` |  |
| `blocks` (optional) | `object[]` | what stops it |
| `radius` (optional) | `number` |  |

**Returns** `number` — the distance left to the target

<sub>src/view3d.js:195</sub>

### `chooseStory`

```js
function chooseStory(game, index)
```

Pick one of the choices on offer (by its place in the list shown).

<sub>src/story.js:398</sub>

### `cleanBehavior`

```js
function cleanBehavior(spec)
```

Make one behaviour safe: a known type, every setting there and within its range (a missing one gets its starting value).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `unknown` |  |

**Returns** `Behavior \| null`

<sub>src/behaviors.js:106</sub>

### `cleanEvent`

```js
function cleanEvent(spec, duration = SEQUENCE_LIMITS.duration)
```

Make one event safe: a known kind, a time in the sequence, every setting there and within its range.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `unknown` |  |
| `duration` (optional) | `number` | the length of the sequence |

**Returns** `SequenceEvent \| null`

<sub>src/sequences.js:68</sub>

### `cleanField`

```js
function cleanField(spec)
```

Make one field safe: a known type, its settings there and in range, and a default that fits.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `unknown` |  |

**Returns** `object \| null`

<sub>src/kinds.js:37</sub>

### `cleanKinds`

```js
function cleanKinds(table)
```

Make a kinds table safe: every kind with a name that fits, a template that is plain (a size, a colour, an emoji or a picture) and fields that are clean.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `table` | `unknown` |  |

**Returns** `Object<string, {template: object, fields: Object<string, object>}>`

<sub>src/kinds.js:62</sub>

### `cleanMask`

```js
function cleanMask(mask)
```

Keep a corner only when both sides next to it are there (a corner next to a gap would not be seen), so 256 shapes become 47.

<sub>src/autotile.js:24</sub>

### `cleanRecipe`

```js
function cleanRecipe(spec)
```

Make a recipe safe to use: known fields only, numbers kept in a sane range, at most 6 colors, a pair of numbers for the ranges. Anything missing gets a plain default.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `unknown` |  |

**Returns** `Required<Recipe>`

<sub>src/particles.js:42</sub>

### `cleanSong`

```js
function cleanSong(spec)
```

Clean up a song that came from outside (the game's worker is not trusted by the page that plays it): known fields only, notes that are note names such as
'A4' or 'C#3' (or null for a rest, or a list of up to six names for a chord), lengths in a sane range, at most 8 tracks, 600 notes a track and a minute of music.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `unknown` |  |

**Returns** `{bpm: number, tracks: {wave: string, gain: number, decay?: number, lowpass?: number, notes: [string \| null, number][]}[]} \| null`

<sub>src/music.js:18</sub>

### `cleanSound`

```js
function cleanSound(spec)
```

Clean up a sound recipe that came from outside (the game's worker is not trusted by the page that plays it): only known fields, numbers that are numbers
and in a safe range, at most 3 seconds and 8 layers.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `unknown` |  |

**Returns** `object \| null` — a clean copy, or null if it is not a usable recipe

<sub>src/sound.js:21</sub>

### `cleanUi`

```js
function cleanUi(spec)
```

Make a whole screen safe (at most 60 widgets).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `unknown` |  |

**Returns** `{size?: [number, number], widgets: Widget[]}`

<sub>src/ui.js:95</sub>

### `cleanWidget`

```js
function cleanWidget(spec)
```

Make one widget safe: a known type, an anchor from the list, numbers kept in range, colors that are colors, short text, paths that look like paths.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `unknown` |  |

**Returns** `Widget \| null`

<sub>src/ui.js:54</sub>

### `cleanWorld`

```js
function cleanWorld(data)
```

Make a world safe: room names that fit, links between rooms that exist, edges that are sides, and a start that is a room.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `data` | `unknown` |  |

**Returns** `WorldData`

<sub>src/world.js:38</sub>

### `clear`

```js
function clear(g, color = screen().background, width = screen().width, height = screen().height)
```

Fill the whole screen with one colour (the background colour from the project's settings unless you give one).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `color` (optional) | `string` |  |
| `width` (optional) | `number` | screen width in pixels |
| `height` (optional) | `number` | screen height in pixels |

<sub>src/draw.js:18</sub>

### `clearSequence`

```js
function clearSequence(game)
```

Forget the sequence, and with it the fade and the black bars it left behind.

<sub>src/sequences.js:187</sub>

### `clearThings`

```js
function clearThings(game, keep = [])
```

Take every thing out of the game (to start a level again), except the kinds you name.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` |  |
| `keep` (optional) | `string[]` | kinds to leave in place |

<sub>src/things.js:69</sub>

### `clipProblems`

```js
function clipProblems(clip)
```

Look a clip over and say what is wrong, in plain words.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `clip` | `Clip` |  |

**Returns** `{field: string, kind: 'shape' \| 'time' \| 'order' \| 'value' \| 'ease' \| 'length', message: string}[]`

<sub>src/clips.js:73</sub>

### `clipTime`

```js
function clipTime(clip, time)
```

The time inside the clip: a looping clip wraps round, another stops at its end.

<sub>src/clips.js:43</sub>

### `closeSettingsMenu`

```js
function closeSettingsMenu(game)
```

Close the menu.

<sub>src/settings-menu.js:32</sub>

### `conflictsFor`

```js
function conflictsFor(action, code)
```

The other actions that already use a key.

<sub>src/settings.js:137</sub>

### `controls`

```js
function controls(actions)
```

Give the game its own actions, each with the keys it uses by default. A player can still change them.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `actions` | `Object<string, string[]>` | for example `{ fire: ['KeyX'], pause: ['Escape'] }` |

<sub>src/settings.js:66</sub>

### `describe`

```js
function describe(tr)
```

A transition in plain words: "when vx != 0", "after 0.5 s", "on hit", or several joined with "and".

<sub>src/states.js:97</sub>

### `despawn`

```js
function despawn(game, thing)
```

Take a thing out of the game (a coin that was picked up). Does nothing if it is already gone.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` |  |
| `thing` | `Thing` |  |

**Returns** `boolean` — whether it was there

<sub>src/things.js:79</sub>

### `drawAutoTile`

```js
function drawAutoTile(g, x, y, size, mask, color, { edge, width } = {})
```

Draw one auto-tiled tile with no picture: the colour, an edge on each side that has no neighbour, and a small notch where a corner is missing between two neighbours.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `x` | `number` |  |
| `y` | `number` |  |
| `size` | `number` |  |
| `mask` | `number` | the tile's neighbour mask |
| `color` | `string` |  |
| `o` (optional) | `{edge?: string, width?: number}` |  |

<sub>src/autotile.js:106</sub>

### `drawCaptions`

```js
function drawCaptions(g, game, size = { width: 480, height: 320 })
```

Draw the captions at the bottom of the screen, as big as the player's text size says.

<sub>src/settings.js:203</sub>

### `drawImage`

```js
function drawImage(g, path, x, y, w, h, { flip = false, frames = 1, frame = 0, cols = 0, rows = 1 } = {})
```

Draw a picture file. Several frames side by side in one picture (a strip) work too: say how many with `frames` and which one with `frame`. A sheet (a grid
of frames, rows as well as columns) works the same way: say `cols` and `rows`, and `frame` counts along the first row, then the next (0 is the top left).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `path` | `string` | for example 'assets/hero.png' |
| `x` | `number` |  |
| `y` | `number` |  |
| `w` (optional) | `number` | width on the screen (default: the picture's own) |
| `h` (optional) | `number` | height on the screen (default: the picture's own) |
| `o` (optional) | `{flip?: boolean, frames?: number, frame?: number, cols?: number, rows?: number}` | `flip` mirrors it left to right |

<sub>src/assets.js:44</sub>

### `drawLayers`

```js
function drawLayers(g, game, layers, { front = false, art, width = screen().width, height = screen().height } = {})
```

Draw the layers. Call it before `drawThings` for the backdrop, and again with `{ front: true }` after it for layers that pass in front of everything (mist, leaves).
A layer's `parallax` says how much it moves with the camera: 1 moves with the world, 0.5 moves half as much (so it looks far away), 0 stays put on the screen.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `game` | `{camera?: {x: number, y: number}, layerClock?: number}` |  |
| `layers` | `Array<object> \| {layers: Array<object>}` | the layers, or the whole file from the Layers panel |
| `opts` (optional) | `{front?: boolean, art?: Object<string, import('./art.js').Sprite>, width?: number, height?: number}` | `front`: draw the layers marked "in front" instead |

<sub>src/camera.js:172</sub>

### `drawLights`

```js
function drawLights(g, game, file, { width = screen().width, height = screen().height } = {})
```

Draw the lights and screen effects. Call it after `drawThings` (and before the text and screens that should stay bright).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `game` | `{camera?: {x: number, y: number}, layerClock?: number, things: import('./things.js').Thing[]}` |  |
| `file` | `{screen?: object, lights: Array<object>} \| Array<object>` | the whole file from the Lights panel, or just the list of lights |
| `opts` (optional) | `{width?: number, height?: number}` | the screen's size |

<sub>src/lights.js:161</sub>

### `drawMarkup`

```js
function drawMarkup(g, lines, x, y, lineHeight, { font, color = '#ffffff', shown = Infinity })
```

Draw lines made by `layoutMarkup`, showing only the first `shown` letters (all of them when left out).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `lines` | `ReturnType<typeof layoutMarkup>` |  |
| `x` | `number` | left edge |
| `y` | `number` | top of the first line |
| `lineHeight` | `number` |  |
| `look` | `{font: string, color?: string, shown?: number}` |  |

**Returns** `number` — how many letters were drawn

<sub>src/markup.js:98</sub>

### `drawSequence`

```js
function drawSequence(g, game, { width = screen().width, height = screen().height } = {})
```

Draw what a sequence puts over the picture: the fade to black and the black bars at the top and bottom. Call it every frame, after drawing the game (and before the story's box).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `game` | `{sequence?: {screen: {fade: number, letterbox: number}}}` |  |
| `opts` (optional) | `{width?: number, height?: number}` | the screen's size |

<sub>src/sequences.js:197</sub>

### `drawSettingsMenu`

```js
function drawSettingsMenu(g, game)
```

Draw the menu over the game.

<sub>src/settings-menu.js:180</sub>

### `drawSprite`

```js
function drawSprite(g, sprite, frame, x, y, w = sprite.w, h = sprite.h, flip = false)
```

Draw one frame of a sprite, crisp (no smoothing), stretched to a size.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `sprite` | `Sprite` |  |
| `frame` | `number` |  |
| `x` | `number` | left edge |
| `y` | `number` | top edge |
| `w` (optional) | `number` | drawn width (default: the sprite's own) |
| `h` (optional) | `number` | drawn height |
| `flip` (optional) | `boolean` | mirrored left to right |

<sub>src/art.js:107</sub>

### `drawStory`

```js
function drawStory(g, game, { size = screen() } = {})
```

Draw the dialogue box at the bottom of the screen (the speaker, the words as they are typed, and the choices), as big as the player's text size says.

<sub>src/story.js:462</sub>

### `drawThings`

```js
function drawThings(g, game, art)
```

Draw every thing: its picture file if it has one (`thing.image = 'assets/hero.png'`, see {@link drawImage}; `frames` and `frame` pick from a strip, or `cols`, `rows` and `frame` from a sheet), its sprite if it has one (`thing.sprite = 'hero'`, drawn from the `art` you pass, mirrored when `thing.flip` is true), its emoji, or a box in
its colour (`shape: 'circle'` makes a round one). Things with `hidden: true` are skipped and `alpha` makes them see-through. The camera (see {@link follow})
decides which part of the world is on the screen, and a {@link shake} moves it for a moment. Draw text and scores with {@link label} afterwards.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `game` | `{things: import('./things.js').Thing[], camera?: {x: number, y: number}}` |  |
| `art` (optional) | `Object<string, import('./art.js').Sprite>` | the game's sprites by name |

<sub>src/draw.js:31</sub>

### `drawUi`

```js
function drawUi(g, spec, game = {}, opts = {})
```

Draw a screen. It does not move with the camera. `opts.focus` is the id of the button that has the keyboard focus, `opts.art` the game's sprites (for pictures), and
`opts.size` the screen size (default: the game's).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `spec` | `{widgets: Widget[]}` |  |
| `game` (optional) | `object` | the game's state, for numbers in text and bars |
| `opts` (optional) | `{focus?: string \| null, art?: object, size?: {width: number, height: number}}` |  |

<sub>src/ui.js:181</sub>

### `drawWorld3d`

```js
function drawWorld3d(g, cam, world, o = {})
```

Draw the whole world: the sky, the floor lines, then every block and gem from the farthest to the nearest, fading into fog in the distance.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `cam` | `ReturnType<typeof camera3d>` |  |
| `world` | `{blocks?: object[], gems?: object[]}` |  |
| `o` (optional) | `{time?: number, sky?: string, horizon?: string, ground?: string, fog?: string, fogFar?: number, grid?: boolean, cell?: number}` | `time` is seconds (gems float with it); `fogFar` is how far you can see, in units (0 turns the fog off); `grid: false` hides the floor lines. A block with `floor: true` (or lower than a step) is drawn first |

**Returns** `number` — how many blocks and gems were drawn (those too far away or behind you are skipped)

<sub>src/view3d.js:521</sub>

### `ease`

```js
function ease(how, u)
```

How far along a segment a number is, 0 to 1, made slow at the start ('in'), the end ('out') or both ('inout').

<sub>src/clips.js:17</sub>

### `effects`

```js
function effects(game, dt)
```

Move the sparks, fade them out, remove the ones that are done, and settle the shake. Call it every tick.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` |  |
| `dt` | `number` |  |

<sub>src/effects.js:44</sub>

### `emit`

```js
function emit(game, recipe, x, y)
```

Throw one burst of an effect from a point.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `object` |  |
| `recipe` | `Recipe` |  |
| `x` | `number` |  |
| `y` | `number` |  |

<sub>src/particles.js:85</sub>

### `enterState`

```js
function enterState(thing, machine, name)
```

Put a thing into a state: sets `state`, restarts `stateTime`, and starts the state's animation.

<sub>src/states.js:47</sub>

### `eventsOf`

```js
function eventsOf(machine)
```

The event names a machine reacts to, in the order they appear.

<sub>src/states.js:80</sub>

### `every`

```js
function every(game, name, seconds, dt)
```

Do something every so many seconds. Call it once per tick with a name; it answers true on the ticks when the time is up.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` |  |
| `name` | `string` | any name, one per timer |
| `seconds` | `number` |  |
| `dt` | `number` |  |

**Returns** `boolean`

<sub>src/things.js:136</sub>

### `expect`

```js
function expect(actual)
```

Matchers for a value: `expect(x).toBe(3)`. `expect(x).not.toBe(3)` says the opposite.

<sub>src/check.js:49</sub>

### `fieldDefaults`

```js
function fieldDefaults(kinds, kind)
```

The starting values of a kind's fields, as `{ locked: true, delay: 0 }` (a pointer starts with nothing).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `kinds` | `Object<string, object>` |  |
| `kind` | `string` |  |

<sub>src/kinds.js:85</sub>

### `fieldsOf`

```js
function fieldsOf(machine)
```

The thing fields a machine looks at in its conditions, in the order they appear.

<sub>src/states.js:87</sub>

### `first`

```js
function first(game, kind)
```

The first thing of a kind, or undefined when there is none (for example the only 'hero').

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` |  |
| `kind` | `string` |  |

**Returns** `Thing \| undefined`

<sub>src/things.js:60</sub>

### `fitValue`

```js
function fitValue(field, value)
```

Make a value fit a field: a number is held between its smallest and largest, a choice must be one of the list, a flag is yes or no.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `field` | `object` |  |
| `value` | `unknown` |  |

<sub>src/kinds.js:96</sub>

### `flicker`

```js
function flicker(amount, time, seed = 0)
```

How bright a flickering light is at a moment, from 0 to 1 (1 when it does not flicker). The same time always gives the same brightness.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `amount` | `number` | how much it flickers, from 0 to 1 |
| `time` | `number` | the clock, in seconds |
| `seed` (optional) | `number` | makes one light flicker differently from another |

**Returns** `number`

<sub>src/lights.js:33</sub>

### `floor3d`

```js
function floor3d(g, cam, { cell = 2, reach = 18, color = 'rgba(255, 255, 255, 0.10)', width = screen().width, height = screen().height } = {})
```

Lines on the floor around you, so you can see yourself move.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{cell?: number, reach?: number, color?: string}` |  |

<sub>src/view3d.js:464</sub>

### `follow`

```js
function follow(game, thing, map, screenWidth = screen().width, screenHeight = screen().height)
```

Point the camera at a thing so it stays in the middle of the screen, without showing anything outside the map.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `{camera?: {x: number, y: number}}` |  |
| `thing` | `import('./things.js').Thing \| undefined` |  |
| `map` | `{width: number, height: number}` | the size of the whole world, for example what {@link loadMap} returned |
| `screenWidth` (optional) | `number` |  |
| `screenHeight` (optional) | `number` |  |

<sub>src/draw.js:93</sub>

### `followSmooth`

```js
function followSmooth(game, thing, map, dt, opts = {})
```

Keep the camera on a thing, with a delay and a look ahead. Call it every frame in `update` (it needs `dt`). The camera never shows anything outside the map. The first call
puts the camera right on the thing.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `{camera?: {x: number, y: number}}` |  |
| `thing` | `import('./things.js').Thing \| undefined` |  |
| `map` | `{width: number, height: number}` | the size of the whole world, for example what loadMap returned |
| `dt` | `number` | seconds since the last frame |
| `opts` (optional) | `{smooth?: number, lookAhead?: number, deadZone?: number, width?: number, height?: number}` | `smooth`: seconds to catch up (0 is no delay); `lookAhead`: pixels to show ahead of where the thing is heading; `deadZone`: pixels the thing may wander from the middle before the camera moves; `width`, `height`: the screen |

<sub>src/camera.js:40</sub>

### `forward3d`

```js
function forward3d(cam)
```

Which way a camera looks along the floor, as `{x, z}` (a unit step), and which way is to its right.

<sub>src/view3d.js:28</sub>

### `frameCanvas`

```js
function frameCanvas(sprite, index = 0)
```

One frame of a sprite as a small canvas, made once and kept.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `sprite` | `Sprite` |  |
| `index` (optional) | `number` |  |

**Returns** `any` — a canvas

<sub>src/art.js:74</sub>

### `frameFor`

```js
function frameFor(mask, mode)
```

The frame (the number of the picture) for a tile with these neighbours.

<sub>src/autotile.js:44</sub>

### `gem`

```js
function gem(x, z, y = 1, color = '#4cf0c4', r = 0.3)
```

A gem to collect: where it floats (`x`, `z`, height `y`), its size (`r`) and colour.

<sub>src/view3d.js:258</sub>

### `gem3d`

```js
function gem3d(g, cam, gm, o = {}, view = null)
```

Draw one gem as a diamond that faces you. Used by {@link drawWorld3d}.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `time` (optional) | `number` | seconds, so gems float up and down |

<sub>src/view3d.js:422</sub>

### `getSetting`

```js
function getSetting(name)
```

The value of a setting.

<sub>src/settings.js:91</sub>

### `gravity`

```js
function gravity(thing, dt, pull = 1800)
```

Pull a thing downwards (call it every tick, before {@link moveAndCollide}). Falling speed is limited so nothing falls through the floor.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `thing` | `import('./things.js').Thing` |  |
| `dt` | `number` |  |
| `pull` (optional) | `number` | how strong, in pixels per second per second |

<sub>src/control.js:64</sub>

### `groundAt`

```js
function groundAt(blocks, x, z, feet = 0, radius = 0.3)
```

The height of the ground under a walker: the highest top of the blocks under it that it can step onto (no more than a step above its feet), or the floor, 0.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `blocks` | `object[]` |  |
| `x` | `number` |  |
| `z` | `number` |  |
| `feet` (optional) | `number` | how high the feet are now |
| `radius` (optional) | `number` |  |

**Returns** `number`

<sub>src/view3d.js:65</sub>

### `heal`

```js
function heal(thing, amount = 1)
```

Give hit points back (never above what it started with).

<sub>src/behaviors.js:181</sub>

### `held`

```js
function held(keys, name)
```

Is a key held down? Easy names work: 'left', 'right', 'up', 'down' (arrow keys and WASD), 'space', 'jump' (space, up or W), 'action' (X, Z or Enter), and
'click' and 'rightClick' for the mouse buttons (once the game has asked for the mouse, see {@link mouseDelta}).
Any real key code works too: 'KeyP', 'Digit1', 'ShiftLeft'.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `keys` | `Set<string>` | the keys held down |
| `name` | `string` |  |

**Returns** `boolean`

<sub>src/control.js:16</sub>

### `holds`

```js
function holds(thing, c)
```

Whether one condition holds for a thing. A field the thing does not have is undefined, so `!=` holds and the others do not (except `== undefined`-free ones).

<sub>src/states.js:25</sub>

### `hurt`

```js
function hurt(game, thing, amount = 1)
```

Hurt a thing that has the health behaviour. Returns true if that was the end of it. A thing that was hurt a moment ago is safe, and nothing happens.

<sub>src/behaviors.js:173</sub>

### `image`

```js
function image(path)
```

The picture at a path, or null when there is none.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `path` | `string` | for example 'assets/hero.png' |

**Returns** `CanvasImageSource \| null`

<sub>src/assets.js:23</sub>

### `imageSize`

```js
function imageSize(path)
```

The size of a picture in pixels, or null when there is none.

<sub>src/assets.js:28</sub>

### `isAssetPath`

```js
function isAssetPath(path)
```

Is this a path the studio keeps pictures and sounds at? (`assets/` and a plain file name: no folders above, no odd characters.)

<sub>src/assets.js:75</sub>

### `isOnline`

```js
function isOnline()
```

Is the game being played with someone else over the network?

<sub>src/netplay.js:28</sub>

### `isReservedField`

```js
function isReservedField(name)
```

Is this word one that a field cannot be called, because things already have it?

<sub>src/kinds.js:30</sub>

### `isWaiting`

```js
function isWaiting()
```

True while the game is waiting for the other player's keys (draw a "waiting for your friend" message).

<sub>src/netplay.js:30</sub>

### `jump`

```js
function jump(thing, keys, power = 620)
```

Jump if a jump key is held and the thing is standing on something.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `thing` | `import('./things.js').Thing` |  |
| `keys` | `Set<string>` |  |
| `power` (optional) | `number` | how fast it leaves the ground, in pixels per second |

**Returns** `boolean` — whether it jumped

<sub>src/control.js:51</sub>

### `jump3d`

```js
function jump3d(cam, keys, dt, { strength = 6, gravity = 20, blocks = [] } = {})
```

Jump with the space bar: it starts a jump when you are on the ground (the floor, a ledge, a ramp). You come down again by gravity, onto whatever is under you.
Call it every tick, next to {@link move3d} (which does the falling and landing); on its own it does those too, for the floor or for `blocks`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `cam` | `ReturnType<typeof camera3d>` | changed in place |
| `keys` | `Set<string>` |  |
| `dt` | `number` |  |
| `o` (optional) | `{strength?: number, gravity?: number, blocks?: object[]}` | `strength` is how fast the jump starts (units a second); `gravity` how fast it slows |

**Returns** `boolean` — true while you are on the ground

<sub>src/view3d.js:216</sub>

### `keyList`

```js
function keyList(keys)
```

The key codes of a set, in a fixed order, so the same keys always look the same.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `keys` | `Iterable<string>` |  |

<sub>src/netplay.js:36</sub>

### `keyName`

```js
function keyName(code)
```

A key code in plain words: "Left arrow", "A", "Space", "Enter", "Shift (left)".

<sub>src/settings.js:169</sub>

### `kindProblems`

```js
function kindProblems(table)
```

Say what is wrong with a kinds table, in plain words.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `table` | `Object<string, object>` |  |

**Returns** `{kind: string, field: string, message: string}[]`

<sub>src/kinds.js:130</sub>

### `label`

```js
function label(g, text, x, y, { size = 16, color = '#fff', align = 'left' } = {})
```

Write text on the screen (it does not move with the camera).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `text` | `string\|number` |  |
| `x` | `number` |  |
| `y` | `number` |  |
| `style` (optional) | `{size?: number, color?: string, align?: 'left'\|'center'\|'right'}` |  |

<sub>src/draw.js:77</sub>

### `language`

```js
function language()
```

The language now chosen ('' before `text()` is called).

<sub>src/text.js:22</sub>

### `languages`

```js
function languages()
```

The language codes in a table, the first one being the one every other falls back to.

<sub>src/text.js:19</sub>

### `layerProblems`

```js
function layerProblems(file)
```

Say what is wrong with a set of layers, as short sentences (an empty list when it is fine).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `file` | `Array<object> \| {camera?: object, layers: Array<object>}` |  |

**Returns** `string[]`

<sub>src/camera.js:194</sub>

### `layoutMarkup`

```js
function layoutMarkup(g, source, width, font)
```

Break marked-up words into lines that fit a width, as runs of letters that share a look.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `source` | `string` | the words, with tags |
| `width` | `number` | the most a line may be, in pixels |
| `font` | `string` | the plain font, like "16px system-ui" (bold and italic are put in front of it) |

**Returns** `Array<Array<{text: string, color: string \| null, bold: boolean, italic: boolean}>>` — lines of runs

<sub>src/markup.js:53</sub>

### `layoutUi`

```js
function layoutUi(spec, game, opts)
```

Every widget of a screen with the box it covers: `[{ widget, x, y, w, h }]`, in drawing order (the last is on top).

<sub>src/ui.js:147</sub>

### `lightProblems`

```js
function lightProblems(file)
```

Say what is wrong with a lights file, as short sentences (an empty list when it is fine).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `file` | `{screen?: object, lights: Array<object>} \| Array<object>` |  |

**Returns** `string[]`

<sub>src/lights.js:213</sub>

### `loadMap`

```js
function loadMap(game, rows, legend, tile = 32)
```

Fill the game with things from a picture made of letters.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` |  |
| `rows` | `string[]` | one string per row; all rows must be the same length. '.' and ' ' are empty. |
| `legend` | `Object<string, {kind: string} & Object>` | what each letter makes: `{ kind: 'wall', color: '#345' }`. Each thing is one tile big unless it says otherwise. |
| `tile` (optional) | `number` | the size of a tile in pixels |

**Returns** `{columns: number, rows: number, width: number, height: number}` — the size of the map (keep it: the camera needs it, see {@link follow})

<sub>src/map.js:18</sub>

### `loadProgress`

```js
function loadProgress()
```

What was saved last time, or an empty object when nothing was saved.

**Returns** `Object`

<sub>src/progress.js:12</sub>

### `loadScene`

```js
function loadScene(game, scene, kinds)
```

Fill the game with the things of a scene made in the studio's Scene panel (a file in `scenes/`): each thing is spawned where it was placed, with the size,
colour, picture and any extra fields it was given. Give it the kinds from the Kinds panel and every thing also gets the fields of its kind, the ones it was not given set
to their starting values (a pointer field starts with nothing; `refOf` finds the thing it points at).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` |  |
| `scene` | `{w?: number, h?: number, things: ({kind: string} & Object)[]}` | what the file holds (the default export of a file in `scenes/`) |
| `kinds` (optional) | `Object<string, object>` | what the Kinds panel made (the default export of `src/kinds.js`) |

**Returns** `{width: number, height: number, things: import('./things.js').Thing[]}` — the size of the scene (the camera needs it, see {@link follow}) and the things made, in order

<sub>src/map.js:76</sub>

### `loadWorld3d`

```js
function loadWorld3d(scene)
```

Turn a scene from the studio's 3D panel into a world for the 3D kit.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `scene` | `{entities?: object[]}` | what the scene file holds |

**Returns** `{blocks: ReturnType<typeof block>[], gems: ReturnType<typeof gem>[], start: {x: number, z: number, yaw: number} \| null, skipped: string[]}` — `skipped` names the entities that were not understood (a block the kit does not know)

<sub>src/scene3d.js:66</sub>

### `machineProblems`

```js
function machineProblems(machine)
```

Look a machine over and say what is wrong, in plain words: no states, an initial state that is not there, transitions to states that do not exist, a transition with
nothing to wait for (it would be taken at once), states that nothing leads to, and states with no way out.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `machine` | `StateMachineSpec` |  |

**Returns** `{state: string, kind: 'initial' \| 'target' \| 'always' \| 'unreachable' \| 'stuck' \| 'shape', message: string}[]`

<sub>src/states.js:111</sub>

### `makeAutotileSprite`

```js
function makeAutotileSprite(base, mode, { edge, width = 2, round = true } = {})
```

Make the picture for an auto-tiled terrain from one plain tile: a sprite with a frame for every shape, with an edge drawn on the sides that have no neighbour and a notch
at the corners that are missing. Draw the plain tile once; this makes the 16 or 47 versions.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `base` | `{w: number, h: number, palette: Object<string, string>, frames: string[][]}` | a sprite (its first frame is used) |
| `mode` | `'edges4' \| 'blob47'` |  |
| `o` (optional) | `{edge?: string, width?: number, round?: boolean}` | `edge` the colour of the edges (default: a darker version of the tile's main colour), `width` in pixels, `round` clears the outer corner pixel |

**Returns** `{w: number, h: number, palette: Object<string, string>, frames: string[][], animations: {}}`

<sub>src/autotile.js:129</sub>

### `makeWorld`

```js
function makeWorld(data, loaders, { player = 'hero', keep = [] } = {})
```

Make a world a game can use.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `data` | `WorldData` | what the World panel made (the default export of `src/world.js`) |
| `loaders` | `Object<string, (game: object) => ({width: number, height: number} \| void)>` | one for each room: puts the room's things in the game and, if it can, returns the room's size |
| `opts` (optional) | `{player?: string, keep?: string[]}` | `player`: the kind of thing that walks between rooms (default `hero`); `keep`: other kinds that go with it |

<sub>src/world.js:73</sub>

### `masksFor`

```js
function masksFor(rows, terrainOf, o)
```

The neighbour mask of every tile of a level made of letters.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `rows` | `string[]` |  |
| `terrainOf` | `(ch: string) => string \| null` | which terrain a letter belongs to (null: not auto-tiled; two tiles join when their terrains are the same) |
| `o` (optional) | `{outside?: 'solid' \| 'open'}` |  |

**Returns** `(number \| null)[][]` — a mask for each tile that has a terrain, null for the rest

<sub>src/autotile.js:83</sub>

### `masksFromGrid`

```js
function masksFromGrid(grid, { outside = 'solid' } = {})
```

The neighbour mask of every cell of a grid of terrains.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `grid` | `(string \| null)[][]` | the terrain of each cell, null for a cell that is not auto-tiled |
| `o` (optional) | `{outside?: 'solid' \| 'open'}` | what is beyond the edge of the map: more of the same ('solid', the default) or nothing |

**Returns** `(number \| null)[][]`

<sub>src/autotile.js:55</sub>

### `me`

```js
function me()
```

Which player this computer is, counting from 0. Use it only for drawing (a camera that follows *you*), never for the rules, or the two computers stop agreeing.

<sub>src/netplay.js:24</sub>

### `mouseDelta`

```js
function mouseDelta(keys, memory)
```

How far the mouse has moved since the last time you asked. The first time a game asks for it the page learns that this game wants the mouse: a click on the
game then takes hold of it (the pointer disappears; Esc lets go) and moving it is reported here. The movement is one more held key, so the Time Machine
records it and a replay moves the same way. Without a mouse, or while the mouse is not held, it is `{dx: 0, dy: 0}`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `keys` | `Set<string>` | the keys held down |
| `memory` | `{mx?: number, my?: number}` | an object kept in your game's state: it remembers where the mouse was (`game.mouse = {}` will do) |

**Returns** `{dx: number, dy: number, locked: boolean}` — the movement in pixels (right and down are positive); `locked` is true while the mouse is held

<sub>src/control.js:144</sub>

### `mouseLook3d`

```js
function mouseLook3d(cam, keys, { sensitivity = 0.0025, invertY = false } = {})
```

Look around with the mouse: moving it turns the camera (left and right) and tilts it (up and down). The first time this is called the page learns that the game
wants the mouse, so a click on the game takes hold of it (Esc lets go). Call it every tick with the keys, next to {@link move3d}.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `cam` | `ReturnType<typeof camera3d>` | changed in place (it also remembers where the mouse was) |
| `keys` | `Set<string>` |  |
| `o` (optional) | `{sensitivity?: number, invertY?: boolean}` | `sensitivity` is radians a pixel |

**Returns** `boolean` — true while the mouse is held (so you can show a hint when it is not)

<sub>src/view3d.js:177</sub>

### `move`

```js
function move(thing, dt)
```

Move a thing by its speed for one tick (no collisions: use {@link moveAndCollide} for things that must not pass through walls).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `thing` | `Thing` |  |
| `dt` | `number` | the tick's length in seconds, as given to `update` |

<sub>src/things.js:123</sub>

### `move3d`

```js
function move3d(cam, keys, dt, { speed = 4, turn = 2, radius = 0.35, blocks = [] } = {})
```

Walk and turn with the keys, one tick: the left and right arrows (or Q and E) turn, up and down arrow (or W and S) walk, A and D sidestep. Blocks stop you.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `cam` | `ReturnType<typeof camera3d>` | changed in place |
| `keys` | `Set<string>` | the keys held down |
| `dt` | `number` | seconds |
| `o` (optional) | `{speed?: number, turn?: number, radius?: number, blocks?: object[]}` | `speed` in units a second, `turn` in radians a second |

**Returns** `number` — how far it moved (0 when you stood still or were stopped)

<sub>src/view3d.js:150</sub>

### `moveAndCollide`

```js
function moveAndCollide(game, thing, dt, solid = 'wall')
```

Move a thing by its speed without going into solid things. It moves sideways first, then up or down, and stops against whatever is in the way. Afterwards
`thing.onGround` says whether it is standing on something.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `{things: import('./things.js').Thing[]}` |  |
| `thing` | `import('./things.js').Thing` |  |
| `dt` | `number` |  |
| `solid` (optional) | `string` | the kind of thing that blocks it |

**Returns** `{x: boolean, y: boolean}` — whether it was stopped sideways, and whether it was stopped going up or down

<sub>src/control.js:108</sub>

### `music`

```js
function music(songs)
```

Give songs names, so a game can say `playMusic('calm')`. Call it once, at the top of the game's file, with the songs you made in the Music panel.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `songs` | `Object<string, object>` |  |

<sub>src/music.js:48</sub>

### `named`

```js
function named(game, name)
```

The first thing in the game with this name (`thing.name`), or undefined.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `{things: import('./things.js').Thing[]}` |  |
| `name` | `string` |  |

**Returns** `import('./things.js').Thing \| undefined`

<sub>src/kinds.js:110</sub>

### `navGrid`

```js
function navGrid(game, solid = 'wall', tile = 32)
```

Make the grid of a game: every square that a thing of a blocking kind covers is blocked. It follows the level that `loadMap` made (its size and its tile size); without one it
covers the 480 by 320 screen in squares of `tile` pixels.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `{things: import('./things.js').Thing[], mapInfo?: {columns: number, rows: number, tile: number}}` |  |
| `solid` (optional) | `string` | the kind of thing that blocks the way |
| `tile` (optional) | `number` | the size of a square, when there is no level |

**Returns** `NavGrid`

<sub>src/paths.js:20</sub>

### `newGame`

```js
function newGame(extra = {})
```

A new game state with everything the kit uses. Add your own fields after it.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `extra` (optional) | `Object` | your own fields, for example `{ lives: 3 }` |

**Returns** `{things: Thing[], nextId: number, seed: number, score: number, camera: {x: number, y: number}, timers: Object<string, number>}`

<sub>src/things.js:24</sub>

### `newKey`

```js
function newKey(game, keys)
```

The key that was pressed since the last time this was asked (for "press the key you want"), or null. Keep calling it every tick while you wait.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `object` | where it remembers the keys of the last tick |
| `keys` | `Set<string>` | the keys held now |

<sub>src/settings.js:161</sub>

### `openSettingsMenu`

```js
function openSettingsMenu(game, { offer = SETTING_NAMES, title = 'Settings' } = {})
```

Open the menu.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `object` |  |
| `o` (optional) | `{offer?: string[], title?: string}` | `offer` which settings to show (default: all of them) |

<sub>src/settings-menu.js:22</sub>

### `overlaps`

```js
function overlaps(game, thing, kind)
```

Every thing of a kind that overlaps this one.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` |  |
| `thing` | `Thing` |  |
| `kind` | `string` |  |

**Returns** `Thing[]`

<sub>src/things.js:103</sub>

### `parseMarkup`

```js
function parseMarkup(source)
```

Read marked-up words into one entry per visible letter.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `source` | `string` | the words with tags in them |

**Returns** `Array<{c: string, color: string \| null, bold: boolean, italic: boolean}>`

<sub>src/markup.js:15</sub>

### `parseStory`

```js
function parseStory(text)
```

Read a story into instructions for each node, with everything wrong with it.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `text` | `string` |  |

**Returns** `{nodes: Object<string, {code: object[], ids: string[]}>, order: string[], problems: {line: number, node: string, kind: string, message: string}[], edges: {from: string, to: string, label: string}[], sets: string[], reads: string[]}`

<sub>src/story.js:132</sub>

### `patrol`

```js
function patrol(game, thing, dt, speed = 60, solid = 'wall')
```

Walk back and forth along the ground: an enemy that turns round at a wall and at the end of a ledge. It sets `thing.dir` (1 or -1) and `thing.flip` (so a
picture faces the way it walks). Call it every tick instead of {@link gravity} and {@link moveAndCollide}.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `{things: import('./things.js').Thing[]}` |  |
| `thing` | `import('./things.js').Thing` |  |
| `dt` | `number` |  |
| `speed` (optional) | `number` | pixels per second |
| `solid` (optional) | `string` | the kind of thing that blocks it |

<sub>src/control.js:89</sub>

### `placeOf`

```js
function placeOf(widget, size)
```

Where a widget is on a screen of this size: the corner, edge or middle it is pinned to, then pushed in by x and y.

<sub>src/ui.js:122</sub>

### `play`

```js
function play(sound, volume = 1)
```

Play a sound: a name given to {@link sounds}, or a recipe.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `sound` | `string \| object` |  |
| `volume` (optional) | `number` | 0 to 1 |

<sub>src/sound.js:62</sub>

### `playMusic`

```js
function playMusic(name, { volume = 0.6, loop = true } = {})
```

Start a song (a name given to {@link music}) and let it repeat. If that song is already playing it just keeps going, so it is safe to call every time a
level starts. Another song fades the one before it.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `o` (optional) | `{volume?: number, loop?: boolean}` | `volume` 0 to 1 (default 0.6) |

<sub>src/music.js:58</sub>

### `playSequence`

```js
function playSequence(game, seq, name = 'sequence')
```

Begin a sequence (one that is already going is replaced).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `object` |  |
| `seq` | `Sequence` |  |
| `name` (optional) | `string` | which sequence this is (for the game to tell them apart) |

<sub>src/sequences.js:129</sub>

### `playerCount`

```js
function playerCount()
```

How many players the game is being played by (1 when played alone).

<sub>src/netplay.js:26</sub>

### `project3d`

```js
function project3d(cam, x, y, z, { width = screen().width, height = screen().height } = {})
```

Where a point of the world is on the screen.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `cam` | `ReturnType<typeof camera3d>` |  |
| `x` | `number` |  |
| `y` | `number` |  |
| `z` | `number` |  |
| `size` (optional) | `{width?: number, height?: number}` | the screen's size (the project's by default) |

**Returns** `{x: number, y: number, depth: number, scale: number} \| null` — null when the point is behind you; `scale` is pixels for one unit at that distance

<sub>src/view3d.js:293</sub>

### `pseudo`

```js
function pseudo(words)
```

Test text: every letter becomes an accented one, the words grow by about a third (other languages are often longer) and sit in brackets, so a word that does not fit
its space, or a font that lacks accents, is seen at once. `{name}` places are left alone.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `words` | `string` |  |

<sub>src/text.js:94</sub>

### `ramp`

```js
function ramp(x, z, w, d, h = 1, color = '#9a8f78', y = 0, yaw = 0)
```

A ramp: like a block, but its top rises from the floor at the near end (the +z side, where you walk up from when you face -z) to its full height `h` at the far
end, turned by `yaw` like a block. You walk up it, you can run up onto what it leads to, and it does not stop you.

<sub>src/view3d.js:238</sub>

### `random`

```js
function random(game)
```

A random number from 0 up to (not including) 1. It uses a seed kept in the game state, so the same game plays out the same way every time, which is what
makes a recording or a rewind of the game possible.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` |  |

**Returns** `number`

<sub>src/things.js:150</sub>

### `randomBetween`

```js
function randomBetween(game, low, high)
```

A random number between two values.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` |  |
| `low` | `number` |  |
| `high` | `number` |  |

**Returns** `number`

<sub>src/things.js:164</sub>

### `ready`

```js
function ready(thing, tr, events = [])
```

Whether a transition can be taken now: its event arrived (if it has one), the state has lasted long enough (if `after`), and every condition holds.

<sub>src/states.js:39</sub>

### `recipeProblems`

```js
function recipeProblems(spec)
```

Look an effect over and say what is wrong, in plain words (it is always made safe by `cleanRecipe`; this tells the person what was changed).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `unknown` |  |

**Returns** `{field: string, message: string}[]`

<sub>src/particles.js:118</sub>

### `refOf`

```js
function refOf(game, thing, field)
```

The thing that one of a thing's pointer fields points at: `refOf(game, button, 'opens')` is the door the button opens, or undefined if it points at nothing or the thing is gone.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `{things: import('./things.js').Thing[]}` |  |
| `thing` | `import('./things.js').Thing` |  |
| `field` | `string` |  |

**Returns** `import('./things.js').Thing \| undefined`

<sub>src/kinds.js:121</sub>

### `resetBindings`

```js
function resetBindings(action)
```

Put one action (or all) back to the game's usual keys.

<sub>src/settings.js:151</sub>

### `resetSettings`

```js
function resetSettings()
```

Put every setting (and every key) back to what the game started with.

<sub>src/settings.js:106</sub>

### `retile`

```js
function retile(game)
```

Work out the shape of every auto-tiled tile again, after the game has added or removed some (breaking a block, growing a bridge). Call it once after the change.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` |  |

<sub>src/map.js:48</sub>

### `route`

```js
function route(grid, from, to, maxSearch = 4000)
```

Find the shortest way from one place to another across a grid, moving to the next square, up, down, left, right or across (not round the corner of a wall). The way is a list of
the middles of the squares to walk through, not counting the one it starts in. If the end is blocked or cannot be reached, the way leads to the nearest square it could get to.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `grid` | `NavGrid` |  |
| `from` | `{x: number, y: number}` | a place in pixels |
| `to` | `{x: number, y: number}` | a place in pixels |
| `maxSearch` (optional) | `number` | the most squares it will look at before giving up and using the best it has |

**Returns** `{x: number, y: number}[]`

<sub>src/paths.js:54</sub>

### `runChecks`

```js
async function runChecks({ timeoutMs = 2000 } = {})
```

Run the checks that have been added since the last run, one after another, and clear the list.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{timeoutMs?: number}` | how long one check may take |

**Returns** `Promise<{name: string, ok: boolean, ms: number, error?: {message: string, expected?: string, actual?: string}}[]>`

<sub>src/check.js:108</sub>

### `sampleClip`

```js
function sampleClip(clip, time)
```

Every number of a clip at a time, as `{ y: 96.5, alpha: 1 }`.

<sub>src/clips.js:46</sub>

### `sampleTrack`

```js
function sampleTrack(keys, time)
```

The value of one track at a time: before the first key it is the first value, after the last key the last.

<sub>src/clips.js:29</sub>

### `saveProgress`

```js
function saveProgress(data)
```

Keep this (numbers, text, true/false, lists and objects of them; at most about 20 KB) for next time.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `data` | `Object` | for example `{ level: 3, best: 120 }` |

<sub>src/progress.js:20</sub>

### `sceneFieldProblems`

```js
function sceneFieldProblems(scene, kinds)
```

Look over a scene against the kinds and say what is wrong with its things' fields: a pointer to a name nothing has, to a thing of the wrong kind, a name used twice, a number out of its range.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `scene` | `{things: Array<{kind: string, extra?: object}>}` |  |
| `kinds` | `Object<string, object>` |  |

**Returns** `{index: number, message: string}[]`

<sub>src/kinds.js:160</sub>

### `screen`

```js
function screen()
```

How big the screen is and what colour its background is.

**Returns** `{width: number, height: number, background: string}`

<sub>src/screen.js:8</sub>

### `sequenceActive`

```js
function sequenceActive(game)
```

Is a sequence going?

<sub>src/sequences.js:179</sub>

### `sequenceProblems`

```js
function sequenceProblems(seq, known = {})
```

Look a sequence over and say what is wrong, in plain words. Give it what the game has (`known`) and it also says which sounds, songs and story parts do not exist.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `seq` | `Sequence` |  |
| `known` (optional) | `{sounds?: string[], songs?: string[], nodes?: string[]}` | the names of the game's sounds, songs and story parts |

**Returns** `{where: string, message: string}[]`

<sub>src/sequences.js:220</sub>

### `setAssetHost`

```js
function setAssetHost(images)
```

Choose where pictures come from (for tests, or a host that is not the studio). The studio's game page sets `globalThis.__engineAssets` instead.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `images` | `Map<string, CanvasImageSource> \| null` | by path |

<sub>src/assets.js:12</sub>

### `setBinding`

```js
function setBinding(action, codes)
```

Choose the keys for an action (up to three) and keep them for next time.

<sub>src/settings.js:142</sub>

### `setCanvasFactory`

```js
function setCanvasFactory(factory)
```

Choose how small canvases are made (the default is an OffscreenCanvas, which the game's worker and modern browsers have). Tests and other hosts replace it.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `factory` | `(w: number, h: number) => any` |  |

<sub>src/art.js:22</sub>

### `setLanguage`

```js
function setLanguage(choice = 'auto')
```

Choose the language: 'fr', 'pt-BR' (falls back to 'pt' when only that is in the table), or 'auto'. Returns the language that was chosen.

<sub>src/text.js:38</sub>

### `setNetInfo`

```js
function setNetInfo(next)
```

Tell the kit about the game being played. Called by the runner, not by games.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `next` | `{me?: number, players?: number, online?: boolean, waiting?: boolean}` |  |

<sub>src/netplay.js:21</sub>

### `setProgressHost`

```js
function setProgressHost({ send, initial = null } = {})
```

Where saved progress goes and where it is read from (for tests, or a host that is not the studio).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` | `{send?: (message: {t: 'save', data: object}) => void, initial?: object \| null}` |  |

<sub>src/progress.js:34</sub>

### `setPseudo`

```js
function setPseudo(on = true)
```

Turn on (or off) the stretched, accented test text that shows which words are not in the table and which are too long for their space.

<sub>src/text.js:55</sub>

### `setSetting`

```js
function setSetting(name, value)
```

Change a setting (kept in range) and keep it for next time. Returns the value it now has.

<sub>src/settings.js:97</sub>

### `setSoundSink`

```js
function setSoundSink(fn)
```

Choose where played sounds go (for tests, or a host that is not the studio). The default sends them to the page the game runs in.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `fn` | `(message: {t: 'sound', spec: object, volume: number}) => void` |  |

<sub>src/sound.js:80</sub>

### `setStoryVar`

```js
function setStoryVar(game, name, value)
```

Set one of the story's numbers or flags from the game (the story can then ask about it with `<<if hasKey>>`).

<sub>src/story.js:411</sub>

### `settings`

```js
function settings(start = {})
```

Start the settings: loads what the player chose last time, and sets what the game would like as the starting values.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `start` (optional) | `Object<string, number \| boolean>` | for example `{ musicVolume: 0.6 }` |

**Returns** `Object<string, number \| boolean>` — the values now

<sub>src/settings.js:79</sub>

### `settingsMenuOpen`

```js
function settingsMenuOpen(game)
```

Is the menu open?

<sub>src/settings-menu.js:29</sub>

### `settingsMenuScreen`

```js
function settingsMenuScreen(game)
```

The menu as a UI screen (plain data), for drawing and for finding what was clicked.

<sub>src/settings-menu.js:57</sub>

### `settingsValues`

```js
function settingsValues()
```

Every setting's value.

<sub>src/settings.js:94</sub>

### `shade`

```js
function shade(color, factor)
```

A colour made darker (or lighter, with a factor above 1): `#3b4a6b` to `#24304a`. Anything that is not a hex colour comes back as it was.

<sub>src/autotile.js:88</sub>

### `shadowShapes`

```js
function shadowShapes(light, boxes, reach)
```

The shadow a set of boxes throws from a light: for each side of a box that faces the light, the four corners of the area behind that side, stretching out to `reach`.
Together the shapes cover everything the boxes hide from the light. Boxes the light is inside are skipped (a light inside a wall would put the whole room in shadow).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `light` | `{x: number, y: number}` | where the light is |
| `boxes` | `Array<{x: number, y: number, w: number, h: number}>` | the things that block light |
| `reach` | `number` | how far the shadows run (the light's radius is enough) |

**Returns** `Array<Array<[number, number]>>` — shapes, each a list of corner points

<sub>src/lights.js:66</sub>

### `shake`

```js
function shake(game, amount = 6, seconds = 0.25)
```

Shake the screen for a moment.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` |  |
| `amount` (optional) | `number` | how far, in pixels |
| `seconds` (optional) | `number` |  |

<sub>src/effects.js:34</sub>

### `shakeOffset`

```js
function shakeOffset(game)
```

Where the screen is pushed by the shake right now (zero when nothing is shaking). Used by `drawThings`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `{shake?: {amount: number, left: number, total: number, time: number} \| null}` |  |

**Returns** `{x: number, y: number}`

<sub>src/effects.js:79</sub>

### `shapesOf`

```js
function shapesOf(mode)
```

The shapes of a mode, as the neighbour masks they stand for, in frame order (frame 0 is a tile on its own).

<sub>src/autotile.js:41</sub>

### `simulate`

```js
function simulate(mod, ticks = 60, { keys, dt = 1 / 60, state } = {})
```

Play a game's own `create` and `update` for some ticks without drawing, and give back its state, so a check can say what happened.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `mod` | `{create: () => any, update: Function}` | the game's own module (its `create` and `update`), imported as a namespace |
| `ticks` (optional) | `number` |  |
| `o` (optional) | `{keys?: Set<string> \| ((tick: number, state: any) => Set<string>), dt?: number, state?: any}` |  |

<sub>src/check.js:97</sub>

### `sky3d`

```js
function sky3d(g, cam, { sky = '#2b4a7a', horizon = '#9fb6d8', ground = '#2a2f3a', width = screen().width, height = screen().height } = {})
```

Fill the screen with a sky above the horizon and ground below it (the horizon moves when the camera looks up or down).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `g` | `CanvasRenderingContext2D` |  |
| `cam` | `ReturnType<typeof camera3d>` |  |
| `o` (optional) | `{sky?: string, horizon?: string, ground?: string, width?: number, height?: number}` | colours (`#rrggbb`) |

<sub>src/view3d.js:445</sub>

### `slideAgainst`

```js
function slideAgainst(pos, dx, dz, blocks, radius = 0.35, feet = 0)
```

Move a point along the floor and slide along blocks instead of going through them. It tries the two directions one after the other, so walking
at a wall at an angle slides along it. A block no higher than a step above the feet is walked up, not stopped at; a ramp is walked up.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `pos` | `{x: number, z: number}` | where it is now |
| `dx` | `number` | how far to go along x |
| `dz` | `number` | how far to go along z |
| `blocks` | `{x: number, z: number, w: number, d: number, h?: number, y?: number, yaw?: number, solid?: boolean, ramp?: boolean}[]` |  |
| `radius` (optional) | `number` | how wide the walker is |
| `feet` (optional) | `number` | the height of the walker's feet |

**Returns** `{x: number, z: number}` — the new place

<sub>src/view3d.js:99</sub>

### `solidAt`

```js
function solidAt(game, x, y, solid = 'wall')
```

Is there a solid thing at this point?

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `{things: import('./things.js').Thing[]}` |  |
| `x` | `number` |  |
| `y` | `number` |  |
| `solid` (optional) | `string` | the kind of thing that blocks |

**Returns** `boolean`

<sub>src/control.js:76</sub>

### `sounds`

```js
function sounds(sounds)
```

Give the sounds names, so a game can say `play('coin')`. A sound is a recipe, or a sound file you imported: `{ file: 'assets/jump.wav' }`. Call it once, at the top of the game's file, with an object of recipes.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `sounds` | `Object<string, object>` | for example what you made in the sound maker |

<sub>src/sound.js:53</sub>

### `spawn`

```js
function spawn(game, kind, props = {})
```

Add a thing to the game.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` | the game state |
| `kind` | `string` | what it is, for example 'hero' |
| `props` (optional) | `Partial<Thing> & Object` | anything about it: x, y, w, h, color, emoji, and your own fields (hp, speed...) |

**Returns** `Thing` — the new thing, so you can keep working with it

<sub>src/things.js:35</sub>

### `spriteProblem`

```js
function spriteProblem(sprite)
```

Check that something is a usable sprite.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `sprite` | `unknown` |  |

**Returns** `string \| null` — what is wrong, or null when it is fine

<sub>src/art.js:41</sub>

### `stairs`

```js
function stairs(x, z, w, d, h = 1, steps = 4, color = '#9a8f78', y = 0, yaw = 0)
```

Stairs: `steps` blocks, each higher than the last, as a list to put in your blocks (`...stairs(...)`). The first step is at the near end (+z) and the last, at
height `h`, at the far end; each step is no higher than you walk up (keep `h / steps` to half a unit or less).

<sub>src/view3d.js:246</sub>

### `startStory`

```js
function startStory(game, node = 'start', vars = {})
```

Begin a story at a node.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `object` |  |
| `node` (optional) | `string` |  |
| `vars` (optional) | `Object<string, number \| string \| boolean>` | starting values (a number the game knows, such as `coins`) |

<sub>src/story.js:373</sub>

### `steer`

```js
function steer(thing, keys, speed = 160)
```

Move in four directions with the keys (for a game seen from above): sets both speeds, and keeps diagonals from being faster.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `thing` | `import('./things.js').Thing` |  |
| `keys` | `Set<string>` |  |
| `speed` (optional) | `number` | pixels per second |

<sub>src/control.js:36</sub>

### `stepCaptions`

```js
function stepCaptions(game, dt)
```

Age the captions and remove the ones that are done.

<sub>src/settings.js:196</sub>

### `stepClip`

```js
function stepClip(thing, clip, dt, name = 'clip')
```

Play a clip on a thing: call it every tick. The thing keeps its own clock (`thing.clipTime`, with the clip's name in `thing.clipName` so a different clip starts from
the beginning), and the clip's numbers are set on the thing. Returns true while the clip is still playing (a looping clip always is).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `thing` | `object` |  |
| `clip` | `Clip` |  |
| `dt` | `number` |  |
| `name` (optional) | `string` | which clip this is (default: the same one every time) |

<sub>src/clips.js:61</sub>

### `stepLayers`

```js
function stepLayers(game, dt)
```

Move the layers' clock on, so layers that scroll by themselves (clouds) keep moving. Call it every frame in `update`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `{layerClock?: number}` |  |
| `dt` | `number` | seconds since the last frame |

<sub>src/camera.js:77</sub>

### `stepSequence`

```js
function stepSequence(game, seq, dt, { skip = false } = {})
```

Move a sequence on: call it every tick. Tracks set the numbers of the things they are for, and each event happens once, when its time comes. While a line of the story that the
sequence is waiting for is on, time stands still. Returns true while the sequence is still going.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `object` |  |
| `seq` | `Sequence` |  |
| `dt` | `number` |  |
| `opts` (optional) | `{skip?: boolean}` | `skip`: jump to the end (it only works for a sequence that is skippable). Everything is put where it ends up, and only the events that change the game (`show`, `hide` and `command`) still happen |

**Returns** `boolean`

<sub>src/sequences.js:144</sub>

### `stepSettingsMenu`

```js
function stepSettingsMenu(game, keys, mouse)
```

Handle the keys (and the mouse) for one tick.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `object` |  |
| `keys` | `Set<string>` | the keys held |
| `mouse` (optional) | `{x: number, y: number, clicked?: boolean}` | where the mouse is, and whether it was just clicked |

**Returns** `'back' \| null` — 'back' when the player has left the menu

<sub>src/settings-menu.js:141</sub>

### `stepState`

```js
function stepState(thing, machine, dt, events = [])
```

Move a thing along its machine: call it every tick. A thing without a state starts in the machine's `initial` one. The first transition of the state that can be
taken wins (the state's own, in order, then the machine's `any`), and the new state may move on again in the same tick (up to 8 times, so a loop cannot hang).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `thing` | `object` |  |
| `machine` | `StateMachineSpec` |  |
| `dt` | `number` | seconds since the last tick |
| `events` (optional) | `string[]` | what happened this tick (`['hit']`) |

**Returns** `string` — the state the thing is in now

<sub>src/states.js:65</sub>

### `stepStory`

```js
function stepStory(game, keys, mouse, dt = 1 / 60)
```

Handle one tick: Enter, Space or a click finishes the line being typed, then goes on; the arrow keys and the number keys choose.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `object` |  |
| `keys` | `Set<string>` |  |
| `mouse` (optional) | `{clicked?: boolean}` |  |
| `dt` (optional) | `number` |  |

<sub>src/story.js:436</sub>

### `stopMusic`

```js
function stopMusic()
```

Fade the music out.

<sub>src/music.js:73</sub>

### `story`

```js
function story(text)
```

Read a story and keep it for `startStory`. Returns what is wrong with it (an empty list when it is fine).

<sub>src/story.js:320</sub>

### `storyActive`

```js
function storyActive(game)
```

Is a story going?

<sub>src/story.js:423</sub>

### `storyProblems`

```js
function storyProblems(parsed, start = 'start')
```

Look a parsed story over: what could not be read, nodes nothing leads to, variables that are asked about but never set (probably a typo), nodes with nothing in them, and a
node that only sends you to itself.

<sub>src/story.js:295</sub>

### `storyState`

```js
function storyState(game)
```

What the story is saying now: `{ line: {speaker, text, id} | null, choices: [{text, id, index}] | null, ended, node }`. The words are translated and filled in.

<sub>src/story.js:379</sub>

### `storyVar`

```js
function storyVar(game, name)
```

The story's own numbers and flags (`trust`, `hasKey`): read one from the game.

<sub>src/story.js:408</sub>

### `stream`

```js
function stream(game, recipe, x, y, dt, key = 'stream')
```

Keep an effect going: call it every tick and it makes `rate` particles a second (the part of a particle that does not fit in this tick is kept for the next, so the
rate is right at any frame rate). Give each flame its own `key` when there are several.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `object` |  |
| `recipe` | `Recipe` |  |
| `x` | `number` |  |
| `y` | `number` |  |
| `dt` | `number` |  |
| `key` (optional) | `string` |  |

**Returns** `number` — how many particles were made this tick

<sub>src/particles.js:102</sub>

### `stripMarkup`

```js
function stripMarkup(source)
```

The words with the tags taken out.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `source` | `string` |  |

**Returns** `string`

<sub>src/markup.js:43</sub>

### `t`

```js
function t(key, params)
```

The words for a key in the chosen language. `params` fills `{name}` places; a number in `params.n` (or `params.count`) picks the plural form.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `key` | `string` |  |
| `params` (optional) | `Object<string, string \| number>` |  |

<sub>src/text.js:79</sub>

### `takeSequenceCommands`

```js
function takeSequenceCommands(game)
```

What the sequence has asked the game to do (`command` events), once: the list is emptied. Each is `{ name, arg? }`.

<sub>src/sequences.js:182</sub>

### `takeStoryCommands`

```js
function takeStoryCommands(game)
```

What the story has asked the game to do (`<<do open-door>>`), once: the list is emptied.

<sub>src/story.js:416</sub>

### `test`

```js
function test(name, fn)
```

Add a check. It runs when the studio (or `runChecks`) runs the file.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `name` | `string` | what is being checked, in words |
| `fn` | `() => void \| Promise<void>` | throws (or `expect` does) when something is wrong |

<sub>src/check.js:85</sub>

### `text`

```js
function text(words, choice = 'auto')
```

Give the game its words. `choice` is a language code ('fr'), or `'auto'` (the default) for the language of the player's device when the table has it, else the first
language. Call it once at the top of the game's file with the table you made in the Text panel.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `words` | `Tables` |  |
| `choice` (optional) | `string` |  |

<sub>src/text.js:30</sub>

### `textOf`

```js
function textOf(widget, game)
```

The words a widget shows: `{score}` filled from the game, `@key` looked up in the language table.

<sub>src/ui.js:112</sub>

### `textProblems`

```js
function textProblems(words)
```

Look over a table and say what is wrong or missing, in plain words. For every language after the first: keys it lacks, keys it has that the first does not, `{places}`
that differ from the first language's, and words identical to the first language's (probably not translated yet); for any language, words that are empty or too long.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `words` | `Tables` |  |

**Returns** `{language: string, key: string, kind: 'missing' \| 'extra' \| 'places' \| 'empty' \| 'same' \| 'long', message: string}[]`

<sub>src/text.js:116</sub>

### `timed`

```js
function timed(name, fn)
```

Run a function and, when the studio's Profiler is recording, add how long it took to the frame's time under `name`. The function's result is returned.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `name` | `string` | for example 'enemies' or 'pathfinding' (up to 24 characters) |
| `fn` | `() => T` |  |

**Returns** `T`

<sub>src/profile.js:12</sub>

### `touches`

```js
function touches(game, thing, kind)
```

The first thing of a kind that overlaps this one, or undefined.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `Object` |  |
| `thing` | `Thing` |  |
| `kind` | `string` |  |

**Returns** `Thing \| undefined`

<sub>src/things.js:114</sub>

### `touching`

```js
function touching(a, b)
```

Do two things overlap?

**Parameters**

| Name | Type | Description |
|---|---|---|
| `a` | `Thing` |  |
| `b` | `Thing` |  |

**Returns** `boolean`

<sub>src/things.js:92</sub>

### `uiButtons`

```js
function uiButtons(spec, game)
```

The ids of the buttons that show, in the order they are listed.

<sub>src/ui.js:215</sub>

### `uiHit`

```js
function uiHit(spec, x, y, game, opts)
```

The id of the top-most button under a point, or null.

<sub>src/ui.js:209</sub>

### `uiNext`

```js
function uiNext(spec, focus, step = 1, game)
```

The button after (or before) the focused one, going round; with nothing focused it is the first (or last).

<sub>src/ui.js:218</sub>

### `uiProblems`

```js
function uiProblems(spec, size = { width: 480, height: 320 })
```

Say what is wrong with a screen, in plain words: two widgets with the same id, a button with no id, widgets off the screen, words that probably will not fit, a bar with
nothing to show.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `{widgets: Widget[]}` |  |
| `size` (optional) | `{width: number, height: number}` |  |

**Returns** `{id: string, kind: 'id' \| 'button' \| 'off' \| 'fit' \| 'bar', message: string}[]`

<sub>src/ui.js:233</sub>

### `walk`

```js
function walk(thing, keys, speed = 160)
```

Walk left and right with the keys: sets the sideways speed.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `thing` | `import('./things.js').Thing` |  |
| `keys` | `Set<string>` |  |
| `speed` (optional) | `number` | pixels per second |

<sub>src/control.js:26</sub>

### `worldProblems`

```js
function worldProblems(data, known = {})
```

Look a world over and say what is wrong, in plain words. Give it the names of the things in each room (`known.names`, by room) and it also says which doors do not exist.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `data` | `WorldData` |  |
| `known` (optional) | `{names?: Object<string, string[]>}` |  |

**Returns** `{where: string, message: string}[]`

<sub>src/world.js:184</sub>

## Classes

### `class Lockstep`

```js
class Lockstep
```

The agreement between two (or more) computers about whose keys count on which tick.

Each tick: call `local(keys)` once with the keys this player holds *now* (it gives back the message to send); call `receive(message)` for every message from the others; and
simulate a tick only if `ready()`, taking `take()` for the keys of every player. The keys held on tick `t` are used on tick `t + delay`, so the first `delay` ticks run with nobody
holding anything. Messages may arrive late, twice, or out of order; they never need to arrive in any particular order.

#### `Lockstep.constructor`

```js
constructor({ players = 2, me = 0, delay = 3, window = 240, checkEvery = 60 } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.players` (optional) | `number` | How many players (default 2). |
| `o.me` (optional) | `number` | This player's number (0 is the host). |
| `o.delay` (optional) | `number` | Ticks between pressing a key and the game using it (default 3: a twentieth of a second). |
| `o.window` (optional) | `number` | The most ticks a friend's keys may be ahead of this computer before they are refused (default 240). |
| `o.checkEvery` (optional) | `number` | Every this many ticks the computers compare a fingerprint of the game, to notice at once if they ever disagree (default 60). |

#### `Lockstep.local`

```js
local(keys)
```

Choose this player's keys for a tick `delay` ticks from now, once per tick.

| Name | Type | Description |
|---|---|---|
| `keys` | `Iterable<string>` | The keys held now. |

**Returns** `{t: 'in', f: number, k: string[]} \| null` — The message to send to the others, or null if this tick's keys were already chosen.

#### `Lockstep.receive`

```js
receive(message, from)
```

Take in a message from another computer.

| Name | Type | Description |
|---|---|---|
| `message` | `unknown` |  |
| `from` | `number` | Which player sent it. |

**Returns** `boolean` — False if it was refused.

#### `Lockstep.ready`

```js
ready()
```

Has every player's keys for the next tick arrived?

#### `Lockstep.take`

```js
take()
```

The keys of every player for the tick about to be simulated: one `Set` per player. Call only when `ready()`; then simulate the tick, and call `done`.

**Returns** `Set<string>[]`

#### `Lockstep.done`

```js
done(hash)
```

The tick has been simulated. Pass a fingerprint of the game now (only needed on the ticks `wantsSum` says; otherwise leave it out).

| Name | Type | Description |
|---|---|---|
| `hash` (optional) | `string` |  |

**Returns** `{t: 'sum', f: number, h: string} \| null` — A message to send, when this is a tick to compare on.

#### `Lockstep.wantsSum`

```js
wantsSum(frame)
```

Is the game after `frame` ticks one the computers compare?

| Name | Type | Description |
|---|---|---|
| `frame` | `number` |  |

<sub>src/netplay.js:45</sub>

## Constants

### `ANIMATION_MODES`

```js
const ANIMATION_MODES
```

How an animation plays: round and round, once and stop on the last frame, backwards round and round, or forwards then backwards.

Value: `['loop', 'once', 'reverse', 'pingpong']`

<sub>src/art.js:119</sub>

### `AUTOTILE_MODES`

```js
const AUTOTILE_MODES
```

The two kinds of auto-tiling and how many pictures each needs: 'edges4' looks at the four sides (16), 'blob47' also at the corners (47).

Value: `{ edges4: 16, blob47: 47 }`

<sub>src/autotile.js:13</sub>

### `BEHAVIORS`

```js
const BEHAVIORS
```

Every behaviour: what it is called, what it does, and its settings (name, kind, the starting value and the range a number may take).

Value: `{`

<sub>src/behaviors.js:24</sub>

### `CAMERA_DEFAULTS`

```js
const CAMERA_DEFAULTS
```

The camera settings and what they mean.

Value: `{ smooth: 0.15, lookAhead: 0, deadZone: 0 }`

<sub>src/camera.js:25</sub>

### `EVENT_KINDS`

```js
const EVENT_KINDS
```

Everything that can happen at a moment of a sequence: what it is called, what it does, and its settings (name, kind, the starting value and the range).

Value: `{`

<sub>src/sequences.js:37</sub>

### `FIELD_TYPES`

```js
const FIELD_TYPES
```

What each type of field is.

Value: `{`

<sub>src/kinds.js:13</sub>

### `KIND_LIMITS`

```js
const KIND_LIMITS
```

The limits a kinds file is held to.

Value: `{ kinds: 64, fields: 24, choices: 16, name: 32, text: 200 }`

<sub>src/kinds.js:22</sub>

### `LAYER_KINDS`

```js
const LAYER_KINDS
```

What each kind of layer draws.

Value: `{`

<sub>src/camera.js:10</sub>

### `LAYER_LIMITS`

```js
const LAYER_LIMITS
```

The limits a layers file is held to.

Value: `{ layers: 12, name: 32, size: 4000, parallax: 4 }`

<sub>src/camera.js:22</sub>

### `LIGHT_LIMITS`

```js
const LIGHT_LIMITS
```

The limits a lights file is held to.

Value: `{ lights: 24, radius: 1200, name: 32, occluders: 200 }`

<sub>src/lights.js:12</sub>

### `SCREEN_DEFAULTS`

```js
const SCREEN_DEFAULTS
```

What the darkness, the tint and the vignette are when they are not set.

Value: `{ darkness: 0, ambient: '#0a0e24', tint: '', tintAlpha: 0, vignette: 0, occluder`

<sub>src/lights.js:15</sub>

### `SEQUENCE_LIMITS`

```js
const SEQUENCE_LIMITS
```

The limits a sequence is held to.

Value: `{ duration: 300, targets: 8, fields: 8, keys: 200, events: 100, name: 32 }`

<sub>src/sequences.js:28</sub>

### `SETTING_SPEC`

```js
const SETTING_SPEC
```

The settings: what each is called, what it can be, and what it starts as.

Value: `{`

<sub>src/settings.js:13</sub>

### `SIDES`

```js
const SIDES
```

The four sides, and the one across from each.

Value: `['left', 'right', 'up', 'down']`

<sub>src/world.js:27</sub>

### `SPECIAL_TARGETS`

```js
const SPECIAL_TARGETS
```

The numbers the two special targets have: the camera's place, and the screen's fade to black and black bars (each from 0 to 1).

Value: `{ camera: ['x', 'y'], screen: ['fade', 'letterbox'] }`

<sub>src/sequences.js:31</sub>

### `WORLD_LIMITS`

```js
const WORLD_LIMITS
```

The limits a world is held to.

Value: `{ rooms: 40, links: 200, name: 32 }`

<sub>src/world.js:24</sub>

## Types

### `Arrive`

Type: `{at?: string, x?: number, y?: number, side?: 'left' \| 'right' \| 'up' \| 'down'}`

### `Behavior`

Type: `{type: string, [param: string]: any}`

### `BehaviorKind`

Type: `{label: string, help: string, params: Object<string, {label: string, kind: 'number' \| 'text' \| 'choice' \| 'flag', default: any, min?: number, max?: number, step?: number, choices?: string[]}>}`

### `Clip`

Type: `{duration: number, loop?: boolean, tracks: Object<string, Key[]>}`

### `Condition`

Type: `{field: string, op: '==' \| '!=' \| '<' \| '<=' \| '>' \| '>=', value: number \| string \| boolean}`

### `Key`

Type: `[number, number, ('linear' \| 'in' \| 'out' \| 'inout' \| 'step')?]`

### `Link`

Type: `{from: string, to: string, via: Via, arrive?: Arrive}`

### `NavGrid`

Type: `{columns: number, rows: number, tile: number, blocked: Uint8Array}`

### `Recipe`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `count` (optional) | `number` | particles in one `emit` |
| `rate` (optional) | `number` | particles a second for `stream` |
| `colors` (optional) | `string[]` | each particle picks one of these |
| `shape` (optional) | `'square' \| 'circle'` |  |
| `speed` (optional) | `[number, number]` | pixels a second, a fastest and a slowest |
| `angle` (optional) | `number` | the direction in degrees (0 is right, 90 is down, -90 is up) |
| `spread` (optional) | `number` | how wide the spray is in degrees (360 goes every way) |
| `life` (optional) | `[number, number]` | seconds a particle lasts |
| `size` (optional) | `[number, number]` | the size it starts at and the size it ends at |
| `gravity` (optional) | `number` | pixels a second, added downward each second (negative floats up) |
| `drag` (optional) | `number` | how fast it slows down, 0 (not at all) to 5 |
| `radius` (optional) | `number` | it starts anywhere within this many pixels of the point |
| `fade` (optional) | `boolean` | it fades out as it ages (default true) |

### `Sequence`

Type: `{duration: number, skippable?: boolean, tracks: Object<string, Object<string, import('./clips.js').Key[]>>, events?: SequenceEvent[]}`

### `SequenceEvent`

Type: `{at: number, kind: string, [param: string]: any}`

### `Sprite`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `w` | `number` | width in pixels |
| `h` | `number` | height in pixels |
| `palette` | `Object<string, string>` | one letter for each colour (any CSS colour); `.` and a space are see-through |
| `frames` | `string[][]` | each frame is `h` rows of `w` letters |
| `animations` (optional) | `Object<string, {frames: number[], fps: number, mode?: 'loop' \| 'once' \| 'reverse' \| 'pingpong'}>` | named runs through the frames (they go round and round unless `mode` says otherwise) |

### `StateMachineSpec`

Type: `{initial: string, states: Object<string, ThingState>, any?: StateTransition[]}`

### `StateTransition`

Type: `{to: string, event?: string, after?: number, when?: Condition \| Condition[]}`

### `Tables`

language code -> (key -> words)

Type: `Object<string, Object<string, string>>`

### `Thing`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `id` | `number` | a number nothing else has |
| `kind` | `string` | what it is: 'hero', 'coin', 'wall'... (you choose) |
| `x` | `number` | left edge, in pixels |
| `y` | `number` | top edge, in pixels |
| `w` | `number` | width |
| `h` | `number` | height |
| `vx` | `number` | speed to the right, in pixels per second (negative: left) |
| `vy` | `number` | speed downwards, in pixels per second (negative: up) |
| `color` (optional) | `string` | a CSS colour to fill it with |
| `emoji` (optional) | `string` | a picture made of text, drawn instead of a colour, for example '🪙' |
| `onGround` (optional) | `boolean` | set by {@link moveAndCollide}: standing on something |

### `ThingState`

Type: `{animation?: string, transitions?: StateTransition[]}`

### `Via`

Type: `{kind: 'edge', side: 'left' \| 'right' \| 'up' \| 'down'} \| {kind: 'thing', name: string}`

### `Widget`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `id` | `string` | a name; a button's id is what `uiHit` tells you |
| `type` | `'label' \| 'panel' \| 'button' \| 'bar' \| 'image'` |  |
| `anchor` (optional) | `string` | where it is pinned: 'top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right' |
| `x` (optional) | `number` | pixels in from that edge (or right of the middle, when centred) |
| `y` (optional) | `number` |  |
| `w` (optional) | `number` |  |
| `h` (optional) | `number` |  |
| `text` (optional) | `string` | words; `{score}` shows a number of the game, `@key` a word from the language table |
| `showIf` (optional) | `string` | a number or flag of the game that must be set (`lives`), or `!lives` for when it is not |
| `value` (optional) | `string` | for a bar: the number of the game it shows (`player.hp`) |
| `max` (optional) | `string \| number` | for a bar: what full is, a number or a number of the game |
| `sprite` (optional) | `string` | for a picture: the sprite's name |

### `WorldData`

Type: `{start: string, rooms: Object<string, {file?: string, x?: number, y?: number, start?: {x: number, y: number}}>, links: Link[]}`
