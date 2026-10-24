// The menu bar: File, Edit, View, Run, Help. It is built from commands, so a menu item and its shortcut, its search entry and its enabled state can never
// disagree. Menus open with a click or Alt+letter... and work completely from the keyboard (arrows, Enter, Esc).
import { h } from './dom.js';

/** @typedef {{label: string, items: (string | 'separator')[]}} MenuDef  items are command ids */

export class Menubar {
  /** @param {HTMLElement} root @param {import('../core/commands.js').CommandRegistry} commands @param {MenuDef[]} menus */
  constructor(root, commands, menus) {
    this.root = root;
    this.commands = commands;
    this.menus = menus;
    this.open = null;
    root.setAttribute('role', 'menubar');
    root.setAttribute('aria-label', 'Menu');
    this.buttons = menus.map((m, i) => h('button', {
      type: 'button', text: m.label, role: 'menuitem', aria: { haspopup: 'menu', expanded: false },
      on: {
        click: () => this.toggle(i),
        mouseenter: () => { if (this.open !== null && this.open !== i) this.show(i); },
        keydown: (e) => this.#barKey(e, i),
      },
    }));
    root.append(...this.buttons);
    document.addEventListener('mousedown', (e) => {
      if (this.open !== null && !this.popup?.contains(e.target) && !root.contains(e.target)) this.close();
    });
  }

  toggle(i) { if (this.open === i) this.close(); else this.show(i); }

  show(i, { focusFirst = false } = {}) {
    this.close(false);
    this.open = i;
    const button = this.buttons[i];
    button.setAttribute('aria-expanded', 'true');
    const rect = button.getBoundingClientRect();
    this.popup = h('div', {
      class: 'menu', role: 'menu', aria: { label: this.menus[i].label }, style: { left: `${rect.left}px`, top: `${rect.bottom + 2}px` },
    });
    for (const id of this.menus[i].items) {
      if (id === 'separator') { this.popup.append(h('hr')); continue; }
      const c = this.commands.get(id);
      if (!c) continue;
      const enabled = !c.enabled || c.enabled();
      this.popup.append(h('button', {
        type: 'button', role: 'menuitem', disabled: !enabled, dataset: { command: id },
        on: {
          click: () => { this.close(); this.commands.execute(id).catch((e) => this.commands.emit('error', e, id)); },
          keydown: (e) => this.#itemKey(e),
        },
      }, h('span', { text: c.title }), h('kbd', { text: this.commands.shortcutLabel(id), hidden: !this.commands.shortcutOf(id) })));
    }
    document.body.append(this.popup);
    if (focusFirst) this.popup.querySelector('button:not(:disabled)')?.focus();
  }

  close(restore = true) {
    if (this.open === null) return;
    this.buttons[this.open].setAttribute('aria-expanded', 'false');
    this.popup?.remove();
    this.popup = null;
    const was = this.open;
    this.open = null;
    if (restore) this.buttons[was]?.focus();
  }

  #barKey(e, i) {
    const n = this.menus.length;
    if (e.key === 'ArrowRight') { e.preventDefault(); this.#moveBar((i + 1) % n); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); this.#moveBar((i - 1 + n) % n); }
    else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.show(i, { focusFirst: true }); }
    else if (e.key === 'Escape') this.close();
  }

  #moveBar(j) {
    const wasOpen = this.open !== null;
    this.buttons[j].focus();
    if (wasOpen) this.show(j, { focusFirst: true });
  }

  #itemKey(e) {
    const items = [...this.popup.querySelectorAll('button:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      this.#moveBar((this.open + (e.key === 'ArrowRight' ? 1 : this.menus.length - 1)) % this.menus.length);
    }
    else if (e.key === 'Tab') this.close(false);
  }
}
