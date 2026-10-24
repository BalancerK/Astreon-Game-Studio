/**
 * Decoding of meshopt-compressed mesh data, the format glTF files made by `gltfpack` use (`EXT_meshopt_compression`): vertex attributes, triangle indices and index sequences, and the four
 * filters that make quantised normals, rotations, numbers and colours smaller still. A compressed model is a fraction of the size to download (vertices usually a quarter to a fifth).
 *
 * This is plain JavaScript, with no WebAssembly and nothing to install. It is a port of the decoding algorithms of meshoptimizer by Arseny Kapoulkine (MIT licence, see NOTICE), written
 * so that its results are exactly the reference decoder's: 32-bit unsigned arithmetic wraps where the reference's does, and the filters round in 32-bit floats. Both versions of the vertex
 * format (0 and 1) are read.
 *
 * It decodes; it does not encode (compress a model with `gltfpack` or `meshoptimizer`, then give the file to `parseGltf`, which uses this).
 */

const VERTEX_HEADER = 0xa0, INDEX_HEADER = 0xe0, SEQUENCE_HEADER = 0xd0;
const MAX_VERTEX_VERSION = 1, MAX_INDEX_VERSION = 1;
const BLOCK_BYTES = 8192, BLOCK_MAX = 256, GROUP = 16, GROUP_LIMIT = 24;
const TAIL_MIN = [32, 24];
const BITS_V0 = [0, 2, 4, 8], BITS_V1 = [0, 1, 2, 4, 8];

const fail = (what) => { throw new Error(`the compressed mesh data is ${what}`); };

// ---------- vertices ----------

const blockSizeFor = (vertexSize) => Math.min(BLOCK_MAX, Math.floor(BLOCK_BYTES / vertexSize) & ~(GROUP - 1));

const reverseBits = (b) => { let r = 0; for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i); return r; };

/** Read one group of 16 bytes from a stream of `bits`-wide codes (an all-ones code means "the real byte follows after the codes"). Returns where the stream goes on. */
function decodeBytesGroup(data, pos, buffer, at, bits) {
  if (bits === 0) { buffer.fill(0, at, at + GROUP); return pos; }
  if (bits === 8) { buffer.set(data.subarray(pos, pos + GROUP), at); return pos + GROUP; }
  const codes = 8 / bits, perByte = codes, sentinel = (1 << bits) - 1, headers = GROUP / perByte;
  let literal = pos + headers, out = at;
  for (let h = 0; h < headers; h++) {
    let byte = data[pos++];
    if (bits === 1) byte = reverseBits(byte);                                  // 1-bit groups are stored in reverse bit order
    for (let c = 0; c < perByte; c++) {
      const enc = byte >> (8 - bits);
      byte = (byte << bits) & 255;
      if (enc === sentinel) buffer[out++] = data[literal++]; else buffer[out++] = enc;
    }
  }
  return literal;
}

/** Read `size` bytes (a multiple of 16) as groups, each with its own code width given by two bits of a header. */
function decodeBytes(data, pos, end, buffer, at, size, table, tableAt) {
  const headerSize = (size / GROUP + 3) >> 2;
  if (end - pos < headerSize) return -1;
  const header = pos;
  pos += headerSize;
  for (let i = 0; i < size; i += GROUP) {
    if (end - pos < GROUP_LIMIT) return -1;
    const h = i / GROUP;
    const k = (data[header + (h >> 2)] >> ((h & 3) * 2)) & 3;
    pos = decodeBytesGroup(data, pos, buffer, at + i, table[tableAt + k]);
  }
  return pos;
}

/** Undo the delta coding of four columns of bytes (one, two or four bytes at a time) and write them as vertices. */
function decodeDeltas4(buffer, bufferAt, out, outAt, vertexCount, vertexSize, last, lastAt, size, xor, rot) {
  const mask = size === 4 ? 0xffffffff : (1 << (size * 8)) - 1;
  for (let k = 0; k < 4; k += size) {
    let offset = outAt + k;
    let p = last[lastAt];
    for (let j = 1; j < size; j++) p |= last[lastAt + j] << (8 * j);
    p >>>= 0;
    for (let i = 0; i < vertexCount; i++) {
      let v = buffer[bufferAt + i];
      for (let j = 1; j < size; j++) v |= buffer[bufferAt + i + vertexCount * j] << (8 * j);
      v >>>= 0;
      if (xor) v = (((v << rot) | (v >>> ((32 - rot) & 31))) ^ p) >>> 0;
      else v = ((((0 - (v & 1)) ^ (v >>> 1)) + p) & mask) >>> 0;
      for (let j = 0; j < size; j++) out[offset + j] = (v >>> (j * 8)) & 255;
      p = v;
      offset += vertexSize;
    }
    bufferAt += vertexCount * size;
    lastAt += size;
  }
}

