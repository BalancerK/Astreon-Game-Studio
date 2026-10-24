// Working across the files of a project: go to where a name is declared, list where it is used, give it another name everywhere, and search or replace in all
// the files. The reading and planning are pure functions (editing/code-index.js and editing/project-search.js); this is the part that asks the person, keeps a
// restore point, writes the files and offers an Undo.
import { definitionAt, referencesAt, planRename, applyEdits, nameAt } from '../editing/code-index.js';
import { replaceProject } from '../editing/project-search.js';
import { findAll } from '../editing/find.js';
import { promptText, showDialog } from '../ui/dialog.js';
import { h } from '../ui/dom.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Uses as search results (grouped by file, with the line of text and where the name sits in it). */
export function resultsFromUses(files, uses) {
  const byPath = new Map();
  for (const u of uses) {
    const line = files[u.path].split('\n')[u.line - 1] ?? '';
    const lead = line.length - line.trimStart().length;
    const hit = {
      index: u.index, length: u.end - u.index, line: u.line, column: u.column, role: u.role,
      text: line.trim().slice(0, 160), start: u.column - 1 - lead,
    };
    (byPath.get(u.path) ?? byPath.set(u.path, []).get(u.path)).push(hit);
  }
  return [...byPath].map(([path, hits]) => ({ path, hits }));
}

const caret = (studio) => studio.editorApi?.caret?.() ?? null;

/** Go to where the name under the cursor is declared. */
export function goToDefinition(studio, at = caret(studio)) {
  if (!at) return false;
  const found = definitionAt(studio.textFiles(), at.path, at.index);
  if (!found) {
    const word = nameAt(at.text, at.index);
    studio.toasts.show(word ? `“${word.name}” is not declared in this project.` : 'Put the cursor on a name first.', { kind: 'info' });
    return false;
  }
  if (found.kind === 'external') {
    studio.toasts.show(`“${found.name}” comes from ${found.source}. Here is its help.`, { kind: 'info' });
    studio.editorApi?.action('help');
    return true;
  }
  studio.goto(found.path, found.line, found.column);
  return true;
}

/** List every use of the name under the cursor in the Search panel. */
export function findUses(studio, at = caret(studio)) {
  if (!at) return null;
  const files = studio.textFiles();
  const refs = referencesAt(files, at.path, at.index);
  if (!refs) {
    studio.toasts.show('Put the cursor on a name that is declared in this project.', { kind: 'info' });
    return null;
  }
  if (refs.external) {
    studio.toasts.show(`“${refs.external.name}” comes from ${refs.external.source}, so its uses are not listed.`, { kind: 'info' });
    return null;
  }
  const results = resultsFromUses(files, refs.uses);
  studio.dock.show('search');
  studio.searchApi?.showUses(refs.name, results, refs.uses.length);
  return refs;
}

async function confirmChanges({ title, summary, perFile, confirmLabel }) {
  const list = h('ul', { class: 'change-list' }, perFile.map(([path, n]) => h('li', {}, h('code', { text: path }), ` — ${plural(n, 'change')}`)));
  const body = h('div', {}, h('p', { text: summary }), list,
    h('p', { class: 'dim', text: 'A restore point is saved first, and Undo stays on screen for a while afterwards.' }));
  const buttons = [{ label: 'Cancel', value: false }, { label: confirmLabel, value: true, primary: true }];
  return (await showDialog({ title, body, buttons })) === true;
}

/** Write new texts for several files, after a restore point, with an Undo. */
async function writeAll(studio, changes, message) {
  const before = {};
  for (const path of Object.keys(changes)) before[path] = studio.project.readText(path);
  try {
    await studio.project.snapshot({ label: message.replace(/[.]$/, '') });
    studio.emit('snapshots');
  } catch { /* a restore point that could not be made must not stop the change */ }
  for (const [path, text] of Object.entries(changes)) studio.project.write(path, text);
  studio.toasts.show(message, {
    kind: 'success', ms: 12_000,
    action: {
      label: 'Undo',
      run: () => { for (const [path, text] of Object.entries(before)) if (studio.project?.has(path)) studio.project.write(path, text); },
    },
  });
}

/** Give the name under the cursor another name, everywhere it is used, after showing what will change. */
export async function renameSymbol(studio, at = caret(studio), askName = null) {
  if (!at) return false;
  const files = studio.textFiles();
  const word = nameAt(at.text, at.index);
  if (!word) { studio.toasts.show('Put the cursor on a name first.', { kind: 'info' }); return false; }
  const first = planRename(files, at.path, at.index, `${word.name}_`);
  if (first.error && !/already|starts with/.test(first.error)) { studio.toasts.show(first.error, { kind: 'info' }); return false; }
  const newName = askName ? await askName(word.name) : await promptText({
    title: `Rename “${word.name}”`, label: 'New name', value: word.name, confirmLabel: 'Review',
    validate: (value) => {
      const p = planRename(files, at.path, at.index, value.trim());
      return p.error ?? (p.clashes.length ? `Clash: ${p.clashes[0]}.` : null);
    },
  });
  if (newName === undefined) return false;
  const plan = planRename(files, at.path, at.index, newName.trim());
  if (plan.error || plan.clashes.length) { studio.toasts.show(plan.error ?? `Clash: ${plan.clashes[0]}.`, { kind: 'error' }); return false; }
  const perFile = [...plan.edits.reduce((m, e) => m.set(e.path, (m.get(e.path) ?? 0) + 1), new Map())];
  const ok = await confirmChanges({
    title: `Rename “${plan.name}” to “${plan.newName}”`, confirmLabel: 'Rename', perFile,
    summary: `${plural(plan.edits.length, 'place')} in ${plural(plan.files, 'file')} will change. `
      + (plan.scope ? `Only inside ${plan.scope}. ` : '')
      + 'Only this name is changed (not words with the same letters in text, or the same name in a different function).',
  });
  if (!ok) return false;
  await writeAll(studio, applyEdits(files, plan.edits), `Renamed ${plan.name} to ${plan.newName}.`);
  return true;
}

/** Replace in all files: shows how many places in how many files first. */
export async function replaceInFiles(studio, query, replacement, options = {}, only = null) {
  const files = studio.textFiles();
  const out = replaceProject(files, query, replacement, options, only);
  if (out.error) { studio.toasts.show(`That pattern is not valid: ${out.error}`, { kind: 'error' }); return 0; }
  if (!out.count) { studio.toasts.show('Nothing to replace.', { kind: 'info' }); return 0; }
  const perFile = Object.keys(out.changes).map((p) => [p, findAll(files[p], query, options).matches.length]);
  const ok = await confirmChanges({
    title: 'Replace in files', confirmLabel: 'Replace', perFile,
    summary: `Replace “${query}” with “${replacement}”: ${plural(out.count, 'place')} in ${plural(Object.keys(out.changes).length, 'file')}.`,
  });
  if (!ok) return 0;
  await writeAll(studio, out.changes, `Replaced ${plural(out.count, 'match', 'matches')} in ${plural(Object.keys(out.changes).length, 'file')}.`);
  return out.count;
}
