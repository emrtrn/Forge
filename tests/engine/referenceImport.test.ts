import assert from "node:assert/strict";
import { createWorldRecipe, normalizeWorldRecipe } from "../../engine/worldbuilder/recipe";
import { previewReferenceImport, MAX_REFERENCE_IMPORT_BYTES } from "../../engine/worldbuilder/referenceImport";

type Check = (label: string, fn: () => void) => void;
const provenance = { source: "reference", observed: true, confidence: 0.8 };
function fixture() {
  const recipe = createWorldRecipe("import_test");
  recipe.reference = { image: "maps/valley.png", origin: [-100, -200], size: [400, 200], view: "topDown" };
  return recipe;
}
function analysis(plan: unknown) {
  return JSON.stringify({ schemaVersion: 1, coordinateSpace: "reference-normalized", referenceImage: "maps/valley.png", plan });
}
export function registerReferenceImportTests(check: Check): void {
  check("reference import: transforms every geometry into world metres and is repeatable", () => {
    const current = fixture(), before = structuredClone(current);
    const text = analysis({
      settlements: [{ id: "v", ...provenance, type: "village", center: [0.25, 0.75], radius: 0.1, boundary: [[0, 0], [1, 0], [1, 1]], population: 80 }],
      regions: [{ id: "r", ...provenance, kind: "forest", polygon: [[0, 0], [1, 0], [1, 1]] }],
      water: [{ id: "w", ...provenance, kind: "stream", path: [[0, 0], [1, 1]] }],
      landmarks: [{ id: "l", ...provenance, kind: "viewpoint", position: [0.5, 0.5], settlement: "v" }],
      roadGraph: { nodes: [{ id: "a", ...provenance, kind: "gate", position: [0, 0], settlement: "v" }, { id: "b", ...provenance, kind: "end", position: [1, 1] }],
        edges: [{ id: "e", ...provenance, from: "a", to: "b", roadClass: "local", guide: [[0.2, 0.4], [0.8, 0.6]] }] },
    });
    const result = previewReferenceImport(current, text);
    assert.deepEqual(result.errors, []);
    assert.equal(result.changes.filter(c => c.change === "added").length, 7);
    assert.deepEqual(result.recipe!.plan.settlements[0]!.center, [0, -50]);
    assert.equal(result.recipe!.plan.settlements[0]!.radius, 40);
    assert.deepEqual(result.recipe!.plan.regions[0]!.polygon, [[-100, -200], [300, -200], [300, 0]]);
    assert.deepEqual(result.recipe!.plan.water[0]!.path, [[-100, -200], [300, 0]]);
    assert.deepEqual(result.recipe!.plan.landmarks[0]!.position, [100, -100]);
    assert.deepEqual(result.recipe!.plan.roadGraph.edges[0]!.guide, [[-20, -120], [220, -80]]);
    assert.deepEqual(current, before, "preview never mutates the input recipe");
    const again = previewReferenceImport(result.recipe!, text);
    assert.deepEqual(again.recipe, result.recipe);
    assert.equal(again.changes.every(c => c.change === "unchanged"), true);
  });

  check("reference import: manual, other-source and protected entries survive identity collisions; omissions stay", () => {
    const recipe = fixture();
    recipe.plan.settlements.push({ id: "v", source: "reference", type: "village", center: [5, 8], protected: true });
    recipe.plan.water.push({ id: "manual", source: "manual", kind: "lake", polygon: [[1, 1], [2, 1], [2, 2]] });
    recipe.plan.regions.push({ id: "osm", source: "osm", kind: "forest", polygon: [[1, 1], [2, 1], [2, 2]] });
    recipe.plan.landmarks.push({ id: "absent", source: "reference", kind: "viewpoint", position: [1, 2] });
    const before = structuredClone(recipe);
    const result = previewReferenceImport(recipe, analysis({
      settlements: [{ id: "v", ...provenance, type: "town", center: [0.5, 0.5] }],
      water: [{ id: "manual", ...provenance, kind: "river", path: [[0, 0], [1, 1]] }],
      regions: [{ id: "osm", ...provenance, kind: "mountain", polygon: [[0, 0], [1, 0], [1, 1]] }],
    }));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.recipe, before);
    assert.deepEqual(result.changes.map(c => c.reason).sort(), ["manual", "otherSource", "protected"].sort());
  });

  check("reference import: persisted deletions and dependent edges never resurrect", () => {
    const recipe = fixture();
    recipe.ownership.deletedPlanElements = [{ kind: "node", id: "a" }, { kind: "water", id: "w" }];
    const reloaded = normalizeWorldRecipe(JSON.parse(JSON.stringify(recipe))).recipe!;
    const result = previewReferenceImport(reloaded, analysis({
      water: [{ id: "w", ...provenance, kind: "river", path: [[0, 0], [1, 1]] }],
      roadGraph: { nodes: [{ id: "a", ...provenance, kind: "end", position: [0, 0] }, { id: "b", ...provenance, kind: "end", position: [1, 1] }],
        edges: [{ id: "e", ...provenance, from: "a", to: "b", roadClass: "track" }] },
    }));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.recipe!.plan.roadGraph.nodes.map(n => n.id), ["b"]);
    assert.deepEqual(result.recipe!.plan.roadGraph.edges, []);
    assert.deepEqual(result.recipe!.plan.water, []);
    assert.equal(result.changes.find(c => c.id === "e")!.reason, "missingDependency");
    assert.equal(result.changes.find(c => c.id === "w")!.reason, "deletedByHand");
  });

  check("reference import: partial road analyses may refer to retained manual nodes", () => {
    const recipe = fixture();
    recipe.plan.roadGraph.nodes.push({ id: "manual", source: "manual", kind: "end", position: [1, 2] });
    const result = previewReferenceImport(recipe, analysis({ roadGraph: {
      nodes: [{ id: "new", ...provenance, kind: "end", position: [1, 1] }],
      edges: [{ id: "link", ...provenance, from: "manual", to: "new", roadClass: "path" }],
    } }));
    assert.deepEqual(result.errors, []);
    assert.equal(result.recipe!.plan.roadGraph.edges[0]!.from, "manual");
    assert.deepEqual(result.recipe!.plan.roadGraph.nodes[0], recipe.plan.roadGraph.nodes[0]);
  });

  check("reference import: malformed coordinates, metadata, links, duplicate ids and unsupported fields reject atomically", () => {
    const recipe = fixture();
    const valid = { id: "w", ...provenance, kind: "river", path: [[0, 0], [1, 1]] };
    for (const entry of [
      { ...valid, path: [[0, 0], [1.1, 0]] }, { ...valid, path: [[0, "0"], [1, 1]] },
      { ...valid, confidence: 2 }, { ...valid, observed: undefined }, { ...valid, source: "manual" },
      { ...valid, polygon: [[0, 0], [1, 0], [1, 1]] }, { ...valid, script: "bad" },
    ]) {
      const result = previewReferenceImport(recipe, analysis({ water: [entry] }));
      assert.equal(result.recipe, null); assert.ok(result.errors.length > 0);
    }
    assert.equal(previewReferenceImport(recipe, analysis({ water: [valid, valid] })).recipe, null);
    assert.equal(previewReferenceImport(recipe, analysis({ roadGraph: { edges: [{ id: "bad", ...provenance, from: "gone", to: "missing", roadClass: "local" }] } })).recipe, null);
    assert.equal(previewReferenceImport(recipe, JSON.stringify({ schemaVersion: 1, coordinateSpace: "reference-normalized", referenceImage: "maps/valley.png", plan: {}, ownership: {} })).recipe, null);
    assert.deepEqual(recipe, fixture());
  });

  check("reference import: rejects missing/wrong/perspective references, bad envelopes and oversized documents", () => {
    const recipe = fixture(), text = analysis({});
    for (const document of ["not json", "null", "{}", text.replace("reference-normalized", "world"), text.replace("valley.png", "other.png")]) {
      assert.equal(previewReferenceImport(recipe, document).recipe, null);
    }
    delete recipe.reference;
    assert.equal(previewReferenceImport(recipe, text).recipe, null);
    recipe.reference = { ...fixture().reference!, view: "perspective" };
    assert.equal(previewReferenceImport(recipe, text).recipe, null);
    assert.equal(previewReferenceImport(fixture(), " ".repeat(MAX_REFERENCE_IMPORT_BYTES + 1)).recipe, null);
    const many = Array.from({ length: 5001 }, (_, i) => ({ id: `w${i}`, ...provenance, kind: "river", path: [[0, 0], [1, 1]] }));
    assert.equal(previewReferenceImport(fixture(), analysis({ water: many })).recipe, null);
  });
}
