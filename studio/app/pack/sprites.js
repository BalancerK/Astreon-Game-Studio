// The free pack's sprites: characters, things to collect, objects, hazards and tiles, 16 by 16 each (a few with frames for walking, flapping, spinning...). Made for
// this project with the drawing surface in art.js and given away under CC0.
import { Art, frames, seeded } from './art.js';

const OUT = '#1b1f2e';
const WHITE = '#f5f0e6';
const RED = '#e84a5f';
const DRED = '#a82d44';
const ORG = '#ff9f43';
const YEL = '#ffd23c';
const DYEL = '#d99a1e';
const GRN = '#4ade80';
const DGRN = '#25a35a';
const BLU = '#5ac8ff';
const DBLU = '#3a7bd5';
const PUR = '#8b8bff';
const DPUR = '#5b4fc4';
const SKIN = '#f5c9a0';
const BRN = '#8a5a3a';
const DBRN = '#5c3a24';
const GRY = '#9aa3b5';
const DGRY = '#5b6378';
const PINK = '#ff8fb1';

const still = (art) => art.outline(OUT).sprite();
const withAnimations = (sprite, animations) => ({ ...sprite, animations });

// ---- characters and enemies ----
function hero() {
  const s = frames(16, 16, 2, (a, i) => {
    a.rect(5, 1, 6, 3, BRN).rect(4, 3, 1, 2, BRN).rect(11, 3, 1, 2, BRN);
    a.rect(5, 4, 6, 3, SKIN).px(6, 5, OUT).px(9, 5, OUT);
    a.rect(4, 7, 8, 4, BLU).rect(4, 10, 8, 1, DBLU).rect(3, 7, 1, 3, SKIN).rect(12, 7, 1, 3, SKIN);
    a.rect(5, 11, 3, i ? 2 : 3, DPUR).rect(8, 11, 3, i ? 3 : 2, DPUR);
    a.rect(5, i ? 13 : 14, 3, 1, DBRN).rect(8, i ? 14 : 13, 3, 1, DBRN);
    a.outline(OUT);
  });
  return withAnimations(s, { idle: { frames: [0], fps: 1 }, walk: { frames: [0, 1], fps: 6 } });
}

function slime() {
  const s = frames(16, 16, 2, (a, i) => {
    const h = i ? 5 : 4;
    a.disc(8, 12 - h, 6, GRN, h).rect(2, 11, 13, 2, GRN);
    a.disc(6, 8 - (i ? 1 : 0), 2, '#9af0b8', 1).px(5, 7, WHITE);
    a.rect(5, 9, 2, 2, WHITE).rect(9, 9, 2, 2, WHITE).px(6, 10, OUT).px(10, 10, OUT);
    a.outline(OUT);
  });
  return withAnimations(s, { bounce: { frames: [0, 1], fps: 4 } });
}

function bat() {
  const s = frames(16, 16, 2, (a, i) => {
    a.disc(8, 8, 3, DPUR, 3).tri([5, 6], [6, 3], [7, 6], DPUR).tri([9, 6], [10, 3], [11, 6], DPUR);
    a.px(7, 8, YEL).px(9, 8, YEL).px(8, 10, WHITE);
    if (i) a.tri([5, 8], [0, 11], [5, 11], PUR).tri([11, 8], [15, 11], [11, 11], PUR);
    else a.tri([5, 7], [0, 3], [5, 10], PUR).tri([11, 7], [15, 3], [11, 10], PUR);
    a.outline(OUT);
  });
  return withAnimations(s, { flap: { frames: [0, 1], fps: 8 } });
}

function ghost() {
  const a = new Art(16, 16);
  a.disc(8, 7, 5, WHITE).rect(3, 7, 11, 6, WHITE);
  for (const x of [3, 6, 9, 12]) a.rect(x, 13, 2, 1, WHITE);
  a.rect(4, 6, 2, 3, OUT).rect(10, 6, 2, 3, OUT).rect(7, 10, 3, 2, OUT);
  a.rect(5, 6, 1, 1, WHITE);
  return still(a);
}

