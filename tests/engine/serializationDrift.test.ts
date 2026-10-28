/**
 * Phase G: the runtime shape and the save shape must not drift apart (I5).
 *
 * Forge has three documented allowlist surfaces (CLAUDE.md): the layout, the
 * `*.skeleton.json` sidecar and the `*.effect.json` asset. Each has a *runtime*
 * normalizer that decides what a field means, and a *save* validator that
 * decides what survives a write. When someone adds a field to the first and
 * forgets the second, the field works in Play and disappears on the next save —
 * quietly, which is the whole failure this phase removes.
 *
 * These checks close that loop mechanically: take what the runtime normalizer
 * produces, push it through the save validator, and assert the drop detector
 * finds nothing. A new field added to only one side fails here, naming the exact
 * path — without loosening the validator, which stays free to *reject* malformed
 * input more strictly than the normalizer coerces it.
 */
import assert from "node:assert/strict";

import { normalizeEffectDefinition } from "../../engine/vfx/particleEffectParser";
import { normalizeAssetSkeleton } from "../../src/scene/assetSkeletonLoader";
import { collectDroppedFields, formatDroppedFieldWarning } from "../../tools/droppedFields";
import { validateAssetSkeletonDef, validateEffectAsset, validatePlacement, validateAssetCollisionDef, validateLayout } from "../../tools/saveValidator";
import { PHYSICAL_MATERIAL_IDS } from "../../engine/scene/collision";
import { normalizeAssetCollisionDef } from "../../src/scene/assetCollisionLoader";
import type { RoomLayout } from "../../engine/scene/layout";
import { normalizeWorldWidget } from "../../engine/ui/uiWorldWidget";
import {
  DEFAULT_WORLD_PARTITION,
  mergeWorldCells,
  normalizeWorldPartitionSettings,
  partitionLayout,
} from "../../engine/world/worldPartition";
import {
  cloneActorInstance,
  cloneBlockingVolume,
  cloneCharacter,
  cloneLightActor,
  clonePlacement,
  cloneSphereReflectionCapture,
  cloneTargetPoint,
  cloneWorldWidget,
} from "../../editor/core/layoutSnapshots";

type Check = (label: string, fn: () => void) => void;

/** Every element routed by partitionLayout must survive both Save and editor snapshots. */
function partitionFixture(spatiallyLoaded?: boolean): RoomLayout {
  const flags = spatiallyLoaded === undefined ? {} : { spatiallyLoaded };
  return {
    schema: 1, name: "Partition persistence", loadGroups: [],
    worldCells: ["-2_-1", "0_0", "2_0", "10_0"],
    worldSettings: { partition: normalizeWorldPartitionSettings({ enabled: true }) },
    instances: [{ assetId: "mesh:rock", placements: [{ id: "plc-rock", role: "nature.rock", position: [0, 0, 0], color: "#f2a65a", ...flags }] }],
    actors: [{ classRef: "actors/test.actor.json", position: [0, 0, 0], ...flags }],
    characters: [{ assetId: "character:test", position: [0, 0, 0], ...flags }],
    lights: [{ id: "light", type: "point", position: [0, 0, 0], ...flags }],
    reflectionCaptures: [{ id: "capture", position: [0, 0, 0], ...flags }],
    targetPoints: [{ id: "target", position: [0, 0, 0], ...flags }],
    blockingVolumes: [{ id: "volume", position: [0, 0, 0], ...flags }],
    worldWidgets: [{ widget: "ui:label", anchor: { worldPos: [0, 0, 0] }, ...flags }],
  };
}

function partitionElements(layout: RoomLayout): Array<{ spatiallyLoaded?: boolean }> {
  return [
    layout.instances[0]!.placements[0]!, layout.actors![0]!, layout.characters[0]!,
    layout.lights![0]!, layout.reflectionCaptures![0]!, layout.targetPoints![0]!,
    layout.blockingVolumes![0]!, layout.worldWidgets![0]!,
  ];
}

/**
 * An authored skeleton sidecar that exercises every field of `AssetSkeletonDef`.
 * Deliberately maximal: a field missing here is a field this drift guard cannot
 * protect, so extend it whenever the def grows.
 */
