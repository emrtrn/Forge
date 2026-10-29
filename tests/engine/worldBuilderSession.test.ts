/**
 * World Builder F1, steps 5b and 6b: the editor session around the Stage
 * Runner — loading the open level's recipe and profile, dry run vs apply, one
 * undo step for level + terrain splines + recipe, and the recipe's place in the
 * Save Layout turn (first, before terrains and the level). Step 15b: hand
 * corrections to the plan, each one undo step that makes the element manual.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { EditorHistory } from "../../editor/core/history";
import type { LayoutLandscape, RoomLayout } from "../../engine/scene/layout";
import type { TerrainPad } from "../../engine/terrain/terrainPads";
import type { TerrainSpline } from "../../engine/terrain/terrainTypes";
import { PAD_FALLOFF } from "../../engine/worldbuilder/buildings";
import { createEmptyMeshPaintData } from "../../engine/scene/meshPaint";
import { createWorldRecipe } from "../../engine/worldbuilder/recipe";
import { applyPlacementGroupChanges } from "../../engine/worldbuilder/stage";
import { EditorSaveSession, type EditorSaveSource } from "../../src/editor/editorSaveCoordinator";
import type { WorldTerrainEditSession } from "../../src/editor/terrainStore";
import { WorldBuilderSession, type WorldBuilderHost } from "../../src/editor/worldBuilderSession";
import type { PreviewItem, StagePreview } from "../../src/editor/worldBuilderPreview";

type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

const LEVEL = "layouts/wb-test.level.json";
const RECIPE_URL = "/layouts/wb-test.worldrecipe.json";
const PROFILE = "regions/neutral.regionprofile.json";

interface Response { ok: boolean; status: number; json(): Promise<unknown> }

function respond(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) };
}

function planRecipe(): ReturnType<typeof createWorldRecipe> {
  const recipe = createWorldRecipe("wb_test", 1);
  recipe.regionProfile = PROFILE;
  recipe.plan.settlements.push({ id: "village", source: "reference", center: [10, 20], type: "village" });
  recipe.plan.landmarks.push({ id: "depot", source: "manual", kind: "logistics.depot", position: [0, -30] });
  return recipe;
}

function roadRecipe(): ReturnType<typeof createWorldRecipe> {
  const recipe = createWorldRecipe("wb_test", 1);
  recipe.plan.roadGraph.nodes.push(
    { id: "a", source: "manual", position: [0, 0], kind: "end" },
    { id: "b", source: "manual", position: [30, 0], kind: "end" },
  );
  recipe.plan.roadGraph.edges.push({ id: "main", source: "manual", from: "a", to: "b", roadClass: "local" });
  return recipe;
}

function harness(files: Record<string, unknown> = {}) {
  const history = new EditorHistory();
  const layout: RoomLayout = {
    schema: 1, name: "wb", loadGroups: [], characters: [],
    instances: [{ assetId: "mesh:rock", placements: [{ position: [1, 0, 1] }] }],
  };
  const rebuilt: string[] = [];
  const terrain = { id: "terrain-1", min: [-100, -100] as [number, number], max: [100, 100] as [number, number],
    layers: [], splines: [] as TerrainSpline[], locked: false };
  const statuses: string[] = [];
  const posts: Array<{ url: string; body: unknown }> = [];
  const baked: TerrainPad[][] = [];
  /** Every preview the host was asked to draw (null = cleared), and every focus request. */
  const shown: Array<StagePreview | null> = [];
  const focused: Array<PreviewItem | null> = [];
  /** Every recipe the layer was asked to draw (null = cleared). */
  const layers: Array<{ sites: number; reference: boolean; plan: boolean } | null> = [];
  let postStatus = 200;
  const host: WorldBuilderHost = {
    scenePath: () => LEVEL,
    layout: () => layout,
    sampleHeight: () => 1,
    viewTarget: () => [5, 5],
    executeCommand: (command) => void history.execute(command),
    applyGroupChanges: (changes, side) => rebuilt.push(...applyPlacementGroupChanges(layout, changes, side)),
    terrains: () => [{ ...terrain, splines: structuredClone(terrain.splines) }],
    applySplineChanges: (changes, side) => {
      for (const change of changes) if (change.landscapeId === terrain.id) terrain.splines = structuredClone(change[side]);
    },
    applyPads: async (pads) => void baked.push([...pads]),
    showRecipeLayer: (recipe, options) => {
      layers.push(recipe ? { sites: recipe.generated.sites.length, reference: recipe.reference !== undefined, plan: options.plan } : null);
      return {
        underlay: recipe?.reference?.image ? (options.underlay ? "loading" : "hidden") : "none",
        plan: options.plan && recipe ? recipe.plan.settlements.length + recipe.plan.landmarks.length : 0,
        lowConfidence: 0,
        cores: options.generated ? recipe?.generated.sites.filter((site) => site.core).length ?? 0 : 0,
        parcels: 0,
        pads: 0,
      };
    },
    showPreview: (preview) => {
      shown.push(preview);
      return preview?.items.filter((item) => item.placement || item.path?.length).length ?? 0;
    },
    focusPreview: (_preview, item) => void focused.push(item),
    onStatus: (message) => statuses.push(message),
  };
  const session = new WorldBuilderSession(
    host,
    async (url) => (url in files ? respond(200, files[url]) : respond(404, null)),
    async (url, body) => {
      posts.push({ url, body: JSON.parse(body) });
      return postStatus === 200 ? respond(200, { ok: true }) : respond(postStatus, { ok: false, error: "nope" });
    },
  );
  return { session, history, layout, terrain, rebuilt, statuses, posts, baked, shown, focused, layers, setPostStatus: (status: number) => { postStatus = status; } };
}

export async function registerWorldBuilderSessionTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("world builder session: before its level has loaded nothing runs and no recipe can be created", async () => {
    const { session, history, statuses } = harness({ [RECIPE_URL]: planRecipe() });
    assert.equal(session.getView().state, "loading");
    session.createRecipe();
    assert.equal(history.state().canUndo, false, "an unread recipe is not missing; creating one would overwrite it");
    assert.equal(session.dryRun("planBlockout"), null);
    assert.equal(session.apply("planBlockout"), false);
    assert.equal(statuses.at(-1), "The level is still loading.");
    await session.load();
    assert.equal(session.getView().state, "loaded");
    assert.equal(session.dryRun("planBlockout")!.added.length, 2);
  });

  await checkAsync("world builder session: the recipe layer follows load, apply and undo; its parts switch without touching the recipe", async () => {
    const { session, history, layers } = harness({ [RECIPE_URL]: planRecipe() });
    await session.load();
    assert.deepEqual(layers.at(-1), { sites: 0, reference: false, plan: true });
    assert.deepEqual(session.getView().layer.counts, { underlay: "none", plan: 2, lowConfidence: 0, cores: 0, parcels: 0, pads: 0 });
    session.apply("settlementSites");
    assert.equal(session.getView().layer.counts.cores, 1, "the site's grown core");
    history.undo();
    assert.equal(session.getView().layer.counts.cores, 0);
    history.redo();
    session.setLayerOptions({ generated: false, plan: false, opacity: 3 });
    assert.deepEqual(session.getView().layer.options, { underlay: true, plan: false, generated: false, opacity: 1 });
    assert.deepEqual(session.getView().layer.counts, { underlay: "none", plan: 0, lowConfidence: 0, cores: 0, parcels: 0, pads: 0 });
    assert.equal(history.state().undoLabel, "World Builder: Settlement sites", "a viewer setting is not a history step");
    let changed = 0;
    session.onChange = () => { changed += 1; };
    session.layerRedrawn({ underlay: "shown", plan: 0, lowConfidence: 0, cores: 0, parcels: 0, pads: 0 });
    assert.equal(session.getView().layer.counts.underlay, "shown");
    assert.equal(changed, 1);
  });

  await checkAsync("world builder session: setting the reference image is one undo step; a bad one is refused", async () => {
    const { session, history, statuses } = harness({ [RECIPE_URL]: planRecipe() });
    await session.load();
    assert.equal(session.setReference({ image: "refs/map.png", origin: [-100, -100], size: [200, 200] }), true);
    assert.deepEqual(session.getView().reference, { image: "refs/map.png", origin: [-100, -100], size: [200, 200] });
    assert.equal(session.getView().layer.counts.underlay, "loading");
    assert.equal(session.getView().dirty, true);
    assert.equal(history.state().undoLabel, "World Builder: set reference");
    assert.equal(session.setReference({ image: "refs/map.png", origin: [-100, -100], size: [200, 200] }), false, "unchanged");
    assert.equal(session.setReference({ image: "../outside.png", origin: [0, 0], size: [10, 10] }), false);
    assert.match(statuses.at(-1)!, /^Reference not set: reference\.image/);
    assert.equal(session.setReference({ origin: [0, 0], size: [0, 10] }), false);
    assert.match(statuses.at(-1)!, /^Reference not set: reference\.size/);
    assert.equal(session.setReference(null), true);
    assert.equal(session.getView().reference, null);
    history.undo();
    assert.deepEqual(session.getView().reference!.size, [200, 200]);
    history.undo();
    assert.equal(session.getView().reference, null);
  });

  await checkAsync("world builder session: a level without a recipe can create one as an undo step", async () => {
    const { session, history } = harness();
    await session.load();
    assert.equal(session.getView().state, "missing");
    assert.equal(session.getView().path, "layouts/wb-test.worldrecipe.json");
    assert.equal(session.dryRun("planBlockout"), null);

    session.createRecipe();
    assert.equal(session.getView().state, "loaded");
    assert.equal(session.getView().recipeId, "wb-test");
    assert.equal(session.getView().dirty, true);
    history.undo();
    assert.equal(session.getView().state, "missing");
    assert.equal(session.captureSave(), null);
  });

  await checkAsync("world builder session: loads the recipe and its region profile", async () => {
    const profile = JSON.parse(readFileSync("tests/engine/fixtures/neutral.regionprofile.json", "utf8"));
    const { session } = harness({ [RECIPE_URL]: planRecipe(), [`/${PROFILE}`]: profile });
    await session.load();
    const view = session.getView();
    assert.equal(view.state, "loaded");
    assert.equal(view.dirty, false);
    assert.deepEqual(view.profile, { path: PROFILE, state: "loaded", label: "Neutral test profile", issues: [] });
    assert.deepEqual(view.planCounts, { settlements: 1, landmarks: 1, roadNodes: 0, roadEdges: 0, owned: 0, pads: 0 });
    assert.deepEqual(view.stages, [
      { id: "planBlockout", label: "Plan blockout", version: 1, recordedVersion: null },
      { id: "roads", label: "Roads", version: 4, recordedVersion: null },
      { id: "settlementSites", label: "Settlement sites", version: 2, recordedVersion: null },
      { id: "streets", label: "Streets", version: 1, recordedVersion: null },
      { id: "parcels", label: "Parcels", version: 1, recordedVersion: null },
      { id: "landUse", label: "Land use", version: 1, recordedVersion: null },
      { id: "buildings", label: "Buildings", version: 1, recordedVersion: null },
      { id: "furniture", label: "Street furniture", version: 1, recordedVersion: null },
      { id: "fences", label: "Fences", version: 1, recordedVersion: null },
    ]);

    const broken = harness({ [RECIPE_URL]: { schemaVersion: 7 } });
    await broken.session.load();
    assert.equal(broken.session.getView().state, "invalid");
  });

  await checkAsync("world builder session: dry run changes nothing; apply is one undo step for level and recipe", async () => {
    const { session, history, layout, rebuilt } = harness({ [RECIPE_URL]: planRecipe() });
    await session.load();
    const before = structuredClone(layout);

    const dry = session.dryRun("planBlockout")!;
    assert.equal(dry.added.length, 2);
    assert.deepEqual(layout, before);
    assert.equal(session.getView().dirty, false);

    assert.equal(session.apply("planBlockout"), true);
    assert.deepEqual(rebuilt, ["shape:cube"]);
    assert.equal(layout.instances.find((group) => group.assetId === "shape:cube")!.placements.length, 2);
    assert.equal(session.getView().planCounts!.owned, 2);
    assert.equal(session.getView().stages[0]!.recordedVersion, 1);
    assert.equal(session.getView().dirty, true);
    assert.equal(history.state().undoLabel, "World Builder: Plan blockout");

    assert.equal(session.apply("planBlockout"), false, "a second apply is up to date");
    history.undo();
    assert.deepEqual(layout, before);
    assert.equal(session.getView().planCounts!.owned, 0);
    history.redo();
    assert.equal(session.getView().planCounts!.owned, 2);
  });

  await checkAsync("world builder session: a dry run is previewed without changing anything; apply and Clear Preview drop it", async () => {
    const { session, history, layout, terrain, shown, focused } = harness({ [RECIPE_URL]: planRecipe() });
    await session.load();
    const level = structuredClone(layout);
    const recipeBefore = structuredClone(session.getView().planCounts);

    session.dryRun("planBlockout");
    const preview = session.getView().preview!;
    assert.deepEqual(preview.preview.items.map((item) => [item.id, item.change, item.assetId]), [
      ["wb-blockout-settlement-village", "added", "shape:cube"],
      ["wb-blockout-landmark-depot", "added", "shape:cube"],
    ]);
    assert.equal(preview.drawn, 2);
    assert.deepEqual(preview.preview.items[0]!.placement!.position.slice(0, 1), [10]);
    assert.deepEqual(layout, level, "the preview reads the plan, it does not write the level");
    assert.deepEqual(session.getView().planCounts, recipeBefore);
    assert.equal(session.getView().dirty, false);
    assert.equal(history.state().canUndo, false, "a dry run is not a history step");

    session.focusPreview("wb-blockout-landmark-depot");
    session.focusPreview();
    session.focusPreview("not-in-the-preview");
    assert.deepEqual(focused.map((item) => item?.id ?? null), ["wb-blockout-landmark-depot", null]);

    session.clearPreview();
    assert.equal(session.getView().preview, null);
    assert.equal(shown.at(-1), null);
    assert.ok(session.getView().lastPlan, "the report outlives its preview");

    session.dryRun("planBlockout");
    assert.ok(session.getView().preview);
    assert.equal(session.apply("planBlockout"), true);
    assert.equal(session.getView().preview, null, "apply accepts the preview");
    assert.equal(shown.at(-1), null);

    // Up to date: nothing to preview. Moving a generated cube by hand keeps it (kept, drawn where it stands).
    session.dryRun("planBlockout");
    assert.equal(session.getView().preview, null);
    const cubes = layout.instances.find((group) => group.assetId === "shape:cube")!;
    cubes.placements[0]!.position = [11, 0, 20];
    session.dryRun("planBlockout");
    const kept = session.getView().preview!.preview.items;
    assert.deepEqual(kept.map((item) => [item.id, item.change, item.reason]), [["wb-blockout-settlement-village", "kept", "editedByHand"]]);
    assert.deepEqual(kept[0]!.placement!.position, [11, 0, 20]);

    // Deleted by hand: listed, nothing to draw.
    cubes.placements.splice(0, 1);
    session.dryRun("planBlockout");
    const deleted = session.getView().preview!;
    assert.deepEqual(deleted.preview.items.map((item) => [item.id, item.reason, item.placement]), [["wb-blockout-settlement-village", "deletedByHand", undefined]]);
    assert.equal(deleted.drawn, 0);
    assert.equal(terrain.splines.length, 0);
  });

  await checkAsync("world builder session: a moved plan element previews as updated (old and new), a dropped one as removed", async () => {
    const files: Record<string, unknown> = { [RECIPE_URL]: planRecipe() };
    const { session, layout, posts } = harness(files);
    await session.load();
    session.apply("planBlockout");
    await session.captureSave()!.write();
    const saved = structuredClone((posts.at(-1)!.body as { recipe: ReturnType<typeof createWorldRecipe> }).recipe);
    saved.plan.settlements[0]!.center = [14, 20];
    saved.plan.landmarks = [];
    files[RECIPE_URL] = saved;
    await session.load();
    const level = structuredClone(layout);

    session.dryRun("planBlockout");
    const items = session.getView().preview!.preview.items;
    assert.deepEqual(items.map((item) => [item.id, item.change]), [
      ["wb-blockout-settlement-village", "updated"],
      ["wb-blockout-landmark-depot", "removed"],
    ]);
    assert.equal(items[0]!.placement!.position[0], 14);
    assert.equal(items[0]!.before!.position[0], 10);
    assert.equal(items[1]!.placement!.position[2], -30, "a removed object is drawn where it stands");
    assert.equal(session.getView().preview!.drawn, 2);
    assert.deepEqual(layout, level);
  });

  await checkAsync("world builder session: a spline stage previews its splines as world line pieces", async () => {
    const { session, terrain } = harness({ [RECIPE_URL]: roadRecipe() });
    await session.load();
    session.dryRun("roads");
    const [road] = session.getView().preview!.preview.items;
    assert.equal(road!.id, "wb-road-main");
    assert.equal(road!.kind, "spline");
    assert.equal(road!.change, "added");
    assert.ok(road!.path!.length > 0);
    const xs = road!.path!.flatMap(([start, end]) => [start[0], end[0]]);
    assert.ok(Math.min(...xs) <= 0.5 && Math.max(...xs) >= 29.5, `the path spans the edge: ${xs.join(",")}`);
    assert.deepEqual(terrain.splines, [], "the preview does not write the terrain");

    session.apply("roads");
    // A hand edit on the road keeps it; the preview draws it where it is now.
    terrain.splines[0]!.points[0]!.position = [0, 5, 3];
    session.dryRun("roads");
    const [kept] = session.getView().preview!.preview.items;
    assert.equal(kept!.change, "kept");
    assert.ok(kept!.path!.some(([start, end]) => start[2] === 3 || end[2] === 3));
  });

  await checkAsync("world builder session: roads apply swaps terrain splines and the recipe as one undo step", async () => {
    const { session, history, layout, terrain } = harness({ [RECIPE_URL]: roadRecipe() });
    await session.load();
    const level = structuredClone(layout);
    assert.deepEqual(session.getView().stages.map((stage) => stage.id), ["planBlockout", "roads", "settlementSites", "streets", "parcels", "landUse", "buildings", "furniture", "fences"]);

    assert.deepEqual(session.dryRun("roads")!.added, ["wb-road-main"]);
    assert.deepEqual(terrain.splines, []);
    assert.equal(session.apply("roads"), true);
    assert.deepEqual(terrain.splines.map((spline) => spline.id), ["wb-road-main"]);
    assert.deepEqual(layout, level, "a spline-only stage leaves the level's placements alone");
    assert.equal(session.getView().planCounts!.owned, 1);
    assert.equal(history.state().undoLabel, "World Builder: Roads");
    assert.equal(session.apply("roads"), false, "a second apply is up to date");

    history.undo();
    assert.deepEqual(terrain.splines, []);
    assert.equal(session.getView().planCounts!.owned, 0);
    history.redo();
    assert.deepEqual(terrain.splines.map((spline) => spline.id), ["wb-road-main"]);
    assert.equal(session.getView().planCounts!.owned, 1);
  });

  await checkAsync("world builder session: Save Layout writes the recipe first, then terrains and the level, only when dirty", async () => {
    const { session, posts } = harness({ [RECIPE_URL]: planRecipe() });
    await session.load();
    const order: string[] = [];
    const source: EditorSaveSource = {
      scenePath: LEVEL,
      editor: { gridSize: 1, gridEnabled: true, snapRotationDeg: 15, snapRotationEnabled: true, snapScale: 0.1, snapScaleEnabled: true },
      layout: {
        schema: 1, name: "wb", loadGroups: [], instances: [], characters: [],
        landscapes: [{ id: "terrain-1", dataRef: "layouts/wb-test.landscapes/terrain-1.terrain.json" } as LayoutLandscape],
      },
      layoutSaver: async () => {
        order.push("level");
        return {};
      },
      worldTerrainIds: new Set(["terrain-1"]),
      worldTerrainSessions: new Map([["terrain-1", {
        dirty: true,
        capture: () => ({ path: "layouts/wb-test.landscapes/terrain-1.terrain.json", write: async () => { order.push("terrain"); } }),
      } as unknown as WorldTerrainEditSession]]),
      foliageData: { schema: 1, type: "foliage", groups: [] },
      meshPaintData: createEmptyMeshPaintData(),
      worldRecipe: {
        saveRevision: session.saveRevision,
        captureSave: () => {
          const step = session.captureSave();
          return step && { path: step.path, write: async () => { order.push("recipe"); await step.write(); } };
        },
      },
    };
    const saves = new EditorSaveSession(() => source, () => {});

    await saves.saveLayout();
    assert.deepEqual(order, ["terrain", "level"], "a clean recipe is not written");

    session.apply("planBlockout");
    order.length = 0;
    await saves.saveLayout();
    assert.deepEqual(order, ["recipe", "terrain", "level"]);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.url, "/__save-worldrecipe");
    assert.equal((posts[0]!.body as { level: string }).level, LEVEL);
    assert.equal(session.getView().dirty, false);

    const failing = harness({ [RECIPE_URL]: planRecipe() });
    await failing.session.load();
    failing.session.apply("planBlockout");
    failing.setPostStatus(400);
    await assert.rejects(failing.session.captureSave()!.write(), /World recipe save failed: HTTP 400 nope/);
    assert.equal(failing.session.getView().dirty, true);
  });

  await checkAsync("world builder session: reload refuses over unsaved recipe changes", async () => {
    const { session, statuses } = harness({ [RECIPE_URL]: planRecipe() });
    await session.load();
    session.apply("planBlockout");
    assert.equal(await session.reload(), false);
    assert.match(statuses.at(-1)!, /unsaved changes/);
    assert.equal(session.getView().planCounts!.owned, 2);
  });

  await checkAsync("world builder session: Apply Pads bakes only pads whose building stands in the level", async () => {
    const recipe = planRecipe();
    const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    recipe.generated.pads.push(
      { id: "wb-building-village.p1", settlement: "village", polygon: square, height: 4.5 },
      { id: "wb-building-village.p2", settlement: "village", polygon: square, height: 2 },
    );
    const { session, layout, baked, statuses } = harness({ [RECIPE_URL]: recipe });
    await session.load();
    assert.equal(session.getView().planCounts!.pads, 0);
    await session.applyPads();
    assert.deepEqual(baked, []);
    assert.match(statuses.at(-1)!, /No building pads to apply/);

    layout.instances.push({ assetId: "shape:cube", placements: [{ id: "wb-building-village.p1", role: "building.civic.hall", position: [5, 1, 5] }] });
    assert.equal(session.getView().planCounts!.pads, 1);
    await session.applyPads();
    assert.deepEqual(baked, [[{ polygon: square, height: 4.5, falloff: PAD_FALLOFF }]]);
  });

  await checkAsync("world builder session: moving a plan point is one undo step that makes the element manual", async () => {
    const recipe = planRecipe();
    Object.assign(recipe.plan.settlements[0]!, { observed: false, confidence: 0.3, boundary: [[0, 10], [20, 10], [20, 30]] });
    const { session, history } = harness({ [RECIPE_URL]: recipe });
    await session.load();
    assert.equal(session.movePlanPoint({ kind: "settlement", id: "village" }, [15, 25]), true);
    const moved = session.getView().planEdit!.plan.settlements[0]!;
    assert.deepEqual(moved.center, [15, 25]);
    assert.deepEqual(moved.boundary, [[5, 15], [25, 15], [25, 35]], "the boundary moves with the centre");
    assert.equal(moved.source, "manual");
    assert.equal("observed" in moved, false, "the reference's estimates no longer apply");
    assert.equal("confidence" in moved, false);
    assert.equal(history.state().undoLabel, "World Builder: move");
    assert.equal(session.getView().dirty, true);
    assert.equal(session.movePlanPoint({ kind: "settlement", id: "village" }, [15, 25]), false, "a no-op adds no step");
    history.undo();
    const restored = session.getView().planEdit!.plan.settlements[0]!;
    assert.deepEqual([restored.center, restored.source, restored.confidence], [[10, 20], "reference", 0.3]);
  });

  await checkAsync("world builder session: plan elements are added where the viewport looks, selected, and edited by field", async () => {
    const { session, history, statuses } = harness({ [RECIPE_URL]: roadRecipe() });
    await session.load();
    assert.equal(session.addPlanElement("node"), true);
    let edit = session.getView().planEdit!;
    assert.deepEqual(edit.selection, { kind: "node", id: "node-1" });
    assert.deepEqual(edit.plan.roadGraph.nodes.at(-1), { id: "node-1", source: "manual", position: [5, 5], kind: "end" });
    assert.equal(session.addPlanElement("edge", null, { from: "a", to: "node-1", roadClass: "track" }), true);
    assert.deepEqual(session.getView().planEdit!.plan.roadGraph.edges.at(-1), { id: "edge-1", source: "manual", from: "a", to: "node-1", roadClass: "track" });
    assert.equal(session.addPlanElement("edge", null, { from: "a", to: "a" }), false, "an edge needs two nodes");
    assert.equal(session.updatePlanElement({ kind: "node", id: "node-1" }, { position: [7, 8], nodeKind: "junction" }), true);
    edit = session.getView().planEdit!;
    assert.deepEqual(edit.plan.roadGraph.nodes.at(-1), { id: "node-1", source: "manual", position: [7, 8], kind: "junction" });
    assert.equal(session.addPlanElement("settlement", [40, 40]), true);
    assert.equal(session.updatePlanElement({ kind: "settlement", id: "settlement-1" }, { kind: "hamlet", population: 30, radius: 25 }), true);
    assert.equal(session.updatePlanElement({ kind: "settlement", id: "settlement-1" }, { radius: null }), true, "an empty optional field clears it");
    const settlement = session.getView().planEdit!.plan.settlements[0]!;
    assert.deepEqual(settlement, { id: "settlement-1", source: "manual", center: [40, 40], type: "hamlet", population: 30 });
    assert.equal(session.updatePlanElement({ kind: "settlement", id: "settlement-1" }, { population: -3 }), false);
    assert.match(statuses.at(-1)!, /^Plan edit refused: plan\.settlements\[0\]\.population/);
    // Undo walks back one correction at a time; the selection goes with the element.
    for (let step = 0; step < 6; step += 1) history.undo();
    assert.equal(session.getView().planEdit!.plan.roadGraph.nodes.length, 2);
    assert.equal(session.getView().planEdit!.selection, null);
  });

  await checkAsync("world builder session: deleting a plan element drops what names it, as one undo step", async () => {
    const recipe = roadRecipe();
    recipe.plan.settlements.push({ id: "village", source: "reference", center: [10, 20], type: "village" });
    recipe.plan.roadGraph.nodes[0]!.settlement = "village";
    recipe.generated.sites.push({ settlement: "village", center: [10, 20], coreRadius: 30, dwellings: 4, program: [] });
    recipe.generated.parcels.push({ id: "p1", settlement: "village", polygon: [[0, 0], [4, 0], [4, 4]], frontage: "main" });
    recipe.ownership.splines["wb-road-main"] = { stage: "roads", edge: "main" };
    const { session, history } = harness({ [RECIPE_URL]: recipe });
    await session.load();
    session.selectPlan({ kind: "node", id: "b" });
    assert.equal(session.deletePlanElement(), true, "the selected element by default");
    let after = session.getView();
    assert.deepEqual(after.planEdit!.plan.roadGraph.edges, [], "the node's edges go with it");
    assert.equal(after.planEdit!.selection, null);
    assert.equal(history.state().undoLabel, "World Builder: delete node");
    assert.equal(session.deletePlanElement({ kind: "settlement", id: "village" }), true);
    after = session.getView();
    assert.equal(after.planEdit!.plan.roadGraph.nodes[0]!.settlement, undefined);
    assert.equal(after.planCounts!.settlements, 0);
    assert.equal(after.layer.counts.cores, 0);
    history.undo();
    history.undo();
    const restored = session.getView().planEdit!.plan;
    assert.equal(restored.roadGraph.edges.length, 1);
    assert.equal(restored.roadGraph.nodes[0]!.settlement, "village");
  });

  await checkAsync("world builder session: edge guide points and protected regions are hand corrections too", async () => {
    const { session, history, statuses } = harness({ [RECIPE_URL]: roadRecipe() });
    await session.load();
    const guide = () => session.getView().planEdit!.plan.roadGraph.edges[0]!.guide;
    assert.equal(session.addGuidePoint("main"), true);
    assert.deepEqual(guide(), [[10, 0], [20, 0]], "a guide starts with two points (its minimum)");
    assert.equal(session.movePlanPoint({ kind: "guide", id: "main", index: 1 }, [20, 6]), true);
    assert.equal(session.addGuidePoint("main"), true);
    assert.equal(guide()!.length, 3);
    assert.equal(session.deleteGuidePoint("main", 0), true);
    assert.equal(session.deleteGuidePoint("main", 0), true);
    assert.equal(guide(), undefined, "a guide of one point is dropped; the edge runs straight");

    assert.equal(session.addPlanElement("protected"), true);
    const region = () => session.getView().planEdit!.protectedRegions[0]!;
    assert.deepEqual(region(), { id: "protected-1", kind: "manual", min: [-11, -11], max: [21, 21] });
    assert.equal(session.movePlanPoint({ kind: "protected", id: "protected-1", corner: "max" }, [-20, 0]), true);
    assert.deepEqual([region().min, region().max], [[-20, -11], [-11, 0]], "a corner dragged past the other swaps them");
    assert.equal(session.updatePlanElement({ kind: "protected", id: "protected-1" }, { min: [0, 0], max: [0, 5] }), false);
    assert.match(statuses.at(-1)!, /^Plan edit refused: ownership\.protectedRegions\[0\]/);
    assert.equal(session.deletePlanElement({ kind: "protected", id: "protected-1" }), true);
    assert.deepEqual(session.getView().planEdit!.protectedRegions, []);
    history.undo();
    assert.equal(session.getView().planEdit!.protectedRegions.length, 1);
  });

  await checkAsync("world builder session: Edit Plan handles drag a point uncommitted; the drop is one move step", async () => {
    const { session, history, layers } = harness({ [RECIPE_URL]: roadRecipe() });
    await session.load();
    assert.deepEqual(session.planHandles(), [], "no handles outside Edit Plan mode");
    session.setPlanEditing(true);
    assert.deepEqual(session.planHandles().map((handle) => handle.ref), [{ kind: "node", id: "a" }, { kind: "node", id: "b" }]);
    assert.equal(session.getView().planEdit!.handles, 2);
    session.setLayerOptions({ plan: false });
    assert.equal(session.planHandles().length, 0, "a hidden plan offers no handles");
    session.setLayerOptions({ plan: true });
    const drawn = layers.length;
    session.beginPlanDrag({ kind: "node", id: "b" });
    assert.deepEqual(session.planEditSelection(), { kind: "node", id: "b" });
    session.dragPlanPoint({ kind: "node", id: "b" }, [40, 10]);
    assert.ok(layers.length > drawn, "the drag redraws the layer");
    assert.equal(history.state().canUndo, false, "dragging commits nothing");
    assert.deepEqual(session.getView().planEdit!.plan.roadGraph.nodes[1]!.position, [30, 0]);
    session.endPlanDrag({ kind: "node", id: "b" }, null);
    assert.equal(history.state().canUndo, false, "a cancelled drag leaves the plan alone");
    session.dragPlanPoint({ kind: "node", id: "b" }, [40, 10]);
    session.endPlanDrag({ kind: "node", id: "b" }, [40, 10]);
    assert.deepEqual(session.getView().planEdit!.plan.roadGraph.nodes[1]!.position, [40, 10]);
    assert.equal(history.state().undoLabel, "World Builder: move");
    history.undo();
    assert.deepEqual(session.getView().planEdit!.plan.roadGraph.nodes[1]!.position, [30, 0]);
    session.setPlanEditing(false);
    assert.equal(session.planEditSelection(), null, "shortcuts act only in Edit Plan mode");
  });
}
