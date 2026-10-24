// How the studio and its code editor can look. The interface has its own light, dark and high-contrast themes (studio.css); on top of that you can choose a
// colour scheme for the code editor (its own, independent of the interface), an accent colour for buttons and selections, and the code font. A scheme is a
// handful of colours; this file holds them and turns the choices into CSS variables. Every scheme and accent is checked for readable contrast in the tests
// (WCAG: 4.5 to 1 for text), so a choice can never make the code hard to read. Pure functions: tested in Node.

/** @type {Record<string, {name: string, dark: boolean, bg: string, fg: string, gutter: string, line: string, sel: string, cur: string,
 *   c: string, s: string, n: string, k: string, f: string, t: string}>} */
export const EDITOR_THEMES = {
  'studio-dark': {
    name: 'Astreon dark', dark: true,
    bg: '#0f131b', fg: '#d7dcea', gutter: '#8e98b0', line: '#232838',
    sel: 'rgba(100, 140, 255, .35)', cur: 'rgba(130, 150, 220, .10)',
    c: '#8591ad', s: '#7ee0ae', n: '#f5b66a', k: '#c4a1ff', f: '#7cb8ff', t: '#e6c07b',
  },
  midnight: {
    name: 'Midnight', dark: true,
    bg: '#0b1020', fg: '#d6deeb', gutter: '#8896b8', line: '#1d2540',
    sel: 'rgba(120, 150, 255, .32)', cur: 'rgba(120, 150, 255, .10)',
    c: '#8a9bc2', s: '#addb67', n: '#f78c6c', k: '#c792ea', f: '#82aaff', t: '#ffcb6b',
  },
  'solarized-dark': {
    name: 'Solarized dark', dark: true,
    bg: '#002b36', fg: '#b4c2c3', gutter: '#7f9aa2', line: '#0c4250',
    sel: 'rgba(38, 139, 210, .35)', cur: 'rgba(120, 160, 170, .12)',
    c: '#7f9aa2', s: '#35b3a8', n: '#e57b45', k: '#c9a227', f: '#4aa3e6', t: '#ee6aa8',
  },
  forest: {
    name: 'Forest', dark: true,
    bg: '#0f1a12', fg: '#d4e4d0', gutter: '#86a38c', line: '#1f3326',
    sel: 'rgba(110, 200, 140, .30)', cur: 'rgba(140, 200, 150, .10)',
    c: '#86a38c', s: '#a8e28c', n: '#f0b36c', k: '#8fd3c8', f: '#7fc8ff', t: '#e9d58a',
  },
  'studio-light': {
    name: 'Astreon light', dark: false,
    bg: '#fbfcff', fg: '#1b2030', gutter: '#5d6579', line: '#e3e6ee',
    sel: 'rgba(79, 70, 229, .25)', cur: 'rgba(79, 70, 229, .07)',
    c: '#5a6379', s: '#0f7b4f', n: '#a04a07', k: '#7c3aed', f: '#1d6fd1', t: '#8a5a00',
  },
  paper: {
    name: 'Paper', dark: false,
    bg: '#ffffff', fg: '#1a1a1a', gutter: '#595959', line: '#e0e0e0',
    sel: 'rgba(0, 90, 220, .22)', cur: 'rgba(0, 0, 0, .05)',
    c: '#595f6b', s: '#0b6e4f', n: '#a1480a', k: '#6b21a8', f: '#1d4ed8', t: '#8a5a00',
  },
  'solarized-light': {
    name: 'Solarized light', dark: false,
    bg: '#fdf6e3', fg: '#4a5b61', gutter: '#5f7076', line: '#e8dfc6',
    sel: 'rgba(38, 139, 210, .25)', cur: 'rgba(120, 100, 40, .08)',
    c: '#5f7076', s: '#0f766e', n: '#b04a14', k: '#8a6b00', f: '#1d6fb0', t: '#b3246c',
  },
  'high-contrast': {
    name: 'High contrast', dark: true,
    bg: '#000000', fg: '#ffffff', gutter: '#e4e4ec', line: '#ffffff',
    sel: 'rgba(0, 229, 255, .45)', cur: 'rgba(255, 255, 255, .14)',
    c: '#cfd6e6', s: '#5dff8a', n: '#ffb15c', k: '#e0b8ff', f: '#7fd4ff', t: '#ffe27a',
  },
};

/** The names to show in a list: 'Same as the interface' first. */
export const EDITOR_THEME_NAMES = {
  auto: 'Same as the interface', ...Object.fromEntries(Object.entries(EDITOR_THEMES).map(([k, v]) => [k, v.name])),
};

