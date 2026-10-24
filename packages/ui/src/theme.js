import { hex, mix, withAlpha, contrastRatio } from './color.js';

/**
 * Everything a widget needs to look like part of one game: colours (packed, see color.js), text sizes and spacing, in logical
 * pixels. Pass overrides to `createTheme`; anything left out keeps the default, so a game restyles only what it cares about.
 * @typedef {typeof darkTheme} Theme
 */
export const darkTheme = {
  colors: {
    text: hex('#e8ecf4'), textDim: hex('#9aa3b5'), textOnAccent: hex('#0b1220'),
    panel: hex('#171b26'), panelAlt: hex('#222838'), border: hex('#3a4258'),
    control: hex('#2a3146'), controlHover: hex('#36405c'), controlDown: hex('#1f2638'), controlDisabled: hex('#1c2130'),
    accent: hex('#5aa9ff'), accentHover: hex('#7dbbff'), accentDown: hex('#3f8ee6'),
    danger: hex('#b3342d'), dangerHover: hex('#bd3d36'), textOnDanger: hex('#ffffff'), good: hex('#5fd47a'), warn: hex('#e6b450'),
    focus: hex('#ffd166'), selection: hex('#5aa9ff66'), dim: hex('#05070d99'), track: hex('#10141f'),
  },
  /** Text sizes in pixels. */
  text: { size: 15, small: 12, title: 24, heading: 18 },
  /** Height of a row of controls: 44 and up is comfortable on a touch screen. */
  rowHeight: 34,
  padding: 12,
  gap: 8,
  radius: 3,
  borderWidth: 1,
  focusWidth: 2,
};

/**
 * A theme from the dark one with your overrides on top (`colors` and `text` merge key by key).
 *
 * @param {object} [overrides] same shape as `darkTheme`; `colors` and `text` merge key by key.
 */
export function createTheme(overrides = {}) {
  return {
    ...darkTheme, ...overrides,
    colors: { ...darkTheme.colors, ...overrides.colors },
    text: { ...darkTheme.text, ...overrides.text },
  };
}

/** A lighter variant, mostly to show that a theme is only data. */
export const lightTheme = createTheme({
  colors: {
    text: hex('#1b2230'), textDim: hex('#5b6579'), textOnAccent: hex('#ffffff'),
    panel: hex('#f4f6fa'), panelAlt: hex('#e4e8f0'), border: hex('#b4bccb'),
    control: hex('#dde2ec'), controlHover: hex('#cfd6e4'), controlDown: hex('#bcc5d8'), controlDisabled: hex('#e9ecf2'),
    track: hex('#c8cedc'), dim: hex('#1b223055'), selection: hex('#2f7fe066'),
    accent: hex('#1f63c2'), accentHover: mix(hex('#1f63c2'), hex('#000000'), 0.08), accentDown: mix(hex('#1f63c2'), hex('#000000'), 0.2),
    danger: hex('#c0392b'), dangerHover: mix(hex('#c0392b'), hex('#000000'), 0.08), textOnDanger: hex('#ffffff'),
    focus: hex('#a85f00'),
  },
});

export { withAlpha };

/**
 * A theme for players who need strong contrast: white on black, yellow accents, thick borders and focus rings, a taller row. It passes `auditTheme` with the boundary checks too.
 * Offer it in the settings (`ui.theme = highContrastTheme`, then `ui.setViewport(...)` to lay out again).
 */
export const highContrastTheme = createTheme({
  colors: {
    text: hex('#ffffff'), textDim: hex('#e6e6e6'), textOnAccent: hex('#000000'), textOnDanger: hex('#000000'),
    panel: hex('#000000'), panelAlt: hex('#0a0a0a'), border: hex('#ffffff'),
    control: hex('#1c1c1c'), controlHover: hex('#333333'), controlDown: hex('#4d4d4d'), controlDisabled: hex('#141414'),
    accent: hex('#ffd400'), accentHover: hex('#ffe34d'), accentDown: hex('#e6bf00'),
    danger: hex('#ff6b6b'), dangerHover: hex('#ff8a8a'), good: hex('#5dff8a'), warn: hex('#ffd400'),
    focus: hex('#00e5ff'), selection: hex('#00e5ff88'), dim: hex('#000000cc'), track: hex('#262626'),
  },
  text: { size: 17, small: 14, title: 28, heading: 21 },
  rowHeight: 40, borderWidth: 2, focusWidth: 3,
});

/**
 * Check a theme against the contrast the accessibility guidelines (WCAG 2.1 AA) ask for: text and what it sits on (4.5 to 1), the focus ring against the panel and the controls (3 to 1), and the
 * filled part of a slider against its track (3 to 1). With `boundaries: true` also the border against the panel (3 to 1), for a look that relies on outlines. Disabled text is exempt.
 * @param {typeof darkTheme} theme
 * @param {{boundaries?: boolean}} [o]
 * @returns {{passes: boolean, checks: {name: string, ratio: number, need: number, ok: boolean}[], failures: {name: string, ratio: number, need: number, ok: boolean}[]}}
 */
export function auditTheme(theme, { boundaries = false } = {}) {
  const c = theme.colors;
  const pairs = [
    ['text', 'panel', 4.5], ['text', 'panelAlt', 4.5], ['text', 'control', 4.5], ['text', 'controlHover', 4.5], ['text', 'controlDown', 4.5],
    ['textDim', 'panel', 4.5], ['textOnAccent', 'accent', 4.5], ['textOnAccent', 'accentHover', 4.5], ['textOnAccent', 'accentDown', 4.5],
    ['textOnDanger', 'danger', 4.5], ['textOnDanger', 'dangerHover', 4.5],
    ['focus', 'panel', 3], ['focus', 'control', 3], ['accent', 'track', 3],
  ];
  if (boundaries) pairs.push(['border', 'panel', 3]);
  const checks = pairs.map(([fg, bg, need]) => { const ratio = contrastRatio(c[fg], c[bg]); return { name: `${fg} on ${bg}`, ratio: +ratio.toFixed(2), need, ok: ratio >= need }; });
  const failures = checks.filter((k) => !k.ok);
  return { passes: failures.length === 0, checks, failures };
}
