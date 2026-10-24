// The layout of the studio's panels, as plain data and pure functions (nothing here touches the page, so it is tested in Node).
//
// A layout is a tree. A `tabs` node is a group of panels shown as tabs, one visible at a time. A `split` node places two or more nodes side by side
// (`row`) or one above the other (`column`) with a share of the room each (`sizes`, adding up to 1).
//
//   { type: 'split', id: 's1', dir: 'row', sizes: [0.25, 0.75], children: [
//       { type: 'tabs', id: 't1', panels: ['files'], active: 'files' },
//       { type: 'tabs', id: 't2', panels: ['editor', 'game'], active: 'editor' } ] }
//
// Every function returns a new tree and leaves its input alone. A `null` layout is an empty one.

const MIN_SHARE = 0.06;                // no panel can be squeezed below this share of its split
const MAX_DEPTH = 8;                   // a saved layout nested deeper than this is not believable

/** @typedef {{type: 'tabs', id: string, panels: string[], active: string | null}} Tabs */
/** @typedef {{type: 'split', id: string, dir: 'row' | 'column', sizes: number[], children: Node[]}} Split */
/** @typedef {Tabs | Split} Node */

const clone = (tree) => (tree === null ? null : structuredClone(tree));

/** Every node, parents before children. */
export function* walk(tree) {
  if (!tree) return;
  yield tree;
  if (tree.type === 'split') for (const child of tree.children) yield* walk(child);
}

/** All the panel ids in the layout, in reading order. */
export const panelIds = (tree) => [...walk(tree)].filter((n) => n.type === 'tabs').flatMap((n) => n.panels);

/** The tabs group that holds a panel, or undefined. */
export const groupOf = (tree, panelId) => [...walk(tree)].find((n) => n.type === 'tabs' && n.panels.includes(panelId));

export const nodeById = (tree, id) => [...walk(tree)].find((n) => n.id === id);

/** A new id that no node of the tree uses. */
function freshId(tree, prefix) {
  const used = new Set([...walk(tree)].map((n) => n.id));
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

/**
 * Tidy a tree: drop empty groups, replace a split of one thing by that thing, merge a split inside a split of the same direction, make the shares add up
 * to 1 and make sure every group shows a panel that it has.
 * @param {Node | null} tree @returns {Node | null}
 */
export function normalize(tree) {
  if (!tree) return null;
  if (tree.type === 'tabs') {
    if (tree.panels.length === 0) return null;
    return { ...tree, active: tree.panels.includes(tree.active) ? tree.active : tree.panels[0] };
  }
  const kids = [];
  const sizes = [];
  tree.children.forEach((child, i) => {
    const n = normalize(child);
    if (!n) return;
    const share = tree.sizes[i] > 0 ? tree.sizes[i] : 1 / tree.children.length;
    if (n.type === 'split' && n.dir === tree.dir) {                       // a row inside a row is just more of the row
      n.children.forEach((c, k) => { kids.push(c); sizes.push(share * n.sizes[k]); });
    } else {
      kids.push(n);
      sizes.push(share);
    }
  });
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0];
  const total = sizes.reduce((a, b) => a + b, 0);
  return { ...tree, children: kids, sizes: sizes.map((s) => s / total) };
}

/** Make the panel the visible tab of its group. */
export function activate(tree, panelId) {
  const next = clone(tree);
  const g = groupOf(next, panelId);
  if (g) g.active = panelId;
  return next;
}

/**
 * Put a panel in the layout. By default it joins the group named by `near` (a panel id or group id), else the first group; in an empty layout it starts one.
 * A panel that is already in the layout is moved there instead.
 */
export function addPanel(tree, panelId, { near, activate: show = true } = {}) {
  let next = groupOf(tree, panelId) ? removePanel(tree, panelId) : clone(tree);
  if (!next) return { type: 'tabs', id: 't1', panels: [panelId], active: panelId };
  const target = (near && (groupOf(next, near) ?? nodeById(next, near))) || [...walk(next)].find((n) => n.type === 'tabs');
  if (!target || target.type !== 'tabs') {
    const fresh = { type: 'tabs', id: freshId(next, 't'), panels: [panelId], active: panelId };
    next = { type: 'split', id: freshId(next, 's'), dir: 'row', sizes: [0.7, 0.3], children: [next, fresh] };
    return normalize(next);
  }
  target.panels.push(panelId);
  if (show) target.active = panelId;
  return normalize(next);
}

/** Take a panel out of the layout (the layout is tidied afterwards). */
export function removePanel(tree, panelId) {
  const next = clone(tree);
  const g = groupOf(next, panelId);
  if (g) g.panels = g.panels.filter((p) => p !== panelId);
  return normalize(next);
}

/**
 * Move a panel next to or into another group.
 * @param {Node | null} tree
 * @param {string} panelId
 * @param {string} targetGroupId a `tabs` node id
 * @param {'center' | 'left' | 'right' | 'top' | 'bottom'} zone center: join the group's tabs (at `index`, else the end); an edge: split the group and put the panel in the new half
 * @param {number} [index]
 */
