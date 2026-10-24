import { test } from 'node:test';
import assert from 'node:assert/strict';
import { text, t, setLanguage, setPseudo, language, languages, pseudo, textProblems, baseKey } from '../src/text.js';

const words = {
  en: { start: 'Start', hello: 'Hello, {name}!', 'coins.one': '{n} coin', 'coins.other': '{n} coins', only: 'Only English' },
  fr: { start: 'Commencer', hello: 'Bonjour, {name} !', 'coins.one': '{n} pièce', 'coins.other': '{n} pièces' },
  ru: { start: 'Начать', 'coins.one': '{n} монета', 'coins.few': '{n} монеты', 'coins.many': '{n} монет', 'coins.other': '{n} монеты' },
};

test('the first language is the default, and a chosen one answers in its own words', () => {
  assert.equal(text(words, 'en'), 'en');
  assert.equal(t('start'), 'Start');
  assert.deepEqual(languages(), ['en', 'fr', 'ru']);
  assert.equal(setLanguage('fr'), 'fr');
  assert.equal(t('start'), 'Commencer');
  assert.equal(language(), 'fr');
});

test('a language code is matched without caring about case, and a region falls back to the language; an unknown one falls back to the first', () => {
  assert.equal(setLanguage('FR'), 'fr');
  assert.equal(setLanguage('fr-CA'), 'fr');
  assert.equal(setLanguage('xx'), 'en');
});

test('"auto" uses the languages of the device when the table has one', () => {
  const was = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { languages: ['de-DE', 'fr-FR'] }, configurable: true });
  try {
    assert.equal(text(words), 'fr');
    Object.defineProperty(globalThis, 'navigator', { value: { languages: ['ja'] }, configurable: true });
    assert.equal(text(words), 'en');
  } finally {
    if (was) Object.defineProperty(globalThis, 'navigator', was); else delete globalThis.navigator;
  }
});

test('{places} are filled, and what has no value stays visible', () => {
  text(words, 'en');
  assert.equal(t('hello', { name: 'Sam' }), 'Hello, Sam!');
  assert.equal(t('hello'), 'Hello, {name}!');
  assert.equal(t('hello', { name: 0 }), 'Hello, 0!');
});

test('a count picks the plural form for the language', () => {
  text(words, 'en');
  assert.equal(t('coins', { n: 1 }), '1 coin');
  assert.equal(t('coins', { n: 0 }), '0 coins');
  assert.equal(t('coins', { n: 5 }), '5 coins');
  setLanguage('ru');
  assert.equal(t('coins', { n: 1 }), '1 монета');
  assert.equal(t('coins', { n: 3 }), '3 монеты');
  assert.equal(t('coins', { n: 5 }), '5 монет');
  setLanguage('fr');
  assert.equal(t('coins', { n: 0 }), '0 pièce', 'French says zero in the singular');
  assert.equal(t('coins', { count: 2 }), '2 pièces', 'count works as well as n');
});

test('a missing word falls back to the first language, then shows the key in brackets', () => {
  text(words, 'fr');
  assert.equal(t('only'), 'Only English');
  assert.equal(t('nothing-here'), '⟦nothing-here⟧');
  text({}, 'en');
  assert.equal(t('start'), '⟦start⟧', 'no table at all does not crash');
});

test('test text accents the letters, grows the words, keeps the places and is switched on and off', () => {
  assert.equal(pseudo('Hi {name}'), '[Ĥí {name}~]');
  assert.ok(pseudo('A long sentence here').length > 'A long sentence here'.length + 4);
  text(words, 'en');
  setPseudo(true);
  assert.match(t('hello', { name: 'Sam' }), /^\[.*Sam.*\]$/);
  assert.equal(t('nothing-here'), '⟦nothing-here⟧', 'a missing key is not dressed up: it already stands out');
  setPseudo(false);
  assert.equal(t('start'), 'Start');
});

test('the check finds gaps, extras, untranslated copies, changed places and empty words', () => {
  const bad = {
    en: { a: 'Hello', b: 'Hi {name}', c: 'Same words', d: 'Four', e: 'Five' },
    fr: { a: 'Bonjour', b: 'Salut', c: 'Same words', extra: 'x', e: '' },
  };
  const kinds = textProblems(bad).map((p) => `${p.language}:${p.key}:${p.kind}`).sort();
  assert.deepEqual(kinds, ['fr:b:places', 'fr:c:same', 'fr:d:missing', 'fr:e:empty', 'fr:extra:extra']);
  assert.ok(textProblems(bad).every((p) => p.message.length > 10));
  assert.deepEqual(textProblems(words).map((p) => `${p.language}:${p.key}:${p.kind}`), ['fr:only:missing', 'ru:hello:missing', 'ru:only:missing']);
});

test('plural forms belong to one key', () => {
  assert.equal(baseKey('coins.other'), 'coins');
  assert.equal(baseKey('coins'), 'coins');
  assert.equal(baseKey('a.b.one'), 'a.b');
});
