import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Localizer, pseudoLocalize, entryKey, parsePluralExpression, parsePluralForms, cldrRules, parsePo, parseCsv, toCsv } from '../src/index.js';

test('plural expressions: English, French, Russian, Polish, Arabic and Japanese rules from real .po headers', () => {
  const en = parsePluralForms('nplurals=2; plural=(n != 1);');
  assert.deepEqual([0, 1, 2, 5].map(en.index), [1, 0, 1, 1]);
  const fr = parsePluralForms('nplurals=2; plural=(n > 1);');
  assert.deepEqual([0, 1, 2].map(fr.index), [0, 0, 1]);
  const ru = parsePluralForms('nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);');
  assert.deepEqual([1, 2, 5, 11, 21, 22, 25, 111, 112].map(ru.index), [0, 1, 2, 2, 0, 1, 2, 2, 2]);
  const pl = parsePluralForms('nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);');
  assert.deepEqual([1, 2, 5, 12, 22].map(pl.index), [0, 1, 2, 2, 1]);
  const ar = parsePluralForms('nplurals=6; plural=n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && n%100<=10 ? 3 : n%100>=11 ? 4 : 5;');
  assert.deepEqual([0, 1, 2, 3, 11, 100].map(ar.index), [0, 1, 2, 3, 4, 5]);
  const ja = parsePluralForms('nplurals=1; plural=0;');
  assert.deepEqual([0, 1, 5].map(ja.index), [0, 0, 0]);
});

test('plural expressions are read, never run: anything else is refused', () => {
  assert.throws(() => parsePluralExpression('process.exit()'), /cannot read/);
  assert.throws(() => parsePluralExpression('n ? 1'), /expected ":"|ends too early/);
  assert.throws(() => parsePluralExpression('(n'), /expected "\)"/);
  assert.throws(() => parsePluralExpression('n n'), /unexpected/);
  assert.throws(() => parsePluralForms('plural=n'), /cannot read Plural-Forms/);
  assert.equal(parsePluralExpression('n % 0')(5), 0, 'division by zero is 0, not a crash');
});

test('CLDR rules come from the platform: categories in a fixed order', () => {
  assert.deepEqual(cldrRules('en').categories, ['one', 'other']);
  assert.deepEqual(cldrRules('ru').categories, ['one', 'few', 'many', 'other']);
  assert.equal(cldrRules('ru').select(3), 'few');
  assert.deepEqual(cldrRules('ja').categories, ['other']);
  assert.deepEqual(cldrRules('ar').categories, ['zero', 'one', 'two', 'few', 'many', 'other']);
  assert.deepEqual(cldrRules('not a language!!').categories, ['one', 'other'], 'a bad code is treated as English');
});

test('plain words, placeholders, escaped braces, and a missing word showing its key', () => {
  const l = new Localizer();
  l.add('en', { 'Start game': 'Start game', 'Hello {name}': 'Hello {name}!', braces: 'use {{braces}} like {this}' });
  l.setLanguage('en');
  assert.equal(l.t('Start game'), 'Start game');
  assert.equal(l.t('Hello {name}', { name: 'Sam' }), 'Hello Sam!');
  assert.equal(l.t('Hello {name}'), 'Hello {name}!', 'a missing value leaves the place visible');
  assert.equal(l.t('braces', { this: 'x' }), 'use {braces} like x');
  const seen = [];
  l.onMissing = (lang, key) => seen.push(`${lang}:${key}`);
  assert.equal(l.t('nowhere'), 'nowhere'); l.t('nowhere'); assert.deepEqual(seen, ['en:nowhere'], 'reported once');
  l.missingStyle = 'brackets'; assert.equal(l.t('other missing'), '[other missing]');
});

