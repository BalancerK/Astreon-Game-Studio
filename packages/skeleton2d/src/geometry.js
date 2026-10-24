const DEG = Math.PI / 180;

/**
 * Where an attachment's points are in the world right now. A region gives its four corners (top left, top right, bottom right, bottom left); a mesh or bounding box gives its points,
 * moved by its bones and by any deformation.
 * @param {import('./skeleton.js').Skeleton} skeleton @param {import('./skeleton.js').Slot} slot @param {import('./skeleton.js').Attachment} att @param {Float32Array | number[]} out x, y for each point
 * @param {number} [outAt] Where in `out` to start writing. @param {{width: number, height: number}} [size] For a region with no size of its own: the size of its sprite.
 * @returns {number} How many points were written.
 */
export function attachmentWorldVertices(skeleton, slot, att, out, outAt = 0, size) {
  const bone = slot.bone;
  if (att.type === 'region') {
    const w = (att.width || size?.width || 0) * att.scaleX / 2, h = (att.height || size?.height || 0) * att.scaleY / 2, c = Math.cos(att.rotation * DEG), s = Math.sin(att.rotation * DEG);
    const corners = [-w, -h, w, -h, w, h, -w, h];
    for (let i = 0; i < 4; i++) {
      const lx = corners[i * 2] * c - corners[i * 2 + 1] * s + att.x, ly = corners[i * 2] * s + corners[i * 2 + 1] * c + att.y;
      out[outAt + i * 2] = bone.a * lx + bone.b * ly + bone.worldX; out[outAt + i * 2 + 1] = bone.c * lx + bone.d * ly + bone.worldY;
    }
    return 4;
  }
  const n = att.vertexCount, d = slot.deform && slot.deform.length === att.influences * 2 && skeleton.attachmentOf(slot) === att ? slot.deform : null, local = att.local;
  if (!att.weighted) {
    for (let i = 0; i < n; i++) {
      const lx = local[i * 2] + (d ? d[i * 2] : 0), ly = local[i * 2 + 1] + (d ? d[i * 2 + 1] : 0);
      out[outAt + i * 2] = bone.a * lx + bone.b * ly + bone.worldX; out[outAt + i * 2 + 1] = bone.c * lx + bone.d * ly + bone.worldY;
    }
    return n;
  }
  let k = 0, inf = 0;
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0;
    for (let j = 0; j < att.bonesPerVertex[i]; j++, k += 3, inf++) {
      const b = skeleton.bones[att.boneIndices[inf]], lx = local[k] + (d ? d[inf * 2] : 0), ly = local[k + 1] + (d ? d[inf * 2 + 1] : 0), w = local[k + 2];
      x += (b.a * lx + b.b * ly + b.worldX) * w; y += (b.c * lx + b.d * ly + b.worldY) * w;
    }
    out[outAt + i * 2] = x; out[outAt + i * 2 + 1] = y;
  }
  return n;
}

/**
 * The box that holds everything the skeleton is showing (regions and meshes; bounding boxes do not count).
 * @param {import('./skeleton.js').Skeleton} skeleton @param {{atlas?: import('../../render/src/atlas.js').Atlas}} [o] The atlas gives regions without a size their sprite's size.
 * @returns {{x0: number, y0: number, x1: number, y1: number} | null} `null` if nothing is shown.
 */
export function skeletonBounds(skeleton, { atlas } = {}) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const buf = new Float32Array(2 * 64);
  let out = buf;
  for (const slot of skeleton.drawOrder) {
    const att = skeleton.attachmentOf(slot);
    if (!att || att.type === 'boundingbox') continue;
    const count = att.type === 'region' ? 4 : att.vertexCount;
    if (count * 2 > out.length) out = new Float32Array(count * 2);
    const sprite = atlas?.sprites.get(att.path), n = attachmentWorldVertices(skeleton, slot, att, out, 0, sprite && { width: sprite.w, height: sprite.h });
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, out[i * 2]); x1 = Math.max(x1, out[i * 2]); y0 = Math.min(y0, out[i * 2 + 1]); y1 = Math.max(y1, out[i * 2 + 1]); }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

/** Is the point inside the polygon of x, y pairs? @param {ArrayLike<number>} poly @param {number} n Points. @param {number} x @param {number} y */
export function pointInPolygon(poly, n, x, y) {
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], yi = poly[i * 2 + 1], xj = poly[j * 2], yj = poly[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * What is at a point: the first bounding box (from the front) that contains it, or, with `any: true`, the first region or mesh too.
 * @param {import('./skeleton.js').Skeleton} skeleton @param {number} x @param {number} y @param {{any?: boolean, atlas?: import('../../render/src/atlas.js').Atlas}} [o]
 * @returns {{slot: import('./skeleton.js').Slot, attachment: import('./skeleton.js').Attachment} | null}
 */
export function hitTest(skeleton, x, y, { any = false, atlas } = {}) {
  let out = new Float32Array(128);
  for (let i = skeleton.drawOrder.length - 1; i >= 0; i--) {
    const slot = skeleton.drawOrder[i], att = skeleton.attachmentOf(slot);
    if (!att) continue;
    if (att.type !== 'boundingbox' && !any) continue;
    const count = att.type === 'region' ? 4 : att.vertexCount;
    if (count * 2 > out.length) out = new Float32Array(count * 2);
    const sprite = atlas?.sprites.get(att.path), n = attachmentWorldVertices(skeleton, slot, att, out, 0, sprite && { width: sprite.w, height: sprite.h });
    if (att.type === 'mesh') {
      for (let t = 0; t < att.triangles.length; t += 3) {
        const tri = [att.triangles[t], att.triangles[t + 1], att.triangles[t + 2]], poly = [out[tri[0] * 2], out[tri[0] * 2 + 1], out[tri[1] * 2], out[tri[1] * 2 + 1], out[tri[2] * 2], out[tri[2] * 2 + 1]];
        if (pointInPolygon(poly, 3, x, y)) return { slot, attachment: att };
      }
    } else if (pointInPolygon(out, n, x, y)) return { slot, attachment: att };
  }
  return null;
}
