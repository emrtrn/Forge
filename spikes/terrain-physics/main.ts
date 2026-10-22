import RAPIER from "@dimforge/rapier3d-compat";

import { terrainTileHeightfieldShape } from "@engine/physics/terrainCollider";
import { createReferenceCarDefinition } from "@engine/physics/vehicle/vehicleTypes";
import { TerrainTileMap, terrainHeightAt } from "@engine/terrain/terrainHeightQuery";
import {
  terrainTileWorldBounds,
  type TerrainTileData,
  type WorldTerrainDef,
} from "@engine/terrain/terrainTypes";

import { generateSpikeWorld } from "../terrain-cdlod/worldGen";

/**
 * OPEN_WORLD_PLAN Faz 0 / S4 spike page — throwaway, never merged.
 * npm run dev:smoke → http://127.0.0.1:5273/spikes/terrain-physics/index.html
 *
 *  A. Create/remove cost of a 257² tile as a Rapier heightfield (the K3 plan)
 *     vs a trimesh (today's Landscape collider), from real codec tiles.
 *  B. Ray continuity on tile seams and corners against terrainHeightAt.
 *  C. A ball and Forge's reference car crossing a seam and a corner, compared
 *     step by step with the same run on one seamless heightfield.
 */

const out = document.getElementById("out") as HTMLPreElement;
const lines: string[] = [];
function log(line: string): void {
  lines.push(line);
  out.textContent = lines.join("\n");
}
function stats(values: number[]): { avg: number; p95: number; max: number } {
  if (values.length === 0) return { avg: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    avg: values.reduce((s, v) => s + v, 0) / values.length,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))]!,
    max: sorted[sorted.length - 1]!,
  };
}
const f = (value: number, digits = 2): string => value.toFixed(digits);
const fmt = (s: { avg: number; p95: number; max: number }): string => `avg ${f(s.avg)} p95 ${f(s.p95)} max ${f(s.max)} ms`;
const STEP = 1 / 60;

function addHeightfield(
  world: RAPIER.World,
  def: Pick<WorldTerrainDef, "tileQuads" | "spacing" | "origin">,
  tile: TerrainTileData,
  flags?: RAPIER.HeightFieldFlags,
): RAPIER.RigidBody {
  const shape = terrainTileHeightfieldShape(def, tile);
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(shape.translation[0], shape.translation[1], shape.translation[2]),
  );
  world.createCollider(
    RAPIER.ColliderDesc.heightfield(
      shape.nrows,
      shape.ncols,
      shape.heights,
      { x: shape.scale[0], y: shape.scale[1], z: shape.scale[2] },
      flags,
    ),
    body,
  );
  return body;
}

/** Same triangulation as createLandscapeColliderPrimitive (a,c,b / b,c,d). */
function tileTrimesh(def: Pick<WorldTerrainDef, "spacing" | "origin" | "tileQuads">, tile: TerrainTileData): { vertices: Float32Array; indices: Uint32Array } {
  const size = tile.size;
  const bounds = terrainTileWorldBounds(def, tile.x, tile.z);
  const vertices = new Float32Array(size * size * 3);
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (z * size + x) * 3;
      vertices[i] = bounds.minX + x * def.spacing;
      vertices[i + 1] = def.origin[1] + tile.heights[z * size + x]!;
      vertices[i + 2] = bounds.minZ + z * def.spacing;
    }
  }
  const quads = size - 1;
  const indices = new Uint32Array(quads * quads * 6);
  let cursor = 0;
  for (let z = 0; z < quads; z += 1) {
    for (let x = 0; x < quads; x += 1) {
      const a = z * size + x;
      const b = a + 1;
      const c = a + size;
      const d = c + 1;
      indices.set([a, c, b, b, c, d], cursor);
      cursor += 6;
    }
  }
  return { vertices, indices };
}

// --- A. create / remove cost --------------------------------------------------------------