test('plurals: names for CLDR languages, lists for gettext, and the count is {n}', () => {
  const l = new Localizer({ fallback: 'en' });
  l.add('en', { coins: { one: '{n} coin', other: '{n} coins' } });
  l.add('ru', { coins: { one: '{n} монета', few: '{n} монеты', many: '{n} монет', other: '{n} монеты' } });
  l.add('pl', { coins: ['{n} moneta', '{n} monety', '{n} monet'] });
  l.setPlural('pl', 'nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);');
  l.setLanguage('en'); assert.deepEqual([0, 1, 2].map((n) => l.tn('coins', n)), ['0 coins', '1 coin', '2 coins']);
  l.setLanguage('ru'); assert.deepEqual([1, 2, 5, 21, 22].map((n) => l.tn('coins', n)), ['1 монета', '2 монеты', '5 монет', '21 монета', '22 монеты']);
  l.setLanguage('pl'); assert.deepEqual([1, 2, 5, 22].map((n) => l.tn('coins', n)), ['1 moneta', '2 monety', '5 monet', '22 monety']);
  assert.equal(l.tn('coins', 3, { n: 'three' }), 'three monety', 'a given {n} wins');
});

test('a list of forms with no rule uses the language\'s own order (zero, one, two, few, many, other)', () => {
  const l = new Localizer();
  l.add('en', { files: ['one file', 'many files'] });
  l.setLanguage('en');
  assert.deepEqual([1, 2].map((n) => l.tn('files', n)), ['one file', 'many files']);
});

test('the arcade kit\'s dotted tables work unchanged', () => {
  const l = new Localizer();
  l.add('en', { 'coins.one': '{n} coin', 'coins.other': '{n} coins', start: 'Start' });
  l.setLanguage('en');
  assert.equal(l.tn('coins', 1), '1 coin'); assert.equal(l.tn('coins', 4), '4 coins'); assert.equal(l.t('start'), 'Start');
});

test('contexts tell apart the same word used two ways', () => {
  const l = new Localizer();
  l.add('en', { Open: 'Open' }); l.addEntry('en', 'Open', 'Open (door)', 'verb'); l.addEntry('fr', 'Open', 'Ouvrir', 'verb'); l.addEntry('fr', 'Open', 'Ouvert', 'status'); l.add('fr', { Open: 'Ouvrir ?' });
  l.setLanguage('fr');
  assert.equal(l.tc('verb', 'Open'), 'Ouvrir'); assert.equal(l.tc('status', 'Open'), 'Ouvert'); assert.equal(l.t('Open'), 'Ouvrir ?');
  l.setLanguage('en'); assert.equal(l.tc('verb', 'Open'), 'Open (door)');
  assert.equal(l.tc('nowhere', 'Open'), 'Open', 'an unknown context shows the key');
  assert.equal(entryKey('Open', 'verb'), 'verb\u0004Open'); assert.equal(entryKey('Open'), 'Open');
  assert.equal(l.has('Open', 'verb'), true); assert.equal(l.has('Shut', 'verb'), false);
  l.add('en', { 'menu\u0004Open': 'Open menu', 'menu\u0004Close.one': 'x' });
  assert.equal(l.tc('menu', 'Open'), 'Open menu');
});

test('fallback: pt-BR, then pt, then the first language, then the key', () => {
  const l = new Localizer();
  l.add('en', { a: 'A en', b: 'B en', c: 'C en', d: 'D en' }).add('pt', { a: 'A pt', b: 'B pt', c: 'C pt' }).add('pt-BR', { a: 'A br', b: 'B br' });
  assert.equal(l.fallback, 'en');
  l.setLanguage('pt-BR');
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((k) => l.t(k)), ['A br', 'B br', 'C pt', 'D en', 'e']);
  l.setLanguage('pt-PT'); assert.equal(l.t('a'), 'A pt', 'a region that has no table uses its language');
  l.setLanguage('zh'); assert.equal(l.t('a'), 'A en');
  assert.deepEqual(l.missing('pt-BR'), ['d'], 'what pt-BR and pt both lack');
  assert.deepEqual(l.missing('pt'), ['d']); assert.deepEqual(l.missing('de'), ['a', 'b', 'c', 'd']);
});

