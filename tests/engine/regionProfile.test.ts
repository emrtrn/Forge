/**
 * World Builder F1, step 3: the region profile (plan v0.4 §13.3 L0, §13.4).
 * Everything cultural the settlement generators read lives here; the neutral
 * fixture is the profile Forge's own tests build with.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";

import {
  landUseCompatibility,
  normalizeRegionProfile,
  type RegionProfile,
} from "../../engine/worldbuilder/regionProfile";
import { collectDroppedFields } from "../../tools/droppedFields";

type Check = (label: string, fn: () => void) => void;

const NEUTRAL_PATH = "tests/engine/fixtures/neutral.regionprofile.json";

function neutral(): Record<string, any> {
  return JSON.parse(readFileSync(NEUTRAL_PATH, "utf8")) as Record<string, any>;
}

function neutralProfile(): RegionProfile {
  const { profile, issues } = normalizeRegionProfile(neutral());
  assert.deepEqual(issues, []);
  return profile!;
}

export function registerRegionProfileTests(check: Check): void {
  check("region profile: the neutral fixture is canonical, issue-free and drift-free", () => {
    const input = neutral();
    const { profile, issues } = normalizeRegionProfile(input);
    assert.deepEqual(issues, []);
    assert.deepEqual(collectDroppedFields(input, profile, "profile").paths, []);
    assert.deepEqual(profile, input);
    assert.deepEqual(normalizeRegionProfile(JSON.parse(JSON.stringify(profile))).profile, profile);
  });

  check("region profile: not-a-profile documents normalize to null", () => {
    assert.equal(normalizeRegionProfile([]).profile, null);
    assert.equal(normalizeRegionProfile({ ...neutral(), schemaVersion: 2 }).profile, null);
    assert.equal(normalizeRegionProfile({ ...neutral(), id: "has space" }).profile, null);
    assert.equal(normalizeRegionProfile({ ...neutral(), label: "  " }).profile, null);
  });

  check("region profile: land-use compatibility reads either direction with same/different defaults", () => {
    const profile = neutralProfile();
    assert.equal(landUseCompatibility(profile, "industrial", "residential"), -0.8);
    assert.equal(landUseCompatibility(profile, "residential", "industrial"), -0.8);
    assert.equal(landUseCompatibility(profile, "civic", "commercial"), 0.6);
    assert.equal(landUseCompatibility(profile, "residential", "residential"), 1);
    assert.equal(landUseCompatibility(profile, "agricultural", "transport"), 0);
  });

  check("region profile: bad entries and broken cross-references are dropped with a path", () => {
    const input = neutral();
    input.roads.motorway = { width: 12, shoulder: 2, maxSlopeDeg: 5, minTurnRadius: 200 };
    input.roads.path = { width: 0.1, shoulder: 0, maxSlopeDeg: 30, minTurnRadius: 2 };
    input.zoning.compatibility.commercial = { civic: 0.2, residential: 2 };
    input.roles["building.transport.station"] = { landUse: "transport", footprint: { width: [10, 20], depth: [10, 20] }, storeys: [1, 1], storeyHeight: 4, entrance: "street" };
    input.roles["building.residential.tower"] = { landUse: "residential", footprint: { width: [10, 20], depth: [10, 20] }, storeys: [3, 1.5], storeyHeight: 3, entrance: "street" };
    input.roles["building.residential.detached"].placeholderColor = "orange";
    input.program.push({ role: "building.civic.clinic", count: 1 });
    input.program.push({ role: "building.civic.hall", count: 1, perResidents: 100 });
    input.program.push({ role: "building.commercial.shop", perResidents: 80, siting: "rooftop" });
    input.streetFurniture.push({ role: "prop.bench", roadClasses: ["local"], placement: "interval", size: [1.5, 0.5, 0.5] });
    input.streetFurniture.push({ role: "prop.bollard", roadClasses: ["highway"], placement: "junction", size: [0.2, 1, 0.2] });

    const { profile, issues } = normalizeRegionProfile(input);
    assert.deepEqual(issues, [
      "roads.motorway: key must be a road class",
      "roads.path.width: must be a number 0.5..100",
      "roles.building.residential.detached.placeholderColor: must be #rrggbb",
      "roles.building.residential.tower.storeys: must be [low, high] integers within 0..200, low ≤ high",
      "roles.building.transport.station.landUse: has no parcels.transport spec",
      "zoning.compatibility.commercial.residential: must be a number -1..1",
      "zoning.compatibility.civic.commercial: disagrees with commercial.civic; civic.commercial wins",
      "program[5].role: must name a profile role",
      "program[6]: needs exactly one of perResidents or count",
      "program[7].siting: must be one of center, mainRoad, edge, downstream, entrance, any",
      "streetFurniture[2].spacing: must be a number 1..10000",
      "streetFurniture[3].roadClasses[0]: has no roads.highway spec",
      "streetFurniture[3].roadClasses: must list at least one defined road class",
    ]);
    assert.deepEqual(Object.keys(profile!.roads), ["collector", "local", "track"]);
    assert.equal(profile!.roles["building.transport.station"], undefined);
    assert.equal(profile!.roles["building.residential.tower"], undefined);
    assert.equal(profile!.roles["building.residential.detached"]!.placeholderColor, undefined);
    assert.equal(profile!.program.length, 6);
    assert.equal(profile!.program[5]!.siting, "any");
    assert.equal(profile!.streetFurniture.length, 2);
    assert.equal(landUseCompatibility(profile!, "commercial", "civic"), 0.2);
    assert.equal(landUseCompatibility(profile!, "civic", "commercial"), 0.6);
  });

  check("region profile: empty roads and all-zero street weights are reported, with safe fallbacks", () => {
    const input = neutral();
    input.roads = {};
    input.streetPattern = { linear: 0, grid: 0, organic: 0, radial: 0, contourFollow: 0, blockSize: [40, 110] };
    input.streetFurniture = [];
    const { profile, issues } = normalizeRegionProfile(input);
    assert.deepEqual(issues, [
      "roads: must define at least one road class",
      "streetPattern: needs at least one positive pattern weight; using linear",
    ]);
    assert.equal(profile!.streetPattern.linear, 1);
  });

  check("world builder: engine/worldbuilder modules stay dependency-free (no three.js)", () => {
    // Only World Builder's own modules and the three-free scene data modules.
    const allowedScene = new Set(["layout", "placementIdentity", "shapes"]);
    const files = readdirSync("engine/worldbuilder", { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"));
    assert.ok(files.length >= 6);
    for (const file of files) {
      const path = posix.join("engine/worldbuilder", file.replace(/\\/g, "/"));
      const source = readFileSync(path, "utf8");
      for (const [, specifier] of source.matchAll(/from\s+"([^"]+)"/g)) {
        const target = posix.normalize(posix.join(posix.dirname(path), specifier!));
        const scene = /^engine\/scene\/([A-Za-z]+)$/.exec(target)?.[1];
        assert.ok(
          specifier!.startsWith(".") && (target.startsWith("engine/worldbuilder/") || (scene !== undefined && allowedScene.has(scene))),
          `${path} imports ${specifier}`,
        );
      }
    }
  });
}