async function timing(): Promise<void> {
  const generated = await generateSpikeWorld(
    { tiles: 4, tileQuads: 256, spacing: 1, leafQuads: 32, globalStride: 16, seed: 1337, layerCount: 4 },
    () => undefined,
  );
  const def = generated.def;
  const tiles: TerrainTileData[] = [];
  for (let z = 0; z < 4; z += 1) for (let x = 0; x < 4; x += 1) tiles.push(generated.lookup.tile(x, z)!);

  const shapeMs: number[] = [];
  const createMs: number[] = [];
  const removeMs: number[] = [];
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  for (let round = 0; round < 4; round += 1) {
    const bodies: RAPIER.RigidBody[] = [];
    for (const tile of tiles) {
      const t0 = performance.now();
      const shape = terrainTileHeightfieldShape(def, tile);
      const t1 = performance.now();
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(shape.translation[0], shape.translation[1], shape.translation[2]),
      );
      world.createCollider(
        RAPIER.ColliderDesc.heightfield(shape.nrows, shape.ncols, shape.heights, { x: shape.scale[0], y: 1, z: shape.scale[2] }),
        body,
      );
      const t2 = performance.now();
      bodies.push(body);
      if (round > 0) {
        shapeMs.push(t1 - t0);
        createMs.push(t2 - t1);
      }
    }
    // One step so the broad phase has really ingested the colliders.
    const s0 = performance.now();
    world.step();
    const firstStepMs = performance.now() - s0;
    if (round === 3) log(`   world.step() right after adding 16 heightfields: ${f(firstStepMs)} ms`);
    for (const body of bodies) {
      const t0 = performance.now();
      world.removeRigidBody(body);
      if (round > 0) removeMs.push(performance.now() - t0);
    }
    world.step();
  }
  log(`A. heightfield 257² (real codec tiles, 16 tiles × 3 warm rounds):`);
  log(`   shape build (row→column-major copy) ${fmt(stats(shapeMs))}`);
  log(`   createRigidBody + createCollider    ${fmt(stats(createMs))}`);
  log(`   removeRigidBody                     ${fmt(stats(removeMs))}`);

  const trimeshBuild: number[] = [];
  const trimeshCreate: number[] = [];
  const trimeshRemove: number[] = [];
  for (const tile of tiles.slice(0, 4)) {
    const t0 = performance.now();
    const mesh = tileTrimesh(def, tile);
    const t1 = performance.now();
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices), body);
    const t2 = performance.now();
    world.step();
    const t3 = performance.now();
    world.removeRigidBody(body);
    trimeshRemove.push(performance.now() - t3);
    trimeshBuild.push(t1 - t0);
    trimeshCreate.push(t2 - t1);
  }
  log(`   trimesh (today's Landscape collider, 131k triangles), 4 tiles:`);
  log(`   arrays ${fmt(stats(trimeshBuild))}; createCollider ${fmt(stats(trimeshCreate))}; remove ${fmt(stats(trimeshRemove))}`);
  world.free();

  // --- B. ray continuity ----------------------------------------------------------------
  const rayWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  for (const tile of tiles) addHeightfield(rayWorld, def, tile);
  rayWorld.step();
  const map = new TerrainTileMap();
  for (const tile of tiles) map.set(tile);
  const size = 4 * 256;
  const points: Array<[number, number]> = [];
  for (let k = 1; k < 4; k += 1) {
    for (let t = 0; t <= size; t += 0.25) {
      points.push([def.origin[0] + k * 256, def.origin[2] + t]);
      points.push([def.origin[0] + t, def.origin[2] + k * 256]);
      for (const e of [1e-4, -1e-4]) points.push([def.origin[0] + k * 256 + e, def.origin[2] + t]);
    }
    for (let j = 1; j < 4; j += 1) points.push([def.origin[0] + k * 256, def.origin[2] + j * 256]);
  }
  let seed = 3;
  const rand = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 4000; i += 1) points.push([def.origin[0] + rand() * size, def.origin[2] + rand() * size]);
  let misses = 0;
  let maxError = 0;
  for (const [x, z] of points) {
    const hit = rayWorld.castRay(new RAPIER.Ray({ x, y: 2000, z }, { x: 0, y: -1, z: 0 }), 4000, true);
    if (!hit) {
      misses += 1;
      continue;
    }
    const expected = terrainHeightAt(def, map, x, z);
    if (expected !== null) maxError = Math.max(maxError, Math.abs(2000 - hit.timeOfImpact - expected));
  }
  log(`B. down-rays on 4×4 tiles: ${points.length} (seam lines every 0.25 m, ±0.1 mm off seams, inner corners, 4000 random):`);
  log(`   misses ${misses}; max |ray − terrainHeightAt| ${maxError.toExponential(2)} m`);
  rayWorld.free();
}

