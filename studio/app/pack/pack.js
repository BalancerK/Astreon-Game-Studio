// The free pack: sprites, sounds and songs that come with the studio, so a first game does not have to start from nothing and nothing has to be downloaded. Every
// one of them was made for this project and is released under CC0 1.0 (public domain): use them in any game, free or sold, with no credit and no fee.
// This is the list, how to search it, and how an item is put into a project (a sprite becomes a file in `src/art/`; a sound or a song is added to `src/sounds.js` or
// `src/music.js`, under a name that is not taken yet). No page is needed for any of it, so it is tested in Node.
import { SPRITES } from './sprites.js';
import { SOUNDS } from './sounds.js';
import { SONGS } from './songs.js';
import * as sprite from '../paint/sprite-model.js';
import * as sound from '../paint/sound-model.js';
import * as music from '../paint/music-model.js';

export const PACK_LICENSE = 'CC0 1.0 (public domain): made for this project, free to use in any game, free or sold, with no credit needed.';
export const KINDS = { sprite: 'Pictures', sound: 'Sounds', song: 'Music' };
const NOTE = `From the studio's free pack. ${PACK_LICENSE}`;

/** @typedef {{id: string, kind: 'sprite' | 'sound' | 'song', name: string, title: string, category: string, tags: string[]}} PackItem */

/** Every item of the pack, in a fixed order (pictures, then sounds, then music). @returns {PackItem[]} */
export function packItems() {
  const info = (kind, e) => ({ id: `${kind}:${e.name}`, kind, name: e.name, title: e.title, category: e.category, tags: e.tags });
  return [...SPRITES.map((e) => info('sprite', e)), ...SOUNDS.map((e) => info('sound', e)), ...SONGS.map((e) => info('song', e))];
}

/** The categories of one kind of item, in the order they first appear. */
export function categoriesOf(kind) {
  return [...new Set(packItems().filter((i) => i.kind === kind).map((i) => i.category))];
}

/**
 * Items that match a search: every word has to be in the title, the name, the category or a tag (or begin one of them), so "blue gem" finds the gem and "monster" finds
 * the enemies.
 * @param {string} query
 * @param {{kind?: 'sprite' | 'sound' | 'song', category?: string}} [o]
 */
export function searchPack(query = '', { kind = null, category = null } = {}) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return packItems().filter((item) => {
    if (kind && item.kind !== kind) return false;
    if (category && item.category !== category) return false;
    const hay = [item.title, item.name, item.category, ...item.tags].join(' ').toLowerCase().split(/[\s-]+/);
    return words.every((w) => hay.some((h) => h.startsWith(w) || h.includes(w)));
  });
}

/** The thing itself, ready to use: a sprite (the sprite maker's form), a sound recipe, or a song (the music maker's form). */
export function dataOf(id) {
  const [kind, name] = id.split(':');
  if (kind === 'sprite') { const e = SPRITES.find((x) => x.name === name); return e ? e.make() : null; }
  if (kind === 'sound') { const e = SOUNDS.find((x) => x.name === name); return e ? JSON.parse(JSON.stringify(e.recipe)) : null; }
  if (kind === 'song') { const e = SONGS.find((x) => x.name === name); return e ? e.make() : null; }
  return null;
}

const safe = (name) => String(name).replace(/[^\w-]/g, '').replace(/^[^a-z]+/i, '') || 'item';

/**
 * Put an item into a project.
 * @param {{has(path: string): boolean, readText(path: string): string}} project what the project holds (`list`-free: only `has` and `readText` are used)
 * @param {string} id an item id (`sprite:hero`)
 * @returns {{path: string, text: string, name: string, how: string}} the file to write, the name the item has in the project, and a line saying how to use it
 */
export function installItem(project, id) {
  const data = dataOf(id);
  if (!data) throw new Error(`There is nothing called "${id}" in the free pack.`);
  const [kind, wanted] = id.split(':');
  if (kind === 'sprite') {
    let name = safe(wanted);
    for (let n = 2; project.has(`src/art/${name}.js`) && n < 1000; n++) name = `${safe(wanted)}${n}`;
    const problem = sprite.problemWith(data);
    if (problem) throw new Error(`The pack's sprite "${wanted}" is not valid: ${problem}`);
    const how = `import ${name} from './art/${name}.js'  (then drawSprite or thing.sprite)`;
    return { path: `src/art/${name}.js`, text: sprite.serializeSprite(data, NOTE), name, how };
  }
  if (kind === 'sound') {
    const sounds = project.has('src/sounds.js') ? sound.parseSounds(project.readText('src/sounds.js')) : {};
    const name = sound.freeName(sounds, wanted);
    sounds[name] = data;
    return { path: 'src/sounds.js', text: sound.serializeSounds(sounds), name, how: `play('${name}')` };
  }
  const have = project.has('src/music.js') ? music.parseSongs(project.readText('src/music.js')).songs : {};
  const name = music.freeName(have, wanted);
  have[name] = data;
  return { path: 'src/music.js', text: music.serializeSongs(have), name, how: `playMusic('${name}')` };
}

