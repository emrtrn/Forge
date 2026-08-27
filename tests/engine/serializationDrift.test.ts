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
import { validateAssetSkeletonDef, validateEffectAsset } from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;

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
