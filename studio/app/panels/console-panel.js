// The Console panel: what the studio and the game have to say. Errors name the file and line; click one to jump there.
import { h, button, fill } from '../ui/dom.js';

const time = (t) => new Date(t).toTimeString().slice(0, 8);

export function consolePanel(studio) {
  return {
    id: 'console',
    title: 'Console',
    icon: 'warning',
    create() {
      const log = h('div', { class: 'log', role: 'log', tabIndex: 0, aria: { label: 'Messages', live: 'polite', relevant: 'additions' } });
      const caption = h('span', { class: 'grow', text: 'Messages from the studio and your game', style: { color: 'var(--dim)', fontSize: '12px' } });
      const toolbar = h('div', { class: 'toolbar' }, caption,
        button({ label: 'Clear messages', text: 'Clear', class: 'small ghost', onClick: () => studio.clearConsole() }));
      const el = h('div', { class: 'panel-body', 'aria-label': 'Console' }, toolbar, log);

      const line = (e) => h('div', { class: `line ${e.level}`, dataset: { level: e.level } },
        h('span', { class: 'when', text: `${time(e.at)}  ` }),
        e.text,
        e.file ? [' ', place(e)] : null,
        e.hint ? h('div', { class: 'hint', text: e.hint }) : null);

      const place = (e) => h('button', {
        type: 'button', class: 'link', text: `${e.file}:${e.line ?? 1}`, title: 'Show this place in the code',
        on: { click: () => studio.goto(e.file, e.line, e.column) },
      });

      studio.on('console', (entry) => {
        const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
        if (entry === null) fill(log);
        else {
          log.append(line(entry));
          while (log.children.length > 500) log.firstChild.remove();
        }
        if (atBottom) log.scrollTop = log.scrollHeight;
      });
      fill(log, studio.entries.map(line));
      return { el, focus: () => log.focus() };
    },
  };
}
