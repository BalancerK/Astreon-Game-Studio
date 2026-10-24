/**
 * Mixed-direction text: the Unicode Bidirectional Algorithm (UAX #9), so Arabic and Hebrew read right to left, numbers and English inside them stay left to right, and brackets face the right
 * way. Given a line of text it says which direction each character runs (its *level*: even is left to right, odd is right to left) and the order to draw them in from left to right.
 *
 * Implemented: the paragraph direction (given, or from the first strong character), explicit embeddings, overrides and isolates (`U+202A`..`U+202E`, `U+2066`..`U+2069`) to the depth 125 the standard
 * allows, weak types (W1 to W7), bracket pairs (N0), neutrals (N1, N2), implicit levels (I1, I2), trailing whitespace (L1) and reordering (L2). The classes come from Unicode scripts and
 * categories rather than a copy of the whole bidirectional table, which gives the same answer for the text games use (Latin, Cyrillic, Greek, CJK, Arabic, Hebrew, Syriac, Thaana, digits,
 * punctuation); a rare historic script may be classed as left to right. Embedding and override characters and zero-width controls are consumed (they have no glyph) and do not appear in the result; the isolate marks stay (the levels depend on them) and `visualRuns` leaves them out.
 */

const MAX_DEPTH = 125;
const RTL_SCRIPTS = /^[\p{Script=Hebrew}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Phoenician}\p{Script=Imperial_Aramaic}\p{Script=Lydian}\p{Script=Cypriot}\p{Script=Kharoshthi}\p{Script=Avestan}\p{Script=Old_Turkic}]$/u;
const AL_SCRIPTS = /^[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Hanifi_Rohingya}\p{Script=Mende_Kikakui}]$/u;
const ES = new Set([0x2b, 0x2d, 0x207a, 0x207b, 0x208a, 0x208b, 0x2212, 0xfb29, 0xfe62, 0xfe63, 0xff0b, 0xff0d]);
const CS = new Set([0x2c, 0x2e, 0x2f, 0x3a, 0xa0, 0x60c, 0x202f, 0x2044, 0xfe50, 0xfe52, 0xfe55, 0xff0c, 0xff0e, 0xff0f, 0xff1a]);

/** The bidirectional class of a character: L, R, AL, EN, ES, ET, AN, CS, NSM, BN, B, S, WS, ON, or an explicit formatting class (LRE, LRO, RLE, RLO, PDF, LRI, RLI, FSI, PDI). @param {number} cp */
export function bidiClass(cp) {
  if (cp < 0x80) {                                                                   // the common case fast
    if ((cp >= 0x30 && cp <= 0x39)) return 'EN';
    if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return 'L';
    if (cp === 0x20 || cp === 0x0c) return 'WS';
    if (cp === 0x09 || cp === 0x0b || cp === 0x1f) return 'S';
    if (cp === 0x0a || cp === 0x0d || cp === 0x1c || cp === 0x1d || cp === 0x1e) return 'B';
    if (cp < 0x20 || cp === 0x7f) return 'BN';
    if (ES.has(cp)) return 'ES';
    if (CS.has(cp)) return 'CS';
    if (cp === 0x23 || cp === 0x24 || cp === 0x25) return 'ET';
    return 'ON';
  }
  switch (cp) {
    case 0x202a: return 'LRE'; case 0x202b: return 'RLE'; case 0x202c: return 'PDF'; case 0x202d: return 'LRO'; case 0x202e: return 'RLO';
    case 0x2066: return 'LRI'; case 0x2067: return 'RLI'; case 0x2068: return 'FSI'; case 0x2069: return 'PDI';
    case 0x200e: return 'L'; case 0x200f: return 'R'; case 0x061c: return 'AL';
    case 0x2029: case 0x85: return 'B';
    case 0x200b: case 0x200c: case 0x200d: case 0x2060: case 0xad: case 0xfeff: return 'BN';
  }
  if (ES.has(cp)) return 'ES';
  if (CS.has(cp)) return 'CS';
  if ((cp >= 0x660 && cp <= 0x669) || cp === 0x66b || cp === 0x66c || (cp >= 0x600 && cp <= 0x605) || cp === 0x6dd || cp === 0x8e2) return 'AN';
  if ((cp >= 0xa2 && cp <= 0xa5) || cp === 0xb0 || cp === 0xb1 || (cp >= 0x20a0 && cp <= 0x20cf) || (cp >= 0x2030 && cp <= 0x2034) || cp === 0x66a || cp === 0x609 || cp === 0x60a || cp === 0x60b) return 'ET';
  if (cp === 0xb2 || cp === 0xb3 || cp === 0xb9 || (cp >= 0x6f0 && cp <= 0x6f9) || (cp >= 0x2070 && cp <= 0x2079 && cp !== 0x2071 && cp !== 0x2072 && cp !== 0x2073) || (cp >= 0x2080 && cp <= 0x2089)) return 'EN';
  const ch = String.fromCodePoint(cp);
  if (/^\p{Zs}$/u.test(ch) || cp === 0x2028) return 'WS';
  if (/^[\p{Mn}\p{Me}]$/u.test(ch)) return 'NSM';
  if (/^\p{Nd}$/u.test(ch)) return 'EN';
  if (/^\p{Cc}$/u.test(ch) || /^\p{Cf}$/u.test(ch)) return 'BN';
  if (/^\p{L}$/u.test(ch) || /^\p{Mc}$/u.test(ch)) { if (AL_SCRIPTS.test(ch)) return 'AL'; if (RTL_SCRIPTS.test(ch)) return 'R'; return 'L'; }
  if (/^\p{Nl}$/u.test(ch)) return 'L';
  if (RTL_SCRIPTS.test(ch)) return 'R';
  if (AL_SCRIPTS.test(ch)) return 'AL';
  return 'ON';
}

