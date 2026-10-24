/**
 * KTX2 texture files: the container GPU texture formats travel in. `parseKtx2` reads the header and mip levels of a `.ktx2` file, undoing zlib supercompression, and says which pixel format the
 * data is in. Give the result to `TextureSet.addKtx2` to use it as a layer.
 *
 * What is read: pictures stored as plain 8-bit RGBA, and pictures already compressed for the graphics card in the formats cards can read as they are: BC1, BC3 and BC7 (desktop cards), ETC2
 * (phones) and ASTC 4x4 (phones and newer cards), one picture with all its mip levels. The data goes to the graphics card untouched, so it takes a quarter to an eighth of the memory.
 *
 * What is not (it says so, rather than failing later): Basis Universal files (`ETC1S` and `UASTC`, what `basisu` and `toktx --bcmp` write), which need a transcoder program that is
 * WebAssembly; Zstandard supercompression; cube maps, arrays and 3D textures. Save a texture in the final format instead, for example `toktx --encode bc7` (or `--t2 --zcmp` for zlib).
 */

const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The formats read, by their Vulkan format number (what a KTX2 file names its format with).
 * `gpu` is the format name for WebGPU; `block` is the width and height in pixels of a block (1 for uncompressed) and `bytes` the bytes in one block (or pixel).
 */
export const KTX2_FORMATS = Object.freeze({
  37: { name: 'rgba8', gpu: 'rgba8unorm', block: 1, bytes: 4, srgb: false },
  43: { name: 'rgba8', gpu: 'rgba8unorm', block: 1, bytes: 4, srgb: true },
  131: { name: 'bc1', gpu: 'bc1-rgba-unorm', block: 4, bytes: 8, srgb: false },
  132: { name: 'bc1', gpu: 'bc1-rgba-unorm', block: 4, bytes: 8, srgb: true },
  133: { name: 'bc1', gpu: 'bc1-rgba-unorm', block: 4, bytes: 8, srgb: false },
  134: { name: 'bc1', gpu: 'bc1-rgba-unorm', block: 4, bytes: 8, srgb: true },
  137: { name: 'bc3', gpu: 'bc3-rgba-unorm', block: 4, bytes: 16, srgb: false },
  138: { name: 'bc3', gpu: 'bc3-rgba-unorm', block: 4, bytes: 16, srgb: true },
  145: { name: 'bc7', gpu: 'bc7-rgba-unorm', block: 4, bytes: 16, srgb: false },
  146: { name: 'bc7', gpu: 'bc7-rgba-unorm', block: 4, bytes: 16, srgb: true },
  152: { name: 'etc2', gpu: 'etc2-rgba8unorm', block: 4, bytes: 16, srgb: false },
  153: { name: 'etc2', gpu: 'etc2-rgba8unorm', block: 4, bytes: 16, srgb: true },
  157: { name: 'astc4x4', gpu: 'astc-4x4-unorm', block: 4, bytes: 16, srgb: false },
  158: { name: 'astc4x4', gpu: 'astc-4x4-unorm', block: 4, bytes: 16, srgb: true },
});

/** The format names a texture set can hold. */
export const TEXTURE_FORMATS = Object.freeze(['rgba8', 'bc1', 'bc3', 'bc7', 'etc2', 'astc4x4']);

const GPU_FEATURE = { bc1: 'texture-compression-bc', bc3: 'texture-compression-bc', bc7: 'texture-compression-bc', etc2: 'texture-compression-etc2', astc4x4: 'texture-compression-astc' };
const GL_FORMAT = { bc1: ['WEBGL_compressed_texture_s3tc', 0x83f1], bc3: ['WEBGL_compressed_texture_s3tc', 0x83f3], bc7: ['EXT_texture_compression_bptc', 0x8e8c], etc2: ['WEBGL_compressed_texture_etc', 0x9278], astc4x4: ['WEBGL_compressed_texture_astc', 0x93b0] };

