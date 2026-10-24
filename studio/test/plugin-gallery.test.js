import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { GALLERY, sampleUrl } from '../plugins/gallery.js';
import { parseManifest, checkManifest } from '../plugins/protocol.js';

const sourceOf = (file) => readFileSync(sampleUrl(file), 'utf8');

/** A pretend studio that records what the plugin sets up, so activating it proves its code runs and its manifest matches. */
function stubStudio(calls) {
  const noop = async () => undefined;
  return {
    files: { list: async () => [], read: async () => '', write: noop, remove: noop },
    ui: { toast: noop },
    log: noop,
    state: { get: async () => ({}), set: noop },
    game: { summary: async () => ({ score: 1 }) },
    on: (name) => calls.events.push(name),
    panel: (fn) => { calls.panel = fn; },
    command: (id) => calls.commands.push(id),
    exporter: (id) => calls.exporters.push(id),
    importer: (id) => calls.importers.push(id),
  };
}

test('the gallery lists every sample plugin file and nothing that is not there, each with its own id and a plain sentence', () => {
  const files = readdirSync(new URL('../plugins/examples/', import.meta.url)).filter((f) => f.endsWith('.plugin.js')).sort();
  assert.deepEqual(GALLERY.map((g) => g.file).sort(), files, 'every sample is in the gallery');
  assert.equal(new Set(GALLERY.map((g) => g.id)).size, GALLERY.length);
  assert.ok(GALLERY.length >= 6);
  for (const g of GALLERY) assert.ok(g.title && g.blurb.length > 20, g.file);
});

test('every sample has a valid manifest that matches the gallery, and asks for as little as it can', () => {
  for (const g of GALLERY) {
    const manifest = checkManifest(parseManifest(sourceOf(g.file)));
    assert.equal(manifest.id, g.id, g.file);
    assert.ok(!manifest.permissions.includes('files.write'), `${g.file}: samples never ask to change your files`);
    assert.ok(manifest.name && manifest.description.length > 20, g.file);
    assert.ok(manifest.panels.length + manifest.commands.length + manifest.exporters.length + manifest.importers.length > 0, `${g.file} adds something`);
  }
  const asks = Object.fromEntries(GALLERY.map((g) => [g.id, checkManifest(parseManifest(sourceOf(g.file))).permissions]));
  assert.deepEqual(asks.notepad, []);
  assert.deepEqual(asks['dice-roller'], []);
  assert.deepEqual(asks['todo-finder'], ['files.read']);
  assert.deepEqual(asks['score-watch'], ['game.read']);
});

test('every sample activates, and sets up exactly the panels, commands, exporters and importers its manifest promises', async () => {
  for (const g of GALLERY) {
    const manifest = checkManifest(parseManifest(sourceOf(g.file)));
    const module = await import(`data:text/javascript;base64,${Buffer.from(sourceOf(g.file)).toString('base64')}`);
    const calls = { events: [], commands: [], exporters: [], importers: [], panel: null };
    await module.default(stubStudio(calls));
    assert.deepEqual(calls.commands.sort(), manifest.commands.map((c) => c.id).sort(), `${g.file}: commands`);
    assert.deepEqual(calls.exporters.sort(), manifest.exporters.map((c) => c.id).sort(), `${g.file}: exporters`);
    assert.deepEqual(calls.importers.sort(), manifest.importers.map((c) => c.id).sort(), `${g.file}: importers`);
    assert.equal(typeof calls.panel, manifest.panels.length ? 'function' : 'object', `${g.file}: panel`);
  }
});

test('samples only put text on the page as text, never as markup built from data', () => {
  for (const g of GALLERY) {
    const src = sourceOf(g.file);
    for (const m of src.matchAll(/innerHTML\s*=\s*([^;]+);/g)) assert.ok(!/\$\{|\+\s*[a-z]/i.test(m[1].replace(/'[^']*'/g, '')), `${g.file}: innerHTML from data: ${m[0].slice(0, 60)}`);
  }
});
