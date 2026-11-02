/** Offline review only: reads source/public terrain and writes a fresh report package under output/ridgebound. */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { rectangle, rectangleOverlap, rectangleSegmentDistance, clipSegment, terrainRectangleStats, terrainSegmentProfile } from "./siteReview.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE02 = "72afa23b7264b2e6e419ca700511e1b61cbdb6178bdf18fe53eb91e8e5e7f09b";
const SOURCE03 = "04bf826f5a11724ee15995c482e45abdc3928564f52b2f91d6361c6db9b2c80a";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
const toWorld = ([x, north]) => [x, 6000 - north];
const boxToWorld = box => ({ min: toWorld([box.min[0], box.max[1]]), max: toWorld([box.max[0], box.min[1]]) });
const r = n => n === null || n === undefined ? null : Math.round(n * 1000) / 1000;

async function main() {
  const args = process.argv.slice(2), options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--source", "--out"].includes(args[i]) || !args[i + 1] || options.has(args[i])) throw Error("Expected --source <v0.3.json> [--out output/ridgebound/<new-folder>]");
    options.set(args[i], args[i + 1]);
  }
  if (!options.has("--source")) throw Error("--source is required; no source is inferred from a concept image");
  const sourceBytes = await readFile(resolve(options.get("--source")));
  if (sourceBytes.length > 2 * 1024 * 1024 || hash(sourceBytes) !== SOURCE03) throw Error("v0.3 source hash mismatch; update this review adapter explicitly");
  const baseBytes = await readFile(join(root, "tests/engine/fixtures/ridgebound-spatial-master-v0.2.json"));
  if (hash(baseBytes) !== SOURCE02) throw Error("v0.2 baseline hash mismatch");
  const base = JSON.parse(baseBytes), source = JSON.parse(sourceBytes), fabric = source.settlement_fabric;
  const changedRootFields = [...new Set([...Object.keys(base), ...Object.keys(source)])].filter(key => !isDeepStrictEqual(base[key], source[key]));
  const allowedChanges = ["version", "status", "supersedes", "scope", "source_v0_2_master_sha256", "source_v0_2_site_svg_sha256", "settlement_fabric"];
  if (changedRootFields.some(key => !allowedChanges.includes(key)) || source.source_v0_2_master_sha256 !== SOURCE02) throw Error("Inherited master geometry changed; review stopped");
  if (fabric.residences.length !== 24 || fabric.outbuildings.length !== 12 || fabric.neighborhoods.length !== 4) throw Error("Unexpected fabric counts");
  const structures = [...fabric.residences, ...fabric.outbuildings];
  const ids = new Set(structures.map(b => b.id));
  if (ids.size !== 36) throw Error("Duplicate fabric id");
  for (const building of structures) {
    if (!/^RES-\d{3}$|^OUT-\d{3}$/.test(building.id)
      || !Array.isArray(building.xy_m) || building.xy_m.length !== 2 || building.xy_m.some(v => !Number.isFinite(v) || v < 0 || v > 6000)
      || !Array.isArray(building.building_footprint_candidate_wh_m) || building.building_footprint_candidate_wh_m.length !== 2
      || building.building_footprint_candidate_wh_m.some(v => !Number.isFinite(v) || v <= 0)
      || !fabric.neighborhoods.some(n => n.id === building.quarter_id)
      || (building.residence_id && !fabric.residences.some(h => h.id === building.residence_id))) throw Error("Invalid fabric structure " + building.id);
  }
  const bundle = await build({ absWorkingDir: root, tsconfig: join(root, "tsconfig.json"), bundle: true, format: "esm", platform: "node", write: false,
    stdin: { contents: 'export {decodeTerrainTile} from "./engine/terrain/terrainTileCodec"; export {terrainHeightAt,terrainFaceNormalAt} from "./engine/terrain/terrainHeightQuery"; export {terrainTilePath} from "./engine/terrain/terrainTypes";', resolveDir: root, loader: "ts" } });
  const { decodeTerrainTile, terrainHeightAt, terrainFaceNormalAt, terrainTilePath } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
  const terrainFiles = {};
  async function loadTerrain(name) {
    const ref = `layouts/${name}.landscapes/pilot.terrain.json`;
    const bytes = await readFile(join(root, "public", ref)), def = JSON.parse(bytes), tiles = new Map();
    terrainFiles[ref] = hash(bytes);
    for (const item of def.tiles) {
      const path = terrainTilePath(ref, item.key), bytes = await readFile(join(root, "public", path));
      tiles.set(item.key, decodeTerrainTile(bytes)); terrainFiles[path] = hash(bytes);
    }
    if (tiles.size !== def.tilesX * def.tilesZ) throw Error("Incomplete terrain " + name);
    const lookup = { tile: (x, z) => tiles.get(`${x}_${z}`) };
    const grid = { min: [def.origin[0], def.origin[2]], max: [def.origin[0] + def.tilesX * def.tileQuads * def.spacing, def.origin[2] + def.tilesZ * def.tileQuads * def.spacing],
      spacing: def.spacing, width: def.tilesX * def.tileQuads + 1, height: def.tilesZ * def.tileQuads + 1,
      vertex: (ix, iz) => {
        const tx = Math.min(Math.floor(ix / def.tileQuads), def.tilesX - 1), tz = Math.min(Math.floor(iz / def.tileQuads), def.tilesZ - 1);
        const tile = tiles.get(`${tx}_${tz}`);
        return def.origin[1] + tile.heights[(iz - tz * def.tileQuads) * tile.size + ix - tx * def.tileQuads];
      } };
    return { name, def, grid, at: point => terrainHeightAt(def, lookup, ...toWorld(point)),
      gradeAt: point => { const n = terrainFaceNormalAt(def, lookup, ...toWorld(point)); return n ? Math.hypot(n[0], n[2]) / n[1] * 100 : null; },
      stats: box => terrainRectangleStats(boxToWorld(box), grid),
      profile: (a, b) => terrainSegmentProfile(toWorld(a), toWorld(b), grid, (x, z) => terrainHeightAt(def, lookup, x, z)) };
  }
  const p1 = await loadTerrain("RidgeboundP1"), relief = await loadTerrain("RidgeboundReliefA");
  const roads = [ ...Object.entries(source.routes).map(([id, route]) => ({ id, points: route.pts, width: route.design_width_m ?? null, kind: "route" })),
    ...Object.entries(source.local_roads).map(([id, points]) => ({ id, points, width: null, kind: "local" })) ];
  const poi = Object.entries(source.poi).map(([id, p]) => ({ id, ...p, parcel: rectangle(p.xy, p.parcel_wh_m),
    footprint: p.building_footprint_candidate_wh_m ? rectangle(p.xy, p.building_footprint_candidate_wh_m) : null }));
  const boxes = structures.map(b => ({ id: b.id, footprint: rectangle(b.xy_m, b.building_footprint_candidate_wh_m) }));
  function nearestRoad(box) {
    const candidates = [];
    for (const road of roads) for (let i = 1; i < road.points.length; i++) candidates.push({ road, segment: i - 1, ...rectangleSegmentDistance(box, road.points[i - 1], road.points[i]) });
    return candidates.sort((a, b) => a.distance - b.distance)[0];
  }
  const school = poi.find(p => p.id === "POI-05"), schoolEntry = source.site_access_candidates["POI-05"].pedestrian_entrance_xy;
  const serviceProxyRoads = new Set(["İşletme kolu", "Depo girişi", "R03", "R03 → J1"]);
  function crossingRoads(a, b) {
    const crossings = [];
    for (const road of roads.filter(r => serviceProxyRoads.has(r.id))) for (let i = 1; i < road.points.length; i++) {
      // A very thin rectangle around each endpoint is not used: segment/segment orientation is exact in 2D.
      const c = road.points[i - 1], d = road.points[i], ab = [b[0] - a[0], b[1] - a[1]], cd = [d[0] - c[0], d[1] - c[1]];
      const det = ab[0] * cd[1] - ab[1] * cd[0];
      if (Math.abs(det) < 1e-10) continue;
      const ac = [c[0] - a[0], c[1] - a[1]];
      const t = (ac[0] * cd[1] - ac[1] * cd[0]) / det, u = (ac[0] * ab[1] - ac[1] * ab[0]) / det;
      if (t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u <= 1) crossings.push(road.id);
    }
    return [...new Set(crossings)];
  }
  const rows = structures.map(building => {
    const footprint = rectangle(building.xy_m, building.building_footprint_candidate_wh_m), pad = rectangle(building.xy_m, building.building_footprint_candidate_wh_m, 2);
    const nearest = nearestRoad(footprint);
    const accessBlocks = [...boxes.filter(b => b.id !== building.id).map(b => ({ id: b.id, box: b.footprint })), ...poi.filter(p => p.footprint).map(p => ({ id: p.id, box: p.footprint }))]
      .filter(b => { const hit = clipSegment(nearest.onFootprint, nearest.onRoad, b.box); return hit && hit.hi > hit.lo + 1e-8; }).map(b => b.id);
    const terrain = t => ({ centerHeight: t.at(building.xy_m), centerGradePercent: t.gradeAt(building.xy_m), footprint: t.stats(footprint), diagnosticPad: t.stats(pad) });
    const p1Stats = terrain(p1), reliefStats = terrain(relief);
    if ([p1Stats, reliefStats].some(t => t.centerHeight === null || !t.footprint || !t.diagnosticPad)) throw Error("Structure/pad outside saved terrain: " + building.id);
    const overlaps = boxes.filter(b => b.id !== building.id && rectangleOverlap(footprint, b.footprint)).map(b => b.id);
    const poiBuildingOverlaps = poi.filter(p => p.footprint && rectangleOverlap(footprint, p.footprint)).map(p => p.id);
    const parcelOverlaps = poi.filter(p => rectangleOverlap(footprint, p.parcel)).map(p => p.id);
    const roadContacts = roads.filter(road => road.points.some((point, i) => i > 0 && rectangleSegmentDistance(footprint, road.points[i - 1], point).distance <= (road.width === null ? 0 : road.width / 2)))
      .map(road => ({ id: road.id, widthKnown: road.width !== null }));
    const ownSchoolLine = clipSegment(...[building.xy_m, schoolEntry], school.parcel);
    const schoolRoute = building.id.startsWith("RES-") ? { kind: "STRAIGHT_LINE_DIAGNOSTIC_NOT_AN_AUTHORED_PATH", to: schoolEntry,
      serviceProxyCrossings: crossingRoads(building.xy_m, schoolEntry),
      otherBuildingCrossings: boxes.filter(b => b.id !== building.id).filter(b => { const hit = clipSegment(building.xy_m, schoolEntry, b.footprint); return hit && hit.hi > hit.lo + 1e-8; }).map(b => b.id),
      schoolParcelReached: Boolean(ownSchoolLine), p1Profile: p1.profile(building.xy_m, schoolEntry), reliefAProfile: relief.profile(building.xy_m, schoolEntry) } : null;
    return { id: building.id, kind: building.kind, quarter: building.quarter_id, sourceXY: building.xy_m, worldXZ: toWorld(building.xy_m), size: building.building_footprint_candidate_wh_m,
      p1: p1Stats, reliefA: reliefStats, centerDelta: reliefStats.centerHeight - p1Stats.centerHeight,
      sourceAnalyticHeight: building.center_terrain_z_m ?? null,
      p1MinusSourceAnalyticHeight: building.center_terrain_z_m === undefined ? null : p1Stats.centerHeight - building.center_terrain_z_m,
      footprintOverlaps: overlaps, poiBuildingOverlaps, poiParcelOverlaps: parcelOverlaps, roadContacts,
      diagnosticPadPoiParcelOverlaps: poi.filter(p => rectangleOverlap(pad, p.parcel)).map(p => p.id),
      access: { kind: "SHORTEST_FOOTPRINT_TO_RECORDED_CENTERLINE_DIAGNOSTIC_NOT_AN_AUTHORED_PATH", nearestRecordedRoad: nearest.road.id,
        distanceToCenterline: nearest.distance, roadWidth: nearest.road.width,
        clearanceToRoadEdge: nearest.road.width === null ? null : nearest.distance - nearest.road.width / 2,
        from: nearest.onFootprint, to: nearest.onRoad, buildingBlockers: accessBlocks,
        schoolParcelCrossing: Boolean(clipSegment(nearest.onFootprint, nearest.onRoad, school.parcel)),
        serviceProxyCrossings: crossingRoads(nearest.onFootprint, nearest.onRoad),
        sourceClaimedRoadEdgeDistance: building.distance_to_existing_road_edge_m ?? null,
        p1Profile: p1.profile(nearest.onFootprint, nearest.onRoad), reliefAProfile: relief.profile(nearest.onFootprint, nearest.onRoad) }, schoolRoute };
  });
  const schoolConflicts = roads.flatMap(road => road.points.slice(1).flatMap((b, i) => {
    const a = road.points[i], parcelHit = clipSegment(a, b, school.parcel), buildingHit = school.footprint ? clipSegment(a, b, school.footprint) : null;
    return parcelHit && parcelHit.hi > parcelHit.lo + 1e-8 ? [{ road: road.id, segment: i, widthKnown: road.width !== null,
      intersectsSchoolParcelCenterline: true, intersectsSchoolFootprintCenterline: Boolean(buildingHit),
      schoolFootprintRoadEdgeClearance: road.width === null || !school.footprint ? null : rectangleSegmentDistance(school.footprint, a, b).distance - road.width / 2 }] : [];
  }));
  const summaryFor = buildings => ({ count: buildings.length,
    changedCenterCount: buildings.filter(b => Math.abs(b.centerDelta) > 0.02).length,
    centerDeltaOverOneMetre: buildings.filter(b => Math.abs(b.centerDelta) > 1).map(b => b.id),
    minCenterDelta: Math.min(...buildings.map(b => b.centerDelta)), maxCenterDelta: Math.max(...buildings.map(b => b.centerDelta)),
    maxP1PadSpread: Math.max(...buildings.map(b => b.p1.diagnosticPad?.heightSpread ?? NaN)),
    maxReliefPadSpread: Math.max(...buildings.map(b => b.reliefA.diagnosticPad?.heightSpread ?? NaN)),
    reliefPadGradeOver22Percent: buildings.filter(b => b.reliefA.diagnosticPad?.maxGradePercent > 22).map(b => b.id),
    poiParcelOverlaps: buildings.filter(b => b.poiParcelOverlaps.length).map(b => ({ id: b.id, poi: b.poiParcelOverlaps })),
    buildingOverlaps: buildings.filter(b => b.footprintOverlaps.length || b.poiBuildingOverlaps.length).map(b => b.id),
    roadContacts: buildings.filter(b => b.roadContacts.length).map(b => ({ id: b.id, roads: b.roadContacts })),
    accessBuildingBlockers: buildings.filter(b => b.access.buildingBlockers.length).map(b => ({ id: b.id, blockers: b.access.buildingBlockers })),
    schoolLinesWithServiceCrossings: buildings.filter(b => b.schoolRoute?.serviceProxyCrossings.length).map(b => b.id) });
  const report = { status: "READ_ONLY_REVIEW_NOT_SPATIAL_OR_FORGE_PRODUCT_ACCEPTANCE", source03: { driveId: "15p_t0wLbF5qS1TVARVOwBN0slahpuIgq", sha256: SOURCE03 },
    source02: { sha256: SOURCE02 }, changedRootFields, inheritedGeometryIdentical: true,
    schema: { reviewSupportOnly: true, existingImporterNotModified: true, newPoiCount: 0, missingForApplication: ["house parcel boundaries", "authored rotations", "entrances and connection paths", "pad target elevations", "outbuilding final roles", "local road widths"] },
    assumptions: { axisAlignedFootprints: true, diagnosticPadMarginM: 2, changedCenterEpsilonM: 0.02, centerDeltaReviewThresholdM: 1,
      gradeReviewThresholdPercent: 22, serviceProxyRoadIds: [...serviceProxyRoads],
      note: "Thresholds and straight-line links are diagnostic proposals, not design approval, road access or safe pedestrian paths. All terrain queries use actual saved 6 m triangles; no 1 m detail is inferred." },
    terrainFiles, summary: { residences: summaryFor(rows.filter(b => b.id.startsWith("RES-"))), outbuildings: summaryFor(rows.filter(b => b.id.startsWith("OUT-"))) }, schoolConflicts, buildings: rows };
  if (!options.has("--out")) { console.log(json(report)); return; }
  const out = resolve(options.get("--out")), parent = join(root, "output/ridgebound");
  if (dirname(out) !== parent || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(out.slice(parent.length + 1))) throw Error("--out must be a new folder directly under output/ridgebound");
  await mkdir(parent, { recursive: true });
  if (await realpath(parent) !== parent) throw Error("Output parent cannot be linked");
  await mkdir(out);
  await writeFile(join(out, "review.json"), json(report), { flag: "wx" });
  const columns = ["id", "quarter", "x", "north", "p1_height_m", "relief_height_m", "delta_m", "p1_footprint_spread_m", "relief_footprint_spread_m", "p1_pad_spread_m", "relief_pad_spread_m", "p1_pad_max_grade_percent", "relief_pad_max_grade_percent", "nearest_road", "centerline_to_footprint_m", "poi_parcel_overlaps", "access_building_blockers", "school_service_line_crossings"];
  const csvCell = v => '"' + String(v ?? "").replaceAll('"', '""') + '"';
  const csv = [columns, ...rows.map(b => [b.id,b.quarter,...b.sourceXY,r(b.p1.centerHeight),r(b.reliefA.centerHeight),r(b.centerDelta),r(b.p1.footprint?.heightSpread),r(b.reliefA.footprint?.heightSpread),r(b.p1.diagnosticPad?.heightSpread),r(b.reliefA.diagnosticPad?.heightSpread),r(b.p1.diagnosticPad?.maxGradePercent),r(b.reliefA.diagnosticPad?.maxGradePercent),b.access.nearestRecordedRoad,r(b.access.distanceToCenterline),b.poiParcelOverlaps.join(";"),b.access.buildingBlockers.join(";"),b.schoolRoute?.serviceProxyCrossings.join(";")])].map(row => row.map(csvCell).join(",")).join("\n") + "\n";
  await writeFile(join(out,"buildings.csv"),"\ufeff" + csv,{flag:"wx"});
  await writeFile(join(out,"preview.svg"), previewSvg(report, roads, poi, p1, relief),{flag:"wx"});
  console.log(json({ output: out, inheritedGeometryIdentical: true, summary: report.summary, schoolConflicts }));
}

