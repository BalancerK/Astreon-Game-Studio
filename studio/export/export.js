// Turning a studio project into a game anyone can play from a web page: `index.html`, the project's files, the engine files it uses, a small runtime, and (if
// asked) what makes it installable and playable offline. The result is plain static files; any web host will do. Pure functions, so it is tested in Node.
import { withSceneModules } from './scene-modules.js';
import { DEFAULTS } from '../app/store/project-settings.js';
import { collectEngine, resolveRelative } from './bundle.js';
import { manifestJson, serviceWorkerJs, iconSvg, hashText } from './pwa.js';
import { resolveImports } from '../runner/resolve-imports.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rel = (from, to) => {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift(); }
  return [...a.map(() => '..'), ...b].join('/') || '.';
};

/** A name safe to use as a file name and as an id. */
export const slug = (title) => String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'game';

/** The page that holds the game. */
export function indexHtml({ title, id, hasKit, hasSound, offline, assets = [], settings = DEFAULTS, build = null }) {
  const { width, height, background } = settings;
  const config = JSON.stringify({
    id, hasKit, hasSound, offline, assets: assets.map(({ path, kind }) => ({ path, kind })), settings: { width, height, background },
    ...(build ? { build: { name: String(build.name).slice(0, 24), debug: Boolean(build.debug) } } : {}),
  }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="theme-color" content="${background}">
${offline ? '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icon.svg" type="image/svg+xml">\n' : ''}<style>
  html, body { margin: 0; height: 100%; background: #0b0e15; color: #dde2f0; font: 16px system-ui, sans-serif; }
  body { display: grid; place-items: center; }
  .wrap { position: relative; width: min(100vw, calc(100vh * ${width} / ${height})); aspect-ratio: ${width} / ${height}; }
  canvas { width: 100%; height: 100%; display: block; background: ${background}; image-rendering: auto; outline: none; }
  #start { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(11, 14, 21,
    .72); cursor: pointer; font-size: 22px; border: 0; color: inherit; }
  #banner { position: absolute; left: 0; right: 0; bottom: 0; padding: 10px 14px; background: #7f1d1d; color: #fff; font-size: 14px; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="wrap">
  <canvas id="game" width="${width}" height="${height}" tabindex="0" aria-label="${esc(title)}"></canvas>
  <button id="start" type="button" hidden>Click to play</button>
  <div id="banner" role="alert" hidden></div>
</div>
<noscript>This game needs JavaScript.</noscript>
<script>window.GAME_CONFIG = ${config};</script>
<script type="module" src="runtime.js"></script>
</body>
</html>
`;
}

/**
 * Build the exported game.
 * @param {{files: Record<string, string>, title: string, readEngine: (path: string) => Promise<string | null>, runtime: string, offline?: boolean}} o
 *   `files` the project's text files; `readEngine` gives an engine file by its path under packages (`arcade/src/index.js`); `runtime` the text of runtime.js
 * @returns {Promise<{files: Record<string, string>, report: {engineFiles: number, projectFiles: number, hasKit: boolean, hasSound: boolean, missing: string[], version: string}}>}
 */
export async function buildWebExport({
  files: projectFiles, title, readEngine, runtime, controls = '', assets = [], settings = DEFAULTS, offline = true, build = null,
}) {
  const files = withSceneModules(projectFiles);
  if (typeof files['src/main.js'] !== 'string') throw new Error('The game has no src/main.js, so there is nothing to start.');
  const usesKit = Object.values(files).some((t) => typeof t === 'string' && /@engine\/arcade/.test(t));
  const extra = usesKit ? ['arcade/src/sound.js', 'arcade/src/music.js', 'arcade/src/progress.js', 'audio/src/synth.js'] : [];
  const engine = await collectEngine(files, readEngine, extra);
  const out = {};
  for (const [path, text] of Object.entries(files)) {
    if (typeof text !== 'string') continue;
    const target = `game/${path}`;
    out[target] = path.endsWith('.js') ? resolveImports(text, rel(target, 'engine')) : text;
  }
  for (const [path, text] of Object.entries(engine.files)) {
    const target = `engine/${path}`;
    out[target] = resolveImports(text, rel(target, 'engine'));
  }
  const id = slug(title);
  const hasKit = usesKit && 'arcade/src/sound.js' in engine.files;
  const hasSound = hasKit && 'audio/src/synth.js' in engine.files;
  out['runtime.js'] = runtime;
  out['controls.js'] = controls;
  for (const a of assets) out[`game/${a.path}`] = a.bytes;
  const fingerprints = Object.fromEntries(assets.map((a) => [`game/${a.path}`, a.hash]));
  const version = hashText(Object.entries(out).map(([k, v]) => `${k}\n${typeof v === 'string' ? v : fingerprints[k]}`).join('\n'));
  if (offline) {
    out['manifest.webmanifest'] = manifestJson(title,
      { color: settings.background, orientation: settings.height > settings.width ? 'portrait' : 'landscape' });
    out['icon.svg'] = iconSvg(title, settings.icon.color, settings.icon.letter);
    out['sw.js'] = serviceWorkerJs(version, [...Object.keys(out), 'index.html'].filter((p) => p !== 'sw.js'));
  }
  out['index.html'] = indexHtml({ title, id, hasKit, hasSound, offline, assets, settings, build });
  const ordered = Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b))));
  return {
    files: ordered,
    report: { engineFiles: Object.keys(engine.files).length, projectFiles: Object.keys(files).length, hasKit, hasSound, missing: engine.missing,
      version },
  };
}

export { resolveRelative };