function skull() {
  const a = new Art(16, 16);
  a.disc(8, 7, 5, WHITE).rect(5, 9, 7, 4, WHITE);
  a.rect(4, 6, 3, 3, OUT).rect(10, 6, 3, 3, OUT).px(8, 9, OUT).px(7, 10, OUT).px(9, 10, OUT);
  for (const x of [6, 8, 10]) a.px(x, 12, OUT);
  return still(a);
}

function robot() {
  const a = new Art(16, 16);
  a.rect(7, 1, 2, 3, GRY).disc(8, 1, 1, RED);
  a.rect(3, 4, 10, 6, GRY).rect(3, 4, 10, 1, WHITE);
  a.rect(5, 6, 2, 2, BLU).rect(9, 6, 2, 2, BLU).rect(6, 9, 4, 1, DGRY);
  a.rect(4, 10, 8, 3, DGRY).rect(2, 10, 2, 3, GRY).rect(12, 10, 2, 3, GRY).rect(4, 13, 3, 2, GRY).rect(9, 13, 3, 2, GRY);
  return still(a);
}

function bee() {
  const s = frames(16, 16, 2, (a, i) => {
    a.disc(8, 9, 4, YEL, 3).rect(6, 7, 1, 5, OUT).rect(9, 7, 1, 5, OUT);
    a.disc(5, i ? 4 : 5, 2, '#d8f2ff', 2).disc(11, i ? 4 : 5, 2, '#d8f2ff', 2);
    a.px(11, 8, OUT).px(12, 9, ORG).px(3, 9, OUT);
    a.outline(OUT);
  });
  return withAnimations(s, { buzz: { frames: [0, 1], fps: 12 } });
}

// ---- things to collect ----
function coin() {
  const s = frames(16, 16, 4, (a, i) => {
    const rx = [5, 4, 2, 4][i];
    a.disc(8, 8, rx, YEL, 6);
    if (rx > 2) a.disc(8, 8, rx - 2, DYEL, 4).disc(8, 8, rx - 3, YEL, 3);
    if (rx > 3) a.px(6, 5, WHITE).px(6, 6, WHITE);
    a.outline(OUT);
  });
  return withAnimations(s, { spin: { frames: [0, 1, 2, 3], fps: 8 } });
}

function gem() {
  const a = new Art(16, 16);
  a.tri([8, 2], [2, 7], [14, 7], BLU).tri([2, 7], [14, 7], [8, 14], DBLU);
  a.tri([8, 2], [5, 7], [8, 7], '#b8ebff').tri([8, 7], [11, 7], [8, 14], BLU).px(6, 5, WHITE);
  return still(a);
}

function heart() {
  const a = new Art(16, 16);
  a.disc(5, 6, 3, RED).disc(10, 6, 3, RED).tri([2, 7], [13, 7], [7.5, 14], RED).px(4, 5, '#ffb3c0').px(4, 4, '#ffb3c0').px(9, 5, DRED);
  return still(a);
}

function star() {
  const a = new Art(16, 16);
  a.tri([8, 1], [3, 12], [13, 12], YEL).tri([2, 5], [14, 5], [8, 15], YEL);
  a.px(8, 6, WHITE).px(7, 7, WHITE).px(8, 8, '#ffe98a');
  return still(a);
}

function key() {
  const a = new Art(16, 16);
  a.disc(5, 5, 3, YEL).disc(5, 5, 1, null);
  a.line(7, 7, 13, 13, YEL).line(8, 7, 14, 13, YEL).line(11, 11, 14, 8, YEL).line(13, 13, 15, 11, YEL);
  return still(a);
}

function potion() {
  const a = new Art(16, 16);
  a.rect(6, 2, 4, 2, BRN).rect(6, 4, 4, 2, '#d8f2ff').disc(8, 10, 5, '#d8f2ff', 4).disc(8, 11, 4, RED, 3).rect(5, 11, 6, 1, RED).px(6, 9, '#ffb3c0');
  return still(a);
}

function sword() {
  const a = new Art(16, 16);
  a.line(12, 3, 4, 11, GRY).line(13, 3, 5, 11, GRY).line(13, 2, 13, 4, WHITE).line(3, 9, 7, 13, YEL).line(3, 13, 4, 12, BRN).px(2, 14, DBRN);
  a.line(12, 2, 4, 10, WHITE);
  return still(a);
}

