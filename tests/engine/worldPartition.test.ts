import assert from "node:assert/strict";
import type { RoomLayout, Vec3 } from "../../engine/scene/layout";
import {
  DEFAULT_WORLD_PARTITION,
  compareWorldCellKeys,
  countWorldCellElements,
  mergeWorldCells,
  normalizeWorldCellDocument,
  normalizeWorldPartitionSettings,
  partitionLayout,
  streamedLightPeaks,
  worldCellPath,
  worldPartitionActorCells,
  worldPartitionCellContents,
  type StreamedLightKind,
  type WorldCellDocument,
} from "../../engine/world/worldPartition";

type Check = (label: string, fn: () => void) => void;
const ENABLED = normalizeWorldPartitionSettings({ enabled: true });
const ARRAYS = [
  "instances", "actors", "characters", "lights", "reflectionCaptures",
  "targetPoints", "blockingVolumes", "worldWidgets",
] as const;

function always<T extends object>(item: T): T & { spatiallyLoaded: false } {
  return { ...item, spatiallyLoaded: false };
}

function fixture(): RoomLayout {
  return {
    schema: 1, name: "Partition fixture", loadGroups: ["base", "props"],
    worldSettings: { gravity: [0, -9.81, 0], gameMode: "default" },
    skyAtmosphere: { exposure: 1.5 }, heightFog: { density: 0.01 },
    cloudLayer: { coverage: 0.4 }, reflection: { intensity: 0.6 }, postProcess: { exposure: 1.2 },
    landscapes: [{ id: "terrain", position: [1000, 0, 1000], dataRef: "landscapes/terrain.terrain.json" }],
    riverWaters: [{ id: "river", landscapeRef: "terrain", splineRef: "river-path" }],
    splines: [{ id: "path", position: [1000, 0, 1000], spline: {
      schema: 1, closed: false, defaultUp: [0, 1, 0], reparamStepsPerSegment: 8, points: [],
    } }],
    aiNavigationVolumes: [{ id: "nav", position: [1000, 0, 1000] }],
    reflectionPlanes: [{ id: "mirror", position: [1000, 0, 1000] }],
    reflectiveSurfaces: [{ id: "floor", position: [1000, 0, 1000] }],
    instances: [
      { assetId: "mesh:rock", placements: [
        { name: "rock-far", position: [1280, 7, 0], metadata: { tags: ["far", "rock"] } },
        { name: "rock-negative", position: [-0.01, 20, -128] },
        { name: "rock-boundary", position: [128, 0, 128], pivot: [999, 0, 999] },
        { name: "rock-same-cell", position: [130, 0, 129] },
        always({ name: "rock-always", position: [500, 0, 500] as Vec3 }),
      ] },
      { assetId: "mesh:tree", placements: [{ name: "tree", position: [256, 0, 0] }] },
      { assetId: "mesh:empty", placements: [] },
      { assetId: "marker:playerStart:default", placements: [{ name: "spawn", position: [1000, 0, 1000] }] },
    ],
    actors: [
      { name: "actor-negative", classRef: "Actor_Test", position: [-128, 0, 0] },
      always({ name: "actor-always-first", classRef: "Actor_Test", position: [500, 0, 500] as Vec3 }),
      { name: "actor-origin", classRef: "Actor_Test", position: [0, 1000, 0], variableOverrides: { health: 10 } },
      always({ name: "actor-always-second", classRef: "Actor_Test", position: [600, 0, 600] as Vec3 }),
    ],
    characters: [
      { assetId: "character:test", name: "character-negative", position: [-128, 9, -128], scale: 999 },
      always({ assetId: "character:test", name: "character-always", position: [500, 0, 500] as Vec3 }),
    ],
    lights: [
      { id: "sun", type: "directional", position: [1000, 0, 1000] },
      { id: "point", type: "point", position: [1280, 0, 0] },
      { id: "spot", type: "spot", position: [0, 0, 0] },
      always({ id: "light-always", type: "point" as const, position: [500, 0, 500] as Vec3 }),
    ],
    reflectionCaptures: [
      { id: "probe", position: [256, 0, -1], radius: 999 },
      always({ id: "probe-always", position: [500, 0, 500] as Vec3 }),
    ],
    targetPoints: [
      { id: "target", position: [-256, 0, 0] },
      always({ id: "target-always", position: [500, 0, 500] as Vec3 }),
    ],
    blockingVolumes: [
      { id: "wide", name: "Wide bridge", position: [0, 0, 0], size: [2, 2, 2], scale: 65 },
      { id: "deep", position: [0, 0, 0], size: [2, 2, 2], scale: [1, 1, -65] },
      { id: "exact", position: [128, 0, 0], size: [64, 2, 64], scale: 2 },
      { id: "default-size", position: [1, 0, 1], scale: 64 },
      { id: "shrunk", position: [256, 0, 0], size: [200, 2, 100], scale: 0.5 },
      always({ id: "volume-always", position: [500, 0, 500] as Vec3, size: [999, 1, 999] as Vec3 }),
    ],
    worldWidgets: [
      { widget: "ui:label", anchor: { worldPos: [-1280, 99, -256], offset3d: [999, 0, 999] } },
      always({ widget: "ui:always", anchor: { worldPos: [500, 0, 500] as Vec3 } }),
      // Older/entity-only data can lack a fixed position, despite the current type.
      { widget: "ui:tracked", anchor: { entityId: "actor:0" } } as NonNullable<RoomLayout["worldWidgets"]>[number],
    ],
  };
}