function previewSvg(report, roads, poi, p1, relief) {
  const esc = s => String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
  const range = { min: [3600, 780], max: [4320, 1740] }, scale = 0.65, height = 624, width = 468;
  const x = v => (v - range.min[0]) * scale, y = v => (range.max[1] - v) * scale;
  const rect = (box, attrs) => `<rect x="${x(box.min[0])}" y="${y(box.max[1])}" width="${(box.max[0]-box.min[0])*scale}" height="${(box.max[1]-box.min[1])*scale}" ${attrs}/>`;
  const panels = [p1, relief].map((terrain, panel) => {
    const background = [];
    for(let north=range.min[1];north<range.max[1];north+=12)for(let east=range.min[0];east<range.max[0];east+=12){
      const h=terrain.at([east+6,north+6]),t=Math.max(0,Math.min(1,((h??200)-180)/250));
      background.push(rect({min:[east,north],max:[east+12,north+12]},`fill="hsl(${110-t*70} 28% ${91-t*29}%)"`));
    }
    return `<g transform="translate(${32+panel*520},100)"><text x="0" y="-20" font-size="22">${panel===0?"P1 / kaynak arazi":"Relief A / arazi adayı"}</text><g clip-path="url(#mapclip)">${background.join("")}
      ${roads.map(road=>`<polyline points="${road.points.map(p=>`${x(p[0])},${y(p[1])}`).join(" ")}" fill="none" stroke="${report.assumptions.serviceProxyRoadIds.includes(road.id)?"#a25b55":"#7b7b78"}" stroke-width="${road.width===null?1.3:road.width*scale}"/>`).join("")}
      ${poi.map(p=>rect(p.parcel,`fill="none" stroke="#4c5591" stroke-dasharray="4 3"`)+`<text x="${x(p.xy[0])+3}" y="${y(p.xy[1])-9}" fill="#283b70" font-size="11">${esc(p.id)}</text>`).join("")}
      ${report.buildings.map(b=>{const box=rectangle(b.sourceXY,b.size),color=panel===0?"#376a90":b.centerDelta>10?"#b52b38":b.centerDelta>1?"#df8a15":"#237f56";return `<g><title>${esc(b.id)}; kot farkı ${r(b.centerDelta)} m; temel alanı kot aralığı ${r(b[panel===0?"p1":"reliefA"].diagnosticPad?.heightSpread)} m</title>${rect(box,`fill="${color}" stroke="#fff" stroke-width="0.8"`)}${b.id.startsWith("RES-")?`<text x="${x(b.sourceXY[0])+6}" y="${y(b.sourceXY[1])+3}" font-size="10" fill="#263133">R${Number(b.id.slice(4))}</text>`:""}</g>`}).join("")}
      </g><rect width="${width}" height="${height}" fill="none" stroke="#a8afb3"/><text y="${height+27}" font-size="13">Kuzey yukarı; 6 m arazi ızgarası; iki panelde konumlar aynı.</text></g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="850" viewBox="0 0 1080 850"><defs><clipPath id="mapclip"><rect width="${width}" height="${height}"/></clipPath></defs><rect width="1080" height="850" fill="#f5f5f0"/><g font-family="Arial,sans-serif" fill="#23313b"><text x="32" y="34" font-size="25">Ridgebound v0.3 / konut–arazi karşılaştırması</text><text x="32" y="61" font-size="14">İnceleme: kutular yapı ayak izi adayı; kesik kutular POI parselleri; yollar kayıtlı plan çizgileridir.</text>${panels.join("")}<text x="32" y="790" font-size="14">Relief A merkez kot farkı: yeşil ≤1 m / turuncu 1–10 m / kırmızı &gt;10 m. R = konut; küçük kutu = müştemilat.</text><text x="32" y="817" font-size="14">Zemin rengi kotu gösterir. Eksenlere paralel ayak izi varsayımıdır. Forge sahnesine yapı/yol/temel eklenmedi.</text></g></svg>`;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
