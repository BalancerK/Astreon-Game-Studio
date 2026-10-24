// The starting point for "Start a new plugin": a panel with a button and a counter, small enough to read in a minute. The text is written into the project as
// `plugins/my-panel.plugin.js`, so the plugin can be edited in the studio like any other file and installed again to see a change.

export const TEMPLATE_PATH = 'plugins/my-panel.plugin.js';

export const TEMPLATE = `// A studio plugin. It runs in a closed box: it can show a panel and ask the studio for the things listed in "permissions", and nothing else.
// Change something, then use "Install from this project" in the Plugins panel to see it.
export const manifest = {
  "id": "my-panel",
  "name": "My panel",
  "version": "0.1.0",
  "description": "A panel I made.",
  "permissions": [],
  "panels": [{ "id": "main", "title": "My panel" }]
};

export default function activate(studio) {
  studio.panel(async (root) => {
    const saved = await studio.state.get();          // what this plugin kept last time
    let clicks = saved.clicks ?? 0;
    root.innerHTML = '<h3>My panel</h3><p id="count"></p><button id="go" class="primary">Click me</button>';
    const show = () => { root.querySelector('#count').textContent = 'Clicked ' + clicks + ' times.'; };
    root.querySelector('#go').addEventListener('click', async () => {
      clicks++;
      show();
      await studio.state.set({ clicks });            // kept for next time
    });
    show();
  });
}
`;
