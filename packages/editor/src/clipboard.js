// Copy and paste of entities (with everything below them) as text, so it also works between editor windows and scenes.
const FORMAT = 'engine-scene-clip';

const clone = (v) => JSON.parse(JSON.stringify(v));

/** The text for the clipboard: the given entities and their descendants. Pass the selection's roots. */
export function copyText(doc, ids) {
  const all = [];
  for (const id of ids) for (const s of doc.subtree(id)) if (!all.includes(s)) all.push(s);
  const order = doc.order.filter((id) => all.includes(id));
  return JSON.stringify({ format: FORMAT, roots: ids.filter((id) => doc.has(id)), entities: order.map((id) => clone(doc.get(id))) });
}

/**
 * Paste text made by `copyText`: fresh ids, internal parents kept, the pasted roots placed under `parent` (default: where they were copied from)
 * and moved by `offset`. One undo step. @returns {string[]} the ids of the new roots (empty if the text is not a clip)
 */
export function pasteText(doc, text, { parent, offset = { x: 1, y: 0, z: 1 } } = {}) {
  let clip;
  try { clip = JSON.parse(text); } catch { return []; }
  if (clip?.format !== FORMAT || !Array.isArray(clip.entities)) return [];
  return doc.batch('Paste', () => {
    const names = new Map();
    for (const e of clip.entities) {
      let id = e.id.replace(/-\d+$/, '') || 'entity';
      id = doc.freeId(id);
      // free ids must also differ from each other
      while ([...names.values()].includes(id)) id = doc.freeId(`${id}-x`);
      names.set(e.id, id);
    }
    const roots = [];
    for (const e of clip.entities) {
      const isRoot = !names.has(e.parent);
      const spec = clone(e);
      spec.id = names.get(e.id);
      spec.parent = isRoot ? (parent !== undefined ? parent : (e.parent && doc.has(e.parent) ? e.parent : null)) : names.get(e.parent);
      if (isRoot && offset) spec.at = { ...(spec.at ?? {}), x: (spec.at?.x ?? 0) + (offset.x ?? 0), y: (spec.at?.y ?? 0) + (offset.y ?? 0), z: (spec.at?.z ?? 0) + (offset.z ?? 0) };
      if (spec.parent !== null && !doc.has(spec.parent)) spec.parent = null;
      doc.add(spec);
      if (isRoot) roots.push(spec.id);
    }
    return roots;
  });
}
