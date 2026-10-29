import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from "three";
import type { WorldPoint } from "@engine/worldbuilder/normalize";
import type { PlanProvenance, WorldRecipe, WorldReference } from "@engine/worldbuilder/recipe";
import type { LandUse } from "@engine/worldbuilder/vocabulary";
import {
  LOW_CONFIDENCE,
  NO_RECIPE_LAYER_EDIT,
  type RecipeLayerCounts,
  type RecipeLayerEdit,
  type RecipeLayerOptions,
  type UnderlayState,
} from "@/editor/worldBuilderLayer";
import { planPoints, pointElement, type PlanElementKind } from "@/editor/worldBuilderPlanEdit";

/** Layer colours; the panel legend uses the same values. */
export const LAYER_COLORS = {
  core: 0xffd166,
  settlement: 0xffffff,
  road: 0xff9f43,
  water: 0x4aa3ff,
  region: 0x4fd1c5,
  landmark: 0xff8fab,
  lowConfidence: 0xff5c5c,
  protected: 0xb388ff,
  selected: 0x3dff9a,
  pad: 0xe0e0e0,
} as const;

export const LAND_USE_COLORS: Record<LandUse, number> = {
  residential: 0xf2a65a,
  commercial: 0x4a90e2,
  civic: 0x9b59b6,
  industrial: 0x7f8c8d,
  agricultural: 0xa3c86b,
  open: 0x6fcf97,
  transport: 0x34495e,
};
const UNASSIGNED_PARCEL = 0xbdbdbd;

/** Lines stand this far above the ground so they clear it between samples, metres. */
const LIFT = 0.6;
/** Ground samples along a line, metres apart. */
const SAMPLE_STEP = 2;
/** Dashed lines (inferred plan elements): dash and gap, metres. */
const DASH = 4;
const GAP = 3;
const CENTRE_POST = 12;
const NODE_POST = 4;
const MARK = 3;
/** Edit Plan handles: screen pixels, and how far above the ground they stand, metres. */
const HANDLE_SIZE = 9;
export const HANDLE_LIFT = LIFT;
/** The underlay lies this far above the ground it follows, metres. */
const UNDERLAY_LIFT = 0.3;
/** Underlay grid cell, metres, and the most cells along one side. */
const UNDERLAY_CELL = 4;
const UNDERLAY_MAX_SEGMENTS = 128;

type Style = { color: number; dashed: boolean };

/**
 * Viewport layer of a World Builder recipe (plan v0.4 T36, T23): the reference
 * image laid over the ground it covers (a grid of its own following the
 * terrain height — a flat plane floated above the ridges, hid below a low
 * camera and slid against the plan lines; the shared terrain shader is not
 * touched), the plan (settlements, road graph,
 * water, regions, landmarks — low-confidence elements red, inferred ones
 * dashed; protected regions as boxes; the element selected for a hand
 * correction in `LAYER_COLORS.selected`, and in Edit Plan mode a screen-sized
 * handle on every movable plan point) and the generated data (settlement cores, parcels by land use,
 * pads). Lines follow the ground; everything is drawn over the scene and never
 * picked. Editor-only and render-side: it reads the recipe and the terrain
 * height and changes neither.
 */
export class WorldBuilderRecipeOverlay {
  readonly group = new Group();
  private readonly loader = new TextureLoader();
  private texture: { path: string; texture: Texture | null; failed: boolean } | null = null;
  private last: { recipe: WorldRecipe | null; options: RecipeLayerOptions; edit: RecipeLayerEdit } | null = null;

  constructor(
    private readonly sampleHeight: (x: number, z: number) => number | null,
    private readonly imageUrl: (path: string) => string,
    /** Called when an underlay image finished loading (or failed) after `show`. */
    private readonly onUnderlayChanged: (counts: RecipeLayerCounts) => void,
  ) {
    this.group.name = "world-builder-recipe";
  }

