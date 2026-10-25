import assert from "node:assert/strict";
import { Texture } from "three";
import { PerspectiveCamera, ShaderLib, Vector3, type BufferAttribute, type InstancedBufferGeometry, type Material, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from "three";
import {
  TerrainDeformationTexture,
  terrainDeformationDepthAt,
  terrainDeformationDisplacement,
  TERRAIN_DEFORMATION_BERM_MAX,
} from "../../engine/render-three/terrain/terrainDeformation";
import { terrainSlotHeight } from "../../engine/render-three/terrain/terrainMaterial";
import {
  DEFAULT_TRACK_DETAIL_LEVELS, setTerrainTrackDetailLevels, TerrainRenderer, terrainTrackDetailStats,
} from "../../engine/render-three/terrain/terrainRenderer";
import { normalizeGraphicsPreferences, QUALITY_LEVELS, QUALITY_PROFILES } from "../../engine/perf/qualityProfiles";
import { DeformationField } from "../../engine/scene/deformationField";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { tileKey, type TerrainTileData } from "../../engine/terrain/terrainTypes";
import { formatTerrainTrackDetailDebug } from "../../src/scene/debugStats";

type Check = (label: string, fn: () => void) => void;

/**
 * TERRAIN_DEFORMATION Faz 3 render side (research A5): CDLOD detail levels in
 * the track window, vertices on the collider's triangles, tracks dented into
 * every terrain material, and a visual-only berm. The shaders cannot run
 * headless, so their formulas are pinned through CPU mirrors
 * ({@link terrainSlotHeight}, {@link terrainDeformationDisplacement}) and the
 * injected sources are checked for the calls that use them.
 */

const Q = 128;
const TILES = 2;

/** Twisted cells on purpose: a bilinear blend would miss the collider by up to twist / 4. */
function gridHeight(gx: number, gz: number): number {
  return Math.fround(3 * Math.sin(gx * 0.21) * Math.cos(gz * 0.17) + ((gx * 7 + gz * 13) % 5) * 0.11);
}

function tiles(): Map<string, TerrainTileData> {
  const map = new Map<string, TerrainTileData>();
  const size = Q + 1;
  for (let tz = 0; tz < TILES; tz += 1) {
    for (let tx = 0; tx < TILES; tx += 1) {
      const heights = new Float32Array(size * size);
      for (let z = 0; z < size; z += 1) {
        for (let x = 0; x < size; x += 1) heights[z * size + x] = gridHeight(tx * Q + x, tz * Q + z);
      }
      map.set(tileKey(tx, tz), { x: tx, z: tz, size, heights, layerCount: 4, weights: new Uint8Array(size * size * 4) });
    }
  }
  return map;
}

function randomSource(): () => number {
  let seed = 0x7ac5;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function cameraAt(x: number, y: number, z: number): PerspectiveCamera {
  const camera = new PerspectiveCamera();
  camera.position.set(x, y, z);
  camera.updateMatrixWorld(true);
  return camera;
}

function nodes(terrain: TerrainRenderer): { size: number; skirt: boolean }[] {
  const geometry = terrain.mesh.geometry as InstancedBufferGeometry;
  const a = geometry.getAttribute("terrainNodeA") as BufferAttribute;
  const c = geometry.getAttribute("terrainNodeC") as BufferAttribute;
  return Array.from({ length: geometry.instanceCount }, (_, index) => ({ size: a.getZ(index), skirt: c.getX(index) > 0.5 }));
}

/** The vertex/fragment sources a material's `onBeforeCompile` produces from three's own `base` shader. */
function compiled(material: Material, base: { vertexShader: string; fragmentShader: string }): WebGLProgramParametersWithUniforms {
  const shader = { uniforms: {}, vertexShader: base.vertexShader, fragmentShader: base.fragmentShader } as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, undefined!);
  return shader;
}

export function registerTerrainTrackDetailTests(check: Check): void {
  check("terrain wet layers: all eight albedos and material roughness reach the lit shader with puddle shading", () => {
    const textures = Array.from({ length: 8 }, () => new Texture());
    const source = worldTerrainRenderSource({ tileQuads: Q, spacing: 1, tilesX: 1, tilesZ: 1 }, new Map([["0_0", tiles().get("0_0")!]]));
    const terrain = new TerrainRenderer(source, { viewMode: "lit", activeLayer: 4, origin: new Vector3(),
      layers: textures.map((texture, i) => ({ texture, color: "#493226", scale: 0.125, roughness: i === 4 ? 0.22 : 0.95, physicalMaterial: i === 4 ? "mud" : null })) });
    try {
      const shader = compiled(terrain.mesh.material, ShaderLib.standard);
      assert.equal(shader.uniforms.uLayerTex4!.value, textures[4]);
      assert.equal(shader.uniforms.uLayerTex7!.value, textures[7]);
      assert.equal((shader.uniforms.uLayerRoughness!.value as number[])[4], 0.22);
      assert.match(shader.fragmentShader, /texture\(uLayerTex4,/);
      assert.match(shader.fragmentShader, /texture\(uLayerTex7,/);
      assert.match(shader.fragmentShader, /roughnessFactor = mix\(roughnessFactor, 0.035, forgePuddle\)/);
      assert.match(shader.fragmentShader, /outgoingLight = mix\(outgoingLight, forgeSky/);
    } finally { terrain.dispose(); textures.forEach((texture) => texture.dispose()); }
  });
  check("terrain track detail: tile-slot vertices sit on the collider's triangles, not a bilinear blend", () => {
    const map = tiles();
    const def = { tileQuads: Q, spacing: 1, tilesX: TILES, tilesZ: TILES, origin: [0, 0, 0] as const };
    const random = randomSource();
    let bilinearMiss = 0;
    for (let index = 0; index < 4000; index += 1) {
      // Detail vertices land on 0.25 m (and morph between); sample anywhere, seams and tile edges included.
      const x = index < 8 ? [0, Q, 2 * Q, Q - 1e-9][index % 4]! : random() * TILES * Q;
      const z = index < 8 ? [Q, 0, 2 * Q, Q + 1e-9][index % 4]! : random() * TILES * Q;
      const tx = Math.min(Math.floor(x / Q), TILES - 1);
      const tz = Math.min(Math.floor(z / Q), TILES - 1);
      const tile = map.get(tileKey(tx, tz))!;
      const drawn = terrainSlotHeight(tile.heights, Q + 1, 1, [tx * Q, tz * Q], [x, z]);
      const collider = terrainHeightAt(def, { tile: (cx, cz) => map.get(tileKey(cx, cz)) }, x, z)!;
      assert.ok(Math.abs(drawn - collider) < 1e-5, `(${x}, ${z}): drawn ${drawn} vs collider ${collider}`);
      const gx = x - tx * Q;
      const gz = z - tz * Q;
      const cx = Math.min(Math.floor(gx), Q - 1);
      const cz = Math.min(Math.floor(gz), Q - 1);
      const h = (ix: number, iz: number) => tile.heights[iz * (Q + 1) + ix]!;
      const bilinear = (h(cx, cz) * (1 - (gx - cx)) + h(cx + 1, cz) * (gx - cx)) * (1 - (gz - cz))
        + (h(cx, cz + 1) * (1 - (gx - cx)) + h(cx + 1, cz + 1) * (gx - cx)) * (gz - cz);
      bilinearMiss = Math.max(bilinearMiss, Math.abs(bilinear - collider));
    }
    assert.ok(bilinearMiss > 0.05, `the old bilinear surface would miss by ${bilinearMiss} m`);
  });

  check("terrain track detail: displacement dents tracks, lifts a capped berm beside them and is zero at the window edge", () => {
    const field = new DeformationField();
    // A straight 0.25 m wide, 0.1 m deep rut along Z at x = 0, plus one running off the window's edge.
    field.stampWheel({ from: [0, -10], to: [0, 10], width: 0.25, contactLength: 0.3, targetDepth: 0.1, compaction: 1, disturbance: 255 });
    field.stampWheel({ from: [-40, 5], to: [40, 5], width: 0.5, contactLength: 0.5, targetDepth: 0.2, compaction: 1, disturbance: 255 });
    const texture = new TerrainDeformationTexture();
    texture.attach(field);
    const window = texture.trackWindow()!;
    assert.deepEqual(window, { minX: -32, minZ: -32, size: 64 });
    const depthAt = (x: number, z: number) => field.sample(x, z).depth;
    const at = (x: number, z: number) => terrainDeformationDisplacement(depthAt, window, x, z);
    // Inside the rut the ring sees shallower ground: no berm, the full depth.
    const centre = at(0.0625, 0);
    assert.ok(Math.abs(centre.offset + field.sample(0.0625, 0).depth) < 1e-9 && centre.berm === 0, JSON.stringify(centre));
    // Just beside it: undented ground, raised by a berm that never exceeds its cap.
    let berm = 0;
    for (let x = 0.2; x <= 0.45; x += 0.01) berm = Math.max(berm, at(x, 0).berm);
    assert.ok(berm > 0.005 && berm <= TERRAIN_DEFORMATION_BERM_MAX, `berm ${berm}`);
    assert.ok(at(0.3, 0).offset >= 0, "beside the rut the surface only rises");
    assert.deepEqual(at(3, 0), { offset: 0, berm: 0 }, "untouched ground stays put");
    // The crossing rut reaches the window's edge: displacement fades to exactly 0 on and past it.
    assert.ok(at(0, 5).offset < -0.15);
    for (const x of [-32, 32]) {
      assert.equal(terrainDeformationDepthAt(depthAt, window, x, 5), 0);
      assert.equal(at(x, 5).offset, 0);
      assert.equal(at(x + Math.sign(x) * 0.5, 5).offset, 0);
    }
    assert.ok(Math.abs(at(-31.9, 5).offset) < 0.001, "the fade is continuous up to the edge");
    texture.dispose();
  });

  check("terrain track detail: the renderer refines only while a track window is attached, and the quality hook turns it off", () => {
    const texture = new TerrainDeformationTexture();
    const source = worldTerrainRenderSource({ tileQuads: Q, spacing: 1, tilesX: TILES, tilesZ: TILES }, tiles());
    // A mesh offset: the window (world) must be mapped into terrain-local space.
    const terrain = new TerrainRenderer(source, {
      viewMode: "lit", activeLayer: 0, layers: [], origin: new Vector3(-100, 0, -60), deformation: texture,
    });
    const camera = cameraAt(-100 + 130, gridHeight(130, 120) + 3, -60 + 120);
    terrain.updateLod(camera);
    assert.equal(terrain.trackDetailNodeCount, 0, "no field: plain CDLOD");
    const plain = nodes(terrain).length;
    const field = new DeformationField();
    field.recenter(-100 + 130, -60 + 120);
    texture.attach(field);
    terrain.updateLod(camera);
    assert.ok(terrain.trackDetailNodeCount > 16, `detail nodes ${terrain.trackDetailNodeCount}`);
    const sizes = nodes(terrain);
    assert.equal(Math.min(...sizes.map((node) => node.size)), 32 / 2 ** DEFAULT_TRACK_DETAIL_LEVELS);
    assert.ok(sizes.filter((node) => node.size < 32).every((node) => node.skirt), "detail nodes hang skirts");
    // Far from the window: nothing to refine although a field is attached.
    terrain.updateLod(cameraAt(-100 + 250, 40, -60 + 250));
    assert.equal(terrain.trackDetailNodeCount, 0);
    terrain.updateLod(camera);
    assert.ok(terrain.trackDetailNodeCount > 0);
    terrain.setTrackDetailLevels(0);
    terrain.updateLod(camera);
    assert.equal(terrain.trackDetailNodeCount, 0, "quality off: the Faz 2 look");
    assert.equal(nodes(terrain).length, plain);
    terrain.setTrackDetailLevels(3);
    terrain.updateLod(camera);
    assert.equal(Math.min(...nodes(terrain).map((node) => node.size)), 4);
    texture.detach();
    terrain.updateLod(camera);
    assert.equal(terrain.trackDetailNodeCount, 0, "detach re-selects without the window");
    terrain.dispose();
    texture.dispose();
  });

  check("terrain track detail: quality profiles step the levels down to the Faz 2 look on low, page-wide", () => {
    const levels = QUALITY_LEVELS.map((level) => QUALITY_PROFILES[level].terrainTrackDetailLevels);
    assert.deepEqual(levels, [2, 2, 1, 0]);
    assert.equal(formatTerrainTrackDetailDebug({ nodes: 48, levels: 2 }), "terrain detail: nodes 48 levels 2");
    const custom = normalizeGraphicsPreferences({ selectedQualityLevel: "custom", customSettings: { terrainTrackDetailLevels: 3 } });
    assert.equal(custom.customSettings?.terrainTrackDetailLevels, 3, "a custom override keeps the key");
    const texture = new TerrainDeformationTexture();
    const field = new DeformationField();
    field.recenter(130, 120);
    texture.attach(field);
    const source = () => worldTerrainRenderSource({ tileQuads: Q, spacing: 1, tilesX: TILES, tilesZ: TILES }, tiles());
    const make = () => new TerrainRenderer(source(), { viewMode: "lit", activeLayer: 0, layers: [], origin: new Vector3(), deformation: texture });
    const camera = cameraAt(130, gridHeight(130, 120) + 3, 120);
    const live = make();
    live.updateLod(camera);
    assert.ok(terrainTrackDetailStats().nodes >= live.trackDetailNodeCount && live.trackDetailNodeCount > 0);
    try {
      setTerrainTrackDetailLevels(0);
      live.updateLod(camera);
      assert.equal(live.trackDetailNodeCount, 0, "the hook reaches a live renderer");
      const later = make();
      later.updateLod(camera);
      assert.equal(later.trackDetailNodeCount, 0, "and one created afterwards");
      assert.deepEqual(terrainTrackDetailStats(), { nodes: 0, levels: 0 });
      later.dispose();
    } finally {
      setTerrainTrackDetailLevels(DEFAULT_TRACK_DETAIL_LEVELS);
    }
    live.updateLod(camera);
    assert.ok(live.trackDetailNodeCount > 0);
    live.dispose();
    assert.equal(terrainTrackDetailStats().nodes, 0, "disposed renderers leave the page count");
    texture.dispose();
  });

  check("terrain track detail: every terrain material displaces its vertices; only the lit one tints and shades the berm", () => {
    const texture = new TerrainDeformationTexture();
    const source = worldTerrainRenderSource({ tileQuads: Q, spacing: 1, tilesX: 1, tilesZ: 1 }, new Map([[tileKey(0, 0), tiles().get(tileKey(0, 0))!]]));
    const terrain = new TerrainRenderer(source, { viewMode: "lit", activeLayer: 0, layers: [], origin: new Vector3(), deformation: texture });
    const drawn: Material[] = [];
    const fake = { autoClear: true, setRenderTarget: () => {}, render: () => drawn.push(terrain.mesh.material) } as unknown as WebGLRenderer;
    terrain.renderOverride(fake, cameraAt(0, 10, 0), null, "normal");
    terrain.renderOverride(fake, cameraAt(0, 10, 0), null, "depth");
    const lit = compiled(terrain.mesh.material, ShaderLib.standard);
    const normal = compiled(drawn[0]!, ShaderLib.normal);
    const depth = compiled(drawn[1]!, ShaderLib.depth);
    for (const shader of [lit, normal, depth]) {
      assert.match(shader.vertexShader, /vec2 forgeDeformDisplacement\(vec2 world\)/);
      assert.match(shader.vertexShader, /forgeH \+= forgeDisp\.x;/);
      assert.match(shader.vertexShader, /f\.x \+ f\.y <= 1\.0/, "triangle-exact tile heights");
      assert.equal(shader.uniforms.uDeformTex, texture.uniforms.uDeformTex, "one shared track texture");
    }
    assert.match(lit.vertexShader, /vForgeDeformBerm = forgeDisp\.y;/);
    assert.match(lit.fragmentShader, /dFdx\(vForgeDeformBerm\)/);
    assert.doesNotMatch(normal.fragmentShader + depth.fragmentShader, /forgeDeformBerm/);
    terrain.dispose();
    texture.dispose();
  });
}
