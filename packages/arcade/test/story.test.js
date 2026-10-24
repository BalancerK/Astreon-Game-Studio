import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  story, parseStory, storyProblems, startStory, storyState, advanceStory, chooseStory, storyVar, setStoryVar, takeStoryCommands, storyActive, stepStory, drawStory,
  parseExpression, evaluate,
} from '../src/story.js';
import { text } from '../src/text.js';
import { settings, setSetting, resetForTests } from '../src/settings.js';
import { setProgressHost } from '../src/progress.js';

beforeEach(() => {
  resetForTests();
  setProgressHost({ send: () => {}, initial: null });
  settings();
  text({}, 'en');
});

const SAMPLE = `
// a small story
== start ==
Sam: Hello there! Have you seen my key?
-> Yes, here it is.
    Sam: Thank you!
    <<set trust += 1>>
    <<goto thanks>>
-> No.
    Sam: Oh dear.
-> I will not say. <<if trust > 2>>
    Sam: You are a good friend.
<<do open-door gate 2>>
Sam: Come in, then. You have {trust} trust.
== thanks ==
Sam: I will remember this. #line:thanks-1
<<end>>
`;

/** Play the story to the end, always picking `pick` (a function of the choices), and give back what was said. */
function playOut(game, pick = () => 0, limit = 50) {
  const said = [];
  for (let i = 0; i < limit && storyActive(game); i++) {
    const s = storyState(game);
    if (s.choices) { said.push(`? ${s.choices.map((c) => c.text).join(' | ')}`); chooseStory(game, pick(s.choices)); } else { if (s.line) said.push(s.line.speaker ? `${s.line.speaker}: ${s.line.text}` : s.line.text); advanceStory(game); }
  }
  return said;
}

test('expressions: numbers, words, comparisons, and, or, not, brackets, missing variables count as 0 or off', () => {
  const ev = (src, vars = {}) => evaluate(parseExpression(src), vars);
  assert.equal(ev('1 + 2 * 3'), 7);
  assert.equal(ev('(1 + 2) * 3'), 9);
  assert.equal(ev('coins > 2', { coins: 3 }), true);
  assert.equal(ev('coins > 2'), false, 'missing is 0');
  assert.equal(ev('coins == 0'), true);
  assert.equal(ev('met and not angry', { met: true, angry: false }), true);
  assert.equal(ev('a or b', { a: false, b: true }), true);
  assert.equal(ev('name == "Sam"', { name: 'Sam' }), true);
  assert.equal(ev('!seen'), true);
  assert.equal(ev('10 / 4'), 2.5);
  assert.equal(ev('10 / 0'), 0, 'dividing by zero does not crash');
  assert.equal(ev('-3 + 5'), 2);
  assert.equal(ev('"a" + "b"'), 'ab');
  assert.equal(ev('flag', { flag: true }), true);
  assert.equal(ev('x != 1', { x: 2 }), true);
  for (const bad of ['1 +', '(1', '1 2', 'a $ b', '"open']) assert.throws(() => parseExpression(bad), Error, bad);
  assert.throws(() => parseExpression('coins >'), /ends too soon/);
});

test('a story is read into nodes with lines, choices and commands, with ids for every line', () => {
  const p = parseStory(SAMPLE);
  assert.deepEqual(p.order, ['start', 'thanks']);
  assert.deepEqual(p.problems, []);
  assert.ok(p.nodes.start.ids.includes('start.1') && p.nodes.thanks.ids.includes('thanks-1'), 'a tag is the id; otherwise node.number');
  assert.ok(p.edges.some((e) => e.from === 'start' && e.to === 'thanks' && e.label === 'Yes, here it is.'), 'the arrow remembers which choice leads there');
  assert.deepEqual(p.sets, ['trust']);
  assert.ok(p.reads.includes('trust'));
  const ops = p.nodes.start.code.map((c) => c.op);
  assert.equal(ops[0], 'line');
  assert.ok(ops.includes('choice') && ops.includes('do'));
});

test('playing it: lines in order, a choice that sends you elsewhere, commands handed to the game once, variables filled into the words', () => {
  story(SAMPLE);
  const game = {};
  startStory(game, 'start', { trust: 0 });
  assert.equal(storyState(game).line.text, 'Hello there! Have you seen my key?');
  assert.equal(storyState(game).line.speaker, 'Sam');
  advanceStory(game);
  const s = storyState(game);
  assert.deepEqual(s.choices.map((c) => c.text), ['Yes, here it is.', 'No.'], 'the third choice needs trust above 2');
  chooseStory(game, 0);
  assert.equal(storyState(game).line.text, 'Thank you!');
  advanceStory(game);
  assert.equal(storyState(game).line.id, 'thanks-1');
  assert.equal(storyVar(game, 'trust'), 1);
  advanceStory(game);
  assert.equal(storyActive(game), false);
  const again = {};
  startStory(again, 'start', { trust: 3 });
  advanceStory(again);
  assert.equal(storyState(again).choices.length, 3, 'with trust the third choice shows');
  chooseStory(again, 1);
  assert.equal(storyState(again).line.text, 'Oh dear.');
  advanceStory(again);
  assert.deepEqual(takeStoryCommands(again), [{ name: 'open-door', args: ['gate', '2'] }]);
  assert.deepEqual(takeStoryCommands(again), [], 'a command is given once');
  assert.equal(storyState(again).line.text, 'Come in, then. You have 3 trust.');
});

