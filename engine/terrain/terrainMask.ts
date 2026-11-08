/**
 * Height / slope / noise mask shared by the rules that read terrain shape:
 * Auto Paint (`terrainAutoPaint.ts`) lays paint with it and Landscape foliage
 * rules (`engine/scene/proceduralFoliage.ts`) thin and shrink their plants
 * with it. One model, so a band means the same thing in both.
 *
 * The mask is the product of a height band and a slope band, each 1 inside
 * `[min, max]` and fading to 0 over its falloff outside it; noise then moves
 * it up or down by up to `noiseAmount`. Pure; no three.js.
 */
import { terrainSculptNoise } from "./terrainSculpt";

export interface TerrainMaskBands {
  /** World-space height band, metres; `±Infinity` leaves that side open. */
  heightMin: number;
  heightMax: number;
  /** Fade outside the height band, metres; 0 is a hard edge. */
  heightFalloff: number;
  /** Slope band, degrees from horizontal (0 flat, 90 vertical). */
  slopeMin: number;
  slopeMax: number;
  /** Fade outside the slope band, degrees; 0 is a hard edge. */
  slopeFalloff: number;
  /** 0..1, how much the coverage is broken up by noise. */
  noiseAmount: number;
  /** Noise feature size, metres. */
  noiseScale: number;
}

/** UI and clamp ranges, the single source for the editor's sliders. */
export const TERRAIN_MASK_RANGES = {
  /** Typed heights are clamped here; sliders span the terrain's own ground. */
  height: { min: -10000, max: 10000 },
  slope: { min: 0, max: 90 },
  slopeFalloff: { min: 0, max: 45 },
  heightFalloff: { min: 0, max: 500 },
  noiseAmount: { min: 0, max: 1 },
  noiseScale: { min: 1, max: 500 },
} as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** 1 inside `[min, max]`, smoothstep to 0 over `falloff` outside it. */
export function terrainMaskBand(value: number, min: number, max: number, falloff: number): number {
  const lo = Math.min(min, max), hi = Math.max(min, max);
  if (value >= lo && value <= hi) return 1;
  if (!(falloff > 0)) return 0;
  const outside = value < lo ? lo - value : value - hi;
  return outside >= falloff ? 0 : smooth(1 - outside / falloff);
}

/** Two octaves of the sculpt value noise, in -1..1. */
export function terrainMaskNoise(x: number, z: number, scale: number, seed: number): number {
  const s = Math.max(1e-3, scale);
  return (terrainSculptNoise(x / s, z / s, seed) * 2 + terrainSculptNoise(x / s * 2.03, z / s * 2.03, seed + 7919)) / 3;
}

/** 0..1 coverage at a point. */
export function terrainMaskAt(bands: TerrainMaskBands, height: number, slopeDeg: number, x: number, z: number, seed: number): number {
  let mask = terrainMaskBand(height, bands.heightMin, bands.heightMax, Math.max(0, bands.heightFalloff))
    * terrainMaskBand(slopeDeg, bands.slopeMin, bands.slopeMax, Math.max(0, bands.slopeFalloff));
  const amount = clamp(bands.noiseAmount, 0, 1);
  if (amount > 0 && mask > 0) mask = clamp(mask + terrainMaskNoise(x, z, bands.noiseScale, seed) * amount, 0, 1);
  return mask;
}
