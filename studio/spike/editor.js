// A code editor with no dependencies: a real <textarea> (so typing, selection, undo, IME and accessibility are the browser's own) on top of a highlighted
// layer behind it. Only the lines you can see are highlighted, so a 10,000-line file costs the same per keystroke as a 100-line one.
// This is the S0 spike: it answers "can a zero-dependency editor be fast enough?"; it has no autocomplete, search or multi-cursor yet.

const KEYWORDS = new Set('import export from const let var function return if else for while do switch case break continue new class extends static async await of in typeof instanceof throw try catch finally default this null undefined true false yield void delete get set'.split(' '));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Colour one line. `state` says what the line starts inside: 0 nothing, 1 a block comment, 2 a template string.
 * @returns {{html: string, state: number}} the coloured line and what the next line starts inside
 */
export function highlightLine(line, state) {
  let out = '';
  let i = 0;
  const n = line.length;
  const span = (cls, text) => `<span class="${cls}">${esc(text)}</span>`;
  while (i < n) {
    if (state === 1) {
      const end = line.indexOf('*/', i);
      if (end < 0) return { html: out + span('c', line.slice(i)), state };
      out += span('c', line.slice(i, end + 2));
      i = end + 2;
      state = 0;
      continue;
    }
    if (state === 2) {
      let j = i;
      while (j < n && line[j] !== '`') j += line[j] === '\\' ? 2 : 1;
      if (j >= n) return { html: out + span('s', line.slice(i)), state };
      out += span('s', line.slice(i, j + 1));
      i = j + 1;
      state = 0;
      continue;
    }
    const ch = line[i];
    if (ch === '/' && line[i + 1] === '/') return { html: out + span('c', line.slice(i)), state };
    if (ch === '/' && line[i + 1] === '*') {
      state = 1;
      out += span('c', '/*');
      i += 2;
      continue;
    }
    if (ch === '`') { state = 2; out += span('s', '`'); i++; continue; }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
      out += span('s', line.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[0-9._a-fA-FxX]/.test(line[j])) j++;
      out += span('n', line.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      if (KEYWORDS.has(word)) out += span('k', word);
      else if (line[j] === '(') out += span('f', word);
      else out += esc(word);
      i = j;
      continue;
    }
    out += esc(ch);
    i++;
  }
  return { html: out, state };
}

/**
 * Put an editor in `parent`.
 * @param {HTMLElement} parent
 * @param {{value?: string, onChange?: (text: string) => void, lineHeight?: number, fontSize?: number}} [o]
 */
export function createEditor(parent, { value = '', onChange = () => {}, lineHeight = 20, fontSize = 14 } = {}) {
  const root = document.createElement('div');
  root.className = 'ed';
  root.style.cssText = `position:relative;overflow:hidden;font:${fontSize}px/${lineHeight}px ui-monospace,Consolas,Menlo,monospace;height:100%;display:flex;background:var(--ed-bg,#12151d);color:var(--ed-fg,#d7dcea)`;
  root.innerHTML = `<style>
    .ed .gutter{flex:none;width:52px;overflow:hidden;position:relative;color:#566;text-align:right;user-select:none;border-right:1px solid #232838}
    .ed .gutter div{position:absolute;right:8px;white-space:pre}
    .ed .body{position:relative;flex:1;min-width:0}
    .ed .layer{position:absolute;inset:0;overflow:hidden;pointer-events:none}
    .ed .layer pre{margin:0;position:absolute;left:8px;top:0;font:inherit;white-space:pre;tab-size:2}
    .ed textarea{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0 0 0 8px;border:0;outline:0;resize:none;background:transparent;color:transparent;caret-color:#fff;font:inherit;white-space:pre;overflow:auto;tab-size:2;box-sizing:border-box}
    .ed textarea::selection{background:rgba(100,140,255,.35)}
    .ed .c{color:#6b7590;font-style:italic}.ed .s{color:#7ee0ae}.ed .n{color:#f5b66a}.ed .k{color:#c4a1ff}.ed .f{color:#7cb8ff}
  </style><div class="gutter"></div><div class="body"><div class="layer"><pre></pre></div><textarea spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea></div>`;
  parent.append(root);
  const gutter = root.querySelector('.gutter');
  const layer = root.querySelector('.layer');
  const pre = root.querySelector('pre');
  const ta = root.querySelector('textarea');
  ta.value = value;

  const OVERSCAN = 20;
  let lines = value.split('\n');
  const stateAt = [0];          // stateAt[i]: what line i starts inside; valid for indexes < validTo
  let validTo = 1;
  let editLine = 0;             // the first line the last edit may have touched
  const stats = { inputMs: [], renders: 0 };

  /** What line `index` starts inside, computing (and remembering) the lines before it as needed. */
  function stateOf(index) {
    while (validTo <= index) {
      stateAt[validTo] = highlightLine(lines[validTo - 1], stateAt[validTo - 1]).state;
      validTo++;
    }
    return stateAt[index];
  }

  function render() {
    stats.renders++;
    const top = ta.scrollTop;
    const visible = Math.ceil(ta.clientHeight / lineHeight) + 1;
    const first = Math.max(0, Math.floor(top / lineHeight) - OVERSCAN);
    const last = Math.min(lines.length - 1, first + visible + OVERSCAN * 2);
    let state = stateOf(first);
    let html = '';
    let numbers = '';
    for (let i = first; i <= last; i++) {
      const r = highlightLine(lines[i], state);
      state = r.state;
      html += `${r.html}\n`;
      numbers += `<div style="top:${i * lineHeight - top}px">${i + 1}</div>`;
    }
    pre.innerHTML = html;
    pre.style.transform = `translate(${-ta.scrollLeft}px, ${first * lineHeight - top}px)`;
    gutter.innerHTML = numbers;
  }

  ta.addEventListener('beforeinput', () => {
    editLine = ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
  });
  ta.addEventListener('input', () => {
    const t0 = performance.now();
    lines = ta.value.split('\n');
    validTo = Math.min(validTo, editLine + 1);                 // lines before the edit keep their cached state
    render();
    stats.inputMs.push(performance.now() - t0);
    onChange(ta.value);
  });
  ta.addEventListener('scroll', render);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {         // Tab inserts two spaces instead of leaving the editor
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  });
  new ResizeObserver(render).observe(ta);
  render();

  return {
    root,
    textarea: ta,
    stats,
    get value() { return ta.value; },
    set value(v) { ta.value = v; lines = v.split('\n'); validTo = 1; render(); },
    focus() { ta.focus(); },
    /** Move to a line (1-based) and put the caret there. */
    goto(line, column = 1) {
      const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + column - 1;
      ta.focus();
      ta.setSelectionRange(start, start);
      ta.scrollTop = Math.max(0, (line - 4) * lineHeight);
    },
  };
}