function shield() {
  const a = new Art(16, 16);
  a.rect(3, 2, 10, 7, BLU).tri([3, 9], [13, 9], [8, 14], BLU).rect(3, 2, 10, 1, WHITE).rect(7, 3, 2, 9, WHITE).rect(5, 6, 6, 2, WHITE);
  a.px(4, 4, '#b8ebff');
  return still(a);
}

// ---- objects and scenery ----
function crate() {
  const a = new Art(16, 16);
  a.rect(2, 2, 12, 12, BRN).rect(2, 2, 12, 2, DBRN).rect(2, 12, 12, 2, DBRN).rect(2, 2, 2, 12, DBRN).rect(12, 2, 2, 12, DBRN);
  a.line(4, 4, 11, 11, DBRN).line(11, 4, 4, 11, DBRN);
  return still(a);
}

function chest() {
  const s = frames(16, 16, 2, (a, i) => {
    if (i) {
      a.rect(2, 3, 12, 4, DBRN).rect(3, 4, 10, 2, '#2b160a').rect(2, 8, 12, 6, BRN).rect(2, 8, 12, 1, DBRN).rect(2, 12, 12, 2, DBRN);
      a.rect(4, 6, 8, 2, YEL).rect(5, 5, 6, 1, YEL);
    } else {
      a.rect(2, 5, 12, 4, BRN).rect(2, 5, 12, 1, DBRN).rect(2, 9, 12, 5, BRN).rect(2, 12, 12, 2, DBRN);
      a.rect(2, 8, 12, 1, YEL).rect(7, 7, 2, 4, YEL).px(7, 9, OUT);
    }
    a.rect(2, i ? 3 : 5, 1, i ? 11 : 9, DBRN).rect(13, i ? 3 : 5, 1, i ? 11 : 9, DBRN);
    a.outline(OUT);
  });
  return withAnimations(s, { open: { frames: [0, 1], fps: 3 } });
}

function door() {
  const a = new Art(16, 16);
  a.rect(3, 3, 10, 12, BRN).disc(8, 4, 5, BRN, 3).rect(4, 5, 8, 10, '#6e4528').disc(8, 5, 4, '#6e4528', 2);
  a.rect(8, 4, 1, 11, DBRN).disc(11, 10, 1, YEL).rect(3, 14, 10, 1, DBRN);
  return still(a);
}

function flag() {
  const a = new Art(16, 16);
  a.rect(3, 1, 2, 14, DGRY).disc(4, 1, 1, YEL).tri([5, 2], [14, 5], [5, 8], RED).tri([5, 2], [14, 5], [5, 4], '#ff8a9b');
  return still(a);
}

function sign() {
  const a = new Art(16, 16);
  a.rect(7, 9, 2, 6, DBRN).rect(2, 2, 12, 8, BRN).rect(3, 3, 10, 6, '#c8935f').rect(4, 5, 8, 1, DBRN).rect(4, 7, 6, 1, DBRN);
  return still(a);
}

function tree() {
  const a = new Art(16, 16);
  a.rect(7, 9, 2, 6, BRN).disc(8, 5, 5, GRN, 4).disc(5, 7, 3, DGRN, 3).disc(11, 7, 3, DGRN, 3).disc(8, 4, 3, '#7af0a4', 2);
  return still(a);
}

function bush() {
  const a = new Art(16, 16);
  a.disc(5, 10, 4, GRN, 3).disc(11, 10, 4, GRN, 3).disc(8, 8, 4, DGRN, 4).rect(2, 11, 12, 3, GRN).px(6, 8, '#7af0a4').px(10, 10, '#7af0a4');
  a.px(5, 11, RED).px(11, 12, RED).px(8, 9, RED);
  return still(a);
}

function rock() {
  const a = new Art(16, 16);
  a.disc(8, 10, 6, GRY, 4).rect(2, 11, 13, 3, GRY).disc(6, 8, 2, '#c8cfdc', 1).rect(10, 11, 4, 3, DGRY);
  return still(a);
}

function cloud() {
  const a = new Art(16, 16);
  a.disc(5, 9, 3, WHITE).disc(9, 7, 4, WHITE).disc(12, 10, 3, WHITE).rect(3, 10, 11, 3, WHITE);
  return a.outline('#a8b4cc').sprite();
}

