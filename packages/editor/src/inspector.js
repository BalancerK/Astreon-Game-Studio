// What the inspector shows for an entity, worked out from the prefab and the entity's own values, and how a typed value becomes an edit.
// Everything is data (`{path, label, type, value, ...}`), so the page only has to draw inputs and call `applyField`.
import { effectiveSpec } from './visuals.js';
import { atRotation, eulerFromQuat, quatFromEuler } from './transform.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const get = (o, path) => path.split('.').reduce((a, k) => (a === undefined || a === null ? undefined : a[k]), o);

/** Leaf fields of a nested object: numbers, booleans, strings, short number arrays (vectors) and anything else as JSON. */
function leaves(prefix, value, out, base, own) {
  if (isObject(value)) { for (const [k, v] of Object.entries(value)) leaves(`${prefix}.${k}`, v, out, base, own); return; }
  const path = `overrides.${prefix}`;
  const ov = get(own, path);
  let type = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'bool' : typeof value === 'string' ? 'string'
    : Array.isArray(value) && value.length >= 2 && value.length <= 4 && value.every((n) => typeof n === 'number') ? 'vec' : 'json';
  out.push({ path, label: prefix.split('.').slice(2).join('.') || prefix, type, value: ov !== undefined ? ov : value, base: value, overridden: ov !== undefined });
}

/**
 * What the inspector shows for an entity: sections of fields (transform, the prefab's parameters, components, extras) with their
 * values, the prefab's own values and which are overridden.
 *
 * @param {import('../../scene/src/document.js').SceneDocument} doc
 * @param {string} id
 * @param {{library: import('../../prefab/src/library.js').PrefabLibrary}} o
 * @returns {{id: string, prefab: string, error: string | null, sections: Array<{title: string, fields: any[]}>} | null}
 */
export function inspect(doc, id, { library }) {
  const e = doc.get(id);
  if (!e) return null;
  const sections = [];
  const at = e.at ?? {};
  const eul = eulerFromQuat(atRotation(at));
  sections.push({
    title: 'Entity',
    fields: [
      { path: 'id', label: 'id', type: 'id', value: e.id, base: e.id },
      { path: 'name', label: 'name', type: 'string', value: e.name ?? '', base: '', overridden: e.name !== undefined },
      { path: 'prefab', label: 'prefab', type: 'readonly', value: e.prefab },
      { path: 'parent', label: 'parent', type: 'readonly', value: e.parent ?? '(none)' },
      { path: 'disabled', label: 'disabled', type: 'bool', value: !!e.disabled, base: false, overridden: e.disabled !== undefined },
    ],
  });
  sections.push({
    title: 'Transform',
    fields: [
      { path: 'at.position', label: 'position', type: 'vec3', value: [at.x ?? 0, at.y ?? 0, at.z ?? 0], base: [0, 0, 0] },
      { path: 'at.euler', label: 'rotation (°)', type: 'vec3', value: eul.map((v) => Math.round(v * 1000) / 1000), base: [0, 0, 0] },
      { path: 'at.scale', label: 'scale', type: 'number', value: at.scale ?? 1, base: 1, overridden: at.scale !== undefined, step: 0.05 },
    ],
  });
  let spec, error = null;
  try { spec = effectiveSpec(library, e); } catch (x) { error = x.message; }
  if (spec) {
    const base = library.resolve(e.prefab);
    const params = Object.entries(base.params ?? {});
    if (params.length) {
      sections.push({
        title: 'Parameters',
        fields: params.map(([name, target]) => {
          const dflt = get(base, target), own = e.params?.[name];
          return { path: `params.${name}`, label: name, type: typeof dflt === 'boolean' ? 'bool' : typeof dflt === 'string' ? 'string' : 'number', value: own !== undefined ? own : dflt, base: dflt, overridden: own !== undefined, hint: target };
        }),
      });
    }
    for (const [cn, values] of Object.entries(spec.components ?? {})) {
      if (cn === 'transform') continue;
      const fields = [];
      const keys = Object.keys(values);
      const isColour = ['r', 'g', 'b'].every((k) => keys.includes(k)) && keys.every((k) => ['r', 'g', 'b', 'a'].includes(k));
      for (const [f, v] of Object.entries(values)) {
        const path = `overrides.components.${cn}.${f}`, ov = get(e, path);
        fields.push({ path, label: f, type: typeof v === 'boolean' ? 'bool' : typeof v === 'string' ? 'string' : 'number', value: ov !== undefined ? ov : v, base: get(base, `components.${cn}.${f}`), overridden: ov !== undefined, step: isColour ? 0.01 : undefined, min: isColour ? 0 : undefined, max: isColour ? 1 : undefined });
      }
      sections.push({ title: cn, kind: isColour ? 'colour' : 'component', fields });
    }
    for (const [key, value] of Object.entries(spec.extras ?? {})) {
      const fields = [];
      leaves(`extras.${key}`, value, fields, base, e);
      if (fields.length) sections.push({ title: `extras: ${key}`, kind: 'extras', fields: fields.map((f) => ({ ...f, base: get(base, f.path.replace(/^overrides\./, '')), overridden: get(e, f.path) !== undefined })) });
    }
    if ((spec.children ?? []).length) sections.push({ title: 'Parts', kind: 'info', fields: spec.children.map((c) => ({ path: `parts.${c.name}`, label: c.name, type: 'readonly', value: c.prefab ?? '(inline)' })) });
  }
  return { id, prefab: e.prefab, error, sections };
}