  /** Replaces the drawn layer. */
  show(recipe: WorldRecipe | null, options: RecipeLayerOptions, edit: RecipeLayerEdit = NO_RECIPE_LAYER_EDIT): RecipeLayerCounts {
    this.clear();
    this.last = { recipe, options, edit };
    const { selection } = edit;
    const counts: RecipeLayerCounts = { underlay: "none", plan: 0, lowConfidence: 0, cores: 0, parcels: 0, pads: 0 };
    if (!recipe) return counts;
    counts.underlay = this.underlay(recipe.reference, options);
    const batches = new Map<string, { style: Style; values: number[] }>();
    const batch = (style: Style) => {
      const key = `${style.color}:${style.dashed}`;
      let entry = batches.get(key);
      if (!entry) {
        entry = { style, values: [] };
        batches.set(key, entry);
      }
      return entry.values;
    };
    if (options.plan) this.drawPlan(recipe, selection, counts, batch);
    if (options.generated) this.drawGenerated(recipe, counts, batch);
    for (const { style, values } of batches.values()) {
      if (values.length === 0) continue;
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(values, 3));
      const lines = new LineSegments(geometry, new LineBasicMaterial({ color: style.color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 }));
      lines.renderOrder = 27;
      lines.raycast = () => {};
      this.group.add(lines);
    }
    if (options.plan && edit.handles) this.drawHandles(recipe, selection);
    return counts;
  }

  clear(): void {
    for (const child of [...this.group.children]) {
      const drawable = child as LineSegments<BufferGeometry, LineBasicMaterial> | Mesh<BufferGeometry, MeshBasicMaterial> | Points<BufferGeometry, PointsMaterial>;
      drawable.geometry.dispose();
      drawable.material.dispose();
      this.group.remove(child);
    }
  }

  private drawPlan(recipe: WorldRecipe, selection: RecipeLayerEdit["selection"], counts: RecipeLayerCounts, batch: (style: Style) => number[]): void {
    const style = (element: PlanProvenance, color: number, kind?: PlanElementKind, id?: string): Style => {
      counts.plan += 1;
      const low = element.confidence !== undefined && element.confidence < LOW_CONFIDENCE;
      if (low) counts.lowConfidence += 1;
      if (kind && selection?.kind === kind && selection.id === id) return { color: LAYER_COLORS.selected, dashed: false };
      return { color: low ? LAYER_COLORS.lowConfidence : color, dashed: element.observed === false };
    };
    const { plan } = recipe;
    for (const region of plan.regions) {
      const look = style(region, LAYER_COLORS.region);
      this.loop(region.polygon, batch(look), look.dashed);
    }
    for (const water of plan.water) {
      const look = style(water, LAYER_COLORS.water);
      if (water.path) this.line(water.path, batch(look), look.dashed);
      if (water.polygon) this.loop(water.polygon, batch(look), look.dashed);
    }
    for (const landmark of plan.landmarks) {
      const values = batch(style(landmark, LAYER_COLORS.landmark, "landmark", landmark.id));
      this.post(landmark.position, CENTRE_POST * 0.6, values);
      this.cross(landmark.position, MARK, values);
    }
    for (const settlement of plan.settlements) {
      const look = style(settlement, LAYER_COLORS.settlement, "settlement", settlement.id);
      const values = batch(look);
      this.cross(settlement.center, 2 * MARK, values);
      if (settlement.radius !== undefined) this.loop(circle(settlement.center, settlement.radius), values, look.dashed);
      if (settlement.boundary) this.loop(settlement.boundary, values, look.dashed);
    }
    const nodes = new Map(plan.roadGraph.nodes.map((node) => [node.id, node] as const));
    for (const node of plan.roadGraph.nodes) this.post(node.position, NODE_POST, batch(style(node, LAYER_COLORS.road, "node", node.id)));
    for (const edge of plan.roadGraph.edges) {
      const from = nodes.get(edge.from);
      const to = nodes.get(edge.to);
      if (!from || !to) continue;
      const look = style(edge, LAYER_COLORS.road, "edge", edge.id);
      this.line([from.position, ...(edge.guide ?? []), to.position], batch(look), look.dashed);
      for (const point of edge.guide ?? []) this.cross(point, MARK * 0.5, batch(look));
    }
    // Ownership, not plan: drawn with it and not counted as a plan element.
    for (const region of recipe.ownership.protectedRegions) {
      const selected = selection?.kind === "protected" && selection.id === region.id;
      const [x0, z0] = region.min;
      const [x1, z1] = region.max;
      this.loop([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], batch({ color: selected ? LAYER_COLORS.selected : LAYER_COLORS.protected, dashed: !selected }), !selected);
    }
  }

  private drawHandles(recipe: WorldRecipe, selection: RecipeLayerEdit["selection"]): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const tint = new Color();
    for (const { ref, point } of planPoints(recipe)) {
      const element = pointElement(ref);
      positions.push(point[0], (this.sampleHeight(point[0], point[1]) ?? 0) + HANDLE_LIFT, point[1]);
      tint.setHex(selection?.kind === element.kind && selection.id === element.id ? LAYER_COLORS.selected : 0xffffff);
      colors.push(tint.r, tint.g, tint.b);
    }
    if (positions.length === 0) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    const handles = new Points(geometry, new PointsMaterial({
      size: HANDLE_SIZE, sizeAttenuation: false, vertexColors: true, depthTest: false, depthWrite: false, transparent: true,
    }));
    handles.name = "world-builder-plan-handles";
    handles.renderOrder = 28;
    handles.raycast = () => {};
    this.group.add(handles);
  }

  private drawGenerated(recipe: WorldRecipe, counts: RecipeLayerCounts, batch: (style: Style) => number[]): void {
    const solid = (color: number) => batch({ color, dashed: false });
    for (const site of recipe.generated.sites) {
      if (!site.core || site.core.length < 3) continue;
      counts.cores += 1;
      this.loop(site.core, solid(LAYER_COLORS.core), false);
      this.post(site.center, CENTRE_POST, solid(LAYER_COLORS.core));
    }
    for (const parcel of recipe.generated.parcels) {
      counts.parcels += 1;
      this.loop(parcel.polygon, solid(parcel.landUse ? LAND_USE_COLORS[parcel.landUse] : UNASSIGNED_PARCEL), false);
    }
    for (const pad of recipe.generated.pads) {
      counts.pads += 1;
      this.loop(pad.polygon, solid(LAYER_COLORS.pad), false);
    }
  }

  // ---------------------------------------------------------------- underlay

  private underlay(reference: WorldReference | undefined, options: RecipeLayerOptions): UnderlayState {
    if (!reference?.image) return "none";
    if (!options.underlay) return "hidden";
    if (reference.view === "perspective") return "perspective";
    if (this.texture?.path !== reference.image) {
      const path = reference.image;
      const entry: { path: string; texture: Texture | null; failed: boolean } = { path, texture: null, failed: false };
      this.texture?.texture?.dispose();
      this.texture = entry;
      this.loader.load(
        this.imageUrl(path),
        (texture) => {
          texture.colorSpace = SRGBColorSpace;
          if (this.texture !== entry) {
            texture.dispose();
            return;
          }
          entry.texture = texture;
          this.redraw();
        },
        undefined,
        () => {
          if (this.texture !== entry) return;
          entry.failed = true;
          this.redraw();
        },
      );
      return "loading";
    }
    if (this.texture.failed) return "error";
    if (!this.texture.texture) return "loading";
    const [width, depth] = reference.size;
    const columns = Math.max(1, Math.min(UNDERLAY_MAX_SEGMENTS, Math.round(width / UNDERLAY_CELL)));
    const rows = Math.max(1, Math.min(UNDERLAY_MAX_SEGMENTS, Math.round(depth / UNDERLAY_CELL)));
    // Plane in XY, laid onto XZ: its top edge (the image's top row) goes to −Z, the reference's origin side.
    const geometry = new PlaneGeometry(width, depth, columns, rows);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(reference.origin[0] + width / 2, 0, reference.origin[1] + depth / 2);
    // Each grid corner takes the ground's height; off the terrain it keeps the lowest known one.
    const position = geometry.getAttribute("position");
    const heights = new Array<number | null>(position.count);
    let lowest = Infinity;
    for (let index = 0; index < position.count; index += 1) {
      heights[index] = this.sampleHeight(position.getX(index), position.getZ(index));
      if (heights[index] !== null) lowest = Math.min(lowest, heights[index]!);
    }
    for (let index = 0; index < position.count; index += 1) {
      position.setY(index, (heights[index] ?? (Number.isFinite(lowest) ? lowest : 0)) + UNDERLAY_LIFT);
    }
    position.needsUpdate = true;
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, new MeshBasicMaterial({
      map: this.texture.texture, transparent: true, opacity: options.opacity, depthTest: false, depthWrite: false, side: DoubleSide,
    }));
    mesh.renderOrder = 26;
    mesh.raycast = () => {};
    this.group.add(mesh);
    return "shown";
  }

  private redraw(): void {
    if (!this.last) return;
    this.onUnderlayChanged(this.show(this.last.recipe, this.last.options, this.last.edit));
  }

  // ---------------------------------------------------------------- lines on the ground

  private loop(points: readonly WorldPoint[], values: number[], dashed: boolean): void {
    if (points.length < 2) return;
    this.line([...points, points[0]!], values, dashed);
  }

  /** A polyline as line pieces at the ground's height, sampled every `SAMPLE_STEP` metres; dashed skips the gaps. */
  private line(points: readonly WorldPoint[], values: number[], dashed: boolean): void {
    let previous: [number, number, number] | null = null;
    let travelled = 0;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1]!;
      const b = points[index]!;
      const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(span / SAMPLE_STEP));
      for (let step = previous ? 1 : 0; step <= steps; step += 1) {
        const x = a[0] + ((b[0] - a[0]) * step) / steps;
        const z = a[1] + ((b[1] - a[1]) * step) / steps;
        const point: [number, number, number] = [x, (this.sampleHeight(x, z) ?? 0) + LIFT, z];
        if (previous && (!dashed || travelled % (DASH + GAP) < DASH)) values.push(...previous, ...point);
        if (previous) travelled += span / steps;
        previous = point;
      }
    }
  }

  private post([x, z]: WorldPoint, height: number, values: number[]): void {
    const ground = this.sampleHeight(x, z) ?? 0;
    values.push(x, ground, z, x, ground + height, z);
  }

  private cross([x, z]: WorldPoint, arm: number, values: number[]): void {
    const y = (this.sampleHeight(x, z) ?? 0) + LIFT;
    values.push(x - arm, y, z, x + arm, y, z, x, y, z - arm, x, y, z + arm);
  }
}

function circle(center: WorldPoint, radius: number): WorldPoint[] {
  const sides = Math.max(24, Math.min(96, Math.round(radius / 3)));
  return Array.from({ length: sides }, (_, index): WorldPoint => {
    const angle = (2 * Math.PI * index) / sides;
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius];
  });
}