function sun() {
  const a = new Art(16, 16);
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2;
    a.line(8 + Math.cos(t) * 5, 8 + Math.sin(t) * 5, 8 + Math.cos(t) * 7.4, 8 + Math.sin(t) * 7.4, ORG);
  }
  a.disc(8, 8, 4, YEL).px(6, 6, WHITE).px(7, 6, '#fff0a0');
  return a.sprite();
}

function mushroom() {
  const a = new Art(16, 16);
  a.rect(6, 8, 4, 6, '#f0e2c8').disc(8, 7, 6, RED, 4).rect(2, 7, 13, 2, RED).disc(5, 6, 1, WHITE).disc(10, 5, 1, WHITE).px(8, 8, WHITE);
  return still(a);
}

function flower() {
  const a = new Art(16, 16);
  a.line(8, 8, 8, 15, DGRN).line(8, 12, 11, 10, DGRN).disc(11, 10, 1, GRN);
  for (const [x, y] of [[8, 3], [12, 6], [4, 6], [6, 9], [10, 9]]) a.disc(x, y, 2, PINK);
  a.disc(8, 6, 2, YEL);
  return still(a);
}

// ---- hazards ----
function spikes() {
  const a = new Art(16, 16);
  a.rect(1, 13, 14, 2, DGRY);
  for (const x of [1, 6, 11]) a.tri([x, 13], [x + 4, 13], [x + 2, 4], GRY);
  for (const x of [1, 6, 11]) a.line(x + 2, 5, x + 2, 12, WHITE);
  return still(a);
}

function saw() {
  const s = frames(16, 16, 2, (a, i) => {
    for (let k = 0; k < 8; k++) {
      const t = ((k + i * 0.5) / 8) * Math.PI * 2;
      const tooth = (angle, r) => [8 + Math.cos(angle) * r, 8 + Math.sin(angle) * r];
      a.tri(tooth(t - 0.2, 5), tooth(t + 0.2, 5), tooth(t, 7.5), GRY);
    }
    a.disc(8, 8, 5.5, GRY).disc(8, 8, 2, DGRY).px(8, 8, WHITE);
    a.outline(OUT);
  });
  return withAnimations(s, { spin: { frames: [0, 1], fps: 12 } });
}

function fire() {
  const s = frames(16, 16, 2, (a, i) => {
    a.disc(8, 11, 4, RED, 4).tri([4, 10], [12, 10], [8 + (i ? 1 : -1), 1], RED);
    a.disc(8, 12, 3, ORG, 3).tri([5, 11], [11, 11], [8 + (i ? 0 : 1), 4], ORG);
    a.disc(8, 13, 2, YEL, 2).tri([6, 12], [10, 12], [8, 8], YEL);
    a.outline(OUT);
  });
  return withAnimations(s, { burn: { frames: [0, 1], fps: 6 } });
}

// ---- tiles (they fill the whole picture, so they sit side by side) ----
function tile(make) {
  const a = new Art(16, 16);
  make(a, seeded(7));
  return a.sprite();
}

const grass = () => tile((a, r) => {
  a.rect(0, 0, 16, 16, BRN).rect(0, 0, 16, 5, GRN).rect(0, 5, 16, 1, DGRN);
  for (let x = 0; x < 16; x += 2) a.px(x, 5, DGRN).px(x + 1, 6, r() > 0.5 ? DGRN : GRN);
  for (let i = 0; i < 8; i++) a.px(Math.floor(r() * 16), 7 + Math.floor(r() * 9), DBRN);
});

const dirt = () => tile((a, r) => {
  a.rect(0, 0, 16, 16, BRN);
  for (let i = 0; i < 14; i++) a.px(Math.floor(r() * 16), Math.floor(r() * 16), r() > 0.5 ? DBRN : '#a8714a');
});

const stone = () => tile((a) => {
  a.rect(0, 0, 16, 16, GRY).rect(0, 0, 16, 1, DGRY).rect(0, 5, 16, 1, DGRY).rect(0, 10, 16, 1, DGRY).rect(0, 15, 16, 1, DGRY);
  for (const [x, y] of [[4, 0], [11, 0], [8, 5], [2, 5], [13, 5], [5, 10], [12, 10]]) a.rect(x, y, 1, 5, DGRY);
  a.rect(0, 1, 16, 1, '#b9c1d1');
});