function generatedFixture(): RoomLayout {
  let seed = 0x51ce;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const position = (index: number): Vec3 => {
    const offset = index % 4 === 0 ? 0 : random() * 128;
    return [Math.floor(random() * 11 - 5) * 128 + offset, random() * 100, Math.floor(random() * 11 - 5) * 128 + offset];
  };
  const layout: RoomLayout = {
    schema: 1, name: "Generated partition fixture", loadGroups: [], characters: [],
    instances: ["mesh:rock", "mesh:tree", "mesh:rock"].map((assetId) => ({ assetId, placements: [] })),
    actors: [], lights: [], reflectionCaptures: [], targetPoints: [], blockingVolumes: [], worldWidgets: [],
  };
  for (let index = 0; index < 24; index += 1) {
    const flags = index % 5 === 0 ? { spatiallyLoaded: false } : {};
    layout.instances[index % 3]!.placements.push({ name: `mesh-${index}`, position: position(index), ...flags });
    layout.actors!.push({ name: `actor-${index}`, classRef: "Actor_Test", position: position(index), ...flags });
    layout.characters.push({ name: `character-${index}`, assetId: "character:test", position: position(index), ...flags });
    layout.lights!.push({ id: `light-${index}`, type: index % 7 === 0 ? "directional" : index % 2 === 0 ? "point" : "spot",
      position: position(index), castShadow: index % 3 === 0, ...flags });
    layout.reflectionCaptures!.push({ id: `probe-${index}`, position: position(index), ...flags });
    layout.targetPoints!.push({ id: `target-${index}`, position: position(index), ...flags });
    layout.blockingVolumes!.push({ id: `volume-${index}`, position: position(index), size: [4, 2, 8],
      scale: index % 2 === 0 ? [-1, 2, -1] : 1, ...flags });
    const anchor = index % 6 === 0 ? { entityId: `actor:${index}` } : { worldPos: position(index) };
    layout.worldWidgets!.push({ widget: `ui:${index}`, anchor, ...flags } as NonNullable<RoomLayout["worldWidgets"]>[number]);
  }
  layout.instances.push(
    { assetId: "marker:playerStart:generated", placements: [{ position: [-128, 0, 128] }] },
    always({ assetId: "mesh:persistent", placements: [{ position: [256, 0, -256] as Vec3 }] }),
  );
  layout.blockingVolumes!.push({ id: "oversized", position: [-128, 0, 0], size: [129, 2, 2] });
  return layout;
}

