// The documentation site generator: turns the Markdown that already lives in the repo (guides, tutorials, package READMEs, the generated API reference,
// the changelog) into one static, searchable, themeable website in `docs/site/`. No dependencies; the output is plain files you can open from disk or host anywhere.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, posix, extname } from 'node:path';
import { renderMarkdown, escapeHtml } from './site-md.js';
import { DIAGRAMS } from './site-diagrams.js';

export const SITE_DIR = 'docs/site';
const BRAND = 'Astreon Engine';

/** Which layer each package belongs to (also drawn in the architecture guide). */
export const LAYERS = [
  { id: 'foundation', title: 'Foundation', blurb: 'What everything else stands on.', packages: ['core', 'math'] },
  { id: 'simulation', title: 'Simulation', blurb: 'The rules of a world: movement, collisions, behaviour, levels.', packages: ['arcade', 'physics', 'ai', 'fsm', 'tween', 'prefab', 'scene'] },
  { id: 'presentation', title: 'Presentation', blurb: 'What the player sees, hears and touches.', packages: ['render', 'skeleton2d', 'particles', 'ui', 'input', 'audio', 'i18n'] },
  { id: 'content', title: 'Content and tools', blurb: 'Making, saving, building and inspecting a game.', packages: ['assets', 'save', 'editor', 'build', 'create-game', 'debug', 'mods'] },
  { id: 'multiplayer', title: 'Multiplayer', blurb: 'Getting players together and keeping the game fair and smooth.', packages: ['protocol', 'transport', 'server', 'client', 'replay', 'matchmaking', 'persist', 'turns'] },
];
const layerOf = (name) => LAYERS.find((l) => l.packages.includes(name));

const GUIDES = ['start-here', 'architecture', 'multiplayer-explained', '3d-games'];
const TUTORIALS = ['2d-platformer', '3d-shooter', 'multiplayer-card-game'];
const REFERENCE = [['CHANGELOG.md', 'changelog'], ['docs/PLAN.md', 'roadmap'], ['docs/STUDIO.md', 'studio'], ['docs/BENCHMARKS.md', 'benchmarks'], ['docs/SECURITY.md', 'security'], ['docs/MODDING.md', 'modding']];
const SECTIONS = [['guide', 'Guide', 'guide/start-here.html'], ['tutorials', 'Tutorials', 'tutorials/2d-platformer.html'], ['packages', 'Packages', 'packages/index.html'], ['api', 'API', 'api/index.html'], ['reference', 'Reference', 'reference/changelog.html']];
const IMAGE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);

