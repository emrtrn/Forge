import {
  AmbientLight,
  Box3,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type Group,
  type InstancedMesh,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { GltfModelLoader } from "@engine/render-three/gltfModelLoader";
import { colliderBoxFromBounds } from "@engine/render-three/transforms";
import { PhysicsSubsystem } from "@engine/physics/physicsSubsystem";
import { assetCollisionDefHasCollider, complexAsSimpleAssetIds, type AssetCollisionDef } from "@engine/scene/collision";
import type { LayoutPlacement, RoomLayout } from "@engine/scene/layout";
import { roomLayoutToSceneDocument } from "@engine/scene/legacyRoomLayoutAdapter";
import { loadAssetCollision } from "@/scene/assetCollisionLoader";
import { buildSceneInstancedModel, computeComplexCollisionMeshes, computeModelLocalBounds } from "@/scene/SceneRuntimeCore";

/**
 * OPEN_WORLD_PLAN Faz 5 option 2 / S0 — throwaway, never merged.
 * Measures one dense static cell's activation and unload, phase by phase.
 */

declare global {
  interface Window { __spikeReport?: unknown }
}

const params = new URLSearchParams(location.search);
const COUNTS = (params.get("counts") ?? "100,250,500,1000").split(",").map(Number);
const ITERATIONS = Number(params.get("iterations") ?? 8);
const CELL = Number(params.get("cell") ?? 128);
const COMPLEX_SHARE = Number(params.get("complex") ?? 0.15);

// Simple-collider props, plus complex-as-simple trimesh pieces (authored sidecars).
const SIMPLE_ASSETS = ["shape-cube", "shape-cylinder", "shape-sphere", "shape-pipe", "shape-cone", "sm-bump"];
const COMPLEX_ASSETS = ["sm-linearstair", "sm-ramp"];

const out = document.getElementById("out") as HTMLPreElement;
const lines: string[] = [];
function log(line: string): void {
  lines.push(line);
  out.textContent = lines.join("\n");
}

interface Stats { avg: number; p95: number; max: number }
function stats(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))]!,
    max: sorted[sorted.length - 1]!,
  };
}
const fmt = (s: Stats): string => `avg ${s.avg.toFixed(2)} p95 ${s.p95.toFixed(2)} max ${s.max.toFixed(2)}`;

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cellLayout(count: number, seed: number): RoomLayout {
  const random = rng(seed);
  const groups = new Map<string, LayoutPlacement[]>();
  for (let index = 0; index < count; index += 1) {
    const complex = random() < COMPLEX_SHARE;
    const pool = complex ? COMPLEX_ASSETS : SIMPLE_ASSETS;
    const assetId = pool[Math.floor(random() * pool.length)]!;
    const placements = groups.get(assetId) ?? [];
    placements.push({
      position: [random() * CELL, 0, random() * CELL],
      rotationYDeg: random() * 360,
      scale: 0.5 + random() * 1.5,
    } as LayoutPlacement);
    groups.set(assetId, placements);
  }
  return {
    schema: 1, name: "cell", loadGroups: [], characters: [],
    instances: [...groups].map(([assetId, placements]) => ({ assetId, placements })),
  } as RoomLayout;
}

