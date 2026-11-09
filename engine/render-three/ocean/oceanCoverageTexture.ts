import { DataTexture, FloatType, NearestFilter, RedFormat, Vector2, type WebGLRenderer } from "three";
import { CooperativeWork } from "../../core/cooperativeWork";
import type { OceanCoverageStorage } from "../../terrain/oceanCoverageStorage";

export function createOceanCoverageTexture(storage: OceanCoverageStorage): DataTexture {
  const texture = new DataTexture(storage.data, storage.width, storage.height, RedFormat, FloatType);
  texture.minFilter = texture.magFilter = NearestFilter; texture.needsUpdate = true;
  return texture;
}

/** Public renderer API keeps its state cache intact. updateRanges is RGBA-only
 * in this Three version; CPU band sources must never be bound/initialized. */
export async function uploadOceanCoverage(renderer: WebGLRenderer, texture: DataTexture, work: CooperativeWork): Promise<void> {
  const { width, height, data } = texture.image;
  if (width > renderer.capabilities.maxTextureSize || height > renderer.capabilities.maxTextureSize)
    throw new Error("over-budget: Ocean atlas exceeds GPU texture dimensions");
  work.check(); texture.source.dataReady = false; renderer.initTexture(texture);
  const rows = Math.max(1, Math.floor(256 * 1024 / (width * 4)));
  function* upload(): Generator<void> {
    for (let y = 0; y < height; y += rows) {
      const count = Math.min(rows, height - y);
      const source = new DataTexture((data as Float32Array).subarray(y * width, (y + count) * width), width, count, RedFormat, FloatType);
      try { renderer.copyTextureToTexture(source, texture, null, new Vector2(0, y)); }
      finally { source.dispose(); }
      yield;
    }
  }
  await work.run("ocean-upload", upload()); work.check();
  // No version bump: normal binds must not upload the immutable atlas again.
  // Keeping data ready permits a correct full restore after GL context loss.
  texture.source.dataReady = true;
}

/** One sampler and the same b-c interpolation for surface and terrain caustics. */
export const OCEAN_COVERAGE_SAMPLE_GLSL = /* glsl */ `
vec2 oceanCoverageSample(sampler2D atlas,ivec2 size,vec2 g){
  ivec2 cell=ivec2(min(floor(g),vec2(size)-1.));vec2 f=g-vec2(cell);
  float a=texelFetch(atlas,cell,0).r,b=texelFetch(atlas,cell+ivec2(1,0),0).r;
  float c=texelFetch(atlas,cell+ivec2(0,1),0).r,d=texelFetch(atlas,cell+ivec2(1,1),0).r;
  int index=cell.y*size.x+cell.x,word=index>>3,width=size.x+1;
  uint flagsWord=uint(round(texelFetch(atlas,ivec2(word%width,size.y+1+word/width),0).r));
  uint mask=(flagsWord>>uint((index&7)*2))&3u;bool first=f.x+f.y<=1.;
  float bed=first?a*(1.-f.x-f.y)+b*f.x+c*f.y:d*(f.x+f.y-1.)+c*(1.-f.x)+b*(1.-f.y);
  return vec2(bed,(mask&(first?1u:2u))!=0u?1.:0.);
}`;
