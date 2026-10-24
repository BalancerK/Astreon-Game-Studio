# @engine/i18n

The words of a game in more than one language: the right plural form for a count in any language, the same word used two ways (contexts), translators' gettext `.po` and spreadsheet `.csv` files, fallback from `pt-BR` to `pt` to your default language, pseudo-localisation to find layouts that cannot take longer words, and a list of what is still untranslated. No dependencies, nothing global (a server can hold one `Localizer` per player), nothing that touches the page.

```js
import { Localizer } from '@engine/i18n';

const i18n = new Localizer({ fallback: 'en' });
i18n.add('en', { 'Start game': 'Start game', coins: { one: '{n} coin', other: '{n} coins' }, 'Hello {name}': 'Hello {name}!' });
i18n.addPo(await (await fetch('lang/pl.po')).text());          // a translator's file: contexts, plurals and the plural rule come with it
i18n.addCsv(sheetText);                                        // or a spreadsheet: key, context, then a column per language
i18n.setLanguage('auto');                                      // the player's device language if there are words for it

i18n.t('Hello {name}', { name: 'Sam' });                       // "Hello Sam!"
i18n.tn('coins', 3);                                           // "3 coins"; Polish says "3 monety", Russian "3 монеты", Arabic has six forms
i18n.tc('verb', 'Open');                                       // "Open" the door, not "Open" the status
i18n.tcn('shop', 'item', 5);                                   // a context and a count
```

- **Plurals:** a word with a count is an object by CLDR name (`{ one, few, many, other, ... }`, with the names each language uses coming from the platform's own data, `Intl.PluralRules`) or a list in gettext order. A `.po` file's `Plural-Forms:` header (`nplurals=3; plural=(n==1 ? 0 : ...)`) is read by a small parser and turned into a function; it is never evaluated as code, and anything but `n`, numbers and the usual operators is refused. `setPlural(language, rule)` sets one by hand. `{n}` in the text is the count (or the `n` you pass).
- **Contexts:** the same English word may need two translations. Words are stored as `context` + `\u0004` + `key` (gettext's own convention, see `entryKey`), `tc` and `tcn` ask for one, and `.po` `msgctxt` and a csv `context` column feed them.
- **Files:** `parsePo(text)` returns the header and entries (`msgctxt`, `msgid`, `msgid_plural`, `msgstr[n]`, continued lines, escapes, `#, fuzzy`; obsolete `#~` entries are skipped); `addPo` loads it (untranslated and fuzzy entries are left out unless `fuzzy: true`; the language is the `Language:` header or `{ language }`). `parseCsv` handles quotes, doubled quotes, line breaks in cells, CRLF and a byte-order mark; `addCsv` takes a `key` column, an optional `context` column, one column per language (columns starting with `#` and rows whose key starts with `#` are comments), and `thing.one` / `thing.other` rows as the forms of one word (so tables made for the arcade kit work as they are).
- **Fallback:** `pt-BR` tries `pt-BR`, `pt`, then the fallback language (the first one added unless you say), then shows the key. `missingStyle: 'brackets'` shows `[key]` instead so a gap is easy to spot, and `onMissing(language, key, context)` is called once for each word that could not be found, to log or collect.
- **For translators:** `missing('de')` lists the keys the fallback language has that German (and `de-AT`'s parents) lack; `toCsv()` writes every word as a sheet with the gaps empty, which `addCsv` reads back.
- **Placeholders:** `{name}` is filled from the params, `{{` and `}}` are literal braces, a missing value leaves the `{name}` visible, `{n:number}` formats a number for the language (`1,234,567` or `1.234.567`) and `{names:list}` a list (`A, B, and C`), both through the platform's `Intl`.
- **Pseudo-localisation:** `pseudo = true` (or `pseudoLocalize(text)`) turns "Start game" into "[Šţáŕţ ĝáɱé ~~~]": accents show text that is hard-coded or in the wrong font, the extra third shows layouts that break with German or Finnish, the brackets show text that gets cut off, and `{places}` are left alone.
- **Choosing a language:** `setLanguage('fr')`, or `'auto'` (the player's `navigator.languages`, the first that has a table, else the fallback); `onChange` hears it. Nothing here reads a cookie or the network.

Not done: ICU message syntax with nested selects (`{gender, select, ...}`), ordinals, right-to-left layout and text direction (that is the text renderer's job), date and currency formatting beyond numbers and lists, writing `.po` files back, and loading files for you (fetch them, then `addPo` / `addCsv`).
