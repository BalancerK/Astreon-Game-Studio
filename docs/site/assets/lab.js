// The lag lab on the "Multiplayer, explained" page: a tiny simulation of one character you steer (with or without client prediction) and one you do not
// (with or without interpolation), over a link with a latency you choose. Everything is derived from one clock, so the ring (the server's truth) and the
// dot (what your screen shows) are exact.
(() => {
  const $ = (id) => document.getElementById(id);
  const cv = $('lab-canvas'); if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, SPEED = 0.42, SNAP = 0.05;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
  const keys = new Set();
  addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { keys.add(e.key); if (cv.matches(':hover') || document.activeElement === cv) e.preventDefault(); } });
  addEventListener('keyup', (e) => keys.delete(e.key));
  const out = (id, fmt) => { const el = $(id), o = $(`${id}-out`); const f = () => { o.textContent = fmt(el.value); }; el.addEventListener('input', f); f(); };
  out('lab-lat', (v) => `${v} ms`); out('lab-loss', (v) => `${v}%`);

  let t = 0, last = performance.now(), pos = 0.5, srv = 0.5, push = [], samples = [], snaps = [], nextSnap = 0, lossRng = 7;
  const rnd = () => ((lossRng = (Math.imul(lossRng, 1664525) + 1013904223) >>> 0) / 4294967296);
  const tri = (x) => Math.abs(((x % 2) + 2) % 2 - 1);                                 // 0..1..0
  const other = (time) => 0.08 + 0.84 * tri(time * 0.42);                             // the other player's true path
  const dirAt = (time) => (keys.has('ArrowLeft') ? -1 : 0) + (keys.has('ArrowRight') ? 1 : 0) || 0;
  const autoDir = (time) => Math.sign(Math.sin(time * 0.9)) * 0.9;
  let hist = [];                                                                       // {t, dir}: what you pressed when
  $('lab-push').addEventListener('click', () => push.push({ at: t + $('lab-lat').value / 2000, amount: pos > 0.5 ? -0.16 : 0.16 }));
  const dirOf = (time) => { for (let i = hist.length - 1; i >= 0; i--) if (hist[i].t <= time) return hist[i].dir; return 0; };

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    const lat = $('lab-lat').value / 1000, one = lat / 2, loss = $('lab-loss').value / 100;
    const dir = $('lab-auto').checked ? autoDir(t) : dirAt(t);
    hist.push({ t, dir }); while (hist.length > 600) hist.shift();
    // the server applies what you pressed `one` seconds ago
    srv = Math.min(1, Math.max(0, srv + dirOf(t - one) * SPEED * dt));
    for (const p of push) if (p.at <= t && !p.done) { srv = Math.min(1, Math.max(0, srv + p.amount)); p.done = true; }
    push = push.filter((p) => !p.done || t - p.at < 5);
    samples.push({ t, srv }); while (samples.length > 600) samples.shift();
    const srvAt = (time) => { for (let i = samples.length - 1; i >= 0; i--) if (samples[i].t <= time) return samples[i].srv; return samples[0].srv; };
    // your own character: either what the server told you one way ago, or a guess that is corrected by the same news
    const known = srvAt(t - one);
    let shown;
    if ($('lab-pred').checked) {                                                       // the server's word, plus the inputs it has not seen yet
      let ahead = 0; for (let i = hist.length - 1; i >= 0 && hist[i].t > t - lat; i--) ahead += hist[i].dir * SPEED * (i ? hist[i].t - hist[i - 1].t : 0);
      shown = Math.min(1, Math.max(0, known + ahead));
    } else shown = known;
    // the other player: the server sends 20 snapshots a second; some are lost
    while (nextSnap <= t) { if (rnd() >= loss) snaps.push({ send: nextSnap, arrive: nextSnap + one, pos: other(nextSnap) }); nextSnap += SNAP; }
    snaps = snaps.filter((s) => s.arrive > t - 2);
    const arrived = snaps.filter((s) => s.arrive <= t);
    let seen = arrived.length ? arrived[arrived.length - 1].pos : 0.5;
    if ($('lab-interp').checked && arrived.length > 1) {
      const target = t - one - 0.1;                                                   // a little in the past, between two snapshots we already have
      let a = arrived[0], b = arrived[arrived.length - 1];
      for (let i = arrived.length - 1; i > 0; i--) if (arrived[i - 1].send <= target) { a = arrived[i - 1]; b = arrived[i]; break; }
      const k = b.send === a.send ? 1 : Math.min(1, Math.max(0, (target - a.send) / (b.send - a.send)));
      seen = a.pos + (b.pos - a.pos) * k;
    }
    draw(shown, srv, seen, other(t));
    requestAnimationFrame(frame);
  }
  function draw(shown, truth, seen, otherTruth) {
    const dpr = devicePixelRatio || 1;
    if (cv.width !== Math.round(cv.clientWidth * dpr)) { cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(270 / 760 * cv.clientWidth * dpr); }
    const w = cv.width, h = cv.height, s = w / 760;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h); ctx.scale(s, s);
    const fg = css('--fg'), dim = css('--dim'), line = css('--line'), a1 = css('--accent'), a2 = css('--accent2');
    const X = (p) => 60 + p * 640;
    const lane = (y, title, sub) => {
      ctx.fillStyle = css('--bg2'); ctx.strokeStyle = line; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(10, y - 56, 740, 112, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = fg; ctx.font = '600 14px system-ui'; ctx.fillText(title, 24, y - 34); ctx.fillStyle = dim; ctx.font = '12px system-ui'; ctx.fillText(sub, 24, y - 18);
      ctx.strokeStyle = line; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(X(0), y + 14); ctx.lineTo(X(1), y + 14); ctx.stroke();
    };
    const ring = (p, y, c) => { ctx.strokeStyle = c; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(X(p), y + 14, 15, 0, 7); ctx.stroke(); };
    const dot = (p, y, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(X(p), y + 14, 9, 0, 7); ctx.fill(); };
    lane(72, 'You', $('lab-pred').checked ? 'prediction on: your screen answers at once' : 'prediction off: your screen waits for the server');
    ring(truth, 72, dim); dot(shown, 72, a1);
    lane(198, 'Another player', $('lab-interp').checked ? 'interpolation on: drawn slightly in the past, blended' : 'interpolation off: drawn as each update arrives');
    ring(otherTruth, 198, dim); dot(seen, 198, a2);
    ctx.fillStyle = dim; ctx.font = '12px system-ui'; ctx.textAlign = 'right'; ctx.fillText('ring: the truth right now    dot: what you see', 740, 262); ctx.textAlign = 'left';
  }
  requestAnimationFrame(frame);
})();