// --- C. ball + reference car across a seam ------------------------------------------------

/** Smooth analytic relief, so any bump at a seam comes from the colliders. */
function analyticHeight(x: number, z: number): number {
  return 0.03 * x + 0.015 * z + 1.5 * Math.sin(x / 37) * Math.cos(z / 53);
}

function analyticWorld(tilesPerAxis: number, tileQuads: number, flags?: RAPIER.HeightFieldFlags): RAPIER.World {
  const def: Pick<WorldTerrainDef, "tileQuads" | "spacing" | "origin"> = { tileQuads, spacing: 1, origin: [0, 0, 0] };
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  const size = tileQuads + 1;
  for (let tz = 0; tz < tilesPerAxis; tz += 1) {
    for (let tx = 0; tx < tilesPerAxis; tx += 1) {
      const heights = new Float32Array(size * size);
      for (let z = 0; z < size; z += 1) {
        for (let x = 0; x < size; x += 1) heights[z * size + x] = analyticHeight(tx * tileQuads + x, tz * tileQuads + z);
      }
      addHeightfield(world, def, { x: tx, z: tz, size, heights, layerCount: 0, weights: new Uint8Array(0) }, flags);
    }
  }
  return world;
}

interface Trace {
  y: number[];
  vy: number[];
  suspension: number[][];
}

function runBall(world: RAPIER.World, start: [number, number], velocity: [number, number], steps: number): Trace & { px: number[]; pz: number[] } {
  const radius = 0.4;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start[0], analyticHeight(start[0], start[1]) + radius + 0.01, start[1])
      .setLinvel(velocity[0], 0, velocity[1])
      .setCcdEnabled(true),
  );
  world.createCollider(RAPIER.ColliderDesc.ball(radius).setFriction(0.6), body);
  const trace = { y: [] as number[], vy: [] as number[], suspension: [] as number[][], px: [] as number[], pz: [] as number[] };
  for (let i = 0; i < steps; i += 1) {
    world.step();
    const p = body.translation();
    trace.px.push(p.x);
    trace.pz.push(p.z);
    trace.y.push(p.y - analyticHeight(p.x, p.z));
    trace.vy.push(body.linvel().y);
  }
  return trace;
}