test('setLanguage(auto) picks the device language when there are words for it', () => {
  const l = new Localizer();
  l.add('en', { x: 'x' }).add('de', { x: 'ix' });
  const was = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', { value: { languages: ['fr-CA', 'de-AT', 'en'] }, configurable: true });
    assert.equal(l.setLanguage('auto'), 'de-AT'); assert.equal(l.t('x'), 'ix');
    Object.defineProperty(globalThis, 'navigator', { value: { languages: ['ja'] }, configurable: true });
    assert.equal(l.setLanguage(), 'en');
  } finally { if (was) Object.defineProperty(globalThis, 'navigator', was); else delete globalThis.navigator; }
  let heard = null; l.onChange = (c) => { heard = c; }; l.setLanguage('de'); assert.equal(heard, 'de');
});

test('numbers and lists are formatted for the language', () => {
  const l = new Localizer();
  l.add('en', { score: 'Score {n:number}', who: 'with {names:list}' }).add('de', { score: 'Punkte {n:number}' });
  l.setLanguage('en'); assert.equal(l.t('score', { n: 1234567 }), 'Score 1,234,567'); assert.equal(l.t('who', { names: ['A', 'B', 'C'] }), 'with A, B, and C');
  l.setLanguage('de'); assert.equal(l.t('score', { n: 1234567 }), 'Punkte 1.234.567');
});

test('pseudo-localisation accents letters, grows the text, brackets it, and spares {places}', () => {
  assert.equal(pseudoLocalize('Hello {name}'), '[Ĥéĺĺö {name} ~~]');
  assert.equal(pseudoLocalize('OK'), '[ÖĶ]');
  const l = new Localizer({ pseudo: true });
  l.add('en', { go: 'Go on {n} times' }); l.setLanguage('en');
  assert.match(l.t('go', { n: 3 }), /^\[Ĝö öñ 3 ţíɱéš ~+\]$/);
  l.pseudo = false; assert.equal(l.t('go', { n: 3 }), 'Go on 3 times');
});

const PO = `# Translations
msgid ""
msgstr ""
"Language: pl\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\\n"

#: menu.js:3
msgid "Start"
msgstr "Zacznij"

msgctxt "verb"
msgid "Open"
msgstr "Otwórz"

msgctxt "status"
msgid "Open"
msgstr "Otwarte"

#, fuzzy
msgid "Quit"
msgstr "Wyjdź (niepewne)"

msgid "Untranslated"
msgstr ""

msgid "A long line "
"continued, with \\"quotes\\"\\nand a new line"
msgstr "Długa linia "
"ciąg dalszy"

msgid "coin"
msgid_plural "coins"
msgstr[0] "moneta"
msgstr[1] "monety"
msgstr[2] "monet"

#~ msgid "Old"
#~ msgstr "Stare"
`;

test('a .po file: header, contexts, plurals, continued lines, escapes, fuzzy and untranslated entries', () => {
  const po = parsePo(PO);
  assert.equal(po.header.Language, 'pl'); assert.match(po.header['Plural-Forms'], /nplurals=3/);
  assert.equal(po.entries.length, 7, 'every entry except the header and the obsolete one');
  const open = po.entries.filter((e) => e.id === 'Open');
  assert.deepEqual(open.map((e) => [e.context, e.forms[0]]), [['verb', 'Otwórz'], ['status', 'Otwarte']]);
  assert.equal(po.entries.find((e) => e.id === 'Quit').fuzzy, true);
  assert.equal(po.entries.find((e) => e.id.startsWith('A long')).id, 'A long line continued, with "quotes"\nand a new line');
  const coin = po.entries.find((e) => e.id === 'coin');
  assert.deepEqual([coin.plural, coin.forms], ['coins', ['moneta', 'monety', 'monet']]);
  assert.throws(() => parsePo('msgid "x"\nnonsense'), /line 2/);
  assert.throws(() => parsePo('msgid x'), /line 1/);
});