test('conditions in the text: if, elseif, else, endif, nested in choices, and set with every operator', () => {
  const src = `== start ==
<<set n = 5>>
<<set n += 2>>
<<set n -= 1>>
<<set n *= 2>>
<<if n > 100>>
Big
<<elseif n == 12>>
Twelve
<<else>>
Other
<<endif>>
-> pick
    <<if n > 5>>
    Inner yes
    <<else>>
    Inner no
    <<endif>>
Done`;
  assert.deepEqual(parseStory(src).problems, []);
  story(src);
  const said = playOut((() => { const g = {}; startStory(g, 'start'); return g; })());
  assert.deepEqual(said, ['Twelve', '? pick', 'Inner yes', 'Done']);
  const nested = `== start ==
<<if a>>
<<if b>>
AB
<<else>>
A only
<<endif>>
<<else>>
none
<<endif>>`;
  story(nested);
  for (const [vars, expected] of [[{ a: true, b: true }, 'AB'], [{ a: true }, 'A only'], [{}, 'none']]) {
    const g = {};
    startStory(g, 'start', vars);
    assert.equal(storyState(g).line.text, expected);
  }
});

test('goto between nodes and back, a loop with an exit, and a story that ends by running out of lines', () => {
  const src = `== start ==
<<set tries = 0>>
Waiting
<<goto again>>
== again ==
<<set tries += 1>>
<<if tries < 3>>
Try {tries}
<<goto again>>
<<endif>>
Enough`;
  story(src);
  const g = {};
  startStory(g, 'start');
  assert.deepEqual(playOut(g), ['Waiting', 'Try 1', 'Try 2', 'Enough']);
  assert.equal(storyActive(g), false);
});

test('a story that talks to itself forever is stopped with a message instead of freezing the game', () => {
  story('== start ==\n<<goto start>>');
  const g = {};
  startStory(g, 'start');
  assert.equal(storyActive(g), false);
  assert.match(g.story.error, /round and round/);
  story('== start ==\nHi\n<<goto nowhere>>');
  const h = {};
  startStory(h, 'start');
  advanceStory(h);
  assert.match(h.story.error, /no node called "nowhere"/);
});

test('the story state is plain data: copying a half-played game and carrying on gives the same story', () => {
  story(SAMPLE);
  const g = {};
  startStory(g, 'start', { trust: 0 });
  advanceStory(g);
  const copy = JSON.parse(JSON.stringify(g));
  chooseStory(g, 1);
  chooseStory(copy, 1);
  assert.deepEqual(storyState(copy), storyState(g));
  assert.deepEqual(copy.story, g.story);
});

test('words can be translated by line id (story.<id> in the text table) and fall back to the written words', () => {
  story(SAMPLE);
  text({ en: {}, fr: { 'story.thanks-1': 'Je m\'en souviendrai.' } }, 'fr');
  const g = {};
  startStory(g, 'thanks');
  assert.equal(storyState(g).line.text, 'Je m\'en souviendrai.');
  startStory(g, 'start');
  assert.equal(storyState(g).line.text, 'Hello there! Have you seen my key?', 'no French for this line: the written words');
  text({}, 'en');
});

test('the game can read and set the story\'s numbers, and {names} also come from the game itself', () => {
  story('== start ==\nYou have {coins} coins and {lives} lives.\n<<if hasKey>>\nKey!\n<<endif>>');
  const g = { lives: 3 };
  startStory(g, 'start', { coins: 4 });
  assert.equal(storyState(g).line.text, 'You have 4 coins and 3 lives.');
  setStoryVar(g, 'hasKey', true);
  setStoryVar({}, 'x', 1);
  assert.equal(storyVar(g, 'hasKey'), true);
  assert.equal(storyVar({}, 'x'), undefined);
  assert.deepEqual(storyState({}), { line: null, choices: null, ended: true, node: '' });
});

test('problems are found with the line: unknown goto, unreachable node, a typo in a variable, empty nodes, loops, duplicate names and ids, bad commands, unclosed if', () => {
  const src = `== start ==
Hi
<<goto nowhere>>
<<set a = 1>>
<<if a and bb>>
Yes
<<frob>>
<<set>>
<<goto>>
<<endif>>
<<endif>>
Oops #same
Again #same
->
== orphan ==
Alone
== empty ==
== loop ==
<<goto loop>>
== start ==
x
== Bad Name ==
y
`;
  const kinds = storyProblems(parseStory(src)).map((p) => p.kind);
  for (const k of ['goto', 'unreachable', 'variable', 'empty', 'loop', 'duplicate', 'name', 'command', 'endif', 'id', 'choice']) assert.ok(kinds.includes(k), `${k} in ${kinds}`);
  assert.deepEqual(storyProblems(parseStory(SAMPLE)).filter((p) => p.kind !== 'variable'), [], 'the sample is fine (trust is set in the story)');
  assert.ok(storyProblems(parseStory('== other ==\nHi')).some((p) => p.kind === 'start'));
  const outside = parseStory('Hello\n== start ==\nHi');
  assert.equal(outside.problems[0].kind, 'outside');
  assert.equal(outside.problems[0].line, 1);
  assert.ok(parseStory('== start ==\nHi\n<<if x>>\nA').problems.some((p) => /never closed/.test(p.message)));
  assert.equal(story('== start ==\nHi').length, 0);
  assert.ok(story('== start ==\n<<goto nowhere>>').length > 0);
});

