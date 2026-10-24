import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRunnerMessage, isStudioMessage } from '../app/core/runner-protocol.js';
import { defaultRunnerOrigin } from '../app/core/runner-controller.js';
import { Prefs } from '../app/core/prefs.js';
import { WORKSPACES, PANEL_IDS, workspaceById, DEFAULT_WORKSPACE } from '../app/core/workspaces.js';
import { repair, panelIds, walk } from '../app/ui/dock-model.js';
import { highlightLine } from '../app/ui/code-editor.js';

// ---------- what the game's frame may say ----------
test('messages from the game frame are checked: unknown ones dropped, text shortened, numbers made real, data kept small', () => {
  assert.equal(parseRunnerMessage(null), null); assert.equal(parseRunnerMessage('hi'), null); assert.equal(parseRunnerMessage({}), null); assert.equal(parseRunnerMessage({ t: 5 }), null);
  assert.equal(parseRunnerMessage({ t: 'format-the-disk' }), null, 'a message the studio does not know is ignored');
  assert.deepEqual(parseRunnerMessage({ t: 'ready', extra: '<img onerror=...>' }), { t: 'ready' }, 'extra fields are not passed on');
  assert.deepEqual(parseRunnerMessage({ t: 'beat', frame: 12.9, summary: { score: 3 } }), { t: 'beat', frame: 12, summary: { score: 3 }, stateProblem: undefined });
  assert.equal(parseRunnerMessage({ t: 'beat', frame: 'NaN' }).frame, 0); assert.equal(parseRunnerMessage({ t: 'beat', frame: -5 }).frame, 0); assert.equal(parseRunnerMessage({ t: 'beat', frame: 1e30 }).frame, 1e9);
  const huge = parseRunnerMessage({ t: 'beat', frame: 1, summary: { a: 'x'.repeat(300_000) } }); assert.equal(huge.summary, undefined, 'a summary that is too big is dropped, the beat still counts');
  const cyclic = {}; cyclic.self = cyclic; assert.equal(parseRunnerMessage({ t: 'beat', frame: 1, summary: cyclic }).summary, undefined, 'data that cannot be copied is dropped');
  const err = parseRunnerMessage({ t: 'error', kind: 'evil', message: 'x'.repeat(5000), file: 'a/'.repeat(300), line: 4.7, column: -1 });
  assert.equal(err.kind, 'run'); assert.equal(err.message.length, 2000); assert.equal(err.file.length, 200); assert.equal(err.line, 4); assert.equal(err.column, 0);
  assert.deepEqual(parseRunnerMessage({ t: 'error', kind: 'load', message: 'm', file: 'src/main.js', line: 4, column: 15 }), { t: 'error', kind: 'load', message: 'm', file: 'src/main.js', line: 4, column: 15 });
  assert.deepEqual(parseRunnerMessage({ t: 'applied', run: 3, ms: 12, restarted: 1 }), { t: 'applied', run: 3, ms: 12, restarted: true, summary: undefined });
  assert.deepEqual(parseRunnerMessage({ t: 'hang' }), { t: 'hang' }); assert.deepEqual(parseRunnerMessage({ t: 'recovered', run: 2, fromSnapshot: 'yes' }), { t: 'recovered', run: 2, fromSnapshot: true });
  assert.deepEqual(parseRunnerMessage({ t: 'log', level: 'danger', text: 'y'.repeat(5000) }), { t: 'log', level: 'log', text: 'y'.repeat(1000) });
});

test('messages to the game frame: only the four the runner understands are accepted', () => {
  assert.ok(isStudioMessage({ t: 'run', run: 1, files: {} })); assert.ok(!isStudioMessage({ t: 'run', run: 1.5, files: {} })); assert.ok(!isStudioMessage({ t: 'run', run: 1 }));
  assert.ok(isStudioMessage({ t: 'key', code: 'ArrowLeft' })); assert.ok(!isStudioMessage({ t: 'key', code: 'x'.repeat(60) })); assert.ok(isStudioMessage({ t: 'visible', value: false })); assert.ok(!isStudioMessage({ t: 'visible', value: 'no' }));
  assert.ok(isStudioMessage({ t: 'stop' })); assert.ok(!isStudioMessage({ t: 'eval', code: 'alert(1)' })); assert.ok(!isStudioMessage(null));
});

