// The Story panel: write dialogue and branching stories as plain text, and see them as a map. Each node is a scene of talk; arrows show where choices and <<goto>>s lead. Pick a
// node to write it, and the panel checks the whole story as you type (a node nothing leads to, a <<goto>> to nowhere, a variable that is asked about and never set). The preview
// plays the real story with the real dialogue box. "Send the lines to the Text panel" gives every line a key so it can be translated. Kept in `src/dialogue.js`.
import { h, button, fill } from '../ui/dom.js';
import { promptText } from '../ui/dialog.js';
import * as M from '../paint/story-model.js';
import { story as readStory, startStory, stepStory, drawStory, storyActive, takeStoryCommands } from '../../../packages/arcade/src/story.js';
import { label } from '../../../packages/arcade/src/draw.js';

const FILE = 'src/dialogue.js';
const SVG = 'http://www.w3.org/2000/svg';
const VIEW = { w: 480, h: 320 };
const HINT = 'Write a conversation or a branching story as plain text. Start from a small example and change it. '
  + 'Each line can be translated later from the Text panel.';
const CHEAT = [
  '== name ==                       a node (the first is "start")',
  'Sam: Hello!                      a line  (Speaker: is optional)',
  '-> Yes                           a choice; indent what follows',
  '<<set trust += 1>>               a number the story remembers',
  '<<if trust > 2>> ... <<else>> ... <<endif>>',
  '<<goto other>>   <<do open-door>>   <<end>>',
  'A line can end with #name: its key for translation',
  'Words can show a number: You have {trust}',
].join('\n');

const svg = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
};

