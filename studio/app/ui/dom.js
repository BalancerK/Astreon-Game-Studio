// Building page elements without ever turning text into HTML: names of projects and files come from people (and from zip files), so they are always put in
// with `textContent`, never `innerHTML`.

/**
 * Make an element. Props: `class`, `text`, `style` (an object), `on` (an object of event handlers), `dataset`, `aria` (aria-* attributes), and any attribute
 * or property. Children can be elements, text, arrays or null.
 * @param {string} tag
 * @param {Record<string, any> | null} [props]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'style') Object.assign(el.style, value);
    else if (key === 'on') for (const [ev, fn] of Object.entries(value)) el.addEventListener(ev, fn);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'aria') for (const [name, v] of Object.entries(value)) el.setAttribute(`aria-${name}`, String(v));
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replace everything inside an element. */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

const ICONS = {
  file: 'M6 2h8l4 4v16H6z M14 2v4h4',
  folder: 'M3 6h7l2 2h9v11H3z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  play: 'M7 4l13 8-13 8z',
  stop: 'M6 6h12v12H6z',
  restart: 'M4 12a8 8 0 1 1 3 6.2M4 19v-5h5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
  gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  history: 'M4 12a8 8 0 1 0 3-6.2M4 4v5h5M12 8v5l3 2',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  chevron: 'M9 6l6 6-6 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  check: 'M5 12l5 5L20 7',
  warning: 'M12 3l10 18H2z M12 10v5M12 18v1',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 10l5-5 5 5M5 20h14',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
};

/** A small line icon (decorative: the button or label that holds it has the text). */
export function icon(name, size = 16) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] ?? ICONS.file);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

/** A button with an icon and/or text. Icon-only buttons need a `label` (it is what a screen reader says and what the tooltip shows). */
export function button({ label, text, icon: iconName, onClick, class: cls = '', title, disabled = false, ...rest }) {
  return h('button', {
    type: 'button', class: `btn ${cls}`.trim(), title: title ?? label, disabled, 'aria-label': text ? undefined : label,
    on: { click: onClick }, ...rest,
  }, iconName ? icon(iconName) : null, text ? h('span', { text }) : null);
}

/** Find the element that can take the next focus inside a container (used to keep focus inside a dialog). */
export function focusables(root) {
  const all = root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  return [...all].filter((e) => !e.disabled && !e.hidden && e.offsetParent !== null);
}

/** Keep Tab inside `root` while it is open. Returns a function that stops doing so. */
export function trapFocus(root) {
  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const items = focusables(root);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  root.addEventListener('keydown', onKey);
  return () => root.removeEventListener('keydown', onKey);
}

/** "3 minutes ago", "yesterday 14:32": a time as a person would say it. */
export function when(timestamp, now = Date.now()) {
  const diff = now - timestamp;
  if (diff < 45_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  const date = new Date(timestamp);
  const time = date.toTimeString().slice(0, 5);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  if (sameDay) return `today ${time}`;
  if (new Date(now - 86_400_000).toDateString() === date.toDateString()) return `yesterday ${time}`;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}
