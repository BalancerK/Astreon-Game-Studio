// A studio plugin: finds the TODO, FIXME and HACK notes you left in your code and lists them in one place, with the file and line, live as you type. It may only read
// your files (the one permission it asks for); it cannot change anything.
export const manifest = {
  "id": "todo-finder",
  "name": "TODO finder",
  "version": "1.0.0",
  "description": "Lists every TODO, FIXME and HACK comment in your code, with the file and line.",
  "permissions": ["files.read"],
  "panels": [{ "id": "found", "title": "TODOs" }],
  "commands": [{ "id": "scan", "title": "Look for TODOs again" }]
};

export default function activate(studio) {
  let render = () => {};
  const NOTE = /(TODO|FIXME|HACK)\b:?\s*(.*)/;

  async function scan() {
    const found = [];
    for (const path of await studio.files.list()) {
      if (!/\.(js|json|md|html|css)$/.test(path)) continue;
      const lines = (await studio.files.read(path)).split('\n');
      lines.forEach((line, i) => {
        const m = NOTE.exec(line);
        if (m && /\/\/|\/\*|#|<!--/.test(line.slice(0, m.index))) found.push({ path, line: i + 1, kind: m[1], text: m[2].replace(/\*\/|-->/g, '').trim().slice(0, 120) });
      });
    }
    return found;
  }

  studio.panel(async (root) => {
    root.innerHTML = '<h3>TODOs</h3><p class="dim" id="summary">Looking…</p><ul id="list" style="padding-left:1.2em"></ul>';
    render = async () => {
      const found = await scan();
      root.querySelector('#summary').textContent = found.length ? found.length + ' note' + (found.length === 1 ? '' : 's') + ' in your code.' : 'No TODOs. Nice and tidy.';
      root.querySelector('#list').replaceChildren(...found.map((f) => {
        const li = document.createElement('li');
        const where = document.createElement('code');
        where.textContent = f.path + ':' + f.line;
        li.append(where, ' ' + f.kind + ' ' + f.text);                  // text, never markup: a comment cannot become code
        return li;
      }));
    };
    await render();
    studio.on('files-changed', () => render());
  });

  studio.command('scan', async () => {
    await render();
    studio.ui.toast('Looked through your files again.', 'success');
  });
}