/** What a renderer needs to hold a texture set of a format: the WebGPU format and feature, the WebGL2 extension and internal format, and the block size in pixels and bytes. */
export function textureFormatInfo(name) {
  if (name === 'rgba8') return { name, gpu: 'rgba8unorm', feature: null, glExtension: null, glFormat: 0, block: 1, bytes: 4 };
  const f = Object.values(KTX2_FORMATS).find((x) => x.name === name);
  if (!f) throw new Error(`unknown texture format "${name}"`);
  return { name, gpu: f.gpu, feature: GPU_FEATURE[name], glExtension: GL_FORMAT[name][0], glFormat: GL_FORMAT[name][1], block: f.block, bytes: f.bytes };
}

/** How many bytes one mip level of a picture takes in a format. */
export function levelBytes(format, width, height) {
  const f = Object.values(KTX2_FORMATS).find((x) => x.name === format);
  if (!f) throw new Error(`unknown texture format "${format}"`);
  return Math.ceil(width / f.block) * Math.ceil(height / f.block) * f.bytes;
}

const fail = (what) => { throw new Error(`KTX2: ${what}`); };

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') fail('this file is zlib compressed and this environment has no DecompressionStream to undo that');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read a KTX2 file.
 * @param {ArrayBuffer | Uint8Array} input
 * @returns {Promise<{width: number, height: number, format: string, gpuFormat: string, srgb: boolean, vkFormat: number, levels: Uint8Array[]}>}
 *   `levels[0]` is the full size picture, then each half the size; each is the bytes of that level in `format`.
 */
export async function parseKtx2(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 80 || IDENTIFIER.some((b, i) => bytes[i] !== b)) fail('not a KTX2 file (the first bytes are wrong)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at) => view.getUint32(at, true);
  const u64 = (at) => { const n = Number(view.getBigUint64(at, true)); if (!Number.isSafeInteger(n)) fail('a size in the file is too large'); return n; };
  const vkFormat = u32(12), width = u32(20), height = u32(24), depth = u32(28), layers = u32(32), faces = u32(36);
  let levelCount = u32(40);
  const supercompression = u32(44);
  if (depth > 1) fail('3D textures are not supported');
  if (layers > 1) fail('texture arrays are not supported (add the layers one by one)');
  if (faces > 1) fail('cube maps are not supported here (use an environment: `environmentFromImage`)');
  if (width < 1 || height < 1) fail('the picture has no size');
  if (supercompression === 1) fail('this is a Basis Universal file (BasisLZ/ETC1S), which needs a transcoder that is WebAssembly; save the texture in a format the graphics card reads (BC7, BC3, ETC2, ASTC) or as plain RGBA8');
  if (supercompression === 2) fail('Zstandard supercompression is not supported; save the file with zlib (or no) supercompression');
  if (supercompression !== 0 && supercompression !== 3) fail(`supercompression scheme ${supercompression} is not known`);
  const format = KTX2_FORMATS[vkFormat];
  if (!format) {
    if (vkFormat === 0) fail('this is a Basis Universal file (UASTC or ETC1S), which needs a transcoder that is WebAssembly; save the texture in a format the graphics card reads (BC7, BC3, ETC2, ASTC) or as plain RGBA8');
    fail(`pixel format ${vkFormat} is not supported (read: RGBA8, BC1, BC3, BC7, ETC2 RGBA8, ASTC 4x4)`);
  }
  if (levelCount === 0) levelCount = 1;                                          // 0 means "the reader makes the levels", which a compressed picture cannot
  if (levelCount > 32 || 80 + levelCount * 24 > bytes.length) fail('the level index is damaged');
  const levels = [];
  for (let i = 0; i < levelCount; i++) {
    const at = 80 + i * 24, offset = u64(at), length = u64(at + 8), raw = u64(at + 16);
    if (offset + length > bytes.length) fail(`mip level ${i} runs past the end of the file`);
    let data = bytes.subarray(offset, offset + length);
    if (supercompression === 3) data = await inflate(data);
    const w = Math.max(1, width >> i), h = Math.max(1, height >> i);
    const want = Math.ceil(w / format.block) * Math.ceil(h / format.block) * format.bytes;
    if (data.length !== want || (supercompression === 3 && raw !== want)) fail(`mip level ${i} has ${data.length} bytes, but a ${w} x ${h} ${format.name} picture takes ${want}`);
    levels.push(supercompression === 3 ? data : data.slice());
  }
  return { width, height, format: format.name, gpuFormat: format.gpu, srgb: format.srgb, vkFormat, levels };
}