const num = (v) => { const n = typeof v === 'number' ? v : Number(String(v).trim()); if (!Number.isFinite(n)) throw new Error(`"${v}" is not a number`); return n; };

/** Turn what was typed into the value the field needs. Throws a message fit to show next to the input. */
export function parseValue(field, raw) {
  switch (field.type) {
    case 'number': return num(raw);
    case 'bool': return raw === true || raw === 'true' || raw === 'on' || raw === 1;
    case 'string': case 'id': return String(raw);
    case 'vec': case 'vec3': {
      const arr = Array.isArray(raw) ? raw.map(num) : String(raw).split(/[\s,]+/).filter(Boolean).map(num);
      if (arr.length !== field.value.length) throw new Error(`needs ${field.value.length} numbers`);
      return arr;
    }
    case 'json': try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { throw new Error(`not valid JSON (${e.message})`); }
    default: throw new Error(`${field.label} cannot be edited`);
  }
}

/**
 * Apply an edit from the inspector as one undoable step. `merge` folds a series of changes (dragging a number) into one step.
 * @returns {void}
 */
export function applyField(doc, id, field, raw, { merge } = {}) {
  const value = parseValue(field, raw);
  const e = doc.get(id);
  const label = `Edit ${field.label}`;
  if (field.path === 'id') { if (value !== id) doc.rename(id, value); return; }
  if (field.path === 'at.position') { doc.update(id, { at: { x: value[0], y: value[1], z: value[2] } }, { merge, label }); return; }
  if (field.path === 'at.euler') {
    const q = quatFromEuler(value);
    const identity = Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2]) < 1e-9;
    doc.update(id, { at: { rotation: identity ? null : q.map((v) => Math.round(v * 1e7) / 1e7), yaw: null } }, { merge, label });
    return;
  }
  if (field.path === 'name') { doc.update(id, { name: value === '' ? null : value }, { merge, label }); return; }
  if (field.path === 'disabled') { doc.update(id, { disabled: value ? true : null }, { merge, label }); return; }
  doc.set(id, field.path, value, { merge, label });
  void e;
}

/** Put a field back to what the prefab says (removes the entity's own value). */
export function resetField(doc, id, field) {
  if (field.path === 'at.position') doc.update(id, { at: { x: null, y: null, z: null } });
  else if (field.path === 'at.euler') doc.update(id, { at: { rotation: null, yaw: null } });
  else doc.set(id, field.path, null, { label: `Reset ${field.label}` });
}
