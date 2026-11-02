/** Ridgebound-owned adapter. Produces a new, schematic recipe; never merges an authored scene. */
import type { RoomLayout } from "../../engine/scene/layout";
import { isPlacementId } from "../../engine/scene/placementIdentity";
import { metricToWorld, gradePercentToDegrees, type MetricFrame } from "../../engine/worldbuilder/metricFrame";
import { isRecord, isFiniteNumber, WORLD_MAX_COORDINATE, type WorldPoint } from "../../engine/worldbuilder/normalize";
import { createWorldRecipe, normalizeWorldRecipe, type WorldRecipe } from "../../engine/worldbuilder/recipe";

export const RIDGEBOUND_ADAPTER_VERSION = 1;
export const RIDGEBOUND_SOURCE_ID = "1mM5MiOrvq0RRPoc2QNDQXtxk81wG0ZY9";
export const RIDGEBOUND_SOURCE_SHA256 = "72afa23b7264b2e6e419ca700511e1b61cbdb6178bdf18fe53eb91e8e5e7f09b";
export const RIDGEBOUND_LEVEL = "layouts/RidgeboundP0.level.json";
export const RIDGEBOUND_RECIPE = "layouts/RidgeboundP0.worldrecipe.json";
const ROOT_FIELDS = ["project", "version", "status", "supersedes", "scope", "decision_trace", "axes",
  "world_extent_m", "terrain", "hydrology", "nodes", "routes", "poi", "local_roads", "site_extent_m",
  "bridges", "crossing_reviews", "qa_requirements", "site_access_candidates"];
const POI_ROLES: Record<string, string> = {
  "POI-01": "residential.familyHome", "POI-02": "logistics.depot", "POI-03": "service.workshop",
  "POI-04": "social.cafe", "POI-05": "civic.school", "POI-06": "public.market", "POI-07": "logistics.delivery",
};

export interface RidgeboundImportReport {
  adapterVersion: number;
  source: { fileId: string; sha256: string; version: string; status: string };
  status: "SCHEMATIC_PREVIEW_NOT_TERRAIN_OR_DRIVING_ACCEPTANCE";
  frame: MetricFrame;
  sourceExtent: [number, number, number, number];
  checkpoints: Array<{ id: string; metric: WorldPoint; world: WorldPoint }>;
  route: { id: string; widthMetres: number; maxGradePercent: number; maxGradeDegrees: number };
  warnings: string[];
  deferredFields: string[];
  excludedIds: string[];
}
export interface RidgeboundPreview {
  recipe: WorldRecipe;
  level: RoomLayout;
  report: RidgeboundImportReport;
  svg: string;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path}: expected an object`);
  return value;
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512) throw new Error(`${path}: expected a short nonempty string`);
  return value;
}
function number(value: unknown, path: string): number {
  if (!isFiniteNumber(value) || Math.abs(value) > WORLD_MAX_COORDINATE) throw new Error(`${path}: expected finite metres`);
  return value;
}
function point(value: unknown, path: string, extent: readonly number[]): WorldPoint {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${path}: expected [east,north]`);
  const p: WorldPoint = [number(value[0], path), number(value[1], path)];
  if (p[0] < extent[0]! || p[0] > extent[1]! || p[1] < extent[2]! || p[1] > extent[3]!) throw new Error(`${path}: outside source extent`);
  return p;
}
function positive(value: unknown, path: string): number {
  const n = number(value, path);
  if (n <= 0) throw new Error(`${path}: expected a positive number`);
  return n;
}