test('the game runs on another origin from the studio: localhost and 127.0.0.1 swap in development, a deployed studio says where, anything else is refused', () => {
  const at = (hostname, port = '8080', protocol = 'http:') => ({ hostname, port, protocol });
  assert.equal(defaultRunnerOrigin(at('localhost')), 'http://127.0.0.1:8080'); assert.equal(defaultRunnerOrigin(at('127.0.0.1', '3000')), 'http://localhost:3000'); assert.equal(defaultRunnerOrigin(at('localhost', ''), undefined), 'http://127.0.0.1');
  assert.equal(defaultRunnerOrigin(at('studio.example.com', '', 'https:'), { runnerOrigin: 'https://play.example-games.net' }), 'https://play.example-games.net');
  assert.throws(() => defaultRunnerOrigin(at('studio.example.com'), undefined), /different origin/, 'a studio that cannot find a second origin must not run games beside itself');
});

// ---------- small things the studio remembers ----------
test('preferences: saved as JSON, read forgivingly, and a blocked or full storage never breaks anything', () => {
  const store = new Map(); const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const p = new Prefs(storage); assert.equal(p.get('x', 'fallback'), 'fallback'); p.set('layout.code', { a: [1, 2] }); assert.deepEqual(p.get('layout.code'), { a: [1, 2] }); assert.ok(store.has('studio.layout.code'));
  store.set('studio.broken', '{nope'); assert.equal(p.get('broken', 7), 7, 'unreadable: the fallback');
  const full = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } }; const q = new Prefs(full); q.set('a', 1); assert.equal(q.get('a'), 1, 'kept for this page when storage is full');
  const none = new Prefs(null); none.set('b', 2); assert.equal(none.get('b'), 2);
  const throwing = new Prefs({ getItem() { throw new Error('blocked'); }, setItem() {} }); assert.equal(throwing.get('c', 'ok'), 'ok');
});

// ---------- workspaces ----------
test('every workspace is a valid layout of panels the studio has, with every panel in exactly one place', () => {
  assert.ok(WORKSPACES.length >= 2); assert.ok(workspaceById(DEFAULT_WORKSPACE)); assert.equal(workspaceById('nope').id, DEFAULT_WORKSPACE, 'an unknown workspace falls back');
  for (const w of WORKSPACES) {
    const tree = w.layout();
    assert.deepEqual(repair(structuredClone(tree), PANEL_IDS), tree, `${w.id}: a layout that repair would change is not a valid layout`);
    assert.deepEqual([...panelIds(tree)].sort(), [...PANEL_IDS].sort(), `${w.id} shows every panel exactly once`);
    assert.ok(w.title && w.description.length > 20);
    const ids = [...walk(tree)].map((n) => n.id); assert.equal(new Set(ids).size, ids.length, `${w.id}: ids are unique`);
  }
  assert.notDeepEqual(WORKSPACES[0].layout(), WORKSPACES[1].layout(), 'workspaces differ');
  const a = workspaceById('code').layout(); a.sizes[0] = 0.9; assert.notEqual(workspaceById('code').layout().sizes[0], 0.9, 'each call gives a fresh layout, so changing one does not change the preset');
});

// ---------- code colouring ----------
test('the highlighter colours keywords, strings, numbers, calls and comments, and carries block comments and template strings across lines', () => {
  const colour = (line, state = 0) => highlightLine(line, state);
  assert.match(colour('const x = 5;').html, /<span class="k">const<\/span> x = <span class="n">5<\/span>;/);
  assert.match(colour("return f('a');").html, /<span class="k">return<\/span> <span class="f">f<\/span>\(<span class="s">'a'<\/span>\);/);
  assert.match(colour('x // note').html, /<span class="c">\/\/ note<\/span>/);
  assert.match(colour('a < b && c > d').html, /a &lt; b &amp;&amp; c &gt; d/, 'angle brackets and ampersands are escaped: code can never become markup');
  assert.ok(!colour('<img src=x onerror=alert(1)>').html.includes('<img'), 'text that looks like a tag stays text');
  const open = colour('x /* start'); assert.equal(open.state, 1); const inside = colour('still inside', 1); assert.equal(inside.state, 1); assert.match(inside.html, /class="c"/);
  const closed = colour('end */ y', 1); assert.equal(closed.state, 0); assert.match(closed.html, /<span class="c">end \*\/<\/span> y/);
  assert.equal(colour('const t = `a').state, 2); assert.equal(colour('b`;', 2).state, 0); assert.equal(colour('"a`b"').state, 0, 'a backtick inside a string does not open a template');
  assert.equal(colour("'it\\'s'").state, 0); assert.match(colour('x'.repeat(5) + ' 3.14e2').html, /<span class="n">3\.14e2<\/span>/);
  assert.equal(colour('').html, ''); assert.equal(colour('', 1).state, 1);
});
