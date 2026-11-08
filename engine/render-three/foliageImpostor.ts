/**
 * Far foliage billboards (impostors): past a type's cull distance its Landscape
 * rule plants are drawn as camera-facing quads out to the type's `farDistance`.
 *
 * The atlas is baked once per mesh at load: the model photographed from
 * {@link IMPOSTOR_FRAMES} directions around its up axis, twice — unlit (base
 * colour and alpha) and as view-space normals (alpha-tested, two-sided like the
 * leaves). A billboard turns about the world up axis toward the camera, shows
 * the frame nearest the direction it is seen from (relative to the plant's yaw)
 * and is lit per pixel through the normal frame with the model's roughness, so
 * leaves facing the sky catch the sky as the model's do; time of day and fog
 * apply as to any standard surface. A single flat normal could not: the card
 * read near black against the lit crowns of the models.
 *
 * Hand-off: the models dissolve per instance with a screen-door dither over the
 * type's fade window (`foliageFade.ts`); a billboard runs the complementary test
 * on the same window and threshold, so exactly one of the two covers a pixel.
 * The billboards dissolve the same way over the last 15% of the far distance.
 */
import { AoSurfaceMaterials } from "./aoSurfaceMaterials";
import {
  Box3,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  Sphere,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Object3D,
  type WebGLRenderer,
} from "three";

/** Directions baked around the up axis. */
export const IMPOSTOR_FRAMES = 8;
/** Frame height in pixels; the width follows the model's proportions. */
const FRAME_HEIGHT = 256;
/** Share of the far distance over which billboards dissolve out. */
export const IMPOSTOR_FAR_FADE = 0.15;

export interface FoliageImpostorAtlas {
  texture: Texture;
  /** View-space normals per frame (tangent space of the billboard: x right, y up, z toward the camera). */
  normalTexture: Texture;
  /** Mean roughness of the model's materials. */
  roughness: number;
  frames: number;
  /** Billboard width and height at instance scale 1, metres. */
  width: number;
  height: number;
  /** Lowest model point above its pivot (scale 1), metres. */
  minY: number;
  /** Alpha-weighted mean base colour (linear), for the far terrain tint. */
  color: Color;
  /** Unit quad (x −0.5..0.5, y 0..1) with the billboard's bounds; each batch draws a copy. */
  geometry: PlaneGeometry;
  dispose(): void;
}

function unlitCopy(material: Material): MeshBasicMaterial {
  const source = material as Material & {
    map?: Texture | null; color?: Color; alphaMap?: Texture | null; vertexColors?: boolean;
  };
  const basic = new MeshBasicMaterial({
    map: source.map ?? null,
    alphaMap: source.alphaMap ?? null,
    color: source.color ? source.color.clone() : new Color(1, 1, 1),
    transparent: false,
    alphaTest: source.alphaTest > 0 ? source.alphaTest : (source.transparent ? 0.5 : 0),
    side: DoubleSide,
    vertexColors: source.vertexColors ?? false,
  });
  basic.opacity = source.opacity;
  return basic;
}

function srgbToLinear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Bakes the impostor atlas of a model (its GLTF scene, material slots already
 * applied by the caller). Null for a model with no visible extent. Restores the
 * renderer's target, clear colour and scissor state.
 */
