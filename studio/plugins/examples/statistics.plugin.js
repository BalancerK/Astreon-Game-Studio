// A studio plugin: it adds a "Statistics" panel that counts the lines and bytes of every file in your project and updates as you type, a command to refresh
// it, an exporter that gathers all your code into one text file, and an importer that turns any text file into a notes file in a new project.
//
// A plugin is one file. The `manifest` says what it adds and what it needs to be allowed to do (here: only to read your files); `activate` sets it up.
// It runs in a closed box with no network, so the only things it can do are the ones in the manifest.
export const manifest = {
  "id": "statistics",
  "name": "Project statistics",
  "version": "1.0.0",
  "description": "Counts the lines and bytes of every file, live, and can gather all your code into one file.",
  "permissions": ["files.read"],
  "panels": [{ "id": "stats", "title": "Statistics" }],
  "commands": [{ "id": "refresh", "title": "Refresh the statistics" }],
  "exporters": [{ "id": "bundle", "title": "Export all code as one text file" }],
  "importers": [{ "id": "notes", "title": "Import a text file as notes", "accept": ".txt,.md" }]
};

export default function activate(studio) {
  let render = () => {};

  async function measure() {
    const rows = [];
    for (const path of await studio.files.list()) {
      const text = await studio.files.read(path);
      rows.push({ path, lines: text === '' ? 0 : text.split('\n').length, bytes: new TextEncoder().encode(text).length });
    }
    return rows.sort((a, b) => b.bytes - a.bytes);
  }

  studio.panel(async (root) => {
    root.innerHTML = '<h3>Statistics</h3><p class="dim" id="summary">Counting…</p><table><thead><tr><th>File</th><th class="num">Lines</th><th class="num">Bytes</th></tr></thead><tbody id="rows"></tbody></table>';
    render = async () => {
      const rows = await measure();
      root.querySelector('#summary').textContent = `${rows.length} files, ${rows.reduce((n, r) => n + r.lines, 0)} lines, ${rows.reduce((n, r) => n + r.bytes, 0)} bytes`;
      await studio.state.set({ summary: root.querySelector('#summary').textContent });      // kept, so it is there next time
      const body = root.querySelector('#rows');
      body.replaceChildren(...rows.map((r) => {
        const tr = document.createElement('tr');
        for (const [text, cls] of [[r.path, ''], [String(r.lines), 'num'], [String(r.bytes), 'num']]) {
          const td = document.createElement('td');
          td.textContent = text;                                  // text, never markup: a file name cannot become code
          if (cls) td.className = cls;
          tr.append(td);
        }
        return tr;
      }));
    };
    await render();
    studio.on('files-changed', () => render());
  });

  studio.command('refresh', async () => { await render(); studio.ui.toast('Statistics refreshed.', 'success'); });

  studio.exporter('bundle', async () => {
    let all = '';
    for (const path of await studio.files.list()) if (path.endsWith('.js')) all += `// ===== ${path} =====\n${await studio.files.read(path)}\n`;
    return { 'all-code.txt': all };
  });

  studio.importer('notes', async (name, text) => ({ 'notes/imported.md': `# ${name}\n\n${text}\n`, 'src/main.js': 'export function create() { return {}; }\nexport function update() {}\nexport function render() {}\n' }));
}
