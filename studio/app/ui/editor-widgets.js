// The small pieces that float over the code editor: the suggestion list, the help tip, and the find-and-replace bar. They are plain DOM built with
// textContent (text from the API docs or an error message can never become markup) and know nothing about the text being edited; the editor tells them what
// to show and what happened.

const el = (tag, props = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k.startsWith('aria-') || k === 'role' || k === 'type' || k === 'title' || k === 'id' || k === 'placeholder') node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
};

const KIND_MARK = { function: 'ƒ', class: 'C', constant: 'K', method: 'm', property: 'p', variable: 'v', module: '▣', namespace: 'N', type: 'T' };
let popupCount = 0;

/** The list of suggestions beside the caret. */
export function createPopup(parent, { onPick }) {
  const id = `ed-pop-${++popupCount}`;
  const list = el('div', { class: 'ed-pop', id, role: 'listbox', 'aria-label': 'Suggestions', hidden: true });
  parent.append(list);
  let items = [];
  let index = 0;

  const paint = () => {
    list.replaceChildren(...items.map((item, i) => el('div', {
      class: `row${i === index ? ' on' : ''}`, id: `${id}-${i}`, role: 'option', 'aria-selected': String(i === index),
      on: { mousedown: (e) => { e.preventDefault(); onPick(item); }, mousemove: () => { if (index !== i) { index = i; paint(); } } },
    }, el('span', { class: `mark ${item.kind}`, text: KIND_MARK[item.kind] ?? '·', 'aria-hidden': 'true' }),
    el('span', { class: 'name', text: item.label }),
    el('span', { class: 'detail', text: item.source === 'engine' && item.pkg ? `@engine/${item.pkg}` : item.detail }))));
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };

  return {
    id,
    get isOpen() { return !list.hidden; },
    get current() { return list.hidden ? null : items[index]; },
    get activeId() { return list.hidden ? '' : `${id}-${index}`; },
    /** Show these items with the top-left corner at (x, y); `above` puts the list above y instead. */
    show(next, x, y, lineHeight) {
      items = next;
      index = 0;
      list.hidden = false;
      paint();
      const room = parent.clientHeight - y;
      const high = Math.min(list.offsetHeight, 260);
      list.style.left = `${Math.max(0, Math.min(x, parent.clientWidth - 260))}px`;
      list.style.top = `${room < high + 8 && y - lineHeight > high ? y - lineHeight - high : y}px`;
    },
    move(delta) {
      if (!items.length) return;
      index = (index + delta + items.length) % items.length;
      paint();
    },
    hide() { list.hidden = true; items = []; },
    dispose() { list.remove(); },
  };
}

/**
 * What a tip says: a title line, a description, and the parameters with the current one marked.
 * @param {{title: string, signature?: string, doc?: string, params?: string[][], active?: number, hint?: string, tone?: string, source?: string}} c
 */
export function buildTip(c) {
  const nodes = [];
  if (c.tone === 'error') nodes.push(el('div', { class: 'tip-error', text: c.title }));
  else {
    const src = c.source ? el('span', { class: 'tip-src', text: c.source }) : null;
    nodes.push(el('div', { class: 'tip-title' }, el('strong', { text: c.title }), src));
  }
  if (c.signature) nodes.push(el('code', { class: 'tip-sig', text: c.signature }));
  if (c.doc) nodes.push(el('div', { class: 'tip-doc', text: c.doc }));
  if (c.params?.length) {
    nodes.push(el('div', { class: 'tip-params' }, c.params.map((p, i) => el('div', { class: i === c.active ? 'on' : '' },
      el('code', { text: p[0] }), p[1] ? el('span', { class: 'ty', text: ` ${p[1]}` }) : null, p[2] ? el('span', { text: ` ${p[2]}` }) : null))));
  }
  if (c.hint) nodes.push(el('div', { class: 'tip-hint', text: c.hint }));
  return nodes;
}

