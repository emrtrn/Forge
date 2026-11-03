import { DataArrayTexture, NearestFilter, RedFormat, Scene, Vector4, type Object3D } from "three";
import type { TerrainPuddleGeometry } from "../../terrain/terrainPuddle";
import type { TerrainUniforms } from "./terrainMaterial";

const SIDE = 128, MAX = 17; // 16 saved bodies and one editor draft.
type Coverage = NonNullable<TerrainPuddleGeometry["coverage"]>;
interface Source { terrainRef: string; coverage: Coverage; levels: number | null; dirty: boolean }
interface Registry { sources: Map<Object3D, Source>; texture: DataArrayTexture | null; dirty: boolean; revision: number }
const registries = new WeakMap<Scene, Registry>();

export function setPuddleTerrainCoverage(scene: Scene, object: Object3D, terrainRef: string, coverage: Coverage, levels: number | null): void {
  let registry = registries.get(scene);
  if (!registry) { registry = { sources: new Map(), texture: null, dirty: true, revision: 0 }; registries.set(scene, registry); }
  if (!registry.sources.has(object) && registry.sources.size >= MAX) throw new Error("Puddle coverage capacity exceeded");
  const old = registry.sources.get(object), r = coverage.region;
  if (!old || old.levels !== levels || old.coverage.region.minX !== r.minX || old.coverage.region.minZ !== r.minZ || old.coverage.region.size !== r.size) registry.revision++;
  registry.sources.set(object, { terrainRef, coverage, levels, dirty: true }); registry.dirty = true;
}
export function clearPuddleTerrainCoverage(scene: Scene, object: Object3D): void {
  const registry = registries.get(scene); if (!registry?.sources.delete(object)) return;
  registry.revision++; registry.dirty = true;
  for (const source of registry.sources.values()) source.dirty = true;
  if (!registry.sources.size) { registry.texture?.dispose(); registry.texture = null; }
}
function registryOf(object: Object3D): Registry | undefined {
  let root = object; while (root.parent) root = root.parent;
  return root instanceof Scene ? registries.get(root) : undefined;
}
export function puddleTerrainRevision(object: Object3D): number { return registryOf(object)?.revision ?? 0; }
export function puddleTerrainActive(object: Object3D, terrainRef?: string): boolean {
  for (const source of registryOf(object)?.sources.values() ?? []) if (!terrainRef || source.terrainRef === terrainRef) return true;
  return false;
}
/** World-space fixed-grid patches. Only a successful live-water publication pins detail. */
export function puddleTerrainDetails(object: Object3D, terrainRef: string | undefined) {
  return [...(registryOf(object)?.sources ?? [])].filter(([, source]) => source.terrainRef === terrainRef && source.levels !== null)
    .map(([water, source]) => ({ minX: source.coverage.region.minX, minZ: source.coverage.region.minZ,
      maxX: source.coverage.region.minX + source.coverage.region.size, maxZ: source.coverage.region.minZ + source.coverage.region.size,
      levels: source.levels!, visible: water.visible }));
}
export function createPuddleTerrainUniforms(): TerrainUniforms {
  return { uPuddleTerrainMask: { value: null }, uPuddleTerrainCount: { value: 0 },
    uPuddleTerrainGrid: { value: Array.from({ length: MAX }, () => new Vector4()) },
    uPuddleTerrainLevels: { value: Array.from({ length: MAX }, () => new Vector4()) } };
}
export function updatePuddleTerrainCoverage(uniforms: TerrainUniforms, scene: Scene, terrainRef?: string): void {
  const registry = registries.get(scene), sources = [...(registry?.sources ?? [])];
  uniforms.uPuddleTerrainCount!.value = sources.length;
  if (!registry || !sources.length) { uniforms.uPuddleTerrainMask!.value = null; return; }
  if (!registry.texture) {
    registry.texture = new DataArrayTexture(new Uint8Array(SIDE * SIDE * MAX), SIDE, SIDE, MAX);
    registry.texture.format = RedFormat; registry.texture.minFilter = registry.texture.magFilter = NearestFilter;
    registry.texture.generateMipmaps = false; registry.texture.unpackAlignment = 1;
    registry.texture.name = "Puddle.connectedFaces";
  }
  const texture = registry.texture;
  if (registry.dirty) {
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]![1]; if (!source.dirty) continue;
      const values = texture.image.data as Uint8Array, start = i * SIDE * SIDE;
      values.fill(0, start, start + SIDE * SIDE);
      const { cells, triangles } = source.coverage;
      for (let z = 0; z < cells; z++) values.set(triangles.subarray(z * cells, (z + 1) * cells), start + z * SIDE);
      texture.addLayerUpdate(i); source.dirty = false;
    }
    texture.needsUpdate = true; registry.dirty = false;
  }
  uniforms.uPuddleTerrainMask!.value = texture;
  sources.forEach(([object, source], i) => {
    const r = source.coverage.region;
    let visible = true; for (let p: Object3D | null = object; p; p = p.parent) visible &&= p.visible;
    (uniforms.uPuddleTerrainGrid!.value as Vector4[])[i]!.set(r.minX, r.minZ, 1 / r.cellSize, source.coverage.cells);
    (uniforms.uPuddleTerrainLevels!.value as Vector4[])[i]!.set(r.level, visible && (!terrainRef || terrainRef === source.terrainRef) ? 1 : 0, 0, 0);
  });
}
export const TERRAIN_PUDDLE_COVERAGE_PARS = /* glsl */ `
uniform highp sampler2DArray uPuddleTerrainMask;
uniform int uPuddleTerrainCount;
uniform vec4 uPuddleTerrainGrid[17];
uniform vec4 uPuddleTerrainLevels[17];
float forgeAuthoredPuddleSubmerged() {
  #if FORGE_TERRAIN_PUDDLES > 0
  for(int i=0;i<17;i++) {
    if(i>=uPuddleTerrainCount)break;
    vec4 g=uPuddleTerrainGrid[i],p=uPuddleTerrainLevels[i];
    if(p.y<.5 || vCausticWorld.y>=p.x)continue;
    vec2 grid=(vCausticWorld.xz-g.xy)*g.z;
    ivec2 cell=ivec2(floor(grid));
    if(any(lessThan(cell,ivec2(0)))||any(greaterThanEqual(cell,ivec2(g.w))))continue;
    int faces=int(round(texelFetch(uPuddleTerrainMask,ivec3(cell,i),0).r*255.));
    vec2 f=fract(grid);int face=f.x+f.y<=1.?1:2;
    if((faces & face)!=0)return 1.;
  }
  #endif
  return 0.;
}
`;
