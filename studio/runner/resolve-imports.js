// Web Workers do not read the page's import map, so `import ... from '@engine/math'` would not resolve inside the game's worker. When a project's files
// are stored for the runner, engine imports are rewritten to the engine file's own address. Only the module name changes, on the same line, so the
// line and column numbers in error messages stay true.
//
//   '@engine/math'                  -> '/packages/math/src/index.js'
//   '@engine/server/src/node.js'    -> '/packages/server/src/node.js'
//
// (A line of text inside a comment or a string that looks like an import is rewritten too: harmless, and rare.)
const IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])@engine\/([a-z0-9-]+)(\/[^'"]*)?\2/g;

/** @param {string} text a module's source @param {string} [root] where the engine's packages are served from @returns {string} */
export function resolveImports(text, root = '/packages') {
  return text.replace(IMPORT, (_, lead, quote, pkg, rest) => `${lead}${quote}${root}/${pkg}${rest ?? '/src/index.js'}${quote}`);
}
