import type { ResolvedWind } from "./wind";
import { PUDDLE_WIND_DEFAULTS, type PuddleWindSettings } from "../scene/puddleWater";

/** Integrated UV travel: changing strength/speed never multiplies an absolute
 * clock and jumps the texture. Only scene/simulation time advances the phase. */
export class PuddleWindMotion {
  readonly offset = [0, 0, 0, 0];
  strength = 0;
  phase = 0;
  seconds = 0;
  private previous: number | null = null;
  update(wind: ResolvedWind, seconds: number, appearance: Partial<PuddleWindSettings> = {}): void {
    if (!Number.isFinite(seconds)) return;
    const dt = this.previous === null ? 0 : Math.max(0, seconds - this.previous);
    this.previous = seconds; this.seconds = seconds;
    const a = { ...PUDDLE_WIND_DEFAULTS, ...appearance };
    const strength = Math.max(0, Math.min(3, wind.strength * a.windInfluence));
    const gust = Math.max(0, Math.min(1, wind.gust));
    const pulse = 1 - gust * (.3 + .22 * Math.sin(seconds * .83) + .08 * Math.sin(seconds * 1.71));
    this.strength = a.windRipplesEnabled ? a.windNormalStrength * Math.min(1.6, strength) * pulse : 0;
    const travel = dt * a.windSpeedResponse * (.06 + strength * .18) * pulse / a.windWorldScale;
    if (this.strength <= 0) return;
    this.phase = (this.phase + travel * 1.8) % 1;
    for (let layer = 0; layer < 2; layer++) {
      const speed = layer === 0 ? 1 : .61;
      // Integrate in each layer's UV basis, so modulo wrapping stays seamless.
      const direction = layer === 0 ? wind.direction : [
        .8 * wind.direction[0] - .6 * wind.direction[1], .6 * wind.direction[0] + .8 * wind.direction[1],
      ];
      for (let axis = 0; axis < 2; axis++) {
        const i = layer * 2 + axis;
        this.offset[i] = ((this.offset[i]! + direction[axis]! * travel * speed) % 1 + 1) % 1;
      }
    }
  }
}