test('the dialogue box: Enter first finishes the line being typed, then goes on; arrows and numbers choose; clicks work', () => {
  story(SAMPLE);
  const g = {};
  startStory(g, 'start', { trust: 0 });
  const tick = (...held) => stepStory(g, new Set(held), undefined, 1 / 60);
  tick();
  assert.ok(g.story.shown < 5, 'typing');
  tick('Enter');
  assert.equal(g.story.shown, storyState(g).line.text.length, 'the first Enter shows the whole line');
  assert.equal(storyState(g).choices, null);
  tick();
  tick('Enter');
  assert.ok(storyState(g).choices, 'the second Enter went on to the choices');
  tick();
  tick('ArrowDown');
  tick();
  assert.equal(g.story.focus, 1);
  tick('ArrowUp');
  tick();
  tick('ArrowUp');
  tick();
  assert.equal(g.story.focus, 1, 'up from the first goes round to the last (two choices: 0 -> 1 -> 0 -> 1)');
  tick('Digit1');
  assert.equal(storyState(g).line.text, 'Thank you!', 'the number key chose the first');
  for (let i = 0; i < 200; i++) tick();
  assert.equal(g.story.shown, 'Thank you!'.length, 'a line types itself out over time');
  stepStory(g, new Set(), { clicked: true });
  assert.equal(storyState(g).line.id, 'thanks-1', 'a click goes on');
});

test('the key that began the talk does nothing in it, and a finished story ignores input', () => {
  story('== start ==\nOne\nTwo');
  const g = {};
  startStory(g, 'start');
  stepStory(g, new Set(['Enter']), undefined, 1);          // held from before the talk began: it does nothing
  assert.equal(storyState(g).line.text, 'One');
  stepStory(g, new Set(), undefined, 1);                   // the line finishes typing
  stepStory(g, new Set(['Enter']), undefined, 1);          // a fresh press goes on
  assert.equal(storyState(g).line.text, 'Two');
  stepStory(g, new Set(), undefined, 1);
  stepStory(g, new Set(['Enter']), undefined, 1);
  assert.equal(storyActive(g), false);
  assert.doesNotThrow(() => stepStory(g, new Set(['Enter'])));
  assert.doesNotThrow(() => stepStory({}, new Set(['Enter'])));
});

test('the box is drawn with the speaker, the words so far, the choices, and follows text size and high contrast', () => {
  story(SAMPLE);
  const g = {};
  startStory(g, 'start', { trust: 0 });
  stepStory(g, new Set(), undefined, 1);
  stepStory(g, new Set(), undefined, 1);
  const calls = [];
  const ctx = new Proxy({}, { get: (_, n) => (n === 'measureText' ? (s) => ({ width: String(s).length * 7 }) : (...a) => { calls.push([n, ...a]); }), set: (_, n, v) => { calls.push([`set:${n}`, v]); return true; } });
  drawStory(ctx, g);
  assert.ok(calls.some((c) => c[0] === 'fillText' && c[1] === 'Sam'));
  assert.ok(calls.some((c) => c[0] === 'fillText' && /Hello there/.test(c[1])));
  calls.length = 0;
  setSetting('textScale', 2);
  setSetting('highContrast', true);
  drawStory(ctx, g);
  assert.ok(calls.some((c) => c[0] === 'set:font' && /^32px/.test(c[1])));
  assert.ok(calls.some((c) => c[0] === 'set:fillStyle' && c[1] === '#000000'));
  advanceStory(g);
  stepStory(g, new Set(), undefined, 1);
  calls.length = 0;
  drawStory(ctx, g);
  assert.ok(calls.some((c) => c[0] === 'fillText' && /1\. Yes, here it is\./.test(c[1])));
  assert.doesNotThrow(() => drawStory(ctx, {}));
});

test('big stories stay inside their limits: too long a line is flagged, and many nodes are read', () => {
  const long = `== start ==\n${'x'.repeat(500)}`;
  assert.ok(parseStory(long).problems.some((p) => p.kind === 'long'));
  const many = Array.from({ length: 150 }, (_, i) => `== n${i} ==\nline ${i}\n<<goto n${(i + 1) % 150}>>`).join('\n');
  const p = parseStory(many);
  assert.equal(p.order.length, 150);
  assert.equal(p.edges.length, 150);
  assert.ok(storyProblems(p, 'n0').filter((x) => x.kind === 'unreachable').length === 0);
});
