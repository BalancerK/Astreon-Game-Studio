// A code editor with no dependencies: a real <textarea> (so typing, selection, undo, IME and accessibility are the browser's own) on top of a highlighted
// layer behind it. Only the lines you can see are coloured, so a long file costs about what a short one does (measured in studio/spike: the browser's own
// text layout is what grows with the file, not this code). Helpers (auto-indent, brackets, comments, suggestions, find) are pure functions in ../editing;
// this file connects them to the page, and every change goes through the browser's own editing command so undo and redo work everywhere.
import { tokenizeLine, tokensToHtml, insideTextOrComment, highlightLine } from '../editing/tokenize.js';
import { decorateTokens, decoratedToHtml, byLine } from '../editing/decorate.js';
import * as ops from '../editing/ops.js';
import { completionsAt, acceptEdit, callContext, describe } from '../editing/complete.js';
import { findAll, nextIndex, replaceAll, replacementFor, toLineRanges } from '../editing/find.js';
import { createPopup, createTip, createFindBar, buildTip } from './editor-widgets.js';

export { highlightLine };

const STYLE_ID = 'code-editor-style';
const STYLE = `
.ed{position:relative;overflow:hidden;display:flex;height:100%;background:var(--ed-bg,#12151d);color:var(--ed-fg,#d7dcea)}
.ed .gutter{flex:none;width:52px;overflow:hidden;position:relative;color:#566;text-align:right;user-select:none;border-right:1px solid #232838}
.ed .gutter div{position:absolute;right:8px;white-space:pre}
.ed .gutter div.bad{color:var(--bad,#f87171);font-weight:700}
.ed .body{position:relative;flex:1;min-width:0}
.ed .layer{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.ed .layer pre{margin:0;position:absolute;left:8px;top:0;font:inherit;white-space:pre}
.ed .ln{min-height:var(--lh,20px)}
.ed.guides .ln{background-image:repeating-linear-gradient(to right,var(--ed-guide,rgba(128,140,170,.42)) 0,
  var(--ed-guide,rgba(128,140,170,.42)) 1px,transparent 1px,transparent calc(var(--ts,2) * 1ch));
  background-repeat:no-repeat;background-position:calc(var(--ts,2) * 1ch) 0;background-size:max(0px,calc((var(--ind,0) - var(--ts,2)) * 1ch)) 100%}
.ed .minimap{flex:none;width:76px;height:100%;border-left:1px solid var(--ed-line,#232838);cursor:pointer;display:none;touch-action:none}
.ed.has-minimap .minimap{display:block}
.ed .curline{position:absolute;left:0;right:0;top:0;pointer-events:none;background:var(--ed-cur,rgba(130,150,220,.09));display:none}
.ed.focused.curline-on .curline{display:block}
.ed.wrap .layer pre{white-space:normal;overflow-wrap:break-word}.ed.wrap .ln{white-space:pre-wrap;overflow-wrap:break-word;min-height:var(--lh,20px)}
.ed.wrap textarea{white-space:pre-wrap;overflow-wrap:break-word;overflow-x:hidden}.ed .gutter .gin{position:absolute;inset:0}
.ed textarea{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0 0 0 8px;border:0;outline:0;resize:none;background:transparent;
  color:transparent;caret-color:#fff;font:inherit;white-space:pre;overflow:auto;box-sizing:border-box}
.ed .c{color:#6b7590;font-style:italic}.ed .s{color:#7ee0ae}.ed .n{color:#f5b66a}.ed .k{color:#c4a1ff}.ed .f{color:#7cb8ff}.ed .t{color:#e6c07b}
.ed .err{text-decoration:underline wavy var(--bad,#f87171);text-underline-offset:3px;text-decoration-skip-ink:none}
.ed .match{background:rgba(250,204,21,.28);border-radius:2px}.ed .match-cur{background:rgba(250,204,21,.62);border-radius:2px;
  outline:1px solid #facc15}
.ed .bm{background:rgba(124,184,255,.3);outline:1px solid rgba(124,184,255,.7);border-radius:2px}
.ed .ed-pop,.ed .ed-tip,.ed .ed-find{font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg,#dde2f0);background:var(--panel,
  #12161f);
  border:1px solid var(--line,#262c3b);border-radius:8px;box-shadow:var(--shadow,0 8px 30px rgba(0,0,0,.45))}
.ed .ed-pop{position:absolute;z-index:5;min-width:240px;max-width:420px;max-height:260px;overflow:auto;padding:3px}
.ed .ed-pop .row{display:flex;gap:8px;align-items:baseline;padding:3px 8px;border-radius:5px;cursor:pointer;white-space:nowrap}
.ed .ed-pop .row.on{background:var(--accent-soft,rgba(139,139,255,.18));outline:1px solid var(--accent,#8b8bff)}
.ed .ed-pop .mark{flex:none;width:16px;text-align:center;font:700 11px ui-monospace,monospace;color:var(--accent,#8b8bff)}
.ed .ed-pop .name{flex:none;font-family:ui-monospace,Consolas,monospace}.ed .ed-pop .detail{flex:1;min-width:0;overflow:hidden;
  text-overflow:ellipsis;
  color:var(--dim,#8e98b0);font-size:12px;text-align:right}
.ed .ed-tip{position:absolute;z-index:6;max-width:440px;padding:7px 10px;pointer-events:none}
.ed .ed-tip .tip-title{display:flex;gap:10px;align-items:baseline}.ed .ed-tip .tip-src{color:var(--dim,#8e98b0);font-size:11px}
.ed .ed-tip .tip-sig{display:block;margin:3px 0;font:12px ui-monospace,Consolas,monospace;white-space:pre-wrap;color:var(--tk-f,#7cb8ff)}
.ed .ed-tip .tip-doc{margin:2px 0}.ed .ed-tip .tip-params{margin-top:4px;font-size:12px;color:var(--dim,#8e98b0)}
.ed .ed-tip .tip-params .on{color:var(--fg,#dde2f0);font-weight:600}.ed .ed-tip .ty{opacity:.75}
.ed .ed-tip .tip-error{color:var(--bad,#f87171);font-weight:600}.ed .ed-tip .tip-hint{margin-top:3px;color:var(--dim,#8e98b0)}
.ed .ed-find{position:absolute;z-index:7;top:6px;right:18px;padding:6px;display:flex;flex-direction:column;gap:5px;min-width:340px}
.ed .ed-find[hidden],.ed .ed-find [hidden],.ed .ed-pop[hidden],.ed .ed-tip[hidden]{display:none}
.ed .ed-find .r1,.ed .ed-find .r2{display:flex;gap:4px;align-items:center}.ed .ed-find input{flex:1;min-width:0;font:13px ui-monospace,Consolas,
  monospace;
  padding:3px 6px;border:1px solid var(--line,#262c3b);border-radius:5px;background:var(--code-bg,#0f131b);color:inherit}
.ed .ed-find input.bad{border-color:var(--bad,#f87171)}.ed .ed-find .count{flex:none;min-width:64px;font-size:12px;color:var(--dim,#8e98b0);
  text-align:center}
.ed .ed-find .count.bad{color:var(--bad,#f87171)}
.ed .ed-find button{flex:none;font:inherit;padding:2px 7px;border:1px solid var(--line,#262c3b);border-radius:5px;background:var(--panel2,
  #181d29);color:inherit;cursor:pointer}
.ed .ed-find button[aria-pressed=true]{background:var(--accent-soft,rgba(139,139,255,.2));border-color:var(--accent,#8b8bff)}
.ed .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}`;