/** Does this text contain anything that reads right to left or controls direction (so it needs the algorithm)? Cheap to call for every line. @param {string} text */
export function needsBidi(text) {
  return /[֐-ࣿ‎‏‪-‮⁦-⁩יִ-﷿ﹰ-﻿\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u.test(text);
}

const BRACKETS = new Map([[0x28, 0x29], [0x5b, 0x5d], [0x7b, 0x7d], [0x3c, 0x3e], [0xab, 0xbb], [0x2039, 0x203a], [0x27e8, 0x27e9], [0x300c, 0x300d], [0x300e, 0x300f], [0x3008, 0x3009], [0x300a, 0x300b], [0x3010, 0x3011], [0xff08, 0xff09], [0x2329, 0x232a]]);
const CLOSERS = new Map(); for (const [o, c] of BRACKETS) CLOSERS.set(c, o);
const canon = (cp) => (cp === 0x2329 ? 0x27e8 : cp === 0x232a ? 0x27e9 : cp === 0x3008 ? 0x27e8 : cp === 0x3009 ? 0x27e9 : cp);

/** The mirror image of a bracket or quote for drawing in right-to-left text ("(" becomes ")"), or the character itself. @param {number} cp */
export function mirrored(cp) { return BRACKETS.get(cp) ?? CLOSERS.get(cp) ?? (cp === 0x2264 ? 0x2265 : cp === 0x2265 ? 0x2264 : cp); }

const NI = new Set(['B', 'S', 'WS', 'ON', 'FSI', 'LRI', 'RLI', 'PDI']);

/** The direction of text by its first strong character (skipping isolated parts): 0 left to right, 1 right to left, or null if there is none (P2, P3). */
function firstStrong(types, from, to) {
  let depth = 0;
  for (let i = from; i < to; i++) {
    const t = types[i];
    if (t === 'LRI' || t === 'RLI' || t === 'FSI') depth++;
    else if (t === 'PDI') { if (depth > 0) depth--; else if (depth === 0) continue; }
    else if (depth === 0) { if (t === 'L') return 0; if (t === 'R' || t === 'AL') return 1; }
  }
  return null;
}

/**
 * Resolve the directions in a line of text.
 * @param {string} text One line (no line breaks). @param {'auto' | 'ltr' | 'rtl'} [direction] The paragraph direction: `'auto'` takes it from the first strong character (default).
 * @returns {{codePoints: number[], levels: Uint8Array, paragraphLevel: number, order: number[], types: string[]}} `codePoints` (formatting characters removed), the embedding `levels`, and `order`: the indices of `codePoints` from the left of the screen to the right.
 */
export function resolveBidi(text, direction = 'auto') {
  const all = Array.from(text, (c) => c.codePointAt(0));
  const n0 = all.length;
  const types0 = all.map(bidiClass);
  // matching isolate initiators and PDIs (BD9)
  const matchPdi = new Int32Array(n0).fill(-1), matchInit = new Int32Array(n0).fill(-1);
  { const stack = []; for (let i = 0; i < n0; i++) { const t = types0[i]; if (t === 'LRI' || t === 'RLI' || t === 'FSI') stack.push(i); else if (t === 'PDI' && stack.length) { const o = stack.pop(); matchPdi[o] = i; matchInit[i] = o; } } }
  const paragraphLevel = direction === 'ltr' ? 0 : direction === 'rtl' ? 1 : (firstStrong(types0, 0, n0) ?? 0);

  // X1 to X8: explicit levels
  const levels0 = new Uint8Array(n0), types = types0.slice();
  const stack = [{ level: paragraphLevel, override: 'N', isolate: false }];
  let overflowIsolate = 0, overflowEmbedding = 0, validIsolate = 0;
  const removed = new Uint8Array(n0);
  for (let i = 0; i < n0; i++) {
    const t = types0[i], top = stack[stack.length - 1];
    if (t === 'RLE' || t === 'LRE' || t === 'RLO' || t === 'LRO') {
      const rtl = t === 'RLE' || t === 'RLO', next = rtl ? (top.level + 1) | 1 : (top.level + 2) & ~1;
      levels0[i] = top.level; removed[i] = 1;
      if (next <= MAX_DEPTH && overflowIsolate === 0 && overflowEmbedding === 0) stack.push({ level: next, override: t === 'RLO' ? 'R' : t === 'LRO' ? 'L' : 'N', isolate: false });
      else if (overflowIsolate === 0) overflowEmbedding++;
    } else if (t === 'RLI' || t === 'LRI' || t === 'FSI') {
      levels0[i] = top.level; if (top.override !== 'N') types[i] = top.override;
      let rtl = t === 'RLI';
      if (t === 'FSI') { const end = matchPdi[i] >= 0 ? matchPdi[i] : n0; rtl = (firstStrong(types0, i + 1, end) ?? 0) === 1; }
      const next = rtl ? (top.level + 1) | 1 : (top.level + 2) & ~1;
      if (next <= MAX_DEPTH && overflowIsolate === 0 && overflowEmbedding === 0) { validIsolate++; stack.push({ level: next, override: 'N', isolate: true }); } else overflowIsolate++;
    } else if (t === 'PDI') {
      if (overflowIsolate > 0) overflowIsolate--;
      else if (validIsolate > 0) { overflowEmbedding = 0; while (!stack[stack.length - 1].isolate) stack.pop(); stack.pop(); validIsolate--; }
      const now = stack[stack.length - 1]; levels0[i] = now.level; if (now.override !== 'N') types[i] = now.override;
    } else if (t === 'PDF') {
      removed[i] = 1; levels0[i] = top.level;
      if (overflowIsolate > 0) { /* nothing */ } else if (overflowEmbedding > 0) overflowEmbedding--; else if (!top.isolate && stack.length >= 2) stack.pop();
    } else if (t === 'B') levels0[i] = paragraphLevel;
    else if (t === 'BN') { levels0[i] = top.level; removed[i] = 1; }
    else { levels0[i] = top.level; if (top.override !== 'N') types[i] = top.override; }
  }
  // X9: leave out what has no glyph
  const keep = []; for (let i = 0; i < n0; i++) if (!removed[i]) keep.push(i);
  const n = keep.length;
  const cps = keep.map((i) => all[i]), T = keep.map((i) => types[i]), lvl = Uint8Array.from(keep, (i) => levels0[i]);
  const orig = keep.map((i) => types0[i]);
  const pdiOf = new Int32Array(n).fill(-1), initOf = new Int32Array(n).fill(-1);
  { const pos = new Map(keep.map((k, j) => [k, j])); for (const [i, j] of pos) { if (matchPdi[i] >= 0 && pos.has(matchPdi[i])) { pdiOf[j] = pos.get(matchPdi[i]); initOf[pos.get(matchPdi[i])] = j; } } }
  const isInit = (j) => orig[j] === 'LRI' || orig[j] === 'RLI' || orig[j] === 'FSI';

  // X10: isolating run sequences
  const runs = []; // level runs as [start, end)
  for (let i = 0; i < n;) { let j = i + 1; while (j < n && lvl[j] === lvl[i]) j++; runs.push([i, j]); i = j; }
  const runStartingAt = new Map(runs.map((r, k) => [r[0], k]));
  const sequences = [];
  for (const run of runs) {
    if (orig[run[0]] === 'PDI' && initOf[run[0]] >= 0) continue;                       // it continues an earlier sequence
    const idx = []; let r = run;
    for (;;) {
      for (let i = r[0]; i < r[1]; i++) idx.push(i);
      const last = r[1] - 1;
      if (isInit(last) && pdiOf[last] >= 0 && runStartingAt.has(pdiOf[last])) r = runs[runStartingAt.get(pdiOf[last])]; else break;
    }
    sequences.push(idx);
  }

  for (const idx of sequences) {
    const level = lvl[idx[0]];
    const before = idx[0] > 0 ? lvl[idx[0] - 1] : paragraphLevel;
    const lastIdx = idx[idx.length - 1];
    const after = lastIdx + 1 < n && !(isInit(lastIdx) && pdiOf[lastIdx] < 0) ? lvl[lastIdx + 1] : paragraphLevel;
    const sos = Math.max(before, level) % 2 ? 'R' : 'L', eos = Math.max(after, level) % 2 ? 'R' : 'L';
    const ty = idx.map((i) => T[i]), m = ty.length;
    // W1: non-spacing marks take the type before them
    for (let k = 0; k < m; k++) if (ty[k] === 'NSM') ty[k] = k === 0 ? sos : (['LRI', 'RLI', 'FSI', 'PDI'].includes(ty[k - 1]) ? 'ON' : ty[k - 1]);
    // W2, W3
    { let strong = sos; for (let k = 0; k < m; k++) { const t = ty[k]; if (t === 'L' || t === 'R' || t === 'AL') strong = t; else if (t === 'EN' && strong === 'AL') ty[k] = 'AN'; } }
    for (let k = 0; k < m; k++) if (ty[k] === 'AL') ty[k] = 'R';
    // W4
    for (let k = 1; k < m - 1; k++) { const t = ty[k]; if (t === 'ES' && ty[k - 1] === 'EN' && ty[k + 1] === 'EN') ty[k] = 'EN'; else if (t === 'CS' && ty[k - 1] === ty[k + 1] && (ty[k - 1] === 'EN' || ty[k - 1] === 'AN')) ty[k] = ty[k - 1]; }
    // W5
    for (let k = 0; k < m;) { if (ty[k] !== 'ET') { k++; continue; } let e = k; while (e < m && ty[e] === 'ET') e++; if ((k > 0 && ty[k - 1] === 'EN') || (e < m && ty[e] === 'EN')) for (let q = k; q < e; q++) ty[q] = 'EN'; k = e; }
    // W6, W7
    for (let k = 0; k < m; k++) if (ty[k] === 'ES' || ty[k] === 'ET' || ty[k] === 'CS') ty[k] = 'ON';
    { let strong = sos; for (let k = 0; k < m; k++) { const t = ty[k]; if (t === 'L' || t === 'R') strong = t; else if (t === 'EN' && strong === 'L') ty[k] = 'L'; } }
    // N0: bracket pairs
    const e = level % 2 ? 'R' : 'L', pairs = [], open = [];
    for (let k = 0; k < m; k++) {
      if (ty[k] !== 'ON') continue;
      const cp = cps[idx[k]];
      if (BRACKETS.has(cp)) { if (open.length < 63) open.push({ k, close: canon(BRACKETS.get(cp)) }); else break; }
      else if (CLOSERS.has(cp)) { const want = canon(cp); for (let s = open.length - 1; s >= 0; s--) if (open[s].close === want) { pairs.push([open[s].k, k]); open.length = s; break; } }
    }
    pairs.sort((a, b) => a[0] - b[0]);
    const strongOf = (t) => (t === 'L' ? 'L' : t === 'R' || t === 'EN' || t === 'AN' ? 'R' : null);
    for (const [o, c] of pairs) {
      let foundE = false, foundO = false;
      for (let k = o + 1; k < c; k++) { const s = strongOf(ty[k]); if (s === e) { foundE = true; break; } if (s) foundO = true; }
      let set = null;
      if (foundE) set = e;
      else if (foundO) { let ctx = sos; for (let k = o - 1; k >= 0; k--) { const s = strongOf(ty[k]); if (s) { ctx = s; break; } } set = ctx !== e ? ctx : e; }
      if (set) { ty[o] = set; ty[c] = set; for (const b of [o, c]) for (let k = b + 1; k < m && orig[idx[k]] === 'NSM'; k++) ty[k] = set; }
    }
    // N1, N2
    for (let k = 0; k < m;) {
      if (!NI.has(ty[k])) { k++; continue; }
      let end = k; while (end < m && NI.has(ty[end])) end++;
      const lead = k === 0 ? sos : strongOf(ty[k - 1]) ?? e, trail = end === m ? eos : strongOf(ty[end]) ?? e;
      const dir = lead === trail ? lead : e;
      for (let q = k; q < end; q++) ty[q] = dir;
      k = end;
    }
    // I1, I2
    for (let k = 0; k < m; k++) {
      const t = ty[k];
      if (level % 2 === 0) { if (t === 'R') lvl[idx[k]] = level + 1; else if (t === 'AN' || t === 'EN') lvl[idx[k]] = level + 2; }
      else if (t === 'L' || t === 'EN' || t === 'AN') lvl[idx[k]] = level + 1;
    }
  }

  // L1: whitespace at the end of the line, and separators, go back to the paragraph level
  for (let k = n - 1; k >= 0 && (orig[k] === 'WS' || orig[k] === 'FSI' || orig[k] === 'LRI' || orig[k] === 'RLI' || orig[k] === 'PDI'); k--) lvl[k] = paragraphLevel;
  for (let k = 0; k < n; k++) if (orig[k] === 'S' || orig[k] === 'B') { lvl[k] = paragraphLevel; for (let q = k - 1; q >= 0 && (orig[q] === 'WS' || ['FSI', 'LRI', 'RLI', 'PDI'].includes(orig[q])); q--) lvl[q] = paragraphLevel; }

  return { codePoints: cps, levels: lvl, paragraphLevel, order: reorder(lvl), types: orig };
}

/**
 * Reorder a line (L2): the indices of the characters from left to right on screen, given their levels. Within the highest level, characters are reversed; then each lower level from the top
 * down to the lowest odd one, reversing every stretch that is at least that deep.
 * @param {ArrayLike<number>} levels @returns {number[]}
 */
export function reorder(levels) {
  const order = Array.from({ length: levels.length }, (_, i) => i);
  let hi = 0, lowOdd = 255;
  for (const l of levels) { if (l > hi) hi = l; if (l % 2 === 1 && l < lowOdd) lowOdd = l; }
  for (let level = hi; level >= lowOdd; level--) {
    for (let i = 0; i < order.length;) {
      if (levels[order[i]] < level) { i++; continue; }
      let j = i; while (j < order.length && levels[order[j]] >= level) j++;
      for (let a = i, b = j - 1; a < b; a++, b--) { const t = order[a]; order[a] = order[b]; order[b] = t; }
      i = j;
    }
  }
  return order;
}

/**
 * A line as runs in drawing order: `[{ text, level, rtl, start, end }]` from left to right, each a stretch of characters of one level, with the characters of a right-to-left run already in
 * visual order (reversed, mirrored brackets). Convenient for drawing with something that cannot reorder (a per-glyph renderer).
 * @param {string} text @param {'auto' | 'ltr' | 'rtl'} [direction]
 */
export function visualRuns(text, direction = 'auto') {
  const r = resolveBidi(text, direction), runs = [];
  for (const i of r.order) {
    if (r.types[i] === 'LRI' || r.types[i] === 'RLI' || r.types[i] === 'FSI' || r.types[i] === 'PDI') continue;      // isolate marks have no glyph
    const level = r.levels[i], rtl = level % 2 === 1, cp = rtl ? mirrored(r.codePoints[i]) : r.codePoints[i];
    const last = runs[runs.length - 1];
    if (last && last.level === level) { last.text += String.fromCodePoint(cp); last.end = i; } else runs.push({ text: String.fromCodePoint(cp), level, rtl, start: i, end: i });
  }
  return runs;
}
