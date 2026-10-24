// node tools/sync-templates.js [write | check]
//   write   copy the examples that templates are made from into packages/create-game/templates (imports become @engine/<package>)
//   check   fail if a template has drifted from its example (npm test runs this)
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sync, check, TEMPLATES } from './sync-templates-lib.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cmd = process.argv[2] ?? 'write';
if (cmd === 'write') console.log(`wrote ${sync(root).length} files for ${TEMPLATES.map((t) => t.name).join(', ')}`);
else if (cmd === 'check') {
  const problems = check(root);
  if (problems.length) { console.error(`${problems.join('\n')}\nrun: node tools/sync-templates.js`); process.exit(1); }
  console.log('Templates match their examples.');
} else { console.error('usage: node tools/sync-templates.js [write | check]'); process.exit(2); }
