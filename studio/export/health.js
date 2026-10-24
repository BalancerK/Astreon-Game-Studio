// The web-health report: how big the game is to download, how long it takes to show a first picture, how much of each frame it uses, how much memory it holds,
// and whether that is inside the limits (budgets) the person set. Pure functions: the studio measures, these turn the numbers into a report. A device slower
// than this computer is a guess (the cost per frame is multiplied by a factor you choose), and the report says so.

const enc = new TextEncoder();

/** The size in bytes of a file's text. */
export const bytesOf = (text) => (typeof text === 'string' ? enc.encode(text).length : (text?.length ?? 0));

/** What kind of file this is, for the size breakdown. */
export function kindOf(path) {
  if (path.startsWith('engine/')) return 'engine';
  if (/(^|\/)art\//.test(path)) return 'art';
  if (/sounds\.js$/.test(path)) return 'sounds';
  if (/\.js$/.test(path)) return 'code';
  return 'other';
}

/**
 * The size of a set of files, raw and compressed.
 * @param {Record<string, string | Uint8Array>} files
 * @param {(bytes: Uint8Array) => Promise<number>} compressedSize the size after gzip (the studio uses the browser's own; tests use zlib)
 * @returns {Promise<{files: number, rawBytes: number, gzipBytes: number, byKind: Record<string, {files: number, rawBytes: number}>, largest: {path: string, bytes: number}[]}>}
 */
export async function sizeReport(files, compressedSize) {
  const entries = Object.entries(files).map(([path, content]) => ({ path, bytes: bytesOf(content), content }));
  const byKind = {};
  for (const e of entries) {
    const k = byKind[kindOf(e.path)] ??= { files: 0, rawBytes: 0 };
    k.files++;
    k.rawBytes += e.bytes;
  }
  let gzipBytes = 0;
  for (const e of entries) gzipBytes += await compressedSize(typeof e.content === 'string' ? enc.encode(e.content) : e.content);
  return {
    files: entries.length, rawBytes: entries.reduce((n, e) => n + e.bytes, 0), gzipBytes, byKind,
    largest: entries.map(({ path, bytes }) => ({ path, bytes })).sort((a, b) => b.bytes - a.bytes).slice(0, 5),
  };
}

/** The limits a game can be held to. `get` reads the measured value (in the unit shown). */
export const BUDGETS = [
  { id: 'download', label: 'Download size (compressed)', unit: 'KB', limit: 500, get: (m) => (m.gzipBytes === undefined ? null : m.gzipBytes / 1000),
    help: 'What a player downloads before the first picture. Phones on slow connections feel every 100 KB.' },
  { id: 'files', label: 'Number of files', unit: '', limit: 150, get: (m) => m.files ?? null,
    help: 'Each file is a request. Hundreds of small files load slower than a few bigger ones.' },
  { id: 'frame', label: 'Time per frame on a slow device', unit: 'ms', limit: 8, get: (m) => (m.frameMs === undefined ? null : m.frameMs * (m.slowdown ?? 1)),
    help: 'The game has 16.7 ms for every picture at 60 a second. Half of that leaves room for the browser and for a phone that is slower than this computer.' },
  { id: 'first', label: 'Time to the first picture', unit: 'ms', limit: 1500, get: (m) => m.firstFrameMs ?? null,
    help: 'From the start of loading the code to the first frame drawn.' },
  { id: 'memory', label: 'Memory the game holds', unit: 'MB', limit: 100, get: (m) => m.memoryMB ?? null,
    help: 'Browsers on phones close pages that use too much.' },
];

/** The default limits, as a plain object of id to number. */
export const defaultBudgets = () => Object.fromEntries(BUDGETS.map((b) => [b.id, b.limit]));

/**
 * Compare measurements with limits.
 * @param {object} metrics what was measured (gzipBytes, files, frameMs, slowdown, firstFrameMs, memoryMB; any may be missing)
 * @param {Record<string, number | null>} budgets a limit for each id; null turns that budget off
 * @returns {{items: {id: string, label: string, unit: string, help: string, value: number | null, limit: number | null, state: 'ok' | 'fail' | 'unknown' | 'off'}[], passed: boolean, failing: string[]}}
 */
export function evaluate(metrics, budgets) {
  const items = BUDGETS.map((b) => {
    const value = b.get(metrics);
    const limit = Number.isFinite(budgets?.[b.id]) ? budgets[b.id] : null;
    let state = 'ok';
    if (limit === null) state = 'off';
    else if (value === null || !Number.isFinite(value)) state = 'unknown';
    else if (value > limit) state = 'fail';
    return { id: b.id, label: b.label, unit: b.unit, help: b.help, value, limit, state };
  });
  const failing = items.filter((i) => i.state === 'fail').map((i) => i.label);
  return { items, passed: failing.length === 0, failing };
}

/** Clean up limits that came from storage or a form: numbers above zero, or null for "off". */
export function cleanBudgets(raw) {
  const out = defaultBudgets();
  for (const b of BUDGETS) {
    if (raw && b.id in raw) out[b.id] = raw[b.id] === null ? null : (Number.isFinite(raw[b.id]) && raw[b.id] > 0 ? raw[b.id] : out[b.id]);
  }
  return out;
}

/** Summarise a list of per-frame costs (milliseconds): average, 95th percentile and worst. */
export function frameStats(costs) {
  if (!costs.length) return { avg: NaN, p95: NaN, max: NaN, samples: 0 };
  const sorted = [...costs].sort((a, b) => a - b);
  return {
    avg: costs.reduce((n, v) => n + v, 0) / costs.length,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    max: sorted.at(-1),
    samples: costs.length,
  };
}

/** A figure for people: `1.2 MB`, `340 KB`, `12 ms`. */
export function human(value, unit) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'not measured';
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${unit ? ` ${unit}` : ''}`;
}
