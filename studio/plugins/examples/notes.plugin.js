// A studio plugin: a notepad panel that remembers what you write, for ideas, a to-do for tomorrow, or the name of the boss you keep forgetting.
// It asks for no permissions, so it cannot see your project: it only keeps its own text (`studio.state`), saved as you type.
export const manifest = {
  "id": "notepad",
  "name": "Notepad",
  "version": "1.0.0",
  "description": "A place to write ideas down. It remembers what you wrote.",
  "permissions": [],
  "panels": [{ "id": "main", "title": "Notepad" }]
};

export default function activate(studio) {
  studio.panel(async (root) => {
    const saved = await studio.state.get();
    root.innerHTML = '<h3>Notepad</h3><textarea id="pad" rows="12" style="width:100%;box-sizing:border-box" aria-label="Notes" placeholder="Ideas, bugs, things to try…"></textarea><p class="dim" id="count"></p>';
    const pad = root.querySelector('#pad');
    const count = root.querySelector('#count');
    pad.value = saved.text ?? '';
    const show = () => { count.textContent = pad.value.trim() ? pad.value.trim().split(/\s+/).length + ' words' : 'Empty.'; };
    let timer = 0;
    pad.addEventListener('input', () => {
      show();
      clearTimeout(timer);
      timer = setTimeout(() => studio.state.set({ text: pad.value }), 400);       // saved a moment after you stop typing
    });
    show();
  });
}
