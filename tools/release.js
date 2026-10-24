// Releases: node tools/release.js <command>
//   check                 are the package.json files what they should be? (npm test runs this)
//   sync                  rewrite them (versions, dependencies from real imports, descriptions from the README table, files, exports)
//   bump <patch|minor|major|x.y.z>   new version everywhere; CHANGELOG.md's "Unreleased" becomes that version
//   pack [--out dir]      make the tarballs npm would publish and check them (default dir: release/)
//   verify [--out dir]    pack, install every tarball into a fresh project, and import every package from there
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, sync, bump, pack, generate } from './release-lib.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

async function main() {
  if (cmd === 'check') {
    const problems = check(root);
    if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
    console.log(`Package metadata is in sync (${generate(root).size} packages, version ${generate(root).values().next().value.version}).`);
  } else if (cmd === 'sync') {
    const changed = sync(root);
    console.log(changed.length ? `updated: ${changed.join(', ')}` : 'nothing to change');
  } else if (cmd === 'bump') {
    if (!rest[0]) throw new Error('usage: node tools/release.js bump <patch|minor|major|x.y.z>');
    const r = bump(root, rest[0]);
    console.log(`${r.from} -> ${r.to}${r.changelog ? ' (CHANGELOG.md updated)' : ''}\nnext: npm test, node tools/release.js verify, then tag v${r.to} and publish`);
  } else if (cmd === 'pack' || cmd === 'verify') {
    const out = resolve(flag('--out') ?? join(root, 'release'));
    const results = await pack(root, out);
    let bad = 0;
    for (const r of results) { console.log(`${r.name.padEnd(12)} ${kb(r.bytes).padStart(10)} packed ${kb(r.unpacked).padStart(10)} unpacked  ${String(r.files).padStart(3)} files`); for (const p of r.problems) { bad++; console.log(`  PROBLEM: ${r.name} ${p}`); } }
    console.log(`${results.length} tarballs in ${out}`);
    if (bad) process.exit(1);
    if (cmd === 'verify') {
      const { verifyInstall } = await import('./release-verify.js');
      const v = await verifyInstall(out, results);
      for (const line of v.lines) console.log(line);
      if (v.failed) process.exit(1);
    }
  } else {
    console.error('usage: node tools/release.js check | sync | bump <patch|minor|major|x.y.z> | pack [--out dir] | verify [--out dir]');
    process.exit(2);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
