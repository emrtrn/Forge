import assert from "node:assert/strict";
import { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import { nominalWheelLoad, sinkage, vehicleWheelWidth } from "../../engine/physics/surface/sinkage";
import {
  createPhysicalMaterialSurfaceProvider, NEUTRAL_SURFACE_SAMPLE, resolveSurfaceSample,
  type VehicleSurfaceProvider,
} from "../../engine/physics/surface/surfaceResponse";
import { createReferenceCarDefinition, NEUTRAL_VEHICLE_INPUT } from "../../engine/physics/vehicle/vehicleTypes";
import { PHYSICAL_MATERIALS } from "../../engine/scene/collision";
import {
  createTerrainSurfaceProvider, terrainLayerPhysicalMaterials,
  TerrainSurfaceSampler, worldTerrainSurfaceSource,
} from "../../engine/terrain/terrainSurface";
import {
  createFlatTerrainTile, tileKey, TERRAIN_LAYERS_PER_WEIGHT_BLOCK,
  type TerrainTileData, type WorldTerrainDef, type WorldTerrainLayerDef,
} from "../../engine/terrain/terrainTypes";
import { landscapeColliderActorId, worldTerrainColliderEntities } from "../../engine/terrain/worldTerrainActor";
import { formatVehicleSinkDebug, formatVehicleSurfaceDebug } from "../../src/scene/debugStats";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;
const close = (actual: number, expected: number, epsilon = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

/**
 * TERRAIN_DEFORMATION Faz 1b: paint layers carry physical materials, and a wheel
 * on a terrain collider feels the weight-blended profile under its contact.
 */

const Q = 64;

function setWeight(tile: TerrainTileData, layer: number, vertex: number, weight: number): void {
  const block = Math.floor(layer / TERRAIN_LAYERS_PER_WEIGHT_BLOCK);
  tile.weights[block * tile.size * tile.size * 4 + vertex * 4 + (layer % TERRAIN_LAYERS_PER_WEIGHT_BLOCK)] = Math.round(weight * 255);
}

/** One flat 64 m tile centred on the origin; `paint(x, z)` returns per-layer weights at each vertex. */
function flatTerrain(layers: WorldTerrainLayerDef[], paint?: (x: number, z: number) => number[]) {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Surface", tileQuads: Q, spacing: 1, tilesX: 1, tilesZ: 1,
    origin: [-Q / 2, 0, -Q / 2], heightMin: -1, heightMax: 1, layers, tiles: [{ key: "0_0", minHeight: 0, maxHeight: 0 }],
    collision: true,
  };
  const tile = createFlatTerrainTile(def, 0, 0);
  if (paint) {
    for (let z = 0; z <= Q; z += 1) {
      for (let x = 0; x <= Q; x += 1) {
        paint(x - Q / 2, z - Q / 2).forEach((weight, layer) => setWeight(tile, layer, z * (Q + 1) + x, weight));
      }
    }
  }
  return { def, tiles: new Map([[tileKey(0, 0), tile]]) };
}

const LAYERS = (grass: string | null, mud: string | null): WorldTerrainLayerDef[] => [
  { id: "grass", name: "Grass", color: "#4a7a3a", ...(grass ? { physicalMaterial: grass } : {}) },
  { id: "mud", name: "Mud", color: "#5a4030", ...(mud ? { physicalMaterial: mud } : {}) },
];

/** Grass for x < -1, mud for x > 1, a linear blend between. */
const BORDER = (x: number): number[] => {
  const mud = Math.min(1, Math.max(0, (x + 1) / 2));
  return [1 - mud, mud];
};

export function registerTerrainSurfaceTests(check: Check): void {
  check("terrain surface: layer physics overrides affect grip, soil and tracks without mutating presets", () => {
    const preset = structuredClone(PHYSICAL_MATERIALS.mud);
    const layers = LAYERS("mud", "mud");
    layers[0]!.physicalMaterialOverrides = { tractionCoefficient: 0.9, maxDepth: 0.4, digRate: 0.2, recoveryRate: 0.03, ploughResistance: 0.1 };
    const sampler = new TerrainSurfaceSampler(worldTerrainSurfaceSource(flatTerrain(layers, BORDER))!);
    close(sampler.sampleAt([-10, 0, 0])!.tractionCoefficient!, 0.9);
    close(sampler.sampleAt([10, 0, 0])!.tractionCoefficient!, 0.4);
    close(sampler.sampleAt([0, 0, 0])!.tractionCoefficient!, 0.65);
    close(sampler.sampleAt([-10, 0, 0])!.softGround!.ploughResistance, 0.1);
    close(sampler.deformationAt([-10, 0, 0])!.maxDepth, 0.4);
    close(sampler.deformationAt([-10, 0, 0])!.recoveryRate, 0.03);
    close(sampler.deformationAt([0, 0, 0])!.digRate, 0.14);
    assert.deepEqual(PHYSICAL_MATERIALS.mud, preset);
    assert.deepEqual(sampler.sampleAt([10, 0, 0]), resolveSurfaceSample("mud"));
    layers[0]!.physicalMaterialOverrides = { maxDepth: 0 };
    const disabled = new TerrainSurfaceSampler(worldTerrainSurfaceSource(flatTerrain(layers, BORDER))!);
    assert.equal(disabled.deformationAt([-10, 0, 0]), null);
    assert.equal(disabled.sampleAt([-10, 0, 0])!.deformability, 0);
  });
  check("terrain surface: a terrain with no physical material layer builds no source", () => {
    assert.equal(terrainLayerPhysicalMaterials([{}, { physicalMaterial: null }]), null);
    assert.deepEqual(terrainLayerPhysicalMaterials([{}, { physicalMaterial: "mud" }]), [null, "mud"]);
    assert.equal(worldTerrainSurfaceSource(flatTerrain(LAYERS(null, null), BORDER)), null);
  });

  check("terrain surface: layer weights blend like resolveSurfaceSample across a mud border", () => {
    const sampler = new TerrainSurfaceSampler(worldTerrainSurfaceSource(flatTerrain(LAYERS(null, "mud"), BORDER))!);
    const mud = resolveSurfaceSample("mud");
    assert.deepEqual(sampler.sampleAt([-10, 0, 3]), NEUTRAL_SURFACE_SAMPLE);
    assert.deepEqual(sampler.sampleAt([10, 0, 3]), mud);
    // Vertex weights are stored as bytes and interpolated between vertices.
    const stored = (x: number, layer: number): number => Math.round(BORDER(x)[layer]! * 255) / 255;
    for (const x of [-0.75, -0.2, 0, 0.4, 0.9]) {
      const fx = x - Math.floor(x);
      const weight = (layer: number) => stored(Math.floor(x), layer) * (1 - fx) + stored(Math.floor(x) + 1, layer) * fx;
      const expected = resolveSurfaceSample([
        { physicalMaterialId: null, weight: weight(0) }, { physicalMaterialId: "mud", weight: weight(1) },
      ]);
      const actual = sampler.sampleAt([x, 0, 3])!;
      close(actual.tractionCoefficient!, expected.tractionCoefficient!);
      for (const key of ["frictionSlipScale", "sideFrictionScale", "rollingResistance", "deformability"] as const) {
        close(actual[key], expected[key]);
      }
    }
    assert.equal(sampler.sampleAt([Q, 0, 0]), null, "off the terrain");
    assert.equal(sampler.dominantMaterialAt([-0.75, 0, 0]), null);
    assert.equal(sampler.dominantMaterialAt([0.75, 0, 0]), "mud");
  });

  check("terrain surface: deformation carries mud digging and belly resistance and averages a mud/snow blend", () => {
    const mud = PHYSICAL_MATERIALS.mud!.deformation!;
    const snow = PHYSICAL_MATERIALS.snow!.deformation!;
    const sampler = (weights: readonly number[]) => new TerrainSurfaceSampler({
      physicalMaterials: [null, "mud", "snow"],
      weightsAt: (_point, out) => {
        out.length = weights.length;
        weights.forEach((weight, index) => { out[index] = weight; });
        return true;
      },
    });
    const pureMud = sampler([0, 1, 0]).deformationAt([0, 0, 0])!;
    close(pureMud.digRate, mud.digRate);
    close(pureMud.sinkResistance, mud.sinkResistance);
    close(pureMud.wetness!, mud.wetness);
    const blend = sampler([0, 0.5, 0.5]).deformationAt([0, 0, 0])!;
    close(blend.digRate, (mud.digRate + snow.digRate) / 2);
    close(blend.sinkResistance, (mud.sinkResistance + snow.sinkResistance) / 2);
    close(blend.wetness!, (mud.wetness + snow.wetness) / 2);
    // Hard-layer weight affects participation, not the soft profile's rates.
    const partlySoft = sampler([0.5, 0.125, 0.375]).deformationAt([0, 0, 0])!;
    close(partlySoft.deformability, 0.5);
    close(partlySoft.digRate, mud.digRate * 0.25 + snow.digRate * 0.75);
    close(partlySoft.sinkResistance, mud.sinkResistance * 0.25 + snow.sinkResistance * 0.75);
    close(partlySoft.wetness!, mud.wetness * 0.125 + snow.wetness * 0.375);
  });

  check("terrain surface: unpainted vertices are neutral, extra tile layers count as neutral weight", () => {
    const terrain = flatTerrain(LAYERS("snow", "mud"), () => [0, 0]);
    assert.deepEqual(new TerrainSurfaceSampler(worldTerrainSurfaceSource(terrain)!).sampleAt([0, 0, 0]), NEUTRAL_SURFACE_SAMPLE);
    // The tile holds a third layer the definition no longer lists: half its weight stays neutral.
    const source = { physicalMaterials: ["mud"], weightsAt: (_point: readonly number[], out: number[]) => {
      out.length = 2; out[0] = 0.5; out[1] = 0.5; return true;
    } };
    const blended = new TerrainSurfaceSampler(source).sampleAt([0, 0, 0])!;
    close(blended.frictionSlipScale, (1 + PHYSICAL_MATERIALS.mud!.vehicle!.frictionSlipScale) / 2);
  });

  check("terrain surface: collider ids map to the Landscape actor; other ground uses the fallback", () => {
    assert.equal(landscapeColliderActorId("landscape:world:3_-2"), "world");
    assert.equal(landscapeColliderActorId("landscape:legacy"), "legacy");
    assert.equal(landscapeColliderActorId("landscape:a:b"), "a:b");
    assert.equal(landscapeColliderActorId("landscape-splines:world"), null);
    assert.equal(landscapeColliderActorId("rock"), null);
    const sampler = new TerrainSurfaceSampler(worldTerrainSurfaceSource(flatTerrain(LAYERS(null, "mud"), BORDER))!);
    const fallbackCalls: (string | null)[] = [];
    const fallback: VehicleSurfaceProvider = (_vehicle, _wheel, ground) => {
      fallbackCalls.push(ground);
      return resolveSurfaceSample("snow");
    };
    const provider = createTerrainSurfaceProvider(
      (id) => landscapeColliderActorId(id) === "world" ? sampler : undefined, fallback);
    assert.deepEqual(provider("car", 0, "landscape:world:0_0", [10, 0, 0]), resolveSurfaceSample("mud"));
    assert.deepEqual(provider("car", 0, "landscape:world:0_0", [500, 0, 0]), NEUTRAL_SURFACE_SAMPLE);
    assert.deepEqual(provider("car", 0, "landscape:other:0_0", [10, 0, 0]), resolveSurfaceSample("snow"));
    assert.deepEqual(provider("car", 0, "rock", [10, 0, 0]), resolveSurfaceSample("snow"));
    assert.deepEqual(provider("car", 0, null, [10, 0, 0]), resolveSurfaceSample("snow"));
    assert.deepEqual(fallbackCalls, ["landscape:other:0_0", "rock", null]);
  });

  check("terrain surface: the ?debug vehicle surface line names each wheel's ground and response", () => {
    assert.equal(formatVehicleSurfaceDebug({ vehicle: "actor:0", wheels: [
      { surface: "mud", frictionSlipScale: 0.55, rollingResistance: 0.35, sinkDepth: 0.031, tractionSlip: 0.4 },
      { surface: "air", frictionSlipScale: 1, rollingResistance: 0, sinkDepth: 0, tractionSlip: 0 },
    ] }), "vehicle surface: actor:0 | mud fs:0.55 rr:0.35 | air fs:1.00 rr:0.00");
  });

  check("terrain surface: the ?debug vehicle sink line shows each wheel's sink depth and traction slip", () => {
    assert.equal(formatVehicleSinkDebug({ vehicle: "actor:0", wheels: [
      { surface: "mud", frictionSlipScale: 0.55, rollingResistance: 0.35, sinkDepth: 0.0314, tractionSlip: 0.456 },
      { surface: "air", frictionSlipScale: 1, rollingResistance: 0, sinkDepth: 0, tractionSlip: 0 },
    ] }), "vehicle sink: actor:0 | 0.031 m slip 0.46 | 0.000 m slip 0.00");
  });

  check("sinkage: an empty vehicle presses half the layer, heavier loads sink deeper but never past it", () => {
    const profile = { maxDepth: 0.22 };
    const at = (load: number, deformability = 1) => sinkage(profile, deformability, { load, nominalLoad: 3000, width: 0.25 });
    close(at(3000), 0.11);
    close(at(6000), 0.165);
    close(at(3000, 0.5), 0.055);
    close(at(3000, 2), 0.11, 1e-12);
    let previous = 0;
    for (const ratio of [0.25, 0.5, 1, 1.5, 2, 4, 8]) {
      const depth = at(3000 * ratio);
      assert.ok(depth > previous && depth < 0.22, `ratio ${ratio}: ${depth}`);
      previous = depth;
    }
    close(sinkage(profile, 1, { load: Number.MAX_VALUE, nominalLoad: Number.MIN_VALUE, width: 0.25 }), 0.22);
    for (const [deformability, load, nominalLoad] of [[0, 3000, 3000], [-1, 3000, 3000], [1, -1, 3000], [1, 0, 3000],
      [1, 3000, 0], [1, NaN, 3000], [NaN, 3000, 3000], [1, 3000, Infinity]]) {
      assert.equal(sinkage(profile, deformability!, { load: load!, nominalLoad: nominalLoad!, width: 0.25 }), 0);
    }
    assert.equal(sinkage(undefined, 1, { load: 3000, nominalLoad: 3000, width: 0.25 }), 0);
    assert.equal(sinkage({ maxDepth: -1 }, 1, { load: 3000, nominalLoad: 3000, width: 0.25 }), 0);
  });

  check("sinkage: nominal load is the empty chassis weight per wheel; width defaults from the radius", () => {
    const car = createReferenceCarDefinition();
    close(nominalWheelLoad(car), car.massKg * 9.81 / car.wheels.length);
    assert.equal(nominalWheelLoad({ massKg: 1000, wheels: [] }), 0);
    close(vehicleWheelWidth({ radius: 0.4 }), 0.28);
    assert.equal(vehicleWheelWidth({ radius: 0.4, width: 0.5 }), 0.5);
  });
}

/** Reference car on a flat World Terrain heightfield, full throttle; forward speed every 0.5 s. */
async function driveOnTerrain(layers: WorldTerrainLayerDef[], provider: "mesh" | "terrain"): Promise<{ speeds: number[]; ground: Set<string> }> {
  const terrain = flatTerrain(layers);
  const physics = new PhysicsSubsystem({ backend: "rapier" });
  physics.setGravity([0, -9.81, 0]);
  physics.setTransformSink(() => {});
  physics.setEntities([...worldTerrainColliderEntities({ id: "world", name: "World", collision: true }, terrain), {
    id: "car",
    components: {
      Transform: { position: [0, 1, -20], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1.8, 0.6, 4.2], isStatic: false, isSensor: false, simulatePhysics: true },
    },
  }]);
  try {
    await physics.init();
    const mesh = createPhysicalMaterialSurfaceProvider((id) => physics.colliderPhysicalMaterialId(id));
    const source = worldTerrainSurfaceSource(terrain);
    const sampler = source ? new TerrainSurfaceSampler(source) : null;
    physics.setVehicleSurfaceProvider(provider === "mesh" ? mesh
      : createTerrainSurfaceProvider((id) => landscapeColliderActorId(id) === "world" ? sampler : undefined, mesh));
    assert.equal(physics.createVehicle("car", createReferenceCarDefinition()), true);
    const dt = 1 / 60;
    let frame = 0;
    const tick = (seconds: number): void => {
      for (let step = 0; step < Math.round(seconds / dt); step += 1) {
        frame += 1;
        physics.update({ deltaSeconds: dt, elapsedSeconds: frame * dt, frame });
      }
    };
    tick(1);
    physics.setVehicleInput("car", { ...NEUTRAL_VEHICLE_INPUT, throttle: 1 });
    const speeds: number[] = [];
    const ground = new Set<string>();
    for (let index = 0; index < 6; index += 1) {
      tick(0.5);
      const state = physics.vehicleState("car")!;
      speeds.push(state.forwardSpeed);
      for (const wheel of state.wheels) if (wheel.groundEntityId) ground.add(wheel.groundEntityId);
    }
    return { speeds, ground };
  } finally {
    physics.dispose();
  }
}

export async function registerTerrainSurfaceRapierTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("terrain surface rapier: a terrain without physical materials drives exactly like the collider provider", async () => {
    const mesh = await driveOnTerrain(LAYERS(null, null), "mesh");
    const terrain = await driveOnTerrain(LAYERS(null, null), "terrain");
    assert.deepEqual(terrain.speeds, mesh.speeds);
    assert.deepEqual([...terrain.ground], ["landscape:world:0_0"]);
  });

  await checkAsync("terrain surface rapier: a mud paint layer slows the car on a World Terrain heightfield", async () => {
    const neutral = await driveOnTerrain(LAYERS(null, null), "terrain");
    const mud = await driveOnTerrain(LAYERS("mud", null), "terrain");
    assert.ok(mud.speeds[1]! > 0 && mud.speeds[1]! < neutral.speeds[1]! * 0.8, `1 s: mud=${mud.speeds[1]}, neutral=${neutral.speeds[1]}`);
    assert.ok(mud.speeds[5]! < neutral.speeds[5]! * 0.8, `3 s: mud=${mud.speeds[5]}, neutral=${neutral.speeds[5]}`);
    // The collider-material path cannot see paint layers: the same terrain stays neutral there.
    assert.deepEqual((await driveOnTerrain(LAYERS("mud", null), "mesh")).speeds, neutral.speeds);
  });
}
