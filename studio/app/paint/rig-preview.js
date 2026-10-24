// The Rig panel's picture: a skeleton drawn by the engine's own renderer (so what you see is what a game made with the engine gets), playing one of its animations, with the bones
// drawn over it if you like. The project's pictures become the atlas; a picture the project does not have is drawn as a coloured block so the rig can still be seen.
import { Atlas, Camera, SpriteBatch, MeshBatch2D, createRenderer } from '../../../packages/render/src/index.js';
import { Skeleton, AnimationState, drawSkeleton, skeletonBounds } from '../../../packages/skeleton2d/src/index.js';
import { pictureNames, placeholderColour } from './rig-model.js';

const W = 480, H = 300;

export class RigPreview {
  constructor() {
    this.renderer = null;
    this.atlas = null;
    this.skeleton = null;
    this.state = null;
    this.data = null;
    this.meshes = new MeshBatch2D();
    this.empty = new SpriteBatch(4);
    this.camera = Camera.screen(W, H);
    this.animation = null;
    this.loop = true;
    this.speed = 1;
    this.paused = false;
    this.time = 0;
    this.scale = 1;
    this.events = [];
    this.error = '';
  }

  /**
   * Load a skeleton and its pictures; makes a new canvas (the old one is gone).
   * @param {import('../../../packages/skeleton2d/src/index.js').SkeletonData} data
   * @param {(name: string) => Promise<ImageBitmap | null>} picture Looks a picture up by the name the skeleton uses, null if the project has none.
   * @returns {Promise<HTMLCanvasElement | null>} the canvas to put on the page, or null (see `error`)
   */
  async load(data, picture) {
    this.destroy();
    this.error = '';
    try {
      const atlas = new Atlas({ size: 1024 });
      const missing = [];
      for (const name of pictureNames(data)) {
        const bitmap = await picture(name);
        if (bitmap) atlas.add(name, bitmap.width, bitmap.height, (g, x, y) => g.drawImage(bitmap, x, y));
        else {
          missing.push(name);
          const colour = placeholderColour(name);
          atlas.add(name, 32, 32, (g, x, y, w, h) => {
            g.fillStyle = colour;
            g.fillRect(x, y, w, h);
            g.strokeStyle = '#ffffff';
            g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
          });
        }
      }
      this.missing = missing;
      this.atlas = atlas;
      this.renderer = await createRenderer({ atlas, transparent: true });
      this.renderer.resize(W, H, 1);
      this.data = data;
      this.skeleton = new Skeleton(data);
      this.state = new AnimationState(data, { defaultMix: 0 });
      this.state.on('event', (entry, event) => { this.events.push(event.name); if (this.events.length > 20) this.events.shift(); });
      this.fit();
      this.play(this.animation && data.animations.has(this.animation) ? this.animation : [...data.animations.keys()][0] ?? null);
      return this.renderer.canvas;
    } catch (error) {
      this.error = String(error?.message ?? error);
      return null;
    }
  }

  /** Stand the skeleton in the middle, as big as fits (measured in its setup pose). */
  fit() {
    const s = this.skeleton;
    s.scaleX = 1;
    s.scaleY = 1;
    s.x = 0;
    s.y = 0;
    s.setToSetupPose();
    s.updateWorldTransform();
    const box = skeletonBounds(s, { atlas: this.atlas });
    if (!box) { this.scale = 1; s.x = W / 2; s.y = H * 0.7; return; }
    const w = Math.max(1, box.x1 - box.x0), h = Math.max(1, box.y1 - box.y0);
    this.scale = Math.min(3, (W * 0.8) / w, (H * 0.8) / h);
    s.scaleX = this.scale;
    s.scaleY = this.scale;
    s.x = W / 2 - ((box.x0 + box.x1) / 2) * this.scale;
    s.y = H / 2 - ((box.y0 + box.y1) / 2) * this.scale;
  }

  /** Start an animation from its beginning (null shows the setup pose). @param {string | null} name */
  play(name) {
    this.animation = name;
    this.time = 0;
    this.events = [];
    this.state.clearTracks();
    if (name) this.state.setAnimation(0, name, { loop: this.loop });
    this.pose(0);
  }

  /** Show a moment of the current animation (for the time slider). @param {number} seconds */
  seek(seconds) {
    if (!this.animation) return;
    const length = this.data.animation(this.animation).duration || 1;
    this.time = this.loop ? seconds % length : Math.min(seconds, length);
    this.state.clearTracks();
    this.state.setAnimation(0, this.animation, { loop: this.loop });
    this.state.update(this.time);
    this.pose(0);
  }

  /** Show another outfit (null for the usual one). @param {string | null} name */
  setSkin(name) {
    this.skeleton.setSkin(name);
    this.skeleton.setToSetupPose?.();
  }

  pose(dt) {
    const s = this.skeleton;
    this.state.update(dt);
    s.setToSetupPose();
    this.state.apply(s);
    s.updateWorldTransform();
  }

  /** Move time on and draw. @param {number} dt seconds */
  frame(dt) {
    if (!this.renderer) return;
    if (!this.paused && this.animation) {
      this.time += dt * this.speed;
      this.pose(dt * this.speed);
    }
    this.meshes.clear();
    drawSkeleton(this.skeleton, this.meshes, this.atlas);
    this.renderer.render({ camera: this.camera, batch: this.empty, meshes: this.meshes, clear: [0.1, 0.12, 0.17, 1] });
  }

  /** Draw the bones as lines and dots on a 2D canvas the same size as the picture. @param {CanvasRenderingContext2D} g */
  drawBones(g) {
    g.clearRect(0, 0, W, H);
    if (!this.skeleton) return;
    g.lineWidth = 2;
    for (const bone of this.skeleton.bones) {
      const length = (bone.data.length || 0) * this.scale;
      const x = bone.worldX, y = bone.worldY;
      const ex = x + bone.a * (bone.data.length || 0), ey = y + bone.c * (bone.data.length || 0);
      g.strokeStyle = 'rgba(255, 210, 60, 0.9)';
      if (length > 0) { g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke(); }
      g.fillStyle = '#ff6b6b';
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
  }

  destroy() {
    this.renderer?.destroy?.();
    this.renderer = null;
  }
}

export const RIG_VIEW = { width: W, height: H };
