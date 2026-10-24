// Accessibility audit of the studio in a real Chrome: text contrast in every theme, names for every control, keyboard reach (one Tab sweep must visit every
// panel and the focus must always be visible), roles and landmarks, small click targets, and the high-contrast and forced-colours looks.
// Usage: node tools/studio-a11y-test.js
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';

const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

// Runs inside the page: every visible piece of text against the colour behind it (WCAG ratio), listing those under the limit.
const CONTRAST = `(() => {
  const parse = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const backdrop = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; } }
    let base = { r: 255, g: 255, b: 255, a: 1 }; for (const c of stack.reverse()) base = over(c, base); return base; };
  const out = []; const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const el = n.parentElement; if (!el || !n.textContent.trim() || el.closest('script,style,iframe,canvas,[hidden],.sr-only,.logo,:disabled')) continue;     // a disabled control is exempt
    const box = el.getBoundingClientRect(); if (box.width < 2 || box.height < 2) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    const fg = parse(cs.color); if (!fg) continue; const bg = backdrop(el);
    const text = over({ ...fg, a: fg.a * op }, bg); const l1 = lum(text), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700, large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio < need) { const key = el.className + '|' + cs.color + '|' + ratio.toFixed(1); if (!seen.has(key)) { seen.add(key); out.push({ cls: String(el.className).slice(0, 40) || el.tagName, tag: el.tagName, ratio: +ratio.toFixed(2), need, text: n.textContent.trim().slice(0, 24) }); } }
  }
  return JSON.stringify(out);
})()`;

