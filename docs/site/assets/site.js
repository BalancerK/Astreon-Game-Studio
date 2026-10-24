// The documentation site's behaviour: theme switch, copy buttons, search, the table of contents highlight, the mobile menu.
(() => {
  const root = document.documentElement;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } } };
  const saved = store.get('theme'); if (saved) root.dataset.theme = saved;
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  const themeBtn = document.getElementById('theme-btn');
  const paint = () => { if (themeBtn) themeBtn.textContent = isDark() ? '☀' : '☾'; };
  paint();
  themeBtn?.addEventListener('click', () => { root.dataset.theme = isDark() ? 'light' : 'dark'; store.set('theme', root.dataset.theme); paint(); });

  document.getElementById('menu-btn')?.addEventListener('click', () => document.body.classList.toggle('menu-open'));
  document.querySelector('nav.side')?.addEventListener('click', (e) => { if (e.target.closest('a')) document.body.classList.remove('menu-open'); });

  for (const b of document.querySelectorAll('.code .copy')) {
    b.addEventListener('click', async () => {
      const text = b.parentElement.querySelector('code').innerText;
      try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; } catch { b.textContent = 'Press Ctrl+C'; }
      setTimeout(() => { b.textContent = 'Copy'; }, 1400);
    });
  }

  // the table of contents follows the reader
  const links = [...document.querySelectorAll('aside.toc a')];
  if (links.length && 'IntersectionObserver' in window) {
    const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
    const seen = new Set();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) (e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id));
      const first = [...byId.keys()].find((id) => seen.has(id));
      if (first) for (const [id, a] of byId) a.classList.toggle('on', id === first);
    }, { rootMargin: '-70px 0px -65% 0px' });
    for (const id of byId.keys()) { const el = document.getElementById(id); if (el) io.observe(el); }
  }

  // search over the generated index (window.SEARCH is loaded from search-index.js: entries are [title, section, url, text])
  const dlg = document.getElementById('search'), input = dlg?.querySelector('input'), list = dlg?.querySelector('ul');
  const base = document.documentElement.dataset.base || '';
  let sel = 0, hits = [];
  const open = () => { dlg.classList.add('open'); input.value = ''; render(''); input.focus(); };
  const close = () => dlg.classList.remove('open');
  const score = (e, words) => {
    const t = e[0].toLowerCase(), x = e[3].toLowerCase(); let s = 0;
    for (const w of words) {
      if (t === w) s += 60; else if (t.startsWith(w)) s += 30; else if (t.includes(w)) s += 18;
      if (x.includes(w)) s += 4; else if (!t.includes(w)) return 0;
    }
    return s;
  };
  function render(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    hits = (window.SEARCH || []).map((e) => [score(e, words), e]).filter((h) => (words.length ? h[0] > 0 : false)).sort((a, b) => b[0] - a[0]).slice(0, 30).map((h) => h[1]);
    if (!words.length) hits = (window.SEARCH || []).filter((e) => e[4] === 1).slice(0, 12);
    sel = 0;
    list.innerHTML = hits.length ? hits.map((e, i) => `<li><a href="${base}${e[2]}" class="${i === 0 ? 'sel' : ''}"><span class="where">${e[1]}</span><b></b><small></small></a></li>`).join('') : '<div class="none">Nothing found.</div>';
    [...list.querySelectorAll('li')].forEach((li, i) => { li.querySelector('b').textContent = hits[i][0]; li.querySelector('small').textContent = hits[i][3].slice(0, 120); });
  }
  const move = (d) => { const a = [...list.querySelectorAll('a')]; if (!a.length) return; a[sel]?.classList.remove('sel'); sel = (sel + d + a.length) % a.length; a[sel].classList.add('sel'); a[sel].scrollIntoView({ block: 'nearest' }); };
  document.getElementById('search-btn')?.addEventListener('click', open);
  dlg?.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  input?.addEventListener('input', () => render(input.value));
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { const a = list.querySelectorAll('a')[sel]; if (a) location.href = a.href; }
  });
  addEventListener('keydown', (e) => {
    const typing = /input|textarea/i.test(document.activeElement?.tagName || '');
    if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); open(); }
    else if (e.key === 'Escape') close();
  });
})();
