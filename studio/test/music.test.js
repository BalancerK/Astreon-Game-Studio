import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/paint/music-model.js';
import { History } from '../app/paint/sprite-model.js';
import { cleanSong } from '../../packages/arcade/src/index.js';
import { sequence } from '../../packages/audio/src/synth.js';

test('note names and numbers agree with the synth (A4 is 69 and 440 Hz; C4 is 60)', () => {
  assert.equal(M.noteName(69), 'A4');
  assert.equal(M.noteName(61), 'C#4');
  assert.equal(M.noteName(36), 'C2');
  assert.equal(M.midiOf('A4'), 69);
  assert.equal(M.midiOf('C#4'), 61);
  assert.equal(M.midiOf('Bb2'), 46);
  assert.equal(M.midiOf('H4'), null);
  for (let p = 36; p <= 96; p++) assert.equal(M.midiOf(M.noteName(p)), p, String(p));
  assert.equal(M.isBlackKey(61), true);
  assert.equal(M.isBlackKey(60), false);
});

test('clicking a cell adds a note, clicking a note removes it, and a new note replaces what it overlaps on its track', () => {
  let s = M.newSong(120, 2);
  s = M.toggleNote(s, 0, 4, 60, 4);
  assert.deepEqual(s.tracks[0].notes, [{ step: 4, pitch: 60, len: 4 }]);
  assert.equal(M.noteAt(s, 0, 6, 60), 0, 'inside the note');
  assert.equal(M.noteAt(s, 0, 8, 60), -1);
  const covered = M.toggleNote(s, 0, 6, 64, 4);
  assert.deepEqual(covered.tracks[0].notes, [{ step: 6, pitch: 64, len: 4 }], 'one voice, one note at a time');
  assert.deepEqual(M.toggleNote(s, 0, 5, 60).tracks[0].notes, [], 'clicking on a note takes it away');
  assert.deepEqual(M.toggleNote(s, 1, 4, 60).tracks[1].notes.length, 1, 'another track is separate');
  assert.equal(M.toggleNote(s, 0, 999, 60), s);
  assert.equal(M.toggleNote(s, 0, 0, 5), s, 'off the keyboard');
  assert.equal(M.toggleNote(s, 7, 0, 60), s);
  assert.equal(M.toggleNote(s, 0, 30, 60, 16).tracks[0].notes.at(-1).len, 2, 'cut at the end of the song');
  assert.equal(s.tracks[0].notes.length, 1, 'the song you gave is never changed');
});

test('the kit song: notes in order with rests between, ending exactly at the end of the bars, and the kit accepts it', () => {
  let s = M.newSong(120, 1);
  s = M.toggleNote(s, 0, 0, 69, 4);
  s = M.toggleNote(s, 0, 8, 72, 8);
  const kit = M.toKit(s);
  assert.deepEqual(kit.tracks[0].notes, [['A4', 1], [null, 1], ['C5', 2]]);
  assert.deepEqual(kit.tracks[1].notes, [[null, 4]], 'an empty track is one long rest');
  assert.equal(kit.bpm, 120);
  const clean = cleanSong(kit);
  assert.ok(clean, 'the kit accepts what the editor writes');
  const total = (t) => t.notes.reduce((n, [, b]) => n + b, 0);
  assert.deepEqual(clean.tracks.map(total), [4, 4], 'every track is a whole number of bars, so the loop has no gap');
  const pcm = sequence({ bpm: clean.bpm, tracks: clean.tracks });
  assert.equal(pcm.data.length, Math.round(2 * 44100), 'one bar of four beats at 120 is two seconds');
  assert.ok(pcm.data.some((v) => Math.abs(v) > 0.05));
  // long silences are split so every piece is in range
  const quiet = M.setBars(M.newSong(120, 6), 6);
  assert.ok(M.toKit(quiet).tracks[0].notes.every(([, b]) => b <= 16));
  assert.ok(cleanSong(M.toKit(quiet)));
});