export function storyPanel(studio) {
  return {
    id: 'story',
    title: 'Story',
    icon: 'edit',
    create() {
      let model = null;                                  // { preamble, nodes } or null when there is no file
      let parsed = null;
      let selected = null;
      let lastWritten = '';
      let saveTimer = 0;
      let restartTimer = 0;
      let problem = '';
      let game = {};
      const held = new Set();
      const tapped = new Set();
      let mouse = null;
      let timer = 0;
      let asked = [];

      const toolbar = h('div', { class: 'toolbar art-bar' });
      const graph = h('div', { class: 'story-graph' });
      const editor = h('div', { class: 'story-editor' });
      const issues = h('details', { class: 'art-help text-issues' }, h('summary'), h('ul'));
      const view = h('canvas', {
        width: VIEW.w, height: VIEW.h, class: 'particle-view', tabindex: '0',
        aria: { label: 'Preview of the story. Press Enter to go on, the arrow keys or number keys to choose.' },
      });
      const readout = h('div', { class: 'dim particle-count', role: 'status' });
      const empty = h('div', { class: 'empty' });
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code' }));
      const body = h('div', { class: 'story-body' }, h('div', { class: 'story-left' }, graph, editor), h('div', { class: 'particle-left' }, view,
        readout));
      const el = h('div', { class: 'panel-body art story', 'aria-label': 'Story' }, toolbar, body, issues, help, empty);
      const text = () => M.joinNodes(model);

      // ---- the file ----
      function load() {
        problem = '';
        const raw = studio.project?.has(FILE) ? studio.project.readText(FILE) : null;
        lastWritten = raw ?? '';
        try { model = raw ? M.splitNodes(M.parseStoryFile(raw)) : null; } catch (error) { model = null; problem = error.message; }
        if (model && !model.nodes.some((n) => n.name === selected)) selected = model.nodes[0]?.name ?? null;
        reparse();
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project || problem || !model) return;
        const out = M.serializeStoryFile(text());
        if (out === lastWritten) return;
        lastWritten = out;
        studio.project.write(FILE, out);
        studio.emit('files');
      }
      const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300); };
      function reparse() {
        if (!model) { parsed = null; return; }
        parsed = M.parseStory(text());
        readStory(text());
      }
      function change(next, { redraw = true, restart = true } = {}) {
        model = next;
        reparse();
        save();
        if (redraw) draw(); else { drawGraph(); drawIssues(); }
        if (restart) { clearTimeout(restartTimer); restartTimer = setTimeout(play, 350); }
      }

      // ---- the preview: the real story ----
      function play() {
        if (!parsed) return;
        readStory(text());
        game = { score: 0 };
        asked = [];
        startStory(game, parsed.nodes[selected] ? selected : 'start');
      }
      function tick() {
        if (!el.isConnected || !el.offsetParent || !model) return;
        const m = mouse;
        mouse = null;
        if (storyActive(game)) stepStory(game, new Set([...held, ...tapped]), m, 1 / 60);
        tapped.clear();
        for (const c of takeStoryCommands(game)) asked.push(`${c.name}${c.args.length ? ` ${c.args.join(' ')}` : ''}`);
        paint();
      }
      function paint() {
        const g = view.getContext('2d');
        g.fillStyle = '#12161f';
        g.fillRect(0, 0, VIEW.w, VIEW.h);
        label(g, 'Your game is here.', 12, 24, { size: 14, color: '#5b6378' });
        if (storyActive(game)) drawStory(g, game, { size: { width: VIEW.w, height: VIEW.h } });
        else label(g, 'The story is over. Press "Play again".', VIEW.w / 2, VIEW.h / 2, { size: 14, align: 'center', color: '#9aa3b5' });
        const vars = Object.entries(game.story?.vars ?? {}).map(([k, v]) => `${k} = ${v}`).join(', ');
        readout.textContent = `${vars || 'No numbers yet.'}${asked.length ? `   The story asked the game to: ${asked.slice(-4).join(', ')}.` : ''}`;
      }
      view.addEventListener('keydown', (e) => {
        if (['ArrowUp', 'ArrowDown', 'Space', 'Enter'].includes(e.code)) e.preventDefault();
        held.add(e.code);
        tapped.add(e.code);
      });
      view.addEventListener('keyup', (e) => { held.delete(e.code); });
      view.addEventListener('blur', () => { held.clear(); });
      view.addEventListener('pointerdown', () => { view.focus(); mouse = { x: 0, y: 0, clicked: true }; });

      // ---- the map ----
      function drawGraph() {
        if (!parsed) { fill(graph); return; }
        const layout = M.layoutGraph(parsed);
        const bad = new Set(M.storyProblems(parsed).filter((p) => p.node).map((p) => p.node));
        const arrows = layout.arrows.map((a) => {
          const x1 = a.from[0] + M.BOX.w;
          const y1 = a.from[1] + M.BOX.h / 2;
          const x2 = a.to[0];
          const y2 = a.to[1] + M.BOX.h / 2;
          const back = x2 <= x1;
          const mid = back ? [Math.max(x1, x2) + 30, (y1 + y2) / 2 - 40] : [(x1 + x2) / 2, (y1 + y2) / 2];
          const path = back ? `M${x1},${y1} Q${mid[0]},${mid[1]} ${x2},${y2}` : `M${x1},${y1} Q${mid[0]},${y1} ${x2},${y2}`;
          return svg('path', { d: path, class: 'story-arrow', 'marker-end': 'url(#story-arrow)' }, a.label ? svg('title', {}, a.label) : null);
        });
        const nodes = parsed.order.map((name) => {
          const [x, y] = layout.at[name];
          const s = M.summarizeNode(parsed, name);
          const title = svg('text', { x: x + 10, y: y + 20, class: 'node-name' });
          title.textContent = name;
          const sub = svg('text', { x: x + 10, y: y + 38, class: 'node-sub' });
          sub.textContent = `${s.lines} line${s.lines === 1 ? '' : 's'}${s.choices ? ` · ${s.choices} choice${s.choices === 1 ? '' : 's'}` : ''}`;
          return svg('g', {
            class: `node${name === selected ? ' on' : ''}${bad.has(name) ? ' bad' : ''}`, 'data-node': name, tabindex: '0', role: 'button',
              'aria-label': `Node ${name}${bad.has(name) ? ', has a problem' : ''}`,
          }, svg('rect', { x, y, width: M.BOX.w, height: M.BOX.h, rx: 8 }), title, sub);
        });
        const marker = svg('defs', {}, svg('marker', { id: 'story-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7,
          orient: 'auto' }, svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrow-head' })));
        fill(graph, svg('svg', { viewBox: `0 0 ${layout.width} ${layout.height}`, width: layout.width, height: layout.height, class: 'state-svg',
          role: 'group', 'aria-label': 'Map of the story' }, marker, ...arrows, ...nodes));
      }
      graph.addEventListener('click', (e) => pick(e));
      graph.addEventListener('keydown', (e) => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); pick(e); } });
      function pick(e) {
        const node = e.target.closest?.('[data-node]');
        if (!node) return;
        selected = node.dataset.node;
        drawGraph();
        drawEditor();
        play();
      }

      // ---- writing a node ----
      function drawEditor() {
        const node = model.nodes.find((n) => n.name === selected);
        if (!node) { fill(editor, h('p', { class: 'dim', text: 'Pick a node in the map to write it.' })); return; }
        const area = h('textarea', {
          class: 'story-text', rows: '10', spellcheck: false, value: node.body, aria: { label: `Words of the node ${node.name}` },
          on: { input: (e) => change(M.setBody(model, node.name, e.target.value), { redraw: false }) },
        });
        fill(editor, h('div', { class: 'state-line' }, h('h4', {}, 'Node ', h('code', { text: node.name })),
          button({ text: 'Play from here', class: 'small primary', onClick: () => { play(); view.focus(); } }),
          button({ text: 'Rename', class: 'small ghost', onClick: rename }), button({ text: 'Delete', class: 'small ghost', onClick: remove })),
        area, h('details', { class: 'art-help' }, h('summary', { text: 'The story language' }), h('pre', { class: 'learn-code', text: CHEAT })));
      }
      function drawIssues() {
        if (!parsed) { issues.hidden = true; return; }
        const found = M.storyProblems(parsed);
        issues.hidden = !found.length;
        issues.querySelector('summary').textContent = `${found.length} thing${found.length === 1 ? '' : 's'} to look at`;
        fill(issues.querySelector('ul'), ...found.map((p) => h('li', { class: 'text-missing',
          text: `${p.node ? `${p.node}${p.line ? ` (line ${p.line})` : ''}: ` : p.line ? `Line ${p.line}: ` : ''}${p.message}` })));
      }

      // ---- the parts ----
      function draw() {
        const has = Boolean(model);
        const lines = parsed ? M.linesForTable(parsed).length : 0;
        fill(toolbar, has ? [button({ text: 'Add a node', icon: 'plus', class: 'small primary', onClick: add }),
          button({ text: 'Play again', class: 'small', onClick: () => { play(); view.focus(); } }),
          button({ text: `Send the ${lines} lines to the Text panel`, class: 'small', title: 'Give every line a key so it can be translated',
            onClick: sendLines })] : null);
        body.hidden = !has;
        help.hidden = !has;
        empty.hidden = has;
        if (!has) {
          issues.hidden = true;
          fill(empty, h('h3', { text: problem ? 'The story file needs fixing' : 'No story yet' }), h('p', { text: problem || HINT }),
            problem ? null : button({ text: 'Start a story', class: 'primary', onClick: start }));
          return;
        }
        drawGraph();
        drawEditor();
        drawIssues();
        help.querySelector('pre').textContent = [
          "import dialogue from './dialogue.js';",
          "import { story, startStory, stepStory, drawStory, storyActive, takeStoryCommands } from '@engine/arcade';",
          '',
          'story(dialogue);                       // once: reads the story',
          "startStory(game, 'start');             // when the talk begins",
          'if (storyActive(game)) stepStory(game, keys, mouse, dt);   // in update',
          'if (storyActive(game)) drawStory(g, game);                 // in render',
          "for (const c of takeStoryCommands(game)) { /* c.name is what <<do ...>> asked for */ }",
        ].join('\n');
        paint();
      }
      function start() {
        model = M.splitNodes(M.STARTER);
        selected = 'start';
        reparse();
        flush();
        draw();
        play();
      }
      async function add() {
        const name = await promptText({
          title: 'Name the node', label: 'Name (for example cave or ending-good)', confirmLabel: 'Add it', validate: (v) => M.nameProblem(model,
            v.trim()),
        });
        if (name === undefined) return;
        selected = name.trim();
        change(M.addNode(model, selected));
      }
      async function rename() {
        const to = await promptText({
          title: 'Rename the node', label: 'New name', value: selected, confirmLabel: 'Rename',
            validate: (v) => (v.trim() === selected ? null : M.nameProblem(model, v.trim())),
        });
        if (to === undefined || to.trim() === selected) return;
        const from = selected;
        selected = to.trim();
        change(M.renameNode(model, from, selected));
      }
      function remove() {
        const gone = selected;
        selected = model.nodes.find((n) => n.name !== gone)?.name ?? null;
        change(M.removeNode(model, gone));
      }
      function sendLines() {
        try {
          const raw = studio.project.has('src/text.js') ? studio.project.readText('src/text.js') : null;
          const out = M.addLinesToTextFile(raw, parsed);
          studio.project.write('src/text.js', out.text);
          studio.emit('files');
          const plural = out.added === 1 ? '' : 's';
          const said = out.added ? `Added ${out.added} line${plural} to ${out.language} in src/text.js.` : 'Every line is in the Text panel already.';
          studio.toasts.show(said, { kind: 'success' });
        } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); }
      }

      timer = setInterval(tick, 1000 / 60);
      studio.on('file-changed', (e) => { if (e.path === FILE && studio.project?.readText(FILE) !== lastWritten) load(); });
      studio.on('project', load);
      studio.on('files', () => { if (!studio.project?.has(FILE) && !model) load(); });
      load();
      return { el, focus: () => toolbar.querySelector('button')?.focus(), onShow: load,
        dispose: () => { clearInterval(timer); clearTimeout(restartTimer); flush(); } };
    },
  };
}