const MAXIMAL_SKELETON = {
  schema: 1,
  upperBodyBone: "spine_02",
  animationSet: { idle: "Idle", walk: "Walk", run: "Run", jump: "Jump", fall: "Fall" },
  sockets: [
    {
      name: "hand_r_weapon",
      bone: "hand_r",
      position: [0.1, 0, 0],
      rotation: [0, 90, 0],
      scale: [1, 1, 1],
      previewAssetId: "SM_Sword",
    },
  ],
  blendSpaces: [
    {
      name: "Locomotion",
      type: "2d",
      axisX: { name: "Speed", min: 0, max: 6 },
      axisY: { name: "Direction", min: -180, max: 180 },
      samples: [
        { clip: "Idle", x: 0, y: 0 },
        { clip: "Run", x: 6, y: 0 },
      ],
    },
  ],
  notifies: [{ name: "footstep", clip: "Walk", time: 0.25 }],
  montages: [
    {
      name: "Attack",
      clip: "Punch",
      slot: "upperBody",
      loop: false,
      blendInSeconds: 0.1,
      blendOutSeconds: 0.2,
    },
  ],
  rootMotion: [{ clip: "Roll", mode: "lockXZ", rootNode: "root" }],
  physicsBodies: [
    {
      name: "pelvis",
      bone: "hips",
      shape: "capsule",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      size: [0.2, 0.5, 0.2],
    },
    {
      name: "spine",
      bone: "spine_01",
      shape: "box",
      position: [0, 0.3, 0],
      rotation: [0, 0, 0],
      size: [0.3, 0.4, 0.2],
    },
  ],
  physicsConstraints: [
    { name: "pelvis_spine", bodyA: "pelvis", bodyB: "spine", swingDeg: 30, twistDeg: 15 },
  ],
  preview: { selectedClip: "Idle" },
};

/** A schema-2 particle effect touching every normalized block. */
const MAXIMAL_EFFECT = {
  schema: 2,
  type: "particleEffect",
  name: "FX_Drift",
  system: { enabled: true, loop: true, duration: 3, maxParticles: 64 },
  spawn: {
    mode: "rate",
    rate: 12,
    count: 4,
    delay: 0.2,
    interval: 0.5,
    shape: "sphere",
    radius: 1.5,
  },
  particle: {
    lifetimeMin: 0.5,
    lifetimeMax: 1.5,
    sizeMin: 0.2,
    sizeMax: 0.8,
    speedMin: 1,
    speedMax: 3,
  },
};

function assertNoDrift(runtimeShape: unknown, savedShape: unknown, subject: string): void {
  const report = collectDroppedFields(runtimeShape, savedShape, subject, 100);
  assert.equal(
    formatDroppedFieldWarning(report, subject),
    null,
    `${subject}: the save validator drops fields the runtime normalizer produces — ${report.paths.join(", ")}`,
  );
}