export function bakeFoliageImpostorAtlas(renderer: WebGLRenderer, model: Object3D): FoliageImpostorAtlas | null {
  const subject = model.clone(true);
  subject.position.set(0, 0, 0);
  subject.updateMatrixWorld(true);
  const owned: Material[] = [];
  const originals: Array<[Mesh, Material | Material[]]> = [];
  const unlit: Array<[Mesh, Material | Material[]]> = [];
  let roughnessSum = 0, roughnessCount = 0;
  subject.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    originals.push([mesh, mesh.material]);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const roughness = (material as Material & { roughness?: number }).roughness;
      if (typeof roughness === "number") { roughnessSum += roughness; roughnessCount += 1; }
    }
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => { const copy = unlitCopy(material); owned.push(copy); return copy; })
      : (() => { const copy = unlitCopy(mesh.material); owned.push(copy); return copy; })();
    unlit.push([mesh, mesh.material]);
  });
  const box = new Box3().setFromObject(subject);
  // Widest reach from the up axis over every yaw: the farthest bounding-box corner.
  const radius = Math.max(...[box.min.x, box.max.x].flatMap((x) => [box.min.z, box.max.z].map((z) => Math.hypot(x, z))));
  const height = box.max.y - box.min.y;
  if (box.isEmpty() || !(radius > 0) || !(height > 0)) {
    for (const material of owned) material.dispose();
    return null;
  }
  const width = radius * 2;
  const frameWidth = Math.max(16, Math.min(FRAME_HEIGHT, Math.round(FRAME_HEIGHT * width / height)));
  const atlasWidth = frameWidth * IMPOSTOR_FRAMES;

  const scene = new Scene();
  scene.add(subject);
  const camera = new OrthographicCamera(-radius, radius, box.max.y, box.min.y, 0.01, radius * 4 + 1);
  const target = new WebGLRenderTarget(atlasWidth, FRAME_HEIGHT, {
    type: UnsignedByteType,
    colorSpace: SRGBColorSpace,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    // Single-sampled: a multisampled target resolved into an sRGB texture came out
    // washed out (encoded twice), and far billboards are smoothed by their mips anyway.
    samples: 0,
  });
  const normalTarget = new WebGLRenderTarget(atlasWidth, FRAME_HEIGHT, {
    type: UnsignedByteType,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    samples: 0,
  });
  const normals = new AoSurfaceMaterials();
  // A single-sampled shot of frame 0 at frame size, read back for the mean colour
  // (smaller, the thin branches fail the alpha test and only the trunk is left).
  const probe = new WebGLRenderTarget(frameWidth, FRAME_HEIGHT, { type: UnsignedByteType, colorSpace: SRGBColorSpace });

  const previousTarget = renderer.getRenderTarget();
  const previousClear = renderer.getClearColor(new Color());
  const previousAlpha = renderer.getClearAlpha();
  const previousAutoClear = renderer.autoClear;
  const shoot = (angle: number): void => {
    camera.position.set(Math.sin(angle) * (radius * 2 + 0.5), 0, Math.cos(angle) * (radius * 2 + 0.5));
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.position.y = 0;
    camera.updateMatrixWorld(true);
    renderer.render(scene, camera);
  };
  const pixels = new Uint8Array(frameWidth * FRAME_HEIGHT * 4);
  let color = new Color(0.05, 0.1, 0.05);
  try {
    renderer.autoClear = false;
    // The mean colour first: the atlas background takes it (alpha 0), or distant
    // mip levels average the leaves with black and the billboards turn dark.
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(probe);
    renderer.clear(true, true, true);
    shoot(0);
    renderer.readRenderTargetPixels(probe, 0, 0, frameWidth, FRAME_HEIGHT, pixels);
    let r = 0, g = 0, b = 0, weight = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3]! / 255;
      if (alpha <= 0) continue;
      r += srgbToLinear(pixels[i]!) * alpha; g += srgbToLinear(pixels[i + 1]!) * alpha; b += srgbToLinear(pixels[i + 2]!) * alpha;
      weight += alpha;
    }
    if (weight > 0) color = new Color().setRGB(r / weight, g / weight, b / weight);
    renderer.setClearColor(color, 0);
    target.scissorTest = false;
    target.viewport.set(0, 0, atlasWidth, FRAME_HEIGHT);
    renderer.setRenderTarget(target);
    renderer.clear(true, true, true);
    const shootFrames = (into: WebGLRenderTarget): void => {
      into.scissorTest = true;
      for (let frame = 0; frame < IMPOSTOR_FRAMES; frame += 1) {
        into.viewport.set(frame * frameWidth, 0, frameWidth, FRAME_HEIGHT);
        into.scissor.set(frame * frameWidth, 0, frameWidth, FRAME_HEIGHT);
        renderer.setRenderTarget(into);
        renderer.clear(false, true, false);
        shoot((frame / IMPOSTOR_FRAMES) * Math.PI * 2);
      }
    };
    shootFrames(target);
    // Normals: the source materials' alpha test and sidedness; a flat normal behind.
    for (const [mesh, material] of originals) {
      mesh.material = Array.isArray(material) ? material.map((entry) => normals.get(entry)) : normals.get(material);
    }
    renderer.setClearColor(new Color(0.5, 0.5, 1), 0);
    normalTarget.scissorTest = false;
    normalTarget.viewport.set(0, 0, atlasWidth, FRAME_HEIGHT);
    renderer.setRenderTarget(normalTarget);
    renderer.clear(true, true, true);
    shootFrames(normalTarget);
    for (const [mesh, material] of unlit) mesh.material = material;
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClear, previousAlpha);
    renderer.autoClear = previousAutoClear;
  }

  probe.dispose();
  normals.dispose();
  for (const material of owned) material.dispose();

  const geometry = new PlaneGeometry(1, 1);
  geometry.translate(0, 0.5, 0);
  geometry.boundingSphere = new Sphere(new Vector3(0, box.min.y + height / 2, 0), Math.hypot(radius, height / 2));
  geometry.boundingBox = new Box3(new Vector3(-radius, box.min.y, -radius), new Vector3(radius, box.max.y, radius));
  return {
    texture: target.texture,
    normalTexture: normalTarget.texture,
    roughness: roughnessCount > 0 ? roughnessSum / roughnessCount : 1,
    frames: IMPOSTOR_FRAMES,
    width,
    height,
    minY: box.min.y,
    color,
    geometry,
    dispose: () => { target.dispose(); normalTarget.dispose(); geometry.dispose(); },
  };
}