test('addPo loads a .po into the localizer, with its plural rule', () => {
  const l = new Localizer();
  l.add('en', { Start: 'Start' });
  assert.equal(l.addPo(PO), 5, 'fuzzy and untranslated entries are left out');
  l.setLanguage('pl');
  assert.equal(l.t('Start'), 'Zacznij'); assert.equal(l.tc('verb', 'Open'), 'Otwórz'); assert.equal(l.tc('status', 'Open'), 'Otwarte');
  assert.equal(l.t('Quit'), 'Quit', 'fuzzy is skipped');
  assert.deepEqual([1, 2, 5, 22].map((n) => l.tn('coin', n)), ['moneta', 'monety', 'monet', 'monety']);
  assert.equal(l.addPo(PO, { language: 'pl-x', fuzzy: true }), 6); l.setLanguage('pl-x'); assert.equal(l.t('Quit'), 'Wyjdź (niepewne)');
  assert.throws(() => new Localizer().addPo('msgid "a"\nmsgstr "b"'), /no "Language:" header/);
});

test('csv: quotes, doubled quotes, line breaks in cells, CRLF, a byte-order mark', () => {
  const rows = parseCsv('﻿key,en,fr\r\nhello,"Hello, ""world""",Bonjour\r\n"two\nlines",a,\r\n\r\nlast,x,y');
  assert.deepEqual(rows, [['key', 'en', 'fr'], ['hello', 'Hello, "world"', 'Bonjour'], ['two\nlines', 'a', ''], ['last', 'x', 'y']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2', { delimiter: '\t' }), [['a', 'b'], ['1', '2']]);
  assert.throws(() => parseCsv('a,"open'), /never closed/);
  assert.equal(toCsv([['a,b', 'c"d', 'e']]), '"a,b","c""d",e\n');
});

test('addCsv: languages by column, contexts, plural rows, comments, empty cells', () => {
  const csv = ['key,context,en,fr,#note', 'Start,,Start,Démarrer,x', 'Open,verb,Open,Ouvrir,', 'Open,status,Open,,', 'coins.one,,{n} coin,{n} pièce,', 'coins.other,,{n} coins,{n} pièces,', '#hidden,,no,no,'].join('\n');
  const l = new Localizer();
  assert.deepEqual(l.addCsv(csv), ['en', 'fr']);
  l.setLanguage('fr');
  assert.equal(l.t('Start'), 'Démarrer'); assert.equal(l.tc('verb', 'Open'), 'Ouvrir'); assert.equal(l.tc('status', 'Open'), 'Open', 'the empty cell falls back to English');
  assert.deepEqual([1, 2].map((n) => l.tn('coins', n)), ['1 pièce', '2 pièces']); assert.equal(l.t('hidden'), 'hidden');
  assert.throws(() => new Localizer().addCsv('a,b\n1,2'), /"key" column/);
  assert.deepEqual(l.missing('fr'), ['status\u0004Open']);
});

test('toCsv gives translators a sheet with what is done and what is not, and it reads back', () => {
  const l = new Localizer();
  l.add('en', { Start: 'Start', 'coins.one': '{n} coin', 'coins.other': '{n} coins' }).add('fr', { Start: 'Démarrer' });
  l.addEntry('en', 'Open', 'Open', 'verb');
  const csv = l.toCsv();
  assert.match(csv, /^key,context,en,fr\n/); assert.match(csv, /coins\.one,,\{n\} coin,\n/); assert.match(csv, /Open,verb,Open,\n/);
  const back = new Localizer(); back.addCsv(csv); back.setLanguage('en');
  assert.equal(back.tn('coins', 2), '2 coins'); assert.equal(back.tc('verb', 'Open'), 'Open');
});

test('mistakes are named', () => {
  assert.throws(() => new Localizer().add('', {}), /say which language/);
});
