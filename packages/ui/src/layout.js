// Flexbox-style layout for the widget tree: rows, columns and stacks with gaps, padding, growth, alignment and anchoring.
// Two passes per container: the natural size of each child, then placement (growing children share what is left).

const visible = (w) => w.visible;
const num = (v) => typeof v === 'number';

/**
 * The size a widget would like, given that it may be at most `maxWidth` wide (so wrapped text gets taller as it gets narrower).
 * @returns {{w: number, h: number}}
 */
export function naturalSize(ui, wd, maxWidth = Infinity) {
  const s = wd.style, p = wd.pad;
  const outerMax = num(s.width) ? s.width : Math.min(maxWidth, s.maxWidth ?? Infinity);
  const innerMax = outerMax - p.l - p.r;
  const kids = wd.children.filter(visible);
  let w = 0, h = 0;
  if (kids.length === 0) {
    const m = wd.measure(ui, innerMax);
    w = m.w; h = m.h;
  } else {
    const dir = s.direction ?? 'column', gap = s.gap ?? 0;
    const sizes = kids.map((k) => naturalSize(ui, k, innerMax));
    if (dir === 'stack') {
      for (const m of sizes) { w = Math.max(w, m.w); h = Math.max(h, m.h); }
    } else if (dir === 'row') {
      for (const m of sizes) { w += m.w; h = Math.max(h, m.h); }
      w += gap * (kids.length - 1);
    } else {
      for (const m of sizes) { w = Math.max(w, m.w); h += m.h; }
      h += gap * (kids.length - 1);
    }
  }
  w += p.l + p.r; h += p.t + p.b;
  if (num(s.width)) w = s.width;
  if (num(s.height)) h = s.height;
  return { w: clamp(w, s.minWidth, s.maxWidth), h: clamp(h, s.minHeight, s.maxHeight) };
}

function clamp(v, lo = -Infinity, hi = Infinity) { return Math.min(hi, Math.max(lo, v)); }

/** Place a widget in the box (x, y, w, h) and lay its children out inside it. */
export function arrange(ui, wd, x, y, w, h) {
  wd.x = x; wd.y = y; wd.w = w; wd.h = h;
  const kids = wd.children.filter(visible);
  for (const k of wd.children) if (!k.visible) { k.w = 0; k.h = 0; }
  if (kids.length === 0) return;
  const s = wd.style, p = wd.pad;
  const ix = x + p.l, iy = y + p.t, iw = Math.max(0, w - p.l - p.r), ih = Math.max(0, h - p.t - p.b);
  const dir = s.direction ?? 'column';
  if (dir === 'stack') { for (const k of kids) placeAnchored(ui, k, ix, iy, iw, ih); return; }

  const row = dir === 'row', gap = s.gap ?? 0, align = s.align ?? 'stretch', justify = s.justify ?? 'start';
  const mainSpace = row ? iw : ih, crossSpace = row ? ih : iw;
  const nat = kids.map((k) => naturalSize(ui, k, iw));
  const main = nat.map((m) => (row ? m.w : m.h));
  const fillsMain = (k) => k.style[row ? 'width' : 'height'] === 'fill';
  for (let i = 0; i < kids.length; i++) if (fillsMain(kids[i])) main[i] = 0; // 'fill' shares the room equally, whatever the content (like flex: 1 1 0)
  const grow = kids.map((k) => k.style.grow ?? (fillsMain(k) ? 1 : 0));
  const growSum = grow.reduce((a, b) => a + b, 0);
  const free = mainSpace - main.reduce((a, b) => a + b, 0) - gap * (kids.length - 1);
  if (growSum > 0 && free > 0) for (let i = 0; i < kids.length; i++) main[i] += (free * grow[i]) / growSum;
  else if (free < 0) shrink(kids, main, -free, row); // too much content: shrink the children that may (text wraps, fills give way)

  const used = main.reduce((a, b) => a + b, 0) + gap * (kids.length - 1);
  let pos = 0, between = gap;
  const slack = Math.max(0, mainSpace - used);
  if (!(growSum > 0 && free > 0)) {
    if (justify === 'center') pos = slack / 2;
    else if (justify === 'end') pos = slack;
    else if (justify === 'between' && kids.length > 1) between = gap + slack / (kids.length - 1);
  }
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i], ks = k.style;
    const a = ks.alignSelf ?? align;
    // the cross size is measured again at the final main size, because wrapped text changes height with width
    let cross;
    if (row) {
      const again = naturalSize(ui, k, main[i]);
      cross = a === 'stretch' && !num(ks.height) ? crossSpace : again.h;
    } else {
      cross = a === 'stretch' && !num(ks.width) ? iw : nat[i].w;
      if (ks.width === 'fill') cross = iw;
    }
    if (row ? ks.height === 'fill' : ks.width === 'fill') cross = crossSpace;
    cross = clamp(cross, row ? ks.minHeight : ks.minWidth, row ? ks.maxHeight : ks.maxWidth);
    const offset = a === 'center' ? (crossSpace - cross) / 2 : a === 'end' ? crossSpace - cross : 0;
    const m = main[i];
    if (row) arrange(ui, k, ix + pos, iy + offset, m, cross);
    else arrange(ui, k, ix + offset, iy + pos, cross, m);
    pos += m + between;
  }
}

/**
 * Take `deficit` pixels back from children along the main axis: first from the ones that fill, then from content-sized ones
 * (never below their minimum). A child with a fixed number for its size keeps it unless it says `shrink: true`; if that is not
 * enough the content simply overflows.
 */
function shrink(kids, main, deficit, row) {
  const key = row ? 'width' : 'height';
  const floor = kids.map((k) => k.style[row ? 'minWidth' : 'minHeight'] ?? 0);
  for (let pass = 0; pass < 2 && deficit > 0.01; pass++) {
    const give = kids.map((k, i) => {
      const fixed = typeof k.style[key] === 'number' && k.style.shrink !== true;
      const eligible = pass === 0 ? k.style[key] === 'fill' : !fixed;
      return eligible ? Math.max(0, main[i] - floor[i]) : 0;
    });
    const total = give.reduce((x, y) => x + y, 0);
    if (total <= 0) continue;
    const take = Math.min(deficit, total);
    for (let i = 0; i < kids.length; i++) main[i] -= (take * give[i]) / total;
    deficit -= take;
  }
  for (let i = 0; i < kids.length; i++) main[i] = Math.max(main[i], floor[i]);
}

const ANCHORS = {
  center: [0.5, 0.5], top: [0.5, 0], bottom: [0.5, 1], left: [0, 0.5], right: [1, 0.5],
  'top-left': [0, 0], 'top-right': [1, 0], 'bottom-left': [0, 1], 'bottom-right': [1, 1],
};

function placeAnchored(ui, k, ix, iy, iw, ih) {
  const s = k.style, anchor = s.anchor ?? 'fill';
  const ox = s.offsetX ?? 0, oy = s.offsetY ?? 0;
  if (anchor === 'fill') { arrange(ui, k, ix + ox, iy + oy, iw, ih); return; }
  const a = ANCHORS[anchor];
  if (!a) throw new Error(`unknown anchor "${anchor}"`);
  const m = naturalSize(ui, k, iw);
  const w = s.width === 'fill' ? iw : Math.min(m.w, iw), h = s.height === 'fill' ? ih : Math.min(naturalSize(ui, k, w).h, ih);
  arrange(ui, k, ix + (iw - w) * a[0] + ox, iy + (ih - h) * a[1] + oy, w, h);
}
