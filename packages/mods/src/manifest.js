import { parseVersion } from '../../core/src/index.js';

/**
 * A mod's `mod.json`. Strict on purpose: unknown fields are errors, so typos do not silently do nothing and
 * a manifest cannot smuggle in fields a future version might interpret.
 *
 * @typedef {Object} ModManifest
 * @property {string} id Lowercase id; namespaces everything the mod adds.
 * @property {string} version `x.y.z`
 * @property {string} [engine] Engine version range, e.g. `^0.0.1`.
 * @property {string} [name]
 * @property {string} [description]
 * @property {string} [author]
 * @property {'data' | 'script'} tier
 * @property {string} [entry] Script file (tier `script` only).
 * @property {Record<string, string>} [dependencies] Other mod ids -> version ranges.
 * @property {Record<string, any>} [rules] Tier 1: rule values (the game whitelists and range-checks them).
 * @property {Record<string, any>} [client] Presentation data sent to clients (the game whitelists it).
 * @property {{tickBudgetMs?: number, memoryMb?: number, tickEvery?: number}} [limits] What the mod asks for; the server policy clamps it.
 */

const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const RANGE_RE = /^(\*|\^?\d+\.\d+\.\d+|>=\d+\.\d+\.\d+)$/;
const KNOWN = new Set(['id', 'version', 'engine', 'name', 'description', 'author', 'tier', 'entry', 'dependencies', 'rules', 'client', 'limits']);
const LIMIT_KEYS = new Set(['tickBudgetMs', 'memoryMb', 'tickEvery']);
const PATH_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

/** Maximum sizes, so a manifest cannot be used to burn memory. */
export const MANIFEST_LIMITS = Object.freeze({ text: 512, rulesJsonBytes: 4096, clientJsonBytes: 8192, dependencies: 16 });

/**
 * Check a parsed `mod.json`: ids, versions, permissions, limits, files. Returns the manifest, or every problem found.
 *
 * @param {any} value Parsed JSON
 * @returns {{ok: true, manifest: ModManifest, errors: []} | {ok: false, manifest: null, errors: string[]}}
 */
export function validateManifest(value) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, manifest: null, errors: ['manifest must be a JSON object'] };
  for (const k of Object.keys(value)) if (!KNOWN.has(k)) err(`unknown field "${k}"`);

  if (typeof value.id !== 'string' || !ID_RE.test(value.id)) err('id must be 1-32 chars: lowercase letters, digits, dashes, starting with a letter');
  if (typeof value.version !== 'string') err('version is required (x.y.z)'); else { try { parseVersion(value.version); } catch (e) { err(e.message); } }
  if (value.engine !== undefined && !(typeof value.engine === 'string' && RANGE_RE.test(value.engine))) err('engine must be a version range like "^0.0.1", ">=0.0.1" or "*"');
  for (const k of ['name', 'description', 'author']) {
    if (value[k] !== undefined && (typeof value[k] !== 'string' || value[k].length > MANIFEST_LIMITS.text)) err(`${k} must be a string of at most ${MANIFEST_LIMITS.text} characters`);
  }
  if (value.tier !== 'data' && value.tier !== 'script') err('tier must be "data" or "script"');
  if (value.tier === 'script') {
    if (typeof value.entry !== 'string' || !PATH_RE.test(value.entry) || !value.entry.endsWith('.js')) err('entry must be a relative .js path (no "..", no absolute paths)');
  } else if (value.entry !== undefined) err('entry is only allowed for tier "script"');
  if (value.dependencies !== undefined) {
    const d = value.dependencies;
    if (d === null || typeof d !== 'object' || Array.isArray(d)) err('dependencies must be an object of id -> range');
    else {
      if (Object.keys(d).length > MANIFEST_LIMITS.dependencies) err(`at most ${MANIFEST_LIMITS.dependencies} dependencies`);
      for (const [id, range] of Object.entries(d)) {
        if (!ID_RE.test(id)) err(`dependency id "${id}" is invalid`);
        if (typeof range !== 'string' || !RANGE_RE.test(range)) err(`dependency "${id}" has an invalid range`);
      }
    }
  }
  for (const [key, max] of [['rules', MANIFEST_LIMITS.rulesJsonBytes], ['client', MANIFEST_LIMITS.clientJsonBytes]]) {
    if (value[key] === undefined) continue;
    if (value[key] === null || typeof value[key] !== 'object' || Array.isArray(value[key])) { err(`${key} must be an object`); continue; }
    let size = 0;
    try { size = JSON.stringify(value[key]).length; } catch { err(`${key} must be plain JSON`); }
    if (size > max) err(`${key} is too large (${size} > ${max} bytes)`);
  }
  if (value.limits !== undefined) {
    const l = value.limits;
    if (l === null || typeof l !== 'object' || Array.isArray(l)) err('limits must be an object');
    else {
      for (const [k, v] of Object.entries(l)) {
        if (!LIMIT_KEYS.has(k)) err(`unknown limit "${k}"`);
        else if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) err(`limit ${k} must be a positive number`);
      }
    }
  }
  return errors.length ? { ok: false, manifest: null, errors } : { ok: true, manifest: value, errors: [] };
}
