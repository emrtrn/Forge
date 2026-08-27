/**
 * Phase H: the RuntimeParity level is the plan's evidence, so it is pinned.
 *
 * `public/layouts/RuntimeParity.level.json` exists to prove one claim: a level
 * containing the general scene features — terrain, static meshes, a material
 * override, lights + shadows, the whole environment/render stack, an effect
 * emitter, a placed Actor Script with collision, an animated object — is built
 * entirely by the shared LevelRuntime pipeline, so opening it needs no scene
 * setup code from a game (I1/I4). A fixture that quietly loses half its content
 * would still "pass" a smoke that only checks the page renders, hence these
 * checks:
 *
 *   (A) it survives serialization: validate → validate is a fixed point, with
 *       nothing dropped, so a Save Layout over this level cannot gut it.
 *   (B) it instantiates what it authors: the derived scene document and the
 *       resolved actor class carry the expected entities and components.
 *   (C) every feature it authors is served by a *shared* level-content build
 *       step — the parity claim itself, checked against the build manifest.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BEHAVIOR_COMPONENT,
  COLLIDER_COMPONENT,
  LIGHT_COMPONENT,
  MESH_RENDERER_COMPONENT,
  PARTICLE_EMITTER_COMPONENT,
  TRANSFORM_COMPONENT,
} from "../../engine/scene/components";
import type { RoomLayout } from "../../engine/scene/layout";
import { roomLayoutToSceneDocument } from "../../engine/scene/legacyRoomLayoutAdapter";
import { actorInstanceToEntity } from "../../engine/scene/actorInstance";
import { normalizeActorScriptDef } from "../../engine/scene/actorScript";
import { buildStepIds } from "../../src/scene/buildManifest";
import { collectDroppedFields } from "../../tools/droppedFields";
import { validateLandscapeData, validateLayout } from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;

export const RUNTIME_PARITY_LEVEL_PATH = "public/layouts/RuntimeParity.level.json";
const RUNTIME_PARITY_LANDSCAPE_PATH = "public/landscapes/runtime-parity.landscape.json";
const PARITY_PROP_ACTOR_PATH = "public/assets/starter-content/Gameplay/Script_ParityProp.actor.json";
const GAME_STARTER_LEVEL_PATH = "templates/game-starter/main.level.json";
const GAME_STARTER_MAIN_PATH = "templates/game-starter/main.ts";

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function parityLayout(): RoomLayout {
  return readJson(RUNTIME_PARITY_LEVEL_PATH) as unknown as RoomLayout;
}

function placements(layout: RoomLayout, assetId: string) {
  return layout.instances.find((group) => group.assetId === assetId)?.placements ?? [];
}

/**
 * What the level must keep authoring, and which shared build step renders it.
 * The step ids come from `src/scene/buildManifest.ts`, so a feature that ever
 * becomes shell-only breaks check (C) instead of quietly diverging in Play.
 */
const PARITY_FEATURES: readonly {
  readonly label: string;
  readonly step: string;
  readonly authored: (layout: RoomLayout) => boolean;
}[] = [
  { label: "landscape terrain", step: "landscapes", authored: (l) => (l.landscapes?.length ?? 0) > 0 },
  {
    label: "two static meshes",
    step: "scene-entities",
    authored: (l) =>
      l.instances.filter((group) => group.placements.length > 0 && !group.assetId.startsWith("marker:"))
        .length >= 2,
  },
  {
    label: "two materials, one of them a per-placement override",
    step: "material-slots",
    authored: (l) => {
      const slots = l.instances
        .flatMap((group) => group.placements)
        .map((placement) => (placement as { materialSlot?: string }).materialSlot)
        .filter((slot): slot is string => typeof slot === "string");
      return new Set(slots).size >= 2;
    },
  },
  {
    label: "directional light with shadows",
    step: "sun-shadow",
    authored: (l) => (l.lights ?? []).some((light) => light.type === "directional" && light.castShadow === true),
  },
  { label: "sky atmosphere", step: "sky", authored: (l) => l.skyAtmosphere !== undefined },
  {
    label: "sky light capture (environment reflections)",
    step: "reflection-environment",
    authored: (l) => l.skyAtmosphere?.skyLightCapture !== undefined,
  },
  { label: "height fog", step: "fog", authored: (l) => l.heightFog !== undefined },
  { label: "cloud layer", step: "clouds", authored: (l) => l.cloudLayer !== undefined },
  { label: "post process", step: "post-process", authored: (l) => l.postProcess !== undefined },
  {
    label: "background + ambient world settings",
    step: "background-ambient",
    authored: (l) => l.worldSettings?.backgroundColor !== undefined,
  },
  {
    label: "particle effect emitter",
    step: "scene-entities",
    authored: (l) =>
      l.instances
        .flatMap((group) => group.placements)
        .some((placement) => (placement as { particle?: unknown }).particle !== undefined),
  },
  {
    label: "animated (behavior-driven) object",
    step: "scene-entities",
    authored: (l) =>
      l.instances
        .flatMap((group) => group.placements)
        .some((placement) => (placement as { behavior?: unknown }).behavior !== undefined),
  },
  {
    label: "placed Actor Script instance",
    step: "actor-instances",
    authored: (l) => (l.actors?.length ?? 0) > 0,
  },
  {
    label: "camera/player start marker",
    step: "scene-entities",
    authored: (l) => placements(l, "marker:playerStart").length > 0,
  },
];