function assertCellContents(layout: RoomLayout): void {
  const before = structuredClone(layout);
  const settingsBefore = structuredClone(ENABLED);
  const contents = worldPartitionCellContents(layout, ENABLED);
  const split = partitionLayout(layout, ENABLED);
  assert.deepEqual([...contents.keys()], [...split.cells.keys()]);
  assert.deepEqual([...contents.keys()], [...contents.keys()].sort(compareWorldCellKeys));
  const seen = new Map<string, Set<number>>();
  const placements = new Set<string>();
  const actors = new Map<number, string>();
  for (const [key, indices] of contents) {
    const cell = split.cells.get(key)!;
    assert.deepEqual(Object.keys(indices).sort(), [...ARRAYS].sort());
    assert.ok(Object.values(indices).some((items) => items.length > 0));
    assert.deepEqual(indices.instances, [...indices.instances].sort((a, b) => a.group - b.group || a.placement - b.placement));
    for (const { group, placement } of indices.instances) {
      assert.ok(Number.isInteger(group) && group >= 0 && group < layout.instances.length);
      assert.ok(Number.isInteger(placement) && placement >= 0 && placement < layout.instances[group]!.placements.length);
      assert.equal(placements.has(`${group}:${placement}`), false);
      placements.add(`${group}:${placement}`);
    }
    // Preserve separate source groups, including repeated assetIds, and placement order.
    const groups = layout.instances.flatMap((group, groupIndex) => {
      const resolved = indices.instances.filter((item) => item.group === groupIndex)
        .map((item) => group.placements[item.placement]!);
      return resolved.length ? [{ assetId: group.assetId, placements: resolved }] : [];
    });
    assert.deepEqual(cell.instances ?? [], groups);
    for (const field of ARRAYS) {
      if (field === "instances") continue;
      const items = layout[field] ?? [];
      const listed = indices[field];
      assert.deepEqual(listed, [...listed].sort((a, b) => a - b));
      const visited = seen.get(field) ?? new Set<number>();
      seen.set(field, visited);
      for (const index of listed) {
        assert.ok(Number.isInteger(index) && index >= 0 && index < items.length);
        assert.equal(visited.has(index), false);
        visited.add(index);
        if (field === "actors") actors.set(index, key);
      }
      assert.deepEqual(cell[field] ?? [], listed.map((index) => items[index]));
    }
  }
  const expectedPersistent = structuredClone(layout);
  expectedPersistent.instances.forEach((group, groupIndex) => {
    group.placements = group.placements.filter((_, index) => !placements.has(`${groupIndex}:${index}`));
  });
  for (const field of ARRAYS) {
    if (field === "instances") continue;
    const items = layout[field];
    if (items) Object.assign(expectedPersistent, { [field]: items.filter((_, index) => !seen.get(field)?.has(index)) });
  }
  assert.deepEqual(split.persistent, expectedPersistent);
  // Actor-map iteration remains in input-index order, independent of cell order.
  assert.deepEqual([...worldPartitionActorCells(layout, ENABLED)], [...actors].sort(([a], [b]) => a - b));
  assert.deepEqual(layout, before);
  assert.deepEqual(ENABLED, settingsBefore);
}

/** Only the comparison ignores ordering; the production merge must append. */
function canonicalize(layout: RoomLayout): RoomLayout {
  const out = structuredClone(layout);
  const stableKey = (item: unknown): string => JSON.stringify(item);
  const compare = (a: unknown, b: unknown): number => stableKey(a).localeCompare(stableKey(b));
  out.instances = out.instances.filter((group) => group.placements.length > 0);
  for (const group of out.instances) group.placements.sort(compare);
  for (const field of ARRAYS) out[field]?.sort(compare);
  return out;
}