/** Strict current-format read; unsupported source versions/fields fail before any output exists. */
export function buildRidgeboundPreview(value: unknown, sha256: string, frameOverride?: MetricFrame): RidgeboundPreview {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Expected SHA-256 of the exact source bytes");
  const source = record(value, "master");
  for (const key of Object.keys(source)) if (!ROOT_FIELDS.includes(key)) throw new Error(`master.${key}: unsupported root field; update the adapter explicitly`);
  if (source.project !== "Ridgebound" || source.version !== "0.2") throw new Error("Expected Ridgebound spatial master version 0.2");
  const status = text(source.status, "status");
  const axes = record(source.axes, "axes");
  if (axes.X !== "east_m" || axes.Y !== "north_m" || axes.Z !== "up_m_local_non_georeferenced") throw new Error("Unsupported axes/datum");
  if (!Array.isArray(source.world_extent_m) || source.world_extent_m.length !== 4) throw new Error("Expected world_extent_m [west,east,south,north]");
  const extent = source.world_extent_m.map((n, i) => number(n, `world_extent_m[${i}]`)) as [number, number, number, number];
  if (extent[0] >= extent[1] || extent[2] >= extent[3]) throw new Error("Source extent must have positive area");
  const frame = frameOverride ? { ...frameOverride } : { east: extent[0], north: extent[3], elevation: 0 };
  number(frame.elevation, "frame.elevation");
  metricToWorld([frame.east, frame.north], frame);
  const nodes = record(source.nodes, "nodes"), pois = record(source.poi, "poi"), routes = record(source.routes, "routes");
  const coordinates = new Map<string, WorldPoint>();
  for (const [id, raw] of Object.entries(nodes)) {
    if (!isPlacementId(id)) throw new Error(`nodes.${id}: invalid id`);
    coordinates.set(id, point(record(raw, `nodes.${id}`).xy, `nodes.${id}.xy`, extent));
  }
  const recipe = createWorldRecipe("ridgebound_p0", 0);
  recipe.generation.stages = ["planBlockout"];
  const checkpoints: RidgeboundImportReport["checkpoints"] = [];
  const checkpoint = (id: string, metric: WorldPoint): WorldPoint => {
    const world = metricToWorld(metric, frame);
    checkpoints.push({ id, metric: [...metric], world });
    return world;
  };
  for (const id of ["V0", "V1"]) {
    const xy = coordinates.get(id);
    if (!xy || record(nodes[id], id).kind !== "settlement") throw new Error(`Missing settlement ${id}`);
    const center = checkpoint(id, xy);
    recipe.plan.settlements.push({ id, source: "manual", center, type: "village", protected: true });
    recipe.plan.roadGraph.nodes.push({ id, source: "manual", position: [...center], kind: "end", settlement: id });
  }
  const bridge = record(record(source.bridges, "bridges").B1, "bridges.B1");
  if (bridge.node_id !== "B1" || bridge.road_id !== "R01" || bridge.crosses !== "H-01") throw new Error("B1 must remain the R01/H-01 crossing");
  const b1 = coordinates.get("B1");
  if (!b1) throw new Error("Missing B1 node");
  recipe.plan.landmarks.push({ id: "B1", source: "manual", kind: "infrastructure.bridge", position: checkpoint("B1", b1) });
  const route = record(routes.R01, "routes.R01");
  if (route.link !== "V0—V1") throw new Error("R01 must connect V0—V1");
  if (!Array.isArray(route.pts) || route.pts.length < 2 || route.pts.length > 5000) throw new Error("R01 needs 2..5000 points");
  const path = route.pts.map((p, i) => point(p, `routes.R01.pts[${i}]`, extent));
  const same = (a: WorldPoint, b: WorldPoint) => a[0] === b[0] && a[1] === b[1];
  if (!same(path[0]!, coordinates.get("V0")!) || !same(path.at(-1)!, coordinates.get("V1")!)) throw new Error("R01 endpoints do not match V0/V1");
  if (!path.some(p => same(p, b1))) throw new Error("R01 must include the B1 anchor");
  const width = positive(route.design_width_m, "R01.design_width_m");
  const grade = positive(route.target_max_abs_grade_percent, "R01.target_max_abs_grade_percent");
  recipe.plan.roadGraph.edges.push({ id: "R01", source: "manual", from: "V0", to: "V1", roadClass: "local",
    guide: path.map(p => metricToWorld(p, frame)) });
  const excludedIds = Object.keys(nodes).filter(id => !["V0", "V1", "B1"].includes(id));
  excludedIds.push(...Object.keys(routes).filter(id => id !== "R01"));
  for (const [id, raw] of Object.entries(pois)) {
    if (!isPlacementId(id)) throw new Error(`poi.${id}: invalid id`);
    const poi = record(raw, `poi.${id}`);
    const xy = point(poi.xy, `poi.${id}.xy`, extent);
    if (!POI_ROLES[id]) { excludedIds.push(id); continue; }
    recipe.plan.landmarks.push({ id, source: "manual", kind: POI_ROLES[id]!,
      position: checkpoint(id, xy), settlement: id === "POI-07" ? "V1" : "V0" });
  }
  const normalized = normalizeWorldRecipe(recipe);
  if (!normalized.recipe || normalized.issues.length) throw new Error(`Invalid converted recipe: ${normalized.issues.join("; ")}`);
  const warnings = [
    "SCHEMATIC ONLY: markers at y=0; no terrain, drivable road, bridge deck, collision or gameplay is generated.",
    "Plan source=manual means authored master data, not image observation. No confidence estimate was invented.",
    "Run only Plan blockout to inspect positions. Roads/settlement stages may reroute or generate a different layout.",
    "Protected settlement centres do not lock road geometry or authored POI footprints.",
    "Re-import into an edited recipe is not implemented. Generate a new review directory and compare; never replace an authored scene.",
  ];
  if (!Object.hasOwn(pois, "POI-07")) warnings.push("MISSING POI-07: V1 settlement centre is not a delivery bay; GPT must supply a candidate location/access/turning area.");
  if (sha256 !== RIDGEBOUND_SOURCE_SHA256) warnings.push("Source differs from the initial v0.2 snapshot; review source changes before using the new preview.");
  const report: RidgeboundImportReport = {
    adapterVersion: RIDGEBOUND_ADAPTER_VERSION,
    source: { fileId: RIDGEBOUND_SOURCE_ID, sha256, version: "0.2", status },
    status: "SCHEMATIC_PREVIEW_NOT_TERRAIN_OR_DRIVING_ACCEPTANCE", frame, sourceExtent: extent, checkpoints,
    route: { id: "R01", widthMetres: width, maxGradePercent: grade, maxGradeDegrees: gradePercentToDegrees(grade) },
    warnings, excludedIds: excludedIds.sort(),
    deferredFields: ["terrain: parameters/U16 not sampled", "hydrology: formulas are never evaluated",
      "routes: design width/grade reported only; no road elevation profiles or mesh", "bridges: deck/approach data not applied",
      "poi: building footprint/parcel/yard not generated", "site_access_candidates: entrances not generated",
      "local_roads", "site_extent_m", "crossing_reviews", "qa_requirements", "decision_trace", "scope", "supersedes"],
  };
  const level: RoomLayout = { schema: 1, name: "Ridgebound P0 — schematic positions only", loadGroups: [], instances: [], characters: [],
    lights: [{ id: "sun", type: "directional", position: [4, 8, 4], rotation: [-45, 30, 0], color: "#ffffff", intensity: 3, castShadow: false }],
    worldSettings: { backgroundColor: "#c9d8e8" } };
  return { recipe: normalized.recipe, level, report, svg: previewSvg(report, path.map(p => metricToWorld(p, frame))) };
}

