import { OverlayModel } from './model.js';
import { drawGraph } from './graph.js';

const COLORS = ['#7fd4ff', '#9bf29b', '#ffd27f', '#d69bff', '#ff9bb8', '#8ff0e0', '#ffb36b'];
const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '-');

/**
 * In-page debug panel: live graphs for each series, info lines and a packet inspector.
 * Toggle with F3 (or `toggle()`). Sampling always runs (cheap) so history is there when you open it;
 * drawing only happens while it is visible.
 */
export class DebugOverlay {
  /**
   * @param {object} [o]
   * @param {string} [o.title]
   * @param {boolean} [o.open]
   * @param {string | null} [o.hotkey] KeyboardEvent.code, or null for none.
   * @param {HTMLElement} [o.parent]
   * @param {OverlayModel} [o.model]
   * @param {number} [o.intervalMs] Sampling/refresh period.
   */
  constructor({ title = 'Debug', open = false, hotkey = 'F3', parent = document.body, model = new OverlayModel(), intervalMs = 100 } = {}) {
    this.model = model;
    this.title = title;
    this.isOpen = open;
    this.rows = new Map();
    const el = (tag, css, text) => {
      const e = document.createElement(tag);
      if (css) e.style.cssText = css;
      if (text !== undefined) e.textContent = text;
      return e;
    };
    this.root = el('div', 'position:fixed;top:8px;right:8px;width:460px;max-height:calc(100vh - 16px);overflow:hidden;padding:8px 10px;' +
      'background:rgba(8,10,18,.82);color:#cfd6e6;font:11px/1.35 ui-monospace,Consolas,monospace;border-radius:6px;z-index:2147483000;pointer-events:none;');
    this.root.dataset.debugOverlay = '';
    const head = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;');
    head.append(el('b', 'color:#fff', this.title));
    const buttons = el('span', 'pointer-events:auto;');
    const button = (label, fn) => {
      const b = el('button', 'font:inherit;margin-left:4px;padding:0 6px;background:#1d2338;color:#cfd6e6;border:1px solid #394264;border-radius:3px;cursor:pointer;', label);
      b.addEventListener('click', fn);
      return b;
    };
    this.pauseButton = button('pause packets', () => { model.packets.paused = !model.packets.paused; this.refresh(); });
    buttons.append(this.pauseButton, button('clear', () => { model.packets.clear(); this.refresh(); }), button('F3 hide', () => this.close()));
    head.append(buttons);
    this.graphBox = el('div');
    this.infoBox = el('div', 'margin:4px 0;white-space:pre;color:#aab3cc;');
    this.packetHead = el('div', 'margin-top:4px;color:#fff;');
    this.packetBox = el('pre', 'margin:2px 0 0;font:inherit;white-space:pre;overflow:hidden;color:#b7c0d8;');
    this.root.append(head, this.graphBox, this.infoBox, this.packetHead, this.packetBox);
    parent.append(this.root);

    this.onKey = (e) => { if (hotkey && e.code === hotkey) { e.preventDefault(); this.toggle(); } };
    if (hotkey) addEventListener('keydown', this.onKey);
    this.timer = setInterval(() => { this.model.sample(); if (this.isOpen) this.refresh(); }, intervalMs);
    this.root.style.display = open ? '' : 'none';
    this.rowCount = 0;
  }

  /** Convenience passthroughs so callers can configure the overlay directly. */
  addSeries(name, def) { this.model.addSeries(name, def); return this; }
  addInfo(label, read) { this.model.addInfo(label, read); return this; }
  tap(transport) { return this.model.tap(transport); }

  open() { this.isOpen = true; this.root.style.display = ''; this.refresh(); }
  close() { this.isOpen = false; this.root.style.display = 'none'; }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  #row(name, def, index) {
    let row = this.rows.get(name);
    if (row) return row;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin:3px 0;';
    const text = document.createElement('div');
    text.style.cssText = 'display:flex;justify-content:space-between;white-space:pre;';
    const label = document.createElement('span');
    label.textContent = def.label;
    label.style.color = def.color ?? COLORS[index % COLORS.length];
    const value = document.createElement('span');
    text.append(label, value);
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:440px;height:28px;';
    wrap.append(text, canvas);
    this.graphBox.append(wrap);
    row = { wrap, value, canvas, color: def.color ?? COLORS[index % COLORS.length] };
    this.rows.set(name, row);
    return row;
  }

  /** Redraw everything from the model now. */
  refresh() {
    const dpr = window.devicePixelRatio || 1;
    let i = 0;
    for (const [name, s] of this.model.series) {
      const row = this.#row(name, s.def, i++);
      const st = s.data.stats();
      row.value.textContent = `${fmt(st.last, s.def.decimals)} ${s.def.unit}  avg ${fmt(st.avg, s.def.decimals)}  max ${fmt(st.max, s.def.decimals)}`;
      const c = row.canvas;
      const w = Math.round(440 * dpr), h = Math.round(28 * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, 440, 28);
      drawGraph(ctx, s.data, { x: 0, y: 0, w: 440, h: 28 }, { color: row.color, min: s.def.min ?? 0, max: s.def.max ?? null, warnAbove: s.def.warnAbove ?? null });
    }
    this.infoBox.textContent = this.model.infoLines().map(([k, v]) => `${k.padEnd(9)} ${v}`).join('\n');

    const p = this.model.packets;
    const inT = p.total('in'), outT = p.total('out');
    this.packetHead.textContent = `packets  in ${inT.count} (${(inT.bytes / 1024).toFixed(1)} KB)  out ${outT.count} (${(outT.bytes / 1024).toFixed(1)} KB)${p.paused ? '  [paused]' : ''}`;
    this.pauseButton.textContent = p.paused ? 'resume packets' : 'pause packets';
    const t0 = this.model.startedAt;
    const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    this.packetBox.textContent = p.entries(14).map((e) =>
      clip(`${((e.time - t0) / 1000).toFixed(2).padStart(7)}s ${e.dir === 'in' ? '<' : '>'} ${e.channel === 0 ? 'R' : 'U'} ${e.type.padEnd(8)} ${String(e.size).padStart(5)}B  ${e.summary}`, 72),
    ).join('\n');
  }

  destroy() {
    clearInterval(this.timer);
    removeEventListener('keydown', this.onKey);
    this.root.remove();
  }
}