/** A floating tip. */
export function createTip(parent) {
  const tip = el('div', { class: 'ed-tip', role: 'tooltip', hidden: true });
  parent.append(tip);
  return {
    el: tip,
    get isOpen() { return !tip.hidden; },
    show(nodes, x, y, lineHeight) {
      tip.replaceChildren(...nodes);
      tip.hidden = false;
      const high = tip.offsetHeight;
      const below = y + lineHeight;
      tip.style.left = `${Math.max(0, Math.min(x, parent.clientWidth - tip.offsetWidth - 4))}px`;
      tip.style.top = `${below + high > parent.clientHeight && y - high - 4 > 0 ? y - high - 4 : below}px`;
    },
    hide() { tip.hidden = true; },
    dispose() { tip.remove(); },
  };
}

/**
 * The find-and-replace bar at the top of the editor.
 * @param {HTMLElement} parent
 * @param {{onChange: (o: object) => void, onNext: () => void, onPrev: () => void, onReplace: () => void, onReplaceAll: () => void, onClose: () => void}} h
 */
export function createFindBar(parent, h) {
  const find = el('input', { type: 'text', 'aria-label': 'Find', placeholder: 'Find', spellcheck: false, autocomplete: 'off' });
  const replace = el('input', { type: 'text', 'aria-label': 'Replace with', placeholder: 'Replace with', spellcheck: false, autocomplete: 'off' });
  const status = el('span', { class: 'count', role: 'status', 'aria-live': 'polite' });
  const flags = { caseSensitive: false, wholeWord: false, regex: false };
  const toggles = {};
  const toggle = (key, label, text) => {
    toggles[key] = el('button', {
      type: 'button', class: 'tog', text, title: label, 'aria-label': label, 'aria-pressed': 'false',
      on: { click: () => { flags[key] = !flags[key]; toggles[key].setAttribute('aria-pressed', String(flags[key])); change(); find.focus(); } },
    });
    return toggles[key];
  };
  const btn = (label, text, fn) => el('button', { type: 'button', class: 'b', text, title: label, 'aria-label': label, on: { click: fn } });
  const replaceRow = el('div', { class: 'r2' }, replace,
    btn('Replace this match', 'Replace', () => h.onReplace()), btn('Replace every match', 'All', () => h.onReplaceAll()));
  const bar = el('div', { class: 'ed-find', role: 'search', 'aria-label': 'Find and replace', hidden: true },
    el('div', { class: 'r1' }, find,
      toggle('caseSensitive', 'Match case', 'Aa'), toggle('wholeWord', 'Whole word', 'ab'),
      toggle('regex', 'Use a pattern (regular expression)', '.*'),
      status, btn('Previous match', '↑', () => h.onPrev()), btn('Next match', '↓', () => h.onNext()), btn('Close find', '✕', () => h.onClose())),
    replaceRow);
  parent.append(bar);

  const change = () => h.onChange({ query: find.value, replace: replace.value, ...flags });
  find.addEventListener('input', change);
  replace.addEventListener('input', change);
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); h.onClose(); }
    else if (e.key === 'Enter' && e.target === find) { e.preventDefault(); if (e.shiftKey) h.onPrev(); else h.onNext(); }
    else if (e.key === 'Enter' && e.target === replace) { e.preventDefault(); if (e.ctrlKey || e.metaKey) h.onReplaceAll(); else h.onReplace(); }
    else if (e.key === 'F3') { e.preventDefault(); if (e.shiftKey) h.onPrev(); else h.onNext(); }
  });

  return {
    el: bar,
    get isOpen() { return !bar.hidden; },
    get options() { return { query: find.value, replace: replace.value, ...flags }; },
    open({ query, withReplace }) {
      bar.hidden = false;
      replaceRow.hidden = !withReplace;
      if (query) find.value = query;
      const target = withReplace && find.value ? replace : find;
      target.focus();
      target.select();
      change();
    },
    close() { bar.hidden = true; },
    setStatus(text, bad = false) { status.textContent = text; status.classList.toggle('bad', bad); find.classList.toggle('bad', bad); },
    focusFind() { find.focus(); },
    focusReplace() { replace.focus(); },
    dispose() { bar.remove(); },
  };
}
