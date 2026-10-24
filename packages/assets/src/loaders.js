// Loaders for the common types. Plain data ones work anywhere; image and audio use the browser's decoders (or ones you pass in).

/** Loader for JSON files: resolves to the parsed value; a file that is not valid JSON is an `AssetError`. */
export const jsonLoader = { extensions: ['json'], load: (ctx) => ctx.json() };
/** Loader for text files (`.txt`, `.glsl`, `.wgsl`, `.md`, `.csv`): resolves to a string. */
export const textLoader = { extensions: ['txt', 'glsl', 'wgsl', 'md', 'csv'], load: (ctx) => ctx.text() };
/** Loader for raw bytes (`.bin`, `.dat`): resolves to an `ArrayBuffer`. */
export const binaryLoader = { extensions: ['bin', 'dat'], load: (ctx) => ctx.bytes() };

/** Images as `ImageBitmap` (or whatever `decode(bytes, mime)` returns). Frees bitmaps when collected. */
export function imageLoader({ decode } = {}) {
  const mimeOf = (p) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' })[p.slice(p.lastIndexOf('.') + 1).toLowerCase()] ?? 'image/png';
  return {
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'],
    async load(ctx) {
      const bytes = await ctx.bytes();
      if (decode) return decode(bytes, mimeOf(ctx.path));
      return createImageBitmap(new Blob([bytes], { type: mimeOf(ctx.path) }));
    },
    dispose: (v) => v?.close?.(),
  };
}

/** Sounds as `AudioBuffer`s decoded by the given `AudioContext` (or `decode(bytes)`). */
export function audioLoader({ context, decode } = {}) {
  return {
    extensions: ['ogg', 'mp3', 'wav', 'm4a', 'opus', 'flac'],
    async load(ctx) {
      const bytes = await ctx.bytes();
      if (decode) return decode(bytes);
      return (context ?? new AudioContext()).decodeAudioData(bytes.slice(0));
    },
  };
}

/**
 * glTF models: `parse(json, {buffers})` is your parser (the render package's `parseGltf`); external buffers are fetched through the manager,
 * so they are cached, counted and hot reloaded with the model. `.glb` files go to `parse` as bytes.
 */
export function gltfLoader(parse) {
  return {
    extensions: ['gltf', 'glb'],
    async load(ctx) {
      if (ctx.path.toLowerCase().endsWith('.glb')) return parse(await ctx.bytes(), { buffers: {} });
      const json = await ctx.json();
      const buffers = {};
      for (const b of json.buffers ?? []) if (b.uri && !b.uri.startsWith('data:')) buffers[b.uri] = await ctx.load('binary', ctx.sibling(b.uri));
      return parse(json, { buffers });
    },
  };
}

/** The types every game wants: json, text, binary. Add image / audio / gltf with their loaders. */
export const basicLoaders = () => ({ json: jsonLoader, text: textLoader, binary: binaryLoader });