test('a song round-trips: editor to kit to editor, and through the file', () => {
  const s = M.PRESETS.calm();
  const back = M.fromKit(M.toKit(s));
  assert.equal(back.rounded, false);
  assert.deepEqual(back.song.tracks.map((t) => t.notes), s.tracks.map((t) => M.tidyNotes(t.notes, M.songSteps(s))));
  assert.deepEqual([back.song.bpm, back.song.bars], [s.bpm, s.bars]);
  const text = M.serializeSongs({ calm: s, chase: M.PRESETS.chase() });
  const read = M.parseSongs(text);
  assert.deepEqual(Object.keys(read.songs), ['calm', 'chase']);
  assert.deepEqual(read.songs.calm.tracks.map((t) => t.notes), back.song.tracks.map((t) => t.notes));
  assert.deepEqual(read.rounded, []);
  assert.throws(() => M.parseSongs('const a = 1'), /not a list of songs/);
  assert.throws(() => M.parseSongs('export default {nope'), /plain JSON/);
  assert.throws(() => M.parseSongs('export default {"x": {"tracks": []}}'), /not a usable song/);
  assert.equal(M.parseSongs('export default {"x": {"bpm": 999, "tracks": [{"notes": [["A4", 1]]}]}}').songs.x.bpm, 240, 'a tempo the kit would refuse is brought into range');
});

test('a song written by hand with odd lengths is moved onto the grid and says so', () => {
  const out = M.parseSongs('export default {"odd": {"bpm": 100, "tracks": [{"wave": "sine", "notes": [["A4", 0.3], [null, 0.7], ["C5", 1.5]]}]}}');
  assert.deepEqual(out.rounded, ['odd']);
  assert.deepEqual(out.songs.odd.tracks[0].notes.map((n) => [n.step, n.len]), [[0, 1], [4, 6]]);
  assert.equal(out.songs.odd.bars, 1);
});

test('tempo, length, tracks, transpose and repeat', () => {
  let s = M.newSong(120, 4);
  assert.equal(M.setTempo(s, 1000).bpm, 240);
  assert.equal(M.setTempo(s, 5).bpm, 40);
  assert.equal(M.setBars(M.newSong(40, 1), 32).bars, 1, 'a song cannot be longer than a minute');
  s = M.toggleNote(s, 0, 60, 60, 4);
  assert.equal(M.setBars(s, 2).tracks[0].notes.length, 0, 'notes past the new end are cut');
  assert.equal(M.addTrack(M.addTrack(M.addTrack(M.addTrack(M.addTrack(M.addTrack(s))))))?.tracks.length, 8);
  let many = s;
  for (let i = 0; i < 10; i++) many = M.addTrack(many);
  assert.equal(many.tracks.length, M.SONG_LIMITS.tracks);
  assert.equal(M.removeTrack(M.newSong(), 0).tracks.length, 1);
  assert.equal(M.removeTrack(M.removeTrack(M.newSong(), 0), 0).tracks.length, 1, 'the last track stays');
  s = M.toggleNote(M.newSong(120, 4), 0, 0, 60, 4);
  assert.equal(M.transpose(s, 0, 7).tracks[0].notes[0].pitch, 67);
  assert.equal(M.transpose(s, 0, -40), s, 'not off the keyboard');
  const rep = M.repeatTrack(s, 0, 1);
  assert.deepEqual(rep.tracks[0].notes.map((n) => n.step), [0, 16, 32, 48]);
  assert.equal(M.setTrack(s, 0, { wave: 'sine', gain: 5 }).tracks[0].gain, 1);
  assert.equal(M.setTrack(s, 0, { wave: 'bad' }), s);
  assert.equal(M.clearTrack(s, 0).tracks[0].notes.length, 0);
  assert.equal(M.songSeconds(M.newSong(120, 4)), 8);
});