function runCar(world: RAPIER.World, start: [number, number], yaw: number, steps: number): Trace & { px: number[]; pz: number[] } {
  const definition = createReferenceCarDefinition();
  const [width, height, length] = [1.8, 0.6, 4.2];
  const h = analyticHeight(start[0], start[1]);
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start[0], h + 1.2, start[1])
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, height / 2, length / 2).setDensity(0), body);
  const mass = definition.massKg;
  body.setAdditionalMassProperties(
    mass,
    { x: definition.centerOfMassOffset[0], y: definition.centerOfMassOffset[1], z: definition.centerOfMassOffset[2] },
    {
      x: (mass / 12) * (height * height + length * length),
      y: (mass / 12) * (width * width + length * length),
      z: (mass / 12) * (width * width + height * height),
    },
    { x: 0, y: 0, z: 0, w: 1 },
    true,
  );
  // Mirrors PhysicsSubsystem.attachVehicleController.
  const controller = world.createVehicleController(body);
  controller.indexUpAxis = 1;
  controller.setIndexForwardAxis = 2;
  definition.wheels.forEach((wheel, index) => {
    controller.addWheel(
      { x: wheel.position[0], y: wheel.position[1], z: wheel.position[2] },
      { x: 0, y: -1, z: 0 },
      { x: -1, y: 0, z: 0 },
      wheel.suspensionRestLength,
      wheel.radius,
    );
    controller.setWheelMaxSuspensionTravel(index, wheel.suspensionMaxTravel);
    controller.setWheelSuspensionStiffness(index, wheel.suspensionStiffness);
    controller.setWheelSuspensionCompression(index, wheel.suspensionCompression);
    controller.setWheelSuspensionRelaxation(index, wheel.suspensionRelaxation);
    controller.setWheelMaxSuspensionForce(index, wheel.maxSuspensionForce);
    controller.setWheelFrictionSlip(index, wheel.frictionSlip);
    controller.setWheelSideFrictionStiffness(index, wheel.sideFrictionStiffness);
  });
  const trace = { y: [] as number[], vy: [] as number[], suspension: [] as number[][], px: [] as number[], pz: [] as number[] };
  for (let i = 0; i < steps; i += 1) {
    definition.wheels.forEach((wheel, index) => controller.setWheelEngineForce(index, wheel.drive ? definition.maxEngineForce * 0.5 : 0));
    controller.updateVehicle(STEP);
    world.step();
    const p = body.translation();
    trace.px.push(p.x);
    trace.pz.push(p.z);
    trace.y.push(p.y - analyticHeight(p.x, p.z));
    trace.vy.push(body.linvel().y);
    trace.suspension.push(definition.wheels.map((_, index) => controller.wheelSuspensionLength(index) ?? Number.NaN));
  }
  return trace;
}

function compareRuns(label: string, tiled: Trace, seamless: Trace, nearSeam: (i: number) => boolean): void {
  let maxGap = 0;
  let maxVyJumpSeam = 0;
  let maxVyJumpElsewhere = 0;
  let maxSuspJumpSeam = 0;
  let maxSuspJumpElsewhere = 0;
  for (let i = 1; i < tiled.y.length; i += 1) {
    maxGap = Math.max(maxGap, Math.abs(tiled.y[i]! - seamless.y[i]!));
    const vyJump = Math.abs(tiled.vy[i]! - tiled.vy[i - 1]!);
    let suspJump = 0;
    if (tiled.suspension.length > i) {
      tiled.suspension[i]!.forEach((value, w) => {
        suspJump = Math.max(suspJump, Math.abs(value - tiled.suspension[i - 1]![w]!));
      });
    }
    if (nearSeam(i)) {
      maxVyJumpSeam = Math.max(maxVyJumpSeam, vyJump);
      maxSuspJumpSeam = Math.max(maxSuspJumpSeam, suspJump);
    } else {
      maxVyJumpElsewhere = Math.max(maxVyJumpElsewhere, vyJump);
      maxSuspJumpElsewhere = Math.max(maxSuspJumpElsewhere, suspJump);
    }
  }
  log(
    `   ${label}: tiled vs seamless height-above-ground max diff ${(maxGap * 100).toFixed(2)} cm; ` +
      `per-step |Δvy| near seam ${f(maxVyJumpSeam, 3)} vs elsewhere ${f(maxVyJumpElsewhere, 3)} m/s` +
      (tiled.suspension.length > 0
        ? `; per-step |Δsuspension| near seam ${(maxSuspJumpSeam * 100).toFixed(2)} vs elsewhere ${(maxSuspJumpElsewhere * 100).toFixed(2)} cm`
        : ""),
  );
}

