// Mod author tooling.
//   node tools/mod.js validate <dir>            check a mod folder and print its hashes
//   node tools/mod.js run <dir> [--frames 120]  run a script mod in the real confined sandbox against synthetic frames
//   node tools/mod.js keygen <name>             write <name>.pub (public, share it) and <name>.key (private, keep it)
//   node tools/mod.js sign <dir> <name>.key     write <dir>/signature.json for the mod's current contents
//   node tools/mod.js pack <dir> <out.json>     write the whole bundle (manifest, files, signature) as one JSON file
//   node tools/mod.js selftest                  prove the sandbox contains the built-in attack samples
import { writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadBundleDir, ModManager, generateSigningKey, signHash, verifySignature } from '../packages/mods/src/node.js';
import { hashBundle, hashClientView } from '../packages/mods/src/index.js';
import { MOD_COMMANDS } from '../examples/arena/server/arena-server.js';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : fallback; };
const positional = rest.filter((a, i) => !a.startsWith('--') && !(rest[i - 1] ?? '').startsWith('--'));
const die = (msg) => { console.error(msg); process.exit(1); };

function load(dir) {
  if (!dir) die('give a mod folder');
  const r = loadBundleDir(resolve(dir));
  if (!r.ok) { for (const e of r.errors) console.error(`  x ${e}`); die(`${dir}: not a valid mod`); }
  for (const e of r.errors) console.error(`  ! ${e}`);
  return r.bundle;
}

async function main() {
  switch (cmd) {
    case 'validate': {
      const b = load(positional[0]);
      const m = b.manifest;
      console.log(`${m.id}@${m.version}  tier ${m.tier}${m.entry ? `  entry ${m.entry}` : ''}`);
      console.log(`  bundle hash  ${hashBundle(b)}`);
      if (m.rules || m.client) console.log(`  client hash  ${hashClientView(b)}  (what players verify)`);
      if (b.signature) console.log(`  signature    ${verifySignature(hashBundle(b), b.signature) ? 'valid' : 'INVALID'} (key ${b.signature.key.slice(0, 16)}...)`);
      console.log('OK');
      break;
    }
    case 'run': {
      const b = load(positional[0]);
      if (b.manifest.tier !== 'script') die('only script mods can be run');
      const frames = Number(flag('frames', 120));
      const logs = [];
      const m = new ModManager({ commands: MOD_COMMANDS, mode: 'process', log: (l) => logs.push(l), policy: { defaults: { tickEvery: 1 } } });
      const added = m.add(b);
      if (!added.ok) die(added.errors.join('\n'));
      await m.start();
      const players = Array.from({ length: 8 }, (_, i) => ({ id: i, x: 200 + i * 50, y: 300, hp: 40 + i * 8 }));
      for (let tick = 1; tick <= frames; tick++) {
        m.emitFrame({ tick, players, kills: tick % 6 === 0 ? [{ killer: 1, victim: 2 }] : [] });
        await new Promise((r) => setTimeout(r, 4));
      }
      await new Promise((r) => setTimeout(r, 50));
      const cmds = m.drainCommands();
      const s = m.list()[0];
      console.log(`status ${s.status}${s.reason ? ` (${s.reason})` : ''}   calls ${s.stats.calls}   avg ${s.stats.avgMs.toFixed(3)} ms   max ${s.stats.maxMs.toFixed(3)} ms   strikes ${s.strikes}`);
      console.log(`accepted ${s.stats.accepted} commands, rejected ${s.stats.rejected}; sample: ${JSON.stringify(cmds.slice(0, 3).map((c) => c.cmd))}`);
      for (const l of logs.slice(0, 10)) console.log(`  log: ${l}`);
      await m.close();
      if (s.status !== 'running') process.exit(1);
      break;
    }
    case 'keygen': {
      const name = positional[0] ?? die('give a key name');
      const k = generateSigningKey();
      writeFileSync(`${name}.pub`, `${k.publicKey}\n`);
      writeFileSync(`${name}.key`, k.privateKey, { mode: 0o600 });
      console.log(`wrote ${name}.pub (public key: ${k.publicKey})\nwrote ${name}.key (PRIVATE: never share or commit it)`);
      break;
    }
    case 'sign': {
      const b = load(positional[0]);
      const keyFile = positional[1] ?? die('give the private key file');
      const pub = readFileSync(keyFile.replace(/\.key$/, '.pub'), 'utf8').trim();
      const sig = signHash(hashBundle(b), { publicKey: pub, privateKey: readFileSync(keyFile, 'utf8') });
      writeFileSync(join(resolve(positional[0]), 'signature.json'), `${JSON.stringify(sig, null, 2)}\n`);
      console.log(`signed ${b.manifest.id} ${hashBundle(b).slice(0, 16)}... with key ${pub.slice(0, 16)}...\nAny edit to the mod invalidates this signature: sign again after changes.`);
      break;
    }
    case 'pack': {
      const b = load(positional[0]);
      writeFileSync(positional[1] ?? die('give an output file'), JSON.stringify(b, null, 2));
      console.log(`wrote ${positional[1]} (hash ${hashBundle(b)})`);
      break;
    }
    case 'selftest': {
      const { execFileSync } = await import('node:child_process');
      const out = execFileSync(process.execPath, ['--test', 'packages/mods/test/sandbox-core.test.js', 'packages/mods/test/process.test.js'], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' });
      console.log(out.split('\n').filter((l) => /^ℹ (tests|pass|fail)/.test(l)).join('\n'));
      break;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
      if (cmd) process.exit(1);
  }
}
main().catch((e) => die(e.stack ?? String(e)));