/** Uniforms one rule's billboards share: `(nearStart, nearEnd, farStart, farEnd)` in metres. */
export interface FoliageImpostorUniforms {
  uImpostorFade: { value: Vector4 };
}

const VERTEX_PARS = `
attribute float instanceYaw;
uniform vec4 uImpostorFade;
uniform vec4 uImpostorShape;
varying float vImpostorDistance;`;

// After <uv_vertex>: everything the later chunks need. The instance matrix holds
// translation and uniform scale only, so object space is world-aligned.
const VERTEX_SETUP = `
  vec3 impostorOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 impostorToCamera = cameraPosition - impostorOrigin;
  vImpostorDistance = length(impostorToCamera);
  float impostorFlat = length(impostorToCamera.xz);
  vec2 impostorDir = impostorFlat > 1e-4 ? impostorToCamera.xz / impostorFlat : vec2(0.0, 1.0);
  vec3 impostorRight = vec3(impostorDir.y, 0.0, -impostorDir.x);
  float impostorAzimuth = atan(impostorDir.x, impostorDir.y) - instanceYaw;
  float impostorFrames = uImpostorShape.w;
  float impostorFrame = mod(floor(impostorAzimuth / (6.28318530718 / impostorFrames) + 0.5), impostorFrames);
  bool impostorHidden = vImpostorDistance < uImpostorFade.x || vImpostorDistance > uImpostorFade.w;
  #ifdef USE_MAP
    vMapUv = vec2((impostorFrame + uv.x) / impostorFrames, uv.y);
  #endif
  #ifdef USE_NORMALMAP
    vNormalMapUv = vec2((impostorFrame + uv.x) / impostorFrames, uv.y);
  #endif`;

const FRAGMENT_PARS = `
uniform vec4 uImpostorFade;
uniform vec2 uImpostorAtlasSize;
varying float vImpostorDistance;
float impostorThreshold(vec2 pixel) {
  ivec2 cell = ivec2(mod(pixel, 4.0));
  const float bayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (bayer[cell.x + cell.y * 4] + 0.5) / 16.0;
}`;

// The models keep a pixel while nearFade >= t (foliageFade.ts): billboards take the rest.
const FRAGMENT_MAIN = `
  float impostorT = impostorThreshold(gl_FragCoord.xy);
  float impostorNear = clamp((uImpostorFade.y - vImpostorDistance) / max(uImpostorFade.y - uImpostorFade.x, 1e-4), 0.0, 1.0);
  if (impostorNear >= impostorT) discard;
  float impostorFar = clamp((uImpostorFade.w - vImpostorDistance) / max(uImpostorFade.w - uImpostorFade.z, 1e-4), 0.0, 1.0);
  if (impostorFar < impostorT) discard;`;