const scratch = new Uint8Array(BLOCK_MAX * 4);

/** One block of up to 256 vertices. Returns where the stream goes on, or -1 if the data is damaged. */
function decodeVertexBlock(data, pos, end, out, outAt, vertexCount, vertexSize, last, channels, channelsAt, version) {
  const aligned = (vertexCount + GROUP - 1) & ~(GROUP - 1);
  const controlSize = version === 0 ? 0 : vertexSize / 4;
  if (end - pos < controlSize) return -1;
  const control = pos;
  pos += controlSize;
  for (let k = 0; k < vertexSize; k += 4) {
    const ctrlByte = version === 0 ? 0 : data[control + k / 4];
    for (let j = 0; j < 4; j++) {
      const ctrl = (ctrlByte >> (j * 2)) & 3;
      if (ctrl === 3) {                                                          // the bytes themselves
        if (end - pos < vertexCount) return -1;
        scratch.set(data.subarray(pos, pos + vertexCount), j * vertexCount);
        pos += vertexCount;
      } else if (ctrl === 2) {                                                   // all zero
        scratch.fill(0, j * vertexCount, (j + 1) * vertexCount);
      } else {
        pos = version === 0 ? decodeBytes(data, pos, end, scratch, j * vertexCount, aligned, BITS_V0, 0) : decodeBytes(data, pos, end, scratch, j * vertexCount, aligned, BITS_V1, ctrl);
        if (pos < 0) return -1;
      }
    }
    const channel = version === 0 ? 0 : channels[channelsAt + k / 4];
    switch (channel & 3) {
      case 0: decodeDeltas4(scratch, 0, out, outAt + k, vertexCount, vertexSize, last, k, 1, false, 0); break;
      case 1: decodeDeltas4(scratch, 0, out, outAt + k, vertexCount, vertexSize, last, k, 2, false, 0); break;
      case 2: decodeDeltas4(scratch, 0, out, outAt + k, vertexCount, vertexSize, last, k, 4, true, (32 - (channel >> 4)) & 31); break;
      default: return -1;
    }
  }
  last.set(out.subarray(outAt + vertexSize * (vertexCount - 1), outAt + vertexSize * vertexCount));
  return pos;
}

/**
 * Decode a compressed vertex buffer.
 * @param {number} count vertices
 * @param {number} stride bytes per vertex (a multiple of 4, at most 256)
 * @param {Uint8Array} source the compressed bytes
 * @returns {Uint8Array} `count * stride` bytes
 */
export function decodeVertexBuffer(count, stride, source) {
  if (!(stride > 0 && stride <= 256 && stride % 4 === 0)) fail(`for vertices of ${stride} bytes, which is not a size it can have (a multiple of 4, up to 256)`);
  const out = new Uint8Array(count * stride);
  if (source.length < 1) fail('empty');
  const header = source[0];
  if ((header & 0xf0) !== VERTEX_HEADER) fail('not vertex data (the first byte is wrong)');
  const version = header & 0x0f;
  if (version > MAX_VERTEX_VERSION) fail(`in a newer version of the format (${version}) than this decoder reads`);
  const tailSize = stride + (version === 0 ? 0 : stride / 4);
  const tailPad = Math.max(tailSize, TAIL_MIN[version]);
  if (source.length - 1 < tailPad) fail('too short');
  const tail = source.length - tailSize;
  const last = new Uint8Array(256);
  last.set(source.subarray(tail, tail + stride));
  const channelsAt = tail + stride;
  const blockSize = blockSizeFor(stride);
  let pos = 1;
  for (let at = 0; at < count; at += blockSize) {
    const n = Math.min(blockSize, count - at);
    pos = decodeVertexBlock(source, pos, source.length, out, at * stride, n, stride, last, source, channelsAt, version);
    if (pos < 0) fail('damaged (a block ends early or has a code that does not exist)');
  }
  if (source.length - pos !== tailPad) fail('damaged (the data does not end where it should)');
  return out;
}

// ---------- indices ----------

const CODE_AUX = [0x00, 0x76, 0x87, 0x56, 0x67, 0x78, 0xa9, 0x86, 0x65, 0x89, 0x68, 0x98, 0x01, 0x69];

