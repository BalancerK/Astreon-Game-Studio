import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSky, sunDirection, sunColor, skyRadiance, skyColor, skyLighting, proceduralSkyEnvironment, writeSkyBlock, SKY_BLOCK_AT, SKY_BLOCK_VEC4S } from '../src/index.js';
import { ENV_BLOCK_AT, ENV_BLOCK_VEC4S } from '../src/environment.js';
import { skyWgsl, skyGlsl } from '../src/sky-shaders.js';

const near = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const lum = (c) => (c[0] + c[1] + c[2]) / 3;

test('the sun: noon is due south and high at 45 degrees north on the equinox, and the day turns about', () => {
  const noon = sunDirection({ hour: 12, latitude: 45, dayOfYear: 80 });
  near(Math.hypot(...noon), 1, 1e-9); near(noon[1], Math.sin(45 * Math.PI / 180), 0.02, 'about 45 degrees up'); assert.ok(noon[2] > 0.6 && Math.abs(noon[0]) < 0.02, `south is +z: ${noon}`);
  const morning = sunDirection({ hour: 8, latitude: 45, dayOfYear: 80 }), evening = sunDirection({ hour: 16, latitude: 45, dayOfYear: 80 });
  assert.ok(morning[0] > 0.3 && evening[0] < -0.3, 'rises in the east (+x), sets in the west'); near(morning[1], evening[1], 0.02, 'symmetric about noon');
  assert.ok(sunDirection({ hour: 0, latitude: 45 })[1] < -0.5, 'below the horizon at midnight');
  assert.ok(sunDirection({ hour: 12, latitude: 45, dayOfYear: 172 })[1] > sunDirection({ hour: 12, latitude: 45, dayOfYear: 355 })[1] + 0.3, 'higher in summer than winter');
  assert.ok(sunDirection({ hour: 12, latitude: 0, dayOfYear: 80 })[1] > 0.98, 'overhead at the equator on the equinox'); assert.ok(sunDirection({ hour: 0, latitude: 80, dayOfYear: 172 })[1] > 0, 'the midnight sun');
});

test('creating a sky fills in sensible defaults and checks nothing it should not', () => {
  const s = createSky();
  near(Math.hypot(...s.sun), 1, 1e-9); assert.equal(s.clouds, null); assert.equal(s.stars, null); assert.equal(s.moon, null); assert.equal(s.turbidity, 3); assert.equal(s.exposure, 1.5);
  const c = createSky({ sun: [0, 5, 0], clouds: true, stars: { brightness: 2 }, moon: true, turbidity: 99 });
  assert.deepEqual(c.sun, [0, 1, 0]); assert.equal(c.clouds.coverage, 0.4); assert.equal(c.stars.brightness, 2); near(Math.hypot(...c.moon.direction), 1, 1e-9); assert.equal(c.turbidity, 20, 'clamped');
});

test('the sunlight that reaches the ground is white overhead, orange low down, and nothing at night', () => {
  const at = (y) => sunColor(createSky({ sun: [Math.sqrt(1 - y * y), y, 0] }));
  const high = at(1), mid = at(0.3), low = at(0.04), night = at(-0.2);
  assert.ok(high.every((v) => v > 0.75) && Math.max(...high) - Math.min(...high) < 0.3, `${high}`); assert.ok(low[0] > low[1] && low[1] > low[2], `${low}`); assert.ok(low[2] < high[2] * 0.6, 'blue is scattered away on the way through a long path');
  assert.ok(mid[2] < high[2] && mid[2] > low[2]); assert.deepEqual(night, [0, 0, 0]);
  const hazy = sunColor(createSky({ sun: [0, 1, 0], turbidity: 10 })); assert.ok(hazy[0] < high[0], 'haze takes light out of the sunbeam');
});

test('the sky is blue overhead and pale at the horizon, darkens as the sun sets, and brightens around the sun', () => {
  const sky = createSky({ sun: sunDirection({ hour: 12, latitude: 45 }) });
  const up = skyRadiance([0, 1, 0], sky), low = skyRadiance([1, 0.02, 0], sky);
  assert.ok(up[2] > up[1] && up[1] > up[0], `blue overhead: ${up}`); assert.ok(lum(low) > lum(up), 'brighter and paler near the horizon'); assert.ok(low[0] / low[2] > up[0] / up[2], 'less blue');
  const s = sky.sun, aside = skyRadiance([s[2], 0.5, -s[0]].map((v, i, a) => v / Math.hypot(...a)), sky), near_ = skyRadiance(s.map((v, i) => (i === 1 ? v + 0.03 : v)), sky, [0, 0, 0], { disc: false });
  assert.ok(lum(near_) > lum(aside), 'the glow round the sun');
  const disc = skyRadiance(s, sky), noDisc = skyRadiance(s, sky, [0, 0, 0], { disc: false }); assert.ok(lum(disc) > lum(noDisc) + 20, 'the sun itself is much brighter than the sky');
  const dusk = createSky({ sun: [Math.sqrt(1 - 0.0016), 0.04, 0] }), duskUp = skyRadiance([0, 1, 0], dusk); assert.ok(lum(duskUp) < lum(up), 'dimmer overhead at sunset');
  const east = skyRadiance([1, 0.05, 0], dusk), west = skyRadiance([-1, 0.05, 0], dusk); assert.ok(lum(east) > lum(west) && east[0] > east[2] * 0.5, 'warm toward the sun');
  const night = createSky({ sun: [0, -1, 0] }); assert.ok(lum(skyRadiance([0, 1, 0], night)) < 0.02, 'dark at night');
  const hazy = createSky({ sun: sky.sun, turbidity: 10 }); assert.ok(lum(skyRadiance(s.map((v, i) => (i === 1 ? v + 0.1 : v)), hazy, [0, 0, 0], { disc: false })) > lum(skyRadiance(s.map((v, i) => (i === 1 ? v + 0.1 : v)), sky, [0, 0, 0], { disc: false })), 'haze brightens the sky round the sun');
});