const sand = () => tile((a, r) => {
  a.rect(0, 0, 16, 16, '#f0d9a0');
  for (let i = 0; i < 16; i++) a.px(Math.floor(r() * 16), Math.floor(r() * 16), r() > 0.5 ? '#d9bd7a' : '#fff0c8');
});

function water() {
  const s = frames(16, 16, 2, (a, i) => {
    a.rect(0, 0, 16, 16, '#3a8fd5').rect(0, 0, 16, 3, BLU);
    for (let x = 0; x < 16; x += 4) a.rect((x + i * 2) % 16, 5, 2, 1, WHITE).rect((x + 2 + i * 2) % 16, 10, 2, 1, '#7bc4f0');
  });
  return withAnimations(s, { flow: { frames: [0, 1], fps: 2 } });
}

function lava() {
  const s = frames(16, 16, 2, (a, i) => {
    a.rect(0, 0, 16, 16, RED).rect(0, 0, 16, 3, ORG);
    for (let x = 0; x < 16; x += 5) a.disc((x + i * 2) % 16, 8 + (x % 3), 1.5, ORG).px((x + 3 + i) % 16, 13, YEL);
  });
  return withAnimations(s, { bubble: { frames: [0, 1], fps: 2 } });
}

const ice = () => tile((a) => {
  a.rect(0, 0, 16, 16, '#b8ebff').rect(0, 0, 16, 2, WHITE).rect(0, 14, 16, 2, '#7bc4f0');
  a.line(3, 12, 7, 6, WHITE).line(10, 13, 13, 7, WHITE);
});

const planks = () => tile((a) => {
  a.rect(0, 0, 16, 16, '#c8935f');
  for (const y of [0, 5, 10, 15]) a.rect(0, y, 16, 1, DBRN);
  for (const [x, y] of [[3, 1], [11, 6], [6, 11]]) a.rect(x, y, 1, 4, '#a8714a');
  for (const [x, y] of [[1, 2], [14, 7], [2, 12]]) a.px(x, y, DBRN);
});

const platform = () => {
  const a = new Art(16, 16);
  a.rect(0, 5, 16, 5, BRN).rect(0, 5, 16, 1, '#a8714a').rect(0, 9, 16, 1, DBRN);
  for (const x of [3, 8, 13]) a.px(x, 7, DBRN);
  return a.outline(OUT).sprite();
};

const ladder = () => {
  const a = new Art(16, 16);
  a.rect(4, 0, 2, 16, BRN).rect(10, 0, 2, 16, BRN);
  for (const y of [2, 6, 10, 14]) a.rect(5, y, 6, 2, '#c8935f');
  return a.sprite();
};

/**
 * Every sprite in the pack: its name (a file name), a title, what it is (`category`), words to find it by, and `make()` which draws it.
 * @type {{name: string, title: string, category: string, tags: string[], make: () => any}[]}
 */