function seams(): void {
  log("C. seam crossings on analytic relief: 2×2 tiles (256 q) vs one 512 q heightfield, 60 Hz:");
  const ballCases: Array<{ label: string; start: [number, number]; velocity: [number, number] }> = [
    { label: "ball across x = 256 seam", start: [200, 100], velocity: [18, 0] },
    { label: "ball through (256, 256) corner", start: [215, 215], velocity: [16, 16] },
  ];
  const fix = RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES;
  const variants: Array<{ name: string; make: () => RAPIER.World }> = [
    { name: "2×2 tiles", make: () => analyticWorld(2, 256) },
    { name: "2×2 tiles + FIX_INTERNAL_EDGES", make: () => analyticWorld(2, 256, fix) },
    { name: "seamless", make: () => analyticWorld(1, 512) },
    { name: "seamless + FIX_INTERNAL_EDGES", make: () => analyticWorld(1, 512, fix) },
  ];
  for (const c of ballCases) {
    const runs = variants.map((variant) => {
      const world = variant.make();
      const trace = runBall(world, c.start, c.velocity, 360);
      world.free();
      return trace;
    });
    const reference = runs[3]!;
    log(`   ${c.label} (reference: seamless + FIX_INTERNAL_EDGES):`);
    runs.forEach((trace, index) => {
      let worstSeam = 0;
      let worstSeamAt = Number.NaN;
      let worstElsewhere = 0;
      let maxGap = 0;
      let crossed = false;
      // The first half second is the drop onto the ground, not the crossing.
      for (let i = 30; i < trace.vy.length; i += 1) {
        const jump = Math.abs(trace.vy[i]! - trace.vy[i - 1]!);
        const nearSeam = Math.abs(trace.px[i]! - 256) < 1.5 || Math.abs(trace.pz[i]! - 256) < 1.5;
        if (trace.px[i]! > 257 && (c.velocity[1] === 0 || trace.pz[i]! > 257)) crossed = true;
        if (nearSeam && jump > worstSeam) {
          worstSeam = jump;
          worstSeamAt = trace.px[i]!;
        } else if (!nearSeam) worstElsewhere = Math.max(worstElsewhere, jump);
        maxGap = Math.max(maxGap, Math.abs(trace.y[i]! - reference.y[i]!));
      }
      log(
        `     ${variants[index]!.name.padEnd(32)} per-step |Δvy| within 1.5 m of seam ${f(worstSeam, 3)} m/s` +
          `${Number.isFinite(worstSeamAt) ? ` (x ${f(worstSeamAt, 1)})` : ""}, elsewhere ${f(worstElsewhere, 3)} m/s; ` +
          `max height diff vs reference ${(maxGap * 100).toFixed(1)} cm${crossed ? "" : " (did not cross)"}`,
      );
    });
  }
  const carCases: Array<{ label: string; start: [number, number]; yaw: number }> = [
    { label: "reference car across x = 256 seam", start: [215, 100], yaw: Math.PI / 2 },
    { label: "reference car through (256, 256) corner", start: [225, 225], yaw: Math.PI / 4 },
  ];
  for (const c of carCases) {
    const runs = [analyticWorld(2, 256), analyticWorld(1, 512)].map((world) => {
      const trace = runCar(world, c.start, c.yaw, 420);
      world.free();
      return trace;
    });
    const tiled = runs[0]!;
    const crossed = tiled.px.some((x) => x > 260);
    compareRuns(
      `${c.label}${crossed ? "" : " (DID NOT REACH SEAM)"}`,
      tiled,
      runs[1]!,
      (i) => Math.abs(tiled.px[i]! - 256) < 3 || Math.abs(tiled.pz[i]! - 256) < 3,
    );
  }
}

async function run(): Promise<void> {
  log(`Forge S4 Rapier heightfield spike — ${new Date().toISOString()}`);
  log(`UA: ${navigator.userAgent}`);
  await RAPIER.init();
  log(`Rapier ${RAPIER.version()}`);
  await timing();
  seams();
  log("done");
  (window as Window & { __s4Done?: boolean }).__s4Done = true;
}

run().catch((error: unknown) => {
  log(`FAILED: ${error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)}`);
  (window as Window & { __s4Done?: boolean }).__s4Done = true;
});