test('below the horizon is ground; it fades in smoothly and takes the ground colour', () => {
  const sky = createSky({ sun: sunDirection({ hour: 12, latitude: 45 }), ground: [0.5, 0.2, 0.1] });
  const down = skyRadiance([0, -1, 0], sky), here = skyRadiance([1, 0, 0.0001], sky), above = skyRadiance([1, 0.001, 0], sky);
  assert.ok(down[0] > down[2], 'reddish brown'); near(here[0], above[0], 0.05 * above[0] + 0.01, 'continuous across the horizon');
  const ten = [0.5, -0.3, 0.8], a = skyRadiance(ten, sky), b = skyRadiance([0.5, -0.31, 0.8], sky); near(a[0], b[0], 0.02);
  for (const v of [skyColor([0.3, -0.4, 0.2], sky), skyColor([0, 1, 0], sky), skyColor(sky.sun, sky)]) assert.ok(v.every((x) => x >= 0 && x <= 1), 'tone mapped to 0..1');
});

test('exposure scales the picture; clouds, stars and the moon appear only where and when they should', () => {
  const dir = [0.3, 0.5, 0.4].map((v, _, a) => v / Math.hypot(...a));
  const base = createSky({ sun: sunDirection({ hour: 12, latitude: 45 }) });
  assert.ok(lum(skyColor(dir, createSky({ ...base, sun: base.sun, exposure: 3 }))) > lum(skyColor(dir, base)));
  const cloudy = createSky({ sun: base.sun, clouds: { coverage: 1, density: 1, scale: 2 } });
  let changed = 0; for (let i = 0; i < 60; i++) { const d = [Math.cos(i), 0.6, Math.sin(i)].map((v, _, a) => v / Math.hypot(...a)); if (Math.abs(lum(skyRadiance(d, cloudy)) - lum(skyRadiance(d, base))) > 0.01) changed++; }
  assert.ok(changed > 40, `full cover changes most directions (${changed})`);
  assert.deepEqual(skyRadiance(dir, cloudy, [0, 0, 0], { details: false }).map((v) => +v.toFixed(9)), skyRadiance(dir, base, [0, 0, 0], { details: false }).map((v) => +v.toFixed(9)), 'details: false leaves the clouds out');
  const c1 = createSky({ sun: base.sun, clouds: { coverage: 0.5 }, time: 0 }), c2 = createSky({ sun: base.sun, clouds: { coverage: 0.5 }, time: 500 });
  let moved = 0; for (let i = 0; i < 60; i++) { const d = [Math.cos(i), 0.6, Math.sin(i)].map((v, _, a) => v / Math.hypot(...a)); if (Math.abs(lum(skyRadiance(d, c1)) - lum(skyRadiance(d, c2))) > 0.01) moved++; } assert.ok(moved > 5, 'clouds drift with time');
  const horizon = createSky({ sun: base.sun, clouds: { coverage: 1 } }); const h = [1, 0.001, 0]; skyRadiance(h, horizon).forEach((v, k) => near(v, skyRadiance(h, base)[k], 1e-3, 'no clouds right at the horizon'));
  const night = createSky({ sun: [0, -1, 0], stars: { brightness: 2 } }), nostars = createSky({ sun: [0, -1, 0] });
  let stars = 0; for (let i = 0; i < 4000; i++) { const t = i * 0.37, d = [Math.cos(t) * 0.5, 0.8, Math.sin(t) * 0.6].map((v, _, a) => v / Math.hypot(...a)); if (lum(skyRadiance(d, night)) > lum(skyRadiance(d, nostars)) + 0.05) stars++; } assert.ok(stars > 0 && stars < 400, `some stars and mostly dark: ${stars}`);
  const day = createSky({ sun: base.sun, stars: true }); assert.deepEqual(skyRadiance(dir, day).map((v) => +v.toFixed(9)), skyRadiance(dir, base).map((v) => +v.toFixed(9)), 'no stars by day');
  const moon = createSky({ sun: [0, -1, 0], moon: { direction: [0, 1, 0], brightness: 1 } }); assert.ok(lum(skyRadiance([0, 1, 0], moon)) > 0.5 && lum(skyRadiance([1, 0.2, 0], moon)) < 0.1, 'a bright disc where the moon is');
});

