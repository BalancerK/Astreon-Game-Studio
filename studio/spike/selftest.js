// A scripted run of the studio spike inside the page itself (open index.html?selftest=1): the same checks as tools/studio-spike-test.js, but with no
// browser driver, so it can run in any browser the repository's `runBrowserPage` can start (Chrome and Firefox). It reports its result with a POST to /report.
export async function selftest(studio) {
  const checks = [];
  const numbers = {};
  const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail: String(detail) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 8000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (fn()) return true; await sleep(30); } return false; };
  const r = studio.report;
  const main = studio.files['src/main.js'];

  const t0 = performance.now();
  check('a game starts in the frame on the other origin (service worker, cache, worker, offscreen canvas)', await waitFor(() => r.applied >= 1 && r.frames > 5, 20_000));
  numbers.timeToRunningGameMs = Math.round(performance.now() - t0);
  numbers.afterStart = { applied: r.applied, frames: r.frames, errors: r.errors.slice(0, 3), summary: r.summary, ready: studio.ready };
  if (!checks[0].ok) return { checks, numbers, userAgent: navigator.userAgent };      // nothing else can work: report what we know
  await sleep(700);

  // an edit keeps the game's place
  const before = { ...r.summary };
  const applied0 = r.applied;
  studio.setFile('src/main.js', main.replace('const SPEED = 120', 'const SPEED = 240'));
  check('an edit reaches the running game', await waitFor(() => r.applied > applied0));
  numbers.editLatencyMs = r.latencies[r.latencies.length - 1];
  check('the game kept its place', r.summary.t >= before.t, JSON.stringify([before, r.summary]));

  // syntax error with a location
  const errors0 = r.errors.length;
  studio.setFile('src/main.js', main.replace('const SPEED = 120', 'const SPEED = ;'));
  check('a syntax error is reported', await waitFor(() => r.errors.length > errors0));
  const syntax = r.errors[r.errors.length - 1] ?? {};
  numbers.syntaxError = { message: syntax.message, file: syntax.file, line: syntax.line, column: syntax.column };
  check('and it names the file and line', syntax.file === 'src/main.js' && syntax.line === 4, JSON.stringify(numbers.syntaxError));

  // a runtime error with a location
  const errors1 = r.errors.length;
  studio.setFile('src/main.js', main.replace('game.t += dt;', 'game.t += dt;\n  const oops = null;\n  game.score += oops.value;'));
  check('a mistake while the game runs is reported', await waitFor(() => r.errors.length > errors1));
  const runtime = r.errors[r.errors.length - 1] ?? {};
  numbers.runtimeError = { message: runtime.message, file: runtime.file, line: runtime.line, column: runtime.column };
  check('with its file and line', runtime.file === 'src/main.js' && runtime.line === 15, JSON.stringify(numbers.runtimeError));
  studio.setFile('src/main.js', main);
  await sleep(1500);                                         // the good version has to survive for a while before it counts as the last good one

  // a hang
  studio.resetGap();
  const stuck0 = r.stuck;
  const place = { ...r.summary };
  studio.setFile('src/main.js', main.replace('game.t += dt;', 'game.t += dt;\n  while (true) {}'));
  check('a hung game is noticed', await waitFor(() => r.stuck > stuck0, 10_000));
  numbers.longestStudioFreezeMs = Math.round(r.maxGap);
  check('the studio stayed responsive (freeze under 300 ms)', r.maxGap < 300, `${Math.round(r.maxGap)} ms`);
  check('the runner recovered by itself', await waitFor(() => (r.recovered ?? 0) >= 1, 10_000));
  await sleep(2200);
  check('and the game carried on from its saved state', r.summary.t > place.t + 0.5, JSON.stringify([place, r.summary]));
  check('without re-running the version that hung', r.stuck === stuck0 + 1, `${r.stuck - stuck0} hangs`);

  return { checks, numbers, userAgent: navigator.userAgent };
}
