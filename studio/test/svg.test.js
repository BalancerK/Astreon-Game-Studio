import { test } from 'node:test';
import assert from 'node:assert/strict';
import { svgProblem, svgSize, rasterSize, svgStem } from '../app/store/svg.js';

const OK = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32" viewBox="0 0 64 32"><rect width="64" height="32" fill="#4ade80"/><circle cx="16" cy="16" r="8"/></svg>';

test('a real SVG is accepted, with or without an XML header, a doctype, comments or a byte-order mark', () => {
  assert.equal(svgProblem(OK), null);
  const doctype = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">';
  assert.equal(svgProblem(`<?xml version="1.0" encoding="UTF-8"?>\n<!-- made by hand -->\n${doctype}\n${OK}`), null);
  assert.equal(svgProblem(`\uFEFF${OK}`), null);
  assert.equal(svgProblem('<svg viewBox="0 0 1 1"><path id="a" d="M0 0"/><use href="#a"/></svg>'), null, 'a link to a part of the same picture is fine');
  assert.equal(svgProblem('<svg viewBox="0 0 1 1"><image href="data:image/png;base64,AAAA"/></svg>'), null);
});

test('anything that is not an SVG, or that can run or fetch, is refused with the reason', () => {
  assert.match(svgProblem('hello'), /not an SVG/);
  assert.match(svgProblem('<html><svg></svg></html>'), /not an SVG/);
  assert.match(svgProblem(42), /not an SVG/);
  const bad = {
    '<svg><script>alert(1)</script></svg>': 'script', '<svg><SCRIPT src="x.js"/></svg>': 'script', '<svg onload="x()"></svg>': 'event handler',
    '<svg><rect onclick = "x()"/></svg>': 'event handler', '<svg><foreignObject><div/></foreignObject></svg>': 'foreignObject',
    '<svg><iframe src="x"/></svg>': 'embeds', '<svg><a href="javascript:alert(1)"/></svg>': 'javascript',
    '<svg><image href="https://example.com/a.png"/></svg>': 'another file', '<svg><image xlink:href="a.png"/></svg>': 'another file',
    '<svg><style>@import "x.css";</style></svg>': 'outside', '<svg><rect style="fill:url(https://x/y)"/></svg>': 'outside',
    '<!DOCTYPE svg [<!ENTITY a "b">]><svg>&a;</svg>': 'entities',
  };
  for (const [text, word] of Object.entries(bad)) assert.match(svgProblem(text) ?? 'accepted', new RegExp(word), text);
  assert.match(svgProblem(`<svg>${'x'.repeat(1_100_000)}</svg>`), /bigger/);
});

test('the size an SVG says it is: width and height, else the viewBox, else nothing', () => {
  assert.deepEqual(svgSize(OK), { w: 64, h: 32 });
  assert.deepEqual(svgSize('<svg width="10px" height="20" viewBox="0 0 1 1"/>'), { w: 10, h: 20 });
  assert.deepEqual(svgSize('<svg viewBox="0 0 100 50"/>'), { w: 100, h: 50 });
  assert.deepEqual(svgSize('<svg viewBox="0, 0, 100, 50" width="200"/>'), { w: 200, h: 100 });
  assert.deepEqual(svgSize('<svg viewBox="0 0 100 50" height="25"/>'), { w: 50, h: 25 });
  assert.equal(svgSize('<svg width="50%" height="50%"/>'), null);
  assert.equal(svgSize('<svg/>'), null);
});

test('the PNG made from it: scaled, or a chosen width, never huge, never empty', () => {
  assert.deepEqual(rasterSize({ w: 64, h: 32 }), { w: 64, h: 32 });
  assert.deepEqual(rasterSize({ w: 64, h: 32 }, { scale: 4 }), { w: 256, h: 128 });
  assert.deepEqual(rasterSize({ w: 64, h: 32 }, { width: 96 }), { w: 96, h: 48 });
  assert.deepEqual(rasterSize({ w: 600, h: 300 }, { scale: 4 }), { w: 1024, h: 512 });
  assert.deepEqual(rasterSize({ w: 100, h: 5000 }), { w: 20, h: 1024 });
  assert.deepEqual(rasterSize(null), { w: 64, h: 64 });
  assert.deepEqual(rasterSize({ w: 1, h: 1 }, { scale: 0.001 }), { w: 1, h: 1 });
});

test('names for the pieces: the stem of the file name, made plain', () => {
  assert.equal(svgStem('C:\\art\\My Frog!.svg'), 'My Frog');
  assert.equal(svgStem('hero.SVG'), 'hero');
  assert.equal(svgStem('...svg'), 'drawing');
  assert.equal(svgStem('é.svg'), 'e');
});
