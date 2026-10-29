import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments } from "three";
import type { WorldPoint } from "@engine/worldbuilder/normalize";
import type { WorldRecipe } from "@engine/worldbuilder/recipe";

/** Core outline colour; the panel's layer swatch uses the same value. */
export const CORE_COLOR = 0xffd166;
/** Lines stand this far above the ground so they clear it between samples, metres. */
const LIFT = 0.6;
/** Ground samples along an outline edge, metres apart. */
const SAMPLE_STEP = 2;
/** Height of the post marking a settlement's centre, metres. */
const CENTRE_POST = 12;

/**
 * Viewport layer of a World Builder recipe's generated data (plan v0.4 T23/T36):
 * each settlement site's core as a line that follows the ground, and a post at
 * its centre. Drawn over the scene and never picked; editor-only, render-side:
 * it reads the recipe and the terrain height and changes neither.
 */
export class WorldBuilderRecipeOverlay {
  readonly group = new Group();

  constructor(private readonly sampleHeight: (x: number, z: number) => number | null) {
    this.group.name = "world-builder-recipe";
  }

  /** Replaces the drawn layer; returns how many cores it drew. */
  show(recipe: WorldRecipe | null): number {
    this.clear();
    if (!recipe) return 0;
    const values: number[] = [];
    let drawn = 0;
    for (const site of recipe.generated.sites) {
      if (!site.core || site.core.length < 3) continue;
      drawn += 1;
      this.loopLines(site.core, values);
      const ground = this.sampleHeight(site.center[0], site.center[1]) ?? 0;
      values.push(site.center[0], ground, site.center[1], site.center[0], ground + CENTRE_POST, site.center[1]);
    }
    if (values.length === 0) return drawn;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(values, 3));
    const lines = new LineSegments(geometry, new LineBasicMaterial({ color: CORE_COLOR, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 }));
    lines.renderOrder = 27;
    lines.raycast = () => {};
    this.group.add(lines);
    return drawn;
  }

  clear(): void {
    for (const child of [...this.group.children]) {
      const lines = child as LineSegments<BufferGeometry, LineBasicMaterial>;
      lines.geometry.dispose();
      lines.material.dispose();
      this.group.remove(child);
    }
  }

  /** Closed outline as line pieces at the ground's height, sampled every `SAMPLE_STEP` metres. */
  private loopLines(outline: readonly WorldPoint[], values: number[]): void {
    let previous: [number, number, number] | null = null;
    for (let index = 0; index < outline.length; index += 1) {
      const a = outline[index]!;
      const b = outline[(index + 1) % outline.length]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / SAMPLE_STEP));
      for (let step = previous ? 1 : 0; step <= steps; step += 1) {
        const x = a[0] + ((b[0] - a[0]) * step) / steps;
        const z = a[1] + ((b[1] - a[1]) * step) / steps;
        const point: [number, number, number] = [x, (this.sampleHeight(x, z) ?? 0) + LIFT, z];
        if (previous) values.push(...previous, ...point);
        previous = point;
      }
    }
  }
}