const escapeXml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
function previewSvg(report: RidgeboundImportReport, path: WorldPoint[]): string {
  const points = [...report.checkpoints.map(c => c.world), ...path];
  const min = [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))];
  const max = [Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
  const scale = Math.min(1080 / Math.max(1, max[0]! - min[0]!), 500 / Math.max(1, max[1]! - min[1]!));
  const xy = (p: WorldPoint) => [100 + (p[0] - min[0]!) * scale, 180 + (p[1] - min[1]!) * scale];
  const lines = report.checkpoints.map((c, i) => {
    const p = xy(c.world);
    return `<g data-id="${escapeXml(c.id)}"><circle cx="${p[0]}" cy="${p[1]}" r="6" fill="${c.id === "B1" ? "#eab464" : "#80d8cf"}"/><path d="M ${p[0]} ${p[1]} L ${p[0]} ${p[1]! - 14 - (i % 3) * 18}" stroke="#dce6ed"/><text x="${p[0]! + 8}" y="${p[1]! - 14 - (i % 3) * 18}">${escapeXml(c.id)}</text></g>`;
  }).join("\n");
  const scaleLength = 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="900" viewBox="0 0 1280 900" role="img" aria-label="Ridgebound P0 schematic coordinate preview">
<style>text{font:16px system-ui,sans-serif;fill:#e4ecf2}.small{font-size:13px}.title{font-size:26px;font-weight:700}</style>
<rect width="1280" height="900" fill="#15232e"/><text x="50" y="55" class="title">RIDGEBOUND · V0–B1–V1 · P0</text>
<text x="50" y="90">Şematik konum önizlemesi · gerçek metre ölçeği · kuzey yukarı</text>
<text x="50" y="120">Arazi / yol yüzeyi / köprü / sürüş kabulü üretilmedi.</text>
<polyline data-id="R01" fill="none" stroke="#f5be72" stroke-width="4" points="${path.map(p => xy(p).join(",")).join(" ")}"/>${lines}
<path d="M 50 755 h ${scaleLength * scale}" stroke="#e4ecf2" stroke-width="3"/><text x="50" y="782">100 m</text>
<text x="50" y="820">${Object.hasOwn(Object.fromEntries(report.checkpoints.map(c => [c.id, true])), "POI-07") ? "POI-07: kaynakta aday konum mevcut; kabul verilmedi." : "EKSİK: POI-07 teslim cebi · V1 merkezi teslim noktası değildir."}</text>
<text x="50" y="850" class="small">Kaynak SHA-256: ${report.source.sha256}</text><text x="50" y="875" class="small">Kaynak durum: ${escapeXml(report.source.status)} · Adaptör v${report.adapterVersion}</text></svg>\n`;
}