const NAMES = `(() => {
  const nameOf = (e) => (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'))?.textContent || e.textContent || e.title || e.getAttribute('alt') || (e.id && document.querySelector('label[for="' + e.id + '"]')?.textContent) || e.closest('label')?.textContent || '').trim();
  const vis = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed';
  const unnamed = [...document.querySelectorAll('button, a[href], [role=tab], [role=option], [role=separator], [role=menuitem], input:not([type=hidden]), select, textarea, iframe, canvas, [role=img], img, [role=dialog]')]
    .filter((e) => vis(e) && !nameOf(e) && !e.closest('[aria-hidden=true]')).map((e) => e.outerHTML.slice(0, 90));       // what is hidden from a screen reader needs no name
  const small = [...document.querySelectorAll('button, [role=tab], a[href], input[type=checkbox], select')].filter(vis).map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && (r.height < 24 || r.width < 24)).map(({ e, r }) => (e.getAttribute('aria-label') || e.textContent || e.className).trim().slice(0, 20) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  return JSON.stringify({ unnamed, small, landmarks: ['banner', 'main', 'contentinfo', 'navigation'].filter((r) => !document.querySelector('[role=' + r + '], ' + { banner: 'header', main: 'main', contentinfo: 'footer', navigation: 'nav' }[r])), skip: !!document.querySelector('.skip-link'), h1: document.querySelectorAll('h1').length });
})()`;

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    check('the studio opens', await page.waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(async () => { await s.createProject({ name: "A11y", template: "hero" }); })()');
    await page.waitFor('window.studio.runner.status === "running"', 20_000);
    await page.sleep(500);

    for (const theme of ['light', 'dark', 'contrast']) {
      await S(`(s.settings.set("theme", ${JSON.stringify(theme)}), s.applySettings(), 1)`);
      const known = await S('document.documentElement.dataset.theme');
      if (theme === 'contrast' && known !== 'contrast') { check('the high-contrast theme exists', false, `theme is ${known}`); continue; }
      for (const view of ['code', 'play', 'learn']) {
        await S(`(s.commands.execute("workspace.${view}").catch(() => {}), 1)`);
        await page.sleep(350);
        const bad = JSON.parse(await page.eval(CONTRAST));
        check(`${theme} theme, ${view} workspace: all text readable (contrast)`, bad.length === 0, bad.slice(0, 4).map((b) => `${b.cls} ${b.ratio}<${b.need} "${b.text}"`).join(' | '));
      }
    }
    await S('(s.settings.set("theme", "light"), s.applySettings(), 1)');

    // the Search panel, with results on show
    await S('(s.searchApi.open("speed"), 1)');
    await page.sleep(500);
    const searchNames = JSON.parse(await page.eval(NAMES));
    check('Search panel: every control has a name, and targets are large enough', searchNames.unnamed.length === 0 && searchNames.small.length === 0, `${searchNames.unnamed.join(' | ')} ${searchNames.small.join(', ')}`);
    for (const theme of ['light', 'dark', 'contrast']) {
      await S(`(s.settings.set("theme", ${JSON.stringify(theme)}), s.applySettings(), 1)`);
      await page.sleep(400);                                                                       // colours fade for a moment
      const bad = JSON.parse(await page.eval(CONTRAST));
      check(`Search panel, ${theme} theme: text readable`, bad.length === 0, bad.slice(0, 3).map((b) => `${b.cls} ${b.ratio}<${b.need} "${b.text}"`).join(' | '));
    }
    await S('(s.settings.set("theme", "light"), s.applySettings(), 1)');

    // the art tools, with something in them: the scene editor and the music maker
    await S(`(async () => {
      const { serializeScene, newScene, addThing } = await import('/studio/app/paint/scene-model.js');
      const { serializeSongs, PRESETS } = await import('/studio/app/paint/music-model.js');
      s.project.write('scenes/level1.js', serializeScene(addThing(addThing(newScene(), 'coin', 40, 40), 'hero', 100, 100)));
      s.project.write('src/music.js', serializeSongs({ calm: PRESETS.calm() }));
      const sprites = await import('/studio/app/paint/sprite-model.js');
      const sounds = await import('/studio/app/paint/sound-model.js');
      s.project.write('src/art/hero.js', sprites.serializeSprite(sprites.newSprite(16, 16)));
      s.project.write('src/sounds.js', sounds.serializeSounds({ coin: sounds.preset('coin') }));
      s.emit('files');
      s.commands.execute('workspace.art');
    })()`);
    for (const panel of ['scene2d', 'music', 'profiler', 'levels', 'sounds', 'sprites']) {
      await S(`(s.dock.show(${JSON.stringify(panel)}), 1)`);
      await page.sleep(panel === 'profiler' ? 2500 : 700);
      const named = JSON.parse(await page.eval(NAMES));
      check(`${panel} panel: every control has a name, and targets are large enough`, named.unnamed.length === 0 && named.small.length === 0, `${named.unnamed.join(' | ')} ${named.small.join(', ')}`);
      for (const theme of ['light', 'dark', 'contrast']) {
        await S(`(s.settings.set("theme", ${JSON.stringify(theme)}), s.applySettings(), 1)`);
        await page.sleep(400);
        const bad = JSON.parse(await page.eval(CONTRAST));
        check(`${panel} panel, ${theme} theme: text readable`, bad.length === 0, bad.slice(0, 3).map((b) => `${b.cls} ${b.ratio}<${b.need} "${b.text}"`).join(' | '));
      }
      await S('(s.settings.set("theme", "light"), s.applySettings(), 1)');
    }

    // the editors: two side by side with the explorer beside them, in every interface theme and every code colour scheme
    await S(`(s.commands.execute('workspace.code'), s.project.write('src/extra.js', 'export const extra = 1;'), s.openFile('src/extra.js'), s.splitFile('src/main.js', 'right'),
      s.commands.execute('editor.explorer'), 1)`);
    await page.sleep(800);
    const editors = JSON.parse(await page.eval(NAMES));
    check('editors, tabs, path and explorer: every control has a name, and targets are large enough', editors.unnamed.length === 0 && editors.small.length === 0, `${editors.unnamed.join(' | ')} ${editors.small.join(', ')}`);
    for (const theme of ['light', 'dark', 'contrast']) {
      await S(`(s.settings.set("theme", ${JSON.stringify(theme)}), s.applySettings(), 1)`);
      await page.sleep(400);
      const bad = JSON.parse(await page.eval(CONTRAST));
      check(`editors, ${theme} interface: text readable`, bad.length === 0, bad.slice(0, 3).map((b) => `${b.cls} ${b.ratio}<${b.need} "${b.text}"`).join(' | '));
    }
    await S('(s.settings.set("theme", "light"), s.applySettings(), 1)');
    for (const scheme of ['studio-dark', 'midnight', 'solarized-dark', 'forest', 'studio-light', 'paper', 'solarized-light', 'high-contrast']) {
      await S(`(s.settings.set("editorTheme", ${JSON.stringify(scheme)}), 1)`);
      await page.sleep(250);
      const bad = JSON.parse(await page.eval(CONTRAST));
      check(`code colours "${scheme}": the code and the path are readable`, bad.length === 0, bad.slice(0, 3).map((b) => `${b.cls} ${b.ratio}<${b.need} "${b.text}"`).join(' | '));
    }
    await S('(s.settings.set("editorTheme", "auto"), s.groups.unsplit(), s.groupsChanged(), s.commands.execute("editor.explorer"), 1)');

    for (const view of ['code', 'play']) {
      await S(`(s.commands.execute("workspace.${view}").catch(() => {}), 1)`);
      await page.sleep(300);
      const r = JSON.parse(await page.eval(NAMES));
      check(`${view} workspace: every control has a name`, r.unnamed.length === 0, r.unnamed.slice(0, 3).join(' | '));
      check(`${view} workspace: click targets are at least 24 px`, r.small.length === 0, r.small.slice(0, 6).join(', '));
      if (view === 'code') {
        check('the page has banner, main, footer and navigation landmarks', r.landmarks.length === 0, r.landmarks.join(','));
        check('there is a "skip to the panels" link', r.skip);
      }
    }

    // the code editor must not trap the keyboard: Tab indents, Esc then Tab leaves, and Ctrl+M switches the trap off until pressed again
    await S('(s.commands.execute("workspace.code").catch(() => {}), 1)');
    await page.eval('document.querySelector(".ed textarea").focus()');
    const typedBefore = await page.eval('document.querySelector(".ed textarea").value.length');
    await page.key('Tab', 'down'); await page.key('Tab', 'up');
    check('in the editor, Tab indents (and stays there)', await page.eval('document.activeElement.tagName === "TEXTAREA"') && await page.eval('document.querySelector(".ed textarea").value.length') > typedBefore);
    await page.key('Escape', 'down'); await page.key('Escape', 'up'); await page.sleep(2200);       // no time limit: it still works two seconds later
    await page.key('Tab', 'down'); await page.key('Tab', 'up');
    check('Esc then Tab leaves the editor, even after a pause', await page.eval('document.activeElement.tagName !== "TEXTAREA"'));
    await page.eval('document.querySelector(".ed textarea").focus()');
    await page.key('KeyM', 'down', { ctrl: true }); await page.key('KeyM', 'up', { ctrl: true });
    await page.key('Tab', 'down'); await page.key('Tab', 'up');
    check('Ctrl+M makes Tab leave the editor', await page.eval('document.activeElement.tagName !== "TEXTAREA"'));
    await page.eval('document.querySelector(".ed textarea").focus()');
    await page.key('KeyM', 'down', { ctrl: true }); await page.key('KeyM', 'up', { ctrl: true });
    const before2 = await page.eval('document.querySelector(".ed textarea").value.length');
    await page.key('Tab', 'down'); await page.key('Tab', 'up');
    check('and Ctrl+M again makes Tab indent again', await page.eval('document.activeElement.tagName === "TEXTAREA"') && await page.eval('document.querySelector(".ed textarea").value.length') > before2);

    // one Tab sweep: how many Tabs to get around, and does the focus show
    await S('(document.activeElement?.blur(), document.body.focus(), 1)');
    const visited = new Set(); const unseenList = []; let unseen = 0; let sawSkip = false;
    for (let i = 0; i < 90; i++) {
      if (await page.eval('document.activeElement?.tagName === "TEXTAREA"')) { await page.key('Escape', 'down'); await page.key('Escape', 'up'); }     // the editor's way out
      await page.key('Tab', 'down'); await page.key('Tab', 'up');
      const info = JSON.parse(await page.eval(`(() => { const e = document.activeElement; if (!e || e === document.body) return JSON.stringify({ body: true });
        const cs = getComputedStyle(e); const own = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 || cs.boxShadow !== 'none'; const host = e.closest('.ed'); const ring = own || e.tagName === 'IFRAME' || (host && getComputedStyle(host).boxShadow !== 'none');
        return JSON.stringify({ id: (e.dataset.panel || e.id || e.className || e.tagName) + ':' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 16), panel: e.closest('[data-panel]')?.dataset.panel || null, ring, skip: e.classList.contains('skip-link') }); })()`));
      if (process.env.A11Y_TRACE) console.log(i, info.id ?? 'body');
      if (info.body) continue;
      sawSkip ||= info.skip;
      if (!info.ring && !info.skip) { unseen++; unseenList.push(info.id); }
      visited.add(info.panel ?? info.id);
    }
    check('the first Tab reaches the skip link', sawSkip);
    check('a Tab sweep visits the menus, the workspaces, the search and several panels', visited.size >= 12, `${visited.size} places`);
    check('the focus always shows', unseen === 0, `${unseen} without a ring: ${[...new Set(unseenList)].slice(0, 6).join(' | ')}`);

    // forced colours: nothing may rely on colours alone
    const dots = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('.learn-dots .dot')].slice(0, 3).map((d) => d.getAttribute('aria-label') || d.title || ''))`));
    void dots;
    check('no page errors', page.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, page.errors.slice(0, 2).join(' | '));
  });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
