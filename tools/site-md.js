// A small Markdown renderer for the documentation site (no dependencies): headings with anchors, paragraphs, nested lists, tables, quotes (callouts),
// fenced code with a little syntax colouring, inline code, links, images, and raw HTML blocks (used for diagrams and cards).

export const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A URL-safe id for a heading. */
export const slug = (s) => s.toLowerCase().replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9\s_-]/g, '').trim().replace(/\s+/g, '-') || 'section';

// ---------- code colouring ----------
const JS_KEYWORDS = new Set('import export from const let var function return if else for while do switch case break continue new class extends static async await of in typeof instanceof throw try catch finally default this null undefined true false yield void delete get set'.split(' '));
/** Wrap the parts of a code sample in coloured spans (comments, strings, numbers, keywords, calls). Unknown languages are only escaped. */
export function highlight(code, lang = '') {
  const l = lang.toLowerCase();
  if (['js', 'javascript', 'mjs', 'ts', 'json', 'jsonc'].includes(l)) {
    const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*)(\s*\()?|([\s\S])/g;
    let out = '', m;
    while ((m = re.exec(code))) {
      if (m[1] !== undefined) out += `<span class="tk-c">${escapeHtml(m[1])}</span>`;
      else if (m[2] !== undefined) out += `<span class="tk-s">${escapeHtml(m[2])}</span>`;
      else if (m[3] !== undefined) out += `<span class="tk-n">${m[3]}</span>`;
      else if (m[4] !== undefined) {
        if (l.startsWith('json')) out += escapeHtml(m[4]) + (m[5] ? escapeHtml(m[5]) : '');
        else if (JS_KEYWORDS.has(m[4])) out += `<span class="tk-k">${m[4]}</span>${m[5] ? escapeHtml(m[5]) : ''}`;
        else if (m[5]) out += `<span class="tk-f">${m[4]}</span>${escapeHtml(m[5])}`;
        else out += m[4];
      } else out += escapeHtml(m[6]);
    }
    return out;
  }
  if (['sh', 'bash', 'shell', 'console', 'powershell'].includes(l)) {
    return code.split('\n').map((line) => {
      const i = line.search(/(^|\s)#/);
      const body = i >= 0 ? line.slice(0, i + (line[i] === '#' ? 0 : 1)) : line, note = i >= 0 ? line.slice(i + (line[i] === '#' ? 0 : 1)) : '';
      return escapeHtml(body).replace(/(\s)(--?[\w-]+)/g, '$1<span class="tk-n">$2</span>') + (note ? `<span class="tk-c">${escapeHtml(note)}</span>` : '');
    }).join('\n');
  }
  return escapeHtml(code);
}

// ---------- inline ----------
/** @param {string} text @param {(href: string) => string} [fixLink] */
export function inline(text, fixLink = (h) => h) {
  const codes = [];
  let s = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, c) => { codes.push(`<code>${escapeHtml(c.trim())}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = escapeHtml(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${fixLink(src, true)}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, t, href) => {
    const h = fixLink(href.replace(/&amp;/g, '&'));
    return h === null ? `<span class="src">${t}</span>` : `<a href="${escapeHtml(h)}">${t}</a>`;
  });
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  s = s.replace(/&lt;br\s*\/?&gt;/g, '<br>');
  s = s.replace(/&lt;(\/?)(kbd|sub|sup)&gt;/g, '<$1$2>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

// ---------- blocks ----------
const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
const bullet = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/**
 * @param {string} md
 * @param {{fixLink?: (href: string, image?: boolean) => string | null}} [opts]
 * @returns {{html: string, headings: {level: number, id: string, text: string}[], text: string}}
 */
export function renderMarkdown(md, { fixLink, blocks = {} } = {}) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const headings = [], used = new Map(), out = [], plain = [];
  const inl = (t) => inline(t, fixLink);
  const stripTags = (h) => h.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  let i = 0;
  const uid = (base) => { const n = used.get(base) ?? 0; used.set(base, n + 1); return n ? `${base}-${n}` : base; };

  function list(indent) {                                              // a list whose items start at `indent` spaces
    const first = bullet.exec(lines[i]), ordered = /\d/.test(first[2]);
    const startAt = ordered ? Number(/\d+/.exec(first[2])[0]) : 1;
    let html = ordered ? `<ol${startAt !== 1 ? ` start="${startAt}"` : ''}>` : '<ul>';
    while (i < lines.length) {
      const m = bullet.exec(lines[i]);
      if (!m || m[1].length < indent || (m[1].length === indent && /\d/.test(m[2]) !== ordered)) break;
      if (m[1].length > indent) break;
      let item = m[3]; i++;
      let nested = '';
      for (;;) {
        if (i >= lines.length) break;
        const l = lines[i];
        if (l.trim() === '') { const nx = lines[i + 1]; if (nx !== undefined && /^\s{2,}\S/.test(nx) && bullet.test(nx)) { i++; continue; } break; }
        const nb = bullet.exec(l);
        if (nb && nb[1].length > indent) { nested += list(nb[1].length); continue; }
        if (nb && nb[1].length <= indent) break;
        if (/^\s{2,}\S/.test(l)) { item += ` ${l.trim()}`; i++; continue; }
        break;
      }
      plain.push(item);
      html += `<li>${inl(item)}${nested}</li>`;
    }
    return html + (ordered ? '</ol>' : '</ul>');
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    const fence = /^(\s*)(`{3,}|~{3,})\s*([\w+-]*)\s*(.*)$/.exec(line);
    if (fence) {
      const [, , ticks, lang, rest] = fence; const body = []; i++;
      while (i < lines.length && !new RegExp(`^\\s*${ticks[0]}{${ticks.length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++;
      const code = body.join('\n');
      out.push(`<div class="code"><pre><code class="lang-${lang || 'text'}">${highlight(code, lang)}</code></pre><button class="copy" type="button" aria-label="Copy">Copy</button></div>`);
      plain.push(code); void rest;
      continue;
    }
    const block = /^\{\{(\w+):(\w+)\}\}\s*$/.exec(line);
    if (block) { const make = blocks[block[1]]?.[block[2]]; if (!make) throw new Error(`unknown block ${block[0]}`); out.push(make()); i++; continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1].length, html = inl(h[2]), text = stripTags(html), id = uid(slug(text));
      headings.push({ level, id, text }); plain.push(text);
      out.push(`<h${level} id="${id}">${html}${level > 1 ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : ''}</h${level}>`); i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s*<(div|svg|section|figure|details|p|ul|ol|table|a|img|aside|nav|header|footer|h[1-6]|pre|iframe|video|style|canvas|label|button|input)[\s>]/i.test(line)) {
      const body = [];
      while (i < lines.length && lines[i].trim() !== '') body.push(lines[i++]);
      // an SVG may hold blank lines: keep reading until it closes
      let html = body.join('\n');
      if (/^\s*<svg/i.test(html)) while (!/<\/svg>\s*$/i.test(html) && i < lines.length) html += `\n${lines[i++]}`;
      out.push(html); continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(line), aligns = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
      i += 2; const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      const td = (tag, c, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inl(c)}</${tag}>`;
      out.push(`<div class="table"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, k) => td('td', r[k] ?? '', k)).join('')}</tr>`).join('')}</tbody></table></div>`);
      plain.push(head.join(' '), ...rows.map((r) => r.join(' ')));
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      const inner = renderMarkdown(body.join('\n'), { fixLink, blocks });
      const kind = /^<p><strong>(Note|Tip|Warning|Important|Why)\b/i.exec(inner.html)?.[1]?.toLowerCase();
      out.push(`<blockquote${kind ? ` class="callout ${kind}"` : ''}>${inner.html}</blockquote>`); plain.push(inner.text);
      continue;
    }
    if (bullet.test(line)) { out.push(list(bullet.exec(line)[1].length)); continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|\s*(`{3,}|~{3,})|\s*>|\s*<(div|svg|section|figure|details)[\s>])/.test(lines[i]) && !(bullet.test(lines[i]) && para.length) && !(isTableRow(lines[i]) && lines[i + 1] && isSep(lines[i + 1]))) para.push(lines[i++]);
    const text = para.map((l) => l.trim()).join(' ');
    plain.push(text);
    out.push(`<p>${inl(text)}</p>`);
  }
  return { html: out.join('\n'), headings, text: plain.join(' ').replace(/\s+/g, ' ').replace(/[*_`]/g, '').trim() };
}