/**
 * Decode compressed triangle indices.
 * @param {number} count indices (a multiple of 3)
 * @param {number} stride bytes per index: 2 or 4
 * @param {Uint8Array} source
 * @returns {Uint8Array} `count * stride` bytes
 */
export function decodeIndexBuffer(count, stride, source) {
  if (count % 3 !== 0) fail(`for ${count} indices, which is not a whole number of triangles`);
  if (stride !== 2 && stride !== 4) fail(`for indices of ${stride} bytes (they are 2 or 4)`);
  const out = new Uint8Array(count * stride);
  const tris = stride === 2 ? new Uint16Array(out.buffer) : new Uint32Array(out.buffer);
  if (source.length < 1 + count / 3 + 16) fail('too short');
  if ((source[0] & 0xf0) !== INDEX_HEADER) fail('not index data (the first byte is wrong)');
  const version = source[0] & 0x0f;
  if (version > MAX_INDEX_VERSION) fail(`in a newer version of the format (${version}) than this decoder reads`);
  const edge = new Uint32Array(32).fill(0xffffffff), vertex = new Uint32Array(16).fill(0xffffffff);
  let edgeAt = 0, vertexAt = 0, next = 0, last = 0, written = 0;
  const fecMax = version >= 1 ? 13 : 15;
  let code = 1;
  const codeEnd = code + count / 3;
  let data = codeEnd;
  const safeEnd = source.length - 16;
  const table = safeEnd;
  const vbyte = () => {
    const lead = source[data++];
    if (lead < 128) return lead;
    let result = lead & 127, shift = 7;
    for (let i = 0; i < 4; i++) {
      const group = source[data++];
      result |= (group & 127) << shift;
      shift += 7;
      if (group < 128) break;
    }
    return result >>> 0;
  };
  const decodeIndex = (from) => { const v = vbyte(); return (from + ((v >>> 1) ^ -(v & 1))) >>> 0; };
  const pushVertex = (v, advance = 1) => { vertex[vertexAt] = v; vertexAt = (vertexAt + advance) & 15; };
  const pushEdge = (a, b) => { edge[edgeAt * 2] = a; edge[edgeAt * 2 + 1] = b; edgeAt = (edgeAt + 1) & 15; };
  const triangle = (a, b, c) => { tris[written++] = a; tris[written++] = b; tris[written++] = c; };
  while (code < codeEnd) {
    const codeTri = source[code++];
    if (codeTri < 0xf0) {
      const fe = codeTri >> 4;
      const slot = (edgeAt - 1 - fe) & 15;
      const a = edge[slot * 2], b = edge[slot * 2 + 1];
      let c;
      const fec = codeTri & 15;
      if (fec < fecMax) {
        const cf = vertex[(vertexAt - 1 - fec) & 15];
        c = fec === 0 ? next : cf;
        const fec0 = fec === 0 ? 1 : 0;
        next = (next + fec0) >>> 0;
        pushVertex(c, fec0);
      } else {
        if (data > safeEnd) fail('damaged (the triangles run past their data)');
        last = c = fec !== 15 ? (last + (fec * 2 - 27)) >>> 0 : decodeIndex(last);
        pushVertex(c);
      }
      pushEdge(c, b);
      pushEdge(a, c);
      triangle(a, b, c);
    } else if (codeTri < 0xfe) {
      const aux = CODE_AUX[codeTri & 15];
      const feb = aux >> 4, fec = aux & 15;
      const a = next;
      next = (next + 1) >>> 0;
      const bf = vertex[(vertexAt - feb) & 15];
      const b = feb === 0 ? next : bf;
      const feb0 = feb === 0 ? 1 : 0;
      next = (next + feb0) >>> 0;
      const cf = vertex[(vertexAt - fec) & 15];
      const c = fec === 0 ? next : cf;
      const fec0 = fec === 0 ? 1 : 0;
      next = (next + fec0) >>> 0;
      triangle(a, b, c);
      pushVertex(a);
      pushVertex(b, feb0);
      pushVertex(c, fec0);
      pushEdge(b, a);
      pushEdge(c, b);
      pushEdge(a, c);
    } else {
      if (data > safeEnd) fail('damaged (the triangles run past their data)');
      const aux = source[data++];
      const fea = codeTri === 0xfe ? 0 : 15, feb = aux >> 4, fec = aux & 15;
      if (aux === 0) next = 0;
      let a = fea === 0 ? next++ : 0;
      let b = feb === 0 ? next++ : vertex[(vertexAt - feb) & 15];
      let c = fec === 0 ? next++ : vertex[(vertexAt - fec) & 15];
      next >>>= 0;
      if (fea === 15) last = a = decodeIndex(last);
      if (feb === 15) last = b = decodeIndex(last);
      if (fec === 15) last = c = decodeIndex(last);
      triangle(a, b, c);
      pushVertex(a);
      pushVertex(b, feb === 0 || feb === 15 ? 1 : 0);
      pushVertex(c, fec === 0 || fec === 15 ? 1 : 0);
      pushEdge(b, a);
      pushEdge(c, b);
      pushEdge(a, c);
    }
  }
  void table;
  if (data !== safeEnd) fail('damaged (the data does not end where it should)');
  return out;
}