// Thin branches average away in the small mip levels; the cut-off falls with the
// level, so a far crown keeps its coverage instead of thinning to its trunk.
const ALPHA_TEST = `
  #ifdef USE_MAP
    vec2 impostorTexel = vMapUv * uImpostorAtlasSize;
    float impostorLod = 0.5 * log2(max(max(dot(dFdx(impostorTexel), dFdx(impostorTexel)), dot(dFdy(impostorTexel), dFdy(impostorTexel))), 1.0));
    if (diffuseColor.a < max(0.08, 0.4 * pow(0.6, impostorLod))) discard;
  #endif`;

const MAIN = /void\s+main\s*\(\s*\)\s*\{/;

/**
 * The billboard material of one rule: the atlas lit as a standard surface through
 * its normal frames, with the model's roughness. Marked so the AO normal pass
 * skips it (`forgeImpostor`): that pass draws plain geometry, not billboards.
 */
export function createFoliageImpostorMaterial(atlas: FoliageImpostorAtlas, uniforms: FoliageImpostorUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    map: atlas.texture, normalMap: atlas.normalTexture, roughness: atlas.roughness, metalness: 0, side: DoubleSide,
  });
  const shape = { value: new Vector4(atlas.width, atlas.height, atlas.minY, atlas.frames) };
  const image = atlas.texture.image as { width: number; height: number };
  const atlasSize = { value: new Vector2(image.width, image.height) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uImpostorFade = uniforms.uImpostorFade;
    shader.uniforms.uImpostorShape = shape;
    shader.uniforms.uImpostorAtlasSize = atlasSize;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${VERTEX_PARS}`)
      .replace("#include <uv_vertex>", `#include <uv_vertex>${VERTEX_SETUP}`)
      .replace("#include <beginnormal_vertex>",
        "vec3 objectNormal = vec3(impostorDir.x, 0.0, impostorDir.y);")
      .replace("#include <begin_vertex>", [
        "vec3 transformed = impostorRight * (position.x * uImpostorShape.x) + vec3(0.0, uImpostorShape.z + position.y * uImpostorShape.y, 0.0);",
        "if (impostorHidden) transformed = vec3(0.0);",
      ].join("\n"));
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${FRAGMENT_PARS}`)
      .replace(MAIN, (main) => `${main}${FRAGMENT_MAIN}`)
      .replace("#include <alphatest_fragment>", ALPHA_TEST);
  };
  material.customProgramCacheKey = () => "forge-foliage-impostor-v2";
  return material;
}

/**
 * One batch of billboards from packed instance matrices (as `generateFoliageCell`
 * writes them): each keeps its position, uniform scale and yaw. The caller
 * disposes `mesh.geometry` (its own) when the batch goes; the material is shared.
 */
export function createFoliageImpostorBatch(
  atlas: FoliageImpostorAtlas,
  material: MeshStandardMaterial,
  matrices: Float32Array,
  count: number,
): InstancedMesh {
  // Own copy (four vertices): the per-instance yaw attribute lives on the geometry.
  const geometry = atlas.geometry.clone();
  const mesh = new InstancedMesh(geometry, material, count);
  const target = mesh.instanceMatrix.array as Float32Array;
  const yaw = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const at = i * 16;
    const scale = Math.hypot(matrices[at]!, matrices[at + 1]!, matrices[at + 2]!);
    yaw[i] = Math.atan2(-matrices[at + 2]!, matrices[at]!);
    target.fill(0, at, at + 16);
    target[at] = scale; target[at + 5] = scale; target[at + 10] = scale; target[at + 15] = 1;
    target[at + 12] = matrices[at + 12]!; target[at + 13] = matrices[at + 13]!; target[at + 14] = matrices[at + 14]!;
  }
  mesh.instanceMatrix.needsUpdate = true;
  geometry.setAttribute("instanceYaw", new InstancedBufferAttribute(yaw, 1));
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.computeBoundingSphere();
  mesh.raycast = () => {};
  mesh.userData.forgeImpostor = true;
  mesh.name = "foliage-impostors";
  return mesh;
}
