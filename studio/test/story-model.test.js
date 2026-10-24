import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../app/paint/story-model.js';
import { parseText } from '../app/paint/text-model.js';
import { startStory, storyState, advanceStory, story as readStory } from '../../packages/arcade/src/story.js';

test('the starter story is clean by the kit\'s own check and plays', () => {
  const parsed = S.parseStory(S.STARTER);
  assert.deepEqual(S.storyProblems(parsed), []);
  assert.deepEqual(parsed.order, ['start', 'thanks']);
  readStory(S.STARTER);
  const g = {};
  startStory(g, 'start');
  assert.match(storyState(g).line.text, /Hello there/);
  advanceStory(g);
  assert.equal(storyState(g).choices.length, 2);
});

test('a story file is saved and read back exactly, even with backslashes, backticks and ${ in it', () => {
  const nasty = 'a `tick` and \\n and ${this} and \\\\ and `` and ${';
  const file = S.serializeStoryFile(`== start ==\n${nasty}`);
  assert.match(file, /^\/\/ Made with the studio/);
  assert.equal(S.parseStoryFile(file), `== start ==\n${nasty}`);
  assert.equal(S.parseStoryFile(S.serializeStoryFile(S.STARTER)), S.STARTER);
  assert.throws(() => S.parseStoryFile('export default 5;'), /not a story/);
  assert.equal(S.parseStoryFile(S.serializeStoryFile('')), '');
  const loaded = new Function(`${file.replace('export default', 'return')}`)();
  assert.equal(loaded, `== start ==\n${nasty}`, 'the file is real JavaScript that gives the same text');
});

test('a story is split into nodes and put back together as the same story, with the comments before the first node kept', () => {
  const model = S.splitNodes(S.STARTER);
  assert.deepEqual(model.nodes.map((n) => n.name), ['start', 'thanks']);
  assert.match(model.preamble, /A story is nodes/);
  assert.match(model.nodes[0].body, /^Sam: Hello there/);
  const again = S.splitNodes(S.joinNodes(model));
  assert.deepEqual(again, model);
  assert.deepEqual(S.parseStory(S.joinNodes(model)).order, ['start', 'thanks']);
  assert.deepEqual(S.splitNodes(''), { preamble: '', nodes: [] });
  assert.equal(S.joinNodes({ preamble: '', nodes: [] }), '\n');
});

test('nodes are added, changed, renamed (with every goto following), removed, and names are checked', () => {
  let m = S.splitNodes(S.STARTER);
  assert.match(S.nameProblem(m, '1x'), /Use letters/);
  assert.match(S.nameProblem(m, 'start'), /already/);
  assert.equal(S.nameProblem(m, 'cave'), null);
  m = S.addNode(m, 'cave');
  assert.equal(m.nodes.at(-1).name, 'cave');
  m = S.setBody(m, 'cave', 'It is dark.\n<<goto start>>');
  assert.equal(S.parseStory(S.joinNodes(m)).problems.length, 0);
  m = S.renameNode(m, 'thanks', 'gratitude');
  assert.ok(m.nodes.some((n) => n.name === 'gratitude'));
  assert.match(m.nodes[0].body, /<<goto gratitude>>/);
  assert.deepEqual(S.storyProblems(S.parseStory(S.joinNodes(m))).filter((p) => p.kind !== 'unreachable'), []);
  const tricky = S.renameNode(S.splitNodes('== start ==\n<<goto a.b>>\n<<goto ab>>\n== a.b ==\nx'), 'a.b', 'c');
  assert.match(tricky.nodes[0].body, /<<goto c>>/);
  assert.match(tricky.nodes[0].body, /<<goto ab>>/, 'only the exact name is changed');
  const gone = S.removeNode(m, 'cave');
  assert.ok(!gone.nodes.some((n) => n.name === 'cave'));
});

test('the graph puts "start" first, nodes one step away next, and nodes nothing leads to in a last column; arrows remember the choice they come from', () => {
  const src = '== start ==\n-> go left\n    <<goto left>>\n-> go right\n    <<goto right>>\n== left ==\nL\n<<goto end>>\n== right ==\nR\n<<goto end>>\n== end ==\nDone\n== lost ==\nNobody comes here';
  const parsed = S.parseStory(src);
  const g = S.layoutGraph(parsed);
  assert.equal(g.at.start[0], 20);
  assert.ok(g.at.left[0] > g.at.start[0] && g.at.left[0] === g.at.right[0]);
  assert.ok(g.at.end[0] > g.at.left[0]);
  assert.ok(g.at.lost[0] > g.at.end[0], 'unreachable nodes go last');
  assert.notEqual(g.at.left[1], g.at.right[1], 'two nodes in a column are not on top of each other');
  assert.equal(g.arrows.length, 4);
  assert.ok(g.arrows.find((a) => a.to === g.at.left).label === 'go left');
  assert.ok(g.width > g.at.lost[0] && g.height > g.at.right[1]);
  assert.deepEqual(S.summarizeNode(parsed, 'start'), { lines: 0, choices: 1, commands: 0 });
  assert.doesNotThrow(() => S.layoutGraph(S.parseStory('')));
  assert.doesNotThrow(() => S.layoutGraph(S.parseStory('== other ==\nHi')));
});

test('every line and choice becomes a key for the Text panel, and adding them keeps what is already translated', () => {
  const parsed = S.parseStory(S.STARTER);
  const lines = S.linesForTable(parsed);
  assert.ok(lines.length >= 5);
  assert.ok(lines.every((l) => l.key.startsWith('story.')));
  assert.ok(lines.some((l) => l.text === 'Yes, here it is.') && lines.some((l) => l.speaker === 'Sam'));
  const first = S.addLinesToTextFile(null, parsed);
  assert.equal(first.language, 'en');
  assert.equal(first.added, lines.length);
  const table = parseText(first.text);
  assert.equal(table.en['story.start.1'], 'Hello there! Have you seen my key?');
  const existing = parseText(first.text);
  existing.en['story.start.1'] = 'Changed';
  existing.fr = { 'story.start.1': 'Bonjour !' };
  const second = S.addLinesToTextFile(`export default ${JSON.stringify(existing)};`, parsed);
  assert.equal(second.added, 0, 'nothing new');
  assert.equal(parseText(second.text).en['story.start.1'], 'Changed');
  assert.equal(parseText(second.text).fr['story.start.1'], 'Bonjour !');
  assert.throws(() => S.addLinesToTextFile('nonsense', parsed), /needs fixing/);
  assert.equal(S.addLinesToTextFile(null, S.parseStory('== start ==\nHi #hello')).text.includes('story.hello'), true, 'a tagged line keeps its own key');
});
