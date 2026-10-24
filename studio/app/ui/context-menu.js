// A small pop-up menu at a place on the screen (a right click on a tab, a press of the menu key, a click on a breadcrumb): items you can choose with the mouse or
// with the arrow keys and Enter, and Escape (or a click anywhere else) closes it and gives the focus back to where it was.
import { h } from './dom.js';

let open = null;

/** Close the menu that is showing, if any. */
export function closeContextMenu() { open?.close(); }

/**
 * @param {{x: number, y: number}} at where to put it (the top left corner; it is moved to stay on the screen)
 * @param {({label: string, run?: () => void, disabled?: boolean, checked?: boolean, hint?: string} | 'separator')[]} items
 * @param {{label?: string, restore?: HTMLElement | null}} [o]
 */
export function openContextMenu(at, items, { label = 'Menu', restore = document.activeElement } = {}) {
  closeContextMenu();
  const menu = h('div', { class: 'menu context-menu', role: 'menu', aria: { label }, style: { left: '0px', top: '0px', visibility: 'hidden' } });
  const buttons = [];
  for (const item of items) {
    if (item === 'separator') { menu.append(h('hr')); continue; }
    const b = h('button', {
      type: 'button', role: item.checked === undefined ? 'menuitem' : 'menuitemcheckbox', disabled: !!item.disabled, tabIndex: -1,
      aria: item.checked === undefined ? {} : { checked: item.checked },
      on: { click: () => { close(false); item.run?.(); } },
    }, h('span', { text: `${item.checked ? '✓ ' : ''}${item.label}` }), item.hint ? h('kbd', { text: item.hint }) : null);
    buttons.push(b);
    menu.append(b);
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(at.x, innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(at.y, innerHeight - r.height - 4))}px`;
  menu.style.visibility = '';
  const enabled = () => buttons.filter((b) => !b.disabled);
  const onKey = (e) => {
    const list = enabled();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list.at(-1)?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close(false);
  };
  const onOutside = (e) => { if (!menu.contains(e.target)) close(false); };
  menu.addEventListener('keydown', onKey);
  setTimeout(() => addEventListener('pointerdown', onOutside, true), 0);
  const blur = () => close(false);
  addEventListener('blur', blur);
  function close(focusBack) {
    if (open?.menu !== menu) return;
    open = null;
    removeEventListener('pointerdown', onOutside, true);
    removeEventListener('blur', blur);
    menu.remove();
    if (focusBack) restore?.focus?.();
  }
  open = { menu, close: () => close(true) };
  enabled()[0]?.focus();
  return { close: () => close(true) };
}