export function movePanel(tree, panelId, targetGroupId, zone, index) {
  const next = clone(tree);
  const source = groupOf(next, panelId);
  const target = nodeById(next, targetGroupId);
  if (!source || !target || target.type !== 'tabs') return normalize(next);
  if (zone === 'center') {
    const from = source.panels.indexOf(panelId);
    source.panels.splice(from, 1);
    let at = index === undefined ? target.panels.length : index;
    if (source === target && index !== undefined && from < index) at -= 1;                       // the list got shorter before the place
    at = Math.max(0, Math.min(at, target.panels.length));
    target.panels.splice(at, 0, panelId);
    target.active = panelId;
    return normalize(next);
  }
  if (source === target && source.panels.length === 1) return normalize(next);                      // nothing to split off
  source.panels = source.panels.filter((p) => p !== panelId);
  const fresh = { type: 'tabs', id: freshId(next, 't'), panels: [panelId], active: panelId };
  const dir = zone === 'left' || zone === 'right' ? 'row' : 'column';
  const first = zone === 'left' || zone === 'top';
  const pair = first ? [fresh, { ...target }] : [{ ...target }, fresh];
  const replacement = { type: 'split', id: freshId(next, 's'), dir, sizes: [0.5, 0.5], children: pair };
  if (next === target) return normalize(replacement);
  for (const n of walk(next)) {
    if (n.type !== 'split') continue;
    const i = n.children.indexOf(target);
    if (i >= 0) { n.children[i] = replacement; break; }
  }
  return normalize(next);
}

/** Move the edge between two neighbours of a split by `delta` (a share of the split: 0.05 is five per cent), within the limits. */
export function resize(tree, splitId, index, delta) {
  const next = clone(tree);
  const s = nodeById(next, splitId);
  if (!s || s.type !== 'split' || index < 0 || index >= s.children.length - 1) return next;
  const pair = s.sizes[index] + s.sizes[index + 1];
  const a = Math.min(pair - MIN_SHARE, Math.max(MIN_SHARE, s.sizes[index] + delta));
  s.sizes[index] = a;
  s.sizes[index + 1] = pair - a;
  return next;
}

/** Make the group's tab order as given (ids not in the group are ignored, ids left out keep their place at the end). */
export function reorderTabs(tree, groupId, order) {
  const next = clone(tree);
  const g = nodeById(next, groupId);
  if (g?.type === 'tabs') {
    const known = order.filter((p) => g.panels.includes(p));
    g.panels = [...known, ...g.panels.filter((p) => !known.includes(p))];
  }
  return next;
}

/**
 * Which part of a group a pointer is over when dragging a panel: the middle joins the tabs, a band along an edge splits that side.
 * @param {{width: number, height: number}} size the group's size @param {number} x pointer position inside the group @param {number} y
 * @returns {'center' | 'left' | 'right' | 'top' | 'bottom'}
 */
export function dropZone({ width, height }, x, y) {
  const band = 0.25;
  const nx = x / width;
  const ny = y / height;
  if (nx > band && nx < 1 - band && ny > band && ny < 1 - band) return 'center';
  // the nearest edge wins, measured as a share of the side
  const d = { left: nx, right: 1 - nx, top: ny, bottom: 1 - ny };
  return /** @type {any} */ (Object.entries(d).sort((a, b) => a[1] - b[1])[0][0]);
}

/**
 * Repair a layout that was saved earlier (or by another version of the studio, or edited by hand): drop what cannot be shown and fix the shares.
 * Panels that are not in `known` are removed; a panel listed twice stays in its first place; nodes of a kind the studio does not know are dropped.
 * @param {unknown} data @param {Set<string> | string[]} known
 * @returns {Node | null}
 */
/** How deep a saved tree goes (counting stops a little past the limit, so even absurd data costs nothing). */
function depthOf(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return depth;
  if (!Array.isArray(node.children)) return depth + 1;
  return Math.max(depth + 1, ...node.children.map((c) => depthOf(c, depth + 1)));
}

export function repair(data, known) {
  if (depthOf(data) > MAX_DEPTH) return null;                         // nested further than any real layout: not worth saving
  const allowed = new Set(known);
  const seen = new Set();
  const ids = new Set();
  const uniqueId = (wanted, prefix) => {
    let id = typeof wanted === 'string' && /^[a-z][a-z0-9-]{0,20}$/i.test(wanted) && !ids.has(wanted) ? wanted : null;
    for (let i = 1; !id; i++) if (!ids.has(`${prefix}${i}`)) id = `${prefix}${i}`;
    ids.add(id);
    return id;
  };
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return null;
    if (node.type === 'tabs' && Array.isArray(node.panels)) {
      const panels = node.panels.filter((p) => typeof p === 'string' && allowed.has(p) && !seen.has(p) && seen.add(p));
      return { type: 'tabs', id: uniqueId(node.id, 't'), panels, active: panels.includes(node.active) ? node.active : (panels[0] ?? null) };
    }
    if (node.type === 'split' && Array.isArray(node.children) && (node.dir === 'row' || node.dir === 'column')) {
      const children = [];
      const sizes = [];
      node.children.forEach((c, i) => {
        const v = visit(c, depth + 1);
        if (!v) return;
        children.push(v);
        sizes.push(Number.isFinite(node.sizes?.[i]) && node.sizes[i] > 0 ? node.sizes[i] : 1);
      });
      if (!children.length) return null;
      const total = sizes.reduce((a, b) => a + b, 0);
      return { type: 'split', id: uniqueId(node.id, 's'), dir: node.dir, sizes: sizes.map((s) => s / total), children };
    }
    return null;
  };
  return normalize(visit(data, 0));
}

/**
 * Make sure certain panels are in the layout: each missing one joins the group of its preferred neighbour, else the first group.
 * @param {Node | null} tree @param {Record<string, string | undefined>} required panel id -> a panel it likes to sit with
 */
export function ensurePanels(tree, required) {
  let next = tree;
  for (const [panel, neighbour] of Object.entries(required)) {
    if (!groupOf(next, panel)) next = addPanel(next, panel, { near: neighbour, activate: false });
  }
  return next;
}
