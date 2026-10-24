import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packItems, searchPack, categoriesOf, dataOf, installItem, PACK_LICENSE, KINDS } from '../app/pack/pack.js';
import { spriteProblem } from '../../packages/arcade/src/art.js';
import { cleanSound } from '../../packages/arcade/src/sound.js';
import { cleanSong } from '../../packages/arcade/src/music.js';
import { synthesize, sequence } from '../../packages/audio/src/synth.js';
import * as sprite from '../app/paint/sprite-model.js';
import * as sound from '../app/paint/sound-model.js';
import * as music from '../app/paint/music-model.js';

const items = packItems();
const of = (kind) => items.filter((i) => i.kind === kind);
const project = (files = {}) => ({ has: (p) => p in files, readText: (p) => files[p] });

test('the pack is a good size, every item has a title, a category, words to find it by and a unique id, and the licence is plain', () => {
  assert.ok(of('sprite').length >= 35 && of('sound').length >= 20 && of('song').length >= 8, `${of('sprite').length} pictures, ${of('sound').length} sounds, ${of('song').length} songs`);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, 'ids are unique');
  for (const i of items) {
    assert.ok(i.title && i.category && i.tags.length >= 2 && /^[a-z][\w-]*$/i.test(i.name), i.id);
    assert.ok(KINDS[i.kind]);
  }
  assert.match(PACK_LICENSE, /CC0/);
  assert.ok(categoriesOf('sprite').includes('Tiles') && categoriesOf('sound').includes('Menu'));
});

test('every picture is valid for the sprite maker and the kit, uses few colours and has a see-through background', () => {
  for (const i of of('sprite')) {
    const s = dataOf(i.id);
    assert.equal(sprite.problemWith(s), null, i.id);
    assert.equal(spriteProblem(s), null, `${i.id}: the kit accepts it`);
    assert.ok(Object.keys(s.palette).length <= 14, `${i.id} has ${Object.keys(s.palette).length} colours`);
    assert.ok(s.frames.every((f) => f.some((r) => /[^.]/.test(r))), `${i.id} is not empty`);
    assert.doesNotThrow(() => sprite.parseSprite(sprite.serializeSprite(s)), `${i.id} survives being saved and read`);
  }
  assert.ok(dataOf('sprite:coin').frames.length === 4 && dataOf('sprite:coin').animations.spin.fps > 0, 'the coin spins');
  assert.ok(JSON.stringify(dataOf('sprite:hero')) === JSON.stringify(dataOf('sprite:hero')), 'drawn the same every time');
});

test('every sound is a usable recipe for the sound maker and the kit, and really makes a sound of a sensible size', () => {
  for (const i of of('sound')) {
    const recipe = dataOf(i.id);
    assert.ok(recipe.layers.length >= 1 && recipe.duration > 0 && recipe.duration <= 3, i.id);
    assert.ok(cleanSound(recipe), `${i.id}: the kit accepts it`);
    const pcm = synthesize(recipe);
    let peak = 0;
    for (const v of pcm.data) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 0.1 && peak <= 1, `${i.id} has a peak of ${peak}`);
    assert.ok(pcm.data.length / pcm.sampleRate <= 3.01, `${i.id} is short`);
    const text = sound.serializeSounds({ [i.name]: recipe });
    assert.ok(sound.parseSounds(text)[i.name], `${i.id} survives being saved and read`);
  }
});