const read = (root, p) => readFileSync(join(root, p), 'utf8');
const exists = (root, p) => existsSync(join(root, p));
const firstTitle = (md, fallback) => /^#\s+(.+?)\s*$/m.exec(md)?.[1].replace(/`/g, '') ?? fallback;
const firstParagraph = (md) => (md.split(/\n\s*\n/).map((b) => b.trim()).find((b) => b && !/^(#|```|\||>|<|[-*]\s)/.test(b)) ?? '').replace(/\s+/g, ' ');
const plain = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '');

/** Every page of the site, in reading order, with its source Markdown (nothing is rendered yet). */
export function collectPages(root) {
  const pages = [];
  const add = (p) => pages.push(p);
  for (const id of GUIDES) { const src = `docs/guide/${id}.md`; if (exists(root, src)) add({ section: 'guide', id, src, out: `guide/${id}.html`, md: read(root, src) }); }
  for (const id of TUTORIALS) { const src = `docs/tutorials/${id}.md`; if (exists(root, src)) add({ section: 'tutorials', id, group: 'Tutorials', src, out: `tutorials/${id}.html`, md: read(root, src) }); }
  const examples = readdirSync(join(root, 'examples')).filter((d) => exists(root, `examples/${d}/README.md`)).sort();
  for (const d of examples) add({ section: 'tutorials', id: `example-${d}`, group: 'Example games', exampleName: d, src: `examples/${d}/README.md`, out: `examples/${d}.html`, md: read(root, `examples/${d}/README.md`) });
  const names = readdirSync(join(root, 'packages')).filter((d) => exists(root, `packages/${d}/README.md`));
  const ordered = [...LAYERS.flatMap((l) => l.packages), ...names.filter((n) => !layerOf(n)).sort()].filter((n) => names.includes(n));
  add({ section: 'packages', id: 'index', src: null, out: 'packages/index.html', generated: 'packages', title: 'Packages' });
  for (const n of ordered) {
    const readme = read(root, `packages/${n}/README.md`);
    add({ section: 'packages', id: n, group: layerOf(n)?.title ?? 'Other', pkg: n, src: `packages/${n}/README.md`, out: `packages/${n}.html`, md: readme });
  }
  if (exists(root, 'docs/api/README.md')) add({ section: 'api', id: 'index', src: 'docs/api/README.md', out: 'api/index.html', md: read(root, 'docs/api/README.md') });
  for (const n of ordered) if (exists(root, `docs/api/${n}.md`)) add({ section: 'api', id: n, group: layerOf(n)?.title ?? 'Other', pkg: n, src: `docs/api/${n}.md`, out: `api/${n}.html`, md: read(root, `docs/api/${n}.md`) });
  for (const [src, id] of REFERENCE) if (exists(root, src)) add({ section: 'reference', id, src, out: `reference/${id}.html`, md: read(root, src) });
  for (const p of pages) { if (p.md) { p.title = firstTitle(p.md, p.id); p.summary = plain(firstParagraph(p.md.replace(/^#\s+.*$/m, ''))); } }
  return pages;
}

/** Turn page sources into HTML pages, the search index and the list of problems found (links that lead nowhere). */
export function buildSite(root, { version = '0.0.0', imageDir = 'docs/img' } = {}) {
  const pages = collectPages(root);
  const bySrc = new Map(pages.filter((p) => p.src).map((p) => [p.src, p]));
  const byPkg = new Map(pages.filter((p) => p.section === 'packages' && p.pkg).map((p) => [p.pkg, p]));
  const byExample = new Map(pages.filter((p) => p.exampleName).map((p) => [p.exampleName, p]));
  const problems = [], links = [], images = new Map();

  for (const page of pages) {
    if (page.generated) continue;
    const dir = posix.dirname(page.src);
    const rel = (target) => posix.relative(posix.dirname(page.out), target.out) || posix.basename(target.out);
    const fixLink = (href, isImage) => {
      if (/^(https?:|mailto:|data:)/.test(href)) return href;
      if (href.startsWith('#')) { links.push({ from: page.out, to: page, hash: href.slice(1) }); return href; }
      const [pathPart, hash = ''] = href.split('#');
      const target = posix.normalize(posix.join(dir, pathPart)).replace(/\/$/, '');
      if (isImage) {
        if (IMAGE_TYPES.has(extname(target)) && exists(root, target)) { images.set(target, `img/${posix.basename(target)}`); return `${posix.relative(posix.dirname(page.out), `img/${posix.basename(target)}`)}`; }
        problems.push(`${page.src}: image ${href} not found`); return href;
      }
      const hit = bySrc.get(target) ?? (target === 'packages' ? pages.find((p) => p.out === 'packages/index.html') : null) ?? (target === 'docs/api' ? bySrc.get('docs/api/README.md') : null) ?? (target === 'docs/api/index.html' ? bySrc.get('docs/api/README.md') : null)
        ?? (/^packages\/[^/]+(\/README\.md)?$/.test(target) ? byPkg.get(target.split('/')[1]) : null)
        ?? (/^examples\/[^/]+(\/README\.md)?$/.test(target) ? byExample.get(target.split('/')[1]) : null);
      if (hit) { links.push({ from: page.out, to: hit, hash }); return rel(hit) + (hash ? `#${hash}` : ''); }
      return null;                                             // a path in the source tree: shown, not linked
    };
    let md = page.md;
    if (page.section === 'packages') {                         // a package page: its README, then a pointer to the full API
      const api = pages.find((p) => p.section === 'api' && p.pkg === page.pkg);
      if (api) md += `\n\n## Every export\n\nThe complete, generated list of this package's exports (every function, class and option) is on its [API page](../api/${page.pkg}.html).\n`;
    }
    const r = renderMarkdown(md, { fixLink, blocks: { diagram: Object.fromEntries(Object.entries(DIAGRAMS).map(([k, f]) => [k, () => f({ layers: LAYERS })])) } });
    page.html = r.html; page.headings = r.headings; page.text = r.text;
  }
  // links to headings must point at headings that exist
  for (const l of links) if (l.hash && l.to.headings && !l.to.headings.some((h) => h.id === l.hash) && !/id="/.test(l.to.html ?? '') ) problems.push(`${l.from}: link to #${l.hash} in ${l.to.out} has no such heading`);
  for (const l of links) if (l.hash && l.to.html && !l.to.html.includes(`id="${l.hash}"`)) problems.push(`${l.from}: link to #${l.hash} in ${l.to.out} has no such heading`);

  const stats = siteStats(root, pages);
  for (const p of pages) if (p.generated === 'packages') { const g = packagesIndex(pages); p.html = g.html; p.headings = g.headings; p.text = g.text; p.summary = 'Every package, grouped by what it is for.'; }
  const home = homePage(root, pages, stats, imageDir, images);
  const files = {};
  const nav = (page) => sidebar(pages, page);
  const secPages = (page) => pages.filter((p) => p.section === page.section);
  for (const page of pages) {
    const sp = secPages(page), i = sp.indexOf(page);
    files[page.out] = shell({ page, nav: nav(page), prev: sp[i - 1], next: sp[i + 1], version });
  }
  files['index.html'] = shell({ page: { out: 'index.html', title: BRAND, section: 'home', html: home.html, headings: [], summary: 'A modular, zero-dependency JavaScript engine for browser games.' }, nav: null, version, home: true });
  files['assets/search-index.js'] = `window.SEARCH=${JSON.stringify(searchIndex(pages))};\n`;
  return { files, images, problems, pages };
}

// ---------- pieces ----------
function siteStats(root, pages) {
  const exportsTotal = (pages.find((p) => p.src === 'docs/api/README.md')?.md ?? '').split('\n').reduce((n, l) => n + (Number(/\|\s*(\d+)\s*\|\s*\d+%\s*\|\s*$/.exec(l)?.[1]) || 0), 0);
  const dirs = (p) => (exists(root, p) ? readdirSync(join(root, p)).filter((d) => statSync(join(root, p, d)).isDirectory()).length : 0);
  return { packages: dirs('packages'), examples: dirs('examples'), exports: exportsTotal };
}

function packagesIndex(pages) {
  const html = LAYERS.map((l) => `<h2 id="${l.id}">${l.title}</h2><p>${l.blurb}</p><div class="cards">${l.packages.map((n) => {
    const p = pages.find((x) => x.section === 'packages' && x.pkg === n); if (!p) return '';
    return `<a class="card" href="${n}.html"><h4><code>@engine/${n}</code></h4><p>${escapeHtml(p.summary.slice(0, 150))}</p></a>`;
  }).join('')}</div>`).join('\n');
  const intro = '<h1>Packages</h1><p>The engine is 26 small packages. Each is optional, has a README, and may only import the packages listed on its page. Use the ones your game needs; <a href="../guide/start-here.html">Start here</a> says which.</p>';
  return { html: intro + html, headings: LAYERS.map((l) => ({ level: 2, id: l.id, text: l.title })), text: LAYERS.map((l) => `${l.title} ${l.blurb} ${l.packages.join(' ')}`).join(' ') };
}

function homePage(root, pages, stats, imageDir, images) {
  const img = (name) => { const p = `${imageDir}/${name}`; if (exists(root, p)) { images.set(p, `img/${name}`); return `<img src="img/${name}" alt="" loading="lazy">`; } return ''; };
  const game = (href, tag, title, text, image) => `<a class="card" href="${href}">${img(image)}<span class="tag">${tag}</span><h3>${title}</h3><p>${text}</p></a>`;
  const feats = [
    ['⚡', 'Fast, fair multiplayer', 'An authoritative server, client prediction, delta snapshots and interest management keep a game responsive over a bad connection and small on the wire.'],
    ['🎮', '2D and 3D, WebGPU first', 'One renderer API over WebGPU, WebGL2 and Canvas2D. Shadows, bloom, particles, glTF and a character controller are included.'],
    ['🧩', 'Every system is optional', 'Twenty-six small packages with enforced import rules. Take the renderer without the networking, or the server without the renderer.'],
    ['🔁', 'Deterministic by design', 'Fixed timestep, seeded randomness and a maths library that gives the same bits in Node, Chrome and Firefox: replays and tests need no browser.'],
    ['📦', 'Zero dependencies', 'Plain JavaScript with JSDoc. No bundler, no framework, nothing to audit but this repository. It runs from source and builds to static files.'],
    ['🛠', 'Tools included', 'A scene editor, a build tool, a debug overlay with a packet inspector, a load tester, a mod sandbox and a project generator.'],
  ];
  const html = `<section class="hero"><h1>Build <em>fast browser games</em>, alone or together.</h1>
<p class="lead">A modular, zero-dependency JavaScript game engine with 2D and 3D rendering, real-time and turn-based multiplayer, and tools to make, test and ship your game.</p>
<div class="btns"><a class="btn primary" href="guide/start-here.html">Start here</a><a class="btn" href="guide/architecture.html">How it works</a><a class="btn" href="packages/index.html">Browse packages</a></div>
<div class="code"><pre><code>npx create-game my-game --template 3d
cd my-game &amp;&amp; npm run dev</code></pre><button class="copy" type="button">Copy</button></div></section>
<div class="wrap"><div class="stats"><div class="stat"><b>${stats.packages}</b><span>packages</span></div><div class="stat"><b>${stats.exports}</b><span>documented exports</span></div><div class="stat"><b>${stats.examples}</b><span>example games</span></div><div class="stat"><b>0</b><span>runtime dependencies</span></div></div>
<section class="section"><h2>Why this engine</h2><p>Built for games that need to feel instant, and small enough to understand completely.</p><div class="features">${feats.map(([ic, t, d]) => `<div class="feature"><div class="ic">${ic}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}</div></section>
<section class="section"><h2>Learn by building</h2><p>Three complete games, each with a written walkthrough and tests. Read the rules, then change them.</p><div class="games">
${game('tutorials/2d-platformer.html', '2D', 'A platformer', 'Tile levels, jumps that feel right (coyote time, jump buffer), enemies, springs, sound made in code.', 'platformer.jpg')}
${game('tutorials/3d-shooter.html', '3D', 'A first-person shooter', 'Ray-cast shots with headshots, robots that see you and aim, waves, shadows, bloom and particles.', 'shooter.jpg')}
${game('tutorials/multiplayer-card-game.html', 'Multiplayer', 'An online card game', 'Hidden hands, matchmaking, ratings, a leaderboard, robots for empty seats and reconnecting.', 'crazy-eights.jpg')}
</div></section>
<section class="section"><h2>Where to go next</h2><div class="cards">
<a class="card" href="guide/start-here.html"><h3>Start here</h3><p>Pick the packages for the game you want to make and get it running in five minutes.</p></a>
<a class="card" href="guide/architecture.html"><h3>How it works</h3><p>The layers, the loop, the rules that keep the packages apart, and why.</p></a>
<a class="card" href="guide/multiplayer-explained.html"><h3>Multiplayer, explained</h3><p>Lag, prediction, interpolation and deltas in plain language, with pictures.</p></a>
<a class="card" href="api/index.html"><h3>API reference</h3><p>Every export of every package, generated from the source.</p></a>
</div></section></div>`;
  return { html };
}

function sidebar(pages, page) {
  const sp = pages.filter((p) => p.section === page.section);
  const href = (p) => posix.relative(posix.dirname(page.out), p.out);
  const groups = []; let last = null;
  for (const p of sp) { const g = p.group ?? ''; if (g !== last) { groups.push({ title: g, items: [] }); last = g; } groups[groups.length - 1].items.push(p); }
  return groups.map((g) => `${g.title ? `<h4>${escapeHtml(g.title)}</h4>` : ''}${g.items.map((p) => `<a href="${href(p)}"${p === page ? ' class="on"' : ''}>${escapeHtml(sidebarTitle(p))}</a>`).join('')}`).join('');
}
const sidebarTitle = (p) => (p.pkg ? p.pkg : p.exampleName ? p.exampleName : p.id === 'index' ? (p.section === 'api' ? 'Overview' : 'All packages') : p.title.replace(/^Tutorial: /, ''));

function shell({ page, nav, prev, next, version, home = false }) {
  const depth = page.out.split('/').length - 1, base = '../'.repeat(depth);
  const toc = (page.headings ?? []).filter((h) => h.level === 2 || h.level === 3);
  const tabs = SECTIONS.map(([id, label, href]) => `<a href="${base}${href}"${page.section === id ? ' class="on"' : ''}>${label}</a>`).join('');
  const pager = (prev || next) ? `<div class="pager">${prev ? `<a href="${posix.relative(posix.dirname(page.out), prev.out)}"><small>Previous</small>${escapeHtml(sidebarTitle(prev))}</a>` : '<span></span>'}${next ? `<a class="next" href="${posix.relative(posix.dirname(page.out), next.out)}"><small>Next</small>${escapeHtml(sidebarTitle(next))}</a>` : '<span></span>'}</div>` : '';
  const header = `<header class="top"><button class="icon-btn" id="menu-btn" aria-label="Menu">☰</button><a class="brand" href="${base}index.html"><span class="logo">▶</span>${BRAND}</a><nav class="tabs" aria-label="Sections">${tabs}</nav><span class="spacer"></span><button class="search-btn" id="search-btn" type="button" aria-label="Search">⌕ <span>Search the docs</span><kbd>/</kbd></button><button class="icon-btn" id="theme-btn" type="button" aria-label="Switch between light and dark">☾</button></header>`;
  const body = home ? `<main style="padding:0">${page.html}</main>` : `<div class="shell"><nav class="side" aria-label="Pages">${nav}</nav><main><article>${page.html}${pager}</article></main><aside class="toc">${toc.length > 1 ? `<h4>On this page</h4>${toc.map((h) => `<a class="l${h.level}" href="#${h.id}">${escapeHtml(h.text)}</a>`).join('')}` : ''}</aside></div>`;
  const title = home ? `${BRAND}: fast browser games, alone or together` : `${page.title.replace(/^Tutorial: /, '')} · ${BRAND}`;
  return `<!doctype html>
<html lang="en" data-base="${base}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml((page.summary ?? '').slice(0, 200))}">
<script>try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<link rel="stylesheet" href="${base}assets/site.css">
</head>
<body>
${header}
${body}
<footer class="foot">${BRAND} ${escapeHtml(version)} · Apache-2.0 · Generated from the repository by <code>node tools/site.js</code></footer>
<div id="search" role="dialog" aria-label="Search"><div class="box"><input type="search" placeholder="Search pages, packages and exports…" autocomplete="off" aria-label="Search"><ul></ul></div></div>
<script src="${base}assets/search-index.js"></script>
<script src="${base}assets/site.js"></script>${(page.html ?? "").includes('id="lag-lab"') ? `<script src="${base}assets/lab.js"></script>` : ""}
</body>
</html>
`;
}

const SECTION_LABEL = { guide: 'Guide', tutorials: 'Tutorial', packages: 'Package', api: 'API', reference: 'Reference' };
function searchIndex(pages) {
  const out = [];
  for (const p of pages) {
    const label = SECTION_LABEL[p.section], featured = (p.section === 'guide' || p.section === 'tutorials') && !p.exampleName ? 1 : 0;
    out.push([p.title.replace(/^Tutorial: /, ''), label, p.out, (p.summary ?? '') + ' ' + (p.text ?? '').slice(0, 3000), featured]);
    for (const h of p.headings ?? []) if (h.level >= 2) out.push([h.text, label, `${p.out}#${h.id}`, p.title, 0]);
  }
  return out;
}