export function registerSerializationDriftTests(check: Check): void {
  check("world partition persistence: every routed element and settings survive the save allowlist", () => {
    const layout = partitionFixture(false);
    const saved = validateLayout(layout) as RoomLayout;
    assertNoDrift(layout, saved, "layout");
    assert.deepEqual(saved, layout);
    assert.deepEqual(validateLayout(saved), saved);
  });

  check("world partition persistence: true and absent spatiallyLoaded stay omitted for every kind", () => {
    for (const flag of [undefined, true]) {
      const saved = validateLayout(partitionFixture(flag)) as RoomLayout;
      for (const element of partitionElements(saved)) {
        assert.equal("spatiallyLoaded" in element, false);
      }
    }
  });

  check("world partition persistence: every kind rejects non-boolean spatiallyLoaded", () => {
    const count = partitionElements(partitionFixture()).length;
    for (let index = 0; index < count; index += 1) {
      for (const value of ["false", 0, null, {}, []]) {
        const layout = partitionFixture();
        Object.assign(partitionElements(layout)[index]!, { spatiallyLoaded: value });
        assert.throws(() => validateLayout(layout), /spatiallyLoaded must be boolean/);
      }
    }
  });

  check("world partition persistence: partial partition settings normalize only when authored", () => {
    const layout = partitionFixture();
    for (const partition of [{}, { enabled: true }, { grids: { main: { cellSize: 64 } } }]) {
      const saved = validateLayout({ ...layout, worldSettings: { partition } }) as RoomLayout;
      assert.deepEqual(saved.worldSettings?.partition, normalizeWorldPartitionSettings(partition));
      assertNoDrift({ worldSettings: { partition } }, saved, "layout");
    }
    const saved = validateLayout({ ...layout, worldSettings: { ambientIntensity: 1 } }) as RoomLayout;
    assert.equal("partition" in saved.worldSettings!, false);
    const withoutSettings = validateLayout({ ...layout, worldSettings: undefined }) as RoomLayout;
    assert.equal("worldSettings" in withoutSettings, false);
    const defaults = validateLayout({ ...layout, worldSettings: { partition: {} } }) as RoomLayout;
    assert.deepEqual(defaults.worldSettings?.partition, DEFAULT_WORLD_PARTITION);
    defaults.worldSettings!.partition!.grids.main.cellSize = 1;
    assert.equal(DEFAULT_WORLD_PARTITION.grids.main.cellSize, 128);
  });

  check("serialization drift: worldSettings.viewDistance round-trips", () => {
    const layout = { ...partitionFixture(), worldSettings: { viewDistance: 3000 } };
    const saved = validateLayout(layout) as RoomLayout;
    assert.deepEqual(saved.worldSettings, { viewDistance: 3000 });
    assertNoDrift(layout, saved, "layout");

    const absent = { ...partitionFixture(), worldSettings: { ambientIntensity: 1 } };
    const savedAbsent = validateLayout(absent) as RoomLayout;
    assert.equal("viewDistance" in savedAbsent.worldSettings!, false);
    assertNoDrift(absent, savedAbsent, "layout");

    for (const viewDistance of [49, 20001, "far", NaN]) {
      assert.throws(
        () => validateLayout({ ...layout, worldSettings: { viewDistance } }),
        /invalid worldSettings\.viewDistance/,
      );
    }
  });

  check("serialization drift: a sun's Cascaded Shadows flag round-trips save and editor clone", () => {
    for (const cascadedShadows of [true, false]) {
      const sun = { id: "sun", type: "directional", position: [0, 10, 0], castShadow: true, cascadedShadows } as const;
      const layout = { ...partitionFixture(), lights: [sun] };
      const saved = validateLayout(layout) as RoomLayout;
      assert.equal(saved.lights![0]!.cascadedShadows, cascadedShadows);
      assertNoDrift(layout, saved, "layout");
      assert.equal(cloneLightActor(saved.lights![0]!).cascadedShadows, cascadedShadows);
    }
    const absent = validateLayout({ ...partitionFixture(), lights: [{ id: "sun", type: "directional", position: [0, 10, 0] }] }) as RoomLayout;
    assert.equal("cascadedShadows" in absent.lights![0]!, false);
    assert.throws(
      () => validateLayout({ ...partitionFixture(), lights: [{ id: "sun", type: "directional", position: [0, 10, 0], cascadedShadows: "yes" }] }),
      /light\.cascadedShadows must be boolean/,
    );
  });

  check("serialization drift: a Height Fog fitted to a long view distance keeps its density", () => {
    // Faz 7d: 1.98 / 10 km ≈ 0.000198 must not round to 0 (3 decimals) on save.
    const layout = { ...partitionFixture(), heightFog: { mode: "exp", density: 0.000198 } };
    const saved = validateLayout(layout) as RoomLayout;
    assert.deepEqual(saved.heightFog, { mode: "exp", density: 0.000198 });
    assert.equal((validateLayout({ ...layout, heightFog: { density: 0.0001234567 } }) as RoomLayout).heightFog?.density, 0.000123);
    assertNoDrift(layout, saved, "layout");
  });

  check("world partition persistence: invalid partition settings name the field and normalizer reason", () => {
    const layout = partitionFixture();
    for (const cellSize of [0, -1, NaN, Infinity, "128", null]) {
      assert.throws(
        () => validateLayout({ ...layout, worldSettings: { partition: { grids: { main: { cellSize } } } } }),
        /worldSettings\.partition: grids\.main\.cellSize must be finite and positive/,
      );
    }
    assert.throws(
      () => validateLayout({ ...layout, worldSettings: { partition: null } }),
      /worldSettings\.partition: worldPartition must be an object/,
    );
    assert.throws(
      () => validateLayout({ ...layout, worldSettings: { partition: { enabled: "true" } } }),
      /worldSettings\.partition: enabled must be a boolean/,
    );
  });

  check("world partition persistence: explicit element clones preserve authored spatiallyLoaded", () => {
    for (const flag of [undefined, true, false]) {
      const layout = partitionFixture(flag);
      const originals = partitionElements(layout);
      const clones = [
        clonePlacement(layout.instances[0]!.placements[0]!),
        cloneActorInstance(layout.actors![0]!),
        cloneCharacter(layout.characters[0]!),
        cloneLightActor(layout.lights![0]!),
        cloneSphereReflectionCapture(layout.reflectionCaptures![0]!),
        cloneTargetPoint(layout.targetPoints![0]!),
        cloneBlockingVolume(layout.blockingVolumes![0]!),
        cloneWorldWidget(layout.worldWidgets![0]!),
      ];
      clones.forEach((clone, index) => {
        assertNoDrift(originals[index], clone, `element[${index}]`);
        assert.deepEqual(clone, originals[index]);
        assert.notEqual(clone, originals[index]);
      });
    }
  });

  check("world partition persistence: split and merge preserve independent partition settings", () => {
    const layout = partitionFixture();
    const settings = layout.worldSettings!.partition!;
    const { persistent, cells } = partitionLayout(layout, settings);
    const merged = mergeWorldCells(persistent, cells.values());
    assert.deepEqual(persistent.worldSettings?.partition, settings);
    assert.deepEqual(merged.worldSettings?.partition, settings);
    persistent.worldSettings!.partition!.grids.main.cellSize = 1;
    merged.worldSettings!.partition!.grids.main.loadRange = 1;
    assert.deepEqual(settings, normalizeWorldPartitionSettings({ enabled: true }));
    assert.equal(merged.worldSettings!.partition!.grids.main.cellSize, 128);
    assert.equal(persistent.worldSettings!.partition!.grids.main.loadRange, 384);
  });

  check("world partition persistence: normalized world widgets retain the persistent flag on save", () => {
    const widget = normalizeWorldWidget(partitionFixture(false).worldWidgets![0]);
    assert.equal(widget?.spatiallyLoaded, false);
    const layout = { ...partitionFixture(false), worldWidgets: [widget] };
    assertNoDrift(layout, validateLayout(layout), "layout");
  });

  check("surface response: physical material preset ids round-trip placement and collision sidecar saves", () => {
    for (const physicalMaterialId of PHYSICAL_MATERIAL_IDS) {
      const placement = { position: [0, 0, 0], physicalMaterialId };
      const saved = validatePlacement(placement);
      assertNoDrift(placement, saved, "placement");
      assert.equal(saved.physicalMaterialId, physicalMaterialId);
      const runtime = normalizeAssetCollisionDef({
        primitives: [], complexity: "projectDefault", preset: "blockAll", physicalMaterialId,
      });
      const sidecar = validateAssetCollisionDef(runtime);
      assertNoDrift(runtime, sidecar, "collision");
      assert.deepEqual(normalizeAssetCollisionDef(sidecar), runtime);
    }
  });

  check("skeleton sidecar: everything the runtime normalizer keeps survives a save", () => {
    const runtimeShape = normalizeAssetSkeleton(MAXIMAL_SKELETON);
    assertNoDrift(runtimeShape, validateAssetSkeletonDef(runtimeShape), "skeleton");
  });

  check("skeleton sidecar: an authored def round-trips runtime -> save -> runtime", () => {
    // Save output must itself be loadable, or the next Play boot silently loses
    // what the editor just wrote.
    const saved = validateAssetSkeletonDef(normalizeAssetSkeleton(MAXIMAL_SKELETON));
    assert.deepEqual(normalizeAssetSkeleton(saved), normalizeAssetSkeleton(MAXIMAL_SKELETON));
  });

  check("particle effect: everything the runtime normalizer keeps survives a save", () => {
    // The normalizer returns the effect *body*; the file (and the validator's
    // output) carries the schema/type header around it.
    const runtimeShape = {
      schema: 2,
      type: "particleEffect",
      ...normalizeEffectDefinition(MAXIMAL_EFFECT),
    };
    assertNoDrift(runtimeShape, validateEffectAsset(MAXIMAL_EFFECT), "effect");
  });

  check("particle effect: a saved asset re-normalizes to the same runtime shape", () => {
    const saved = validateEffectAsset(MAXIMAL_EFFECT);
    assert.deepEqual(normalizeEffectDefinition(saved), normalizeEffectDefinition(MAXIMAL_EFFECT));
  });

  check("the drift guard actually fails when a field is added to only one side", () => {
    const runtimeShape = {
      ...(normalizeAssetSkeleton(MAXIMAL_SKELETON) as Record<string, unknown>),
      newRuntimeOnlyField: "authored in Play, unknown to the save validator",
    };
    const report = collectDroppedFields(
      runtimeShape,
      validateAssetSkeletonDef(runtimeShape),
      "skeleton",
    );
    assert.deepEqual(report.paths, ["skeleton.newRuntimeOnlyField"]);
  });
}