export const SPRITES = [
  { name: 'hero', title: 'Hero (walks)', category: 'Characters', tags: ['player', 'person', 'adventurer', 'walk'], make: hero },
  { name: 'slime', title: 'Slime (bounces)', category: 'Enemies', tags: ['monster', 'blob', 'green'], make: slime },
  { name: 'bat', title: 'Bat (flaps)', category: 'Enemies', tags: ['monster', 'fly', 'cave'], make: bat },
  { name: 'ghost', title: 'Ghost', category: 'Enemies', tags: ['monster', 'spooky', 'haunted'], make: ghost },
  { name: 'skull', title: 'Skull', category: 'Enemies', tags: ['monster', 'spooky', 'skeleton', 'danger'], make: skull },
  { name: 'robot', title: 'Robot', category: 'Enemies', tags: ['machine', 'metal', 'space'], make: robot },
  { name: 'bee', title: 'Bee (buzzes)', category: 'Enemies', tags: ['insect', 'fly', 'yellow'], make: bee },
  { name: 'coin', title: 'Coin (spins)', category: 'Collect', tags: ['money', 'gold', 'pickup', 'spin'], make: coin },
  { name: 'gem', title: 'Gem', category: 'Collect', tags: ['diamond', 'jewel', 'pickup', 'blue'], make: gem },
  { name: 'heart', title: 'Heart', category: 'Collect', tags: ['life', 'health', 'love', 'pickup'], make: heart },
  { name: 'star', title: 'Star', category: 'Collect', tags: ['bonus', 'pickup', 'yellow'], make: star },
  { name: 'key', title: 'Key', category: 'Collect', tags: ['door', 'unlock', 'gold', 'pickup'], make: key },
  { name: 'potion', title: 'Potion', category: 'Collect', tags: ['health', 'magic', 'bottle', 'pickup'], make: potion },
  { name: 'sword', title: 'Sword', category: 'Collect', tags: ['weapon', 'fight', 'pickup'], make: sword },
  { name: 'shield', title: 'Shield', category: 'Collect', tags: ['defence', 'armour', 'pickup'], make: shield },
  { name: 'crate', title: 'Crate', category: 'Objects', tags: ['box', 'wood', 'push', 'puzzle'], make: crate },
  { name: 'chest', title: 'Treasure chest (opens)', category: 'Objects', tags: ['treasure', 'loot', 'box'], make: chest },
  { name: 'door', title: 'Door', category: 'Objects', tags: ['exit', 'entrance', 'wood'], make: door },
  { name: 'flag', title: 'Flag', category: 'Objects', tags: ['goal', 'finish', 'checkpoint'], make: flag },
  { name: 'sign', title: 'Sign', category: 'Objects', tags: ['hint', 'message', 'wood'], make: sign },
  { name: 'tree', title: 'Tree', category: 'Scenery', tags: ['nature', 'forest', 'green'], make: tree },
  { name: 'bush', title: 'Berry bush', category: 'Scenery', tags: ['nature', 'plant', 'green'], make: bush },
  { name: 'rock', title: 'Rock', category: 'Scenery', tags: ['stone', 'nature', 'grey'], make: rock },
  { name: 'cloud', title: 'Cloud', category: 'Scenery', tags: ['sky', 'weather', 'white'], make: cloud },
  { name: 'sun', title: 'Sun', category: 'Scenery', tags: ['sky', 'weather', 'yellow'], make: sun },
  { name: 'mushroom', title: 'Mushroom', category: 'Scenery', tags: ['nature', 'plant', 'red'], make: mushroom },
  { name: 'flower', title: 'Flower', category: 'Scenery', tags: ['nature', 'plant', 'pink'], make: flower },
  { name: 'spikes', title: 'Spikes', category: 'Hazards', tags: ['danger', 'trap', 'metal'], make: spikes },
  { name: 'saw', title: 'Saw blade (spins)', category: 'Hazards', tags: ['danger', 'trap', 'metal', 'spin'], make: saw },
  { name: 'fire', title: 'Fire (burns)', category: 'Hazards', tags: ['danger', 'flame', 'hot'], make: fire },
  { name: 'tile-grass', title: 'Grass tile', category: 'Tiles', tags: ['ground', 'floor', 'terrain', 'level'], make: grass },
  { name: 'tile-dirt', title: 'Dirt tile', category: 'Tiles', tags: ['ground', 'terrain', 'brown', 'level'], make: dirt },
  { name: 'tile-stone', title: 'Stone brick tile', category: 'Tiles', tags: ['wall', 'castle', 'grey', 'level'], make: stone },
  { name: 'tile-sand', title: 'Sand tile', category: 'Tiles', tags: ['ground', 'desert', 'beach', 'level'], make: sand },
  { name: 'tile-water', title: 'Water tile (flows)', category: 'Tiles', tags: ['liquid', 'sea', 'blue', 'level'], make: water },
  { name: 'tile-lava', title: 'Lava tile (bubbles)', category: 'Tiles', tags: ['liquid', 'danger', 'hot', 'level'], make: lava },
  { name: 'tile-ice', title: 'Ice tile', category: 'Tiles', tags: ['slippery', 'winter', 'blue', 'level'], make: ice },
  { name: 'tile-planks', title: 'Wooden planks tile', category: 'Tiles', tags: ['floor', 'wall', 'wood', 'level'], make: planks },
  { name: 'tile-platform', title: 'Wooden platform', category: 'Tiles', tags: ['ledge', 'floating', 'wood', 'level'], make: platform },
  { name: 'tile-ladder', title: 'Ladder', category: 'Tiles', tags: ['climb', 'wood', 'level'], make: ladder },
];
