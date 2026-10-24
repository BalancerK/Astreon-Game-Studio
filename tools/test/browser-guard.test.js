// The guard that keeps test browsers from outliving the test that started them. These tests use harmless stand-ins, never a real browser. The stand-in copies what Chrome does on the
// computer where the leak was found: the process you start is only a launcher that starts the real browser and exits at once, and the browser (and its helpers) carry the profile
// folder on their command line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { guardBrowser, killTree, alive, processesOfProfile, killProfile } from '../browser-guard.js';

const GUARD = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'browser-guard.js')).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { for (let t = 0; t < ms; t += 150) { if (fn()) return true; await sleep(150); } return fn(); };

/** The stand-in launcher: starts the "browser" (which sleeps and starts a helper of its own, both with the profile on their command line), prints their numbers and exits. */
const LAUNCHER = `
const { spawn } = require('node:child_process');
const profile = process.argv[1];
const b = spawn(process.execPath, ['-e', "const { spawn } = require('node:child_process'); const h = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'helper', '--user-data-dir=' + process.argv[1]], { stdio: 'ignore' }); console.log(h.pid); setInterval(() => {}, 1000);", profile, '--user-data-dir=' + profile], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
b.stdout.once('data', (d) => { console.log(b.pid + ' ' + String(d).trim()); process.exit(0); });
`;

const freshProfile = () => mkdtempSync(join(tmpdir(), 'engine-chrome-guardtest-'));

/** Start a stand-in the way a test would: returns the launcher, and the numbers of the browser and its helper. */
async function standIn(profile) {
  const launcher = spawn(process.execPath, ['-e', LAUNCHER, profile], { stdio: ['ignore', 'pipe', 'ignore'] });
  const line = await new Promise((res) => launcher.stdout.once('data', (d) => res(String(d).trim())));
  const [browser, helper] = line.split(' ').map(Number);
  return { launcher, browser, helper };
}
const cleanup = (profile, ...pids) => { for (const p of pids) if (p && alive(p)) killTree(p); try { rmSync(profile, { recursive: true, force: true }); } catch { /* fine */ } };

test('the launcher is gone but its browser is not: that is the case that leaked, and the profile finds the browser anyway', async () => {
  const profile = freshProfile();
  const { launcher, browser, helper } = await standIn(profile);
  try {
    assert.ok(await until(() => !alive(launcher.pid)), 'the launcher exits');
    assert.ok(alive(browser) && alive(helper), 'but the browser and its helper are running');
    const found = processesOfProfile(profile);
    assert.ok(found.includes(browser) && found.includes(helper), `found by the profile: ${found}`);
    assert.equal(spawnSync(process.execPath, ['-e', 'process.exit(0)']).status, 0);
    const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    try {
      killProfile(profile);
      assert.ok(await until(() => !alive(browser) && !alive(helper)), 'both are ended');
      assert.ok(alive(bystander.pid), 'a process that was not started with the profile is left alone');
    } finally { killTree(bystander.pid); }
  } finally { cleanup(profile, launcher.pid, browser, helper); }
});

test('stop() ends the browser and its helpers even though the launcher it was given is long gone, and removes the profile', async () => {
  const profile = freshProfile();
  const { launcher, browser, helper } = await standIn(profile);
  try {
    await until(() => !alive(launcher.pid));
    const guard = guardBrowser(launcher, profile);
    guard.stop();
    assert.ok(await until(() => !alive(browser) && !alive(helper)), 'the browser tree is gone');
    assert.equal(existsSync(profile), false, 'and so is the profile folder');
  } finally { cleanup(profile, launcher.pid, browser, helper); }
});

test('stop() twice is harmless, and the exit hooks are taken away again', async () => {
  const profile = freshProfile();
  const { launcher, browser, helper } = await standIn(profile);
  const before = process.listenerCount('exit');
  try {
    const guard = guardBrowser(launcher, profile);
    assert.equal(process.listenerCount('exit'), before + 1);
    guard.stop();
    guard.stop();
    assert.equal(process.listenerCount('exit'), before, 'nothing is left registered');
  } finally { cleanup(profile, launcher.pid, browser, helper); }
});

/** Run a script as a "test" process: it starts a stand-in, guards it, and then ends in the way the test says. */
function runTest(ending, profile) {
  const code = `import { spawn } from 'node:child_process'; import { guardBrowser } from ${JSON.stringify(GUARD)};
    const launcher = spawn(process.execPath, ['-e', ${JSON.stringify(LAUNCHER)}, ${JSON.stringify(profile)}], { stdio: ['ignore', 'pipe', 'ignore'] });
    launcher.stdout.once('data', (d) => { process.stdout.write('pids ' + String(d).trim() + '\\n'); guardBrowser(launcher, ${JSON.stringify(profile)}); ${ending} });
    setInterval(() => {}, 1000);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 30000 });
  const [, browser, helper] = /pids (\d+) (\d+)/.exec(r.stdout) ?? [];
  assert.ok(browser, `the helper script ran: ${r.stdout} ${r.stderr}`);
  return [Number(browser), Number(helper)];
}

test('a test process that ends without cleaning up still takes its browser with it', async () => {
  const profile = freshProfile();
  const [browser, helper] = runTest('process.exit(0);', profile);
  try { assert.ok(await until(() => !alive(browser) && !alive(helper)), 'the exit hook ended the browser tree'); } finally { cleanup(profile, browser, helper); }
});

test('a test process that is killed outright (nothing of its own can run) is noticed by the watcher, which ends the browser and removes the profile', async () => {
  const profile = freshProfile();
  const [browser, helper] = runTest("setTimeout(() => process.kill(process.pid, 'SIGKILL'), 600);", profile);
  try {
    assert.ok(await until(() => !alive(browser) && !alive(helper), 20000), 'the watcher ended the browser tree');
    assert.ok(await until(() => !existsSync(profile), 8000), 'and removed the profile folder');
  } finally { cleanup(profile, browser, helper); }
});

test('two browsers at once do not touch each other: each is found by its own profile', async () => {
  const a = freshProfile(), b = freshProfile();
  const one = await standIn(a), two = await standIn(b);
  try {
    guardBrowser(one.launcher, a).stop();
    assert.ok(await until(() => !alive(one.browser) && !alive(one.helper)));
    assert.ok(alive(two.browser) && alive(two.helper), 'the other browser is still running');
  } finally { cleanup(a, one.launcher.pid, one.browser, one.helper); cleanup(b, two.launcher.pid, two.browser, two.helper); }
});
