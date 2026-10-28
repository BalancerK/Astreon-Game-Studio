# @engine/render

2D sprites, text (including scalable SDF text) and a 3D mesh renderer with glTF loading: WebGPU -> WebGL2 (-> Canvas2D for 2D).

```
npm install @engine/render
```

Version 0.1.0. The package's own README ([packages/render](../../packages/render/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (204 of 204 documented)

| Name | Kind | Summary |
|---|---|---|
| [`AnimationClip`](#class-animationclip) | class | A keyframed animation. |
| [`Animator`](#class-animator) | class | Plays one clip at a time and cross-fades when you switch. |
| [`Atlas`](#class-atlas) | class | Sprite storage backed by 2D canvases, in one or more same-sized pages. |
| [`BitmapFont`](#class-bitmapfont) | class | A font drawn from a picture: BMFont files or a font sheet (see the notes at the top of this file). |
| [`CHUNK`](#chunk) | constant | Tiles along one side of a chunk. |
| [`Camera`](#class-camera) | class | 2D camera. |
| [`Camera3D`](#class-camera3d) | class | A perspective camera for first- and third-person views. |
| [`Canvas2DRenderer`](#class-canvas2drenderer) | class | Last-resort backend: draws each sprite with drawImage. |
| [`DrawList3D`](#class-drawlist3d) | class | The meshes to draw this frame, grouped by mesh so each one becomes a single instanced draw call. |
| [`FLIP_D`](#flip_d) | constant | The flag for a tile mirrored across the diagonal. |
| [`FLIP_H`](#flip_h) | constant | Tiled's flags in the top bits of a tile number: mirrored left to right, top to bottom, and across the diagonal (applied in that order: diagonal, then horizontal, then vertical). |
| [`FLIP_V`](#flip_v) | constant | The flag for a tile mirrored top to bottom. |
| [`Filter`](#filter) | constant | The filter descriptions. |
| [`Font`](#class-font) | class | Text as ordinary sprites. |
| [`FontFamily`](#class-fontfamily) | class | Fonts that make their bold and italic forms on demand, all sharing one atlas. |
| [`FontStack`](#class-fontstack) | class | Fonts in order of preference: each character is drawn with the first font that has it. |
| [`FrameWatcher`](#class-framewatcher) | class | Does a source have a picture it has not shown yet? |
| [`Heightmap`](#class-heightmap) | class | A grid of heights. |
| [`INSTANCE3D_BYTES`](#instance3d_bytes) | constant | Bytes per instance in a 3D draw list (`INSTANCE3D_FLOATS` × 4). |
| [`INSTANCE3D_FLOATS`](#instance3d_floats) | constant | Floats per instance: a 4x4 model matrix (16), an RGBA colour (4) and a material (4: texture layer or -1, mapping, scale, surface material number or 0). |
| [`INSTANCE_BYTES`](#instance_bytes) | constant | Bytes per sprite instance in a `SpriteBatch` (`INSTANCE_WORDS` × 4). |
| [`INSTANCE_WORDS`](#instance_words) | constant | Every backend draws the same instance buffer: one quad per sprite, 11 words (44 bytes) each, so switching renderer changes only upload and draw calls. |
| [`KTX2_FORMATS`](#ktx2_formats) | constant | The formats read, by their Vulkan format number (what a KTX2 file names its format with). |
| [`LayoutTypeface`](#class-layouttypeface) | class | The text API (`width`, `wrap`, `measure`, `draw`) for any typeface that gives `glyph(cp)` and the metrics, built on the layout engine: extend it, or use `BitmapFont` and `FontStack`, which do. |
| [`Light2D`](#light2d) | constant | Light descriptions. |
| [`Lighting2D`](#class-lighting2d) | class | A set of lights and the settings that go with them. |
| [`MATERIAL_FLOATS`](#material_floats) | constant | Floats per material in the packed table the renderers read (five vec4s). |
| [`MAX_GRADIENT_STOPS`](#max_gradient_stops) | constant | Largest number of colour stops in a gradient map. |
| [`MAX_LIGHTS`](#max_lights) | constant | Most lights drawn at once (extra ones are dropped, farthest from the screen's middle first). |
| [`MAX_LOCAL_SHADOW_LAYERS`](#max_local_shadow_layers) | constant | Most layers of local shadow map a frame can use: a spot light takes one, a point light six (one per face of a cube). |
| [`MAX_MATERIALS`](#max_materials) | constant | The most materials a set can hold (numbers 1 to 127; 0 means "no material": the simple lighting). |
| [`MAX_POINT_LIGHTS`](#max_point_lights) | constant | Most point lights a frame can use (the renderers read the first 32 of `lighting.pointLights`). |
| [`MAX_SHADOW_LIGHTS`](#max_shadow_lights) | constant | Most lights that can cast shadows at once (the rest still light, without shadows). |
| [`MAX_WAVES`](#max_waves) | constant | Waves that add up in one style. |
| [`MESH_VERTEX_BYTES`](#mesh_vertex_bytes) | constant | Bytes per vertex in a `MeshBatch2D`. |
| [`MESH_VERTEX_WORDS`](#mesh_vertex_words) | constant | Flat triangles for the 2D renderers: whatever a quad cannot do (a deforming skeleton mesh, a rope, a flag, a torn sprite). |
| [`META_ADDITIVE`](#meta_additive) | constant | Flag in the vertex meta word: the mesh adds its light to the picture instead of covering it. |
| [`META_SDF`](#meta_sdf) | constant | Flag in the instance meta word: the sprite is a signed distance field (anti-aliased by threshold in the shader). |
| [`MaterialSet`](#class-materialset) | class | The materials of a scene, packed the way the renderers read them. |
| [`MeshBatch2D`](#class-meshbatch2d) | class | Accumulates triangles for one frame. |
| [`MorphClip`](#class-morphclip) | class | Keyframed morph weights for one model (from a glTF animation that drives `weights`). |
| [`MorphTargets`](#class-morphtargets) | class | Morph targets (blend shapes): a mesh that can change shape by mixing in stored offsets, such as a face that smiles, blinks and talks. |
| [`ORIENT`](#orient) | constant | How a particle is oriented. |
| [`OcclusionBuffer`](#class-occlusionbuffer) | class | A small depth image of the scene's big solid things, drawn on the CPU each frame, that says whether a bounding sphere is hidden behind them. |
| [`PARTICLE_FLOATS`](#particle_floats) | constant | Floats per particle: four vec4s. |
| [`ParticleBatch`](#class-particlebatch) | class | The per-frame list of particles for the renderer (16 floats each). |
| [`Pose`](#class-pose) | class | Local translation, rotation and scale of every joint. |
| [`RichText`](#class-richtext) | class | Rich text over a set of fonts. |
| [`SHADOW_ANGLES`](#shadow_angles) | constant | Directions in each shadow-casting light's shadow map. |
| [`SKINNED_INSTANCE_BYTES`](#skinned_instance_bytes) | constant | Bytes per instance of a skinned mesh in a draw list. |
| [`SKINNED_INSTANCE_FLOATS`](#skinned_instance_floats) | constant | Skinned instances have a vec4 after the colour whose x is where the instance's palette starts (in matrices; the renderer fills it in), then the material. |
| [`SKIN_BYTES`](#skin_bytes) | constant | Bytes of skinning data per vertex (joint indices and weights). |
| [`SKIN_FLOATS`](#skin_floats) | constant | Floats of skinning data per vertex (4 joint indices and 4 weights). |
| [`SKY_BLOCK_AT`](#sky_block_at) | constant | Where the sky block starts in the uniform table (after the environment's own sixteen). |
| [`SKY_BLOCK_VEC4S`](#sky_block_vec4s) | constant | Vec4s of the sky block in the renderers' uniform table. |
| [`ShelfPacker`](#class-shelfpacker) | class | Shelf packer: rectangles go left to right in rows ("shelves"); a new shelf opens when a rectangle does not fit the current row. |
| [`Skeleton`](#class-skeleton) | class | A joint hierarchy (any order; parents may come after children). |
| [`SpriteBatch`](#class-spritebatch) | class | Accumulates sprites for one frame. |
| [`StaticBatcher`](#class-staticbatcher) | class | Collects placed meshes and merges them into as few meshes as it can without breaking culling or looks. |
| [`TEXTURE_FORMATS`](#texture_formats) | constant | The format names a texture set can hold. |
| [`TONEMAPS`](#tonemaps) | constant | Tone mapping choices for post-processing: `none`, `reinhard`, `aces`, `filmic`. |
| [`Terrain`](#class-terrain) | class | The ground of a heightmap as chunks of mesh with levels of detail. |
| [`TextureSet`](#class-textureset) | class | Square images of one size for the 3D renderers, kept together so they live in one GPU texture array, with mipmaps already computed. |
| [`TileLayer`](#class-tilelayer) | class | One layer of a tile map: tiles in chunks, made when written to, so a layer can be as big as you like and can reach into negative coordinates. |
| [`TileMap`](#class-tilemap) | class | A tile map: a grid size, tilesets and layers. |
| [`TileSet`](#class-tileset) | class | The pictures of tiles: a run of tile numbers starting at `firstGid`, each a rectangle of one atlas sprite. |
| [`VERTEX_BYTES`](#vertex_bytes) | constant | Bytes per mesh vertex (`VERTEX_FLOATS` × 4). |
| [`VERTEX_FLOATS`](#vertex_floats) | constant | A triangle mesh ready for the 3D renderers: interleaved vertices (position xyz, normal xyz: 6 floats) and 32-bit indices. |
| [`VideoSprite`](#class-videosprite) | class | A rectangle of the 2D `Atlas` showing a moving picture; draw it like any sprite (`batch.push(sprite, ...)`). |
| [`VideoTexture`](#class-videotexture) | class | One layer of a 3D `TextureSet` showing a moving picture. |
| [`WATER_BLOCK_AT`](#water_block_at) | constant | Where the water block starts in the uniform table (after the sky's). |
| [`WATER_BLOCK_VEC4S`](#water_block_vec4s) | constant | Vec4s of the whole water block: every style, then one more for settings shared by all. |
| [`WATER_STYLES`](#water_styles) | constant | Water styles a frame can use at once. |
| [`WHITE`](#white) | constant | Opaque white: leaves the sprite's own colours unchanged. |
| [`WebGL2Renderer`](#class-webgl2renderer) | class | Instanced-quad renderer: the whole batch is one draw call. |
| [`WebGL2Renderer3D`](#class-webgl2renderer3d) | class | 3D rendering through WebGL2 (the fallback for WebGPU): the same scene, shading and draw order. |
| [`WebGPURenderer`](#class-webgpurenderer) | class | Same instance buffer and one draw call, through WebGPU. |
| [`WebGPURenderer3D`](#class-webgpurenderer3d) | class | 3D rendering through WebGPU: instanced meshes, depth buffer, optional 4x MSAA. |
| [`addGltfToDrawList`](#addgltftodrawlist) | function | Add everything a loaded model draws to a DrawList3D. |
| [`aimJoint`](#aimjoint) | function | Turn one joint to face a point: its `axis` (a direction in the joint's own space: the way a head looks, a turret fires) is rotated by the shortest turn toward the target. |
| [`ambientFromEnvironment`](#ambientfromenvironment) | function | Colours for the simple lighting that roughly match an environment, so surfaces without a material sit comfortably beside ones that have: the diffuse light facing straight up and straight down. |
| [`applyMeshoptFilter`](#applymeshoptfilter) | function | Apply a filter to decoded vertex data, in place. |
| [`autoMapJoints`](#automapjoints) | function | Match the joints of one skeleton to another by what their names mean (`humanoidKey`). |
| [`bidiClass`](#bidiclass) | function | The bidirectional class of a character: L, R, AL, EN, ES, ET, AN, CS, NSM, BN, B, S, WS, ON, or an explicit formatting class (LRE, LRO, RLE, RLO, PDF, LRI, RLI, FSI, PDI). |
| [`blendPoses`](#blendposes) | function | out = a blended toward b by weight w (0 = a, 1 = b). |
| [`buildChunkMesh`](#buildchunkmesh) | function | Build one chunk's mesh at a level of detail: a grid of vertices every `2^lod` samples, with outward-facing skirts on the four edges. |
| [`buildEnvironment`](#buildenvironment) | function | Turn six faces of linear light into an `Environment`: spherical harmonics for the diffuse light and a prefiltered chain for reflections. |
| [`circleOfConfusion`](#circleofconfusion) | function | How blurred a thing at `distance` from the camera is with depth of field, as the radius in pixels of the disc its points spread into: nothing within `range` of the `focus`, then growing with `aperture` times the distance from the focus relative to the distance from the camera, up to `maxBlur`. |
| [`cleanMaterial`](#cleanmaterial) | function | Check a material and fill in what it leaves out, so the renderers always get the same complete shape. |
| [`computeNormals`](#computenormals) | function | Smooth vertex normals from positions and indices (area-weighted average of the faces around each vertex). |
| [`computeSdf`](#computesdf) | function | Turn a coverage image into a signed distance field byte image. |
| [`computeShadowMatrix`](#computeshadowmatrix) | function | The matrix that takes world positions to the shadow map's clip space (depth 0..1), for a camera and a light. |
| [`createBox`](#createbox) | function | An axis-aligned box centred on the origin with flat-shaded faces. |
| [`createCapsule`](#createcapsule) | function | An upright capsule (a cylinder with hemispherical ends): `height` is the total height. |
| [`createCylinder`](#createcylinder) | function | An upright cylinder (axis along y, centred on the origin) with capped ends. |
| [`createDecal`](#createdecal) | function | Make a decal mesh. |
| [`createGltfMorph`](#creategltfmorph) | function | Make the morph targets of a loaded instance usable: a `MorphTargets` with a mesh of its own (draw `morph.mesh`, for example through the `meshes` map of `addGltfToDrawList`), starting at the weights the file gives. |
| [`createLighting`](#createlighting) | function | The default lighting of a 3D scene: one directional light, a sky/ground hemisphere of ambient light, fog, and any number of point lights. |
| [`createLod`](#createlod) | function | Bundle levels of detail. |
| [`createMesh`](#createmesh) | function | Wrap vertex data into a Mesh (computing the bounds). |
| [`createMeshFromTriangles`](#createmeshfromtriangles) | function | A flat-shaded mesh from raw triangles (9 numbers each: a, b, c), e.g. |
| [`createPlane`](#createplane) | function | A flat grid in the xz plane facing +y, centred on the origin. |
| [`createRenderer`](#createrenderer) | function | Create the best available renderer, falling back automatically: WebGPU -> WebGL2 -> Canvas2D (override with `prefer`). |
| [`createRenderer3D`](#createrenderer3d) | function | Create the best available 3D renderer, falling back automatically: WebGPU -> WebGL2 (Canvas2D cannot draw 3D). |
| [`createSkinnedMesh`](#createskinnedmesh) | function | A mesh that follows a skeleton: every vertex is pulled by up to four joints, by weight. |
| [`createSky`](#createsky) | function | Fill in a sky. |
| [`createSphere`](#createsphere) | function | A UV sphere with smooth normals. |
| [`createWaterMesh`](#createwatermesh) | function | A flat grid of water. |
| [`createWaterStyle`](#createwaterstyle) | function | Describe a kind of water. |
| [`cubeDirection`](#cubedirection) | function | The direction a texel of a cube face looks at (not normalised). |
| [`decodeImageInBrowser`](#decodeimageinbrowser) | function | Decode an encoded image (PNG, JPEG, ...) to RGBA pixels with the browser's own decoder. |
| [`decodeIndexBuffer`](#decodeindexbuffer) | function | Decode compressed triangle indices. |
| [`decodeIndexSequence`](#decodeindexsequence) | function | Decode a compressed sequence of indices (not triangles: for lines, points or any list of indices). |
| [`decodeMeshoptBufferView`](#decodemeshoptbufferview) | function | Decode one compressed glTF buffer view (`EXT_meshopt_compression`): `mode` says what it holds, and a filter, if any, is applied after. |
| [`decodeVertexBuffer`](#decodevertexbuffer) | function | Decode a compressed vertex buffer. |
| [`drawFitted`](#drawfitted) | function | Draw a source into the box (x, y, w, h) of a 2D context, over a background colour. |
| [`drawParagraph`](#drawparagraph) | function | Put a laid-out paragraph into a sprite batch. |
| [`drawTileMap`](#drawtilemap) | function | Add a tile map to a sprite batch, for the chunks the camera sees. |
| [`environmentBrdf`](#environmentbrdf) | function | How much of the light from all around a surface of this roughness, seen at this angle, reflects: Karis' analytic approximation, as `A` and `B` so that the reflected share for a surface with F0 is `F0 * A + B`. |
| [`environmentFromImage`](#environmentfromimage) | function | An environment from a picture wrapped round the sky (an "equirectangular" panorama: the whole sky in one picture twice as wide as it is tall), like the ones sold as HDRIs. |
| [`environmentIrradiance`](#environmentirradiance) | function | The diffuse light a surface facing `n` receives from the environment (colour, linear light): what the shaders compute from the spherical harmonics. |
| [`fbm`](#fbm) | function | Fractal noise: several octaves of `valueNoise`, each finer and fainter, between 0 and 1. |
| [`filterColor`](#filtercolor) | function | A colour as [r, g, b, a] in 0..1. |
| [`fitRect`](#fitrect) | function | How to place a `srcW` x `srcH` picture in a `w` x `h` box: `cover` fills the box and crops the picture, `contain` shows all of the picture with bars, `stretch` squeezes it to fit. |
| [`fromPremultiplied`](#frompremultiplied) | function | Canvas pixel data (RGBA bytes, not premultiplied) from premultiplied float pixels. |
| [`graphemes`](#graphemes) | function | Split text into user-perceived characters (a base letter with its accents, an emoji sequence, a Hangul syllable...). |
| [`humanoidKey`](#humanoidkey) | function | What body part a joint name means, in a form that matches across naming schemes (Mixamo's `mixamorig:LeftUpLeg`, Unity's `LeftUpperLeg`, Blender's `thigh.L`, 3ds Max's `Bip01 L Thigh`, VRM's `J_Bip_L_UpperLeg` all give `upleg.l`). |
| [`isShaped`](#isshaped) | function | Does this character belong to a script that must be shaped as a word? |
| [`layoutParagraph`](#layoutparagraph) | function | Lay out a list of atoms (one paragraph: no line breaks). |
| [`levelBytes`](#levelbytes) | function | How many bytes one mip level of a picture takes in a format. |
| [`lightPixel`](#lightpixel) | function | The lighting at one pixel, as the shader computes it: the factor that multiplies the picture's colour, and the shine that is added. |
| [`lightType`](#lighttype) | function | What kind of light this is: `'area'` if it says so, `'spot'` if it has a `direction` (or says so), otherwise `'point'`. |
| [`linearToSrgb`](#lineartosrgb) | function | Linear light to sRGB (0..1). |
| [`linkBoxes`](#linkboxes) | function | The boxes of the parts of a layout with a `link` style: `[{ link, x, y, w, h }]`, one per line a link covers (world units from the layout's top left), for hit testing. |
| [`loadEnvironment`](#loadenvironment) | function | Fetch a panorama and make an environment from it: a Radiance `.hdr` file is read as it is (the best choice: it keeps the sun bright), a PNG or JPEG is decoded by the browser. |
| [`loadGltf`](#loadgltf) | function | Fetch and parse a glTF or GLB, loading the external `.bin` files a `.gltf` refers to. |
| [`loadGltfMaterials`](#loadgltfmaterials) | function | Turn the materials a model uses into physically based materials of a `MaterialSet` (the one you give the renderer with `setMaterials`). |
| [`loadGltfTextures`](#loadgltftextures) | function | Decode the images a model uses (every kind of picture its materials refer to, and the base colour pictures of simply lit instances) and add them to a texture set (resampled to its size). |
| [`lodLevel`](#lodlevel) | function | Which level of a `Lod` to draw at a given screen size (the thing's height as a fraction of the view's), or -1 for none. |
| [`mergeMeshes`](#mergemeshes) | function | Bake placed meshes into one mesh in world space: positions go through each `model`, normals through its inverse transpose (so squashed things light correctly), and a mirrored placement (a negative scale) has its triangles turned back round. |
| [`meshTriangles`](#meshtriangles) | function | The triangles of a mesh as nine numbers each (three corners), placed in the world. |
| [`mirrored`](#mirrored) | function | The mirror image of a bracket or quote for drawing in right-to-left text ("(" becomes ")"), or the character itself. |
| [`mulTint`](#multint) | function | Multiply two packed tints channel by channel (a colour in markup times the tint you draw with). |
| [`nearestLights`](#nearestlights) | function | The lights that matter most to a viewpoint, for when a scene has more than `MAX_POINT_LIGHTS`: the nearest ones (by distance to the edge of each light's reach). |
| [`needsBidi`](#needsbidi) | function | Does this text contain anything that reads right to left or controls direction (so it needs the algorithm)? |
| [`needsEngine`](#needsengine) | function | Does a string need the engine (right-to-left, shaping, or clusters of more than one character)? |
| [`packInstancesForLight`](#packinstancesforlight) | function | Copy into `staging` (rows of `floats` numbers, from row `startRow`) the instances of the draw list's groups that could put anything into the map of one light matrix: an instance is left out only when its bounding sphere lies wholly outside the box the matrix covers, sideways, so the finished map is the same as if everything had been drawn. |
| [`packLighting`](#packlighting) | function | Turn the lighting into the numbers the shaders read, in canvas pixels. |
| [`packTint`](#packtint) | function | Pack 0..255 channel values into the tint word. |
| [`paintSplat`](#paintsplat) | function | Paint on a splat map with a round brush: push the pixels under it toward one of the four pictures. |
| [`parseBmfont`](#parsebmfont) | function | Read a BMFont descriptor in any of its three forms. |
| [`parseColor`](#parsecolor) | function | Parse `#rgb`, `#rrggbb`, `#rrggbbaa` or a colour name into a packed tint (see `packTint`), or null. |
| [`parseGltf`](#parsegltf) | function | Parse a glTF or GLB. |
| [`parseHdr`](#parsehdr) | function | Read a Radiance `.hdr` file (RGBE, flat or run-length encoded), the format HDR panoramas are usually shared in, into floating-point colours for `environmentFromImage`. |
| [`parseKtx2`](#parsektx2) | function | Read a KTX2 file. |
| [`parseMarkup`](#parsemarkup) | function | Read the markup into a list of styled stretches. |
| [`pbrAmbient`](#pbrambient) | function | The light from all around (the hemisphere of sky and ground), as seen by a surface: its diffuse part, and its specular part (the sky reflected in it, scaled by an analytic approximation of how much a surface of this roughness and angle reflects). |
| [`pbrAmbientEnvironment`](#pbrambientenvironment) | function | What a surface receives from an `Environment` (see `environment.js`): the diffuse light, from the spherical harmonics, and the specular part, the environment reflected at a blur that matches the roughness, scaled by how much a surface like this reflects. |
| [`pbrLight`](#pbrlight) | function | What one light contributes to a point of a surface: the diffuse part and the specular part (GGX), both already multiplied by the light's colour and the cosine of its angle. |
| [`planFilters`](#planfilters) | function | Turn a list of filters into passes over three pictures ("registers"). |
| [`planLocalShadows`](#planlocalshadows) | function | Decide which lights get shadow maps this frame. |
| [`poseFromRagdoll`](#posefromragdoll) | function | Draw a ragdoll with a skeleton: copies how each ragdoll body has turned from its rest orientation onto the matching joint (joints are paired with bones by name, as in retargeting), and moves the hips with the body. |
| [`poseToRagdoll`](#posetoragdoll) | function | Start a ragdoll from an animated pose: puts each body where the matching joint of `pose` has its bone (`ragdoll.setBone`), clears the spin and gives every body `velocity` (the speed the character was moving at, so it carries on that way). |
| [`proceduralSkyEnvironment`](#proceduralskyenvironment) | function | A small cube of the sky for lighting and reflections (hand it to `renderer.setEnvironment`). |
| [`proceduralTexture`](#proceduraltexture) | function | Make one of the built-in tileable textures. |
| [`ragdollSpecFromSkeleton`](#ragdollspecfromskeleton) | function | Fit a ragdoll description to a skeleton: takes `base` (from `humanoidRagdollSpec`, giving the bones, radii, masses and joint types) and moves every bone to where the skeleton's own joints are at rest (a bone runs from its joint to its child's; the head, hands and feet use a fixed length where the skeleton has no joint to end at). |
| [`reorder`](#reorder) | function | Reorder a line (L2): the indices of the characters from left to right on screen, given their levels. |
| [`resolveBidi`](#resolvebidi) | function | Resolve the directions in a line of text. |
| [`resolveLocalShadowOptions`](#resolvelocalshadowoptions) | function | Fill in defaults and check ranges. |
| [`resolvePostOptions`](#resolvepostoptions) | function | Fill in defaults and check ranges. |
| [`retargetClip`](#retargetclip) | function | Make a copy of an animation clip for another skeleton: the clip is sampled `fps` times a second, each pose retargeted (`retargetPose`), and a rotation track written for every destination joint that has a counterpart (and a translation track for the hips). |
| [`retargetPose`](#retargetpose) | function | Copy the movement of a pose of one skeleton onto another. |
| [`ringVisibility`](#ringvisibility) | function | The fraction of a light that reaches distance `d` along direction (dx, dy), from one light's shadow ring: 1 lit, 0 in shadow, soft at the edges. |
| [`rotateForEnvironment`](#rotateforenvironment) | function | A direction turned about the vertical axis, the way the renderers turn the environment when `lighting.environment.rotation` is set: the environment is rotated by `yaw` radians (counter-clockwise seen from above), which is the same as looking up the world's direction rotated the other way. |
| [`runFilters`](#runfilters) | function | Run a plan on the CPU: the reference the shaders are checked against, and the Canvas2D fallback. |
| [`sampleEnvironment`](#sampleenvironment) | function | The colour of the environment in a direction, from one level of the chain (a fractional `lod` blends two levels; 0 is the sharp environment, `maxLod` the roughest). |
| [`samplePose`](#samplepose) | function | Evaluate a clip at a time into `out` (starting from the rest pose, so untouched channels stay at rest). |
| [`sampleWeights`](#sampleweights) | function | Evaluate weight keyframes: `times` ascending seconds and `values` with `count` weights per key, linear between keys (or held with `step`), clamped outside. |
| [`shadowRing`](#shadowring) | function | The first hit on each of `angles` rays from (cx, cy), as a fraction of `radius` (1 = nothing in the way): the shadow map of one light, made the way the shader makes it. |
| [`simplifyMesh`](#simplifymesh) | function | Make a coarser copy of a mesh by vertex clustering: the mesh is cut into a grid of cells, the vertices in a cell become one (their average), triangles that collapse to a line or a point are dropped. |
| [`skyColor`](#skycolor) | function | The colour shown for a direction: the radiance with the sky's exposure applied and squeezed into 0..1 (`1 - exp(-radiance * exposure)`), still in linear light. |
| [`skyEnvironment`](#skyenvironment) | function | A sky made from a few colours and a sun, with no picture needed: the colours blend from the horizon up to the zenith and down to the ground, and the sun is a bright soft disc. |
| [`skyLighting`](#skylighting) | function | The lighting settings that go with a sky: the direct light (the sun by day, the moon at night), the ambient light from the sky above and the ground below, and a fog colour of the horizon. |
| [`skyRadiance`](#skyradiance) | function | The light from a direction, in linear light before the sky's exposure (so it can be above 1 near the sun). |
| [`solveChain`](#solvechain) | function | Reach a target with a chain of joints, each the child of the one before (FABRIK: the chain is pulled to the target from its tip and then pinned back to its root, a few times over). |
| [`solveTwoBone`](#solvetwobone) | function | Reach a target with a three-joint limb (an arm: shoulder, elbow, wrist; a leg: hip, knee, ankle) by the exact two-bone solution: the limb bends at the middle joint, in the plane that holds the pole point, and stretches straight toward a target that is out of reach (it never overextends or folds past straight). |
| [`sortKey`](#sortkey) | function | Sort key for layered, depth-sorted 2D scenes: higher layers draw on top; within a layer, larger `y` (lower on screen, nearer the viewer in a top-down view) draws on top. |
| [`sourceSize`](#sourcesize) | function | The size of a picture source in pixels (0 x 0 until a video knows its size). |
| [`splatMap`](#splatmap) | function | A splat map for a heightmap: for every pixel, how much of each of four pictures shows (red, green, blue, alpha; they add up to 255). |
| [`spotAngles`](#spotangles) | function | The spot cone's half-angle in radians (default 0.7), and where its soft edge starts as a fraction of it (`penumbra`, default 0.3). |
| [`srgbToLinear`](#srgbtolinear) | function | sRGB (0..1) to linear light. |
| [`stripMarkup`](#stripmarkup) | function | The text with the markup taken out. |
| [`sunColor`](#suncolor) | function | How much of the sun's light gets to the ground, per colour (1 in a perfectly clear sky overhead; reddish and weak near the horizon; 0 when the sun is below it). |
| [`sunDirection`](#sundirection) | function | Where the sun is: a unit vector toward it, for a time of day and place. |
| [`textureFormatInfo`](#textureformatinfo) | function | What a renderer needs to hold a texture set of a format: the WebGPU format and feature, the WebGL2 extension and internal format, and the block size in pixels and bytes. |
| [`tileMapFromTiled`](#tilemapfromtiled) | function | Make a tile map from a Tiled map in JSON (File > Export As > JSON). |
| [`tileOrientation`](#tileorientation) | function | The turn (in quarter turns clockwise) and mirror that draw a tile with these flip flags; exported for tests. |
| [`toPremultiplied`](#topremultiplied) | function | Premultiplied float pixels (4 per pixel) from canvas pixel data (RGBA bytes, not premultiplied). |
| [`uniformEnvironment`](#uniformenvironment) | function | An environment made of one colour all round: a white one lights a surface to its own colour from every side. |
| [`valueNoise`](#valuenoise) | function | Smooth value noise in two dimensions, between 0 and 1: the same for the same seed on every machine. |
| [`visualRuns`](#visualruns) | function | A line as runs in drawing order: `[{ text, level, rtl, start, end }]` from left to right, each a stretch of characters of one level, with the characters of a right-to-left run already in visual order (reversed, mirrored brackets). |
| [`waterHeightAt`](#waterheightat) | function | The surface of the water at a point and time: its height above the water's level and its upward unit normal (from the waves; fine ripples are left out). |
| [`writeSkyBlock`](#writeskyblock) | function | Write the sky's numbers (eight vec4s) into a renderer's uniform table: sun and its brightness; haze, air, forward scattering, exposure; ground colour and the cosine of the sun's size; cloud coverage, density, scale, brightness; cloud offset, star brightness, time; moon direction and brightness; the moon's edge cosines and size and whether there are clouds; the sun's colour and whether there is a moon. |
| [`writeWaterBlock`](#writewaterblock) | function | Write the water styles (and how reflections are found) into a renderer's uniform table. |

## Functions

### `addGltfToDrawList`

```js
function addGltfToDrawList(list, model, transform = IDENTITY, palettes = {}, textureLayers = new Map(), materialIds = new Map(), meshes = new Map())
```

Add everything a loaded model draws to a DrawList3D. Skinned meshes are drawn in their bind pose unless you pass palettes.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `list` | `import('./drawlist.js').DrawList3D` |  |
| `model` | `GltfResult` |  |
| `transform` (optional) | `ArrayLike<number>` | Placement of the whole model (column-major 4x4) |
| `palettes` (optional) | `Record<number, Float32Array>` | Skinning matrices per skin index (from `skeleton.computePalette(pose)`) |
| `textureLayers` (optional) | `Map<number, number>` | From `loadGltfTextures`: which layer holds each image; instances whose image is not in it are drawn without a texture |
| `meshes` (optional) | `Map<GltfInstance, import('./mesh.js').Mesh>` | A mesh to draw in place of an instance's own, for morphed models: `new Map([[instance, morph.mesh]])` |
| `materialIds` (optional) | `Map<number, number>` | From `loadGltfMaterials`: instances whose material is in it are drawn with physically based lighting (the renderer needs the same set, `renderer.setMaterials`) |

<sub>src/gltf.js:578</sub>

### `aimJoint`

```js
function aimJoint(skeleton, pose, joint, target, { axis = [0, 0, 1], weight = 1, limit = Math.PI } = {})
```

Turn one joint to face a point: its `axis` (a direction in the joint's own space: the way a head looks, a turret fires) is rotated by the shortest turn toward the target.
`limit` caps how far, in radians, the joint may turn from where the pose has it, so a head follows a target over the shoulder only so far; `weight` fades the effect.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `skeleton` | `import('./skeleton.js').Skeleton` |  |
| `pose` | `import('./skeleton.js').Pose` |  |
| `joint` | `number` |  |
| `target` | `ArrayLike<number>` |  |
| `o` (optional) | `{axis?: ArrayLike<number>, weight?: number, limit?: number}` | `axis` default [0, 0, 1] (the way glTF characters face). |

**Returns** `{angle: number, limited: boolean}` — How far the joint turned, and whether the limit held it back.

<sub>src/ik.js:172</sub>

### `ambientFromEnvironment`

```js
function ambientFromEnvironment(env, intensity = 1)
```

Colours for the simple lighting that roughly match an environment, so surfaces without a material sit comfortably beside ones that have: the diffuse light facing straight up and straight down.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `env` | `Environment` |  |
| `intensity` (optional) | `number` |  |

**Returns** `{ambientSky: number[], ambientGround: number[]}`

<sub>src/environment.js:404</sub>

### `applyMeshoptFilter`

```js
function applyMeshoptFilter(bytes, count, stride, filter)
```

Apply a filter to decoded vertex data, in place.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array` | the decoded vertices |
| `count` | `number` | vertices |
| `stride` | `number` | bytes per vertex |
| `filter` | `'NONE' \| 'OCTAHEDRAL' \| 'QUATERNION' \| 'EXPONENTIAL' \| 'COLOR'` |  |

<sub>src/meshopt.js:389</sub>

### `autoMapJoints`

```js
function autoMapJoints(src, dst, overrides = {})
```

Match the joints of one skeleton to another by what their names mean (`humanoidKey`). `overrides` maps source joint names to destination joint names for the ones that need help.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `src` | `import('./skeleton.js').Skeleton` |  |
| `dst` | `import('./skeleton.js').Skeleton` |  |
| `overrides` (optional) | `Record<string, string>` |  |

**Returns** `Int16Array` — For each source joint, the destination joint it drives, or -1.

<sub>src/ik.js:240</sub>

### `bidiClass`

```js
function bidiClass(cp)
```

The bidirectional class of a character: L, R, AL, EN, ES, ET, AN, CS, NSM, BN, B, S, WS, ON, or an explicit formatting class (LRE, LRO, RLE, RLO, PDF, LRI, RLI, FSI, PDI).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `cp` | `number` |  |

<sub>src/bidi.js:18</sub>

### `blendPoses`

```js
function blendPoses(out, a, b, w)
```

out = a blended toward b by weight w (0 = a, 1 = b). Rotations take the short way round. `out` may be `a`.

<sub>src/skeleton.js:221</sub>

### `buildChunkMesh`

```js
function buildChunkMesh(map, chunk, lod, chunkCells, skirt)
```

Build one chunk's mesh at a level of detail: a grid of vertices every `2^lod` samples, with outward-facing skirts on the four edges.

<sub>src/terrain.js:438</sub>

### `buildEnvironment`

```js
function buildEnvironment(faces, size)
```

Turn six faces of linear light into an `Environment`: spherical harmonics for the diffuse light and a prefiltered chain for reflections.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `faces` | `Float32Array[]` | six cube faces of `size` x `size` RGB floats |
| `size` | `number` |  |

**Returns** `Environment`

<sub>src/environment.js:342</sub>

### `circleOfConfusion`

```js
function circleOfConfusion(distance, { focus, range = 0, aperture = 1, maxBlur = 8 })
```

How blurred a thing at `distance` from the camera is with depth of field, as the radius in pixels of the disc its points spread into: nothing within `range`
of the `focus`, then growing with `aperture` times the distance from the focus relative to the distance from the camera, up to `maxBlur`. This is what the shaders compute.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `distance` | `number` |  |
| `dof` | `{focus: number, range?: number, aperture?: number, maxBlur?: number}` |  |

<sub>src/post.js:113</sub>

### `cleanMaterial`

```js
function cleanMaterial(spec = {})
```

Check a material and fill in what it leaves out, so the renderers always get the same complete shape.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `MaterialSpec` |  |

**Returns** `Required<MaterialSpec>`

<sub>src/materials.js:67</sub>

### `computeNormals`

```js
function computeNormals(positions, indices)
```

Smooth vertex normals from positions and indices (area-weighted average of the faces around each vertex).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `positions` | `ArrayLike<number>` | x, y, z per vertex |
| `indices` | `ArrayLike<number>` |  |

**Returns** `Float32Array` — nx, ny, nz per vertex

<sub>src/mesh.js:218</sub>

### `computeSdf`

```js
function computeSdf(coverage, w, h, spread, out = new Uint8Array(w * h))
```

Turn a coverage image into a signed distance field byte image.

Each output byte encodes the distance to the glyph outline: 128 is exactly on the edge, 255 is `spread` pixels or more
inside, 0 is `spread` pixels or more outside. A shader recovers a sharp, anti-aliased edge at any scale by thresholding
around 0.5 with a width taken from the screen-space derivative.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `coverage` | `ArrayLike<number>` | w*h values 0..255 (alpha of the rasterised glyph); >= 128 counts as inside. |
| `w` | `number` |  |
| `h` | `number` |  |
| `spread` | `number` | Distance range in pixels on each side of the edge that is encoded. |
| `out` (optional) | `Uint8Array` | w*h bytes |

**Returns** `Uint8Array`

<sub>src/sdf.js:56</sub>

### `computeShadowMatrix`

```js
function computeShadowMatrix(out, camera, lightDirection, { size, radius })
```

The matrix that takes world positions to the shadow map's clip space (depth 0..1), for a camera and a light.
The box is moved in whole texels so shadows do not shimmer as the camera moves.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `out` | `Float64Array \| Float32Array` | 16 floats |
| `camera` | `import('./camera3d.js').Camera3D` |  |
| `lightDirection` | `ArrayLike<number>` | Direction TO the light (any length) |
| `opts` | `{size: number, radius: number}` |  |

**Returns** `number` — Size of one shadow texel in metres

<sub>src/shadow.js:46</sub>

### `createBox`

```js
function createBox(sx = 1, sy = 1, sz = 1)
```

An axis-aligned box centred on the origin with flat-shaded faces.

<sub>src/mesh.js:95</sub>

### `createCapsule`

```js
function createCapsule(radius = 0.4, height = 1.8, segments = 20, rings = 8)
```

An upright capsule (a cylinder with hemispherical ends): `height` is the total height. Handy for characters.

<sub>src/mesh.js:166</sub>

### `createCylinder`

```js
function createCylinder(radius = 0.5, height = 1, segments = 24)
```

An upright cylinder (axis along y, centred on the origin) with capped ends.

<sub>src/mesh.js:147</sub>

### `createDecal`

```js
function createDecal(triangles, { position, normal = [0, 1, 0], size = 1, depth = 1, rotation = 0, offset = 0.01, maxAngle = 80, uvRect = [0, 0, 1, 1], name = 'decal' })
```

Make a decal mesh.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `triangles` | `ArrayLike<number>` | The surface to stick it to: nine numbers per triangle, counter-clockwise from outside, in the world (`Heightmap.toTriangles`, `meshTriangles`, a collision world's triangles). |
| `o` | `object` |  |
| `o.position` | `number[]` | Where the middle of the decal's box is. |
| `o.normal` (optional) | `number[]` | The way the decal faces (away from the surface it lands on); the picture is projected along it. Default up. |
| `o.size` (optional) | `number \| number[]` | Width and height in metres (one number for a square). |
| `o.depth` (optional) | `number` | How far the box reaches along the normal in total, in metres: surfaces further than half of it from `position` are left alone. |
| `o.rotation` (optional) | `number` | Radians to turn the picture about the normal. |
| `o.offset` (optional) | `number` | Metres the decal is lifted off the surface, so it does not flicker against it. |
| `o.maxAngle` (optional) | `number` | Surfaces turned more than this many degrees away from the decal's facing are skipped (a decal on a wall does not wrap onto the floor behind it). Default 80. |
| `o.uvRect` (optional) | `number[]` | [u0, v0, u1, v1]: which part of the texture to use (an atlas cell). |
| `o.name` (optional) | `string` |  |

**Returns** `import('./mesh.js').Mesh \| null` — `null` if the box holds no surface.

<sub>src/decal.js:56</sub>

### `createGltfMorph`

```js
function createGltfMorph(instance)
```

Make the morph targets of a loaded instance usable: a `MorphTargets` with a mesh of its own (draw `morph.mesh`, for example through the `meshes` map of `addGltfToDrawList`),
starting at the weights the file gives. Make one per character so each can have its own expression.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `instance` | `GltfInstance` | An entry of `model.instances` that has a `morph` |

**Returns** `MorphTargets`

<sub>src/gltf.js:607</sub>

### `createLighting`

```js
function createLighting()
```

The default lighting of a 3D scene: one directional light, a sky/ground hemisphere of ambient light, fog, and any number of point lights.

<sub>src/drawlist.js:31</sub>

### `createLod`

```js
function createLod({ mesh, ratios, screens, levels, cullBelow = 0, name } = {})
```

Bundle levels of detail. `levels` run from the most detailed: each says the screen size (the height of the thing as a fraction of the height of the view,
0..1) *below which* it is replaced by the next one. The last level is used all the way down to `cullBelow`, under which nothing is drawn. Or give `ratios` and a
mesh and the levels are made for you with `simplifyMesh`.

```js
const tree = createLod({ mesh: highTree, ratios: [0.35, 0.12], screens: [0.25, 0.08], cullBelow: 0.01 });
// levels: highTree while taller than a quarter of the screen, 35% of its triangles from 25% down to 8%, 12% below that, nothing under 1%
list.addLod(tree, model);
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` | `{mesh?: import('./mesh.js').Mesh, ratios?: number[], screens?: number[], levels?: {mesh: import('./mesh.js').Mesh, below?: number}[], cullBelow?: number, name?: string}` |  |

**Returns** `Lod`

<sub>src/lod.js:137</sub>

### `createMesh`

```js
function createMesh(vertices, indices, name = 'mesh', uv = undefined)
```

Wrap vertex data into a Mesh (computing the bounds).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `vertices` | `Float32Array \| number[]` | interleaved position and normal |
| `indices` | `Uint32Array \| number[]` |  |
| `name` (optional) | `string` |  |
| `uv` (optional) | `ArrayLike<number>` | 2 floats per vertex |

<sub>src/mesh.js:28</sub>

### `createMeshFromTriangles`

```js
function createMeshFromTriangles(triangles, count = Math.floor(triangles.length / 9), name = 'triangles')
```

A flat-shaded mesh from raw triangles (9 numbers each: a, b, c), e.g. the collision geometry of a `TriWorld`.
Every triangle gets its own three vertices so each face is shaded by its own normal.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `triangles` | `ArrayLike<number>` |  |
| `count` (optional) | `number` | Number of triangles (default: all of `triangles`) |

<sub>src/mesh.js:193</sub>

### `createPlane`

```js
function createPlane(width = 1, depth = 1, segmentsX = 1, segmentsZ = 1)
```

A flat grid in the xz plane facing +y, centred on the origin.

<sub>src/mesh.js:116</sub>

### `createRenderer`

```js
async function createRenderer({ atlas, prefer = ['webgpu', 'webgl2', 'canvas2d'], createCanvas = defaultCreateCanvas, transparent = false, filter = 'linear' })
```

Create the best available renderer, falling back automatically:
WebGPU -> WebGL2 -> Canvas2D (override with `prefer`).

A canvas is locked to the first context type requested from it, so every
attempt gets a fresh canvas from `createCanvas`. Append `renderer.canvas` to the page.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.atlas` | `import('./atlas.js').Atlas` |  |
| `o.prefer` (optional) | `('webgpu'\|'webgl2'\|'canvas2d')[]` |  |
| `o.createCanvas` (optional) | `() => HTMLCanvasElement` |  |
| `o.transparent` (optional) | `boolean` | Give the canvas an alpha channel (cleared to transparent by default) so it can be stacked over another canvas, e.g. a 2D HUD over a 3D view. |
| `o.filter` (optional) | `'linear' \| 'nearest'` | `'nearest'` draws scaled sprites with hard pixels (pixel art); default `'linear'`. Scalable (SDF) text needs linear. |

**Returns** `Promise<WebGPURenderer \| WebGL2Renderer \| Canvas2DRenderer>` — `renderer.kind` says which one won.

<sub>src/create.js:22</sub>

### `createRenderer3D`

```js
async function createRenderer3D({ prefer = ['webgpu', 'webgl2'], antialias = true, water = false, createCanvas = defaultCreateCanvas } = {})
```

Create the best available 3D renderer, falling back automatically: WebGPU -> WebGL2 (Canvas2D cannot draw 3D). Each
attempt gets a fresh canvas because a canvas is locked to its first context type; append `renderer.canvas` to the page.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.prefer` (optional) | `('webgpu'\|'webgl2')[]` |  |
| `o.antialias` (optional) | `boolean` | Multisample anti-aliasing (default on). |
| `o.water` (optional) | `boolean` | Compile the water shading (`list.setWater`, `lighting.water`). Off by default because WebGL2 pays for it in shader compile time even when no water is drawn; WebGPU ignores it. |
| `o.createCanvas` (optional) | `() => HTMLCanvasElement` |  |

**Returns** `Promise<WebGPURenderer3D \| WebGL2Renderer3D>` — `renderer.kind` says which one won.

<sub>src/create3d.js:17</sub>

### `createSkinnedMesh`

```js
function createSkinnedMesh(vertices, indices, joints, weights, jointCount, name = 'skinned', uv = undefined)
```

A mesh that follows a skeleton: every vertex is pulled by up to four joints, by weight. Draw it with
`DrawList3D.addSkinned` and the palette from `Skeleton.computePalette`. The vertices are the rest (bind) pose.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `vertices` | `Float32Array \| number[]` | interleaved position and normal, as for `createMesh` |
| `indices` | `Uint32Array \| number[]` |  |
| `joints` | `ArrayLike<number>` | 4 joint indices per vertex (use weight 0 for unused slots) |
| `weights` | `ArrayLike<number>` | 4 weights per vertex; normalised here so they sum to 1 |
| `jointCount` | `number` | Number of joints in the skeleton (at most 255) |
| `name` (optional) | `string` |  |
| `uv` (optional) | `ArrayLike<number>` | Texture coordinates, 2 per vertex |

<sub>src/mesh.js:61</sub>

### `createSky`

```js
function createSky({ sun = [0.3, 0.6, 0.45], sunIntensity = 22, sunSize = 0.01, turbidity = 3, rayleigh = 1, mieG = 0.76, exposure = 1.5, ground = [0.18, 0.16, 0.13], clouds = false, stars = false, moon = false, time = 0 } = {})
```

Fill in a sky.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{sun?: number[], sunIntensity?: number, sunSize?: number, turbidity?: number, rayleigh?: number, mieG?: number, exposure?: number, ground?: number[], clouds?: boolean \| object, stars?: boolean \| object, moon?: boolean \| object, time?: number}` | `clouds`: `true` or `{ coverage 0..1 (0.4), density 0..1 (0.9), scale (1.5: bigger is smaller clouds), brightness (1), wind [x, y] per second (0.004, 0.0015) }`. `stars`: `true` or `{ brightness }`. `moon`: `true` or `{ direction, size (0.012), brightness (0.9) }`. |

**Returns** `Sky`

<sub>src/sky.js:49</sub>

### `createSphere`

```js
function createSphere(radius = 0.5, segments = 24, rings = 16)
```

A UV sphere with smooth normals.

<sub>src/mesh.js:127</sub>

### `createWaterMesh`

```js
function createWaterMesh({ x0, z0, x1, z1, level = 0, cell = 2, ground, depth = 10, name = 'water' })
```

A flat grid of water. Each point carries the water's depth there (in the texture coordinate `uv.x`, metres) so the shaders can colour the shallows and froth the shore.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` | `{x0: number, z0: number, x1: number, z1: number, level?: number, cell?: number, ground?: (x: number, z: number) => number, depth?: number, name?: string}` | `level`: the water's height. `cell`: metres between points (smaller means the shore is drawn more exactly). `ground`: the height of the ground at a point (so depth is `level - ground`), or give a constant `depth`. |

**Returns** `import('./mesh.js').Mesh`

<sub>src/water.js:79</sub>

### `createWaterStyle`

```js
function createWaterStyle(o = {})
```

Describe a kind of water.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `Partial<WaterStyle>` |  |

**Returns** `WaterStyle`

<sub>src/water.js:45</sub>

### `cubeDirection`

```js
function cubeDirection(face, sc, tc, out = [0, 0, 0])
```

The direction a texel of a cube face looks at (not normalised).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `face` | `number` | 0 to 5, in `CUBE_FACES` order |
| `sc` | `number` | across the face, -1 to 1 (left to right) |
| `tc` | `number` | down the face, -1 to 1 (top to bottom) |
| `out` (optional) | `number[]` |  |

<sub>src/environment.js:36</sub>

### `decodeImageInBrowser`

```js
async function decodeImageInBrowser(bytes, mimeType)
```

Decode an encoded image (PNG, JPEG, ...) to RGBA pixels with the browser's own decoder.

<sub>src/gltf.js:503</sub>

### `decodeIndexBuffer`

```js
function decodeIndexBuffer(count, stride, source)
```

Decode compressed triangle indices.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `count` | `number` | indices (a multiple of 3) |
| `stride` | `number` | bytes per index: 2 or 4 |
| `source` | `Uint8Array` |  |

**Returns** `Uint8Array` — `count * stride` bytes

<sub>src/meshopt.js:162</sub>

### `decodeIndexSequence`

```js
function decodeIndexSequence(count, stride, source)
```

Decode a compressed sequence of indices (not triangles: for lines, points or any list of indices).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `count` | `number` | indices |
| `stride` | `number` | bytes per index: 2 or 4 |
| `source` | `Uint8Array` |  |

**Returns** `Uint8Array` — `count * stride` bytes

<sub>src/meshopt.js:270</sub>

### `decodeMeshoptBufferView`

```js
function decodeMeshoptBufferView({ count, byteStride, mode, filter }, source)
```

Decode one compressed glTF buffer view (`EXT_meshopt_compression`): `mode` says what it holds, and a filter, if any, is applied after.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `{count: number, byteStride: number, mode: 'ATTRIBUTES' \| 'TRIANGLES' \| 'INDICES', filter?: string}` | the extension's own fields |
| `source` | `Uint8Array` | the compressed bytes |

**Returns** `Uint8Array`

<sub>src/meshopt.js:404</sub>

### `decodeVertexBuffer`

```js
function decodeVertexBuffer(count, stride, source)
```

Decode a compressed vertex buffer.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `count` | `number` | vertices |
| `stride` | `number` | bytes per vertex (a multiple of 4, at most 256) |
| `source` | `Uint8Array` | the compressed bytes |

**Returns** `Uint8Array` — `count * stride` bytes

<sub>src/meshopt.js:125</sub>

### `drawFitted`

```js
function drawFitted(ctx, source, x, y, w, h, fit = 'cover', background = '#000')
```

Draw a source into the box (x, y, w, h) of a 2D context, over a background colour.

<sub>src/video.js:39</sub>

### `drawParagraph`

```js
function drawParagraph(batch, layout, x, y, { tint = 0xffffffff, key = 0, visible = Infinity, time = 0, white = null, atomOffset = 0 } = {})
```

Put a laid-out paragraph into a sprite batch.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `batch` | `import('./batch.js').SpriteBatch` |  |
| `layout` | `ReturnType<typeof layoutParagraph>` |  |
| `x` | `number` |  |
| `y` | `number` | Top-left of the layout. |
| `o` (optional) | `{tint?: number, key?: number, visible?: number, time?: number, white?: any, snap?: boolean, atomOffset?: number}` | `visible`: only this many atoms are drawn (a typewriter reveal), `time`: seconds, for animated effects, `white`: an all-white sprite for underlines. |

<sub>src/textlayout.js:172</sub>

### `drawTileMap`

```js
function drawTileMap(batch, map, camera, { time = 0, key = 0 } = {})
```

Add a tile map to a sprite batch, for the chunks the camera sees.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `batch` | `import('./batch.js').SpriteBatch` |  |
| `map` | `TileMap` |  |
| `camera` | `import('./camera.js').Camera` |  |
| `o` (optional) | `object` |  |
| `o.time` (optional) | `number` | Seconds, for animated tiles (use game time so a paused game freezes them) |
| `o.key` (optional) | `number` | Sort key of the first layer; each layer after it is one more, so a map's layers sit among your own sprites (see `sortKey`) |

**Returns** `number` — the number of tiles added

<sub>src/tilemap.js:282</sub>

### `environmentBrdf`

```js
function environmentBrdf(rough, nv)
```

How much of the light from all around a surface of this roughness, seen at this angle, reflects: Karis' analytic approximation, as `A` and `B` so that the
reflected share for a surface with F0 is `F0 * A + B`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `rough` | `number` | 0 to 1 |
| `nv` | `number` | cosine of the angle between the normal and the eye |

**Returns** `[number, number]`

<sub>src/materials.js:196</sub>

### `environmentFromImage`

```js
function environmentFromImage(image, { size = 64, intensity = 1 } = {})
```

An environment from a picture wrapped round the sky (an "equirectangular" panorama: the whole sky in one picture twice as wide as it is tall), like the ones sold as HDRIs.
RGBA bytes (a PNG or JPEG decoded by the browser) are read as sRGB and turned into linear light; a `Float32Array` of RGB or RGBA (from `parseHdr`) is used as it is, which is what keeps a
bright sun bright. The -z direction is in the middle of the picture.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `image` | `{width: number, height: number, data: ArrayLike<number>}` |  |
| `o` (optional) | `{size?: number, intensity?: number}` | `size`: texels per cube side (default 64); `intensity`: multiplies everything (default 1) |

**Returns** `Environment`

<sub>src/environment.js:133</sub>

### `environmentIrradiance`

```js
function environmentIrradiance(env, n)
```

The diffuse light a surface facing `n` receives from the environment (colour, linear light): what the shaders compute from the spherical harmonics.
A white environment of brightness 1 gives 1 in every direction.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `env` | `Environment` |  |
| `n` | `number[]` | unit normal |

**Returns** `number[]`

<sub>src/environment.js:364</sub>

### `fbm`

```js
function fbm(x, y, { seed = 0, octaves = 5, lacunarity = 2, persistence = 0.5, ridged = false } = {})
```

Fractal noise: several octaves of `valueNoise`, each finer and fainter, between 0 and 1.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `x` | `number` |  |
| `y` | `number` |  |
| `o` (optional) | `{seed?: number, octaves?: number, lacunarity?: number, persistence?: number, ridged?: boolean}` |  |

<sub>src/terrain.js:47</sub>

### `filterColor`

```js
function filterColor(c)
```

A colour as [r, g, b, a] in 0..1. Accepts a packed tint (see `packTint`), `#rgb`, `#rrggbb`, `#rrggbbaa`, or an array of 3 or 4 numbers in 0..1.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `c` | `number \| string \| number[]` |  |

**Returns** `number[]`

<sub>src/filters.js:38</sub>

### `fitRect`

```js
function fitRect(srcW, srcH, w, h, fit = 'cover')
```

How to place a `srcW` x `srcH` picture in a `w` x `h` box: `cover` fills the box and crops the picture, `contain` shows all of the picture with bars, `stretch`
squeezes it to fit. Returns the part of the source and the part of the box to draw with `drawImage`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `srcW` | `number` |  |
| `srcH` | `number` |  |
| `w` | `number` |  |
| `h` | `number` |  |
| `fit` (optional) | `VideoFit` |  |

<sub>src/video.js:27</sub>

### `fromPremultiplied`

```js
function fromPremultiplied(f, out = new Uint8ClampedArray(f.length))
```

Canvas pixel data (RGBA bytes, not premultiplied) from premultiplied float pixels.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `f` | `Float32Array` |  |
| `out` (optional) | `Uint8ClampedArray` |  |

<sub>src/filters.js:180</sub>

### `graphemes`

```js
function graphemes(text)
```

Split text into user-perceived characters (a base letter with its accents, an emoji sequence, a Hangul syllable...).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `text` | `string` |  |

**Returns** `string[]`

<sub>src/textlayout.js:20</sub>

### `humanoidKey`

```js
function humanoidKey(name)
```

What body part a joint name means, in a form that matches across naming schemes (Mixamo's `mixamorig:LeftUpLeg`, Unity's `LeftUpperLeg`, Blender's `thigh.L`, 3ds Max's `Bip01 L Thigh`,
VRM's `J_Bip_L_UpperLeg` all give `upleg.l`). Returns null for a joint it does not know (a prop, a twist bone, a helper).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |

**Returns** `string \| null`

<sub>src/ik.js:212</sub>

### `isShaped`

```js
function isShaped(cp)
```

Does this character belong to a script that must be shaped as a word?

**Parameters**

| Name | Type | Description |
|---|---|---|
| `cp` | `number` |  |

<sub>src/textlayout.js:30</sub>

### `layoutParagraph`

```js
function layoutParagraph(atoms, { maxWidth = Infinity, direction = 'auto', align, lineSpacing = 1, indent = 0 } = {})
```

Lay out a list of atoms (one paragraph: no line breaks).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `atoms` | `Atom[]` |  |
| `o` (optional) | `{maxWidth?: number, direction?: 'auto' \| 'ltr' \| 'rtl', align?: 'left' \| 'center' \| 'right', lineSpacing?: number, indent?: number}` |  |

**Returns** `{items: LayoutItem[], lines: {start: number, end: number, width: number, height: number, ascent: number, y: number, x: number}[], width: number, height: number, paragraphRtl: boolean}`

<sub>src/textlayout.js:63</sub>

### `levelBytes`

```js
function levelBytes(format, width, height)
```

How many bytes one mip level of a picture takes in a format.

<sub>src/ktx2.js:50</sub>

### `lightPixel`

```js
function lightPixel(pack, px, py, normal, { ring, maskAt } = {})
```

The lighting at one pixel, as the shader computes it: the factor that multiplies the picture's colour, and the shine that is added. A pixel's `normal` is [x, y, z] in screen
orientation (x right, y down, z toward the viewer), already turned by the sprite's rotation.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `pack` | `ReturnType<typeof packLighting>` |  |
| `px` | `number` |  |
| `py` | `number` | Pixel position (continuous). |
| `normal` | `number[]` |  |
| `lookups` (optional) | `{ring?: (row: number) => Float32Array, maskAt?: (x: number, y: number) => number}` | `ring(row)`: the shadow ring of a light; `maskAt`: occluder alpha. |

**Returns** `{light: number[], shine: number[]}`

<sub>src/lighting.js:162</sub>

### `lightType`

```js
function lightType(light)
```

What kind of light this is: `'area'` if it says so, `'spot'` if it has a `direction` (or says so), otherwise `'point'`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `light` | `{type?: string, direction?: ArrayLike<number>}` |  |

<sub>src/shadow.js:140</sub>

### `linearToSrgb`

```js
function linearToSrgb(c)
```

Linear light to sRGB (0..1).

<sub>src/materials.js:150</sub>

### `linkBoxes`

```js
function linkBoxes(layout)
```

The boxes of the parts of a layout with a `link` style: `[{ link, x, y, w, h }]`, one per line a link covers (world units from the layout's top left), for hit testing.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `layout` | `ReturnType<typeof layoutParagraph>` |  |

<sub>src/textlayout.js:219</sub>

### `loadEnvironment`

```js
async function loadEnvironment(url, { size = 64, intensity = 1, fetchImpl = globalThis.fetch, decode = decodeImageInBrowser } = {})
```

Fetch a panorama and make an environment from it: a Radiance `.hdr` file is read as it is (the best choice: it keeps the sun bright), a PNG or JPEG is decoded by the browser.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `url` | `string` |  |
| `o` (optional) | `{size?: number, intensity?: number, fetchImpl?: typeof fetch, decode?: (bytes: Uint8Array, mimeType: string) => Promise<{width: number, height: number, data: ArrayLike<number>}>}` | `decode` is for tests and other hosts (default: the browser's own decoder) |

**Returns** `Promise<Environment>`

<sub>src/environment.js:159</sub>

### `loadGltf`

```js
async function loadGltf(url, fetchImpl = globalThis.fetch)
```

Fetch and parse a glTF or GLB, loading the external `.bin` files a `.gltf` refers to.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `url` | `string` |  |
| `fetchImpl` (optional) | `typeof fetch` |  |

**Returns** `Promise<GltfResult>`

<sub>src/gltf.js:477</sub>

### `loadGltfMaterials`

```js
function loadGltfMaterials(model, textureLayers, set)
```

Turn the materials a model uses into physically based materials of a `MaterialSet` (the one you give the renderer with `setMaterials`). Pass the layers
`loadGltfTextures` returned so the pictures are found. A material is added once however many meshes use it.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `model` | `GltfResult` |  |
| `textureLayers` | `Map<number, number>` | From `loadGltfTextures` |
| `set` | `import('./materials.js').MaterialSet` |  |

**Returns** `Map<number, number>` — Material index (and `-1 - index` for the same material without its pictures, for meshes that have no texture coordinates) to the number in the set, to hand to `addGltfToDrawList`

<sub>src/gltf.js:546</sub>

### `loadGltfTextures`

```js
async function loadGltfTextures(model, set, decode = decodeImageInBrowser)
```

Decode the images a model uses (every kind of picture its materials refer to, and the base colour pictures of simply lit instances) and add them to a texture set
(resampled to its size). One image used twice is added once.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `model` | `GltfResult` |  |
| `set` | `import('./textures.js').TextureSet` |  |
| `decode` (optional) | `(bytes: Uint8Array, mimeType: string) => Promise<import('./textures.js').ImageLike>` | Default: the browser's decoder |

**Returns** `Promise<Map<number, number>>` — image index -> texture layer, to hand to `addGltfToDrawList`

<sub>src/gltf.js:521</sub>

### `lodLevel`

```js
function lodLevel(lod, size, bias = 1)
```

Which level of a `Lod` to draw at a given screen size (the thing's height as a fraction of the view's), or -1 for none. `bias` above 1 prefers coarser levels
(it scales the size down), below 1 finer ones.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `lod` | `Lod` |  |
| `size` | `number` |  |
| `bias` (optional) | `number` |  |

<sub>src/lod.js:159</sub>

### `mergeMeshes`

```js
function mergeMeshes(parts, name = 'merged')
```

Bake placed meshes into one mesh in world space: positions go through each `model`, normals through its inverse transpose (so squashed things light correctly),
and a mirrored placement (a negative scale) has its triangles turned back round. Texture coordinates are kept (pieces without any get (0, 0); if none has any, the
result has none).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `parts` | `{mesh: import('./mesh.js').Mesh, model: ArrayLike<number>}[]` |  |
| `name` (optional) | `string` |  |

**Returns** `import('./mesh.js').Mesh`

<sub>src/merge.js:18</sub>

### `meshTriangles`

```js
function meshTriangles(mesh, matrix = null)
```

The triangles of a mesh as nine numbers each (three corners), placed in the world.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `mesh` | `import('./mesh.js').Mesh` |  |
| `matrix` (optional) | `ArrayLike<number> \| null` | Column-major 4x4 placement, or null for none. |

**Returns** `Float32Array`

<sub>src/decal.js:25</sub>

### `mirrored`

```js
function mirrored(cp)
```

The mirror image of a bracket or quote for drawing in right-to-left text ("(" becomes ")"), or the character itself.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `cp` | `number` |  |

<sub>src/bidi.js:65</sub>

### `mulTint`

```js
function mulTint(a, b)
```

Multiply two packed tints channel by channel (a colour in markup times the tint you draw with).

<sub>src/textlayout.js:40</sub>

### `nearestLights`

```js
function nearestLights(lights, x, y, z, max = MAX_POINT_LIGHTS)
```

The lights that matter most to a viewpoint, for when a scene has more than `MAX_POINT_LIGHTS`: the nearest ones (by distance to
the edge of each light's reach). Returns a new array; the input is left alone.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `lights` | `{x: number, y: number, z: number, radius: number}[]` |  |

<sub>src/drawlist.js:22</sub>

### `needsBidi`

```js
function needsBidi(text)
```

Does this text contain anything that reads right to left or controls direction (so it needs the algorithm)? Cheap to call for every line.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `text` | `string` |  |

<sub>src/bidi.js:56</sub>

### `needsEngine`

```js
function needsEngine(text)
```

Does a string need the engine (right-to-left, shaping, or clusters of more than one character)? Plain Latin text does not.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `text` | `string` |  |

<sub>src/textlayout.js:32</sub>

### `packInstancesForLight`

```js
function packInstancesForLight(groups, matrix, floats, staging, startRow, margin = 0.02)
```

Copy into `staging` (rows of `floats` numbers, from row `startRow`) the instances of the draw list's groups that could put anything into the map of one light matrix: an instance is
left out only when its bounding sphere lies wholly outside the box the matrix covers, sideways, so the finished map is the same as if everything had been drawn. This is for the
sun's orthographic cascades, where most of a big world is outside the small box round the camera.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `groups` | `Map<any, {data: Float32Array, count: number}>` | the draw list's groups, by mesh |
| `matrix` | `ArrayLike<number>` | world to the light's clip space |
| `floats` | `number` | numbers in an instance |
| `staging` | `Float32Array` | big enough for every instance |
| `startRow` | `number` |  |
| `margin` (optional) | `number` | extra room round the box, in clip units |

**Returns** `{parts: {mesh: any, row: number, count: number}[], rows: number}` — the runs of rows written, one run for each mesh that has any

<sub>src/shadow.js:75</sub>

### `packLighting`

```js
function packLighting(lighting, camera, { dpr = 1, width, height, hasOccluders = false, hasNormals = false, out = new Float32Array(LIGHTING_UNIFORM_FLOATS) } = {})
```

Turn the lighting into the numbers the shaders read, in canvas pixels.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `lighting` | `Lighting2D` |  |
| `camera` | `import('./camera.js').Camera` |  |
| `o` | `{dpr?: number, width: number, height: number, hasOccluders?: boolean, hasNormals?: boolean, out?: Float32Array}` | `width` and `height` are the canvas size in pixels. |

**Returns** `{data: Float32Array, count: number, shadowRows: {x: number, y: number, radius: number}[], sun: boolean, dropped: number}`

<sub>src/lighting.js:75</sub>

### `packTint`

```js
function packTint(r, g, b, a = 255)
```

Pack 0..255 channel values into the tint word.

<sub>src/batch.js:20</sub>

### `paintSplat`

```js
function paintSplat(splat, size, map, x, z, radius, layer, strength = 0.5)
```

Paint on a splat map with a round brush: push the pixels under it toward one of the four pictures.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `splat` | `Uint8ClampedArray` | The map from `splatMap`. |
| `size` | `number` | Its side in pixels. |
| `map` | `Heightmap` |  |
| `x` | `number` | World x. |
| `z` | `number` | World z. |
| `radius` | `number` | Metres. |
| `layer` | `0 \| 1 \| 2 \| 3` | Which picture to paint. |
| `strength` (optional) | `number` | 0..1 per call at the centre. |

**Returns** `{x0: number, y0: number, x1: number, y1: number} \| null` — The changed pixels (to upload again with `TextureSet.update`).

<sub>src/terrain.js:295</sub>

### `parseBmfont`

```js
function parseBmfont(source)
```

Read a BMFont descriptor in any of its three forms.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `source` | `string \| object` | The `.fnt` text, its XML, or JSON text / an object. |

**Returns** `{info: {face: string, size: number}, common: {lineHeight: number, base: number, scaleW: number, scaleH: number}, pages: string[], chars: Map<number, {x: number, y: number, width: number, height: number, xoffset: number, yoffset: number, xadvance: number, page: number}>, kernings: Map<number, number>}`

<sub>src/bitmapfont.js:26</sub>

### `parseColor`

```js
function parseColor(text)
```

Parse `#rgb`, `#rrggbb`, `#rrggbbaa` or a colour name into a packed tint (see `packTint`), or null.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `text` | `string` |  |

<sub>src/richtext.js:26</sub>

### `parseGltf`

```js
function parseGltf(input, { buffers: external = {} } = {})
```

Parse a glTF or GLB.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `input` | `ArrayBuffer \| string \| object` | A GLB (ArrayBuffer), glTF JSON text, or an already parsed glTF object. |
| `o` (optional) | `object` |  |
| `o.buffers` (optional) | `Record<string, ArrayBuffer>` | External `.bin` files by their `uri` (data: URIs are decoded automatically). |

**Returns** `GltfResult`

<sub>src/gltf.js:220</sub>

### `parseHdr`

```js
function parseHdr(input)
```

Read a Radiance `.hdr` file (RGBE, flat or run-length encoded), the format HDR panoramas are usually shared in, into floating-point colours for `environmentFromImage`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `input` | `ArrayBuffer \| Uint8Array` |  |

**Returns** `{width: number, height: number, data: Float32Array}` — RGB floats, top row first

<sub>src/environment.js:186</sub>

### `parseKtx2`

```js
async function parseKtx2(input)
```

Read a KTX2 file.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `input` | `ArrayBuffer \| Uint8Array` |  |

**Returns** `Promise<{width: number, height: number, format: string, gpuFormat: string, srgb: boolean, vkFormat: number, levels: Uint8Array[]}>` — `levels[0]` is the full size picture, then each half the size; each is the bytes of that level in `format`.

<sub>src/ktx2.js:70</sub>

### `parseMarkup`

```js
function parseMarkup(source)
```

Read the markup into a list of styled stretches. An unknown tag is kept as text, a closing tag that matches nothing is dropped, and tags still open at the end are closed.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `source` | `string` |  |

**Returns** `{text: string, style: object, image?: {name: string, w?: number, h?: number, valign?: string, dy?: number}}[]` — In reading order; `style` is a fresh object for each stretch.

<sub>src/richtext.js:42</sub>

### `pbrAmbient`

```js
function pbrAmbient(s, n, v, sky, ground)
```

The light from all around (the hemisphere of sky and ground), as seen by a surface: its diffuse part, and its specular part (the sky
reflected in it, scaled by an analytic approximation of how much a surface of this roughness and angle reflects).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `s` | `{baseColor: number[], metallic: number, roughness: number}` |  |
| `n` | `number[]` | unit normal |
| `v` | `number[]` | unit vector to the eye |
| `sky` | `number[]` | ambient sky colour (linear) |
| `ground` | `number[]` | ambient ground colour (linear) |

**Returns** `{diffuse: number[], specular: number[]}`

<sub>src/materials.js:239</sub>

### `pbrAmbientEnvironment`

```js
function pbrAmbientEnvironment(s, n, v, env, { intensity = 1, rotation = 0 } = {})
```

What a surface receives from an `Environment` (see `environment.js`): the diffuse light, from the spherical harmonics, and the specular part, the environment reflected at a
blur that matches the roughness, scaled by how much a surface like this reflects. The same maths as the shaders, for tests and tools.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `s` | `{baseColor: number[], metallic: number, roughness: number}` |  |
| `n` | `number[]` | unit normal |
| `v` | `number[]` | unit vector to the eye |
| `env` | `import('./environment.js').Environment` |  |
| `settings` (optional) | `{intensity?: number, rotation?: number}` | as in `lighting.environment` |

**Returns** `{diffuse: number[], specular: number[]}`

<sub>src/materials.js:213</sub>

### `pbrLight`

```js
function pbrLight(s, n, v, l, radiance)
```

What one light contributes to a point of a surface: the diffuse part and the specular part (GGX), both already multiplied by the
light's colour and the cosine of its angle. Colours are in linear light. A light colour of 1 lights a white matte surface to full white
(the same convention as the simple lighting, so the two kinds of surface sit together in one scene).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `s` | `{baseColor: number[], metallic: number, roughness: number}` | the surface: linear base colour, metallic, roughness |
| `n` | `number[]` | unit normal |
| `v` | `number[]` | unit vector to the eye |
| `l` | `number[]` | unit vector to the light |
| `radiance` | `number[]` | the light's colour times its intensity (and shadow) |

**Returns** `{diffuse: number[], specular: number[]}`

<sub>src/materials.js:166</sub>

### `planFilters`

```js
function planFilters(filters, { scale = 1 } = {})
```

Turn a list of filters into passes over three pictures ("registers"). Register 0 holds the drawn group at the start. Each pass reads one or two registers, writes another, and has a block
of uniforms; `result` says where the finished picture is.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `filters` | `object[]` |  |
| `o` (optional) | `{scale?: number}` | `scale`: pixels per CSS pixel |

**Returns** `{passes: {mode: number, inputs: number[], output: number, u: Float32Array}[], result: number}`

<sub>src/filters.js:110</sub>

### `planLocalShadows`

```js
function planLocalShadows(lights, camera, budget)
```

Decide which lights get shadow maps this frame. Lights with `castShadow` (point and spot ones: area lights cast none) are taken nearest the camera first
(by the distance to the edge of their reach), each given the layers it needs, until the budget runs out; a light that does not fit is skipped and the next
smaller one tried.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `lights` | `{x: number, y: number, z: number, radius: number, castShadow?: boolean, type?: string, direction?: ArrayLike<number>}[]` |  |
| `camera` | `{x: number, y: number, z: number}` |  |
| `budget` | `number` | Layers available |

**Returns** `{slots: Int32Array, layers: {light: number, face: number}[]}` — `slots[i]` is light i's first layer, or -1; `layers` lists every layer in order

<sub>src/shadow.js:159</sub>

### `poseFromRagdoll`

```js
function poseFromRagdoll(skeleton, pose, ragdoll)
```

Draw a ragdoll with a skeleton: copies how each ragdoll body has turned from its rest orientation onto the matching joint (joints are paired with bones by name, as in retargeting),
and moves the hips with the body. Joints with no bone (fingers, a tail, twist bones) keep the rest pose relative to their parent (they go along with it rigidly). `ragdoll` is a `Ragdoll` from `@engine/physics` (anything with the same `names`, `modelRotationDelta`, `modelJointPosition` and `rest` will do), and the skeleton and the
ragdoll are taken to share a model space (feet on the ground, facing the same way).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `skeleton` | `import('./skeleton.js').Skeleton` |  |
| `pose` | `import('./skeleton.js').Pose` | Overwritten: every joint takes the rest pose, then the paired ones what the bodies say. |
| `ragdoll` | `{names: string[], modelRotationDelta(i: number): number[], modelJointPosition(i: number): number[], rest: {from: number[]}[]}` |  |

**Returns** `import('./skeleton.js').Pose` — `pose`

<sub>src/ik.js:343</sub>

### `poseToRagdoll`

```js
function poseToRagdoll(skeleton, pose, ragdoll, { velocity } = {})
```

Start a ragdoll from an animated pose: puts each body where the matching joint of `pose` has its bone (`ragdoll.setBone`), clears the spin and gives every body `velocity` (the speed the
character was moving at, so it carries on that way). Then add the ragdoll to the world (or leave it there asleep) and stop playing the animation.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `skeleton` | `import('./skeleton.js').Skeleton` |  |
| `pose` | `import('./skeleton.js').Pose` |  |
| `ragdoll` | `{names: string[], setBone(i: number, delta: number[], from: number[]): void, clearSpin(): void, setLinearVelocity(x: number, y: number, z: number): void}` |  |
| `o` (optional) | `{velocity?: number[]}` |  |

<sub>src/ik.js:384</sub>

### `proceduralSkyEnvironment`

```js
function proceduralSkyEnvironment(sky, size = 32)
```

A small cube of the sky for lighting and reflections (hand it to `renderer.setEnvironment`). It leaves out the sun's disc, because the sun lights things as a direct light, and the clouds,
stars and moon, which are too fine for a cube this size; make a new one when the sun has moved a good deal (once a minute of game time is plenty).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `sky` | `Sky` |  |
| `size` (optional) | `number` | 16 to 128, a power of two. |

<sub>src/sky.js:212</sub>

### `proceduralTexture`

```js
function proceduralTexture(kind, size = 256, { seed = 1, cells = 8, colors } = {})
```

Make one of the built-in tileable textures. They are bright and fairly neutral, meant to be tinted by the instance colour.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `kind` | `'grass' \| 'brick' \| 'concrete' \| 'plates' \| 'checker' \| 'solid'` |  |
| `size` | `number` |  |
| `o` (optional) | `object` |  |
| `o.seed` (optional) | `number` |  |
| `o.cells` (optional) | `number` | checker: squares per side (default 8) |
| `o.colors` (optional) | `number[]` | checker: two RGB colours 0..1, solid: [r, g, b, a] (defaults: white and mid grey / white) |

**Returns** `ImageLike`

<sub>src/textures.js:175</sub>

### `ragdollSpecFromSkeleton`

```js
function ragdollSpecFromSkeleton(skeleton, base)
```

Fit a ragdoll description to a skeleton: takes `base` (from `humanoidRagdollSpec`, giving the bones, radii, masses and joint types) and moves every bone to where the skeleton's own joints are
at rest (a bone runs from its joint to its child's; the head, hands and feet use a fixed length where the skeleton has no joint to end at). Bones the skeleton has no joint for keep the base positions.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `skeleton` | `import('./skeleton.js').Skeleton` |  |
| `base` | `{bones: {name: string, parent: number, from: number[], to: number[], radius: number, mass: number, joint?: object}[]}` |  |

**Returns** `{bones: object[]}` — A new description; `base` is not changed.

<sub>src/ik.js:398</sub>

### `reorder`

```js
function reorder(levels)
```

Reorder a line (L2): the indices of the characters from left to right on screen, given their levels. Within the highest level, characters are reversed; then each lower level from the top
down to the lowest odd one, reversing every stretch that is at least that deep.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `levels` | `ArrayLike<number>` |  |

**Returns** `number[]`

<sub>src/bidi.js:215</sub>

### `resolveBidi`

```js
function resolveBidi(text, direction = 'auto')
```

Resolve the directions in a line of text.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `text` | `string` | One line (no line breaks). |
| `direction` (optional) | `'auto' \| 'ltr' \| 'rtl'` | The paragraph direction: `'auto'` takes it from the first strong character (default). |

**Returns** `{codePoints: number[], levels: Uint8Array, paragraphLevel: number, order: number[], types: string[]}` — `codePoints` (formatting characters removed), the embedding `levels`, and `order`: the indices of `codePoints` from the left of the screen to the right.

<sub>src/bidi.js:86</sub>

### `resolveLocalShadowOptions`

```js
function resolveLocalShadowOptions(opts = {})
```

Fill in defaults and check ranges.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `opts` (optional) | `LocalShadowOptions \| true` |  |

<sub>src/shadow.js:131</sub>

### `resolvePostOptions`

```js
function resolvePostOptions(o = {}, camera = null)
```

Fill in defaults and check ranges.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `PostOptions \| true` |  |
| `camera` (optional) | `{ortho?: number}` | An orthographic camera has no use for the depth effects: they are turned off. |

<sub>src/post.js:40</sub>

### `retargetClip`

```js
function retargetClip(clip, srcSkeleton, dstSkeleton, { map, overrides, fps = 30, translation = true, name } = {})
```

Make a copy of an animation clip for another skeleton: the clip is sampled `fps` times a second, each pose retargeted (`retargetPose`), and a rotation track written for every
destination joint that has a counterpart (and a translation track for the hips). Loop, duration and events carry over.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `clip` | `AnimationClip` |  |
| `srcSkeleton` | `import('./skeleton.js').Skeleton` |  |
| `dstSkeleton` | `import('./skeleton.js').Skeleton` |  |
| `o` (optional) | `{map?: Int16Array \| number[], overrides?: Record<string, string>, fps?: number, translation?: boolean, name?: string}` |  |

**Returns** `AnimationClip`

<sub>src/ik.js:303</sub>

### `retargetPose`

```js
function retargetPose(srcSkeleton, srcPose, dstSkeleton, out, map = autoMapJoints(srcSkeleton, dstSkeleton), { translation = true } = {})
```

Copy the movement of a pose of one skeleton onto another. Each mapped joint gets the *change from rest* the source joint has in the world, applied to its own rest orientation, so
rigs whose rest poses differ (A-pose against T-pose, bones pointing along different axes) still move the same way. Joints with no counterpart stay at rest. The hips (the
mapped joints with no mapped parent) also copy the source's movement, scaled by how much taller or shorter the destination's hips are, so a short character does not slide.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `srcSkeleton` | `import('./skeleton.js').Skeleton` |  |
| `srcPose` | `import('./skeleton.js').Pose` |  |
| `dstSkeleton` | `import('./skeleton.js').Skeleton` |  |
| `out` | `import('./skeleton.js').Pose` | The destination pose, overwritten. |
| `map` (optional) | `Int16Array \| number[]` | From `autoMapJoints` (the default, made here: pass it in when retargeting many frames). |
| `o` (optional) | `{translation?: boolean}` | `translation: false` keeps the hips where the destination rest has them. |

<sub>src/ik.js:270</sub>

### `ringVisibility`

```js
function ringVisibility(ring, radius, dx, dy, d, size, angles = SHADOW_ANGLES)
```

The fraction of a light that reaches distance `d` along direction (dx, dy), from one light's shadow ring: 1 lit, 0 in shadow, soft at the edges.

<sub>src/lighting.js:141</sub>

### `rotateForEnvironment`

```js
function rotateForEnvironment(d, yaw)
```

A direction turned about the vertical axis, the way the renderers turn the environment when `lighting.environment.rotation` is set: the environment is rotated by `yaw` radians
(counter-clockwise seen from above), which is the same as looking up the world's direction rotated the other way.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `d` | `number[]` |  |
| `yaw` | `number` |  |

**Returns** `number[]`

<sub>src/environment.js:393</sub>

### `runFilters`

```js
function runFilters(plan, pixels, w, h)
```

Run a plan on the CPU: the reference the shaders are checked against, and the Canvas2D fallback. Slow (every pixel in JavaScript), but exact.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `plan` | `ReturnType<typeof planFilters>` |  |
| `pixels` | `Float32Array` | Premultiplied float RGBA (see `toPremultiplied`); not changed. |
| `w` | `number` |  |
| `h` | `number` |  |

**Returns** `Float32Array` — The finished picture, premultiplied.

<sub>src/filters.js:205</sub>

### `sampleEnvironment`

```js
function sampleEnvironment(env, dir, lod = 0)
```

The colour of the environment in a direction, from one level of the chain (a fractional `lod` blends two levels; 0 is the sharp environment, `maxLod` the roughest).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `env` | `Environment` |  |
| `dir` | `number[]` |  |
| `lod` (optional) | `number` |  |

**Returns** `number[]`

<sub>src/environment.js:378</sub>

### `samplePose`

```js
function samplePose(skeleton, clip, time, out)
```

Evaluate a clip at a time into `out` (starting from the rest pose, so untouched channels stay at rest).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `skeleton` | `Skeleton` |  |
| `clip` | `AnimationClip` |  |
| `time` | `number` | Seconds (wrapped or clamped according to `clip.loop`) |
| `out` | `Pose` |  |

<sub>src/skeleton.js:197</sub>

### `sampleWeights`

```js
function sampleWeights(times, values, count, time, out, step = false)
```

Evaluate weight keyframes: `times` ascending seconds and `values` with `count` weights per key, linear between keys (or held with `step`), clamped outside.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `times` | `ArrayLike<number>` |  |
| `values` | `ArrayLike<number>` |  |
| `count` | `number` | Weights per key |
| `time` | `number` |  |
| `out` | `Float32Array` | At least `count` long |
| `step` (optional) | `boolean` |  |

<sub>src/morph.js:116</sub>

### `shadowRing`

```js
function shadowRing(maskAt, cx, cy, radius, angles = SHADOW_ANGLES)
```

The first hit on each of `angles` rays from (cx, cy), as a fraction of `radius` (1 = nothing in the way): the shadow map of one light, made the way the shader makes it.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `maskAt` | `(x: number, y: number) => number` | Occluder alpha 0..1 at a pixel position (continuous, centres at +0.5). |
| `cx` | `number` |  |
| `cy` | `number` |  |
| `radius` | `number` |  |
| `angles` (optional) | `number` |  |

**Returns** `Float32Array`

<sub>src/lighting.js:129</sub>

### `simplifyMesh`

```js
function simplifyMesh(mesh, { ratio, cellSize, keepEdges = false, name } = {})
```

Make a coarser copy of a mesh by vertex clustering: the mesh is cut into a grid of cells, the vertices in a cell become one (their average), triangles that collapse
to a line or a point are dropped. It is fast (linear in the size of the mesh), never fails on messy meshes, and works on skinned meshes (the joints of a cluster's
vertices are blended and the four strongest kept). It rounds off small features and sharp corners as the cells grow, which is what a distant LOD should do.

Give `ratio` (0..1: the fraction of triangles to keep, found by trying cell sizes) or `cellSize` (metres, exactly). Texture seams may smear a little at coarse levels,
and a mesh with hard edges (a box with a normal per face) is rounded off unless you pass `keepEdges: true`, which keeps vertices with very different normals apart
(at the price of fewer triangles saved on smooth surfaces and tiny cracks between clusters).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `mesh` | `import('./mesh.js').Mesh` |  |
| `o` (optional) | `{ratio?: number, cellSize?: number, keepEdges?: boolean, name?: string}` |  |

**Returns** `import('./mesh.js').Mesh`

<sub>src/lod.js:21</sub>

### `skyColor`

```js
function skyColor(dir, sky, out = [0, 0, 0])
```

The colour shown for a direction: the radiance with the sky's exposure applied and squeezed into 0..1 (`1 - exp(-radiance * exposure)`), still in linear light.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `dir` | `number[]` |  |
| `sky` | `Sky` |  |
| `out` (optional) | `number[]` |  |

<sub>src/sky.js:184</sub>

### `skyEnvironment`

```js
function skyEnvironment({ zenith = [0.18, 0.38, 0.85], horizon = [0.72, 0.8, 0.9], ground = [0.16, 0.14, 0.12], sun, size = 64 } = {})
```

A sky made from a few colours and a sun, with no picture needed: the colours blend from the horizon up to the zenith and down to the ground, and the sun is a bright soft disc.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `SkyOptions` |  |

**Returns** `Environment`

<sub>src/environment.js:110</sub>

### `skyLighting`

```js
function skyLighting(sky)
```

The lighting settings that go with a sky: the direct light (the sun by day, the moon at night), the ambient light from the sky above and the ground below, and a fog colour of the horizon.
Spread them over `createLighting()`: `{ ...createLighting(), ...skyLighting(sky), sky }`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `sky` | `Sky` |  |

**Returns** `{direction: number[], color: number[], ambientSky: number[], ambientGround: number[], fogColor: number[]}`

<sub>src/sky.js:196</sub>

### `skyRadiance`

```js
function skyRadiance(dir, sky, out = [0, 0, 0], { details = true, disc = true } = {})
```

The light from a direction, in linear light before the sky's exposure (so it can be above 1 near the sun).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `dir` | `number[]` | A unit vector. |
| `sky` | `Sky` |  |
| `out` (optional) | `number[]` |  |
| `o` (optional) | `{details?: boolean, disc?: boolean}` | `details: false` leaves out clouds, stars and the moon, `disc: false` the sun's disc (for the baked lighting cube). |

**Returns** `number[]`

<sub>src/sky.js:123</sub>

### `solveChain`

```js
function solveChain(skeleton, pose, chain, target, { iterations = 16, tolerance = 1e-4, weight = 1 } = {})
```

Reach a target with a chain of joints, each the child of the one before (FABRIK: the chain is pulled to the target from its tip and then pinned back to its root, a few times over).
The root of the chain stays put and bone lengths are kept; a target out of reach stretches the chain straight toward it. Good for tails, spines, necks, tentacles, ropes and for
arms or legs where you do not need a pole. Edits the rotations of every joint in the chain but the last.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `skeleton` | `import('./skeleton.js').Skeleton` |  |
| `pose` | `import('./skeleton.js').Pose` |  |
| `chain` | `number[]` | Joint numbers from the root of the chain to its tip (at least two). |
| `target` | `ArrayLike<number>` |  |
| `o` (optional) | `{iterations?: number, tolerance?: number, weight?: number}` | `iterations` (16), `tolerance` in model units (1e-4), `weight` 0..1 as for `solveTwoBone`. |

**Returns** `{reached: boolean, distance: number, iterations: number}`

<sub>src/ik.js:131</sub>

### `solveTwoBone`

```js
function solveTwoBone(skeleton, pose, { root, mid, end, target, pole, weight = 1, endRotation })
```

Reach a target with a three-joint limb (an arm: shoulder, elbow, wrist; a leg: hip, knee, ankle) by the exact two-bone solution: the limb bends at the middle joint, in the plane
that holds the pole point, and stretches straight toward a target that is out of reach (it never overextends or folds past straight). Edits the rotations of `root` and `mid` in `pose`.
`mid` must be a child of `root` and `end` a child of `mid`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `skeleton` | `import('./skeleton.js').Skeleton` |  |
| `pose` | `import('./skeleton.js').Pose` |  |
| `o` | `{root: number, mid: number, end: number, target: ArrayLike<number>, pole?: ArrayLike<number>, weight?: number, endRotation?: ArrayLike<number>}` | `target`: where the end joint should go. `pole`: a point the middle joint should bend toward (a knee points forward: put the pole in front of the knee); without it the limb keeps the side it is bent to now. `weight` 0..1: how much of the solution to apply (0 leaves the pose, 1 reaches fully), for fading IK in and out. `endRotation`: a world rotation (quaternion) to give the end joint (a foot lying flat on a slope). |

**Returns** `{reached: boolean, distance: number}` — Whether the target was within reach, and how far from the end joint it now is.

<sub>src/ik.js:90</sub>

### `sortKey`

```js
function sortKey(layer, y = 0)
```

Sort key for layered, depth-sorted 2D scenes: higher layers draw on top; within a layer, larger `y` (lower on
screen, nearer the viewer in a top-down view) draws on top. Keys are 32-bit floats, so keep `layer` below about
200 and |y| below 40,000 for whole-unit precision.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `layer` | `number` |  |
| `y` (optional) | `number` |  |

<sub>src/batch.js:38</sub>

### `sourceSize`

```js
function sourceSize(source)
```

The size of a picture source in pixels (0 x 0 until a video knows its size).

<sub>src/video.js:16</sub>

### `splatMap`

```js
function splatMap(map, { size = 256, rock = { slope: [28, 42] }, sand = null, snow = null, noise = 0.15, noiseScale = 12, seed = 3 } = {})
```

A splat map for a heightmap: for every pixel, how much of each of four pictures shows (red, green, blue, alpha; they add up to 255). By default the first picture (grass) fills the
flat middle ground; the second (rock) takes steep slopes; the third (sand) low ground; the fourth (snow) high ground that is not too steep. Each rule is `{ slope: [from, to] }` in degrees
or `{ height: [from, to] }` in metres, with a smooth fade between the two; leave a rule out to leave that picture out.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `map` | `Heightmap` |  |
| `o` (optional) | `{size?: number, rock?: {slope: number[]}, sand?: {height: number[]}, snow?: {height: number[], slope?: number[]}, noise?: number, noiseScale?: number, seed?: number}` | `size`: pixels per side (use the texture set's size). `noise` 0..1 breaks up the edges between pictures (`noiseScale`: patches per 100 m). |

**Returns** `Uint8ClampedArray` — RGBA bytes, rows from z = the map's origin.

<sub>src/terrain.js:271</sub>

### `spotAngles`

```js
function spotAngles(light)
```

The spot cone's half-angle in radians (default 0.7), and where its soft edge starts as a fraction of it (`penumbra`, default 0.3).

**Returns** `{outer: number, inner: number}`

<sub>src/shadow.js:146</sub>

### `srgbToLinear`

```js
function srgbToLinear(c)
```

sRGB (0..1) to linear light.

<sub>src/materials.js:148</sub>

### `stripMarkup`

```js
function stripMarkup(source)
```

The text with the markup taken out.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `source` | `string` |  |

<sub>src/richtext.js:95</sub>

### `sunColor`

```js
function sunColor(sky)
```

How much of the sun's light gets to the ground, per colour (1 in a perfectly clear sky overhead; reddish and weak near the horizon; 0 when the sun is below it).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `sky` | `Sky` |  |

**Returns** `number[]`

<sub>src/sky.js:109</sub>

### `sunDirection`

```js
function sunDirection({ hour = 12, dayOfYear = 80, latitude = 45 } = {})
```

Where the sun is: a unit vector toward it, for a time of day and place.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{hour?: number, dayOfYear?: number, latitude?: number}` | `hour`: local solar time, 0 to 24 (12 is noon). `dayOfYear`: 1 to 365 (172 is the northern midsummer). `latitude`: degrees, positive north. |

**Returns** `number[]` — East is +x, north is -z, up is +y.

<sub>src/sky.js:67</sub>

### `textureFormatInfo`

```js
function textureFormatInfo(name)
```

What a renderer needs to hold a texture set of a format: the WebGPU format and feature, the WebGL2 extension and internal format, and the block size in pixels and bytes.

<sub>src/ktx2.js:42</sub>

### `tileMapFromTiled`

```js
function tileMapFromTiled(json, { sheet } = {})
```

Make a tile map from a Tiled map in JSON (File > Export As > JSON). Orthogonal maps, finite or infinite, with tile layers (nested in groups too), embedded tilesets with their animations,
layer offsets, parallax, opacity and tint, and flipped tiles are read. Object layers, image layers and other map shapes (hexagonal, isometric) are skipped and named in `warnings`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `json` | `object` | The parsed map |
| `o` | `object` |  |
| `o.sheet` | `(tileset: object) => import('./atlas.js').Sprite` | Gives the atlas sprite holding a tileset's picture (`tileset.image` is the file name from Tiled, `tileset.name` its name) |

**Returns** `{map: TileMap, warnings: string[], layers: Record<string, TileLayer>}`

<sub>src/tilemap.js:348</sub>

### `tileOrientation`

```js
function tileOrientation(gid)
```

The turn (in quarter turns clockwise) and mirror that draw a tile with these flip flags; exported for tests.

<sub>src/tilemap.js:53</sub>

### `toPremultiplied`

```js
function toPremultiplied(data)
```

Premultiplied float pixels (4 per pixel) from canvas pixel data (RGBA bytes, not premultiplied).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `data` | `ArrayLike<number>` |  |

<sub>src/filters.js:174</sub>

### `uniformEnvironment`

```js
function uniformEnvironment(color = [1, 1, 1], size = 16)
```

An environment made of one colour all round: a white one lights a surface to its own colour from every side.

<sub>src/environment.js:170</sub>

### `valueNoise`

```js
function valueNoise(x, y, seed = 0)
```

Smooth value noise in two dimensions, between 0 and 1: the same for the same seed on every machine.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `x` | `number` |  |
| `y` | `number` |  |
| `seed` (optional) | `number` |  |

<sub>src/terrain.js:36</sub>

### `visualRuns`

```js
function visualRuns(text, direction = 'auto')
```

A line as runs in drawing order: `[{ text, level, rtl, start, end }]` from left to right, each a stretch of characters of one level, with the characters of a right-to-left run already in
visual order (reversed, mirrored brackets). Convenient for drawing with something that cannot reorder (a per-glyph renderer).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `text` | `string` |  |
| `direction` (optional) | `'auto' \| 'ltr' \| 'rtl'` |  |

<sub>src/bidi.js:235</sub>

### `waterHeightAt`

```js
function waterHeightAt(x, z, time, style, depth = Infinity)
```

The surface of the water at a point and time: its height above the water's level and its upward unit normal (from the waves; fine ripples are left out). The shaders use these same
waves, so this is where a floating thing should sit.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `x` | `number` |  |
| `z` | `number` |  |
| `time` | `number` | Seconds. |
| `style` | `WaterStyle` |  |
| `depth` (optional) | `number` | Water depth here: waves die away toward the shore (1.5 m and deeper: full). |

**Returns** `{height: number, normal: number[]}`

<sub>src/water.js:63</sub>

### `writeSkyBlock`

```js
function writeSkyBlock(table, at, sky)
```

Write the sky's numbers (eight vec4s) into a renderer's uniform table: sun and its brightness; haze, air, forward scattering, exposure; ground colour and the cosine of the sun's size; cloud
coverage, density, scale, brightness; cloud offset, star brightness, time; moon direction and brightness; the moon's edge cosines and size and whether there are clouds; the sun's colour and whether there is a moon.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `table` | `Float32Array` |  |
| `at` | `number` | The vec4 to start at. |
| `sky` | `Sky` |  |

<sub>src/sky.js:236</sub>

### `writeWaterBlock`

```js
function writeWaterBlock(table, at, styles, mode)
```

Write the water styles (and how reflections are found) into a renderer's uniform table.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `table` | `Float32Array` |  |
| `at` | `number` | The vec4 to start at. |
| `styles` | `WaterStyle[]` |  |
| `mode` | `0 \| 1 \| 2` | Where reflections come from: 0 the scene's own sky and ground colours, 1 the environment, 2 a procedural sky. |

<sub>src/water.js:96</sub>

## Classes

### `class AnimationClip`

```js
class AnimationClip
```

A keyframed animation. Each track drives one channel of one joint: translation (`t`, 3 values per key), rotation (`r`,
4 values, a quaternion) or scale (`s`). Channels without a track keep the rest pose.

#### `AnimationClip.constructor`

```js
constructor(name, tracks, { loop = true, duration, events = [] } = {})
```

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `tracks` | `Track[]` | Key times in seconds, ascending. |
| `o` (optional) | `object` |  |
| `o.loop` (optional) | `boolean` | Wrap around at the end (default true). |
| `o.duration` (optional) | `number` | Default: the latest key time. |
| `o.events` (optional) | `{time: number, name: string, data?: any}[]` | Moments to tell the game about (see `addEvent`) |

#### `AnimationClip.addEvent`

```js
addEvent(time, name, data = null)
```

Mark a moment of the clip to be reported while it plays: a footstep when the foot lands, a swing's hit frame, a sound cue. An `Animator` calls its `onEvent(name, data, clip)`
when the clip's time passes the moment (every lap of a looping clip). Events at the same time fire in the order added.

| Name | Type | Description |
|---|---|---|
| `time` | `number` | Seconds into the clip (0 to its duration) |
| `name` | `string` | What to tell the game |
| `data` (optional) | `any` | Anything you want handed back |

#### `AnimationClip.eventsBetween`

```js
eventsBetween(from, to, fn, includeStart = false)
```

Call `fn(event)` for the events a clip's playback passes going from playback time `from` to `to` (forward only): those after `from` up to and including `to`, and also
those at `from` itself when `includeStart` (the very first moment of a clip). A looping clip reports every lap it crosses; one that does not loop stops at its end.

#### `AnimationClip.wrap`

```js
wrap(time)
```

Time within the clip for a playback time: wrapped when looping, clamped otherwise.

<sub>src/skeleton.js:119</sub>

### `class Animator`

```js
class Animator
```

Plays one clip at a time and cross-fades when you switch. Call `update(dt)` once per frame, then read `pose`.

#### `Animator.constructor`

```js
constructor(skeleton, { rootMotion = null } = {})
```

| Name | Type | Description |
|---|---|---|
| `skeleton` | `Skeleton` |  |
| `o` (optional) | `object` |  |
| `o.rootMotion` (optional) | `{joint: number \| string, axes?: string} \| null` | Take the movement of a joint (the root, usually) out of the animation and report it as `motion` instead, so the game moves the character by it and the feet do not slide. `axes` says which to take: 'xz' (default, walking on the ground), 'xyz' or any of x, y, z. |

#### `Animator.play`

```js
play(clip, { fade = 0.2, speed = 1, restart = false } = {})
```

Switch to a clip (no effect if it is already the current one, unless `restart`).

| Name | Type | Description |
|---|---|---|
| `clip` | `AnimationClip` |  |
| `o` (optional) | `object` |  |
| `o.fade` (optional) | `number` | Cross-fade length in seconds |
| `o.speed` (optional) | `number` | Playback speed multiplier |
| `o.restart` (optional) | `boolean` |  |

#### `Animator.takeRootMotion`

```js
takeRootMotion(clip, from, to, pose)
```

Add the root's movement over a stretch of the clip to `motion`, and hold the root still in the pose.

#### `Animator.rootDisplacement`

```js
rootDisplacement(clip, from, to)
```

#### `Animator.stripRoot`

```js
stripRoot(clip, pose)
```

#### `Animator.update`

```js
update(dt)
```

<sub>src/skeleton.js:235</sub>

### `class Atlas`

```js
class Atlas
```

Sprite storage backed by 2D canvases, in one or more same-sized pages. Sprites are drawn into it by name; when a page
fills up the next page is started automatically (up to `maxPages`), so a game never has to size the atlas exactly.
All pages are drawn in one draw call: renderers keep them as layers of one texture array.

#### `Atlas.constructor`

```js
constructor({ size = 1024, maxPages = 8, createCanvas = defaultCreateCanvas } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.size` (optional) | `number` | Width and height of every page in pixels. |
| `o.maxPages` (optional) | `number` | Most pages the atlas may grow to (texture array layers; keep at or below 64). |
| `o.createCanvas` (optional) | `(w: number, h: number) => any` | Defaults to OffscreenCanvas / a DOM canvas. |

#### `Atlas.canvas`

```js
get canvas
```

The first page's canvas (what a single-page atlas used to expose).

#### `Atlas.ctx`

```js
get ctx
```

The first page's 2D context: handy for measuring text.

#### `Atlas.packer`

```js
get packer
```

#### `Atlas.add`

```js
add(name, w, h, draw, { sdf = false, unlit = false, normal } = {})
```

Allocate a rectangle and let `draw(ctx, x, y, w, h)` paint into it.

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `w` | `number` |  |
| `h` | `number` |  |
| `draw` | `(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void` |  |
| `o` (optional) | `{sdf?: boolean, unlit?: boolean, normal?: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void}` | `sdf`: the pixels are a distance field in the alpha channel (see sdf.js). `unlit`: the sprite ignores 2D lighting. `normal`: paints the sprite's normal map (see `setNormal`). |

**Returns** `Sprite`

#### `Atlas.setNormal`

```js
setNormal(name, draw)
```

Give a sprite a normal map for 2D lighting: `draw(ctx, x, y, w, h)` paints it into the same rectangle on the page's normal-map twin. The usual convention: red is how far the surface
leans right, green how far it leans up the picture, blue straight out (so `rgb(128, 128, 255)` is flat). Paint it opaque. Sprites without one are flat.

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `draw` | `(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void` |  |

#### `Atlas.redraw`

```js
redraw(name, draw)
```

Paint a sprite's rectangle again (a video frame, a minimap, a health bar): clears it, then `draw(ctx, x, y, w, h)` paints. The page is uploaded again by the renderers,
so keep sprites that change every frame on a page of their own (a small atlas) when the other pages are big.

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `draw` | `(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void` |  |

#### `Atlas.clear`

```js
clear()
```

Empty the atlas: every sprite is forgotten and every page is blank again, so a long-running game can start afresh when text has filled it up (see `Font.atlasFull`). Do it between frames,
and give text an atlas of its own, because everything in it goes (anything else must be added again, and every `Font` or `BitmapFont` using it needs `reset()`).

#### `Atlas.get`

```js
get(name)
```

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |

**Returns** `Sprite`

<sub>src/atlas.js:62</sub>

### `class BitmapFont`

```js
class BitmapFont extends LayoutTypeface
```

A font drawn from a picture: BMFont files or a font sheet (see the notes at the top of this file). Same `draw`, `measure`, `wrap` and `width` as `Font`.

#### `BitmapFont.constructor`

```js
constructor(atlas, data, images, { name = data.info.face || 'bitmapfont', size } = {})
```

| Name | Type | Description |
|---|---|---|
| `atlas` | `import('./atlas.js').Atlas` |  |
| `data` | `ReturnType<typeof parseBmfont>` |  |
| `images` | `any[]` | The page pictures (anything `drawImage` takes), by page number. |
| `o` (optional) | `{name?: string, size?: number}` | `name` keeps its glyphs apart from another font's in the atlas; `size` is the size in world units the font draws at (default: its line height in pixels). |

#### `BitmapFont.fromDescriptor`

```js
static fromDescriptor(atlas, descriptor, images, o)
```

Load a BMFont.

| Name | Type | Description |
|---|---|---|
| `atlas` | `import('./atlas.js').Atlas` |  |
| `descriptor` | `string \| object` |  |
| `images` | `any \| any[]` | One picture per page (a single picture for a one-page font). |
| `o` (optional) | `{name?: string, size?: number}` |  |

#### `BitmapFont.fromGrid`

```js
static fromGrid(atlas, image, { cellWidth, cellHeight, chars, columns, margin = 0, spacing = 0, advance, advances = {}, baseline, imageWidth, name = 'grid', size })
```

A font from a sheet of equal cells. `chars` lists the characters in reading order (left to right, top to bottom); cells with no character are skipped. Every glyph advances by
`advance` (default the cell width: a fixed-width font), or give `advances` as a map to make a proportional one.

| Name | Type | Description |
|---|---|---|
| `atlas` | `import('./atlas.js').Atlas` |  |
| `image` | `any` |  |
| `o` | `{cellWidth: number, cellHeight: number, chars: string, columns?: number, margin?: number, spacing?: number, advance?: number, advances?: Record<string, number>, baseline?: number, imageWidth?: number, name?: string, size?: number}` |  |

#### `BitmapFont.glyph`

```js
glyph(cp)
```

The glyph of a character: `{ sprite, advance, ox, oy }` in pixels; a character the font does not have draws as `?` (or nothing).

#### `BitmapFont.reset`

```js
reset()
```

Forget the glyphs cut into the atlas, after `Atlas.clear()`: they are cut again as they are needed.

#### `BitmapFont.kern`

```js
kern(a, b)
```

Kerning between two characters in pixels (usually negative or 0).

#### `BitmapFont.has`

```js
has(cp)
```

Does the font have this character?

<sub>src/bitmapfont.js:59</sub>

### `class Camera`

```js
class Camera
```

2D camera. World units have +x right and +y down (screen-style). `zoom` is
screen pixels per world unit. Viewport size is in CSS pixels.

#### `Camera.constructor`

```js
constructor({ x = 0, y = 0, zoom = 1, viewW = 800, viewH = 600 } = {})
```

#### `Camera.setViewport`

```js
setViewport(w, h)
```

#### `Camera.setScreenSpace`

```js
setScreenSpace(w, h)
```

Make world units equal screen pixels with (0, 0) at the top-left: the camera for HUDs, menus and text overlays.
Call again when the window is resized.

#### `Camera.screen`

```js
static screen(w, h)
```

**Returns** `Camera` — A new screen-space camera (see setScreenSpace).

#### `Camera.follow`

```js
follow(tx, ty, dt, smoothing = 0.001)
```

Ease toward a target, frame-rate independent. `smoothing` is the fraction of the
distance left after one second (0 = snap, 0.001 = very quick, 0.5 = slow).

#### `Camera.shake`

```js
shake(amount, duration)
```

Screen shake in world units, decaying over `duration` seconds.

#### `Camera.update`

```js
update(dt)
```

Advance shake; call once per frame. Rendering only, so it may use Math.random.

#### `Camera.renderX`

```js
get renderX
```

#### `Camera.renderY`

```js
get renderY
```

#### `Camera.uniforms`

```js
uniforms(out = new Float32Array(4))
```

| Name | Type | Description |
|---|---|---|
| `out` (optional) | `Float32Array \| number[]` | 4 values consumed by the shaders: [cx, cy, 2z/vw, -2z/vh]. |

#### `Camera.worldToScreen`

```js
worldToScreen(wx, wy, out = { x: 0, y: 0 })
```

**Returns** `{x: number, y: number}` — CSS pixels relative to the canvas.

#### `Camera.screenToWorld`

```js
screenToWorld(sx, sy, out = { x: 0, y: 0 })
```

**Returns** `{x: number, y: number}`

<sub>src/camera.js:5</sub>

### `class Camera3D`

```js
class Camera3D
```

A perspective camera for first- and third-person views. Right-handed, +y up, looking down -z at yaw 0 and pitch 0
(the conventions of `@engine/math`: `vec3.forward(yaw, pitch)` is the direction it looks).

#### `Camera3D.constructor`

```js
constructor({ x = 0, y = 0, z = 0, yaw = 0, pitch = 0, roll = 0, fovY = 1.1, near = 0.1, far = 1000, viewW = 800, viewH = 600 } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.x` (optional) | `number` |  |
| `o.y` (optional) | `number` |  |
| `o.z` (optional) | `number` | Position. |
| `o.yaw` (optional) | `number` | Radians; positive turns left. |
| `o.pitch` (optional) | `number` | Radians; positive looks up. |
| `o.roll` (optional) | `number` |  |
| `o.fovY` (optional) | `number` | Vertical field of view in radians. |
| `o.near` (optional) | `number` |  |
| `o.far` (optional) | `number` |  |
| `o.viewW` (optional) | `number` | Viewport size in CSS pixels (sets the aspect ratio). |
| `o.viewH` (optional) | `number` |  |

#### `Camera3D.setViewport`

```js
setViewport(w, h)
```

#### `Camera3D.aspect`

```js
get aspect
```

#### `Camera3D.update`

```js
update()
```

Recompute the matrices from the current fields; call once per frame after moving the camera.

#### `Camera3D.sphereVisible`

```js
sphereVisible(x, y, z, radius)
```

Could any part of a sphere be on screen? Conservative: never false for a sphere that touches the view volume (it may be
true for one just outside a corner). Uses the planes of the last `update()`.

#### `Camera3D.sweptSphereVisible`

```js
sweptSphereVisible(x, y, z, radius, dx, dy, dz)
```

Could a sphere that slides along the vector (dx, dy, dz) touch the view at any point of its path? Conservative, like
`sphereVisible`: used to keep objects whose shadow may fall into view.

#### `Camera3D.forward`

```js
forward(out = [0, 0, 0])
```

The unit direction the camera looks.

#### `Camera3D.screenToRay`

```js
screenToRay(sx, sy, origin = [0, 0, 0], dir = [0, 0, 0])
```

The world-space ray through a pixel (CSS pixels from the top-left of the canvas): for picking and aiming.

| Name | Type | Description |
|---|---|---|
| `origin` | `number[]` | Receives the ray start (on the near plane) |
| `dir` | `number[]` | Receives the unit direction |

#### `Camera3D.worldToScreen`

```js
worldToScreen(wx, wy, wz, out = { x: 0, y: 0, depth: 0, visible: false })
```

Project a world point to CSS pixels. `depth` is the distance in front of the camera (negative: behind it, so `visible`
is false and x, y are meaningless).

<sub>src/camera3d.js:7</sub>

### `class Canvas2DRenderer`

```js
class Canvas2DRenderer
```

Last-resort backend: draws each sprite with drawImage. Slowest, but works
everywhere and is handy as a reference when debugging the GPU backends.
Tints are applied by multiplying cached copies of the sprite, matching the shaders.

#### `Canvas2DRenderer.constructor`

```js
constructor(canvas, atlas, { transparent = false, filter = 'linear' } = {})
```

| Name | Type | Description |
|---|---|---|
| `canvas` | `HTMLCanvasElement` |  |
| `atlas` | `import('./atlas.js').Atlas` |  |
| `o` (optional) | `{transparent?: boolean}` | `transparent`: the canvas has an alpha channel, so it can be stacked over another canvas (a HUD over a 3D view). |

#### `Canvas2DRenderer.resize`

```js
resize(cssW, cssH, dpr = 1)
```

#### `Canvas2DRenderer.render`

```js
render({ camera, batch, clear = this.transparent ? [0, 0, 0, 0] : [0.05, 0.05, 0.08, 1], filters, meshes })
```

| Name | Type | Description |
|---|---|---|
| `frame` | `{camera: import('./camera.js').Camera, batch: import('./batch.js').SpriteBatch, clear?: number[] \| null, filters?: object[]}` | `clear: null` keeps the previous contents (draw an overlay pass). `filters` (see `Filter`) run over this batch alone, on the CPU here: exact, but slow on a large canvas. |

#### `Canvas2DRenderer.renderLayers`

```js
renderLayers({ camera, clear, layers })
```

Several batches in order, each with its own filters (and camera): a world, then a glowing boss, then the HUD.

| Name | Type | Description |
|---|---|---|
| `frame` | `{camera: import('./camera.js').Camera, clear?: number[] \| null, layers: {batch: import('./batch.js').SpriteBatch, filters?: object[], camera?: import('./camera.js').Camera, meshes?: import('./meshbatch.js').MeshBatch2D}[]}` |  |

#### `Canvas2DRenderer.setFilter`

```js
setFilter(mode)
```

Switch between smooth (`'linear'`) and hard-pixel (`'nearest'`) sampling.

| Name | Type | Description |
|---|---|---|
| `mode` | `'linear' \| 'nearest'` |  |

#### `Canvas2DRenderer.destroy`

```js
destroy()
```

<sub>src/canvas2d.js:9</sub>

### `class DrawList3D`

```js
class DrawList3D
```

The meshes to draw this frame, grouped by mesh so each one becomes a single instanced draw call. Reuse one list every
frame: `clear()`, then `add...` for everything visible.

Lighting uses the model matrix's rotation for normals, so non-uniform scaling skews the shading a little; scale uniformly
where it matters.

#### `DrawList3D.constructor`

```js
constructor()
```

#### `DrawList3D.setMaterial`

```js
setMaterial(layer, mapping = 'uv', scale = 1)
```

Texture the instances you add next (until the next call, or `clear()`). The layer is what `TextureSet.add` returned.
- `'uv'`: use the mesh's texture coordinates (meshes without any show one texel), multiplied by `scale` (2 = the texture repeats twice).
- `'planar'`: no coordinates needed: the texture is projected along whichever world axis the surface faces most, `scale`
  times per metre (0.25 = one repeat per 4 m). Good for ground, walls and boxes; the texture stays put as objects move around it.
The instance colour multiplies the texture, so a white texture shows the colour and a coloured one tints it.

| Name | Type | Description |
|---|---|---|
| `layer` | `number \| null` |  |
| `mapping` (optional) | `'uv' \| 'planar'` |  |
| `scale` (optional) | `number` |  |

#### `DrawList3D.setBlended`

```js
setBlended(on = true)
```

Draw the instances you add next as **translucent**: after everything solid, blended over it by their alpha, and writing no depth, so what is behind a pane of glass, a force field or a
bubble shows through it (and so do the particles, which are drawn after the solid things too: without this, a see-through instance hides them, because it has written the depth in front of
them). They cast no shadow. Instances of the same mesh are drawn in the order they were added; give the far one first when two overlap and the order shows. Skinned instances are not
affected. `clear()` turns it off.

| Name | Type | Description |
|---|---|---|
| `on` (optional) | `boolean` |  |

#### `DrawList3D.setSurface`

```js
setSurface(id = 0)
```

Draw the instances you add next (until the next call, or `clear()`) with a physically based material from the `MaterialSet` the renderer was given
(`renderer.setMaterials`): a number `MaterialSet.add` returned. Such a surface is lit with metal and roughness, bump and occlusion pictures and
emission instead of the simple lighting, and takes its pictures from the material, so `setMaterial` has no effect on it; the instance colour still
tints it. Pass 0 (or nothing) to go back to the simple lighting.

| Name | Type | Description |
|---|---|---|
| `id` (optional) | `number` |  |

#### `DrawList3D.setWater`

```js
setWater(style = 0, time = 0)
```

Draw the instances you add next as water (see `createWaterMesh` and `createWaterStyle`): lifted by waves, coloured by depth, reflecting the sky. `style` is an index into `lighting.water`
(0 to 3), `time` the clock in seconds that moves the waves. Add water after the solid things, with an alpha below 0.5 so it casts no shadow. Anything set with `setMaterial`,
`setSurface` or `setTerrain` afterwards replaces this.

| Name | Type | Description |
|---|---|---|
| `style` (optional) | `number` |  |
| `time` (optional) | `number` |  |

#### `DrawList3D.setTerrain`

```js
setTerrain(splatLayer, firstLayer, scale = 0.25)
```

Texture the instances you add next as terrain: ground that blends four pictures by a **splat map**. `splatLayer` is a layer of the `TextureSet` whose red, green, blue and alpha
say how much of the first, second, third and fourth picture shows at each place (stretched over the terrain by the mesh's texture coordinates, so give the terrain mesh `uv` running 0 to 1
over the whole terrain); `firstLayer` is the first of four layers in a row that hold the pictures. They tile `scale` times per metre, projected along the axis the ground faces most
(so steep slopes are not stretched). `terrain.js` makes the mesh and the splat map. Anything set with `setMaterial` or `setSurface` afterwards replaces this.

| Name | Type | Description |
|---|---|---|
| `splatLayer` | `number` |  |
| `firstLayer` | `number` |  |
| `scale` (optional) | `number` |  |

#### `DrawList3D.setCamera`

```js
setCamera(camera, shadows)
```

Skip instances that cannot be on screen: from now on `add` and `addSkinned` test each instance's bounding sphere against
the camera's frustum (as of its last `update()`) and drop the ones outside. Pass null to draw everything. Set it every
frame after `camera.update()`; a skinned mesh's bound is its bind pose enlarged by half again plus 25 cm (set
`mesh.cullRadius` if your animations reach further).

With shadows on, pass the light too: something behind you or off to the side can still throw its shadow into view, so
instances whose shadow could reach the view are kept (they are drawn into the shadow map, and cost only vertex work in
the main pass).

| Name | Type | Description |
|---|---|---|
| `camera` | `import('./camera3d.js').Camera3D \| null` | Point and spot lights that cast shadows (`castShadow: true`) need the same: pass `lights` (the `pointLights` of the lighting) and instances inside the reach of such a light are kept even when out of view, so that a wall behind you still throws its shadow in front of you. |
| `shadows` (optional) | `{light?: ArrayLike<number>, reach?: number, lights?: {x: number, y: number, z: number, radius: number, castShadow?: boolean}[]}` | `light`: direction TO the sun; `reach`: the farthest a shadow is worth following, in metres (default 60); `lights`: the lights that may cast shadows |

#### `DrawList3D.setOcclusion`

```js
setOcclusion(buffer)
```

Skip instances hidden behind what the buffer holds (fill it each frame with `begin(camera)` and `addBox` / `addMesh` for the walls, then set it here). Only
instances that pass the frustum test are asked. With shadows on (`setCamera(camera, { light })`) nothing is dropped for being hidden, because a hidden thing can
still throw a shadow into view and the shadow map is drawn from this list. Pass null to stop.

| Name | Type | Description |
|---|---|---|
| `buffer` | `import('./occlusion.js').OcclusionBuffer \| null` |  |

#### `DrawList3D.sphereVisible`

```js
sphereVisible(x, y, z, radius)
```

Could a sphere put anything in the picture: is it in the view, or could its shadow fall into the view or into the reach of a light that casts shadows? What `add` asks about every
instance; ask it yourself about a whole group of things (a character, a building) to skip all of them at once. Always true without a camera.

| Name | Type | Description |
|---|---|---|
| `x` | `number` |  |
| `y` | `number` |  |
| `z` | `number` |  |
| `radius` | `number` |  |

#### `DrawList3D.clear`

```js
clear()
```

#### `DrawList3D.add`

```js
add(mesh, model, r = 1, g = 1, b = 1, a = 1)
```

| Name | Type | Description |
|---|---|---|
| `mesh` | `import('./mesh.js').Mesh` |  |
| `model` | `ArrayLike<number>` | Column-major 4x4 model matrix |
| `r` (optional) | `number` | Colour channels 0..1 |
| `g` (optional) | `number` |  |
| `b` (optional) | `number` |  |
| `a` (optional) | `number` |  |

#### `DrawList3D.addSkinned`

```js
addSkinned(mesh, model, palette, r = 1, g = 1, b = 1, a = 1)
```

Add an instance of a skinned mesh. The palette (one 4x4 matrix per joint, from `Skeleton.computePalette`) is copied now,
so you can reuse your palette array straight away. Skinned instances are drawn after the plain ones.

| Name | Type | Description |
|---|---|---|
| `mesh` | `import('./mesh.js').Mesh` | Made with `createSkinnedMesh` |
| `model` | `ArrayLike<number>` | Column-major 4x4 placement of the whole character |
| `palette` | `ArrayLike<number>` | `mesh.jointCount * 16` floats |

#### `DrawList3D.addLod`

```js
addLod(lod, model, r = 1, g = 1, b = 1, a = 1)
```

Add an instance of a `Lod` (see `createLod`): the level that suits its size on screen is chosen, or nothing if it is too small to matter. Needs `setCamera` to know
the distance (without one, the most detailed level is drawn).

| Name | Type | Description |
|---|---|---|
| `lod` | `import('./lod.js').Lod` |  |
| `model` | `ArrayLike<number>` |  |

**Returns** `number` — the level drawn, or -1

#### `DrawList3D.addSkinnedLod`

```js
addSkinnedLod(lod, model, palette, r = 1, g = 1, b = 1, a = 1)
```

Like `addLod`, for levels made with `createSkinnedMesh` that share one skeleton (so one palette fits every level).

#### `DrawList3D.addBatch`

```js
addBatch(batch)
```

Add a batch made by `StaticBatcher.build()`: its geometry is already in world space, so it is drawn as one instance with its own colour and texture settings.

| Name | Type | Description |
|---|---|---|
| `batch` | `import('./merge.js').StaticBatch` |  |

#### `DrawList3D.addTransform`

```js
addTransform(mesh, x, y, z, rotation, sx = 1, sy = sx, sz = sx, r = 1, g = 1, b = 1, a = 1)
```

Add an instance from a position, an optional rotation quaternion [x, y, z, w] and a scale.

<sub>src/drawlist.js:71</sub>

### `class Font`

```js
class Font
```

Text as ordinary sprites. Each glyph is drawn once, in white, into the shared atlas by the browser's own text
engine (any installed or web font, emoji, accents, CJK), then drawn like any other sprite and coloured by the tint.
So text costs no extra draw call, works identically in all three backends, and sorts with everything else.

Glyphs are rasterised at `size * scale` pixels and drawn at `size` world units, so for crisp text pass
`scale: devicePixelRatio` and draw it with a screen-space camera (`Camera.setScreenSpace`), where one world
unit is one CSS pixel. Text in a zoomed world camera gets blurry or blocky; make a Font at the size you need.

Pass `sdf: true` (or `{ size, spread }`) for **scalable text**: glyphs are stored as signed distance fields and the
shader draws a sharp anti-aliased edge at any size, rotation or camera zoom (stored once at about 48 px, drawn from 8 to
several hundred world units). It costs a one-off distance transform per glyph and is a little softer than hinted
raster text at small sizes (under about 14 px), so use plain `Font` for small UI text and `sdf` for the rest.

Plain Latin, Cyrillic, Greek and CJK text is laid out glyph by glyph (per-glyph advances, no kerning), with `\n` line breaks and optional word wrap. Text that needs more goes through the
layout engine (see textlayout.js) without your doing anything: right-to-left and mixed-direction text is reordered (`bidi.js`), words in Arabic, Hebrew, Indic and Southeast Asian scripts
are shaped by the browser as whole words, and an emoji with its skin tone or a letter with accents is one unit.

#### `Font.constructor`

```js
constructor(atlas, { family = 'system-ui, sans-serif', size = 16, weight = 'normal', style = 'normal', scale = 1, preload = ASCII, sdf = false, kerning = false } = {})
```

| Name | Type | Description |
|---|---|---|
| `atlas` | `import('./atlas.js').Atlas` | Shared with the renderer; glyphs are added lazily as they are first used. |
| `o` (optional) | `object` |  |
| `o.family` (optional) | `string` | CSS font family list, e.g. `'ui-monospace, Consolas, monospace'`. |
| `o.size` (optional) | `number` | Pixel height of the font in world units (for `sdf` fonts: the nominal size; draw at any size with `draw(..., { size })`). |
| `o.weight` (optional) | `string` | CSS weight: `'normal'`, `'bold'`, `'600'`. |
| `o.style` (optional) | `string` | `'normal'` or `'italic'`. |
| `o.scale` (optional) | `number` | Raster scale (use `devicePixelRatio`). Ignored for `sdf` fonts. |
| `o.sdf` (optional) | `boolean \| {size?: number, spread?: number}` | Store glyphs as signed distance fields: `size` is the raster pixel size (default 48), `spread` the distance range in pixels (default size / 6). |
| `o.preload` (optional) | `string` | Characters drawn into the atlas up front (default: printable ASCII). |
| `o.kerning` (optional) | `boolean` | Pull letter pairs together the way the font says ("AV", "To"); measured with the browser once per pair. Off by default, which keeps plain text on the fast path. |

#### `Font.glyph`

```js
glyph(cp)
```

The glyph of a character: `{ sprite, advance, ox, oy }` in raster pixels (the layout engine's view of a font).

#### `Font.kern`

```js
kern(a, b)
```

How much closer (negative) or further apart two characters sit than their separate advances say, in raster pixels; 0 unless the font was made with `kerning: true`.

#### `Font.reset`

```js
reset()
```

Forget every glyph that was drawn into the atlas, after `Atlas.clear()`: the font draws them again as they are needed.

#### `Font.run`

```js
run(text, rtl = false)
```

A whole word (or cluster) drawn as one sprite by the browser's text engine, which shapes it: Arabic letters join, Hebrew points sit on their letters, Indic and Thai clusters form.
`rtl` says the word is in a right-to-left run (so the engine lays its letters out right to left). Cached in the atlas.

| Name | Type | Description |
|---|---|---|
| `text` | `string` |  |
| `rtl` (optional) | `boolean` |  |

**Returns** `{sprite: object \| null, advance: number, ox: number, oy: number}`

#### `Font.width`

```js
width(text, unit = 1)
```

Advance width of a string in world units, ignoring line breaks.

#### `Font.wrap`

```js
wrap(text, maxWidth = Infinity, unit = 1)
```

Break text into lines no wider than `maxWidth` (world units). Breaks at spaces; a word wider than the limit
is split between characters. `\n` always breaks. Without `maxWidth`, only `\n` breaks.

**Returns** `string[]`

#### `Font.measure`

```js
measure(text, o = {})
```

Size of the text box.

| Name | Type | Description |
|---|---|---|
| `text` | `string` |  |
| `o` (optional) | `{maxWidth?: number, unit?: number, size?: number}` | `size` is the font size in world units (alternative to `unit`). |

**Returns** `{width: number, height: number, lines: string[]}`

#### `Font.draw`

```js
draw(batch, text, x, y, o = {})
```

Append the text to a batch. `x` is the left edge (or centre / right edge, per `align`) and `y` the top of the first line.

| Name | Type | Description |
|---|---|---|
| `batch` | `import('./batch.js').SpriteBatch` |  |
| `text` | `string` |  |
| `x` | `number` |  |
| `y` | `number` |  |
| `o` (optional) | `object` |  |
| `o.tint` (optional) | `number` | See packTint (default white). |
| `o.align` (optional) | `'left' \| 'center' \| 'right'` |  |
| `o.maxWidth` (optional) | `number` | Word-wrap at this width (world units). |
| `o.unit` (optional) | `number` | Size multiplier (2 = twice as big; the glyphs are scaled, not re-rasterised). |
| `o.size` (optional) | `number` | Font size in world units, instead of `unit` (for `sdf` fonts any size stays sharp). |
| `o.key` (optional) | `number` | Sort key (see `sortKey`); all glyphs share it, so text stays together. |
| `o.snap` (optional) | `boolean` | Round glyph positions to device pixels (default true for plain fonts, off for sdf): crisp text, shimmers when moving smoothly. |
| `o.shadow` (optional) | `{dx?: number, dy?: number, tint?: number}` | Draw a shadow first (default offset 1, 1; black at half opacity). |

**Returns** `{width: number, height: number, lines: string[]}`

<sub>src/text.js:25</sub>

### `class FontFamily`

```js
class FontFamily
```

Fonts that make their bold and italic forms on demand, all sharing one atlas.

#### `FontFamily.constructor`

```js
constructor(atlas, options = {})
```

| Name | Type | Description |
|---|---|---|
| `atlas` | `import('./atlas.js').Atlas` |  |
| `options` (optional) | `ConstructorParameters<typeof Font>[1]` | What every variant is made with (`family`, `size`, `sdf`, `scale`...). |

#### `FontFamily.get`

```js
get({ bold = false, italic = false } = {})
```

The font for a weight and slant (made the first time it is asked for).

| Name | Type | Description |
|---|---|---|
| `v` (optional) | `{bold?: boolean, italic?: boolean}` |  |

**Returns** `Font`

<sub>src/richtext.js:98</sub>

### `class FontStack`

```js
class FontStack extends LayoutTypeface
```

Fonts in order of preference: each character is drawn with the first font that has it. A font has a character if the browser really draws it from that font, not from some
substitute: this is found out once per character by measuring it against two different fallback fonts (if both give the same width, the font has it). Or say so yourself with
`ranges` (`[{ font, ranges: [[0x600, 0x6ff]] }]`) and nothing is measured. The last font takes whatever is left, so something always draws.

#### `FontStack.constructor`

```js
constructor(fonts)
```

| Name | Type | Description |
|---|---|---|
| `fonts` | `(Font \| {font: Font, ranges?: [number, number][], detect?: boolean})[]` |  |

#### `FontStack.fontFor`

```js
fontFor(cp)
```

The font that draws this character.

| Name | Type | Description |
|---|---|---|
| `cp` | `number` |  |

#### `FontStack.glyph`

```js
glyph(cp)
```

#### `FontStack.reset`

```js
reset()
```

Reset every font in the stack (see `Atlas.clear`).

<sub>src/richtext.js:115</sub>

### `class FrameWatcher`

```js
class FrameWatcher
```

Does a source have a picture it has not shown yet? A video that can say when it presents a frame (`requestVideoFrameCallback`, in every current browser) is asked;
an older one is judged by its clock moving; anything else (a canvas, a bitmap) counts as always new.

#### `FrameWatcher.constructor`

```js
constructor(source)
```

#### `FrameWatcher.poll`

```js
poll()
```

#### `FrameWatcher.destroy`

```js
destroy()
```

Stop listening to the video.

<sub>src/video.js:52</sub>

### `class Heightmap`

```js
class Heightmap
```

A grid of heights.

#### `Heightmap.constructor`

```js
constructor(size, { cell = 1, originX = 0, originZ = 0, heights } = {})
```

| Name | Type | Description |
|---|---|---|
| `size` | `number` | Samples along each side (at least 2); the map covers `(size - 1) * cell` metres. |
| `o` (optional) | `{cell?: number, originX?: number, originZ?: number, heights?: Float32Array}` | `cell`: metres between samples. `originX`, `originZ`: the world position of sample (0, 0). |

#### `Heightmap.width`

```js
get width
```

How many metres the map covers along each side.

#### `Heightmap.fromNoise`

```js
static fromNoise({ size = 129, cell = 1, seed = 1, amplitude = 30, base = 0, frequency = 1.5, octaves = 5, persistence = 0.5, ridged = false, island = 0, originX = 0, originZ = 0 } = {})
```

Hills from noise.

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{size?: number, cell?: number, seed?: number, amplitude?: number, base?: number, frequency?: number, octaves?: number, persistence?: number, ridged?: boolean, island?: number, originX?: number, originZ?: number}` | `amplitude`: metres from lowest to highest; `base`: height of the lowest; `frequency`: hills per 100 m; `island` 0..1 sinks the edges below `base` so the map is an island. |

#### `Heightmap.fromFunction`

```js
static fromFunction(size, fn, { cell = 1, originX = 0, originZ = 0 } = {})
```

A map from a function of world position.

| Name | Type | Description |
|---|---|---|
| `size` | `number` |  |
| `fn` | `(x: number, z: number) => number` |  |
| `o` (optional) | `{cell?: number, originX?: number, originZ?: number}` |  |

#### `Heightmap.fromImageData`

```js
static fromImageData(rgba, width, height, { size = Math.min(width, height), cell = 1, minHeight = 0, maxHeight = 50, channel = 0, originX = 0, originZ = 0 } = {})
```

A map from a picture: brighter is higher. The picture is sampled onto a square grid.

| Name | Type | Description |
|---|---|---|
| `rgba` | `ArrayLike<number>` | Pixel data, 4 bytes per pixel, rows from the top. |
| `width` | `number` |  |
| `height` | `number` |  |
| `o` (optional) | `{size?: number, cell?: number, minHeight?: number, maxHeight?: number, channel?: 0 \| 1 \| 2, originX?: number, originZ?: number}` | `channel`: which colour to read (red by default). |

#### `Heightmap.get`

```js
get(i, j)
```

The height of a sample.

| Name | Type | Description |
|---|---|---|
| `i` | `number` |  |
| `j` | `number` |  |

#### `Heightmap.set`

```js
set(i, j, h)
```

Set the height of a sample.

| Name | Type | Description |
|---|---|---|
| `i` | `number` |  |
| `j` | `number` |  |
| `h` | `number` |  |

#### `Heightmap.contains`

```js
contains(x, z)
```

Is the world position over the map?

#### `Heightmap.heightAt`

```js
heightAt(x, z)
```

The ground height at a world position, smoothly between samples (the edge height beyond the map).

| Name | Type | Description |
|---|---|---|
| `x` | `number` |  |
| `z` | `number` |  |

#### `Heightmap.normalAt`

```js
normalAt(x, z, out = [0, 1, 0])
```

The direction the ground faces at a world position, a unit vector pointing up and away.

| Name | Type | Description |
|---|---|---|
| `x` | `number` |  |
| `z` | `number` |  |
| `out` (optional) | `number[]` |  |

#### `Heightmap.slopeAt`

```js
slopeAt(x, z)
```

How steep the ground is at a world position, in degrees (0 flat, 90 a cliff).

| Name | Type | Description |
|---|---|---|
| `x` | `number` |  |
| `z` | `number` |  |

#### `Heightmap.range`

```js
range()
```

The lowest and highest sample.

**Returns** `{min: number, max: number}`

#### `Heightmap.raycast`

```js
raycast(origin, dir, maxDistance = Infinity)
```

Where a ray first meets the ground.

| Name | Type | Description |
|---|---|---|
| `origin` | `ArrayLike<number>` | [x, y, z] |
| `dir` | `ArrayLike<number>` | [x, y, z], need not be unit |
| `maxDistance` (optional) | `number` |  |

**Returns** `{t: number, x: number, y: number, z: number, normal: number[]} \| null` — `t` is the distance along the unit direction.

#### `Heightmap.sculpt`

```js
sculpt(x, z, radius, amount, mode = 'raise', { target, falloff = 1, seed = 1 } = {})
```

Change the ground under a brush. Returns the changed rectangle of samples (for `Terrain.markDirty`).

| Name | Type | Description |
|---|---|---|
| `x` | `number` | World x. |
| `z` | `number` | World z. |
| `radius` | `number` | Metres. |
| `amount` | `number` | Metres per call at the centre for `raise` and `lower`; 0..1 for `smooth` and `flatten`. |
| `mode` (optional) | `'raise' \| 'lower' \| 'smooth' \| 'flatten' \| 'noise'` | `flatten` pulls toward `target` (default: the height at the centre). |
| `o` (optional) | `{target?: number, falloff?: number, seed?: number}` |  |

**Returns** `{i0: number, j0: number, i1: number, j1: number} \| null`

#### `Heightmap.erode`

```js
erode(iterations = 8, talus = 0.7, amount = 0.4)
```

Wear the ground down the way loose earth falls: wherever a slope is steeper than `talus` (rise over run), some of the height moves to the lower neighbour. Repeating it rounds off sharp peaks.

| Name | Type | Description |
|---|---|---|
| `iterations` (optional) | `number` |  |
| `talus` (optional) | `number` |  |
| `amount` (optional) | `number` | The share of the excess moved each time (0..0.5). |

#### `Heightmap.toTriangles`

```js
toTriangles({ x0 = this.originX, z0 = this.originZ, x1 = this.originX + this.width, z1 = this.originZ + this.width, step = 1 } = {})
```

The ground as triangles (nine numbers each: three corners), for a collision world.

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{x0?: number, z0?: number, x1?: number, z1?: number, step?: number}` | The region in world metres, and how many samples to skip between vertices (1 is every sample). |

**Returns** `Float32Array`

<sub>src/terrain.js:58</sub>

### `class LayoutTypeface`

```js
class LayoutTypeface
```

The text API (`width`, `wrap`, `measure`, `draw`) for any typeface that gives `glyph(cp)` and the metrics, built on the layout engine: extend it, or use `BitmapFont` and `FontStack`,
which do. The same calls as `Font`'s: `size` is the font size in world units (or `unit`, a multiplier), `maxWidth` wraps, `align` is the anchor (`'left'`, `'center'`, `'right'`).

#### `LayoutTypeface.lineHeight`

```js
get lineHeight
```

Height of one line in world units at the nominal size.

#### `LayoutTypeface.width`

```js
width(text, unit = 1)
```

Advance width of a string in world units, ignoring line breaks.

#### `LayoutTypeface.wrap`

```js
wrap(text, maxWidth = Infinity, unit = 1)
```

Break text into lines no wider than `maxWidth` (world units).

**Returns** `string[]`

#### `LayoutTypeface.measure`

```js
measure(text, o = {})
```

Size of the text box.

**Returns** `{width: number, height: number, lines: string[]}`

#### `LayoutTypeface.draw`

```js
draw(batch, text, x, y, o = {})
```

Append the text to a batch. `x` is the left edge (or centre / right edge, per `align`) and `y` the top of the first line.

| Name | Type | Description |
|---|---|---|
| `batch` | `import('./batch.js').SpriteBatch` |  |
| `text` | `string` |  |
| `x` | `number` |  |
| `y` | `number` |  |
| `o` (optional) | `{tint?: number, align?: 'left' \| 'center' \| 'right', maxWidth?: number, unit?: number, size?: number, key?: number, direction?: 'auto' \| 'ltr' \| 'rtl', shadow?: {dx?: number, dy?: number, tint?: number}}` |  |

<sub>src/textlayout.js:235</sub>

### `class Lighting2D`

```js
class Lighting2D
```

A set of lights and the settings that go with them.

#### `Lighting2D.constructor`

```js
constructor({ ambient = '#181c28', bump = 1, specular = 0, shininess = 24, selfShadow = false, enabled = true } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.ambient` (optional) | `number \| string \| number[]` | The light that reaches everywhere (a colour; dark by default). |
| `o.bump` (optional) | `number` | How strongly normal maps tilt the surface (1 as painted, 0 flat). |
| `o.specular` (optional) | `number` | Shine from normal-mapped surfaces (0 none, 0.5 a gloss). |
| `o.shininess` (optional) | `number` | How tight the shine is (higher is tighter). |
| `o.selfShadow` (optional) | `boolean` | Whether a sprite that is itself an occluder is shadowed by itself (off: light falls on the top of walls). |
| `o.enabled` (optional) | `boolean` | Turn the whole thing off without removing it. |

#### `Lighting2D.add`

```js
add(light)
```

Add a light (from `Light2D`) and get it back.

| Name | Type | Description |
|---|---|---|
| `light` | `T` |  |

**Returns** `T`

#### `Lighting2D.remove`

```js
remove(light)
```

Take a light away.

| Name | Type | Description |
|---|---|---|
| `light` | `object` |  |

#### `Lighting2D.clear`

```js
clear()
```

Remove every light.

<sub>src/lighting.js:51</sub>

### `class MaterialSet`

```js
class MaterialSet
```

The materials of a scene, packed the way the renderers read them. `add` returns the number an instance picks with
`DrawList3D.setSurface`; `set` changes one that is already there (a flickering emissive, a wet surface drying), and the renderer
uploads the change at the next `render`.

#### `MaterialSet.constructor`

```js
constructor()
```

#### `MaterialSet.add`

```js
add(spec)
```

Add a material and get its number (1 or more).

| Name | Type | Description |
|---|---|---|
| `spec` | `MaterialSpec` |  |

**Returns** `number`

#### `MaterialSet.set`

```js
set(id, changes)
```

Change some numbers of a material that is already in the set.

| Name | Type | Description |
|---|---|---|
| `id` | `number` |  |
| `changes` | `MaterialSpec` |  |

#### `MaterialSet.find`

```js
find(name)
```

The number of the first material with this name, or 0.

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |

<sub>src/materials.js:93</sub>

### `class MeshBatch2D`

```js
class MeshBatch2D
```

Accumulates triangles for one frame. Reuse it every frame: `clear()` then `push()` / `pushQuad()` (or, for speed, `begin()` and write the words yourself).

#### `MeshBatch2D.constructor`

```js
constructor(vertexCapacity = 1024, indexCapacity = 3072)
```

| Name | Type | Description |
|---|---|---|
| `vertexCapacity` (optional) | `number` | Initial vertex capacity (grows as needed). |
| `indexCapacity` (optional) | `number` | Initial index capacity. |

#### `MeshBatch2D.clear`

```js
clear()
```

#### `MeshBatch2D.begin`

```js
begin(vertices, indices)
```

Make room for `vertices` and `indices` and count them in. Returns the index of the first new vertex; write the vertex words at `base * MESH_VERTEX_WORDS` in `f32` / `u32` and the indices
(each plus `base`) at `indexCount - indices` in `indices`. This is the fast path `push*` use; skeleton drawing uses it directly.

| Name | Type | Description |
|---|---|---|
| `vertices` | `number` |  |
| `indices` | `number` |  |

**Returns** `number`

#### `MeshBatch2D.push`

```js
push(positions, uvs, triangles, page, tint = WHITE, additive = false)
```

Add a triangle mesh.

| Name | Type | Description |
|---|---|---|
| `positions` | `ArrayLike<number>` | x, y for each vertex (world units) |
| `uvs` | `ArrayLike<number>` | u, v for each vertex (atlas page, 0..1) |
| `triangles` | `ArrayLike<number>` | three vertex numbers for each triangle |
| `page` | `number` | Atlas page. |
| `tint` (optional) | `number` | See `packTint`. |
| `additive` (optional) | `boolean` | Add to the picture instead of covering it. |

#### `MeshBatch2D.pushQuad`

```js
pushQuad(sprite, corners, tint = WHITE, additive = false)
```

Add an atlas sprite as two triangles, optionally squeezed into any four corners (clockwise from the top left: a flag, a sheared card, a sprite bent by a spring).

| Name | Type | Description |
|---|---|---|
| `sprite` | `{u0: number, v0: number, u1: number, v1: number, page: number}` |  |
| `corners` | `ArrayLike<number>` | x, y of the top left, top right, bottom right and bottom left |
| `tint` (optional) | `number` |  |
| `additive` (optional) | `boolean` |  |

<sub>src/meshbatch.js:22</sub>

### `class MorphClip`

```js
class MorphClip
```

Keyframed morph weights for one model (from a glTF animation that drives `weights`). `sample(time, out)` writes the weights; give them to `MorphTargets.setWeights`.

#### `MorphClip.constructor`

```js
constructor(name, count, times, values, { loop = true, step = false } = {})
```

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `count` | `number` | Weights per key |
| `times` | `ArrayLike<number>` |  |
| `values` | `ArrayLike<number>` | `count` weights per key |
| `o` (optional) | `object` | `loop` (default true), `step`: hold each key instead of blending. |

#### `MorphClip.wrap`

```js
wrap(time)
```

The time within the clip for a playback time: wrapped when looping, held at the end otherwise.

#### `MorphClip.sample`

```js
sample(time, out = new Float32Array(this.count))
```

Write the weights at a playback time into `out`.

<sub>src/morph.js:130</sub>

### `class MorphTargets`

```js
class MorphTargets
```

Morph targets (blend shapes): a mesh that can change shape by mixing in stored offsets, such as a face that smiles, blinks and talks. Each target is a set of offsets for
every vertex's position (and optionally its normal); the mesh shows `base + sum(weight * offset)`. Weights are usually 0 to 1 but can go beyond.

`new MorphTargets(mesh, targets)` makes a copy of the mesh that is yours to change: set weights, call `update()`, and draw `morph.mesh` instead of the original. Every character
can have its own, since each makes its own copy of the vertices (the indices, texture coordinates and skin weights are shared). It works on skinned meshes too: the shape
changes first and the skeleton then moves the result. Presentation only, like the rest of animation: it may use ordinary maths.

#### `MorphTargets.constructor`

```js
constructor(mesh, targets, { weights } = {})
```

| Name | Type | Description |
|---|---|---|
| `mesh` | `import('./mesh.js').Mesh` | The mesh to change (plain or skinned); it is left alone |
| `targets` | `MorphTarget[]` |  |
| `o` (optional) | `object` |  |
| `o.weights` (optional) | `number[]` | Starting weights (default: all 0) |

#### `MorphTargets.count`

```js
get count
```

The number of targets.

#### `MorphTargets.indexOf`

```js
indexOf(target)
```

The number of a target from its name (or the number itself); throws for one that does not exist.

#### `MorphTargets.set`

```js
set(target, weight)
```

Set one weight, by name or number. Call `update()` afterwards (once, after setting all you want).

#### `MorphTargets.setWeights`

```js
setWeights(values)
```

Set all the weights at once (`ArrayLike<number>`, in target order; missing ones become 0).

#### `MorphTargets.approach`

```js
approach(goals, rate, dt)
```

Move the weights toward a goal by at most `rate` per second (a smile that eases in); returns true while any weight is still on its way.

#### `MorphTargets.update`

```js
update()
```

Rebuild the vertices from the weights. Does nothing (and costs nothing) when no weight changed since the last call.

**Returns** `boolean` — whether the mesh changed

<sub>src/morph.js:13</sub>

### `class OcclusionBuffer`

```js
class OcclusionBuffer
```

A small depth image of the scene's big solid things, drawn on the CPU each frame, that says whether a bounding sphere is hidden behind them.

#### `OcclusionBuffer.constructor`

```js
constructor(width = 128, height = 72)
```

| Name | Type | Description |
|---|---|---|
| `width` (optional) | `number` | Pixels across (default 128). |
| `height` (optional) | `number` | Pixels down (default 72). A bigger buffer hides more (finer gaps) and costs more to fill. |

#### `OcclusionBuffer.begin`

```js
begin(camera)
```

Start a frame: clear the buffer and look through this camera (as of its last `update()`). A camera with an orthographic view is not supported: nothing is hidden.

#### `OcclusionBuffer.addTriangles`

```js
addTriangles(vertices, indices, model = null, stride = 6)
```

Draw a solid thing into the buffer. Use closed, solid shapes and keep them simple (a box for a building, not its windows): triangles with a corner behind the camera
are skipped, which only makes the buffer hide less. `model` places the mesh (column-major 4x4); the mesh's own vertices are 6 floats each (`stride`).

| Name | Type | Description |
|---|---|---|
| `vertices` | `Float32Array` |  |
| `indices` | `ArrayLike<number>` |  |
| `model` (optional) | `ArrayLike<number> \| null` |  |
| `stride` (optional) | `number` |  |

#### `OcclusionBuffer.addMesh`

```js
addMesh(mesh, model = null)
```

Draw a mesh placed by `model` (see `addTriangles`).

#### `OcclusionBuffer.addBox`

```js
addBox(minX, minY, minZ, maxX, maxY, maxZ)
```

Draw an axis-aligned box from its corners (a wall, a building).

#### `OcclusionBuffer.sphereHidden`

```js
sphereHidden(x, y, z, radius)
```

Is a sphere certainly hidden behind what has been drawn into the buffer? False when in doubt: when it is near the camera, partly behind it, or any pixel of its
enlarged outline is not covered by a nearer occluder.

<sub>src/occlusion.js:15</sub>

### `class ParticleBatch`

```js
class ParticleBatch
```

The per-frame list of particles for the renderer (16 floats each). `ParticleSystem.writeTo(batch)` fills it; pass it to
`render({ particles })`.

#### `ParticleBatch.constructor`

```js
constructor(capacity = 1024)
```

| Name | Type | Description |
|---|---|---|
| `capacity` (optional) | `number` | initial particle capacity (grows as needed) |

#### `ParticleBatch.clear`

```js
clear()
```

#### `ParticleBatch.capacity`

```js
get capacity
```

#### `ParticleBatch.push`

```js
push(x, y, z, size, r, g, b, a, vx = 0, vy = 0, vz = 0, stretch = 0, rot = 0, additive = 0, hardness = 0, orient = 0)
```

Add one particle.

| Name | Type | Description |
|---|---|---|
| `x` | `number` |  |
| `y` | `number` |  |
| `z` | `number` | Centre. |
| `size` | `number` | Half-size in world units (a radius). |
| `r` | `number` |  |
| `g` | `number` |  |
| `b` | `number` |  |
| `a` | `number` | Colour 0..1 (a = opacity). |
| `vx` | `number` |  |
| `vy` | `number` |  |
| `vz` | `number` | Velocity for `stretch`; the surface normal for `flat`. |
| `stretch` | `number` | Extra half-length per unit of speed (streaks). |
| `rot` | `number` | Rotation in radians (billboards and flats). |
| `additive` | `number` | 0 = ordinary alpha blending, 1 = adds light (fire, sparks, glow). |
| `hardness` | `number` | 0 = soft falloff, 1 = a crisp disc. |
| `orient` | `number` | See ORIENT. |

<sub>src/particles.js:18</sub>

### `class Pose`

```js
class Pose
```

Local translation, rotation and scale of every joint.

#### `Pose.constructor`

```js
constructor(count)
```

#### `Pose.setRest`

```js
setRest(skeleton)
```

Reset to the skeleton's rest pose.

**Returns** `this`

#### `Pose.copy`

```js
copy(other)
```

<sub>src/skeleton.js:96</sub>

### `class RichText`

```js
class RichText
```

Rich text over a set of fonts. Give it the fonts by name (`regular` is needed; `bold`, `italic`, `boldItalic` are used for the `[b]` and `[i]` tags when present, and a `FontFamily` can make
them: pass `family`), more by name for `[font=name]`, and the atlas for `[img=name]` pictures.

```js
const rich = new RichText({ family: new FontFamily(atlas, { family: 'system-ui', size: 18 }), atlas, fonts: { mono: new Font(atlas, { family: 'monospace', size: 16 }) } });
const layout = rich.layout('[b]Quest:[/b] bring [color=gold]3 coins[/color] [img=coin w=16 h=16 valign=middle]', { maxWidth: 320 });
rich.draw(batch, layout, 20, 20);                          // each frame
const link = rich.linkAt(layout, mouseX - 20, mouseY - 20);   // 'quest:12' or null
```

#### `RichText.constructor`

```js
constructor({ family, fonts = {}, atlas, defaults = {} } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.family` (optional) | `FontFamily` | Makes the regular, bold and italic fonts. |
| `o.fonts` (optional) | `Record<string, any>` | Typefaces by name: `regular`, `bold`, `italic`, `boldItalic`, and any others for `[font=name]` (a `Font`, `BitmapFont` or `FontStack`). |
| `o.atlas` (optional) | `import('./atlas.js').Atlas` | Where `[img=name]` finds its pictures (and the white sprite for underlines is made). |
| `o.defaults` (optional) | `{color?: number, size?: number}` | The base colour (packed tint) and size (world units). |

#### `RichText.layout`

```js
layout(markup, { maxWidth = Infinity, align, direction = 'auto', lineSpacing = 1, paragraphSpacing = 0, markup: parse = true } = {})
```

Parse markup and lay it out.

| Name | Type | Description |
|---|---|---|
| `markup` | `string` |  |
| `o` (optional) | `{maxWidth?: number, align?: 'left' \| 'center' \| 'right', direction?: 'auto' \| 'ltr' \| 'rtl', lineSpacing?: number, paragraphSpacing?: number, markup?: boolean}` | `markup: false` takes the text literally (a player's chat line). |

**Returns** `RichLayout`

#### `RichText.draw`

```js
draw(batch, layout, x, y, o = {})
```

Draw a layout (or markup, laid out for you) into a batch with its top left at (x, y).

| Name | Type | Description |
|---|---|---|
| `batch` | `import('./batch.js').SpriteBatch` |  |
| `layout` | `RichLayout \| string` |  |
| `x` | `number` |  |
| `y` | `number` |  |
| `o` (optional) | `{tint?: number, key?: number, visible?: number, time?: number}` | `visible`: how many characters to show (a typewriter reveal: `Math.floor(seconds * 30)`), `time`: seconds, for the `[wave]`, `[shake]`, `[rainbow]` and `[fade]` effects. |

#### `RichText.linkAt`

```js
linkAt(layout, px, py)
```

The `link` of the `[url]` under a point (world units from the layout's top left), or null.

| Name | Type | Description |
|---|---|---|
| `layout` | `RichLayout` |  |
| `px` | `number` |  |
| `py` | `number` |  |

#### `RichText.characters`

```js
characters(layout)
```

How many characters a typewriter reveal has to show to be complete.

| Name | Type | Description |
|---|---|---|
| `layout` | `RichLayout` |  |

#### `RichText.reset`

```js
reset()
```

Forget cached layouts and the underline sprite, after `Atlas.clear()` (reset the fonts yourself).

#### `RichText.lines`

```js
lines(layout)
```

The text of a layout as drawn, line by line (markup removed).

| Name | Type | Description |
|---|---|---|
| `layout` | `RichLayout` |  |

<sub>src/richtext.js:171</sub>

### `class ShelfPacker`

```js
class ShelfPacker
```

Shelf packer: rectangles go left to right in rows ("shelves"); a new shelf
opens when a rectangle does not fit the current row. Simple, predictable, and
good enough for sprite sheets. Pure logic, no canvas.

#### `ShelfPacker.constructor`

```js
constructor(width, height, padding = 1)
```

| Name | Type | Description |
|---|---|---|
| `width` | `number` |  |
| `height` | `number` |  |
| `padding` (optional) | `number` | Gap around each rectangle (stops texture filtering from bleeding). |

#### `ShelfPacker.pack`

```js
pack(w, h)
```

**Returns** `{x: number, y: number} \| null` — Top-left of the placed rectangle, or null if it does not fit.

<sub>src/atlas.js:6</sub>

### `class Skeleton`

```js
class Skeleton
```

A joint hierarchy (any order; parents may come after children). `t`, `r`, `s` are the local rest translation, rotation and scale.

#### `Skeleton.constructor`

```js
constructor(joints, { inverseBind, rootMatrix } = {})
```

| Name | Type | Description |
|---|---|---|
| `joints` | `{name?: string, parent: number, t?: ArrayLike<number>, r?: ArrayLike<number>, s?: ArrayLike<number>}[]` |  |
| `o` (optional) | `object` |  |
| `o.inverseBind` (optional) | `ArrayLike<number>` | 16 floats per joint (from a glTF skin). Default: the inverse of each joint's rest world matrix. |
| `o.rootMatrix` (optional) | `ArrayLike<number>` | Transform of whatever the root joints hang from (default identity). |

#### `Skeleton.indexOf`

```js
indexOf(name)
```

#### `Skeleton.createPose`

```js
createPose()
```

#### `Skeleton.computePalette`

```js
computePalette(pose, out = new Float32Array(this.count * 16), offset = 0)
```

The skinning matrices of a pose: for each joint, its world matrix times its inverse bind matrix. These go into the
`palette` of `DrawList3D.addSkinned`.

| Name | Type | Description |
|---|---|---|
| `pose` | `Pose` |  |
| `out` (optional) | `Float32Array` | At least `offset + count * 16` floats (default: a new array) |
| `offset` (optional) | `number` | First float to write |

#### `Skeleton.jointWorld`

```js
jointWorld(i)
```

World matrix of a joint after the last `computePalette` (a view into scratch memory: copy it to keep it).

<sub>src/skeleton.js:12</sub>

### `class SpriteBatch`

```js
class SpriteBatch
```

Accumulates sprites for one frame. Reuse it every frame: `clear()` then `push()`.

#### `SpriteBatch.constructor`

```js
constructor(capacity = 1024)
```

| Name | Type | Description |
|---|---|---|
| `capacity` (optional) | `number` | Initial sprite capacity (grows as needed). |

#### `SpriteBatch.clear`

```js
clear()
```

#### `SpriteBatch.capacity`

```js
get capacity
```

#### `SpriteBatch.push`

```js
push(x, y, w, h, rot, sprite, tint = WHITE, key = 0)
```

| Name | Type | Description |
|---|---|---|
| `x` | `number` | Centre x (world) |
| `y` | `number` |  |
| `w` | `number` |  |
| `h` | `number` |  |
| `rot` | `number` | Radians |
| `sprite` | `{u0: number, v0: number, u1: number, v1: number}` | Atlas entry |
| `tint` (optional) | `number` | See packTint |
| `key` (optional) | `number` | Sort key (default 0 = keep push order). Sprites draw in ascending key order, ties in push order; see `sortKey` and `sort`. Pushing keys in ascending order costs nothing extra. |

#### `SpriteBatch.pushBlock`

```js
pushBlock(block, count, dx = 0, dy = 0, key = 0)
```

Append sprites that are already in instance form (a cached block of `count` sprites, as `push` would have made them), moved by (`dx`, `dy`) and all given the same sort key. This is
how a tile map's chunks reach the batch: a copy of a few kilobytes instead of one `push` per tile.

| Name | Type | Description |
|---|---|---|
| `block` | `Float32Array` | `count * INSTANCE_WORDS` words |
| `count` | `number` |  |
| `dx` (optional) | `number` |  |
| `dy` (optional) | `number` |  |
| `key` (optional) | `number` |  |

#### `SpriteBatch.sort`

```js
sort()
```

Put the sprites into key order (stable: equal keys keep push order). Renderers call this for you; it does nothing
(and allocates nothing) when the keys were pushed in ascending order, so unsorted scenes pay no cost.
Uses a radix sort on the key bits: O(n), no comparator calls, buffers reused across frames.

#### `SpriteBatch.used`

```js
get used
```

The used part of the buffer, for upload.

<sub>src/batch.js:45</sub>

### `class StaticBatcher`

```js
class StaticBatcher
```

Collects placed meshes and merges them into as few meshes as it can without breaking culling or looks.

#### `StaticBatcher.constructor`

```js
constructor({ cellSize = 40, maxVertices = 60000 } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.cellSize` (optional) | `number` | Pieces are only merged with others in the same cell of a grid this many metres wide (default 40), so that a batch is small enough to be skipped when it is out of view. A bigger cell merges more (fewer draws, less culling). |
| `o.maxVertices` (optional) | `number` | Start another batch when one would pass this many vertices (default 60000). |

#### `StaticBatcher.add`

```js
add(mesh, model, { color = [1, 1, 1, 1], layer = null, mapping = 'uv', scale = 1, surface = 0 } = {})
```

Add a placed piece. Pieces that share `color` and the texture and surface settings can be merged; ones that differ cannot (a colour or texture is per batch, not per vertex).

| Name | Type | Description |
|---|---|---|
| `mesh` | `import('./mesh.js').Mesh` |  |
| `model` | `ArrayLike<number>` | Column-major 4x4 placement. |
| `o` (optional) | `{color?: number[], layer?: number \| null, mapping?: 'uv' \| 'planar', scale?: number, surface?: number}` |  |

#### `StaticBatcher.build`

```js
build()
```

Merge everything added so far. A group with one piece is not merged (the piece is baked into world space all the same, so every batch is drawn the same way).

**Returns** `StaticBatch[]`

<sub>src/merge.js:65</sub>

### `class Terrain`

```js
class Terrain
```

The ground of a heightmap as chunks of mesh with levels of detail.

#### `Terrain.constructor`

```js
constructor(map, { chunkCells = 32, lods = 4, skirt = 2, lodDistance, farMerge = 0 } = {})
```

| Name | Type | Description |
|---|---|---|
| `map` | `Heightmap` |  |
| `o` (optional) | `{chunkCells?: number, lods?: number, skirt?: number, lodDistance?: number}` | `chunkCells`: grid cells along a chunk (the map's cells must divide by it, and it by 2 to the power of `lods` less one). `lods`: levels of detail (each halves the cells). `skirt`: how far (metres) the edge of each chunk is dropped to hide the join with a neighbour of a different level. `lodDistance`: how far (metres) the most detailed level reaches; each next level doubles it. `farMerge`: a number of chunks (0, the default, is off): squares of this many chunks on a side that are all at the coarsest level of detail are drawn as one mesh instead of one each, which is the same picture in far fewer draw calls (a wide view over a big map has hundreds of far chunks). |

#### `Terrain.markDirty`

```js
markDirty(region)
```

Throw away the meshes of the chunks a sculpt touched (and recompute their bounds). Meshes that were uploaded to the GPU land in `takeDiscarded()`.

| Name | Type | Description |
|---|---|---|
| `region` | `{i0: number, j0: number, i1: number, j1: number} \| null` |  |

#### `Terrain.takeDiscarded`

```js
takeDiscarded()
```

The meshes replaced since the last call: pass each to `renderer.releaseMesh` to free its GPU memory.

**Returns** `import('./mesh.js').Mesh[]`

#### `Terrain.sculpt`

```js
sculpt(x, z, radius, amount, mode, options)
```

Change the ground under a brush and refresh the chunks it touched (see `Heightmap.sculpt`).

#### `Terrain.chunkMesh`

```js
chunkMesh(chunk, lod)
```

The mesh of one chunk at one level of detail.

| Name | Type | Description |
|---|---|---|
| `chunk` | `TerrainChunk` |  |
| `lod` | `number` |  |

#### `Terrain.createDecal`

```js
createDecal(options)
```

A decal lying on the ground (see `createDecal`): a bullet hole, a scorch, a footprint. It follows the ground's bumps exactly.

| Name | Type | Description |
|---|---|---|
| `options` | `Omit<Parameters<typeof createDecal>[1], 'position'> & {position: number[]}` | Same as `createDecal`; `normal` defaults to the ground's own. |

#### `Terrain.lodFor`

```js
lodFor(distance)
```

Which level of detail a chunk uses from `distance` metres away: 0 is the most detailed.

| Name | Type | Description |
|---|---|---|
| `distance` | `number` |  |

#### `Terrain.addToDrawList`

```js
addToDrawList(list, camera, { r = 1, g = 1, b = 1, a = 1 } = {})
```

Add the chunks that can be seen to a draw list at the right level of detail. Set the list's texturing first (`list.setTerrain(...)`). Respects the list's frustum culling (`list.setCamera`).

| Name | Type | Description |
|---|---|---|
| `list` | `import('./drawlist.js').DrawList3D` |  |
| `camera` | `{x: number, y: number, z: number}` | Where the viewer is. |
| `colour` (optional) | `{r?: number, g?: number, b?: number, a?: number}` | Tints the whole terrain. |

**Returns** `number` — How many chunks were added.

<sub>src/terrain.js:317</sub>

### `class TextureSet`

```js
class TextureSet
```

Square images of one size for the 3D renderers, kept together so they live in one GPU texture array, with mipmaps already
computed. `add(image, name)` returns the layer number an instance picks with `setMaterial`. Plain data: it works in Node as well
as the browser.

#### `TextureSet.constructor`

```js
constructor({ size = 256, maxLayers = 16, format = 'rgba8' } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.size` (optional) | `number` | Width and height of every layer: a power of two from 16 to 2048 (default 256) |
| `o.maxLayers` (optional) | `number` | How many images the set can hold (default 16) |
| `o.format` (optional) | `'rgba8' \| 'bc1' \| 'bc3' \| 'bc7' \| 'etc2' \| 'astc4x4'` | How the pictures are stored (default 'rgba8', plain pixels). A set of a compressed format holds pictures compressed for the graphics card, added with `addKtx2`; it needs a card that reads that format (the renderer says if not). |

#### `TextureSet.add`

```js
add(image, name = `layer${this.layers.length}`)
```

Add an image and get its layer number. An image of another size is resampled to the set's size.

| Name | Type | Description |
|---|---|---|
| `image` | `ImageLike` |  |
| `name` (optional) | `string` |  |

**Returns** `number` — the layer

#### `TextureSet.update`

```js
update(layer, image)
```

Replace the pixels of a layer that is already in the set (a video frame, a painted-on screen, a decal that gets damaged) and rebuild its mip levels in place,
allocating nothing. Renderers upload the layer again the next time they draw. Plain-pixel sets only; an image of another size is resampled.

| Name | Type | Description |
|---|---|---|
| `layer` | `number` |  |
| `image` | `ImageLike` |  |

#### `TextureSet.addKtx2`

```js
addKtx2(ktx, name = `layer${this.layers.length}`)
```

Add a picture read from a KTX2 file (see `parseKtx2`). In a set of plain pixels, an RGBA8 picture is added like any image; in a compressed set the picture must be in the set's format,
exactly `size` x `size`, with all its mip levels (they cannot be made from compressed data).

| Name | Type | Description |
|---|---|---|
| `ktx` | `Awaited<ReturnType<typeof parseKtx2>>` |  |
| `name` (optional) | `string` |  |

**Returns** `number` — the layer

#### `TextureSet.find`

```js
find(name)
```

The layer number of a named image, or -1.

<sub>src/textures.js:20</sub>

### `class TileLayer`

```js
class TileLayer
```

One layer of a tile map: tiles in chunks, made when written to, so a layer can be as big as you like and can reach into negative coordinates.

#### `TileLayer.constructor`

```js
constructor(map, { name = 'layer', offsetX = 0, offsetY = 0, parallaxX = 1, parallaxY = 1, opacity = 1, tint = 0xffffff, visible = true } = {})
```

#### `TileLayer.opacity`

```js
get opacity
```

0 to 1.

#### `TileLayer.opacity`

```js
set opacity(v)
```

#### `TileLayer.tint`

```js
get tint
```

0xRRGGBB multiplied into every tile.

#### `TileLayer.tint`

```js
set tint(v)
```

#### `TileLayer.get`

```js
get(tx, ty)
```

The tile number at a tile position (0 for empty or outside anything written).

#### `TileLayer.set`

```js
set(tx, ty, gid)
```

Put a tile (a number, flip flags included; 0 clears). Only the chunk it is in is rebuilt.

#### `TileLayer.fill`

```js
fill(tx, ty, w, h, gid)
```

Fill a rectangle of tiles with one tile number.

#### `TileLayer.setData`

```js
setData(data, width, height, x0 = 0, y0 = 0)
```

Load a block of tile numbers (row by row) with its top-left at (`x0`, `y0`).

#### `TileLayer.bounds`

```js
bounds()
```

The smallest rectangle of tiles holding every tile, as `{x, y, w, h}`, or null when the layer is empty.

<sub>src/tilemap.js:125</sub>

### `class TileMap`

```js
class TileMap
```

A tile map: a grid size, tilesets and layers.

#### `TileMap.constructor`

```js
constructor({ tileW, tileH = tileW } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` | `tileW`, `tileH`: the size of one grid cell in world units |

#### `TileMap.addTileset`

```js
addTileset(set)
```

Add a tileset. Its tile numbers must not overlap an earlier set's: when they would, it is renumbered to follow. Returns the set.

#### `TileMap.addLayer`

```js
addLayer(options)
```

Add a layer on top of the earlier ones.

#### `TileMap.resolve`

```js
resolve(gid)
```

The tileset and tile id of a tile number (flags ignored), or null.

#### `TileMap.worldToTile`

```js
worldToTile(x, y)
```

The tile position containing a world position.

<sub>src/tilemap.js:227</sub>

### `class TileSet`

```js
class TileSet
```

The pictures of tiles: a run of tile numbers starting at `firstGid`, each a rectangle of one atlas sprite.

#### `TileSet.constructor`

```js
constructor({ name = 'tiles', firstGid = 1, tileW, tileH, sprite, count, animations = {} })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.name` (optional) | `string` |  |
| `o.firstGid` (optional) | `number` | The number of this set's first tile (default 1; `TileMap.addTileset` renumbers it when sets would overlap) |
| `o.tileW` | `number` | Width of one tile in world units |
| `o.tileH` | `number` |  |
| `o.sprite` | `(id: number) => import('./atlas.js').Sprite` | The atlas rectangle of tile `id` (0-based within the set) |
| `o.count` | `number` | How many tiles the set has |
| `o.animations` (optional) | `Record<number, {id: number, ms: number}[]>` | Tiles that animate: tile id to its frames (a tile id and how many milliseconds it shows) |

#### `TileSet.fromSheet`

```js
static fromSheet(sheet, { tileW, tileH, columns = Math.floor(sheet.w / tileW), count = columns * Math.floor(sheet.h / tileH), margin = 0, spacing = 0, drawW = tileW, drawH = tileH, ...rest } = {})
```

Cut a sheet (one atlas sprite holding a grid of tiles) into tiles.

| Name | Type | Description |
|---|---|---|
| `sheet` | `import('./atlas.js').Sprite` |  |
| `o` | `object` | `tileW`, `tileH` (in pixels of the sheet, also the size they are drawn at unless `drawW`/`drawH` say otherwise), `columns`, `count`, `margin`, `spacing`, and the options of the constructor |

#### `TileSet.animate`

```js
animate(id, frames)
```

Make tile `id` animate: its frames, each a tile id of this set and the milliseconds it shows.

#### `TileSet.frameAt`

```js
frameAt(id, time)
```

The tile id shown at `time` seconds (the tile itself when it does not animate).

#### `TileSet.spriteOf`

```js
spriteOf(id)
```

**Returns** `import('./atlas.js').Sprite`

<sub>src/tilemap.js:61</sub>

### `class VideoSprite`

```js
class VideoSprite
```

A rectangle of the 2D `Atlas` showing a moving picture; draw it like any sprite (`batch.push(sprite, ...)`).

#### `VideoSprite.constructor`

```js
constructor(atlas, source, { name, width, height, fit = 'cover', background = '#000' })
```

| Name | Type | Description |
|---|---|---|
| `atlas` | `import('./atlas.js').Atlas` |  |
| `source` | `any` | A `<video>`, canvas, `ImageBitmap` or `VideoFrame`. |
| `o` | `object` |  |
| `o.name` | `string` | Sprite name. |
| `o.width` | `number` |  |
| `o.height` | `number` | Size in atlas pixels. |
| `o.fit` (optional) | `VideoFit` | (`cover`) |
| `o.background` (optional) | `string` | Colour behind a `contain` picture (black). |

#### `VideoSprite.destroy`

```js
destroy()
```

Stop watching the video (it keeps playing; the sprite keeps its last picture).

#### `VideoSprite.update`

```js
update()
```

Draw the current picture into the atlas if there is a new one. Returns true if it did. Note the whole atlas page is uploaded again, so keep video on a page of its own (a small `Atlas`) when the others are big.

<sub>src/video.js:119</sub>

### `class VideoTexture`

```js
class VideoTexture
```

One layer of a 3D `TextureSet` showing a moving picture. Give `layer` to `DrawList3D.setMaterial` like any other texture.

#### `VideoTexture.constructor`

```js
constructor(set, source, { name = 'video', fit = 'cover', background = '#000', createCanvas = defaultCanvas } = {})
```

| Name | Type | Description |
|---|---|---|
| `set` | `import('./textures.js').TextureSet` | A plain-pixel set with room for one more layer. |
| `source` | `any` | A `<video>`, canvas, `ImageBitmap` or `VideoFrame`. |
| `o` (optional) | `object` |  |
| `o.name` (optional) | `string` | Name of the layer in the set. |
| `o.fit` (optional) | `VideoFit` | How the picture meets the square layer (`cover`). |
| `o.background` (optional) | `string` | Colour behind a `contain` picture (black). |
| `o.createCanvas` (optional) | `(w: number, h: number) => any` |  |

#### `VideoTexture.destroy`

```js
destroy()
```

Stop watching the video (it keeps playing; the layer keeps its last picture).

#### `VideoTexture.update`

```js
update()
```

Copy the current picture into the layer if there is a new one. Returns true if it did.

<sub>src/video.js:83</sub>

### `class WebGL2Renderer`

```js
class WebGL2Renderer
```

Instanced-quad renderer: the whole batch is one draw call.

#### `WebGL2Renderer.constructor`

```js
constructor(canvas, atlas, { transparent = false, filter = 'linear' } = {})
```

| Name | Type | Description |
|---|---|---|
| `canvas` | `HTMLCanvasElement` |  |
| `atlas` | `import('./atlas.js').Atlas` |  |
| `o` (optional) | `{transparent?: boolean}` | See Canvas2DRenderer. |

#### `WebGL2Renderer.setFilter`

```js
setFilter(mode)
```

Switch between smooth (`'linear'`) and hard-pixel (`'nearest'`) sampling of sprites, meshes and normal maps. Text drawn as scalable (SDF) glyphs needs `'linear'`.

| Name | Type | Description |
|---|---|---|
| `mode` | `'linear' \| 'nearest'` |  |

#### `WebGL2Renderer.resize`

```js
resize(cssW, cssH, dpr = 1)
```

#### `WebGL2Renderer.render`

```js
render({ camera, batch, clear = this.transparent ? [0, 0, 0, 0] : [0.05, 0.05, 0.08, 1], filters, lighting, occluders, meshes })
```

| Name | Type | Description |
|---|---|---|
| `frame` | `{camera: import('./camera.js').Camera, batch: import('./batch.js').SpriteBatch, clear?: number[] \| null, filters?: object[], lighting?: import('./lighting.js').Lighting2D, occluders?: import('./batch.js').SpriteBatch, meshes?: import('./meshbatch.js').MeshBatch2D}` | `clear: null` keeps the previous contents (draw an overlay pass). `filters` (see `Filter`) run over this batch alone, then the result is laid over the frame. `lighting` (see `Lighting2D`) lights this batch; `occluders` is a batch of the things that block light, drawn in the same camera, for shadows. `meshes` (a `MeshBatch2D`: skeletons, ropes, anything of triangles) is drawn after the sprites, unlit. |

#### `WebGL2Renderer.renderLayers`

```js
renderLayers({ camera, clear, layers })
```

Several batches in order, each with its own filters (and camera): a world, then a glowing boss, then the HUD.

| Name | Type | Description |
|---|---|---|
| `frame` | `{camera: import('./camera.js').Camera, clear?: number[] \| null, layers: {batch: import('./batch.js').SpriteBatch, filters?: object[], camera?: import('./camera.js').Camera, lighting?: import('./lighting.js').Lighting2D, occluders?: import('./batch.js').SpriteBatch, meshes?: import('./meshbatch.js').MeshBatch2D}[]}` |  |

#### `WebGL2Renderer.destroy`

```js
destroy()
```

<sub>src/webgl2.js:51</sub>

### `class WebGL2Renderer3D`

```js
class WebGL2Renderer3D
```

3D rendering through WebGL2 (the fallback for WebGPU): the same scene, shading and draw order.

#### `WebGL2Renderer3D.constructor`

```js
constructor(canvas, { antialias = true, water = false } = {})
```

#### `WebGL2Renderer3D.resize`

```js
resize(cssW, cssH, dpr = 1)
```

#### `WebGL2Renderer3D.setTextures`

```js
setTextures(set)
```

Use these textures for instances that ask for one (`DrawList3D.setMaterial`). New layers added to the set later are uploaded
at the next `render`. Layers that were never added read as black.

| Name | Type | Description |
|---|---|---|
| `set` | `import('./textures.js').TextureSet \| null` |  |

#### `WebGL2Renderer3D.setMaterials`

```js
setMaterials(set)
```

Use these physically based materials for instances that ask for one (`DrawList3D.setSurface`). Changes to the set are uploaded at the next `render`.
The pictures a material refers to are layers of the set given to `setTextures`.

| Name | Type | Description |
|---|---|---|
| `set` | `import('./materials.js').MaterialSet \| null` |  |

#### `WebGL2Renderer3D.setEnvironment`

```js
setEnvironment(env)
```

Light physically based surfaces with this environment (and draw it as the sky): see `environment.js` for how to make one. Pass null to go back to the plain ambient colours.
Each frame's `lighting.environment` can change how it is used (`{ intensity, rotation, sky, skyBlur }`) or turn it off (`false`).

| Name | Type | Description |
|---|---|---|
| `env` | `import('./environment.js').Environment \| null` |  |

#### `WebGL2Renderer3D.releaseMesh`

```js
releaseMesh(mesh)
```

#### `WebGL2Renderer3D.render`

```js
render({ camera, list, clear = [0.55, 0.65, 0.78, 1], lighting, shadows, localShadows, particles, post })
```

#### `WebGL2Renderer3D.destroy`

```js
destroy()
```

<sub>src/webgl3d.js:570</sub>

### `class WebGPURenderer`

```js
class WebGPURenderer
```

Same instance buffer and one draw call, through WebGPU. Create with `WebGPURenderer.create`.

#### `WebGPURenderer.create`

```js
static async create(canvas, atlas, { transparent = false, filter = 'linear' } = {})
```

#### `WebGPURenderer.constructor`

```js
constructor(canvas, atlas, device, context, format, transparent = false, filter = 'linear')
```

#### `WebGPURenderer.setFilter`

```js
setFilter(mode)
```

Switch between smooth (`'linear'`) and hard-pixel (`'nearest'`) sampling of sprites, meshes and normal maps. Text drawn as scalable (SDF) glyphs needs `'linear'`.

| Name | Type | Description |
|---|---|---|
| `mode` | `'linear' \| 'nearest'` |  |

#### `WebGPURenderer.resize`

```js
resize(cssW, cssH, dpr = 1)
```

#### `WebGPURenderer.render`

```js
render({ camera, batch, clear = this.transparent ? [0, 0, 0, 0] : [0.05, 0.05, 0.08, 1], filters, lighting, occluders, meshes })
```

| Name | Type | Description |
|---|---|---|
| `frame` | `{camera: import('./camera.js').Camera, batch: import('./batch.js').SpriteBatch, clear?: number[] \| null, filters?: object[], lighting?: import('./lighting.js').Lighting2D, occluders?: import('./batch.js').SpriteBatch, meshes?: import('./meshbatch.js').MeshBatch2D}` | `clear: null` keeps the previous contents (overlay pass). `filters` (see `Filter`) run over this batch alone, then the result is laid over the frame. `lighting` (see `Lighting2D`) lights this batch; `occluders` is a batch of the things that block light, drawn in the same camera, for shadows. `meshes` (a `MeshBatch2D`: skeletons, ropes, anything of triangles) is drawn after the sprites, unlit. |

#### `WebGPURenderer.renderLayers`

```js
renderLayers({ camera, clear, layers })
```

Several batches in order, each with its own filters (and camera): a world, then a glowing boss, then the HUD.

| Name | Type | Description |
|---|---|---|
| `frame` | `{camera: import('./camera.js').Camera, clear?: number[] \| null, layers: {batch: import('./batch.js').SpriteBatch, filters?: object[], camera?: import('./camera.js').Camera, lighting?: import('./lighting.js').Lighting2D, occluders?: import('./batch.js').SpriteBatch, meshes?: import('./meshbatch.js').MeshBatch2D}[]}` |  |

#### `WebGPURenderer.destroy`

```js
destroy()
```

<sub>src/webgpu.js:52</sub>

### `class WebGPURenderer3D`

```js
class WebGPURenderer3D
```

3D rendering through WebGPU: instanced meshes, depth buffer, optional 4x MSAA. Create with `WebGPURenderer3D.create`.

#### `WebGPURenderer3D.create`

```js
static async create(canvas, { antialias = true } = {})
```

#### `WebGPURenderer3D.constructor`

```js
constructor(canvas, device, context, format, samples)
```

#### `WebGPURenderer3D.resize`

```js
resize(cssW, cssH, dpr = 1)
```

#### `WebGPURenderer3D.releaseMesh`

```js
releaseMesh(mesh)
```

Free the GPU buffers of a mesh you will not draw again.

#### `WebGPURenderer3D.setTextures`

```js
setTextures(set)
```

Use these textures for instances that ask for one (`DrawList3D.setMaterial`). New layers added to the set later are uploaded
at the next `render`. Layers that were never added read as black.

| Name | Type | Description |
|---|---|---|
| `set` | `import('./textures.js').TextureSet \| null` |  |

#### `WebGPURenderer3D.setMaterials`

```js
setMaterials(set)
```

Use these physically based materials for instances that ask for one (`DrawList3D.setSurface`). Changes to the set are uploaded at the next `render`.
The pictures a material refers to are layers of the set given to `setTextures`.

| Name | Type | Description |
|---|---|---|
| `set` | `import('./materials.js').MaterialSet \| null` |  |

#### `WebGPURenderer3D.setEnvironment`

```js
setEnvironment(env)
```

Light physically based surfaces with this environment (and draw it as the sky): see `environment.js` for how to make one. Pass null to go back to the plain ambient colours.
Each frame's `lighting.environment` can change how it is used (`{ intensity, rotation, sky, skyBlur }`) or turn it off (`false`).

| Name | Type | Description |
|---|---|---|
| `env` | `import('./environment.js').Environment \| null` |  |

#### `WebGPURenderer3D.render`

```js
render({ camera, list, clear = [0.55, 0.65, 0.78, 1], lighting, shadows, localShadows, particles, post })
```

| Name | Type | Description |
|---|---|---|
| `frame` | `object` |  |
| `frame.camera` | `import('./camera3d.js').Camera3D` |  |
| `frame.list` | `import('./drawlist.js').DrawList3D` |  |
| `frame.clear` (optional) | `number[]` | RGBA 0..1 |
| `frame.lighting` (optional) | `Partial<ReturnType<typeof createLighting>>` |  |

#### `WebGPURenderer3D.destroy`

```js
destroy()
```

<sub>src/webgpu3d.js:577</sub>

## Constants

### `CHUNK`

```js
const CHUNK
```

Tiles along one side of a chunk.

Value: `16`

<sub>src/tilemap.js:22</sub>

### `FLIP_D`

```js
const FLIP_D
```

The flag for a tile mirrored across the diagonal.

Value: `0x20000000`

<sub>src/tilemap.js:19</sub>

### `FLIP_H`

```js
const FLIP_H
```

Tiled's flags in the top bits of a tile number: mirrored left to right, top to bottom, and across the diagonal (applied in that order: diagonal, then horizontal, then vertical).

Value: `0x80000000`

<sub>src/tilemap.js:15</sub>

### `FLIP_V`

```js
const FLIP_V
```

The flag for a tile mirrored top to bottom.

Value: `0x40000000`

<sub>src/tilemap.js:17</sub>

### `Filter`

```js
const Filter
```

The filter descriptions. Each returns a plain object you can keep and reuse; change its fields between frames to animate it (a `wave`'s `phase`, a `glow`'s `strength`).

Value: `{`

<sub>src/filters.js:55</sub>

### `INSTANCE3D_BYTES`

```js
const INSTANCE3D_BYTES
```

Bytes per instance in a 3D draw list (`INSTANCE3D_FLOATS` × 4).

Value: `INSTANCE3D_FLOATS * 4`

<sub>src/drawlist.js:8</sub>

### `INSTANCE3D_FLOATS`

```js
const INSTANCE3D_FLOATS
```

Floats per instance: a 4x4 model matrix (16), an RGBA colour (4) and a material (4: texture layer or -1, mapping, scale, surface material number or 0).

Value: `24`

<sub>src/drawlist.js:6</sub>

### `INSTANCE_BYTES`

```js
const INSTANCE_BYTES
```

Bytes per sprite instance in a `SpriteBatch` (`INSTANCE_WORDS` × 4).

Value: `INSTANCE_WORDS * 4`

<sub>src/batch.js:17</sub>

### `INSTANCE_WORDS`

```js
const INSTANCE_WORDS
```

Every backend draws the same instance buffer: one quad per sprite, 11 words
(44 bytes) each, so switching renderer changes only upload and draw calls.

 word 0-1  x, y        centre in world units
 word 2-3  w, h        size in world units (a negative w draws the sprite mirrored left to right)
 word 4    rotation    radians
 word 5-8  u0 v0 u1 v1 atlas rectangle, normalised 0..1
 word 9    tint        RGBA8, little-endian (R in the lowest byte); see packTint
 word 10   meta        atlas page in bits 0-7, flags above: bit 8 = signed-distance-field sprite (text), bit 9 = ignores 2D lighting

Draw order is push order unless sprites are given a sort key (see `push` and `sort`). The key is NOT part of the
instance data: it lives in a parallel array and never reaches the GPU.

Value: `11`

<sub>src/batch.js:15</sub>

### `KTX2_FORMATS`

```js
const KTX2_FORMATS
```

The formats read, by their Vulkan format number (what a KTX2 file names its format with).
`gpu` is the format name for WebGPU; `block` is the width and height in pixels of a block (1 for uncompressed) and `bytes` the bytes in one block (or pixel).

Value: `Object.freeze({`

<sub>src/ktx2.js:18</sub>

### `Light2D`

```js
const Light2D
```

Light descriptions. Each is a plain object: change `x`, `y`, `color`, `intensity` and the rest between frames.
`height` is how far the light hangs above the picture (in world units): low lights rake across relief, high ones light it from above.

Value: `{`

<sub>src/lighting.js:41</sub>

### `MATERIAL_FLOATS`

```js
const MATERIAL_FLOATS
```

Floats per material in the packed table the renderers read (five vec4s).

Value: `20`

<sub>src/materials.js:21</sub>

### `MAX_GRADIENT_STOPS`

```js
const MAX_GRADIENT_STOPS
```

Largest number of colour stops in a gradient map.

Value: `8`

<sub>src/filters.js:16</sub>

### `MAX_LIGHTS`

```js
const MAX_LIGHTS
```

Most lights drawn at once (extra ones are dropped, farthest from the screen's middle first).

Value: `64`

<sub>src/lighting.js:19</sub>

### `MAX_LOCAL_SHADOW_LAYERS`

```js
const MAX_LOCAL_SHADOW_LAYERS
```

Most layers of local shadow map a frame can use: a spot light takes one, a point light six (one per face of a cube).

Value: `12`

<sub>src/shadow.js:119</sub>

### `MAX_MATERIALS`

```js
const MAX_MATERIALS
```

The most materials a set can hold (numbers 1 to 127; 0 means "no material": the simple lighting).

Value: `127`

<sub>src/materials.js:19</sub>

### `MAX_POINT_LIGHTS`

```js
const MAX_POINT_LIGHTS
```

Most point lights a frame can use (the renderers read the first 32 of `lighting.pointLights`).

Value: `32`

<sub>src/drawlist.js:15</sub>

### `MAX_SHADOW_LIGHTS`

```js
const MAX_SHADOW_LIGHTS
```

Most lights that can cast shadows at once (the rest still light, without shadows).

Value: `16`

<sub>src/lighting.js:21</sub>

### `MAX_WAVES`

```js
const MAX_WAVES
```

Waves that add up in one style.

Value: `4`

<sub>src/water.js:22</sub>

### `MESH_VERTEX_BYTES`

```js
const MESH_VERTEX_BYTES
```

Bytes per vertex in a `MeshBatch2D`.

Value: `MESH_VERTEX_WORDS * 4`

<sub>src/meshbatch.js:17</sub>

### `MESH_VERTEX_WORDS`

```js
const MESH_VERTEX_WORDS
```

Flat triangles for the 2D renderers: whatever a quad cannot do (a deforming skeleton mesh, a rope, a flag, a torn sprite). Every vertex has a position in world units, a place in the atlas,
a tint and an atlas page, so one `MeshBatch2D` is one draw call whatever it holds. Draw it with `renderer.render({ camera, batch, meshes })`: meshes are drawn after the sprites of the
same call (use `renderLayers` to interleave).

Each vertex is 6 words (24 bytes):

 word 0-1  x, y      position in world units
 word 2-3  u, v      position in the atlas page, 0..1 (use the sprite's `u0 v0 u1 v1` range)
 word 4    tint      RGBA8, see `packTint` (straight alpha; the shader premultiplies)
 word 5    meta      atlas page in bits 0-7; bit 10 = additive (the colour is added to what is behind it instead of covering it)

Value: `6`

<sub>src/meshbatch.js:15</sub>

### `META_ADDITIVE`

```js
const META_ADDITIVE
```

Flag in the vertex meta word: the mesh adds its light to the picture instead of covering it.

Value: `1024`

<sub>src/meshbatch.js:19</sub>

### `META_SDF`

```js
const META_SDF
```

Flag in the instance meta word: the sprite is a signed distance field (anti-aliased by threshold in the shader).

Value: `256`

<sub>src/batch.js:23</sub>

### `ORIENT`

```js
const ORIENT
```

How a particle is oriented.

Value: `Object.freeze({ billboard: 0, stretch: 1, flat: 2 })`

<sub>src/particles.js:12</sub>

### `PARTICLE_FLOATS`

```js
const PARTICLE_FLOATS
```

Floats per particle: four vec4s.

Value: `16`

<sub>src/particles.js:6</sub>

### `SHADOW_ANGLES`

```js
const SHADOW_ANGLES
```

Directions in each shadow-casting light's shadow map.

Value: `512`

<sub>src/lighting.js:23</sub>

### `SKINNED_INSTANCE_BYTES`

```js
const SKINNED_INSTANCE_BYTES
```

Bytes per instance of a skinned mesh in a draw list.

Value: `SKINNED_INSTANCE_FLOATS * 4`

<sub>src/drawlist.js:12</sub>

### `SKINNED_INSTANCE_FLOATS`

```js
const SKINNED_INSTANCE_FLOATS
```

Skinned instances have a vec4 after the colour whose x is where the instance's palette starts (in matrices; the renderer fills it in), then the material.

Value: `28`

<sub>src/drawlist.js:10</sub>

### `SKIN_BYTES`

```js
const SKIN_BYTES
```

Bytes of skinning data per vertex (joint indices and weights).

Value: `SKIN_FLOATS * 4`

<sub>src/mesh.js:47</sub>

### `SKIN_FLOATS`

```js
const SKIN_FLOATS
```

Floats of skinning data per vertex (4 joint indices and 4 weights).

Value: `8`

<sub>src/mesh.js:45</sub>

### `SKY_BLOCK_AT`

```js
const SKY_BLOCK_AT
```

Where the sky block starts in the uniform table (after the environment's own sixteen).

Value: `ENV_BLOCK_AT + 16`

<sub>src/sky.js:32</sub>

### `SKY_BLOCK_VEC4S`

```js
const SKY_BLOCK_VEC4S
```

Vec4s of the sky block in the renderers' uniform table.

Value: `8`

<sub>src/sky.js:30</sub>

### `TEXTURE_FORMATS`

```js
const TEXTURE_FORMATS
```

The format names a texture set can hold.

Value: `Object.freeze(['rgba8', 'bc1', 'bc3', 'bc7', 'etc2', 'astc4x4'])`

<sub>src/ktx2.js:36</sub>

### `TONEMAPS`

```js
const TONEMAPS
```

Tone mapping choices for post-processing: `none`, `reinhard`, `aces`, `filmic`.

Value: `Object.freeze({ none: 0, reinhard: 1, aces: 2, filmic: 3 })`

<sub>src/post.js:6</sub>

### `VERTEX_BYTES`

```js
const VERTEX_BYTES
```

Bytes per mesh vertex (`VERTEX_FLOATS` × 4).

Value: `VERTEX_FLOATS * 4`

<sub>src/mesh.js:19</sub>

### `VERTEX_FLOATS`

```js
const VERTEX_FLOATS
```

A triangle mesh ready for the 3D renderers: interleaved vertices (position xyz, normal xyz: 6 floats) and 32-bit indices.
Right-handed, +y up, counter-clockwise triangles face outward.

Value: `6`

**Properties**

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `vertices` | `Float32Array` | 6 floats per vertex: x, y, z, nx, ny, nz |
| `indices` | `Uint32Array` | 3 per triangle |
| `vertexCount` | `number` |  |
| `min` | `number[]` | Bounding box corner |
| `max` | `number[]` |  |
| `uv` (optional) | `Float32Array` | Optional texture coordinates, 2 floats per vertex. (0, 0) is the top left of the image (the first row of its data), as in glTF. |
| `skin` (optional) | `Float32Array` | Skinned meshes only: 8 floats per vertex, four joint indices then four weights (see `createSkinnedMesh`) |
| `jointCount` (optional) | `number` | Skinned meshes only: how many joints the skin refers to |

<sub>src/mesh.js:17</sub>

### `WATER_BLOCK_AT`

```js
const WATER_BLOCK_AT
```

Where the water block starts in the uniform table (after the sky's).

Value: `SKY_BLOCK_AT + SKY_BLOCK_VEC4S`

<sub>src/water.js:28</sub>

### `WATER_BLOCK_VEC4S`

```js
const WATER_BLOCK_VEC4S
```

Vec4s of the whole water block: every style, then one more for settings shared by all.

Value: `WATER_STYLES * WATER_STYLE_VEC4S + 1`

<sub>src/water.js:26</sub>

### `WATER_STYLES`

```js
const WATER_STYLES
```

Water styles a frame can use at once.

Value: `4`

<sub>src/water.js:20</sub>

### `WHITE`

```js
const WHITE
```

Opaque white: leaves the sprite's own colours unchanged.

Value: `0xffffffff`

<sub>src/batch.js:29</sub>

## Types

### `AtlasPage`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `canvas` | `any` |  |
| `ctx` | `any` |  |
| `packer` | `ShelfPacker` |  |
| `version` | `number` | Bumps whenever this page changes, so renderers re-upload only the pages that did. |
| `normals` | `{canvas: any, ctx: any, version: number} \| null` | This page's normal-map twin (same size, same rectangles), once the atlas has any normal maps. |

### `Atom`

One character of styled text.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `text` | `string` | The character (a whole cluster). |
| `style` | `{typeface: any, scale?: number, tint?: number, shadow?: {dx?: number, dy?: number, tint?: number} \| null, outline?: {width: number, tint?: number} \| null, underline?: boolean, strike?: boolean, link?: string \| null, effect?: {type: string} \| null, align?: string}` | Atoms of one styled stretch share one style object (shadow and outline sizes are in world units). |
| `image` (optional) | `{sprite: any, w: number, h: number, valign?: 'baseline' \| 'middle' \| 'top', dy?: number}` | An inline picture (the `text` is then a placeholder). |

### `Environment`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `size` | `number` | Texels per side of the sharpest cube |
| `levels` | `{size: number, faces: Float32Array[]}[]` | The prefiltered chain: level 0 is the environment itself, level k is blurred for roughness k / (levels - 1); faces are RGB floats, six of them |
| `sh` | `Float32Array` | Nine spherical harmonic colours (vec4 each, alpha unused), already scaled so the diffuse light facing n is `sh(n)` (see `environmentIrradiance`) |
| `maxLod` | `number` | The last level (the roughest) |
| `id` | `number` | Different for every environment made, so a renderer can tell when it has been given a new one |

### `GltfImage`

glTF 2.0 and GLB loading: triangle meshes with positions, optional normals and indices, a base colour per material, the
node hierarchy (transforms), and skeletal animation (skins with joint weights, and translation/rotation/scale clips for the
joints). Right-handed, +y up, the same conventions as the engine.

Materials: every material is read in full, the way glTF describes a surface: base colour, metallic and roughness, and the five kinds of picture
(base colour, metallic-roughness, normal, occlusion, emissive), with the factors that multiply them, the alpha mode (opaque, cut-out or blended) and
`KHR_materials_emissive_strength`. `loadGltfTextures` decodes the images into a `TextureSet`, `loadGltfMaterials` turns the materials into a `MaterialSet`,
and `addGltfToDrawList` then draws with physically based lighting; without those two calls a model is drawn as before, with its base colour and base
colour picture under the simple lighting. Texture coordinates (`TEXCOORD_0`) are read. Not supported (reported in `warnings`, or thrown when the file
cannot be read at all): a second set of coordinates, texture transforms and samplers (images always repeat and are filtered), double-sided surfaces
(drawn single-sided), sorting of blended surfaces, animations of plain nodes (only skin joints and morph weights animate), cameras and lights;
cubic-spline animation is read as linear; Draco compression throws. Sparse accessors are read. **Morph targets** (blend shapes: positions and normals, with the starting weights
and names) are read onto each instance's `morph`; `createGltfMorph(instance)` turns them into a `MorphTargets` you set weights on, and `model.morphClips` holds the file's weight animations.

Compressed models are read: `EXT_meshopt_compression` (what `gltfpack` writes; see `meshopt.js`, no WebAssembly needed) and `KHR_mesh_quantization` (positions, normals and
coordinates stored as 8 or 16-bit numbers, which is only a matter of reading them as they are, and of the node's scale putting positions back).

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `mesh` | `import('./mesh.js').Mesh` |  |
| `matrix` | `Float32Array` | World matrix of the node that carries the mesh (column-major). |
| `color` | `number[]` | Base colour factor RGBA. |
| `name` | `string` |  |
| `image` (optional) | `number` | Index into `images` of the base colour texture, if the material has one |
| `material` (optional) | `number` | Index into `materials` of the instance's material, when the primitive has one |
| `textured` (optional) | `boolean` | Whether the mesh has texture coordinates (without them the material's pictures cannot be used) |
| `skin` (optional) | `number` | Index into `skins` for a skinned mesh (its `matrix` is the identity: glTF ignores the node's transform for skins) |
| `node` (optional) | `number` | Index of the glTF node that carries the mesh (it matches `morphClips[].node`) |
| `morph` (optional) | `{targets: import('./morph.js').MorphTarget[], weights: number[]}` | The morph targets of the mesh and their starting weights; `createGltfMorph(instance)` makes them usable |
| `name` | `string` |  |
| `baseColor` | `number[]` | RGBA factor (linear) |
| `metallic` | `number` | Factor (glTF's default is 1) |
| `roughness` | `number` | Factor (glTF's default is 1) |
| `normalScale` | `number` |  |
| `occlusionStrength` | `number` |  |
| `emissive` | `number[]` | RGB (already multiplied by `KHR_materials_emissive_strength`) |
| `alphaMode` | `'OPAQUE' \| 'MASK' \| 'BLEND'` |  |
| `alphaCutoff` | `number` | For `MASK` |
| `images` | `{base?: number, metallicRoughness?: number, normal?: number, occlusion?: number, emissive?: number}` | Indices into `images`, for the pictures the material uses |
| `name` | `string` |  |
| `mimeType` | `string` | e.g. image/png |
| `bytes` | `Uint8Array \| null` | The encoded file (PNG, JPEG...), or null when it is a separate file `uri` still to be fetched (`loadGltf` does that) |
| `uri` | `string \| null` |  |
| `name` | `string` |  |
| `skeleton` | `import('./skeleton.js').Skeleton` |  |
| `clips` | `import('./skeleton.js').AnimationClip[]` | The file's animations, as far as they drive this skin's joints |
| `meshes` | `import('./mesh.js').Mesh[]` | One per primitive |
| `instances` | `GltfInstance[]` | What to draw to see the scene |
| `skins` | `GltfSkin[]` |  |
| `materials` | `GltfMaterial[]` |  |
| `morphClips` | `{name: string, node: number, clip: import('./morph.js').MorphClip}[]` | The file's animations of morph weights, with the glTF node they drive |
| `images` | `GltfImage[]` | Images referred to by materials (decode them with `loadGltfTextures`) |
| `warnings` | `string[]` | Things in the file that were ignored |

### `GltfInstance`

glTF 2.0 and GLB loading: triangle meshes with positions, optional normals and indices, a base colour per material, the
node hierarchy (transforms), and skeletal animation (skins with joint weights, and translation/rotation/scale clips for the
joints). Right-handed, +y up, the same conventions as the engine.

Materials: every material is read in full, the way glTF describes a surface: base colour, metallic and roughness, and the five kinds of picture
(base colour, metallic-roughness, normal, occlusion, emissive), with the factors that multiply them, the alpha mode (opaque, cut-out or blended) and
`KHR_materials_emissive_strength`. `loadGltfTextures` decodes the images into a `TextureSet`, `loadGltfMaterials` turns the materials into a `MaterialSet`,
and `addGltfToDrawList` then draws with physically based lighting; without those two calls a model is drawn as before, with its base colour and base
colour picture under the simple lighting. Texture coordinates (`TEXCOORD_0`) are read. Not supported (reported in `warnings`, or thrown when the file
cannot be read at all): a second set of coordinates, texture transforms and samplers (images always repeat and are filtered), double-sided surfaces
(drawn single-sided), sorting of blended surfaces, animations of plain nodes (only skin joints and morph weights animate), cameras and lights;
cubic-spline animation is read as linear; Draco compression throws. Sparse accessors are read. **Morph targets** (blend shapes: positions and normals, with the starting weights
and names) are read onto each instance's `morph`; `createGltfMorph(instance)` turns them into a `MorphTargets` you set weights on, and `model.morphClips` holds the file's weight animations.

Compressed models are read: `EXT_meshopt_compression` (what `gltfpack` writes; see `meshopt.js`, no WebAssembly needed) and `KHR_mesh_quantization` (positions, normals and
coordinates stored as 8 or 16-bit numbers, which is only a matter of reading them as they are, and of the node's scale putting positions back).

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `mesh` | `import('./mesh.js').Mesh` |  |
| `matrix` | `Float32Array` | World matrix of the node that carries the mesh (column-major). |
| `color` | `number[]` | Base colour factor RGBA. |
| `name` | `string` |  |
| `image` (optional) | `number` | Index into `images` of the base colour texture, if the material has one |
| `material` (optional) | `number` | Index into `materials` of the instance's material, when the primitive has one |
| `textured` (optional) | `boolean` | Whether the mesh has texture coordinates (without them the material's pictures cannot be used) |
| `skin` (optional) | `number` | Index into `skins` for a skinned mesh (its `matrix` is the identity: glTF ignores the node's transform for skins) |
| `node` (optional) | `number` | Index of the glTF node that carries the mesh (it matches `morphClips[].node`) |
| `morph` (optional) | `{targets: import('./morph.js').MorphTarget[], weights: number[]}` | The morph targets of the mesh and their starting weights; `createGltfMorph(instance)` makes them usable |
| `name` | `string` |  |
| `baseColor` | `number[]` | RGBA factor (linear) |
| `metallic` | `number` | Factor (glTF's default is 1) |
| `roughness` | `number` | Factor (glTF's default is 1) |
| `normalScale` | `number` |  |
| `occlusionStrength` | `number` |  |
| `emissive` | `number[]` | RGB (already multiplied by `KHR_materials_emissive_strength`) |
| `alphaMode` | `'OPAQUE' \| 'MASK' \| 'BLEND'` |  |
| `alphaCutoff` | `number` | For `MASK` |
| `images` | `{base?: number, metallicRoughness?: number, normal?: number, occlusion?: number, emissive?: number}` | Indices into `images`, for the pictures the material uses |
| `name` | `string` |  |
| `mimeType` | `string` | e.g. image/png |
| `bytes` | `Uint8Array \| null` | The encoded file (PNG, JPEG...), or null when it is a separate file `uri` still to be fetched (`loadGltf` does that) |
| `uri` | `string \| null` |  |
| `name` | `string` |  |
| `skeleton` | `import('./skeleton.js').Skeleton` |  |
| `clips` | `import('./skeleton.js').AnimationClip[]` | The file's animations, as far as they drive this skin's joints |
| `meshes` | `import('./mesh.js').Mesh[]` | One per primitive |
| `instances` | `GltfInstance[]` | What to draw to see the scene |
| `skins` | `GltfSkin[]` |  |
| `materials` | `GltfMaterial[]` |  |
| `morphClips` | `{name: string, node: number, clip: import('./morph.js').MorphClip}[]` | The file's animations of morph weights, with the glTF node they drive |
| `images` | `GltfImage[]` | Images referred to by materials (decode them with `loadGltfTextures`) |
| `warnings` | `string[]` | Things in the file that were ignored |

### `GltfMaterial`

A material as the file describes it (see `loadGltfMaterials` to make it drawable)

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `mesh` | `import('./mesh.js').Mesh` |  |
| `matrix` | `Float32Array` | World matrix of the node that carries the mesh (column-major). |
| `color` | `number[]` | Base colour factor RGBA. |
| `name` | `string` |  |
| `image` (optional) | `number` | Index into `images` of the base colour texture, if the material has one |
| `material` (optional) | `number` | Index into `materials` of the instance's material, when the primitive has one |
| `textured` (optional) | `boolean` | Whether the mesh has texture coordinates (without them the material's pictures cannot be used) |
| `skin` (optional) | `number` | Index into `skins` for a skinned mesh (its `matrix` is the identity: glTF ignores the node's transform for skins) |
| `node` (optional) | `number` | Index of the glTF node that carries the mesh (it matches `morphClips[].node`) |
| `morph` (optional) | `{targets: import('./morph.js').MorphTarget[], weights: number[]}` | The morph targets of the mesh and their starting weights; `createGltfMorph(instance)` makes them usable |
| `name` | `string` |  |
| `baseColor` | `number[]` | RGBA factor (linear) |
| `metallic` | `number` | Factor (glTF's default is 1) |
| `roughness` | `number` | Factor (glTF's default is 1) |
| `normalScale` | `number` |  |
| `occlusionStrength` | `number` |  |
| `emissive` | `number[]` | RGB (already multiplied by `KHR_materials_emissive_strength`) |
| `alphaMode` | `'OPAQUE' \| 'MASK' \| 'BLEND'` |  |
| `alphaCutoff` | `number` | For `MASK` |
| `images` | `{base?: number, metallicRoughness?: number, normal?: number, occlusion?: number, emissive?: number}` | Indices into `images`, for the pictures the material uses |
| `name` | `string` |  |
| `mimeType` | `string` | e.g. image/png |
| `bytes` | `Uint8Array \| null` | The encoded file (PNG, JPEG...), or null when it is a separate file `uri` still to be fetched (`loadGltf` does that) |
| `uri` | `string \| null` |  |
| `name` | `string` |  |
| `skeleton` | `import('./skeleton.js').Skeleton` |  |
| `clips` | `import('./skeleton.js').AnimationClip[]` | The file's animations, as far as they drive this skin's joints |
| `meshes` | `import('./mesh.js').Mesh[]` | One per primitive |
| `instances` | `GltfInstance[]` | What to draw to see the scene |
| `skins` | `GltfSkin[]` |  |
| `materials` | `GltfMaterial[]` |  |
| `morphClips` | `{name: string, node: number, clip: import('./morph.js').MorphClip}[]` | The file's animations of morph weights, with the glTF node they drive |
| `images` | `GltfImage[]` | Images referred to by materials (decode them with `loadGltfTextures`) |
| `warnings` | `string[]` | Things in the file that were ignored |

### `GltfResult`

glTF 2.0 and GLB loading: triangle meshes with positions, optional normals and indices, a base colour per material, the
node hierarchy (transforms), and skeletal animation (skins with joint weights, and translation/rotation/scale clips for the
joints). Right-handed, +y up, the same conventions as the engine.

Materials: every material is read in full, the way glTF describes a surface: base colour, metallic and roughness, and the five kinds of picture
(base colour, metallic-roughness, normal, occlusion, emissive), with the factors that multiply them, the alpha mode (opaque, cut-out or blended) and
`KHR_materials_emissive_strength`. `loadGltfTextures` decodes the images into a `TextureSet`, `loadGltfMaterials` turns the materials into a `MaterialSet`,
and `addGltfToDrawList` then draws with physically based lighting; without those two calls a model is drawn as before, with its base colour and base
colour picture under the simple lighting. Texture coordinates (`TEXCOORD_0`) are read. Not supported (reported in `warnings`, or thrown when the file
cannot be read at all): a second set of coordinates, texture transforms and samplers (images always repeat and are filtered), double-sided surfaces
(drawn single-sided), sorting of blended surfaces, animations of plain nodes (only skin joints and morph weights animate), cameras and lights;
cubic-spline animation is read as linear; Draco compression throws. Sparse accessors are read. **Morph targets** (blend shapes: positions and normals, with the starting weights
and names) are read onto each instance's `morph`; `createGltfMorph(instance)` turns them into a `MorphTargets` you set weights on, and `model.morphClips` holds the file's weight animations.

Compressed models are read: `EXT_meshopt_compression` (what `gltfpack` writes; see `meshopt.js`, no WebAssembly needed) and `KHR_mesh_quantization` (positions, normals and
coordinates stored as 8 or 16-bit numbers, which is only a matter of reading them as they are, and of the node's scale putting positions back).

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `mesh` | `import('./mesh.js').Mesh` |  |
| `matrix` | `Float32Array` | World matrix of the node that carries the mesh (column-major). |
| `color` | `number[]` | Base colour factor RGBA. |
| `name` | `string` |  |
| `image` (optional) | `number` | Index into `images` of the base colour texture, if the material has one |
| `material` (optional) | `number` | Index into `materials` of the instance's material, when the primitive has one |
| `textured` (optional) | `boolean` | Whether the mesh has texture coordinates (without them the material's pictures cannot be used) |
| `skin` (optional) | `number` | Index into `skins` for a skinned mesh (its `matrix` is the identity: glTF ignores the node's transform for skins) |
| `node` (optional) | `number` | Index of the glTF node that carries the mesh (it matches `morphClips[].node`) |
| `morph` (optional) | `{targets: import('./morph.js').MorphTarget[], weights: number[]}` | The morph targets of the mesh and their starting weights; `createGltfMorph(instance)` makes them usable |
| `name` | `string` |  |
| `baseColor` | `number[]` | RGBA factor (linear) |
| `metallic` | `number` | Factor (glTF's default is 1) |
| `roughness` | `number` | Factor (glTF's default is 1) |
| `normalScale` | `number` |  |
| `occlusionStrength` | `number` |  |
| `emissive` | `number[]` | RGB (already multiplied by `KHR_materials_emissive_strength`) |
| `alphaMode` | `'OPAQUE' \| 'MASK' \| 'BLEND'` |  |
| `alphaCutoff` | `number` | For `MASK` |
| `images` | `{base?: number, metallicRoughness?: number, normal?: number, occlusion?: number, emissive?: number}` | Indices into `images`, for the pictures the material uses |
| `name` | `string` |  |
| `mimeType` | `string` | e.g. image/png |
| `bytes` | `Uint8Array \| null` | The encoded file (PNG, JPEG...), or null when it is a separate file `uri` still to be fetched (`loadGltf` does that) |
| `uri` | `string \| null` |  |
| `name` | `string` |  |
| `skeleton` | `import('./skeleton.js').Skeleton` |  |
| `clips` | `import('./skeleton.js').AnimationClip[]` | The file's animations, as far as they drive this skin's joints |
| `meshes` | `import('./mesh.js').Mesh[]` | One per primitive |
| `instances` | `GltfInstance[]` | What to draw to see the scene |
| `skins` | `GltfSkin[]` |  |
| `materials` | `GltfMaterial[]` |  |
| `morphClips` | `{name: string, node: number, clip: import('./morph.js').MorphClip}[]` | The file's animations of morph weights, with the glTF node they drive |
| `images` | `GltfImage[]` | Images referred to by materials (decode them with `loadGltfTextures`) |
| `warnings` | `string[]` | Things in the file that were ignored |

### `GltfSkin`

glTF 2.0 and GLB loading: triangle meshes with positions, optional normals and indices, a base colour per material, the
node hierarchy (transforms), and skeletal animation (skins with joint weights, and translation/rotation/scale clips for the
joints). Right-handed, +y up, the same conventions as the engine.

Materials: every material is read in full, the way glTF describes a surface: base colour, metallic and roughness, and the five kinds of picture
(base colour, metallic-roughness, normal, occlusion, emissive), with the factors that multiply them, the alpha mode (opaque, cut-out or blended) and
`KHR_materials_emissive_strength`. `loadGltfTextures` decodes the images into a `TextureSet`, `loadGltfMaterials` turns the materials into a `MaterialSet`,
and `addGltfToDrawList` then draws with physically based lighting; without those two calls a model is drawn as before, with its base colour and base
colour picture under the simple lighting. Texture coordinates (`TEXCOORD_0`) are read. Not supported (reported in `warnings`, or thrown when the file
cannot be read at all): a second set of coordinates, texture transforms and samplers (images always repeat and are filtered), double-sided surfaces
(drawn single-sided), sorting of blended surfaces, animations of plain nodes (only skin joints and morph weights animate), cameras and lights;
cubic-spline animation is read as linear; Draco compression throws. Sparse accessors are read. **Morph targets** (blend shapes: positions and normals, with the starting weights
and names) are read onto each instance's `morph`; `createGltfMorph(instance)` turns them into a `MorphTargets` you set weights on, and `model.morphClips` holds the file's weight animations.

Compressed models are read: `EXT_meshopt_compression` (what `gltfpack` writes; see `meshopt.js`, no WebAssembly needed) and `KHR_mesh_quantization` (positions, normals and
coordinates stored as 8 or 16-bit numbers, which is only a matter of reading them as they are, and of the node's scale putting positions back).

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `mesh` | `import('./mesh.js').Mesh` |  |
| `matrix` | `Float32Array` | World matrix of the node that carries the mesh (column-major). |
| `color` | `number[]` | Base colour factor RGBA. |
| `name` | `string` |  |
| `image` (optional) | `number` | Index into `images` of the base colour texture, if the material has one |
| `material` (optional) | `number` | Index into `materials` of the instance's material, when the primitive has one |
| `textured` (optional) | `boolean` | Whether the mesh has texture coordinates (without them the material's pictures cannot be used) |
| `skin` (optional) | `number` | Index into `skins` for a skinned mesh (its `matrix` is the identity: glTF ignores the node's transform for skins) |
| `node` (optional) | `number` | Index of the glTF node that carries the mesh (it matches `morphClips[].node`) |
| `morph` (optional) | `{targets: import('./morph.js').MorphTarget[], weights: number[]}` | The morph targets of the mesh and their starting weights; `createGltfMorph(instance)` makes them usable |
| `name` | `string` |  |
| `baseColor` | `number[]` | RGBA factor (linear) |
| `metallic` | `number` | Factor (glTF's default is 1) |
| `roughness` | `number` | Factor (glTF's default is 1) |
| `normalScale` | `number` |  |
| `occlusionStrength` | `number` |  |
| `emissive` | `number[]` | RGB (already multiplied by `KHR_materials_emissive_strength`) |
| `alphaMode` | `'OPAQUE' \| 'MASK' \| 'BLEND'` |  |
| `alphaCutoff` | `number` | For `MASK` |
| `images` | `{base?: number, metallicRoughness?: number, normal?: number, occlusion?: number, emissive?: number}` | Indices into `images`, for the pictures the material uses |
| `name` | `string` |  |
| `mimeType` | `string` | e.g. image/png |
| `bytes` | `Uint8Array \| null` | The encoded file (PNG, JPEG...), or null when it is a separate file `uri` still to be fetched (`loadGltf` does that) |
| `uri` | `string \| null` |  |
| `name` | `string` |  |
| `skeleton` | `import('./skeleton.js').Skeleton` |  |
| `clips` | `import('./skeleton.js').AnimationClip[]` | The file's animations, as far as they drive this skin's joints |
| `meshes` | `import('./mesh.js').Mesh[]` | One per primitive |
| `instances` | `GltfInstance[]` | What to draw to see the scene |
| `skins` | `GltfSkin[]` |  |
| `materials` | `GltfMaterial[]` |  |
| `morphClips` | `{name: string, node: number, clip: import('./morph.js').MorphClip}[]` | The file's animations of morph weights, with the glTF node they drive |
| `images` | `GltfImage[]` | Images referred to by materials (decode them with `loadGltfTextures`) |
| `warnings` | `string[]` | Things in the file that were ignored |

### `ImageLike`

RGBA bytes, row 0 at the top (an `ImageData` fits)

Type: `{width: number, height: number, data: ArrayLike<number>}`

### `LayoutItem`

One positioned thing: a glyph (or shaped word) or a picture.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `x` | `number` | Left edge of the advance, world units from the layout's left edge. |
| `y` | `number` | Baseline, world units from the top of the layout. |
| `glyph` | `any` | `{sprite, advance, ox, oy}` |
| `style` | `any` |  |
| `u` | `number` | World units per raster pixel for this item. |
| `atom` | `number` | Index of its first atom in the paragraph (for typewriter reveals and effects). |
| `count` | `number` | Atoms it covers. |
| `width` | `number` | World units. |
| `space` | `boolean` |  |
| `line` | `number` |  |
| `image` (optional) | `any` |  |

### `LocalShadowOptions`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `size` (optional) | `number` | Resolution of each layer in texels per side (default 1024). |
| `layers` (optional) | `number` | Layers in the budget, up to 12 (default 12): twelve spot lights, or two point lights, or any mix that fits. |
| `bias` (optional) | `number` | How far, in metres, a surface is moved toward the light before it is compared with the map (default 0.03). Raise it if surfaces shadow themselves. |
| `strength` (optional) | `number` | 0..1, how dark local shadows are (default 0.9). |

### `Lod`

Several versions of one thing, from most to least detailed, with the size on screen at which each takes over.

Type: `{levels: {mesh: import('./mesh.js').Mesh, below: number}[], cullBelow: number, radius: number, center: number[], name: string}`

### `MaterialSpec`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `name` (optional) | `string` |  |
| `baseColor` (optional) | `number[]` | RGBA, 0 to 1, in linear light as glTF writes it (default white). Multiplies the picture and the instance's colour. |
| `baseColorTexture` (optional) | `number` | Layer holding the base colour (sRGB, with alpha), or -1 |
| `metallic` (optional) | `number` | 0 is plastic or stone, 1 is bare metal (default 0) |
| `roughness` (optional) | `number` | 0 is a mirror, 1 is chalk (default 0.5) |
| `metallicRoughnessTexture` (optional) | `number` | Layer whose green is roughness and blue is metalness (both multiply the numbers above), or -1 |
| `normalTexture` (optional) | `number` | Layer holding a tangent-space normal map (green is up, as in glTF), or -1 |
| `normalScale` (optional) | `number` | How strong the bumps are (default 1) |
| `occlusionTexture` (optional) | `number` | Layer whose red is how much ambient light reaches each point (1 fully), or -1 |
| `occlusionStrength` (optional) | `number` | 0 ignores the occlusion picture, 1 uses it fully (default 1) |
| `emissive` (optional) | `number[]` | RGB the surface gives off by itself, in linear light (default black); values above 1 glow more |
| `emissiveTexture` (optional) | `number` | Layer holding the emissive picture (sRGB), or -1 |
| `alphaCutoff` (optional) | `number` | 0 means the surface is not cut out; above 0, pixels whose alpha is below it are not drawn at all (leaves, fences) |
| `uvScale` (optional) | `number` | How many times the pictures repeat over the mesh's texture coordinates (default 1) |
| `opaque` (optional) | `boolean` | Ignore the alpha of the base colour and its picture (a PNG with alpha used as plain colour); glTF's `OPAQUE` mode. Default false |

### `Mesh`

A triangle mesh ready for the 3D renderers: interleaved vertices (position xyz, normal xyz: 6 floats) and 32-bit indices.
Right-handed, +y up, counter-clockwise triangles face outward.

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `vertices` | `Float32Array` | 6 floats per vertex: x, y, z, nx, ny, nz |
| `indices` | `Uint32Array` | 3 per triangle |
| `vertexCount` | `number` |  |
| `min` | `number[]` | Bounding box corner |
| `max` | `number[]` |  |
| `uv` (optional) | `Float32Array` | Optional texture coordinates, 2 floats per vertex. (0, 0) is the top left of the image (the first row of its data), as in glTF. |
| `skin` (optional) | `Float32Array` | Skinned meshes only: 8 floats per vertex, four joint indices then four weights (see `createSkinnedMesh`) |
| `jointCount` (optional) | `number` | Skinned meshes only: how many joints the skin refers to |

### `MorphTarget`

Offsets: 3 floats per vertex

Type: `{position: Float32Array, normal?: Float32Array \| null, name?: string}`

### `PostOptions`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `bloom` (optional) | `false \| {threshold?: number, knee?: number, intensity?: number, levels?: number, radius?: number}` | Glow around bright areas. `threshold` is the brightness above which things glow (default 0.85), `knee` how softly it starts (0.5), `intensity` how much is added back (0.5), `levels` how many times the image is halved (5; more levels, wider glow), `radius` scales the blur (1). |
| `exposure` (optional) | `number` | Brightness multiplier before tone mapping (1). |
| `tonemap` (optional) | `'none' \| 'reinhard' \| 'aces' \| 'filmic'` | How values above 1 are squeezed into the displayable range ('aces'). |
| `contrast` (optional) | `number` | 1 = unchanged; more pushes darks and lights apart, around mid grey. |
| `saturation` (optional) | `number` | 1 = unchanged, 0 = grey, above 1 = more vivid. |
| `lift` (optional) | `number[]` | [r, g, b] added to the dark end (0, 0, 0). `gamma`: mid-tone power per channel (1, 1, 1). `gain`: multiplier per channel (1, 1, 1): the colour grade. |
| `gamma` (optional) | `number[]` |  |
| `gain` (optional) | `number[]` |  |
| `vignette` (optional) | `false \| {strength?: number, radius?: number}` | Darkened corners; `radius` is where it starts, 0 (centre) to 1 (corner) (0.55). |
| `dither` (optional) | `number` | Noise of this many 1/255 steps, hiding banding in smooth gradients (1; 0 turns it off). |
| `ao` (optional) | `boolean \| {radius?: number, intensity?: number, bias?: number, power?: number, samples?: number, scale?: number}` | Ambient occlusion (off unless given): creases, contact points and the undersides of things get darker, as they would with light bouncing around. `radius` is how far, in world units, it looks for things in the way (0.5), `intensity` 0..1 how dark it goes (1), `power` how sharply (1.5), `bias` the depth difference ignored so that flat surfaces do not shade themselves (0.03), `samples` the quality (12; 4 to 32), `scale` the size of the working image as a fraction of the screen (1; 0.5 is four times cheaper and a little softer). It darkens the lit picture (not only the ambient light), so keep it subtle on bright scenes. |
| `dof` (optional) | `boolean \| {focus?: number, range?: number, aperture?: number, maxBlur?: number, taps?: number}` | Depth of field (off unless given): things away from the `focus` distance (world units from the camera, 10) blur. `range` is the depth either side of the focus that stays sharp (0), `aperture` how fast the blur grows with the distance from the focus (1), `maxBlur` the largest blur radius in pixels (8), `taps` the quality (24; 8 to 64). |
| `heat` (optional) | `{x: number, y: number, radius: number, strength?: number}[]` | Heat haze (off unless given): the picture shimmers and wobbles round up to 16 hot places, such as an exhaust, a fire or a blast. `x` and `y` are where the place is on the screen, 0 to 1 from the left and from the top; `radius` how far the haze reaches, as a share of the screen's height; `strength` how far the picture is pushed at the middle, as a share of the screen's height (0.004, a few pixels, if left out). The haze fades smoothly to nothing at the edge of the radius. It is a distortion of the finished scene (nothing is hidden behind it, and a hot place behind a wall still shimmers: the caller decides which places to give). |
| `heatTime` (optional) | `number` | The clock of the shimmer, in seconds (0): give the time of the game so that the haze moves. |
| `fxaa` (optional) | `boolean` | Fast approximate anti-aliasing of the finished picture (off). It smooths the edges that multisampling (the renderer's `antialias`) cannot, such as the edges inside textures and of tone-mapped highlights, and works with `antialias: false`. It softens fine detail slightly. |

### `RichLayout`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `paragraphs` | `{layout: ReturnType<typeof layoutParagraph>, top: number, offset: number}[]` |  |
| `width` | `number` |  |
| `height` | `number` |  |
| `atomCount` | `number` |  |
| `source` | `string` |  |

### `ShadowOptions`

Directional-light shadow mapping, shared by the WebGPU and WebGL2 renderers.

One orthographic depth map of the world seen from the light, fitted to a box around the camera's view: everything that can
cast a shadow is drawn into it from the light's point of view, and the main pass asks, for each pixel, whether something
is between it and the light (a 3x3 percentage-closer filter softens the edge).

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `size` (optional) | `number` | Shadow map resolution in texels per side (default 2048). |
| `radius` (optional) | `number` | Half the width of the covered box in metres, centred ahead of the camera (default 45). A bigger radius covers more of the world with coarser shadows: texel size is 2 * radius / size. |
| `bias` (optional) | `number` | Depth bias in light-space depth units (default 0.0004: about 8 cm over the default 200 m depth range). |
| `strength` (optional) | `number` | 0..1, how dark shadows are (default 0.75; the rest is ambient light that shadows never remove). |
| `cascades` (optional) | `number` | Split the covered area into this many nested boxes (1 to 4, default 1), each with its own shadow map of `size`: the nearest is small and very sharp, the farthest is `radius`. Shadows near the camera get far more detail for the same cost per pixel. |
| `ratio` (optional) | `number` | Each cascade is this fraction of the size of the next one out (0.15 to 0.9, default 0.35). |

### `Sky`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `sun` | `number[]` | Unit vector pointing to the sun. |
| `sunIntensity` | `number` | How bright the sunlit atmosphere is (default 22). |
| `sunSize` | `number` | Angular radius of the sun's disc, radians (default 0.01). |
| `turbidity` | `number` | Haze: 2 very clear, 3 clear (default), 6 hazy, 10 smoggy. |
| `rayleigh` | `number` | Strength of the blue air scattering (default 1). |
| `mieG` | `number` | How much haze scatters forward (default 0.76). |
| `exposure` | `number` | Brightness of the picture (default 1.5). |
| `ground` | `number[]` | Colour of the ground seen below the horizon, linear light. |
| `clouds` | `{coverage: number, density: number, scale: number, brightness: number, wind: number[]} \| null` |  |
| `stars` | `{brightness: number} \| null` |  |
| `moon` | `{direction: number[], size: number, brightness: number} \| null` |  |
| `time` | `number` | Seconds; moves the clouds along their wind and twinkles the stars. |

### `SkyOptions`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `zenith` (optional) | `number[]` | Colour straight up, linear light (default a clear blue) |
| `horizon` (optional) | `number[]` | Colour at the horizon (default pale) |
| `ground` (optional) | `number[]` | Colour below the horizon (default a dark earth) |
| `sun` (optional) | `{direction: number[], color?: number[], intensity?: number, size?: number}` | A sun: the direction TO it, its colour, how bright (default 20, above 1 so it lights and glints strongly), and its radius in radians (default 0.05) |
| `size` (optional) | `number` | Texels per cube side: 16 to 256, a power of two (default 64) |

### `Sprite`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `u0` | `number` |  |
| `v0` | `number` |  |
| `u1` | `number` |  |
| `v1` | `number` | Normalised rectangle within its page. |
| `w` | `number` |  |
| `h` | `number` | Size in atlas pixels. |
| `x` | `number` |  |
| `y` | `number` | Position in atlas pixels. |
| `page` | `number` | Which page (texture layer) the sprite lives on. |
| `sdf` | `boolean` | True for signed-distance-field sprites (text): drawn with an edge threshold instead of as plain colour. |
| `unlit` | `boolean` | True for sprites that ignore 2D lighting (a HUD picture, a glow, a particle): they always draw at full brightness. |

### `StaticBatch`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `mesh` | `import('./mesh.js').Mesh` | The merged geometry, in world space. |
| `color` | `number[]` | RGBA the batch is drawn with. |
| `material` | `number[]` | `[texture layer or -1, mapping, scale, surface]`, as for `DrawList3D.setMaterial` / `setSurface`. |
| `pieces` | `number` | How many placed meshes went into it. |

### `TerrainChunk`

One chunk of terrain. Its meshes are made when first asked for.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `cx` | `number` |  |
| `cz` | `number` | Position in the grid of chunks. |
| `i0` | `number` |  |
| `j0` | `number` | The first sample. |
| `min` | `number[]` |  |
| `max` | `number[]` | Bounding box. |
| `meshes` | `(import('./mesh.js').Mesh \| null)[]` | One slot per level of detail. |

### `Track`

A keyframed animation. Each track drives one channel of one joint: translation (`t`, 3 values per key), rotation (`r`,
4 values, a quaternion) or scale (`s`). Channels without a track keep the rest pose.

Type: `{joint: number, path: 't' \| 'r' \| 's', times: ArrayLike<number>, values: ArrayLike<number>, step?: boolean}`

### `VideoFit`

Type: `'cover' \| 'contain' \| 'stretch'`

### `WaterStyle`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `shallow` | `number[]` | Colour of the water where it is shallow, linear light. |
| `deep` | `number[]` | Colour where it is deep. |
| `clarity` | `number` | Depth in metres at which it has become the deep colour. |
| `opacity` | `number` | How opaque deep water is, 0 to 1. |
| `foamColor` | `number[]` |  |
| `foamDepth` | `number` | How far from the shore (metres of depth) the froth reaches. |
| `foamCrest` | `number` | 0..1: froth on wave crests. |
| `reflection` | `number` | How much of the sky shows in the water at glancing angles, 0..1. |
| `specular` | `number` | Strength of the sun's glints. |
| `shininess` | `number` | How tight they are. |
| `ripple` | `number` | Strength of the fine ripples, 0..1. |
| `waves` | `{angle: number, wavelength: number, amplitude: number, speed: number}[]` | Up to four waves that add up. `angle`: the direction they travel, radians (0 is toward +x, pi/2 toward +z). `speed`: metres per second. |
