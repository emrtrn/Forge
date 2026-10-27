import { DepthTexture, HalfFloatType, Matrix4, UnsignedIntType, Vector2, WebGLRenderTarget,
  type Camera, type Scene, type WebGLRenderer } from "three";

const snapshots = new WeakMap<Scene, WaterSceneSnapshot>();

/** One lazy colour/depth copy at the first lake draw, shared by all lakes.
 * No second scene render. Nested planar cameras and direct/MSAA paths fall back
 * to the baked terrain depth instead of reading an unresolved/attached texture.
 */
export class WaterSceneSnapshot {
  private target: WebGLRenderTarget | null = null;
  private camera: Camera | null = null;
  private copied = false;
  private enabled = false;
  private readonly depthOwners = new Map<WebGLRenderTarget, DepthTexture>();
  copies = 0;
  constructor(private readonly scene: Scene) { snapshots.set(scene, this); }

  begin(camera: Camera, targets: readonly WebGLRenderTarget[]): void {
    this.camera = camera; this.copied = false;
    let needed = false;
    this.scene.traverseVisible(object => { if (object.userData.waterSceneTransmission === true) needed = true; });
    this.enabled = needed;
    if (!needed) {
      this.target?.dispose(); this.target = null;
      for (const [target, depth] of this.depthOwners) if (target.depthTexture === depth) {
        target.dispose(); target.depthTexture = null;
      }
      this.depthOwners.clear();
      return;
    }
    for (const target of targets) if (!target.depthTexture && target.samples === 0) {
      // Attach before the scene render, never while a draw is in progress.
      target.dispose();
      target.depthTexture = new DepthTexture(target.width, target.height, UnsignedIntType);
      this.depthOwners.set(target, target.depthTexture);
    }
  }

  read(renderer: WebGLRenderer, camera: Camera): WebGLRenderTarget | null {
    const source = renderer.getRenderTarget();
    if (!this.enabled || camera !== this.camera || !source?.depthTexture || source.samples !== 0) return null;
    if (this.copied) return this.target;
    if (!this.target || this.target.width !== source.width || this.target.height !== source.height
      || this.target.depthTexture!.type !== source.depthTexture.type) {
      this.target?.dispose();
      this.target = new WebGLRenderTarget(source.width, source.height, { type: HalfFloatType,
        depthTexture: new DepthTexture(source.width, source.height, source.depthTexture.type) });
      this.target.texture.name = "WaterSceneSnapshot.color";
    }
    renderer.initRenderTarget(this.target);
    try {
      renderer.copyTextureToTexture(source.texture, this.target.texture);
      renderer.copyTextureToTexture(source.depthTexture, this.target.depthTexture!);
    } finally {
      // copyTextureToTexture binds its own READ/DRAW framebuffers. Explicitly
      // rebind the scene target before Three continues the interrupted draw.
      renderer.setRenderTarget(null); renderer.setRenderTarget(source);
    }
    this.copied = true; this.copies++;
    return this.target;
  }

  dispose(): void {
    this.target?.dispose(); this.target = null;
    this.depthOwners.clear(); // The composer owns and disposes its attachments.
    if (snapshots.get(this.scene) === this) snapshots.delete(this.scene);
  }
}

export function createWaterSceneUniforms() {
  return { waterSceneColor: { value: null }, waterSceneDepth: { value: null },
    waterSceneSize: { value: new Vector2(1, 1) }, waterSceneInverseProjection: { value: new Matrix4() },
    waterSceneEnabled: { value: 0 }, waterSceneReversed: { value: 0 } };
}

export function readWaterScene(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
  return snapshots.get(scene)?.read(renderer, camera) ?? null;
}

export const WATER_SCENE_GLSL = /* glsl */ `
uniform sampler2D waterSceneColor;
uniform sampler2D waterSceneDepth;
uniform vec2 waterSceneSize;
uniform mat4 waterSceneInverseProjection;
uniform float waterSceneEnabled;
uniform float waterSceneReversed;
vec3 waterScenePosition(vec2 uv, float depth) {
  vec4 p = waterSceneInverseProjection * vec4(uv * 2. - 1., mix(depth * 2. - 1., depth, waterSceneReversed), 1.);
  return p.xyz / p.w;
}
`;