/** The accent colours: for light and dark interfaces, the colour, and the colour of the writing on top of it. */
export const ACCENTS = {
  indigo: { name: 'Indigo', light: { accent: '#4f46e5', fg: '#ffffff' }, dark: { accent: '#8b8bff', fg: '#0b0e15' } },
  blue: { name: 'Blue', light: { accent: '#1d4ed8', fg: '#ffffff' }, dark: { accent: '#6aa8ff', fg: '#0b0e15' } },
  teal: { name: 'Teal', light: { accent: '#0f766e', fg: '#ffffff' }, dark: { accent: '#2dd4bf', fg: '#0b0e15' } },
  green: { name: 'Green', light: { accent: '#14783a', fg: '#ffffff' }, dark: { accent: '#4ade80', fg: '#0b0e15' } },
  orange: { name: 'Orange', light: { accent: '#a84f08', fg: '#ffffff' }, dark: { accent: '#fb923c', fg: '#0b0e15' } },
  rose: { name: 'Rose', light: { accent: '#be123c', fg: '#ffffff' }, dark: { accent: '#fb7185', fg: '#0b0e15' } },
};
export const ACCENT_NAMES = Object.fromEntries(Object.entries(ACCENTS).map(([k, v]) => [k, v.name]));

/** Code fonts: the first that exists on the computer is used (nothing is downloaded). */
export const FONTS = {
  system: { name: 'The system\'s own', stack: 'ui-monospace, "Cascadia Code", Consolas, Menlo, monospace' },
  consolas: { name: 'Consolas', stack: 'Consolas, "Cascadia Mono", monospace' },
  cascadia: { name: 'Cascadia Code', stack: '"Cascadia Code", "Cascadia Mono", Consolas, monospace' },
  jetbrains: { name: 'JetBrains Mono', stack: '"JetBrains Mono", "Cascadia Code", Consolas, monospace' },
  fira: { name: 'Fira Code', stack: '"Fira Code", "Fira Mono", "Cascadia Code", Consolas, monospace' },
  menlo: { name: 'Menlo / Monaco', stack: 'Menlo, Monaco, "DejaVu Sans Mono", monospace' },
  courier: { name: 'Courier', stack: '"Courier New", Courier, monospace' },
};
export const FONT_NAMES = Object.fromEntries(Object.entries(FONTS).map(([k, v]) => [k, v.name]));

// ---------- reading colours ----------

/** @param {string} color '#rrggbb' or 'rgba(r, g, b, a)' @returns {[number, number, number, number] | null} */
export function parseColor(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])] : null;
}

const luminance = ([r, g, b]) => {
  const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** The contrast between two colours, from 1 (none) to 21 (black on white). */
export function contrast(a, b) {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return 0;
  const [hi, lo] = [luminance(pa), luminance(pb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The accent as a soft background (for a selected row): the colour at low strength. */
export const soft = (hex, alpha) => { const [r, g, b] = parseColor(hex); return `rgba(${r}, ${g}, ${b}, ${alpha})`; };

// ---------- turning choices into CSS variables ----------

/** The variables an editor scheme sets (all start with --ed- or --tk-). `name` 'auto' (or unknown) sets none: the interface's own colours are used. */
export function editorVars(name) {
  const t = EDITOR_THEMES[name];
  if (!t) return {};
  return {
    '--ed-bg': t.bg, '--ed-fg': t.fg, '--ed-gutter': t.gutter, '--ed-line': t.line, '--ed-sel': t.sel, '--ed-cur': t.cur,
    '--tk-c': t.c, '--tk-s': t.s, '--tk-n': t.n, '--tk-k': t.k, '--tk-f': t.f, '--tk-t': t.t,
  };
}

/** The variables an accent sets for a light or dark interface (`contrast` themes keep their own). */
export function accentVars(name, dark) {
  const a = ACCENTS[name];
  if (!a || name === 'indigo') return {};                  // indigo is the interface's own: nothing to override
  const v = dark ? a.dark : a.light;
  return { '--accent': v.accent, '--accent-fg': v.fg, '--accent-soft': soft(v.accent, dark ? 0.16 : 0.11), '--focus': dark ? v.accent : v.accent };
}

/** The font stack for a choice. */
export const fontStack = (name) => (FONTS[name] ?? FONTS.system).stack;

/** Every variable any of these functions can set (so they can be cleared before another choice is applied). */
export const ALL_VARS = [
  '--ed-bg', '--ed-fg', '--ed-gutter', '--ed-line', '--ed-sel', '--ed-cur', '--tk-c', '--tk-s', '--tk-n', '--tk-k', '--tk-f', '--tk-t',
  '--accent', '--accent-fg', '--accent-soft', '--focus',
];