test('the starting songs and "surprise me" are songs the kit plays, and a seed always gives the same tune', () => {
  for (const [name, make] of Object.entries(M.PRESETS)) {
    const s = make();
    assert.equal(M.problemWith(s), null, name);
    assert.ok(s.tracks.every((t) => t.notes.length > 0), name);
    const kit = cleanSong(M.toKit(s));
    assert.ok(kit, name);
    assert.ok(sequence({ bpm: kit.bpm, tracks: kit.tracks }).data.length > 0, name);
  }
  assert.deepEqual(M.surprise(7), M.surprise(7));
  assert.notDeepEqual(M.surprise(7), M.surprise(8));
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = M.surprise(seed, { scale: seed % 2 ? 'minor' : 'major' });
    assert.equal(M.problemWith(s), null);
    assert.ok(cleanSong(M.toKit(s)), String(seed));
    assert.ok(s.tracks.every((t) => t.notes.every((n) => n.pitch >= 36 && n.pitch <= 96)));
  }
  assert.equal(M.freeName({ calm: 1 }, 'calm'), 'calm2');
  assert.equal(M.freeName({}, '9 bad name!'), 'badname');
});

test('undo works on songs', () => {
  const history = new History(M.newSong());
  let s = history.current;
  s = M.toggleNote(s, 0, 0, 60);
  history.push(s);
  s = M.toggleNote(s, 0, 8, 62);
  history.push(s);
  assert.equal(history.undo().tracks[0].notes.length, 1);
  assert.equal(history.redo().tracks[0].notes.length, 2);
});

test('notes that start together and last the same time are a chord: made by clicking, kept in the file as a list of names, and played together', () => {
  let s = M.newSong(120, 1);
  s = M.toggleNote(s, 0, 0, 60, 4);
  s = M.toggleNote(s, 0, 0, 64, 4);
  s = M.toggleNote(s, 0, 0, 67, 4);
  assert.deepEqual(s.tracks[0].notes.map((n) => n.pitch), [60, 64, 67], 'three notes at the same place, the same length');
  assert.deepEqual(M.toKit(s).tracks[0].notes, [[['C4', 'E4', 'G4'], 1], [null, 3]]);
  const clean = cleanSong(M.toKit(s));
  assert.ok(clean, 'the kit accepts a chord');
  assert.deepEqual(clean.tracks[0].notes[0], [['C4', 'E4', 'G4'], 1]);
  const pcm = sequence({ bpm: 120, tracks: clean.tracks });
  const single = sequence({ bpm: 120, tracks: [{ wave: 'square', gain: 0.3, notes: [['C4', 1], [null, 3]] }] });
  assert.equal(pcm.data.length, single.data.length);
  assert.notDeepEqual([...pcm.data.slice(1000, 1010)], [...single.data.slice(1000, 1010)], 'the chord sounds different from one note');
  // a different length at the same place is not a chord: it takes the place of what it overlaps
  const other = M.toggleNote(s, 0, 0, 72, 8);
  assert.deepEqual(other.tracks[0].notes.map((n) => n.pitch), [72]);
  // clicking one note of a chord takes just that note away
  assert.deepEqual(M.toggleNote(s, 0, 2, 64).tracks[0].notes.map((n) => n.pitch), [60, 67]);
  // the file round-trips
  const back = M.parseSongs(M.serializeSongs({ chords: s })).songs.chords;
  assert.deepEqual(back.tracks[0].notes.map((n) => [n.step, n.pitch, n.len]), [[0, 60, 4], [0, 64, 4], [0, 67, 4]]);
  // a chord can have six notes, no more; a hand-written one with a wrong name is refused by the kit
  let big = M.newSong(120, 1);
  for (const p of [60, 62, 64, 65, 67, 69, 71]) big = M.toggleNote(big, 0, 0, p, 4);
  assert.equal(big.tracks[0].notes.length, 6);
  assert.equal(cleanSong({ tracks: [{ notes: [[['C4', 'X9'], 1]] }] }), null);
  assert.equal(cleanSong({ tracks: [{ notes: [[[], 1]] }] }), null);
  assert.equal(cleanSong({ tracks: [{ notes: [[Array.from({ length: 7 }, () => 'C4'), 1]] }] }), null);
  // the next note ends a chord that runs into it
  let overlap = M.toggleNote(M.newSong(120, 1), 0, 0, 60, 8);
  overlap = M.toggleNote(overlap, 0, 0, 64, 8);
  overlap = M.toggleNote(overlap, 0, 4, 67, 4);
  assert.deepEqual(overlap.tracks[0].notes.map((n) => [n.step, n.pitch, n.len]), [[4, 67, 4]], 'a new note over a chord replaces it');
});
