import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/paint/text-model.js';

const table = () => ({
  en: { start: 'Start', hello: 'Hello, {name}!', 'coins.one': '{n} coin', 'coins.other': '{n} coins' },
  fr: { start: 'Commencer', 'coins.one': '{n} pièce', 'coins.other': '{n} pièces' },
});

test('a table is saved as a file and read back exactly, even with quotes, accents and line breaks in the words', () => {
  const t = table();
  t.en.quote = 'She said "hi"\nthen left';
  t.fr.quote = 'Elle a dit « salut »';
  const text = M.serializeText(t);
  assert.match(text, /^\/\/ Made with the studio/);
  assert.match(text, /export default \{/);
  assert.deepEqual(M.parseText(text), t);
  assert.deepEqual(M.parseText(M.serializeText({ en: {} })), { en: {} });
});

test('a damaged or edited file is reported in plain words, not guessed at', () => {
  assert.throws(() => M.parseText('nothing'), /not a table of words/);
  assert.throws(() => M.parseText('export default { en: oops };'), /plain JSON/);
  assert.throws(() => M.parseText('export default [];'), /object with one list/);
  assert.throws(() => M.parseText('export default { "english!": {} };'), /not a language code/);
  assert.throws(() => M.parseText('export default { "en": { "bad key": "x" } };'), /not a usable key/);
  assert.throws(() => M.parseText('export default { "en": [] };'), /should be an object/);
});

test('keys: checked, added to the first language, renamed everywhere in place, removed everywhere', () => {
  let t = table();
  assert.equal(M.keyProblem(t, 'start'), 'There is already a key with that name');
  assert.match(M.keyProblem(t, 'has space'), /letters, numbers/);
  assert.equal(M.keyProblem(t, 'new-key'), null);
  t = M.addKey(t, 'bye', 'Bye');
  assert.equal(t.en.bye, 'Bye');
  assert.ok(!('bye' in t.fr));
  assert.deepEqual(M.allKeys(t), ['start', 'hello', 'coins.one', 'coins.other', 'bye']);
  t = M.renameKey(t, 'start', 'begin');
  assert.deepEqual(Object.keys(t.en).slice(0, 2), ['begin', 'hello'], 'same place');
  assert.equal(t.fr.begin, 'Commencer');
  t = M.removeKey(t, 'begin');
  assert.ok(!('begin' in t.en) && !('begin' in t.fr));
});

test('setting a word: empty words in another language mean "missing" (the key is taken out), but the default language keeps its key', () => {
  let t = table();
  t = M.setWord(t, 'fr', 'hello', 'Bonjour, {name} !');
  assert.equal(t.fr.hello, 'Bonjour, {name} !');
  t = M.setWord(t, 'fr', 'hello', '');
  assert.ok(!('hello' in t.fr));
  t = M.setWord(t, 'en', 'hello', '');
  assert.equal(t.en.hello, '', 'the first language keeps the row');
  assert.equal(M.setWord(t, 'xx', 'a', 'b'), t, 'an unknown language changes nothing');
});

test('languages: added empty, checked, removed, and the default can be changed but not removed from under the others', () => {
  let t = table();
  assert.match(M.languageProblem(t, 'English'), /language code/);
  assert.match(M.languageProblem(t, 'FR'), /already/);
  assert.equal(M.languageProblem(t, 'pt-BR'), null);
  t = M.addLanguage(t, 'de');
  assert.deepEqual(t.de, {});
  assert.throws(() => M.removeLanguage(t, 'en'), /fall back/);
  t = M.removeLanguage(t, 'de');
  assert.deepEqual(Object.keys(t), ['en', 'fr']);
  t = M.makeFirst(t, 'fr');
  assert.deepEqual(Object.keys(t), ['fr', 'en']);
  t = M.removeLanguage(t, 'en');
  assert.deepEqual(Object.keys(t), ['fr']);
  assert.deepEqual(M.removeLanguage({ en: {} }, 'en'), {}, 'the only language can go');
});

test('how complete each language is counts plural forms of a key as one', () => {
  const done = M.completeness(table());
  assert.equal(done.en, 1);
  assert.equal(done.fr, 2 / 3, 'start and coins, but not hello');
  assert.deepEqual(M.completeness({ en: {} }), { en: 1 });
});

test('the checker names what is missing, different or left untranslated', () => {
  const kinds = M.problems(table()).map((p) => `${p.language}:${p.key}:${p.kind}`);
  assert.deepEqual(kinds, ['fr:hello:missing']);
});

test('CSV goes out with a header and quoted cells, and comes back as the same table', () => {
  const t = table();
  t.en.long = 'Line one\nLine "two", with a comma';
  const csv = M.toCsv(t);
  assert.match(csv, /^key,en,fr\r\n/);
  assert.match(csv, /"Line one\nLine ""two"", with a comma"/);
  const back = M.fromCsv(csv);
  assert.equal(back.en.long, t.en.long);
  assert.equal(back.fr.start, 'Commencer');
  assert.ok(!('hello' in back.fr), 'an empty cell is a missing word, not an empty word');
  assert.deepEqual(M.fromCsv(M.toCsv({ en: { a: 'x' } })), { en: { a: 'x' } });
});

test('CSV from a spreadsheet program: BOM, Windows line endings and a final line without a break all work; bad files are explained', () => {
  const back = M.fromCsv('﻿key,en,de\r\nstart,Start,Los\r\nquit,Quit,Ende');
  assert.deepEqual(back, { en: { start: 'Start', quit: 'Quit' }, de: { start: 'Los', quit: 'Ende' } });
  assert.throws(() => M.fromCsv('name,en\nx,y'), /first row should be "key"/);
  assert.throws(() => M.fromCsv('key,english\na,b'), /not a language code/);
  assert.throws(() => M.fromCsv('key,en,EN\na,b,c'), /twice/);
  assert.throws(() => M.fromCsv('key,en\nbad key,b'), /Row 2/);
  assert.throws(() => M.fromCsv(''), /first row/);
});

test('an imported table replaces what it covers and keeps the rest (language codes match without caring about case)', () => {
  const merged = M.mergeTables(table(), { FR: { start: 'Démarrer' }, de: { start: 'Los' } });
  assert.equal(merged.fr.start, 'Démarrer');
  assert.equal(merged.fr['coins.one'], '{n} pièce', 'untouched');
  assert.equal(merged.de.start, 'Los');
  assert.ok(!('FR' in merged));
  assert.equal(merged.en.start, 'Start');
});

test('the starter table is a usable table with a plural pair', () => {
  const t = M.newTable();
  assert.deepEqual(M.parseText(M.serializeText(t)), t);
  assert.ok('coins.one' in t.en && 'coins.other' in t.en);
});
