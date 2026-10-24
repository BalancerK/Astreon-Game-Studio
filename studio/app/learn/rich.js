// A lesson's text with a little formatting: `code` and **bold**, and nothing else. It is turned into pieces for the page to build with textContent, so text can
// never become markup. Pure, tested in Node.

/**
 * @param {string} text
 * @returns {{kind: 'text'|'code'|'bold', text: string}[]}
 */
export function richPieces(source) {
  const text = String(source ?? '');
  const out = [];
  const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push({ kind: 'text', text: text.slice(at, m.index) });
    out.push(m[1] !== undefined ? { kind: 'code', text: m[1] } : { kind: 'bold', text: m[2] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}
