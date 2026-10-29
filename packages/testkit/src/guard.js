// Keeps a test browser from outliving the test that started it.
//
// Why this exists: the process `spawn` gives back for Chrome is NOT always the browser. On some computers it is a launcher that starts the real browser and exits within seconds, so
// `proc.kill()` ended nothing and every test run left its browser (and a tree of helpers) behind: after enough runs there were hundreds, enough to stall the computer.
//
// So a browser is found by what is certain to be unique to it, its own profile folder (a fresh random name for every run, which is on the command line of the browser and of every
// helper it starts), not by the process number. It only ever touches processes whose command line holds that folder, never any other browser on the computer.
//
//   const guard = guardBrowser(proc, profileDir);
//   try { ... } finally { guard.stop(); }
//
// - `stop()` ends every process that was started with the profile, and removes the folder.
// - If the test process exits any other way (an error, a signal), the same happens from an exit hook.
// - If the test process is killed outright, so nothing of its own can run, a tiny watcher process started now notices that its parent is gone and does it instead.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const WINDOWS_LIST = '(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:GUARD_PROFILE) -and $_.ProcessId -ne $PID }).ProcessId';

/** The numbers of the processes that were started with this profile folder on their command line. */
export function processesOfProfile(profile) {
  if (!profile) return [];
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_LIST], { env: { ...process.env, GUARD_PROFILE: profile }, encoding: 'utf8', windowsHide: true });
    return String(r.stdout ?? '').split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  }
  const r = spawnSync('pgrep', ['-f', '--', profile], { encoding: 'utf8' });
  return String(r.stdout ?? '').split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
}

/** End every process that was started with this profile folder, and wait until none is left (up to a few seconds). Returns how many it ended. */
export function killProfile(profile) {
  let ended = 0;
  for (let round = 0; round < 6; round++) {
    const pids = processesOfProfile(profile).filter((p) => p !== process.pid);
    if (pids.length === 0) break;
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); ended++; } catch { /* already gone */ } }
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 250)']);                           // a moment, for helpers that start more helpers
  }
  return ended;
}

/** End a process and everything it started, when its number is known to be right. */
export function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, 'SIGKILL');
  } catch { /* it is already gone */ }
  try { process.kill(pid, 'SIGKILL'); } catch { /* ditto */ }
}

export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Run by the watcher. It waits for the test process to disappear, then ends the browser's processes and removes the profile folder; it leaves quietly when the folder is gone
// (the test cleaned up after itself). The folder comes in the environment, not the command line, so the watcher is never mistaken for part of the browser.
const WATCHER = `
const { spawnSync } = require('node:child_process');
const { existsSync, rmSync } = require('node:fs');
const parent = Number(process.argv[1]), profile = process.env.GUARD_PROFILE;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const mine = () => {
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ${JSON.stringify(WINDOWS_LIST)}], { env: process.env, encoding: 'utf8', windowsHide: true });
    return String(r.stdout || '').split(/\\s+/).map(Number).filter((n) => n > 0);
  }
  return String(spawnSync('pgrep', ['-f', '--', profile], { encoding: 'utf8' }).stdout || '').split(/\\s+/).map(Number).filter((n) => n > 0 && n !== process.pid);
};
const timer = setInterval(() => {
  if (alive(parent)) { if (!existsSync(profile)) { clearInterval(timer); process.exit(0); } return; }
  clearInterval(timer);
  for (let round = 0; round < 6; round++) {
    const pids = mine();
    if (!pids.length) break;
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 250)']);
  }
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(0);
}, 1000);
`;

/**
 * Watch over a browser a test has started.
 * @param {import('node:child_process').ChildProcess} proc what `spawn` gave back (it may only be a launcher: the profile is what finds the browser)
 * @param {string} [profile] the browser's profile folder (a fresh one for this run)
 * @returns {{stop: () => void}}
 */
export function guardBrowser(proc, profile) {
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    killProfile(profile);
    killTree(proc.pid);
    if (profile) { try { rmSync(profile, { recursive: true, force: true }); } catch { /* a helper may hold a file for a moment: the watcher tries again */ } }
  };
  const onSignal = (signal) => { end(); process.exit(signal === 'SIGINT' ? 130 : 143); };
  process.on('exit', end);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  if (profile) {
    const watcher = spawn(process.execPath, ['-e', WATCHER, String(process.pid)], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, GUARD_PROFILE: profile } });
    watcher.unref();
  }
  return {
    stop() {
      end();
      process.off('exit', end);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    },
  };
}

export { existsSync };
