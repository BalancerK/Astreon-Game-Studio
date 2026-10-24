// A scene made in the studio's 3D panel is a file, `scenes/<name>.json`. A game imports modules, so the studio makes a module for each such scene, only for the
// copy it runs or exports: `scenes/hall.json.js` is `export default <the scene>`, and a game says `import hall from '../scenes/hall.json.js'`. The project's
// own files are not changed (the module is not in the file list), and a scene that is not a scene is left alone.
const SCENE = /^scenes\/[\w-]+\.json$/;

/**
 * Add `<path>.js` for every scene file in the project.
 * @param {Record<string, string | Uint8Array>} files
 * @returns {Record<string, string | Uint8Array>} the same files and the modules (a new object when there is a scene)
 */
export function withSceneModules(files) {
  let out = null;
  for (const [path, text] of Object.entries(files)) {
    if (!SCENE.test(path) || typeof text !== 'string' || `${path}.js` in files) continue;
    try {
      const data = JSON.parse(text);
      if (data?.format !== 'engine-scene') continue;
      (out ??= { ...files })[`${path}.js`] = `export default ${JSON.stringify(data)};\n`;
    } catch { /* not a scene: left alone */ }
  }
  return out ?? files;
}
