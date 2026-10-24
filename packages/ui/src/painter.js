// Painters: what the UI draws with. The UI only asks for filled rectangles and text, so a painter is three small functions.

/**
 * Draw into a sprite batch (the engine's 2D renderer), so the UI costs no extra draw calls and works in all three backends.
 * @param {object} o
 * @param {import('../../render/src/batch.js').SpriteBatch} o.batch
 * @param {object} o.dot An atlas sprite that is plain white (any size; it is stretched).
 * @param {import('../../render/src/text.js').Font} [o.font] The font; text is scaled to the requested size.
 * @param {(size: number) => import('../../render/src/text.js').Font} [o.fontFor] Or a font per size (crisper than scaling one font).
 * The batch is not cleared here: clear it yourself at the start of the frame, draw the game's own HUD into it, then call `ui.draw()`.
 * @returns {import('./ui.js').Painter & {batch: object}}
 */
export function createSpritePainter({ batch, dot, font, fontFor }) {
  if (!font && !fontFor) throw new Error('createSpritePainter needs a font or fontFor');
  const pick = (size) => fontFor?.(size) ?? font;
  // every sample of the stretched sprite reads its centre texel, so edges stay crisp (no bleed from the atlas around it)
  const cu = (dot.u0 + dot.u1) / 2, cv = (dot.v0 + dot.v1) / 2;
  const solid = { ...dot, u0: cu, v0: cv, u1: cu, v1: cv };
  const box = (x, y, w, h, color) => batch.push(x + w / 2, y + h / 2, w, h, 0, solid, color);
  return {
    batch,
    rect(x, y, w, h, color, radius = 0) {
      const r = Math.min(Math.round(radius), 2);
      if (r < 1 || w < r * 4 || h < r * 4) { box(x, y, w, h, color); return; }
      // rounded corners cut square, from three pieces that do not overlap (translucent colours must not be drawn twice)
      box(x + r, y, w - r * 2, h, color);
      box(x, y + r, r, h - r * 2, color);
      box(x + w - r, y + r, r, h - r * 2, color);
    },
    text(str, x, y, { size, color, align = 'left', maxWidth, shadow = false }) {
      pick(size).draw(batch, str, x, y, { tint: color, align, size, maxWidth: maxWidth ?? Infinity, shadow: shadow ? { dx: 1, dy: 1 } : undefined });
    },
    measure(str, { size, maxWidth = Infinity }) {
      const m = pick(size).measure(str, { size, maxWidth });
      return { width: m.width, height: m.height };
    },
  };
}

/**
 * A painter that records what it was asked to draw, with a fixed-width fake font. For tests and bots: lay out a screen, press
 * buttons, and check the commands, without a browser.
 * @param {{charWidth?: number}} [o] Width of a character as a fraction of the font size.
 */
export function createRecordingPainter({ charWidth = 0.6 } = {}) {
  const commands = [];
  const width = (s, size) => [...s].length * size * charWidth;
  const wrap = (str, size, maxWidth) => {
    const lines = [];
    for (const para of String(str).split('\n')) {
      let line = '';
      for (const word of para.split(/(?<= )/)) {
        if (line !== '' && width((line + word).trimEnd(), size) > maxWidth) { lines.push(line.trimEnd()); line = word; } else line += word;
      }
      lines.push(line.trimEnd());
    }
    return lines;
  };
  return {
    commands,
    begin() { commands.length = 0; },
    rect(x, y, w, h, color, radius) { commands.push({ kind: 'rect', x, y, w, h, color, radius }); },
    text(str, x, y, o) { commands.push({ kind: 'text', text: str, x, y, ...o }); },
    measure(str, { size, maxWidth = Infinity }) {
      const lines = wrap(str, size, maxWidth);
      return { width: Math.max(...lines.map((l) => width(l, size))), height: lines.length * Math.round(size * 1.25), lines };
    },
    /** The texts drawn, in order. */
    texts() { return commands.filter((c) => c.kind === 'text').map((c) => c.text); },
  };
}

/**
 * Draw with a 2D canvas context (`CanvasRenderingContext2D`): for a UI over a plain canvas, or an overlay on a game that has no
 * sprite renderer.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{family?: string, weight?: string}} [o]
 */
export function createCanvasPainter(ctx, { family = 'system-ui, sans-serif', weight = 'normal' } = {}) {
  const css = (c) => `rgba(${c & 255},${(c >>> 8) & 255},${(c >>> 16) & 255},${((c >>> 24) / 255).toFixed(3)})`;
  const setFont = (size) => { ctx.font = `${weight} ${size}px ${family}`; ctx.textBaseline = 'top'; };
  const wrap = (str, size, maxWidth) => {
    setFont(size);
    const lines = [];
    for (const para of String(str).split('\n')) {
      let line = '';
      for (const word of para.split(/(?<= )/)) {
        if (line !== '' && ctx.measureText((line + word).trimEnd()).width > maxWidth) { lines.push(line.trimEnd()); line = word; } else line += word;
      }
      lines.push(line.trimEnd());
    }
    return lines;
  };
  return {
    rect(x, y, w, h, color, radius = 0) {
      ctx.fillStyle = css(color);
      if (radius > 0 && ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill(); } else ctx.fillRect(x, y, w, h);
    },
    text(str, x, y, { size, color, align = 'left', maxWidth, shadow = false }) {
      const lines = maxWidth === undefined ? String(str).split('\n') : wrap(str, size, maxWidth);
      setFont(size);
      ctx.textAlign = align;
      lines.forEach((line, i) => {
        const ly = y + i * Math.round(size * 1.25);
        if (shadow) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(line, x + 1, ly + 1); }
        ctx.fillStyle = css(color);
        ctx.fillText(line, x, ly);
      });
    },
    measure(str, { size, maxWidth = Infinity }) {
      const lines = Number.isFinite(maxWidth) ? wrap(str, size, maxWidth) : String(str).split('\n');
      setFont(size);
      return { width: Math.max(...lines.map((l) => ctx.measureText(l).width)), height: lines.length * Math.round(size * 1.25) };
    },
  };
}