const WORD = /[\w$]/;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @typedef {Object} Diagnostic
 * @property {number} line 1-based
 * @property {number} column 1-based
 * @property {number} [endColumn] 1-based, exclusive; by default the word at `column`
 * @property {string} message
 * @property {string} [hint] what to try
 */

/**
 * Put an editor in `parent`.
 * @param {HTMLElement} parent
 * @param {Object} [o]
 * @param {string} [o.value]
 * @param {(text: string) => void} [o.onChange]
 * @param {(line: number, column: number) => void} [o.onCursor]
 * @param {number} [o.fontSize]
 * @param {number} [o.tabSize]
 * @param {boolean} [o.wrap] wrap long lines instead of scrolling sideways (a very long file is not wrapped, to keep typing fast)
 * @param {string} [o.label]
 * @param {() => Promise<object>} [o.loadApi] gives the API index (suggestions and help); loaded the first time it is needed
 */
export function createEditor(parent, options = {}) {
  const { value = '', onChange = () => {}, onCursor = () => {}, label = 'Code', loadApi = null } = options;
  let { fontSize = 14, tabSize = 2, wrap = false, fontFamily = '', lineHeightFactor = 1.45, ligatures = false, highlightLine = true } = options;
  let { indentGuides = true, minimap = true } = options;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.append(style);
  }
  const root = document.createElement('div');
  root.className = 'ed';
  root.innerHTML = '<div class="gutter" aria-hidden="true"></div><div class="body">'
    + '<div class="layer" aria-hidden="true"><div class="curline"></div><pre></pre></div>'
    + '<textarea spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea>'
    + '<div class="sr" role="status" aria-live="polite"></div></div><canvas class="minimap" aria-hidden="true"></canvas>';
  parent.append(root);
  const gutter = root.querySelector('.gutter');
  const body = root.querySelector('.body');
  const pre = root.querySelector('pre');
  const ta = root.querySelector('textarea');
  const announcer = root.querySelector('.sr');
  ta.setAttribute('aria-label', label);
  ta.setAttribute('aria-description', 'Tab indents. Press Escape and then Tab, or Control+M, to move to the next control instead.');
  ta.setAttribute('aria-autocomplete', 'list');
  ta.value = value;

  const OVERSCAN = 20;
  const WRAP_MAX_LINES = 1500;                                // a longer file scrolls sideways instead: every line is drawn when wrapping
  let wrapOn = false;                                         // wrapping is in use right now
  let tops = [];                                              // wrapping: where each line starts on the page, in pixels
  const MAX_SMART = 300_000;                                  // beyond this size the helpers that read the whole text stay off, typing stays fast
  let lineHeight = 20;
  let charWidth = 8;
  let lines = value.split('\n');
  const stateAt = [0];                                        // stateAt[i]: what line i starts inside; valid for indexes < validTo
  let validTo = 1;
  let editLine = 0;                                           // the first line the last edit may have touched
  const stats = { inputMs: [], renders: 0 };

  // ---- marks drawn on the text: errors, find matches, the matching bracket ----
  let diagnostics = [];
  let diagRanges = [];
  let findRanges = [];
  let bracketRanges = [];
  let lineRanges = [];
  let marks = new Map();
  const rebuildMarks = () => { marks = byLine([...lineRanges, ...diagRanges, ...findRanges, ...bracketRanges]); };

  const posToLine = (pos) => {
    const text = ta.value;
    let line = 0;
    let at = text.indexOf('\n');
    while (at >= 0 && at < pos) { line++; at = text.indexOf('\n', at + 1); }
    return { line, column: pos - (line ? text.lastIndexOf('\n', pos - 1) + 1 : 0) };
  };
  const lineToPos = (line, column) => {
    let pos = 0;
    for (let i = 0; i < line && i < lines.length; i++) pos += lines[i].length + 1;
    return Math.min(pos + column, ta.value.length);
  };

  function setOptions(o) {
    if (o.fontSize) fontSize = o.fontSize;
    if (o.lineHeightFactor) lineHeightFactor = o.lineHeightFactor;
    if (o.fontFamily) fontFamily = o.fontFamily;
    if (o.ligatures !== undefined) ligatures = !!o.ligatures;
    if (o.highlightLine !== undefined) highlightLine = !!o.highlightLine;
    if (o.indentGuides !== undefined) indentGuides = !!o.indentGuides;
    if (o.minimap !== undefined) minimap = !!o.minimap;
    root.classList.toggle('guides', indentGuides);
    root.style.setProperty('--ts', String(tabSize));
    lineHeight = Math.round(fontSize * lineHeightFactor);
    if (o.tabSize) tabSize = o.tabSize;
    if (o.wrap !== undefined) wrap = !!o.wrap;
    root.style.setProperty('--lh', `${lineHeight}px`);
    root.classList.toggle('curline-on', highlightLine);
    root.style.setProperty('--ts', String(tabSize));
    schedulePicture(true);
    root.style.fontVariantLigatures = ligatures ? 'normal' : 'none';
    root.style.font = `${fontSize}px/${lineHeight}px ${fontFamily || 'ui-monospace, "Cascadia Code", Consolas, Menlo, monospace'}`;
    root.style.tabSize = String(tabSize);
    ta.style.tabSize = String(tabSize);
    pre.style.tabSize = String(tabSize);
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit';
    probe.textContent = 'M'.repeat(40);
    body.append(probe);
    charWidth = probe.getBoundingClientRect().width / 40 || 8;
    probe.remove();
    render();
  }

  /** What line `index` starts inside, computing (and remembering) the lines before it as needed. */
  function stateOf(index) {
    while (validTo <= index) {
      stateAt[validTo] = tokenizeLine(lines[validTo - 1], stateAt[validTo - 1]).state;
      validTo++;
    }
    return stateAt[index];
  }

  /** Wrapping or not, as it should be now (a very long file is not wrapped). */
  function chooseWrap() {
    const want = wrap && lines.length <= WRAP_MAX_LINES;
    if (want === wrapOn) return;
    wrapOn = want;
    root.classList.toggle('wrap', want);
    ta.setAttribute('wrap', want ? 'soft' : 'off');
    ta.scrollLeft = 0;
    pre.style.width = '';
    gutter.innerHTML = '';
  }

  /** Wrapping: every line is drawn (a line is a block that may take several rows), and the gutter follows where each line really starts. */
  function renderWrapped() {
    pre.style.width = `${Math.max(40, ta.clientWidth - 8)}px`;
    let state = 0;
    let html = '';
    for (let i = 0; i < lines.length; i++) {
      const { tokens, state: next } = tokenizeLine(lines[i], state);
      state = next;
      const here = marks.get(i);
      const body = here ? decoratedToHtml(decorateTokens(tokens, here)) : tokensToHtml(tokens);
      html += `<div class="ln" style="--ind:${indentOf(lines[i])}">${body}</div>`;
    }
    pre.innerHTML = html;
    tops = Array.from(pre.children, (el) => el.offsetTop);
    const bad = new Set(diagnostics.map((d) => d.line - 1));
    const numbers = tops.map((t, i) => `<div${bad.has(i) ? ' class="bad"' : ''} style="top:${t}px">${i + 1}</div>`);
    gutter.innerHTML = `<div class="gin">${numbers.join('')}</div>`;
    syncWrapped();
  }
  const syncWrapped = () => {
    pre.style.transform = `translate(0, ${-ta.scrollTop}px)`;
    updateCurLine();
    drawMapView();
    const gin = gutter.firstChild;
    if (gin) gin.style.transform = `translateY(${-ta.scrollTop}px)`;
  };

  /** The text node and offset where a line's column is, in the drawn copy of the text (wrapping only). */
  function nodeAt(line, column) {
    const block = pre.children[line];
    if (!block) return null;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let left = column;
    let last = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      last = n;
      if (left <= n.length) return { node: n, offset: left };
      left -= n.length;
    }
    return last ? { node: last, offset: last.length } : { node: block, offset: 0 };
  }

  /** Where the text at (clientX, clientY) is, as a line and column, using the browser's own layout of the wrapped text. */
  function hitTest(clientX, clientY) {
    const layer = pre.parentElement;
    ta.style.pointerEvents = 'none';
    layer.style.pointerEvents = 'auto';
    let at = null;
    try {
      const cp = document.caretPositionFromPoint?.(clientX, clientY);
      if (cp) at = { node: cp.offsetNode, offset: cp.offset };
      else {
        const r = document.caretRangeFromPoint?.(clientX, clientY);
        if (r) at = { node: r.startContainer, offset: r.startOffset };
      }
    } finally {
      ta.style.pointerEvents = '';
      layer.style.pointerEvents = '';
    }
    if (!at || !pre.contains(at.node)) return null;
    let block = at.node;
    while (block && block.parentElement !== pre) block = block.parentElement;
    if (!block) return null;
    const line = Array.prototype.indexOf.call(pre.children, block);
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let column = 0;
    if (at.node.nodeType === Node.TEXT_NODE) {
      for (let n = walker.nextNode(); n && n !== at.node; n = walker.nextNode()) column += n.length;
      column += at.offset;
    } else {
      const upTo = at.node === block ? at.offset : block.childNodes.length;
      for (let i = 0; i < upTo; i++) column += block.childNodes[i].textContent.length;
    }
    return { line, column: Math.min(column, lines[line]?.length ?? 0) };
  }

  /** How wide a line's indentation is, in characters (a tab counts to the next tab stop). */
  function indentOf(line) {
    let w = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === ' ') w++;
      else if (c === String.fromCharCode(9)) w += tabSize - (w % tabSize);
      else break;
    }
    return w;
  }

  // ---- the overview at the right: every line as a thin bar in its colours, the part in view shaded; click or drag to go there ----
  const map = root.querySelector('.minimap');
  const MAP_COLS = 100;
  let mapLines = null;                 // the coloured pieces of every line, worked out in the background after a change
  let mapTimer = 0;
  let mapJob = 0;
  let mapFull = null;                  // the whole file drawn once, as a picture to take slices of
  const mapScale = () => Math.max(0.3, Math.min(2, (map.clientHeight || 400) / Math.max(1, lines.length)));
  function schedulePicture(rebuild) {
    if (rebuild) mapLines = null;
    clearTimeout(mapTimer);
    mapTimer = setTimeout(buildPicture, 280);
    root.classList.toggle('has-minimap', minimap && lines.length >= 60);
  }
  function buildPicture() {
    const show = minimap && lines.length >= 60;
    root.classList.toggle('has-minimap', show);
    if (!show) return;
    const job = ++mapJob;
    const found = [];
    let state = 0;
    let at = 0;
    const step = () => {
      if (job !== mapJob) return;
      const until = Math.min(lines.length, at + 400);
      for (; at < until; at++) {
        const { tokens, state: next } = tokenizeLine(lines[at], state);
        state = next;
        let col = 0;
        found.push(tokens.map((t) => {
          const piece = { cls: t.cls, from: col, to: col + t.text.length, blank: !t.text.trim() };
          col += t.text.length;
          return piece;
        }));
      }
      if (at < lines.length) { setTimeout(step, 0); return; }
      mapLines = found;
      drawPicture();
    };
    step();
  }
  function drawPicture() {
    if (!mapLines || !map.clientHeight) return;
    const scale = mapScale();
    const css = getComputedStyle(root);
    const colours = {
      k: css.getPropertyValue('--tk-k'), s: css.getPropertyValue('--tk-s'), n: css.getPropertyValue('--tk-n'), c: css.getPropertyValue('--tk-c'),
      f: css.getPropertyValue('--tk-f'), t: css.getPropertyValue('--tk-t'), '': css.getPropertyValue('--ed-fg') };
    const full = document.createElement('canvas');
    full.width = map.clientWidth || 76;
    full.height = Math.max(1, Math.ceil(lines.length * scale));
    const g = full.getContext('2d');
    const px = (full.width - 6) / MAP_COLS;
    mapLines.forEach((pieces, i) => {
      for (const p of pieces) {
        if (p.blank) continue;
        g.globalAlpha = p.cls === '' ? 0.45 : 0.9;
        g.fillStyle = (colours[p.cls] || colours['']).trim();
        const from = Math.min(MAP_COLS, p.from);
        const to = Math.min(MAP_COLS, p.to);
        g.fillRect(3 + from * px, i * scale, Math.max(1, (to - from) * px), Math.max(1, scale * 0.8));
      }
    });
    mapFull = { canvas: full, scale };
    drawMapView();
  }
  /** The slice of the picture that fits, and the shading of what the editor shows. */
  function drawMapView() {
    if (!mapFull || !map.clientHeight) return;
    const h = map.clientHeight;
    const w = map.clientWidth;
    if (map.width !== w || map.height !== h) { map.width = w; map.height = h; }
    const g = map.getContext('2d');
    g.clearRect(0, 0, w, h);
    const total = mapFull.canvas.height;
    const room = Math.max(0, total - h);
    const ratio = ta.scrollHeight > ta.clientHeight ? ta.scrollTop / (ta.scrollHeight - ta.clientHeight) : 0;
    const offset = room * ratio;
    g.drawImage(mapFull.canvas, 0, offset, w, h, 0, 0, w, h);
    const viewTop = (ta.scrollTop / Math.max(1, ta.scrollHeight)) * total - offset;
    const viewHeight = Math.max(8, (ta.clientHeight / Math.max(1, ta.scrollHeight)) * total);
    g.fillStyle = 'rgba(140, 150, 190, 0.22)';
    g.fillRect(0, viewTop, w, viewHeight);
  }
  const mapGoTo = (e) => {
    const r = map.getBoundingClientRect();
    const total = mapFull?.canvas.height ?? 1;
    const room = Math.max(0, total - map.clientHeight);
    const ratio = ta.scrollHeight > ta.clientHeight ? ta.scrollTop / (ta.scrollHeight - ta.clientHeight) : 0;
    const y = e.clientY - r.top + room * ratio;
    ta.scrollTop = Math.max(0, (y / total) * ta.scrollHeight - ta.clientHeight / 2);
  };
  map.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    map.setPointerCapture(e.pointerId);
    mapGoTo(e);
    const move = (ev) => mapGoTo(ev);
    const up = () => { map.removeEventListener('pointermove', move); map.removeEventListener('pointerup', up); };
    map.addEventListener('pointermove', move);
    map.addEventListener('pointerup', up);
  });

  function render() {
    chooseWrap();
    if (wrapOn) { renderWrapped(); return; }
    stats.renders++;
    const top = ta.scrollTop;
    const visible = Math.ceil(ta.clientHeight / lineHeight) + 1;
    const first = Math.max(0, Math.floor(top / lineHeight) - OVERSCAN);
    const last = Math.min(lines.length - 1, first + visible + OVERSCAN * 2);
    let state = stateOf(first);
    let html = '';
    let numbers = '';
    const bad = new Set(diagnostics.map((d) => d.line - 1));
    for (let i = first; i <= last; i++) {
      const { tokens, state: next } = tokenizeLine(lines[i], state);
      state = next;
      const here = marks.get(i);
      const body = here ? decoratedToHtml(decorateTokens(tokens, here)) : tokensToHtml(tokens);
      html += `<div class="ln" style="--ind:${indentOf(lines[i])}">${body}</div>`;
      numbers += `<div${bad.has(i) ? ' class="bad"' : ''} style="top:${i * lineHeight - top}px">${i + 1}</div>`;
    }
    pre.innerHTML = html;
    pre.style.transform = `translate(${-ta.scrollLeft}px, ${first * lineHeight - top}px)`;
    gutter.innerHTML = numbers;
    updateCurLine();
    drawMapView();
  }

  /** The caret's line and column (1-based). */
  function cursor() {
    const p = posToLine(ta.selectionStart);
    return { line: p.line + 1, column: p.column + 1 };
  }
  const curline = root.querySelector('.curline');
  let curLine = 0;
  /** Shade the line the caret is on (where it is drawn depends on the scrolling, and on how lines wrap). */
  function updateCurLine() {
    if (!highlightLine) return;
    const top = wrapOn ? tops[curLine] ?? 0 : curLine * lineHeight;
    const height = wrapOn ? (tops[curLine + 1] ?? pre.scrollHeight) - top : lineHeight;
    curline.style.transform = `translateY(${top - ta.scrollTop}px)`;
    curline.style.height = `${Math.max(lineHeight, height)}px`;
  }
  const reportCursor = () => { const c = cursor(); curLine = c.line - 1; updateCurLine(); onCursor(c.line, c.column); };
  const say = (text) => { announcer.textContent = ''; setTimeout(() => { announcer.textContent = text; }, 30); };
  const selection = () => ({ start: Math.min(ta.selectionStart, ta.selectionEnd), end: Math.max(ta.selectionStart, ta.selectionEnd) });

  /** Change the text the way typing would, so undo and redo keep working. */
  function applyEdit(e) {
    ta.focus();
    ta.setSelectionRange(e.from, e.to);
    let done = true;
    if (e.insert === '') done = e.from === e.to || document.execCommand('delete');
    else done = document.execCommand('insertText', false, e.insert);
    if (!done) {
      ta.setRangeText(e.insert, e.from, e.to, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ta.setSelectionRange(Math.min(e.anchor, e.head), Math.max(e.anchor, e.head), e.anchor > e.head ? 'backward' : 'forward');
    afterMove();
  }

  // ---- suggestions and help ----
  let api = null;
  let apiLoading = null;
  const needApi = () => {
    if (api || !loadApi) return Promise.resolve(api);
    apiLoading ??= loadApi().then((a) => { api = a; return a; }).catch(() => null);
    return apiLoading;
  };
  const popup = createPopup(body, { onPick: (item) => accept(item) });
  const tip = createTip(body);
  let range = null;                                           // what the open list will replace
  let suggestTimer = 0;

  const caretXY = (pos) => {
    const p = posToLine(pos);
    if (wrapOn) {
      const at = nodeAt(p.line, p.column);
      if (at) {
        const range = document.createRange();
        range.setStart(at.node, at.offset);
        range.collapse(true);
        const r = range.getClientRects()[0] ?? at.node.getBoundingClientRect?.() ?? range.getBoundingClientRect();
        const b = body.getBoundingClientRect();
        return { x: r.left - b.left, y: r.bottom - b.top };
      }
    }
    return { x: 8 + p.column * charWidth - ta.scrollLeft, y: (p.line + 1) * lineHeight - ta.scrollTop };
  };

  function suggest(explicit = false) {
    if (!api || ta.value.length > MAX_SMART || ta.selectionStart !== ta.selectionEnd) { closePopup(); return; }
    const pos = ta.selectionStart;
    const p = posToLine(pos);
    const inPackageName = /from\s*['"]@engine\/[\w-]*$/.test(lines[p.line].slice(0, p.column));
    if (insideTextOrComment(lines, p.line, p.column) && !inPackageName) { closePopup(); return; }
    const result = completionsAt(ta.value, pos, api, { explicit });
    if (!result) { closePopup(); return; }
    range = result;
    const { x, y } = caretXY(result.from);
    popup.show(result.items, x, y, lineHeight);
    ta.setAttribute('aria-controls', popup.id);
    ta.setAttribute('aria-activedescendant', popup.activeId);
    hideTip();
    say(`${result.items.length} suggestions. Use the arrow keys and Enter.`);
  }
  function closePopup() {
    if (!popup.isOpen) return;
    popup.hide();
    range = null;
    ta.removeAttribute('aria-activedescendant');
  }
  function accept(item) {
    if (!range) return;
    const e = acceptEdit(ta.value, range, item);
    closePopup();
    applyEdit(e);
  }

  function hideTip() { if (tip.isOpen) { tip.hide(); ta.removeAttribute('aria-describedby'); } }
  function showTip(nodes, pos) {
    const { x, y } = caretXY(pos);
    tip.show(nodes, x, y - lineHeight, lineHeight);
    ta.setAttribute('aria-describedby', tip.el.id ||= `ed-tip-${Math.random().toString(36).slice(2, 7)}`);
  }

  /** The signature of the call the caret is in, with the current parameter marked. */
  function signatureHelp() {
    if (!api || popup.isOpen || ta.value.length > MAX_SMART || ta.selectionStart !== ta.selectionEnd) return false;
    const call = callContext(ta.value, ta.selectionStart);
    const info = call && describe(ta.value, call.name, api);
    if (!info || info.kind === 'constant') return false;
    const source = `@engine/${info.pkg}`;
    const { signature, doc, params } = info;
    showTip(buildTip({ title: info.name, signature, doc, params, active: call.index, source }), ta.selectionStart);
    return true;
  }
  function wordHelp(pos) {
    const w = ops.wordAt(ta.value, pos);
    if (!w || !api) return false;
    const info = describe(ta.value, w.word, api);
    if (!info) return false;
    showTip(buildTip({ title: info.name, signature: info.signature, doc: info.doc, params: info.params, source: `@engine/${info.pkg}` }), w.from);
    return true;
  }
  function diagnosticAt(line, column) {
    return diagnostics.find((d) => d.line - 1 === line && column >= d.column - 1 && column <= (d.endColumn ?? d.column + 1) - 1);
  }

  // ---- after every change of text or selection ----
  let bracketFrame = 0;
  function afterMove() {
    reportCursor();
    cancelAnimationFrame(bracketFrame);
    bracketFrame = requestAnimationFrame(updateBracket);
  }
  function updateBracket() {
    const next = [];
    if (ta.selectionStart === ta.selectionEnd && ta.value.length <= MAX_SMART) {
      const m = ops.matchBracket(ta.value, ta.selectionStart);
      if (m) {
        for (const at of [m.a, m.b]) { const p = posToLine(at); next.push({ line: p.line, from: p.column, to: p.column + 1, cls: 'bm' }); }
      }
    }
    if (next.length === bracketRanges.length && next.every((r, i) => r.line === bracketRanges[i].line && r.from === bracketRanges[i].from)) return;
    bracketRanges = next;
    rebuildMarks();
    render();
  }

  // ---- find and replace ----
  const findState = { matches: [], index: -1, error: '' };
  const bar = createFindBar(body, {
    onChange: () => refind(true),
    onNext: () => stepFind(1),
    onPrev: () => stepFind(-1),
    onReplace: replaceCurrent,
    onReplaceAll: replaceEvery,
    onClose: closeFind,
  });

  function paintFind() {
    const cur = findState.matches[findState.index];
    const ranges = toLineRanges(ta.value, findState.matches.filter((m) => m !== cur)).map((r) => ({ ...r, cls: 'match' }));
    if (cur) ranges.push(...toLineRanges(ta.value, [cur]).map((r) => ({ ...r, cls: 'match-cur' })));
    findRanges = ranges;
    rebuildMarks();
    render();
  }
  function showMatch(m) {
    const { line } = posToLine(m.from);
    const top = wrapOn ? tops[line] ?? line * lineHeight : line * lineHeight;
    const outOfView = top < ta.scrollTop + lineHeight || top > ta.scrollTop + ta.clientHeight - lineHeight * 3;
    if (outOfView) ta.scrollTop = Math.max(0, top - Math.floor(ta.clientHeight / 3));
    const x = wrapOn ? 0 : 8 + posToLine(m.from).column * charWidth;
    if (x < ta.scrollLeft || x > ta.scrollLeft + ta.clientWidth - 40) ta.scrollLeft = Math.max(0, x - 80);
  }
  /** Search again; `fromCaret` picks the first match after the caret, otherwise the current match is kept where possible. */
  function refind(fromCaret) {
    if (!bar.isOpen) return;
    const o = bar.options;
    const before = findState.matches[findState.index];
    const r = findAll(ta.value, o.query, o);
    findState.matches = r.matches;
    findState.error = r.error ?? '';
    if (fromCaret || !before) findState.index = nextIndex(r.matches, Math.min(ta.selectionStart, ta.selectionEnd));
    else findState.index = Math.min(findState.index, r.matches.length - 1);
    const n = r.matches.length;
    if (!o.query) bar.setStatus('');
    else if (r.error) bar.setStatus('Not a valid pattern', true);
    else if (!n) bar.setStatus('No results', true);
    else bar.setStatus(`${findState.index + 1} of ${n}${r.capped ? '+' : ''}`);
    if (findState.matches[findState.index]) showMatch(findState.matches[findState.index]);
    paintFind();
  }
  function stepFind(direction) {
    if (!findState.matches.length) { refind(true); return; }
    const i = findState.index;
    findState.index = (i + direction + findState.matches.length) % findState.matches.length;
    bar.setStatus(`${findState.index + 1} of ${findState.matches.length}`);
    showMatch(findState.matches[findState.index]);
    paintFind();
  }
  function replaceCurrent() {
    const m = findState.matches[findState.index];
    if (!m) return;
    const o = bar.options;
    const insert = replacementFor(ta.value, m, o.query, o.replace, o);
    applyEdit({ from: m.from, to: m.to, insert, anchor: m.from + insert.length, head: m.from + insert.length });
    refind(true);
    bar.focusReplace();
  }
  function replaceEvery() {
    const o = bar.options;
    const r = replaceAll(ta.value, o.query, o.replace, o);
    if (!r.count) return;
    const view = { top: ta.scrollTop, left: ta.scrollLeft, at: Math.min(ta.selectionStart, ta.value.length) };
    applyEdit({ from: 0, to: ta.value.length, insert: r.text, anchor: view.at, head: view.at });
    ta.scrollTop = view.top;
    ta.scrollLeft = view.left;
    refind(true);
    bar.setStatus(`Replaced ${r.count}`);
    say(`Replaced ${r.count} matches`);
  }
  function openFind(withReplace) {
    const { start, end } = selection();
    const picked = start !== end && !ta.value.slice(start, end).includes('\n') ? ta.value.slice(start, end) : '';
    bar.open({ query: picked, withReplace });
  }
  function closeFind() {
    bar.close();
    findState.matches = [];
    findState.index = -1;
    findRanges = [];
    rebuildMarks();
    render();
    ta.focus();
  }

  // ---- events ----
  ta.addEventListener('beforeinput', () => {
    editLine = posToLine(Math.min(ta.selectionStart, ta.selectionEnd)).line;
  });
  ta.addEventListener('input', (event) => {
    const t0 = performance.now();
    lines = ta.value.split('\n');
    schedulePicture(true);
    validTo = Math.min(validTo, editLine + 1);                 // lines before the edit keep their cached state
    render();
    stats.inputMs.push(performance.now() - t0);
    if (stats.inputMs.length > 500) stats.inputMs.splice(0, 250);
    onChange(ta.value);
    afterMove();
    if (bar.isOpen) refind(false);
    hideTip();
    clearTimeout(suggestTimer);
    const typed = event.inputType === 'insertText' && event.data && (WORD.test(event.data) || event.data === '.');
    if (typed && ta.value.length <= MAX_SMART) {
      needApi().then(() => { suggestTimer = setTimeout(() => { suggest(false); if (!popup.isOpen) signatureHelp(); }, 30); });
    } else if (popup.isOpen && /^delete/.test(event.inputType ?? '')) {
      suggestTimer = setTimeout(() => suggest(false), 30);
    } else {
      closePopup();
      if (api && event.inputType !== 'historyUndo') suggestTimer = setTimeout(signatureHelp, 30);
    }
  });
  ta.addEventListener('scroll', () => { if (wrapOn) syncWrapped(); else render(); closePopup(); hideTip(); });
  ta.addEventListener('blur', () => { closePopup(); hideTip(); root.classList.remove('focused'); });
  ta.addEventListener('focus', () => { root.classList.add('focused'); updateCurLine(); });
  ta.addEventListener('click', () => { closePopup(); hideTip(); afterMove(); });
  const onSelectionChange = () => { if (document.activeElement === ta) afterMove(); };
  document.addEventListener('selectionchange', onSelectionChange);

  ta.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (popup.isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        popup.move(e.key === 'ArrowDown' ? 1 : -1);
        ta.setAttribute('aria-activedescendant', popup.activeId);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); accept(popup.current); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopup(); return; }
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(e.key)) closePopup();
    } else if (e.key === 'Escape' && (tip.isOpen || bar.isOpen)) {
      e.stopPropagation();
      if (tip.isOpen) hideTip(); else closeFind();
      return;
    }
    const modifierKey = ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key);
    if (e.key !== 'Tab' && e.key !== 'Escape' && !modifierKey) delete ta.dataset.escaped;
    const { start, end } = selection();
    const text = ta.value;
    const smart = text.length <= MAX_SMART;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    let edit = null;
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Tab indents; Esc then Tab (or Ctrl+M first, to keep it so) leaves the editor
      if (ta.dataset.escaped === '1' || ta.dataset.tabfocus === '1') return;
      edit = ops.indentLines(text, start, end, e.shiftKey ? -1 : 1, tabSize);
    } else if (e.key === 'Escape') {
      ta.dataset.escaped = '1';                                        // the next Tab leaves the editor; any other key cancels
      say('Tab will now leave the editor.');
      return;
    } else if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      if (ta.dataset.tabfocus === '1') {
        delete ta.dataset.tabfocus;
        say('Tab indents again.');
      } else {
        ta.dataset.tabfocus = '1';
        say('Tab now moves to the next control.');
      }
      return;
    } else if (e.key === 'Enter' && plain && smart) {
      edit = ops.onEnter(text, start, end, tabSize);
    } else if (e.key === 'Backspace' && plain && smart) {
      edit = ops.onBackspace(text, start, end);
    } else if (e.key.length === 1 && smart && (plain || e.getModifierState?.('AltGraph'))) {
      const p = posToLine(start);
      edit = ops.onType(text, start, end, e.key, { inString: !!insideTextOrComment(lines, p.line, p.column) });
    }
    if (edit) { e.preventDefault(); applyEdit(edit); }
  });

  // hovering an error or a name shows what it is
  let hoverTimer = 0;
  let hoverAt = '';
  ta.addEventListener('mousemove', (e) => {
    if (e.buttons) return;
    const rect = ta.getBoundingClientRect();
    const found = wrapOn ? hitTest(e.clientX, e.clientY) : null;
    const line = found ? found.line : wrapOn ? -1 : Math.floor((e.clientY - rect.top + ta.scrollTop) / lineHeight);
    const column = found ? found.column : wrapOn ? -1 : Math.floor((e.clientX - rect.left - 8 + ta.scrollLeft) / charWidth);
    const key = `${line}:${column}`;
    if (key === hoverAt) return;
    hoverAt = key;
    clearTimeout(hoverTimer);
    hideTip();
    if (line < 0 || line >= lines.length || column < 0 || column > lines[line].length) return;
    hoverTimer = setTimeout(async () => {
      await needApi();
      const d = diagnosticAt(line, column);
      if (d) {
        const p = lineToPos(line, column);
        showTip(buildTip({ title: d.message, hint: d.hint, tone: 'error' }), p);
      } else if (api && lines[line][column] && WORD.test(lines[line][column])) {
        wordHelp(lineToPos(line, column));
      }
    }, 380);
  });
  ta.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); hoverAt = ''; hideTip(); });
  new ResizeObserver(render).observe(ta);
  setOptions({ fontSize, tabSize });

  /** The things a command can ask the editor to do. */
  const actions = {
    toggleComment: () => applyEdit(ops.toggleComment(ta.value, selection().start, selection().end)),
    indent: () => applyEdit(ops.indentLines(ta.value, selection().start, selection().end, 1, tabSize)),
    outdent: () => applyEdit(ops.indentLines(ta.value, selection().start, selection().end, -1, tabSize)),
    moveUp: () => { const e = ops.moveLines(ta.value, selection().start, selection().end, -1); if (e) applyEdit(e); },
    moveDown: () => { const e = ops.moveLines(ta.value, selection().start, selection().end, 1); if (e) applyEdit(e); },
    duplicate: () => applyEdit(ops.duplicateLines(ta.value, selection().start, selection().end, 1)),
    deleteLine: () => applyEdit(ops.deleteLines(ta.value, selection().start, selection().end)),
    find: () => openFind(false),
    replace: () => openFind(true),
    findNext: () => { if (!bar.isOpen) openFind(false); else stepFind(1); },
    findPrev: () => { if (!bar.isOpen) openFind(false); else stepFind(-1); },
    suggest: () => { ta.focus(); needApi().then(() => suggest(true)); },
    help: () => {
      ta.focus();
      needApi().then(() => {
        if (tip.isOpen) { hideTip(); return; }
        const d = diagnostics.find((x) => x.line === cursor().line);
        if (d) showTip(buildTip({ title: d.message, hint: d.hint, tone: 'error' }), lineToPos(d.line - 1, d.column - 1));
        else if (!signatureHelp() && !wordHelp(ta.selectionStart)) say('No help for this word');
      });
    },
  };

  return {
    root,
    textarea: ta,
    stats,
    get value() { return ta.value; },
    /** Replace all the text (does not call `onChange`). */
    set value(v) {
      ta.value = v;
      lines = v.split('\n');
      schedulePicture(true);
      validTo = 1;
      closePopup();
      hideTip();
      if (bar.isOpen) refind(true);
      render();
      reportCursor();
    },
    focus() { ta.focus(); },
    setOptions,
    cursor,
    /** Do one of the editor's actions (a command asks for these). Returns false when there is no such action. */
    action(name) {
      if (!actions[name]) return false;
      actions[name]();
      return true;
    },
    /** Show these problems on the text: wavy underline, red line number, and a message on hover. @param {Diagnostic[]} list */
    setDiagnostics(list) {
      diagnostics = list.filter((d) => d.line >= 1 && d.line <= lines.length);
      diagRanges = diagnostics.map((d) => {
        const text = lines[d.line - 1];
        let to = d.endColumn ? d.endColumn - 1 : d.column - 1;
        if (!d.endColumn) while (to < text.length && WORD.test(text[to])) to++;
        if (to <= d.column - 1) to = Math.min(text.length, d.column);
        return { line: d.line - 1, from: d.column - 1, to, cls: 'err', title: d.hint ? `${d.message} ${d.hint}` : d.message };
      });
      rebuildMarks();
      render();
    },
    /** Highlight whole lines (1-based), for example the line a lesson points at. */
    setHighlights(list) {
      lineRanges = list.filter((n) => n >= 1 && n <= lines.length)
        .map((n) => ({ line: n - 1, from: 0, to: Math.max(1, lines[n - 1].length), cls: 'hl' }));
      rebuildMarks();
      render();
    },
    /** Where the view is, so it can be put back when this file is shown again. */
    getViewState() { return { top: ta.scrollTop, left: ta.scrollLeft, start: ta.selectionStart, end: ta.selectionEnd }; },
    setViewState(s) {
      if (!s) return;
      ta.setSelectionRange(Math.min(s.start, ta.value.length), Math.min(s.end, ta.value.length));
      ta.scrollTop = s.top;
      ta.scrollLeft = s.left;
      render();
      reportCursor();
    },
    /** Move to a line (1-based) and put the caret there. */
    goto(line, column = 1) {
      const start = clamp(lineToPos(line - 1, column - 1), 0, ta.value.length);
      ta.focus();
      ta.setSelectionRange(start, start);
      ta.scrollTop = Math.max(0, wrapOn ? tops[Math.max(0, line - 4)] ?? 0 : (line - 4) * lineHeight);
      ta.scrollLeft = 0;
      render();
      reportCursor();
    },
    dispose() {
      document.removeEventListener('selectionchange', onSelectionChange);
      clearTimeout(suggestTimer);
      clearTimeout(hoverTimer);
      cancelAnimationFrame(bracketFrame);
      root.remove();
    },
  };
}