/**
 * Decode a compressed sequence of indices (not triangles: for lines, points or any list of indices).
 * @param {number} count indices
 * @param {number} stride bytes per index: 2 or 4
 * @param {Uint8Array} source
 * @returns {Uint8Array} `count * stride` bytes
 */
export function decodeIndexSequence(count, stride, source) {
  if (stride !== 2 && stride !== 4) fail(`for indices of ${stride} bytes (they are 2 or 4)`);
  const out = new Uint8Array(count * stride);
  const list = stride === 2 ? new Uint16Array(out.buffer) : new Uint32Array(out.buffer);
  if (source.length < 1 + count + 4) fail('too short');
  if ((source[0] & 0xf0) !== SEQUENCE_HEADER) fail('not an index sequence (the first byte is wrong)');
  if ((source[0] & 0x0f) > MAX_INDEX_VERSION) fail('in a newer version of the format than this decoder reads');
  let data = 1;
  const safeEnd = source.length - 4;
  const last = [0, 0];
  for (let i = 0; i < count; i++) {
    if (data >= safeEnd) fail('damaged (the indices run past their data)');
    const lead = source[data++];
    let v = lead;
    if (lead >= 128) {
      v = lead & 127;
      let shift = 7;
      for (let k = 0; k < 4; k++) {
        const group = source[data++];
        v |= (group & 127) << shift;
        shift += 7;
        if (group < 128) break;
      }
      v >>>= 0;
    }
    const current = v & 1;
    v >>>= 1;
    const index = (last[current] + ((v >>> 1) ^ -(v & 1))) >>> 0;
    last[current] = index;
    list[i] = index;
  }
  if (data !== safeEnd) fail('damaged (the data does not end where it should)');
  return out;
}

// ---------- the filters (applied to vertex data after it is decoded) ----------

const f32 = Math.fround;
const round = (v) => Math.trunc(f32(v + (v >= 0 ? 0.5 : -0.5)));

/** Normals stored as two numbers (an octahedral map) and a scale become three numbers again. `stride` 4 is bytes, 8 is 16-bit numbers. */
function filterOctahedral(bytes, count, stride) {
  const data = stride === 4 ? new Int8Array(bytes.buffer) : new Int16Array(bytes.buffer);
  const max = f32((1 << (stride === 4 ? 7 : 15)) - 1), wrap = stride === 4 ? 24 : 16;
  for (let i = 0; i < count; i++) {
    let x = data[i * 4], y = data[i * 4 + 1];
    const z = f32(f32(data[i * 4 + 2] - Math.abs(x)) - Math.abs(y));
    const t = z >= 0 ? 0 : z;
    x = f32(x + (x >= 0 ? t : -t));
    y = f32(y + (y >= 0 ? t : -t));
    const l = f32(Math.sqrt(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z))));
    const s = f32(max / l);
    data[i * 4] = (round(f32(x * s)) << wrap) >> wrap;
    data[i * 4 + 1] = (round(f32(y * s)) << wrap) >> wrap;
    data[i * 4 + 2] = (round(f32(z * s)) << wrap) >> wrap;
  }
}

/** Rotations stored as three numbers, a scale and a position of the largest component become four numbers (a quaternion). */
function filterQuaternion(bytes, count) {
  const data = new Int16Array(bytes.buffer);
  const scale = f32(32767 / f32(Math.sqrt(2)));
  for (let i = 0; i < count; i++) {
    const sf = data[i * 4 + 3] | 3, s = sf;
    const x = data[i * 4], y = data[i * 4 + 1], z = data[i * 4 + 2];
    const ws = f32(s * s);
    const ww = f32(f32(f32(f32(f32(ws * 2) - f32(x * x)) - f32(y * y)) - f32(z * z)));
    const w = f32(Math.sqrt(ww >= 0 ? ww : 0));
    const ss = f32(scale / s);
    const xf = round(f32(x * ss)), yf = round(f32(y * ss)), zf = round(f32(z * ss)), wf = Math.trunc(f32(f32(w * ss) + 0.5));
    const qc = data[i * 4 + 3] & 3;
    data[i * 4 + ((qc + 1) & 3)] = xf;
    data[i * 4 + ((qc + 2) & 3)] = yf;
    data[i * 4 + ((qc + 3) & 3)] = zf;
    data[i * 4 + ((qc + 0) & 3)] = wf;
  }
}

