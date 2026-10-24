// A studio plugin: watches the numbers your running game reports (whatever `summary(game)` returns) and keeps the lowest, highest and latest of each, so you can see
// how far a number went while you were playing. It may only look at the game's numbers (the one permission it asks for).
export const manifest = {
  "id": "score-watch",
  "name": "Number watcher",
  "version": "1.0.0",
  "description": "Shows the lowest, highest and latest of every number your game reports, while you play.",
  "permissions": ["game.read"],
  "panels": [{ "id": "watch", "title": "Numbers" }],
  "commands": [{ "id": "reset", "title": "Reset the number watcher" }]
};

export default function activate(studio) {
  let seen = {};
  let draw = () => {};

  async function sample() {
    const summary = await studio.game.summary();
    for (const [key, value] of Object.entries(summary ?? {})) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const s = seen[key] ?? { low: value, high: value, last: value };
      s.low = Math.min(s.low, value);
      s.high = Math.max(s.high, value);
      s.last = value;
      seen[key] = s;
    }
    draw();
  }

  studio.panel(async (root) => {
    root.innerHTML = '<h3>Numbers</h3><p class="dim" id="note">Run your game: the numbers its summary reports show up here.</p><table><thead><tr><th>Number</th><th class="num">Lowest</th><th class="num">Highest</th><th class="num">Now</th></tr></thead><tbody id="rows"></tbody></table>';
    draw = () => {
      const rows = Object.entries(seen).map(([key, s]) => {
        const tr = document.createElement('tr');
        for (const [text, cls] of [[key, ''], [String(+s.low.toFixed(2)), 'num'], [String(+s.high.toFixed(2)), 'num'], [String(+s.last.toFixed(2)), 'num']]) {
          const td = document.createElement('td');
          td.textContent = text;
          if (cls) td.className = cls;
          tr.append(td);
        }
        return tr;
      });
      root.querySelector('#rows').replaceChildren(...rows);
      root.querySelector('#note').hidden = rows.length > 0;
    };
    setInterval(() => { sample().catch(() => {}); }, 500);
    await sample();
  });

  studio.command('reset', async () => { seen = {}; draw(); studio.ui.toast('Numbers cleared.', 'info'); });
}
