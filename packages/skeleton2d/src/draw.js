import { packTint, MESH_VERTEX_WORDS, META_ADDITIVE } from '../../render/src/index.js';
import { attachmentWorldVertices } from './geometry.js';

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
const QUAD = Uint16Array.of(0, 1, 2, 0, 2, 3);
let scratch = new Float32Array(256);
const sprites = new WeakMap();

/** The atlas sprite an attachment shows (found once per atlas). */
function spriteOf(att, atlas) {
  let m = sprites.get(att);
  if (!m) sprites.set(att, m = new WeakMap());
  let s = m.get(atlas);
  if (!s) {
    s = atlas.sprites.get(att.path);
    if (!s) throw new Error(`the atlas has no sprite "${att.path}" (attachment "${att.name}")`);
    m.set(atlas, s);
  }
  return s;
}

/**
 * Put what a skeleton shows into a mesh batch, back to front, ready for `renderer.render({ camera, batch, meshes })`. Regions become two triangles, meshes keep their own triangles, bounding
 * boxes are skipped. The colour of a point is the skeleton's colour times the slot's times the attachment's times `tint`; slots set to `additive` add their light instead of covering.
 * @param {import('./skeleton.js').Skeleton} skeleton Its world transforms must be up to date (`updateWorldTransform()`).
 * @param {import('../../render/src/meshbatch.js').MeshBatch2D} meshes
 * @param {import('../../render/src/atlas.js').Atlas} atlas Where the attachments' sprites live.
 * @param {{tint?: number[]}} [o] `tint`: an extra [r, g, b, a] in 0..1.
 * @returns {number} How many triangles were added.
 */
export function drawSkeleton(skeleton, meshes, atlas, { tint = [1, 1, 1, 1] } = {}) {
  let triangles = 0;
  const sc = skeleton.color;
  for (const slot of skeleton.drawOrder) {
    const att = skeleton.attachmentOf(slot);
    if (!att || att.type === 'boundingbox') continue;
    const a = sc[3] * slot.color[3] * att.color[3] * tint[3];
    if (a <= 0) continue;
    const colour = packTint(clamp255(sc[0] * slot.color[0] * att.color[0] * tint[0]), clamp255(sc[1] * slot.color[1] * att.color[1] * tint[1]), clamp255(sc[2] * slot.color[2] * att.color[2] * tint[2]), clamp255(a));
    const sprite = spriteOf(att, atlas), meta = (sprite.page | 0) | (slot.data.blend === 'additive' ? META_ADDITIVE : 0);
    const isRegion = att.type === 'region', n = isRegion ? 4 : att.vertexCount, tris = isRegion ? QUAD : att.triangles;
    if (n * 2 > scratch.length) scratch = new Float32Array(n * 2);
    attachmentWorldVertices(skeleton, slot, att, scratch, 0, { width: sprite.w, height: sprite.h });
    const base = meshes.begin(n, tris.length), f = meshes.f32, u = meshes.u32, du = sprite.u1 - sprite.u0, dv = sprite.v1 - sprite.v0;
    for (let i = 0; i < n; i++) {
      const o = (base + i) * MESH_VERTEX_WORDS;
      f[o] = scratch[i * 2]; f[o + 1] = scratch[i * 2 + 1];
      if (isRegion) { f[o + 2] = i === 0 || i === 3 ? sprite.u0 : sprite.u1; f[o + 3] = i < 2 ? sprite.v0 : sprite.v1; } else { f[o + 2] = sprite.u0 + att.uvs[i * 2] * du; f[o + 3] = sprite.v0 + att.uvs[i * 2 + 1] * dv; }
      u[o + 4] = colour; u[o + 5] = meta;
    }
    const at = meshes.indexCount - tris.length;
    for (let i = 0; i < tris.length; i++) meshes.indices[at + i] = base + tris[i];
    triangles += tris.length / 3;
  }
  return triangles;
}
