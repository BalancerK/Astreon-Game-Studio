// The History panel: restore points. The studio keeps one by itself every few minutes of work; you can add your own. Going back is never a risk: what you have
// now is kept as a restore point first.
import { h, icon, fill, button, when } from '../ui/dom.js';
import { confirm } from '../ui/dialog.js';

export function historyPanel(studio) {
  return {
    id: 'history',
    title: 'History',
    icon: 'history',
    create() {
      const list = h('div', { class: 'list', role: 'list', aria: { label: 'Restore points' } });
      const toolbar = h('div', { class: 'toolbar' },
        button({
          label: 'Save a restore point now', text: 'Save restore point', icon: 'plus', class: 'small',
          onClick: () => studio.commands.execute('history.save'),
        }));
      const el = h('div', { class: 'panel-body', 'aria-label': 'History' }, toolbar, list);
      let token = 0;
      const open = new Set();

      async function render() {
        const mine = ++token;
        const p = studio.project;
        if (!p) { fill(list, h('div', { class: 'empty', text: 'Open a project to see its history.' })); return; }
        const snaps = await p.snapshots();
        if (mine !== token) return;
        if (!snaps.length) {
          const hint = 'The studio makes one every few minutes while you work. You can also save one now.';
          fill(list, h('div', { class: 'empty' }, h('h3', { text: 'No restore points yet' }), h('p', { text: hint })));
          return;
        }
        const rows = [];
        for (const s of snaps) {
          const diff = open.has(s.id) ? await p.diffAgainst(s.id).catch(() => null) : null;
          rows.push(h('div', { role: 'listitem' },
            h('div', { class: 'row', tabIndex: 0, on: { keydown: (e) => { if (e.key === 'Enter') toggle(s.id); } } },
              icon('history', 14),
              h('span', { class: 'name', text: s.label || 'Saved' }),
              s.auto ? h('span', { class: 'badge auto', text: 'automatic' }) : null,
              h('span', { class: 'meta', text: when(s.createdAt) }),
              h('span', { class: 'actions', style: { opacity: '1' } },
                button({ text: open.has(s.id) ? 'Hide changes' : 'Changes', class: 'small ghost', onClick: () => toggle(s.id) }),
                button({ text: 'Restore', class: 'small', onClick: () => restore(s) }))),
            diff ? h('div', { class: 'meta', style: { padding: '2px 34px 8px', fontSize: '12px', color: 'var(--dim)' } }, describe(diff)) : null));
        }
        fill(list, rows);
      }

      const describe = (d) => {
        const parts = [];
        if (d.changed.length) parts.push(`changed since: ${d.changed.join(', ')}`);
        if (d.added.length) parts.push(`new since: ${d.added.join(', ')}`);
        if (d.removed.length) parts.push(`deleted since: ${d.removed.join(', ')}`);
        return parts.length ? parts.join(' · ') : 'The project is the same as this restore point.';
      };
      const toggle = (id) => { if (open.has(id)) open.delete(id); else open.add(id); render(); };
      const restore = async (s) => {
        const ok = await confirm({
          title: 'Go back to this restore point?', confirmLabel: 'Go back',
          message: `Your files will become what they were ${when(s.createdAt)}. `
            + 'What you have now is saved as a restore point first, so you can come back.',
        });
        if (ok) studio.restoreSnapshot(s.id).catch((e) => studio.toasts.show(`Could not go back: ${e.message}`, { kind: 'error' }));
      };

      for (const ev of ['project', 'snapshots']) studio.on(ev, render);
      let later = 0;
      studio.on('save-state', (s) => { if (s === 'saved') { clearTimeout(later); later = setTimeout(render, 600); } });
      render();
      return { el, focus: () => (list.querySelector('.row') ?? list).focus() };
    },
  };
}