test('every song loops sensibly: a tempo, bars, notes in range, accepted by the kit, and it can be played out', () => {
  for (const i of of('song')) {
    const song = dataOf(i.id);
    assert.equal(music.problemWith(song), null, i.id);
    assert.ok(song.tracks.length >= 2 && song.tracks.every((t) => t.notes.length >= 2), `${i.id} has voices with notes`);
    for (const t of song.tracks) {
      for (const n of t.notes) assert.ok(n.pitch >= 36 && n.pitch <= 96 && n.len >= 1 && n.step >= 0 && n.step < music.songSteps(song), `${i.id}: a note is out of range ${JSON.stringify(n)}`);
    }
    const kit = music.toKit(song);
    assert.ok(cleanSong(kit), `${i.id}: the kit accepts it`);
    const pcm = sequence({ bpm: kit.bpm, tracks: kit.tracks.map((t) => ({ ...t, notes: t.notes })) });
    assert.ok(pcm.data.length / pcm.sampleRate > 2 && pcm.data.length / pcm.sampleRate < 60, `${i.id} lasts a sensible time`);
    assert.doesNotThrow(() => music.parseSongs(music.serializeSongs({ [i.name]: song })), `${i.id} survives being saved and read`);
  }
});

test('searching finds things by title, tag, category and part of a word, all words must match, and a kind can be chosen', () => {
  assert.deepEqual(searchPack('blue gem').map((i) => i.id), ['sprite:gem']);
  assert.ok(searchPack('monster').every((i) => i.kind === 'sprite') && searchPack('monster').length >= 3);
  assert.ok(searchPack('spook').some((i) => i.id === 'song:spooky') && searchPack('spook').some((i) => i.id === 'sprite:ghost'), 'part of a word, across kinds');
  assert.ok(searchPack('boom').some((i) => i.id === 'sound:explosion'), 'by tag');
  assert.ok(searchPack('', { kind: 'sound' }).length === of('sound').length);
  assert.ok(searchPack('', { kind: 'sprite', category: 'Tiles' }).every((i) => i.name.startsWith('tile-')));
  assert.equal(searchPack('zzzz nothing').length, 0);
  assert.equal(searchPack('   ').length, items.length, 'an empty search is everything');
});

test('putting a picture in a project makes a file in src/art/ that the studio reads back, with a free name and the licence in it', () => {
  const first = installItem(project(), 'sprite:hero');
  assert.equal(first.path, 'src/art/hero.js');
  assert.match(first.text, /CC0/);
  assert.equal(sprite.parseSprite(first.text).w, 16);
  const again = installItem(project({ 'src/art/hero.js': first.text }), 'sprite:hero');
  assert.equal(again.path, 'src/art/hero2.js', 'a second one does not overwrite the first');
  assert.equal(again.name, 'hero2');
  assert.match(first.how, /import hero from/);
});

test('putting a sound or a song in adds it to the project\'s own file under a free name and keeps what was there', () => {
  const a = installItem(project(), 'sound:coin');
  assert.equal(a.path, 'src/sounds.js');
  assert.deepEqual(Object.keys(sound.parseSounds(a.text)), ['coin']);
  const mine = sound.serializeSounds({ coin: { duration: 0.1, layers: [{ wave: 'sine', freq: 300, gain: 0.5, decay: 0.05 }] }, boom: sound.preset('explosion') });
  const b = installItem(project({ 'src/sounds.js': mine }), 'sound:coin');
  const kept = sound.parseSounds(b.text);
  assert.deepEqual(Object.keys(kept).sort(), ['boom', 'coin', 'coin2'], 'the old ones stay and the new one has a free name');
  assert.equal(kept.coin.layers[0].freq, 300, 'the one that was there is untouched');
  assert.equal(b.name, 'coin2');
  assert.equal(b.how, "play('coin2')");
  const s = installItem(project(), 'song:cheerful');
  assert.equal(s.path, 'src/music.js');
  assert.ok(music.parseSongs(s.text).songs.cheerful);
  const s2 = installItem(project({ 'src/music.js': s.text }), 'song:cheerful');
  assert.deepEqual(Object.keys(music.parseSongs(s2.text).songs).sort(), ['cheerful', 'cheerful2']);
  assert.throws(() => installItem(project(), 'sprite:nothing-here'), /nothing called/);
  assert.throws(() => installItem(project({ 'src/sounds.js': 'oops' }), 'sound:coin'), /not a list of sounds/, 'a damaged sounds file is reported, not overwritten');
});
