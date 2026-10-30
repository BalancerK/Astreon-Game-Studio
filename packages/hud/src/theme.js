// The colours and the font of a HUD drawn on a 2D canvas over a 3D view. Every widget takes a `theme` (this one by default), so a game changes the look in one place.

/**
 * @typedef {object} HudTheme
 * @property {string} font a CSS font family list @property {string} main the usual accent @property {string} dim a quiet accent @property {string} panel the fill of a panel (translucent) @property {string} edge the edge of a panel
 * @property {string} amber a warning or a marker @property {string} red danger @property {string} green fine @property {string} white text
 */

/** A cool blue-green console on dark glass, with amber for markers. @type {Readonly<HudTheme>} */
export const HUD_THEME = Object.freeze({
  font: '"Share Tech Mono", "Cascadia Mono", Consolas, "Courier New", monospace',
  main: '#6fd3e0', dim: '#2a4a52', panel: 'rgba(10, 14, 18, 0.4)', edge: 'rgba(160, 180, 190, 0.38)', amber: '#e0a24a', red: '#e0594f', green: '#6fcf97', white: '#e6ecef',
});
