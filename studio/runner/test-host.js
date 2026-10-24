// Runs a project's test files, in a worker of their own: away from the game, the studio and everything else, and killed by the runner if it takes too long. For each test file it
// loads the module (which adds its checks with the kit's `test(...)`), runs them, and sends the results back. A file that cannot load is one failed check with the reason.
addEventListener('message', async (event) => {
  const { base, paths, engineRoot } = event.data ?? {};
  const results = [];
  try {
    const { runChecks } = await import(`${engineRoot}/arcade/src/check.js`);
    for (const path of paths) {
      try {
        await import(`${base}${path}`);
      } catch (error) {
        const message = String(error?.message ?? error).slice(0, 300);
        results.push({ file: path, name: '(loading this file)', ok: false, ms: 0, error: { message } });
        await runChecks();                                       // forget anything it added before it failed
        continue;
      }
      for (const r of await runChecks()) results.push({ file: path, ...r });
    }
    postMessage({ results });
  } catch (error) {
    postMessage({ message: `The tests could not start: ${String(error?.message ?? error).slice(0, 200)}`, results });
  }
});
