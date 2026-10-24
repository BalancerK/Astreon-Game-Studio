/**
 * A codec turns a number into a wire value and back. Values are held in
 * "stored" form (quantized integer for q-codecs, the number itself otherwise),
 * so change detection compares exact integers and never jitters.
 *
 * @typedef {Object} Codec
 * @property {string} name Canonical description (feeds the schema hash).
 * @property {(v: number) => number} quantize Natural value -> stored value.
 * @property {(s: number) => number} dequantize Stored value -> natural value.
 * @property {(w: import('./binary.js').BinaryWriter, s: number) => void} write
 * @property {(r: import('./binary.js').BinaryReader) => number} read
 */

const clamp = (v, lo, hi) => (v >= lo ? (v <= hi ? v : hi) : lo); // NaN -> lo

/** @returns {Codec} */
function intCodec(name, lo, hi, wr, rd) {
  return {
    name,
    quantize: (v) => Math.round(clamp(v, lo, hi)),
    dequantize: (s) => s,
    write: (w, s) => w[wr](s),
    read: (r) => r[rd](),
  };
}

/** Unsigned 8-bit integer field (0 to 255). */
export const u8 = intCodec('u8', 0, 255, 'u8', 'u8');
/** Unsigned 16-bit integer field (0 to 65535). */
export const u16 = intCodec('u16', 0, 65535, 'u16', 'u16');
/** Unsigned 32-bit integer field (0 to 4294967295). */
export const u32 = intCodec('u32', 0, 4294967295, 'u32', 'u32');
/** Signed 8-bit integer field (-128 to 127). */
export const i8 = intCodec('i8', -128, 127, 'i8', 'i8');
/** Signed 16-bit integer field (-32768 to 32767). */
export const i16 = intCodec('i16', -32768, 32767, 'i16', 'i16');
/** Signed 32-bit integer field (-2147483648 to 2147483647). */
export const i32 = intCodec('i32', -2147483648, 2147483647, 'i32', 'i32');

/**
 * 32-bit floating point field (4 bytes, about 7 digits).
 *
 * @type {Codec}
 */
export const f32 = {
  name: 'f32',
  quantize: (v) => Math.fround(v),
  dequantize: (s) => s,
  write: (w, s) => w.f32(s),
  read: (r) => r.f32(),
};

/**
 * 64-bit floating point field (8 bytes, full precision).
 *
 * @type {Codec}
 */
export const f64 = {
  name: 'f64',
  quantize: (v) => v,
  dequantize: (s) => s,
  write: (w, s) => w.f64(s),
  read: (r) => r.f64(),
};

/**
 * Float in [min, max] stored as an unsigned integer of `bits` (8, 16 or 32).
 * Error is at most (max - min) / (2^bits - 1) / 2. Out-of-range values clamp.
 *
 * @param {number} min
 * @param {number} max
 * @param {8|16|32} bits
 * @returns {Codec}
 */
export function q(min, max, bits) {
  if (!(max > min)) throw new RangeError('q: max must be greater than min');
  if (bits !== 8 && bits !== 16 && bits !== 32) throw new RangeError('q: bits must be 8, 16 or 32');
  const levels = bits === 8 ? 255 : bits === 16 ? 65535 : 4294967295;
  const span = max - min;
  const wr = bits === 8 ? 'u8' : bits === 16 ? 'u16' : 'u32';
  return {
    name: `q(${min},${max},${bits})`,
    quantize: (v) => Math.round(((clamp(v, min, max) - min) / span) * levels),
    dequantize: (s) => min + (s / levels) * span,
    write: (w, s) => w[wr](s),
    read: (r) => {
      const s = r[wr]();
      return s;
    },
  };
}

/** Largest possible quantization error for a q codec of this range and width. */
export const quantizationStep = (min, max, bits) => (max - min) / (bits === 8 ? 255 : bits === 16 ? 65535 : 4294967295);
