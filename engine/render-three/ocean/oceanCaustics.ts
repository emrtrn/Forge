import type { DataTexture, Object3D, Scene } from "three";
import type { OceanWaterBody } from "../../scene/oceanWater";
import type { OceanCoverage } from "../../terrain/oceanCoverage";
import { registerOceanCaustics } from "../terrain/terrainCaustics";

/** A registry lease only: the surface retains ownership of its exact coverage
 * texture. Release this binding before disposing the surface. */
export class OceanCausticsBinding {
  private binding: ReturnType<typeof registerOceanCaustics> | undefined;
  constructor(private readonly scene: Scene, private readonly coverage: OceanCoverage,
    private readonly texture: DataTexture, private readonly object: Object3D,
    private readonly clock: () => number) {}
  update(body: OceanWaterBody, allowed: boolean, replacing?: Object3D): void {
    if (!allowed || body.hidden || !body.caustics?.enabled || body.caustics.strength <= 0) {
      this.dispose(); return;
    }
    if (this.binding) this.binding.update(body);
    else this.binding = registerOceanCaustics(this.scene, body, this.coverage, this.texture, this.object, this.clock, replacing);
  }
  dispose(): void { this.binding?.dispose(); this.binding = undefined; }
}