test('the lighting that goes with a sky follows the time of day', () => {
  const at = (hour, o = {}) => skyLighting(createSky({ sun: sunDirection({ hour, latitude: 45, dayOfYear: 172 }), ...o }));
  const noon = at(13), dusk = at(19.3), night = at(2, { moon: { direction: [0.3, 0.7, -0.5] } });
  for (const l of [noon, dusk, night]) { near(Math.hypot(...l.direction), 1, 1e-9); assert.ok(l.color.every((v) => v >= 0) && l.ambientSky.length === 3 && l.ambientGround.length === 3 && l.fogColor.length === 3); }
  assert.ok(lum(noon.color) > 0.7 && noon.direction[1] > 0.6); assert.ok(dusk.color[0] > dusk.color[2] * 1.5 || lum(dusk.color) < 0.3, 'warm or weak at dusk'); assert.ok(lum(night.color) < 0.2 && night.color[2] > night.color[0], 'dim blue moonlight'); assert.equal(night.direction[1] > 0, true, 'from the moon');
  assert.ok(lum(noon.ambientSky) > lum(night.ambientSky) * 3); const nomoon = at(2); assert.ok(lum(nomoon.color) < 1e-6 + 0.02);
});

test('baking a sky for lighting gives an environment with the sky above and the ground below, no sun disc, and a reasonable build time', () => {
  const sky = createSky({ sun: sunDirection({ hour: 12, latitude: 45 }) });
  const t0 = performance.now(); const env = proceduralSkyEnvironment(sky, 16); const ms = performance.now() - t0;
  assert.equal(env.size, 16); assert.ok(env.levels.length >= 2 && env.sh.length >= 27); assert.ok(ms < 2000, `${ms} ms`);
  const top = env.levels[0].faces[2], bottom = env.levels[0].faces[3], avg = (f) => f.reduce((s, v) => s + v, 0) / f.length;
  assert.ok(avg(top) > avg(bottom), 'brighter overhead than below'); assert.ok(Math.max(...top) < 5, 'no sun disc in it');
});

test('the numbers the shaders read: a block of eight vec4s that follows the layout', () => {
  assert.equal(SKY_BLOCK_AT, ENV_BLOCK_AT + 16); assert.equal(SKY_BLOCK_VEC4S, 8); assert.ok(ENV_BLOCK_VEC4S >= 16 + SKY_BLOCK_VEC4S);
  const sky = createSky({ sun: [0, 1, 0], sunIntensity: 30, sunSize: 0.02, turbidity: 6, rayleigh: 1.2, mieG: 0.7, exposure: 2, ground: [0.1, 0.2, 0.3], clouds: { coverage: 0.3, density: 0.8, scale: 2, brightness: 1.1, wind: [0.01, 0.02] }, stars: { brightness: 1.5 }, moon: { direction: [0, 0, 1], size: 0.02, brightness: 0.7 }, time: 10 });
  const t = new Float32Array(SKY_BLOCK_VEC4S * 4 + 4); writeSkyBlock(t, 0, sky);
  const v = (n) => Array.from(t.slice(n * 4, n * 4 + 4)).map((x) => +x.toFixed(4));
  assert.deepEqual(v(0), [0, 1, 0, 30]); assert.deepEqual(v(1), [2, 1.2, 0.7, 2]); assert.deepEqual(v(2), [0.1, 0.2, 0.3, +Math.cos(0.02).toFixed(4)]); assert.deepEqual(v(3), [0.3, 0.8, 2, 1.1]);
  assert.deepEqual(v(4), [0.1, 0.2, 1.5, 10]); assert.deepEqual(v(5), [0, 0, 1, 0.7]); assert.deepEqual(v(6).slice(2), [0.02, 1]); assert.equal(v(7)[3], 1); assert.ok(v(7)[0] > 0.7, 'the sun colour is in it');
  const plain = new Float32Array(SKY_BLOCK_VEC4S * 4); plain.fill(7); writeSkyBlock(plain, 0, createSky()); assert.equal(plain[12], 0, 'no clouds, no numbers'); assert.equal(plain[27], 0); assert.equal(plain[31], 0);
});

test('the shader sources mention every piece of the model, in both languages', () => {
  const w = skyWgsl((n) => `S[${n}]`), g = skyGlsl((n) => `S[${n}]`);
  for (const src of [w, g]) for (const word of ['skyRadiance', 'skyColor', 'skyHash', 'skyCloudNoise', 'S[7].xyz', 'S[6].w', 'S[4].z']) assert.ok(src.includes(word), word);
  assert.ok(w.includes('fn skyRadiance') && g.includes('vec3 skyRadiance')); assert.ok(!/\$\{/.test(w) && !/\$\{/.test(g), 'no placeholders left');
});
