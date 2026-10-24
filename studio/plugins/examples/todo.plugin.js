// A studio plugin: a to-do list. Add jobs, tick them off, clear the done ones. It remembers the list, and it adds a command, "Add a to-do", to the palette.
// It asks for no permissions: it only keeps its own list (`studio.state`).
export const manifest = {
  "id": "todo-list",
  "name": "To-do list",
  "version": "1.0.0",
  "description": "Jobs for your game: add them, tick them off, and they are still there tomorrow.",
  "permissions": [],
  "panels": [{ "id": "list", "title": "To-do" }],
  "commands": [{ "id": "count", "title": "How many to-dos are left?" }]
};

export default function activate(studio) {
  let jobs = [];
  let draw = () => {};
  const save = () => studio.state.set({ jobs });

  studio.panel(async (root) => {
    jobs = (await studio.state.get()).jobs ?? [];
    root.innerHTML = '<h3>To-do</h3><form id="form"><input id="job" type="text" placeholder="Something to do…" aria-label="New job" style="width:70%"> <button class="primary">Add</button></form><ul id="list" style="list-style:none;padding:0"></ul><button id="clear" class="small">Clear the done ones</button>';
    draw = () => {
      const ul = root.querySelector('#list');
      ul.replaceChildren(...jobs.map((job, i) => {
        const li = document.createElement('li');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = job.done;
        box.setAttribute('aria-label', job.text);
        box.addEventListener('change', () => { jobs[i].done = box.checked; save(); draw(); });
        const label = document.createElement('span');
        label.textContent = ' ' + job.text;                      // text, never markup
        if (job.done) label.style.textDecoration = 'line-through';
        li.append(box, label);
        return li;
      }));
    };
    root.querySelector('#form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = root.querySelector('#job');
      if (input.value.trim()) { jobs.push({ text: input.value.trim().slice(0, 120), done: false }); input.value = ''; save(); draw(); }
    });
    root.querySelector('#clear').addEventListener('click', () => { jobs = jobs.filter((j) => !j.done); save(); draw(); });
    draw();
  });

  studio.command('count', async () => {
    const left = jobs.filter((j) => !j.done).length;
    studio.ui.toast(left ? left + ' to-do' + (left === 1 ? '' : 's') + ' left.' : 'Nothing left to do!', 'info');
  });
}