async function main(): Promise<void> {
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  const renderer = new WebGLRenderer({ canvas, antialias: false });
  renderer.shadowMap.enabled = true;
  const gl = renderer.getContext();
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 0.4));
  const sun = new DirectionalLight(0xffffff, 2);
  sun.position.set(CELL / 2 + 40, 80, CELL / 2 + 20);
  sun.target.position.set(CELL / 2, 0, CELL / 2);
  sun.castShadow = true;
  scene.add(sun, sun.target);
  const camera = new PerspectiveCamera(60, canvas.width / canvas.height, 0.1, 2000);
  camera.position.set(CELL / 2, 70, CELL + 60);
  camera.lookAt(CELL / 2, 0, CELL / 2);

  const manifest = await (await fetch("/assets/manifest.json")).json() as { assets: { id: string; path: string }[] };
  const pathOf = (id: string) => manifest.assets.find((asset) => asset.id === id)!.path;
  const loader = new GltfModelLoader(renderer);
  const models = new Map<string, GLTF>();
  for (const id of [...SIMPLE_ASSETS, ...COMPLEX_ASSETS]) models.set(id, await loader.load(id, `/${pathOf(id)}`));
  const bounds = computeModelLocalBounds(models);
  const defs = new Map<string, AssetCollisionDef>();
  for (const id of models.keys()) {
    const def = await loadAssetCollision(pathOf(id));
    if (assetCollisionDefHasCollider(def)) defs.set(id, def);
  }
  const complexMeshes = computeComplexCollisionMeshes(models, complexAsSimpleAssetIds(defs));
  log(`assets ${models.size}, collision sidecars ${defs.size}, complex-as-simple ${[...complexMeshes.keys()].join(",")}`);
  const adapter = {
    colliderBox: (assetId: string, source: Parameters<typeof colliderBoxFromBounds>[1]) => {
      const box = bounds.get(assetId);
      return box ? colliderBoxFromBounds(box as Box3, source) : undefined;
    },
    collisionDefs: defs,
    complexCollisionMeshes: complexMeshes,
  };

  const physics = new PhysicsSubsystem({ backend: "rapier" });
  // A persistent ground, as a level always has, so Rapier loads and indexes are non-empty.
  const ground = roomLayoutToSceneDocument({
    schema: 1, name: "ground", loadGroups: [], characters: [],
    instances: [{ assetId: "shape-cube", placements: [{ position: [CELL / 2, -1, CELL / 2], scale: [CELL * 3, 1, CELL * 3] } as LayoutPlacement] }],
  } as RoomLayout, adapter).entities.map((entity) => ({ ...entity, id: `ground:${entity.id}` }));
  physics.setEntities(ground);
  await physics.init();
  let elapsed = 0;
  let frame = 0;
  const step = () => physics.update({ deltaSeconds: 1 / 60, elapsedSeconds: (elapsed += 1 / 60), frame: frame++ });
  const pixel = new Uint8Array(4);
  const drawAndSync = () => {
    renderer.render(scene, camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  };
  drawAndSync();

  type Phase = "derive" | "batches" | "physicsAdd" | "staticQueries" | "firstDraw" | "physicsStep" | "physicsStep2" | "rawStep" | "unload";
  const PHASES: Phase[] = ["derive", "batches", "physicsAdd", "staticQueries", "firstDraw", "physicsStep", "physicsStep2", "rawStep", "unload"];
  const report: Record<string, unknown> = { status: "running", cellSize: CELL, iterations: ITERATIONS, complexShare: COMPLEX_SHARE };
  let cold: Record<Phase, number> | null = null;

  for (const count of COUNTS) {
    const samples = Object.fromEntries(PHASES.map((phase) => [phase, [] as number[]])) as Record<Phase, number[]>;
    const totals: number[] = [];
    const entityCounts: number[] = [];
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const layout = cellLayout(count, count * 1000 + iteration);
      const time: Partial<Record<Phase, number>> = {};
      let t = performance.now();
      const mark = (phase: Phase) => {
        const now = performance.now();
        time[phase] = now - t;
        t = now;
      };
      const entities = roomLayoutToSceneDocument(layout, adapter).entities;
      mark("derive");
      const groups: Group[] = [];
      const meshes: InstancedMesh[] = [];
      for (const instance of layout.instances) {
        const built = buildSceneInstancedModel({
          assetId: instance.assetId, gltf: models.get(instance.assetId)!, placements: instance.placements,
          castShadow: true, receiveShadow: true,
        });
        groups.push(built.group);
        meshes.push(...built.meshes);
      }
      mark("batches");
      physics.addEntities(entities);
      mark("physicsAdd");
      // Character movement asks these every frame; the first call after an add rebuilds the index.
      physics.staticBlockerAabbsNear(CELL / 2, CELL / 2, 4);
      physics.staticSurfaceTrianglesNear(CELL / 2, CELL / 2);
      mark("staticQueries");
      for (const group of groups) scene.add(group);
      drawAndSync();
      mark("firstDraw");
      step();
      mark("physicsStep");
      // A steady-state step with the cell resident (not part of activation).
      step();
      mark("physicsStep2");
      // Rapier alone, without Forge's per-body contact gathering.
      (physics as unknown as { rapierWorld: { step(): void } }).rapierWorld.step();
      mark("rawStep");
      physics.removeEntities(entities.map((entity) => entity.id));
      for (const group of groups) scene.remove(group);
      for (const mesh of meshes) mesh.dispose();
      physics.staticBlockerAabbsNear(CELL / 2, CELL / 2, 4);
      mark("unload");
      drawAndSync();
      const sample = time as Record<Phase, number>;
      if (!cold) {
        cold = sample;
        continue;
      }
      for (const phase of PHASES) samples[phase].push(sample[phase]);
      totals.push(PHASES.filter((phase) => phase !== "unload" && phase !== "physicsStep2" && phase !== "rawStep").reduce((sum, phase) => sum + sample[phase], 0));
      entityCounts.push(entities.length);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const row: Record<string, unknown> = { placements: count, entities: entityCounts[0] };
    log(`\n== ${count} placements (${entityCounts[0]} entities), ${totals.length} warm runs, ms`);
    for (const phase of PHASES) {
      const s = stats(samples[phase]);
      row[phase] = s;
      log(`${phase.padEnd(14)} ${fmt(s)}`);
    }
    const total = stats(totals);
    row.activateTotal = total;
    log(`${"activate total".padEnd(14)} ${fmt(total)}`);
    (report.rows as unknown[] | undefined)?.push(row) ?? (report.rows = [row]);
  }
  report.coldFirstCell = cold;
  log(`\ncold first cell (shader compile included): ${JSON.stringify(cold, (_, v) => typeof v === "number" ? Number(v.toFixed(2)) : v)}`);
  log(`gpu: ${(gl.getParameter(gl.RENDERER) as string) ?? "?"}`);
  report.status = "complete";
  window.__spikeReport = report;
}

main().catch((error) => {
  log(`FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  window.__spikeReport = { status: "failed", error: String(error) };
});
