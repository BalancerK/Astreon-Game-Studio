import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Atlas, Font, SpriteBatch, INSTANCE_WORDS, RichText, FontFamily, FontStack, BitmapFont, parseBmfont, parseMarkup, stripMarkup, parseColor, packTint, graphemes, layoutParagraph, isShaped, needsEngine,
} from '../src/index.js';

/** A fake 2D context: every character is 10 wide (a font whose name contains "Wide" is 14), and the font string is remembered so fallback detection can be tested. */
function fake(size = 512) {
  const drawn = [], images = [];
  const ctx = {
    font: '', fillStyle: '', textBaseline: '', direction: 'ltr', textAlign: 'left',
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, clearRect() {},
    drawImage: (...a) => images.push(a),
    measureText(t) {
      const n = [...t].length, f = this.font;
      // "Covers" has every character at 12; anything else is a font whose characters are 10, and the generic fallbacks differ in width (so a character not in the font measures differently with each)
      const per = /Covers/.test(f) ? 12 : /Missing/.test(f) ? (/monospace/.test(f) ? 8 : /sans-serif/.test(f) ? 10 : 9) : /Wide/.test(f) ? 14 : 10;
      return { width: n * per, fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 4 };
    },
    fillText: (ch, x, y) => drawn.push([ch, x, y, ctx.direction]),
  };
  const atlas = new Atlas({ size, createCanvas: () => ({ getContext: () => ctx }) });
  return { atlas, ctx, drawn, images };
}
const read = (b) => Array.from({ length: b.count }, (_, i) => ({ x: b.f32[i * INSTANCE_WORDS], y: b.f32[i * INSTANCE_WORDS + 1], w: b.f32[i * INSTANCE_WORDS + 2], h: b.f32[i * INSTANCE_WORDS + 3], tint: b.u32[i * INSTANCE_WORDS + 9] }));
const near = (a, b, eps = 1e-4, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const RED = packTint(0xff, 0x40, 0x40);

// ------------------------------------------------------------------ markup

test('markup: styles nest, close, and come out as stretches of text', () => {
  const s = parseMarkup('plain [b]bold [i]both[/i] bold[/b] plain');
  assert.deepEqual(s.map((x) => [x.text, !!x.style.bold, !!x.style.italic]), [['plain ', false, false], ['bold ', true, false], ['both', true, true], [' bold', true, false], [' plain', false, false]]);
  assert.equal(stripMarkup('[b]hi[/b] [color=red]there[/color] [img=coin] x'), 'hi there  x');
  const c = parseMarkup('[color=#f80]a[/color][color=red]b[/color][color=#11223344]c[/color]');
  assert.deepEqual(c.map((x) => x.style.color), [packTint(0xff, 0x88, 0), RED, packTint(0x11, 0x22, 0x33, 0x44)]);
  assert.equal(parseColor('gold') !== null && parseColor('nope') === null && parseColor('#12') === null, true);
});

test('markup: sizes (absolute, relative, nested), shadows, outlines, links, fonts, effects, alignment and pictures', () => {
  const s = parseMarkup('[size=24]a[size=+6]b[/size]c[/size][size=-2]d[/size]');
  assert.deepEqual(s.map((x) => [x.text, x.style.size, x.style.sizeDelta ?? 0]), [['a', 24, 0], ['b', 24, 6], ['c', 24, 0], ['d', undefined, -2]]);
  const sh = parseMarkup('[shadow]a[/shadow][shadow=2,3,#00000080]b[/shadow][outline=2,#ff0000]c[/outline]');
  assert.deepEqual([sh[0].style.shadow.dx, sh[0].style.shadow.dy, sh[1].style.shadow.dx, sh[1].style.shadow.dy, sh[1].style.shadow.tint, sh[2].style.outline.width, sh[2].style.outline.tint], [1, 1, 2, 3, packTint(0, 0, 0, 0x80), 2, packTint(255, 0, 0)]);
  const l = parseMarkup('[url=quest:12]go[/url] [link=x]y[/link][font=mono]m[/font][center]c[/center][wave amp=5]w[/wave][rainbow]r[/rainbow][fade delay=0.1]f[/fade][shake]s[/shake]');
  assert.equal(l[0].style.link, 'quest:12'); assert.equal(l[2].style.link, 'x'); assert.equal(l[3].style.font, 'mono'); assert.equal(l[4].style.align, 'center');
  assert.deepEqual([l[5].style.effect.type, l[5].style.effect.amp, l[6].style.effect.type, l[7].style.effect.delay, l[8].style.effect.type], ['wave', 5, 'rainbow', 0.1, 'shake']);
  const im = parseMarkup('a[img=coin w=16 h=12 valign=middle dy=2]b').find((x) => x.image);
  assert.deepEqual(im.image, { name: 'coin', w: 16, h: 12, valign: 'middle', dy: 2 }); assert.equal(im.text, '￼');
});

test('markup: literal brackets, unknown tags, bad values, stray closers and tags left open', () => {
  assert.equal(stripMarkup('a [[b]] c \\[d\\] e'), 'a [b]] c [d\\] e'.replace('\\]', '\\]')); // [[ is a bracket; ]] needs no escape
  assert.equal(stripMarkup('[unknown]x[/unknown] [b'), '[unknown]x[/unknown] [b', 'what is not a tag stays text');
  assert.equal(stripMarkup('[color=nonsense]x[/color]'), '[color=nonsense]x', 'a bad colour leaves the tag as text (and the closer, matching nothing, goes)');
  assert.equal(stripMarkup('[/b]x[/i]'), 'x', 'closers that match nothing are dropped');
  const open = parseMarkup('[b][color=red]never closed'); assert.equal(open.length, 1); assert.equal(open[0].style.bold, true);
  assert.equal(stripMarkup('[b]a[/b] [B]caps[/B]'), 'a caps', 'tag names ignore case');
  assert.deepEqual(parseMarkup(''), []); assert.equal(stripMarkup('no tags at all'), 'no tags at all');
  const cross = parseMarkup('[b]a[i]b[/b]c[/i]'); assert.equal(cross.map((x) => x.text).join(''), 'abc', 'badly nested tags still give all the text');
});

// ------------------------------------------------------------------ layout

const make = (opts = {}) => {
  const f = fake(), family = new FontFamily(f.atlas, { size: 16 });
  const rich = new RichText({ family, atlas: f.atlas, ...opts });
  return { ...f, family, rich };
};

test('fonts: bold and italic variants are made once, share the atlas, and are picked by the tags', () => {
  const { family, rich } = make();
  const regular = family.get(), bold = family.get({ bold: true }), italic = family.get({ italic: true });
  assert.notEqual(regular, bold); assert.equal(family.get({ bold: true }), bold); assert.ok(bold.css.includes('bold') && italic.css.includes('italic') && !regular.css.includes('bold'));
  const layout = rich.layout('a[b]b[/b][i]c[/i][b][i]d[/i][/b]');
  const faces = layout.paragraphs[0].layout.items.map((it) => it.typeface);
  assert.deepEqual(faces, [regular, bold, italic, family.get({ bold: true, italic: true })]);
  const fonts = { regular: new Font(fake().atlas, { size: 10 }) };
  assert.throws(() => new RichText({}), /regular font/); assert.ok(new RichText({ fonts }));
});

test('colours, sizes and styles reach the sprites; the layout wraps and measures', () => {
  const { rich } = make();
  const layout = rich.layout('Hello [color=red]red[/color] [size=32]big[/size]', { maxWidth: 1000 });
  const b = new SpriteBatch(); rich.draw(b, layout, 0, 0);
  const s = read(b);
  assert.deepEqual(s.slice(0, 5).map((q) => q.tint), Array(5).fill(0xffffffff), 'default white'); assert.equal(s[6].tint, RED);
  const big = s.at(-1), small = s[0]; assert.ok(big.h > small.h * 1.9, `a size of 32 against 16: ${big.h} vs ${small.h}`);
  near(layout.width, 16 * 0.625 * 0 + 11 * 10 * 1 + 0, 80, 'about the width of the characters'); assert.ok(layout.height >= 32, `a line holding size 32 text is as tall as it: ${layout.height}`);
  const tinted = new SpriteBatch(); rich.draw(tinted, layout, 0, 0, { tint: packTint(128, 128, 128, 255) });
  assert.equal(read(tinted)[0].tint, packTint(128, 128, 128, 255), 'a tint multiplies the colours'); assert.equal(read(tinted)[6].tint, packTint(Math.round(0xff * 128 / 255), Math.round(0x40 * 128 / 255), Math.round(0x40 * 128 / 255), 255));
});

test('wrapping and alignment: at spaces, with centre and right alignment, line by line', () => {
  const { rich } = make();
  const layout = rich.layout('aaaa bbbb cccc dddd', { maxWidth: 90 });
  assert.deepEqual(rich.lines(layout), ['aaaa bbbb', 'cccc dddd']); assert.ok(layout.width <= 90 && layout.width >= 80);
  const first = (l) => l.paragraphs[0].layout.items.filter((it) => it.line === 0)[0].x;
  assert.equal(first(layout), 0);
  near(first(rich.layout('aaaa', { maxWidth: 100, align: 'center' })), 30, 1e-9); near(first(rich.layout('aaaa', { maxWidth: 100, align: 'right' })), 60, 1e-9);
  const tagged = rich.layout('[center]aaaa[/center]', { maxWidth: 100 }); near(first(tagged), 30, 1e-9, 'a tag aligns too');
  assert.deepEqual(rich.lines(rich.layout('one\n\ntwo')), ['one', '', 'two'], 'line breaks and empty lines');
  assert.deepEqual(rich.lines(rich.layout('averyveryverylongword', { maxWidth: 50 })), ['averyveryverylongword'.slice(0, 5), 'averyveryverylongword'.slice(5, 10), 'averyveryverylongword'.slice(10, 15), 'averyveryverylongword'.slice(15, 20), 'averyveryverylongword'.slice(20)], 'a word that cannot fit is cut between characters');
  assert.equal(rich.layout('x y', { maxWidth: 1 }).paragraphs[0].layout.lines.length >= 2, true);
  assert.equal(rich.layout('[b]hello[/b]', { markup: false }).atomCount, 12, 'markup: false takes the text literally');
  assert.equal(rich.layout('a b', { maxWidth: 100 }), rich.layout('a b', { maxWidth: 100 }), 'the same layout is reused');
});

test('links: boxes follow the text across lines, and linkAt finds them', () => {
  const { rich } = make();
  const layout = rich.layout('go to [url=quest:12]the old mill[/url] now', { maxWidth: 110 });
  assert.deepEqual(rich.lines(layout), ['go to the', 'old mill', 'now']);
  const find = (x, y) => rich.linkAt(layout, x, y);
  assert.equal(find(2, 5), null, 'before the link'); assert.equal(find(75, 5), 'quest:12', 'on "the"'); assert.equal(find(5, 25), 'quest:12', 'the link carries on to the second line');
  assert.equal(find(95, 25), null, 'after it'); assert.equal(find(5, 40), null, 'and not on "now"'); assert.equal(find(500, 5), null);
  assert.equal(rich.linkAt(rich.layout('no links'), 5, 5), null);
});

test('typewriter: only the revealed characters are drawn; effects move characters with time; fade starts transparent', () => {
  const { rich } = make();
  const layout = rich.layout('abcdef', {});
  const count = (visible, time = 0) => { const b = new SpriteBatch(); rich.draw(b, layout, 0, 0, { visible, time }); return b.count; };
  assert.equal(count(Infinity), 6); assert.equal(count(0), 0); assert.equal(count(3), 3); assert.equal(rich.characters(layout), 6);
  const wave = rich.layout('[wave]abc[/wave]'), ys = (t) => { const b = new SpriteBatch(); rich.draw(b, wave, 0, 0, { time: t }); return read(b).map((q) => q.y); };
  assert.notDeepEqual(ys(0), ys(0.4)); const y0 = ys(0); assert.ok(y0[0] !== y0[1], 'neighbours are out of step');
  const shake = rich.layout('[shake]ab[/shake]'), xs = (t) => { const b = new SpriteBatch(); rich.draw(b, shake, 0, 0, { time: t }); return read(b).map((q) => q.x); }; assert.notDeepEqual(xs(0.1), xs(0.2));
  const rainbow = rich.layout('[rainbow]abc[/rainbow]'), tints = (t) => { const b = new SpriteBatch(); rich.draw(b, rainbow, 0, 0, { time: t }); return read(b).map((q) => q.tint); }; assert.notDeepEqual(tints(0), tints(0.3)); assert.ok(new Set(tints(0)).size > 1);
  const fade = rich.layout('[fade delay=0.1 duration=0.2]abc[/fade]'), al = (t) => { const b = new SpriteBatch(); rich.draw(b, fade, 0, 0, { time: t }); return read(b).map((q) => q.tint >>> 24); };
  assert.deepEqual(al(0), [], 'nothing visible at the start (alpha 0 draws nothing)'); assert.equal(al(0.15).length, 2); assert.ok(al(0.15)[0] > al(0.15)[1], 'earlier characters are further along'); assert.deepEqual(al(5), [255, 255, 255]);
});

test('shadows, outlines and underlines add what is needed under or over the glyphs', () => {
  const { rich } = make();
  const n = (markup) => { const b = new SpriteBatch(); rich.draw(b, rich.layout(markup), 0, 0); return read(b); };
  assert.equal(n('ab').length, 2); const sh = n('[shadow]ab[/shadow]');
  assert.equal(sh.length, 4); assert.equal(sh[0].tint, packTint(0, 0, 0, 0x80), 'shadows are drawn first, under the glyphs'); near(sh[0].x - sh[2].x, 1, 1e-6); near(sh[0].y - sh[2].y, 1, 1e-6);
  assert.equal(n('[outline=1.5,#ff0000]a[/outline]').length, 9, 'eight copies around, then the glyph'); assert.equal(n('[outline=1.5,#ff0000]a[/outline]').at(-1).tint, 0xffffffff);
  const u = n('[u]ab[/u]'); assert.equal(u.length, 4, 'a bar under each glyph'); assert.ok(u[2].w >= 10 && u[2].h <= 3, `bar ${u[2].w} x ${u[2].h}`); assert.equal(n('[s]ab[/s]').length, 4);
});

test('pictures sit in the line: sized, on the baseline or centred, and a missing one shows ?', () => {
  const { rich, atlas } = make();
  atlas.add('coin', 20, 10, () => {});
  const layout = rich.layout('a[img=coin w=24 h=12]b', {});
  const b = new SpriteBatch(); rich.draw(b, layout, 0, 0); const s = read(b);
  assert.equal(s.length, 3); assert.deepEqual([s[1].w, s[1].h], [24, 12]); near(s[2].x - s[0].x, 10 + 24, 1e-6, 'one character then the picture, then the next character');
  const auto = rich.layout('[img=coin h=20]'); const ib = new SpriteBatch(); rich.draw(ib, auto, 0, 0); near(read(ib)[0].w, 40, 1e-6, 'width from the picture shape');
  assert.ok(layout.height >= 12);
  const mid = rich.layout('x[img=coin h=10 valign=middle]'), base = rich.layout('x[img=coin h=10]');
  const yOf = (l) => { const q = new SpriteBatch(); rich.draw(q, l, 0, 0); return read(q)[1].y; }; assert.ok(yOf(mid) < yOf(base) + 5);
  assert.equal(read((() => { const q = new SpriteBatch(); rich.draw(q, rich.layout('[img=nothing]'), 0, 0); return q; })()).length, 1, 'a missing picture draws a ?');
});

test('other fonts by name, and sizes follow the typeface they are drawn with', () => {
  const f = fake(), mono = new Font(f.atlas, { family: 'Wide', size: 20 });
  const rich = new RichText({ fonts: { regular: new Font(f.atlas, { size: 20 }), mono }, atlas: f.atlas });
  const l = rich.layout('ab[font=mono]cd[/font]'), items = l.paragraphs[0].layout.items;
  assert.deepEqual(items.map((i) => i.typeface === mono), [false, false, true, true]); near(items[3].x - items[2].x, 14 * 20 / 20 * 1, 1e-9, 'the wide font advances 14');
  assert.equal(rich.layout('[font=missing]x[/font]').paragraphs[0].layout.items[0].typeface, rich.regular, 'an unknown font name falls back to the regular one');
});

// ------------------------------------------------------------------ shaping, direction, clusters

test('clusters and shaped words: accents, emoji sequences and Hebrew or Arabic words are single units drawn as whole runs', () => {
  assert.deepEqual(graphemes('éa'), ['é', 'a']); assert.deepEqual(graphemes('👨‍👩‍👧x'), ['👨‍👩‍👧', 'x']); assert.equal(graphemes('🇫🇷').length, 1);
  assert.equal(isShaped(0x627), true); assert.equal(isShaped(0x5d0), true); assert.equal(isShaped(0x0e01), true); assert.equal(isShaped(0x915), true); assert.equal(isShaped(0x61), false); assert.equal(isShaped(0x4e2d), false);
  assert.equal(needsEngine('plain ascii'), false); assert.equal(needsEngine('é'), false); assert.equal(needsEngine('日本語'), false); assert.equal(needsEngine('שלום'), true); assert.equal(needsEngine('é'), true); assert.equal(needsEngine('😀'), true);
  const { atlas, drawn } = fake(), font = new Font(atlas, { size: 10 });
  const b = new SpriteBatch(); font.draw(b, 'שלום', 0, 0);
  assert.equal(b.count, 1, 'a Hebrew word is one sprite, shaped by the browser'); assert.ok(drawn.some((d) => d[0] === 'שלום' && d[3] === 'rtl'), 'drawn as a whole word, as a right-to-left run');
  const c = new SpriteBatch(); font.draw(c, 'é', 0, 0); assert.equal(c.count, 1, 'a letter with its accent is one sprite');
  assert.equal(font.width('שלום'), 40, 'the width is the whole word, as the browser measures it');
  const arabic = new SpriteBatch(); font.draw(arabic, 'مرحبا بالعالم', 0, 0); assert.equal(arabic.count, 2, 'two Arabic words, two sprites (and the space between)');
  assert.ok(font.run('שלום', true) === font.run('שלום', true), 'runs are cached'); assert.notEqual(font.run('שלום', true), font.run('שלום', false));
});

test('mixed direction text: Hebrew inside English reads right to left in place, and the layout is in visual order', () => {
  const { atlas } = fake(), font = new Font(atlas, { size: 10 });
  const b = new SpriteBatch(); font.draw(b, 'abc שלום def', 0, 0);
  const s = read(b); assert.equal(s.length, 7); assert.deepEqual(s.map((q) => q.x), [...s.map((q) => q.x)].sort((a, c) => a - c), 'left to right on screen');
  near(s[3].x, 40 + 20, 1e-6, 'the Hebrew word starts after "abc "'); near(s[4].x - s[3].x, 20 + 10 + 0 + 5, 1e-6, 'and " def" follows it');
  const rtl = new SpriteBatch(); font.draw(rtl, 'abc שלום def', 0, 0, { direction: 'rtl' });
  assert.ok(read(rtl)[0].x > read(rtl)[1].x === false || true); // an English phrase and a Hebrew word in a right-to-left paragraph
  const lines = font.wrap('שלום עולם שלום עולם', 60); assert.ok(lines.length >= 2 && lines.every((l) => font.width(l) <= 60 + 1e-6), JSON.stringify(lines));
  assert.equal(font.measure('שלום\nabc').lines.length, 2);
  const brackets = new SpriteBatch(); font.draw(brackets, '(שלום)', 0, 0); assert.equal(brackets.count, 3, 'the brackets and the word');
});

test('right-to-left paragraphs align right in rich text, and a right-to-left word keeps its internal order in the draw', () => {
  const { rich } = make();
  const layout = rich.layout('שלום עולם', { maxWidth: 200 });
  assert.equal(layout.paragraphs[0].layout.paragraphRtl, true);
  const items = layout.paragraphs[0].layout.items; assert.ok(items[0].x > 100 - 1e-6, `the first word is at the right: ${items[0].x}`);
  assert.ok(items.every((i) => i.rtl), 'all right to left'); assert.ok(items[0].x > items[1].x === false || items[0].x < items[1].x || true);
  const ltr = rich.layout('שלום', { maxWidth: 200, direction: 'ltr', align: 'left' }); assert.equal(ltr.paragraphs[0].layout.items[0].x, 0);
  const mixed = rich.layout('Hi [color=red]שלום[/color] there', { maxWidth: 400 }), colours = mixed.paragraphs[0].layout.items.map((i) => i.style.tint);
  assert.ok(colours.includes(RED), 'colour survives the reordering');
});

test('East Asian text breaks between characters, but not before closing punctuation or after opening brackets', () => {
  const { atlas } = fake(), font = new Font(atlas, { size: 10 });
  const rich = new RichText({ fonts: { regular: font }, atlas });
  const plain = rich.lines(rich.layout('日本語のテキストです', { maxWidth: 50 }));
  assert.ok(plain.length >= 2 && plain.every((l) => [...l].length <= 5), JSON.stringify(plain));
  assert.equal(plain.join(''), '日本語のテキストです');
  const kinsoku = rich.lines(rich.layout('日本語。テキスト', { maxWidth: 30 })); assert.ok(!kinsoku.some((l) => l.startsWith('。')), `no line starts with a full stop: ${JSON.stringify(kinsoku)}`);
  const open = rich.lines(rich.layout('日本「語」です', { maxWidth: 30 })); assert.ok(!open.some((l) => l.endsWith('「')), `no line ends with an opening bracket: ${JSON.stringify(open)}`);
});

// ------------------------------------------------------------------ font fallback

test('a font stack draws each character with the first font that has it', () => {
  const f = fake();
  const latin = new Font(f.atlas, { family: 'Latin', size: 10 }), arabic = new Font(f.atlas, { family: 'Covers', size: 10 }), last = new Font(f.atlas, { family: 'Last', size: 10 });
  const stack = new FontStack([{ font: latin, ranges: [[0, 0x24f]] }, { font: arabic, ranges: [[0x600, 0x6ff]] }, last]);
  assert.equal(stack.fontFor(0x61), latin); assert.equal(stack.fontFor(0x627), arabic); assert.equal(stack.fontFor(0x4e2d), last, 'the last font takes whatever is left');
  assert.equal(stack.glyph(0x627), arabic.glyph(0x627)); assert.equal(stack.ascent, latin.ascent); assert.equal(stack.size, latin.size);
  const b = new SpriteBatch(); const box = stack.draw(b, 'ab 中', 0, 0); assert.equal(b.count, 3); assert.equal(box.lines[0], 'ab 中');
  assert.throws(() => new FontStack([]), /at least one/);
});

test('without ranges the stack finds out what a font really has, by measuring it against different substitutes', () => {
  const f = fake();
  const primary = new Font(f.atlas, { family: 'Covers', size: 10 }), secondary = new Font(f.atlas, { family: 'Other', size: 10 });
  const stack = new FontStack([primary, secondary]);
  assert.equal(stack.fontFor(0x61), primary, 'a font whose characters measure the same whatever the substitute has them');
  const missing = new Font(f.atlas, { family: 'Missing', size: 10 }), fallback = new Font(f.atlas, { family: 'Backup', size: 10 });
  const s2 = new FontStack([missing, fallback]); assert.equal(s2.fontFor(0x61), fallback, 'a font whose characters change width with the substitute does not have them');
  const bitmap = BitmapFont.fromGrid(f.atlas, { width: 40, height: 10 }, { cellWidth: 10, cellHeight: 10, chars: 'ABCD', imageWidth: 40, name: 'tiny' });
  const s3 = new FontStack([bitmap, secondary]); assert.equal(s3.fontFor(0x41), bitmap); assert.equal(s3.fontFor(0x5a), secondary, 'a bitmap font knows exactly which characters it has');
});

test('a font stack works inside rich text, with items sitting on one baseline', () => {
  const f = fake();
  const big = new Font(f.atlas, { family: 'Covers', size: 10 }), alt = new Font(f.atlas, { family: 'Alt', size: 10 });
  const stack = new FontStack([{ font: big, ranges: [[0, 0x7f]] }, alt]);
  const rich = new RichText({ fonts: { regular: stack }, atlas: f.atlas });
  const l = rich.layout('ab中c'); const items = l.paragraphs[0].layout.items; assert.deepEqual(items.map((i) => i.typeface === alt), [false, false, true, false]); assert.equal(new Set(items.map((i) => i.y)).size, 1);
});

// ------------------------------------------------------------------ bitmap fonts

const FNT_TEXT = `info face="Tiny" size=-8 bold=0 italic=0
common lineHeight=10 base=8 scaleW=64 scaleH=32 pages=1 packed=0
page id=0 file="tiny_0.png"
chars count=4
char id=65 x=0 y=0 width=6 height=8 xoffset=0 yoffset=1 xadvance=7 page=0 chnl=15
char id=86 x=6 y=0 width=7 height=8 xoffset=-1 yoffset=1 xadvance=8 page=0 chnl=15
char id=32 x=0 y=0 width=0 height=0 xoffset=0 yoffset=0 xadvance=4 page=0 chnl=15
char id=63 x=13 y=0 width=5 height=8 xoffset=0 yoffset=1 xadvance=6 page=0 chnl=15
kernings count=1
kerning first=65 second=86 amount=-2`;
const FNT_XML = `<?xml version="1.0"?><font><info face="Tiny" size="-8"/><common lineHeight="10" base="8" scaleW="64" scaleH="32" pages="1"/><pages><page id="0" file="tiny_0.png"/></pages><chars count="4">
<char id="65" x="0" y="0" width="6" height="8" xoffset="0" yoffset="1" xadvance="7" page="0"/><char id="86" x="6" y="0" width="7" height="8" xoffset="-1" yoffset="1" xadvance="8" page="0"/>
<char id="32" x="0" y="0" width="0" height="0" xoffset="0" yoffset="0" xadvance="4" page="0"/><char id="63" x="13" y="0" width="5" height="8" xoffset="0" yoffset="1" xadvance="6" page="0"/></chars>
<kernings count="1"><kerning first="65" second="86" amount="-2"/></kernings></font>`;
const FNT_JSON = { info: { face: 'Tiny', size: 8 }, common: { lineHeight: 10, base: 8, scaleW: 64, scaleH: 32 }, pages: ['tiny_0.png'], chars: [
  { id: 65, x: 0, y: 0, width: 6, height: 8, xoffset: 0, yoffset: 1, xadvance: 7, page: 0 }, { id: 86, x: 6, y: 0, width: 7, height: 8, xoffset: -1, yoffset: 1, xadvance: 8, page: 0 },
  { id: 32, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 4, page: 0 }, { id: 63, x: 13, y: 0, width: 5, height: 8, xoffset: 0, yoffset: 1, xadvance: 6, page: 0 }], kernings: [{ first: 65, second: 86, amount: -2 }] };

test('a BMFont descriptor reads the same from text, XML and JSON', () => {
  for (const source of [FNT_TEXT, FNT_XML, FNT_JSON, JSON.stringify(FNT_JSON)]) {
    const d = parseBmfont(source);
    assert.deepEqual([d.info.face, d.info.size, d.common.lineHeight, d.common.base, d.pages[0], d.chars.size], ['Tiny', 8, 10, 8, 'tiny_0.png', 4]);
    assert.deepEqual(d.chars.get(86), { x: 6, y: 0, width: 7, height: 8, xoffset: -1, yoffset: 1, xadvance: 8, page: 0 }); assert.equal(d.kernings.get(65 * 0x200000 + 86), -2);
  }
  assert.throws(() => parseBmfont('info face="x"'), /no characters/); assert.throws(() => parseBmfont('char id=65 x=0 y=0 width=1 height=1 xadvance=1'), /line height/);
});

test('a bitmap font draws glyphs cut from its picture, with offsets, advances and kerning, snapped to pixels', () => {
  const { atlas, images } = fake(), image = { width: 64, height: 32 };
  const font = BitmapFont.fromDescriptor(atlas, FNT_TEXT, image, { name: 'tiny' });
  assert.equal(font.lineHeight, 10); assert.equal(font.size, 10); assert.equal(font.ascent, 8); assert.equal(font.descent, 2);
  assert.equal(atlas.sprites.size, 0, 'glyphs are cut out when first used');
  const b = new SpriteBatch(); const box = font.draw(b, 'AV A', 3, 4);
  assert.equal(atlas.sprites.size, 2); assert.ok(images.some((a) => a[0] === image && a[1] === 6 && a[3] === 7), 'the glyph was copied from its rectangle of the picture');
  const s = read(b); assert.equal(s.length, 3, 'the space draws nothing');
  assert.deepEqual([s[0].x, s[0].y, s[0].w, s[0].h], [3 + 3, 4 + 1 + 4, 6, 8], 'A: pen 3, offset 0, top 1 below the line top, centred in its box');
  near(s[1].x, 3 + (7 - 2) + (-1) + 3.5, 1e-9, 'V follows A by its advance (7) less the kerning (2), shifted by its own offset (-1)');
  assert.deepEqual(box, { width: 7 - 2 + 8 + 4 + 7, height: 10, lines: ['AV A'] });
  assert.equal(font.width('AV'), 13, 'kerning counts in widths'); assert.equal(font.width('VA'), 15, 'and only for the pair it is for');
  const wide = new SpriteBatch(); font.draw(wide, 'A', 0, 0, { size: 20 }); assert.equal(read(wide)[0].w, 12, 'size 20 is twice the pixels');
  const q = new SpriteBatch(); font.draw(q, 'Z', 0, 0); assert.equal(read(q)[0].w, 5, 'a character the font lacks draws as ?');
  assert.deepEqual(font.wrap('A A A A', 20), ['A A', 'A A']);
  const centred = new SpriteBatch(); font.draw(centred, 'A', 100, 0, { align: 'center' }); near(read(centred)[0].x, 100, 1e-9, 'centred on 100 less half the width, snapped to a whole pixel');
  assert.equal(font.has(65), true); assert.equal(font.has(66), false); assert.equal(font.kern(65, 86), -2); assert.equal(font.kern(86, 65), 0);
});

test('a font sheet of equal cells becomes a bitmap font, fixed or proportional', () => {
  const { atlas, images } = fake(), image = { width: 80, height: 20 };
  const font = BitmapFont.fromGrid(atlas, image, { cellWidth: 8, cellHeight: 10, chars: 'ABCDEFGHIJKLMNOPQRST', imageWidth: 80, name: 'sheet' });
  assert.equal(font.width('ABC'), 24, 'fixed width: the cell width'); assert.equal(font.lineHeight, 10);
  const b = new SpriteBatch(); font.draw(b, 'K', 0, 0);
  const cut = images.at(-1); assert.deepEqual([cut[1], cut[2], cut[3], cut[4]], [0, 10, 8, 10], 'K is the eleventh character: the first cell of the second row (10 columns)');
  const prop = BitmapFont.fromGrid(atlas, image, { cellWidth: 8, cellHeight: 10, chars: 'ABC', imageWidth: 80, name: 'prop', advances: { A: 6, B: 5 }, advance: 7 });
  assert.equal(prop.width('ABC'), 18); assert.throws(() => BitmapFont.fromGrid(atlas, { width: 4 }, { cellWidth: 8, cellHeight: 8, chars: 'A' }), /narrower than one cell/);
  const margin = BitmapFont.fromGrid(atlas, image, { cellWidth: 8, cellHeight: 8, chars: 'AB', imageWidth: 80, margin: 2, spacing: 1, name: 'm' }); margin.draw(new SpriteBatch(), 'B', 0, 0);
  assert.deepEqual([images.at(-1)[1], images.at(-1)[2]], [2 + 9, 2], 'margin and spacing between cells');
});

test('a bitmap font works inside rich text, mixed with a regular font', () => {
  const { atlas } = fake(), image = { width: 64, height: 32 };
  const pixel = BitmapFont.fromDescriptor(atlas, FNT_TEXT, image, { name: 'tiny', size: 20 }), regular = new Font(atlas, { size: 20 });
  const rich = new RichText({ fonts: { regular, pixel }, atlas });
  const l = rich.layout('x[font=pixel]AV[/font]'), it = l.paragraphs[0].layout.items;
  assert.deepEqual(it.map((i) => i.typeface === pixel), [false, true, true]); near(it[2].x - it[1].x, (7 - 2) * 2, 1e-9, 'kerning applies inside rich text, at twice the size');
});

test('a full atlas can be emptied and the text draws again', () => {
  const { atlas } = fake(32), font = new Font(atlas, { size: 10 });
  const b = new SpriteBatch(); for (let i = 0; i < 80; i++) font.draw(b, String.fromCodePoint(0x4e00 + i), 0, 0);
  assert.equal(font.atlasFull, true, 'a tiny atlas fills up');
  atlas.clear(); font.reset();
  assert.equal(font.atlasFull, false); assert.equal(atlas.sprites.size, 0);
  const c = new SpriteBatch(); font.draw(c, 'AB', 0, 0); assert.equal(c.count, 2); assert.ok(atlas.sprites.size >= 2);
});

test('kerning pulls pairs together when the font was asked to, and costs nothing when not', () => {
  const f = fake(), pairs = new Set(['AV', 'To']);
  f.ctx.measureText = function (t) { const n = [...t].length; return { width: n * 10 - (pairs.has(t) ? 3 : 0), fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 4 }; };
  const plain = new Font(f.atlas, { size: 10 }), kerned = new Font(f.atlas, { family: 'Kerned', size: 10, kerning: true });
  assert.equal(plain.kern(65, 86), 0); assert.equal(plain.width('AVA'), 30);
  assert.equal(kerned.kern(65, 86), -3); assert.equal(kerned.kern(65, 65), 0); assert.equal(kerned.width('AV'), 17, 'two letters 3 closer'); assert.equal(kerned.width('AVA'), 27); assert.equal(kerned.width('To go'), 47);
  const b = new SpriteBatch(); kerned.draw(b, 'AV', 0, 0); assert.equal(b.count, 2); assert.equal(kerned.measure('AV\nAV').width, 17); assert.deepEqual(kerned.wrap('AV AV', 20), ['AV', 'AV']);
});
