// The Inspector panel: everything the game remembers (its state), live. Open things up, change a number or a word and watch the game react; click a thing to
// outline it in the game. Edits are recorded by the Time Machine, so you can go back before them, and a recording made with them replays them.
import { h, fill } from '../ui/dom.js';
import { createStateTree } from '../ui/state-tree.js';

export function inspectPanel(studio) {
  return {
    id: 'inspect',
    title: 'Inspector',
    icon: 'edit',
    create() {
      const hint = 'This is what the game remembers. Change a value to try an idea; click an item to outline it in the game.';
      const note = h('p', { class: 'inspect-note', text: hint });
      const filter = h('input', {
        type: 'search', class: 'inspect-filter', placeholder: 'Find a name or value…', aria: { label: 'Find in the game state' },
      });
      const problem = h('div', { class: 'inspect-problem', role: 'status' });
      const tree = createStateTree({
        onEdit: (path, value) => studio.runner.edit(path, value),
        onSelect: (path) => studio.runner.select(path),
      });
      const el = h('div', { class: 'panel-body inspect', 'aria-label': 'Inspector' }, note, filter, problem, tree.el);
      filter.addEventListener('input', () => tree.setFilter(filter.value));

      function draw() {
        const m = studio.runner.gameState;
        if (!studio.project) { tree.clear(); fill(problem, 'Open a project to inspect its game.'); return; }
        if (!m) { fill(problem, 'Waiting for the game…'); return; }
        if (m.tooBig) {
          tree.clear();
          fill(problem, `The game's state is too big to show (${Math.round(m.bytes / 1000)} KB). `
            + 'Keep what you want to look at small, or in its own list.');
          return;
        }
        if (m.state === undefined || m.state === null) { fill(problem, 'The game has no state yet.'); return; }
        fill(problem);
        tree.update(m.state);
      }

      studio.on('runner-state', draw);
      // a thing clicked in the game: show it here (the Inspector opens if it was closed)
      const reveal = (path) => {
        if (!path) { tree.deselect(); studio.runner.select(null); draw(); return; }
        tree.reveal(path);
      };
      studio.on('picked-in-game', reveal);
      if (studio.pickedInGame) reveal(studio.pickedInGame);
      studio.on('project', () => { tree.deselect(); draw(); });
      draw();
      return { el, focus: () => filter.focus(), onShow: draw };
    },
  };
}