/** Numbers stored as a 24-bit whole number and an exponent become 32-bit floats. */
function filterExponential(bytes, numbers) {
  const data = new Uint32Array(bytes.buffer);
  const float = new Float32Array(1), bits = new Uint32Array(float.buffer);
  for (let i = 0; i < numbers; i++) {
    const v = data[i];
    const m = (v << 8) >> 8, e = (v | 0) >> 24;
    bits[0] = ((e + 127) << 23) >>> 0;
    float[0] = float[0] * m;
    data[i] = bits[0];
  }
}

/** Colours stored as luma and two chroma differences with a scale become red, green, blue and alpha. `stride` 4 is bytes, 8 is 16-bit numbers. */
function filterColor(bytes, count, stride) {
  const wide = stride === 8;
  const data = wide ? new Uint16Array(bytes.buffer) : new Uint8Array(bytes.buffer);
  const signed = wide ? new Int16Array(bytes.buffer) : new Int8Array(bytes.buffer);
  const max = f32((1 << (wide ? 16 : 8)) - 1);
  for (let i = 0; i < count; i++) {
    let as = data[i * 4 + 3];
    as |= as >> 1; as |= as >> 2; as |= as >> 4; as |= as >> 8;
    const y = data[i * 4], co = signed[i * 4 + 1], cg = signed[i * 4 + 2];
    const r = y + co - cg, g = y + cg, b = y - co - cg;
    let a = data[i * 4 + 3];
    a = ((a << 1) & as) | (a & 1);
    const ss = f32(max / as);
    data[i * 4] = Math.trunc(f32(f32(r * ss) + 0.5));
    data[i * 4 + 1] = Math.trunc(f32(f32(g * ss) + 0.5));
    data[i * 4 + 2] = Math.trunc(f32(f32(b * ss) + 0.5));
    data[i * 4 + 3] = Math.trunc(f32(f32(a * ss) + 0.5));
  }
}

/**
 * Apply a filter to decoded vertex data, in place.
 * @param {Uint8Array} bytes the decoded vertices
 * @param {number} count vertices
 * @param {number} stride bytes per vertex
 * @param {'NONE' | 'OCTAHEDRAL' | 'QUATERNION' | 'EXPONENTIAL' | 'COLOR'} filter
 */
export function applyMeshoptFilter(bytes, count, stride, filter) {
  if (filter === 'NONE' || filter === undefined) return;
  if (filter === 'OCTAHEDRAL') { if (stride !== 4 && stride !== 8) fail('with an octahedral filter on vertices of a size it does not work with (4 or 8 bytes)'); filterOctahedral(bytes, count, stride); }
  else if (filter === 'QUATERNION') { if (stride !== 8) fail('with a quaternion filter on vertices that are not 8 bytes'); filterQuaternion(bytes, count); }
  else if (filter === 'EXPONENTIAL') { if (stride % 4 !== 0) fail('with an exponential filter on vertices that are not a multiple of 4 bytes'); filterExponential(bytes, count * (stride / 4)); }
  else if (filter === 'COLOR') { if (stride !== 4 && stride !== 8) fail('with a colour filter on vertices of a size it does not work with (4 or 8 bytes)'); filterColor(bytes, count, stride); }
  else fail(`with a filter that is not known ("${filter}")`);
}

/**
 * Decode one compressed glTF buffer view (`EXT_meshopt_compression`): `mode` says what it holds, and a filter, if any, is applied after.
 * @param {{count: number, byteStride: number, mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES', filter?: string}} spec the extension's own fields
 * @param {Uint8Array} source the compressed bytes
 * @returns {Uint8Array}
 */
export function decodeMeshoptBufferView({ count, byteStride, mode, filter }, source) {
  let out;
  if (mode === 'ATTRIBUTES') out = decodeVertexBuffer(count, byteStride, source);
  else if (mode === 'TRIANGLES') out = decodeIndexBuffer(count, byteStride, source);
  else if (mode === 'INDICES') out = decodeIndexSequence(count, byteStride, source);
  else fail(`with a mode that is not known ("${mode}")`);
  if (mode === 'ATTRIBUTES') applyMeshoptFilter(out, count, byteStride, filter);
  return out;
}