export function registerWorldPartitionTests(check: Check): void {
  for (const [name, create] of [["fixture", fixture], ["generated layout", generatedFixture]] as const) {
    check(`world partition: cell contents match saved and persistent elements for ${name}`, () => {
      const layout = create();
      assertCellContents(layout);
      const split = partitionLayout(layout, ENABLED);
      assertCellContents(mergeWorldCells(split.persistent, split.cells.values()));
    });
  }

  check("world partition: disabled and empty cell contents return empty maps", () => {
    const layout = generatedFixture();
    const before = structuredClone(layout);
    assert.deepEqual(worldPartitionCellContents(layout, DEFAULT_WORLD_PARTITION), new Map());
    assert.deepEqual(layout, before);
    assert.deepEqual(worldPartitionCellContents({ schema: 1, name: "empty", loadGroups: [], instances: [], characters: [] }, ENABLED), new Map());
  });

  check("world partition: light peaks use inclusive box distances and independent shadow kinds", () => {
    const settings = normalizeWorldPartitionSettings({ enabled: true, grids: { main: { cellSize: 10, loadRange: 16 } } });
    const layout: RoomLayout = { schema: 1, name: "light peaks", loadGroups: [], instances: [], characters: [], lights: [] };
    const kinds: StreamedLightKind[] = ["point", "spot", "pointShadow", "spotShadow"];
    const cells = [
      { x: -3, z: 0, counts: [5, 0, 0, 4] }, // A
      { x: 0, z: 0, counts: [5, 0, 0, 0] }, // B
      { x: 3, z: 0, counts: [5, 1, 0, 0] }, // C
      { x: 2, z: 2, counts: [1, 0, 2, 0] }, // D
      { x: 3, z: 2, counts: [1, 3, 4, 0] }, // E
      { x: 4, z: 0, counts: [1, 2, 0, 0] }, // F
    ];
    for (const cell of cells) {
      kinds.forEach((kind, kindIndex) => {
        for (let index = 0; index < cell.counts[kindIndex]!; index += 1) {
          layout.lights!.push({ id: `${cell.x}_${cell.z}:${kind}:${index}`, type: kind.startsWith("point") ? "point" : "spot",
            position: [cell.x * 10, 0, cell.z * 10], castShadow: kind.endsWith("Shadow") });
        }
      });
    }
    layout.lights!.push({ id: "sun", type: "directional", position: [0, 0, 0], castShadow: true });
    for (const kind of kinds) {
      layout.lights!.push(always({ id: `persistent:${kind}`, type: kind.startsWith("point") ? "point" as const : "spot" as const,
        position: [0, 0, 0] as Vec3, castShadow: kind.endsWith("Shadow") }));
    }
    const before = structuredClone(layout);
    const contents = worldPartitionCellContents(layout, settings);
    const contentsBefore = structuredClone(contents);
    // Reach = 16 * 1.25 = 20. From B: A/C are exactly 20 (two empty cells
    // between), D is 10*sqrt(2), E is 10*sqrt(5) and F is 30. Include A/C/D,
    // exclude E/F. Neighbourhoods: A=AB, B=ABCD, C/D=BCDEF, E/F=CDEF.
    // B gives (16,1,2,4); C/D give (13,6,6,0). Per-kind maxima: (16,6,6,4).
    const expected = { point: 16, spot: 6, pointShadow: 6, spotShadow: 4 };
    assert.deepEqual(streamedLightPeaks(layout, contents, settings.grids.main), expected);
    assert.deepEqual(streamedLightPeaks(layout, contents, settings.grids.main, 1.25), expected);
    // At reach 16, B loses A/C; D still sees BCDEF and gives the point peak 13.
    assert.deepEqual(streamedLightPeaks(layout, contents, settings.grids.main, 1), {
      point: 13, spot: 6, pointShadow: 6, spotShadow: 4,
    });
    assert.deepEqual(streamedLightPeaks(layout, new Map(), settings.grids.main), {
      point: 0, spot: 0, pointShadow: 0, spotShadow: 0,
    });
    assert.deepEqual(layout, before);
    assert.deepEqual(contents, contentsBefore);
  });

  check("world partition: lightless occupied cells can set the light pool peak", () => {
    const settings = normalizeWorldPartitionSettings({ enabled: true, grids: { main: { cellSize: 10, loadRange: 16 } } });
    const layout: RoomLayout = {
      schema: 1, name: "lightless centre", loadGroups: [], instances: [], characters: [],
      targetPoints: [{ id: "centre", position: [0, 0, 0] }],
      lights: [
        { id: "left", type: "point", position: [-30, 0, 0] },
        { id: "right", type: "point", position: [30, 0, 0] },
      ],
    };
    // The centre is within 20 of both light cells; the light cells are 50 apart.
    const contents = worldPartitionCellContents(layout, settings);
    assert.deepEqual(streamedLightPeaks(layout, contents, settings.grids.main), {
      point: 2, spot: 0, pointShadow: 0, spotShadow: 0,
    });
    layout.lights = [
      { id: "sun", type: "directional", position: [0, 0, 0] },
      always({ id: "persistent", type: "point" as const, position: [0, 0, 0] as Vec3 }),
    ];
    assert.deepEqual(streamedLightPeaks(layout, worldPartitionCellContents(layout, settings), settings.grids.main), {
      point: 0, spot: 0, pointShadow: 0, spotShadow: 0,
    });
  });

  check("world partition: save summary counts every element exactly once", () => {
    const layout = fixture();
    const split = partitionLayout(layout, ENABLED);
    const streamed = [...split.cells.values()].reduce((sum, cell) => sum + countWorldCellElements(cell), 0);
    assert.ok(streamed > 0);
    assert.ok(countWorldCellElements(split.persistent) > 0);
    assert.equal(streamed + countWorldCellElements(split.persistent), countWorldCellElements(layout));
    assert.equal(countWorldCellElements({ instances: [{ assetId: "a", placements: [] }] }), 0);
  });
  check("world partition: actor routing agrees with partition cells and preserves merged indices", () => {
    const settings = normalizeWorldPartitionSettings({ enabled: true, grids: { main: { cellSize: 64 } } });
    const layout = fixture();
    layout.actors!.push(
      { name: "positive-boundary", classRef: "Actor_Test", position: [64, 0, 64] },
      { name: "negative-boundary", classRef: "Actor_Test", position: [-64, 0, -64] },
      { name: "just-negative", classRef: "Actor_Test", position: [-0.001, 500, -0.001] },
      { name: "same-cell", classRef: "Actor_Test", position: [65, -500, 65], spatiallyLoaded: true },
    );
    const before = structuredClone(layout);
    const settingsBefore = structuredClone(settings);
    const routes = worldPartitionActorCells(layout, settings);
    assert.deepEqual([...routes], [[0, "-2_0"], [2, "0_0"], [4, "1_1"], [5, "-1_-1"], [6, "-1_-1"], [7, "1_1"]]);
    const split = partitionLayout(layout, settings);
    const actualRoutes = new Map<number, string>();
    for (const [key, cell] of split.cells) {
      for (const actor of cell.actors ?? []) {
        const index = layout.actors!.findIndex((entry) => entry.name === actor.name);
        assert.ok(index >= 0);
        assert.equal(routes.get(index), key);
        actualRoutes.set(index, key);
      }
    }
    assert.deepEqual(routes, actualRoutes);
    for (const actor of split.persistent.actors ?? []) {
      assert.equal(routes.has(layout.actors!.findIndex((entry) => entry.name === actor.name)), false);
    }
    // Runtime receives this merged order, not the original authored array order.
    const merged = mergeWorldCells(split.persistent, [...split.cells.values()].reverse());
    const mergedRoutes = worldPartitionActorCells(merged, settings);
    assert.deepEqual(merged.actors?.map((actor) => actor.name), [
      "actor-always-first", "actor-always-second", "negative-boundary", "just-negative",
      "actor-negative", "actor-origin", "positive-boundary", "same-cell",
    ]);
    assert.deepEqual([...mergedRoutes], [[2, "-1_-1"], [3, "-1_-1"], [4, "-2_0"], [5, "0_0"], [6, "1_1"], [7, "1_1"]]);
    const repartitioned = partitionLayout(merged, settings);
    const remerged = mergeWorldCells(repartitioned.persistent, repartitioned.cells.values());
    assert.deepEqual(remerged.actors, merged.actors);
    assert.deepEqual(worldPartitionActorCells(remerged, settings), mergedRoutes);
    for (const [index, key] of mergedRoutes) {
      const actor: NonNullable<RoomLayout["actors"]>[number] = merged.actors![index]!;
      assert.ok(repartitioned.cells.get(key)?.actors?.some((entry) => entry.name === actor.name));
      assert.equal(remerged.actors!.findIndex((entry) => entry.name === actor.name), index);
    }
    assert.deepEqual(layout, before);
    assert.deepEqual(settings, settingsBefore);
    assert.deepEqual(worldPartitionActorCells(layout, DEFAULT_WORLD_PARTITION), new Map());
    assert.deepEqual(worldPartitionActorCells({ ...layout, actors: [] }, settings), new Map());
    delete layout.actors;
    assert.deepEqual(worldPartitionActorCells(layout, settings), new Map());
  });

  check("world partition: settings defaults and partial fields are independent copies", () => {
    assert.deepEqual(DEFAULT_WORLD_PARTITION, { enabled: false, grids: { main: { cellSize: 128, loadRange: 384 }, foliage: { cellSize: 64, loadRange: 256 } } });
    for (const value of [undefined, {}, { grids: {} }, { grids: { main: {} } }]) {
      assert.deepEqual(normalizeWorldPartitionSettings(value), DEFAULT_WORLD_PARTITION);
    }
    const input = { enabled: true, grids: { main: { cellSize: 64 } } };
    const before = structuredClone(input);
    const normalized = normalizeWorldPartitionSettings(input);
    assert.deepEqual(normalized, { enabled: true, grids: { main: { cellSize: 64, loadRange: 384 }, foliage: { cellSize: 64, loadRange: 256 } } });
    assert.deepEqual(normalizeWorldPartitionSettings({ grids: { main: { loadRange: 256 } } }), {
      enabled: false, grids: { main: { cellSize: 128, loadRange: 256 }, foliage: { cellSize: 64, loadRange: 256 } },
    });
    normalized.grids.main.cellSize = 1;
    assert.deepEqual(input, before);
    assert.equal(DEFAULT_WORLD_PARTITION.grids.main.cellSize, 128);
  });

  check("world partition: foliage defaults, custom settings and invalid grids", () => {
    assert.deepEqual(normalizeWorldPartitionSettings({}).grids.foliage, { cellSize: 64, loadRange: 256 });
    const custom = normalizeWorldPartitionSettings({ grids: { foliage: { cellSize: 32, loadRange: 160 } } });
    assert.deepEqual(custom.grids.foliage, { cellSize: 32, loadRange: 160 });
    assert.deepEqual(normalizeWorldPartitionSettings(JSON.parse(JSON.stringify(custom))), custom);
    custom.grids.foliage.cellSize = 1;
    assert.equal(DEFAULT_WORLD_PARTITION.grids.foliage.cellSize, 64);
    assert.throws(() => normalizeWorldPartitionSettings({ grids: { foliage: { cellSize: 0 } } }),
      /grids\.foliage\.cellSize must be finite and positive/);
    assert.throws(() => normalizeWorldPartitionSettings({ grids: { unknown: {} } }), /Unknown grid/);
  });

  check("world partition: invalid settings name the offending field", () => {
    for (const field of ["cellSize", "loadRange"]) {
      for (const value of [NaN, Infinity, -Infinity, 0, -1, "128", true, null]) {
        assert.throws(() => normalizeWorldPartitionSettings({ grids: { main: { [field]: value } } }), new RegExp(field));
      }
    }
    for (const enabled of [0, 1, "false", null, {}, []]) {
      assert.throws(() => normalizeWorldPartitionSettings({ enabled }), /enabled/);
    }
    for (const name of ["terrain", "grass", "typo"]) {
      assert.throws(() => normalizeWorldPartitionSettings({ grids: { main: {}, [name]: {} } }), new RegExp(name));
    }
    for (const grids of [null, 5, []]) assert.throws(() => normalizeWorldPartitionSettings({ grids }), /grids/);
    for (const main of [null, 5, []]) assert.throws(() => normalizeWorldPartitionSettings({ grids: { main } }), /main/);
    for (const input of [null, 5, []]) assert.throws(() => normalizeWorldPartitionSettings(input), /worldPartition/);
  });

  check("world partition: cell normalization checks headers and arrays, leaves elements opaque", () => {
    const header: WorldCellDocument = { schema: 1, type: "worldCell", grid: "main", key: "-2_10" };
    assert.deepEqual(normalizeWorldCellDocument(header), header);
    const arrays = Object.fromEntries(ARRAYS.map((field) => [field, [null, { arbitrary: [1, 2] }]]));
    const input = { ...header, ...arrays, ignored: true };
    const before = structuredClone(input);
    const normalized = normalizeWorldCellDocument(input);
    assert.deepEqual(normalized, { ...header, ...arrays });
    assert.deepEqual(input, before);
    assert.notEqual(normalized.actors, arrays.actors);
    assert.notEqual(normalized.actors?.[1], arrays.actors![1]);
    for (const field of ARRAYS) {
      assert.deepEqual(normalizeWorldCellDocument({ ...header, [field]: [] }), header);
      for (const value of [null, undefined, {}, 4, "array"]) {
        assert.throws(() => normalizeWorldCellDocument({ ...header, [field]: value }), new RegExp(field));
      }
    }
    for (const [field, value] of [
      ["schema", 2], ["schema", undefined], ["type", "level"], ["type", undefined],
      ["grid", "terrain"], ["grid", undefined], ["key", "1/2"], ["key", "1.5_0"],
      ["key", 12], ["key", undefined],
    ] as const) assert.throws(() => normalizeWorldCellDocument({ ...header, [field]: value }), new RegExp(field));
    for (const input of [null, undefined, [], "cell"]) assert.throws(() => normalizeWorldCellDocument(input), /worldCell/);
  });

  check("world partition: cell paths share terrain level suffix and separator rules", () => {
    assert.equal(worldCellPath("foo/Bar.level.json", "main", "-2_10"), "foo/Bar.cells/main/-2_10.cell.json");
    for (const path of ["foo/Bar.layout.json", "foo/Bar.json", "/foo/Bar.LEVEL.JSON", "\\foo\\Bar.level.json"]) {
      assert.equal(worldCellPath(path, "main", "0_0"), "foo/Bar.cells/main/0_0.cell.json");
    }
    assert.throws(() => worldCellPath(".level.json", "main", "0_0"), /level path/);
    assert.throws(() => worldCellPath("foo.level.json", "main", "../oops"), /key/);
  });

  check("world partition: every kind routes by X/Z with numeric z-then-x cell order", () => {
    const layout = fixture();
    const { persistent, cells, warnings } = partitionLayout(layout, ENABLED);
    assert.deepEqual([...cells.keys()], ["-10_-2", "-1_-1", "2_-1", "-2_0", "-1_0", "0_0", "1_0", "2_0", "10_0", "1_1"]);
    const cell = (key: string): WorldCellDocument => {
      assert.ok(cells.has(key), key);
      return cells.get(key)!;
    };
    assert.deepEqual(cell("-1_-1").instances?.[0]?.placements.map((p) => p.name), ["rock-negative"]);
    assert.deepEqual(cell("1_1").instances?.[0]?.placements.map((p) => p.name), ["rock-boundary", "rock-same-cell"]);
    assert.equal(cell("10_0").instances?.[0]?.placements[0]?.name, "rock-far");
    assert.equal(cell("2_0").instances?.[0]?.assetId, "mesh:tree");
    assert.equal(cell("-1_0").actors?.[0]?.name, "actor-negative");
    assert.equal(cell("0_0").actors?.[0]?.name, "actor-origin");
    assert.equal(cell("-1_-1").characters?.[0]?.name, "character-negative");
    assert.equal(cell("10_0").lights?.[0]?.id, "point");
    assert.equal(cell("0_0").lights?.[0]?.id, "spot");
    assert.equal(cell("2_-1").reflectionCaptures?.[0]?.id, "probe");
    assert.equal(cell("-2_0").targetPoints?.[0]?.id, "target");
    assert.equal(cell("1_0").blockingVolumes?.[0]?.id, "exact");
    assert.equal(cell("0_0").blockingVolumes?.[0]?.id, "default-size");
    assert.equal(cell("2_0").blockingVolumes?.[0]?.id, "shrunk");
    assert.equal(cell("-10_-2").worldWidgets?.[0]?.widget, "ui:label");
    assert.deepEqual(persistent.instances.map((group) => [group.assetId, group.placements.map((p) => p.name)]), [
      ["mesh:rock", ["rock-always"]], ["mesh:tree", []], ["mesh:empty", []], ["marker:playerStart:default", ["spawn"]],
    ]);
    assert.deepEqual(persistent.actors?.map((item) => item.name), ["actor-always-first", "actor-always-second"]);
    assert.deepEqual(persistent.characters.map((item) => item.name), ["character-always"]);
    assert.deepEqual(persistent.lights?.map((item) => item.id), ["sun", "light-always"]);
    assert.deepEqual(persistent.reflectionCaptures?.map((item) => item.id), ["probe-always"]);
    assert.deepEqual(persistent.targetPoints?.map((item) => item.id), ["target-always"]);
    assert.deepEqual(persistent.blockingVolumes?.map((item) => item.id), ["wide", "deep", "volume-always"]);
    assert.deepEqual(persistent.worldWidgets?.map((item) => item.widget), ["ui:always", "ui:tracked"]);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0]!, /Wide bridge/);
    assert.match(warnings[1]!, /deep/);
    for (const field of [
      "schema", "name", "loadGroups", "worldSettings", "skyAtmosphere", "heightFog", "cloudLayer", "reflection",
      "postProcess", "landscapes", "riverWaters", "splines", "aiNavigationVolumes", "reflectionPlanes", "reflectiveSurfaces",
    ] as const) assert.deepEqual(persistent[field], layout[field], field);
    for (const document of cells.values()) {
      assert.deepEqual(normalizeWorldCellDocument(document), document);
      for (const field of ARRAYS) if (document[field]) assert.ok(document[field].length > 0);
      for (const group of document.instances ?? []) assert.ok(group.placements.length > 0);
    }
  });

  check("world partition: blocking footprints resolve brush shape, default size and signed per-axis scale", () => {
    const layout: RoomLayout = { schema: 1, name: "brushes", loadGroups: [], instances: [], characters: [], blockingVolumes: [
      { id: "sphere", brushShape: "sphere", position: [0, 0, 0], size: [129, 1, 1] },
      { id: "cylinder", brushShape: "cylinder", position: [0, 0, 0], size: [65, 1, 1], scale: [1, 1, -2] },
      { id: "scaled-default", position: [0, 0, 0], scale: -65 },
      { id: "tall", position: [0, 0, 0], size: [128, 9999, 128], scale: [-1, 10, -1], rotation: [0, 45, 0] },
    ] };
    const split = partitionLayout(layout, ENABLED);
    assert.deepEqual(split.persistent.blockingVolumes?.map((item) => item.id), ["sphere", "cylinder", "scaled-default"]);
    assert.deepEqual(split.cells.get("0_0")?.blockingVolumes?.map((item) => item.id), ["tall"]);
    assert.equal(split.warnings.length, 3);
  });

  check("world partition: configured cellSize controls exact positive and negative boundaries", () => {
    const layout: RoomLayout = { schema: 1, name: "boundaries", loadGroups: [], instances: [], characters: [], targetPoints: [
      { id: "negative", position: [-64, 0, -64] }, { id: "positive", position: [64, 0, 64] },
      { id: "just-negative", position: [-0.001, 0, -0.001] }, { id: "origin", position: [0, 99, 0] },
    ] };
    const split = partitionLayout(layout, normalizeWorldPartitionSettings({ enabled: true, grids: { main: { cellSize: 64 } } }));
    assert.deepEqual([...split.cells.keys()], ["-1_-1", "0_0", "1_1"]);
    assert.deepEqual(split.cells.get("-1_-1")?.targetPoints?.map((p) => p.id), ["negative", "just-negative"]);
    assert.equal(split.cells.get("1_1")?.targetPoints?.[0]?.id, "positive");
  });

  check("world partition: disabled split returns an independent unchanged clone", () => {
    const layout = fixture();
    const before = structuredClone(layout);
    const split = partitionLayout(layout, DEFAULT_WORLD_PARTITION);
    assert.deepEqual(split, { persistent: before, cells: new Map(), warnings: [] });
    split.persistent.instances[0]!.placements[0]!.position[0] = 999;
    assert.deepEqual(layout, before);
  });

  check("world partition: split/merge round trip, determinism and deep input ownership", () => {
    const layout = fixture();
    const before = structuredClone(layout);
    const settingsBefore = structuredClone(ENABLED);
    const split = partitionLayout(layout, ENABLED);
    const splitBefore = structuredClone(split);
    assert.deepEqual(partitionLayout(layout, ENABLED), split);
    assert.deepEqual(layout, before);
    assert.deepEqual(ENABLED, settingsBefore);
    const merged = mergeWorldCells(split.persistent, split.cells.values());
    const reversed = mergeWorldCells(split.persistent, [...split.cells.values()].reverse());
    assert.deepEqual(merged, reversed);
    assert.deepEqual(canonicalize(merged), canonicalize(layout));
    assert.deepEqual(split, splitBefore);
    assert.deepEqual(merged.actors?.slice(0, 2).map((item) => item.name), ["actor-always-first", "actor-always-second"]);
    merged.actors!.at(-1)!.position[0] = 123;
    merged.instances[0]!.placements.find((p) => p.name === "rock-far")!.metadata!.tags = ["changed"];
    merged.worldSettings!.gravity![1] = -1;
    assert.deepEqual(split, splitBefore);
    split.cells.get("0_0")!.actors![0]!.variableOverrides!.health = 99;
    split.cells.get("10_0")!.instances![0]!.placements[0]!.position[0] = 0;
    split.persistent.worldSettings!.gravity![1] = -2;
    assert.deepEqual(layout, before);
  });

  check("world partition: persistent and cell JSON round trip preserves every element modulo array order", () => {
    const original = fixture();
    const { persistent, cells } = partitionLayout(original, ENABLED);
    const parsedLevel = JSON.parse(JSON.stringify(persistent)) as RoomLayout;
    const parsedCells = [...cells.values()].map((cell) => normalizeWorldCellDocument(JSON.parse(JSON.stringify(cell))));
    assert.deepEqual(canonicalize(mergeWorldCells(parsedLevel, parsedCells)), canonicalize(original));
  });

  check("world partition: merge appends cells in numeric order and creates missing instance groups", () => {
    const persistent: RoomLayout = {
      schema: 1, name: "append", loadGroups: [], characters: [],
      instances: [{ assetId: "existing", placements: [{ name: "persistent", position: [0, 0, 0] }] }],
      actors: [{ name: "persistent", classRef: "Actor_Test", position: [0, 0, 0] }],
    };
    const cells: WorldCellDocument[] = ["10_0", "2_0", "0_-1"].map((key) => ({
      schema: 1, type: "worldCell", grid: "main", key,
      instances: [
        { assetId: "existing", placements: [{ name: key, position: [0, 0, 0] }] },
        { assetId: `new:${key}`, placements: [{ name: key, position: [0, 0, 0] }] },
      ],
      actors: [{ name: key, classRef: "Actor_Test", position: [0, 0, 0] }],
      targetPoints: [{ id: key, position: [0, 0, 0] }],
    }));
    const before = structuredClone({ persistent, cells });
    // A generator ensures the merge accepts a one-shot iterable.
    const merged = mergeWorldCells(persistent, (function* () { yield* cells; })());
    assert.deepEqual(merged.actors?.map((p) => p.name), ["persistent", "0_-1", "2_0", "10_0"]);
    assert.deepEqual(merged.instances[0]?.placements.map((p) => p.name), ["persistent", "0_-1", "2_0", "10_0"]);
    assert.deepEqual(merged.instances.map((g) => g.assetId), ["existing", "new:0_-1", "new:2_0", "new:10_0"]);
    assert.deepEqual(merged.targetPoints?.map((p) => p.id), ["0_-1", "2_0", "10_0"]);
    assert.deepEqual({ persistent, cells }, before);
    merged.instances[1]!.placements[0]!.position[0] = 123;
    assert.deepEqual({ persistent, cells }, before);
    assert.deepEqual(mergeWorldCells(persistent, []), persistent);
  });

  check("world partition: cells preserve source instance group and placement order", () => {
    const layout: RoomLayout = {
      schema: 1, name: "groups", loadGroups: [], characters: [],
      instances: ["rock", "tree", "rock"].map((assetId, index) => ({
        assetId, placements: [{ name: String(index), position: [0, 0, 0] }],
      })),
    };
    const split = partitionLayout(layout, ENABLED);
    assert.deepEqual(split.persistent.instances.map((g) => g.assetId), ["rock", "tree", "rock"]);
    assert.ok(split.persistent.instances.every((g) => g.placements.length === 0));
    assert.deepEqual(split.cells.get("0_0")?.instances?.map((g) => [g.assetId, g.placements.map((p) => p.name)]), [
      ["rock", ["0"]], ["tree", ["1"]], ["rock", ["2"]],
    ]);
  });
}