export function registerRuntimeParityLevelTests(check: Check): void {
  // (A) serialization round-trip.
  check("parity level: a save round-trips it without dropping or changing a field", () => {
    const authored = parityLayout();
    const saved = validateLayout(authored);
    assert.deepEqual(
      collectDroppedFields(authored, saved, "layout", 100).paths,
      [],
      "the parity level authors fields the save validator does not keep",
    );
    // Fixed point: saving the saved level again changes nothing, so repeated
    // editor saves cannot erode the fixture.
    assert.deepEqual(validateLayout(saved), saved);
  });

  check("parity level: its landscape sidecar round-trips too", () => {
    const authored = readJson(RUNTIME_PARITY_LANDSCAPE_PATH);
    const saved = validateLandscapeData(authored);
    assert.deepEqual(collectDroppedFields(authored, saved, "landscape", 100).paths, []);
    assert.deepEqual(validateLandscapeData(saved), saved);
    const size = saved.size as { verticesX: number; verticesZ: number };
    assert.equal((saved.heights as number[]).length, size.verticesX * size.verticesZ);
  });

  // (B) instantiation counts.
  check("parity level: the derived scene document instantiates what it authors", () => {
    const layout = parityLayout();
    const entities = roomLayoutToSceneDocument(layout).entities;
    const withComponent = (component: string) =>
      entities.filter((entity) => entity.components[component] !== undefined);

    // One entity per placement, plus one per light.
    const placementCount = layout.instances.reduce((total, group) => total + group.placements.length, 0);
    assert.equal(entities.length, placementCount + (layout.lights?.length ?? 0));
    assert.equal(withComponent(TRANSFORM_COMPONENT).length, entities.length);
    assert.equal(withComponent(LIGHT_COMPONENT).length, 2);
    assert.equal(withComponent(MESH_RENDERER_COMPONENT).length, placementCount);
    // Collidable statics: the floor, both pillars and the animated cube. The
    // Player Start marker and the effect emitter are explicitly collision-free.
    assert.equal(withComponent(COLLIDER_COMPONENT).length, 4);
    assert.equal(withComponent(PARTICLE_EMITTER_COMPONENT).length, 1);
    assert.equal(withComponent(BEHAVIOR_COMPONENT).length, 1);
  });

  check("parity level: its Actor Script class resolves to a collidable actor entity", () => {
    const layout = parityLayout();
    const instance = layout.actors?.[0];
    assert.ok(instance, "the parity level authors an actor instance");
    assert.equal(instance.classRef, "assets/starter-content/Gameplay/Script_ParityProp.actor.json");

    const def = normalizeActorScriptDef(readJson(PARITY_PROP_ACTOR_PATH));
    const entity = actorInstanceToEntity(def, instance, 0);
    assert.ok(entity.components[TRANSFORM_COMPONENT], "actor carries a transform");
    assert.ok(entity.components[MESH_RENDERER_COMPONENT], "actor carries a rendered mesh");
    assert.ok(entity.components[COLLIDER_COMPONENT], "actor carries collision");
  });

  // (C) parity: everything here is built by the shared pipeline.
  check("parity level: every feature it authors is a shared editor+runtime build step", () => {
    const layout = parityLayout();
    const editorSteps = buildStepIds("editor", "level-content");
    const runtimeSteps = buildStepIds("runtime", "level-content");
    for (const feature of PARITY_FEATURES) {
      assert.ok(feature.authored(layout), `parity level no longer authors: ${feature.label}`);
      assert.ok(
        editorSteps.includes(feature.step),
        `${feature.label} is not built by the editor pipeline (${feature.step})`,
      );
      assert.ok(
        runtimeSteps.includes(feature.step),
        `${feature.label} is not built by the runtime pipeline (${feature.step})`,
      );
    }
  });

  check("game-starter: its level is the parity fixture, only renamed", () => {
    const starter = readJson(GAME_STARTER_LEVEL_PATH);
    const parity = readJson(RUNTIME_PARITY_LEVEL_PATH);
    assert.equal(starter.name, "main");
    // Everything else must match: the starter's whole claim is that it opens the
    // parity content with no code of its own, so a starter level that quietly
    // diverged would make the Definition of Done untestable.
    assert.deepEqual({ ...starter, name: parity.name }, parity);
  });

  check("game-starter: its app contains no scene-setup code at all", () => {
    const source = readFileSync(GAME_STARTER_MAIN_PATH, "utf8");
    const imports = [...source.matchAll(/^import [^;]*?from "([^"]+)"/gm)].map(
      (match) => match[1],
    );
    // Composition + the `?debug` overlay, and nothing else: no three.js, no
    // engine module, no scene builder. The level renders because it was
    // authored, not because the starter wires it (I1/I4).
    assert.deepEqual(imports.sort(), [
      "@/scene/ForgeRuntime",
      "@/scene/capabilities/defaultRuntimeModules",
      "@/scene/debugStats",
    ]);
    assert.match(source, /createForgeRuntime\(/);
    assert.match(source, /forge\.start\(\)/);
  });

  check("parity level: it needs no gameplay — no game mode, no characters", () => {
    const layout = parityLayout();
    // The DoD is that a *zero-gameplay* starter opens this level and sees the
    // scene. Authoring a Game Mode here would hide a missing-content bug behind
    // the template's own gameplay.
    assert.equal(layout.worldSettings?.gameMode, undefined);
    assert.deepEqual(layout.characters, []);
  });
}
