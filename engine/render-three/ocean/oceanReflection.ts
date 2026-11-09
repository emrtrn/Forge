import { Matrix4, Vector2, type Texture } from "three";
import { oceanPlanarSettings, type OceanReflectionCeiling, type OceanWaterBody } from "../../scene/oceanWater";
import type { PlanarReflectionSource } from "../planarReflectionSource";
import { WaterReflectionRegistry } from "../waterReflectionRegistry";

/** One lease per Ocean presentation; the application registry owns the target. */
export class OceanReflectionLease {
  private current: PlanarReflectionSource | null = null;
  private key: string | null = null;
  private disposed = false;
  constructor(private readonly consumer: { setReflectionSource(source: PlanarReflectionSource | null): void },
    private readonly registry: WaterReflectionRegistry) {}
  get source() { return this.current; }
  update(body: OceanWaterBody, ceiling: OceanReflectionCeiling): void {
    if (this.disposed) return;
    const settings = oceanPlanarSettings(body, ceiling), key = settings ? JSON.stringify(settings) : null;
    if (key === this.key) return;
    const previous = this.current;
    const next = settings ? this.registry.acquire(settings.group, settings.planeY, settings.quality) : null;
    try { this.consumer.setReflectionSource(next); }
    catch (error) {
      // A consumer may have detached its old source before a binding failed.
      try { this.consumer.setReflectionSource(previous); } catch { /* Preserve the original failure. */ }
      if (next) this.registry.release(next);
      throw error;
    }
    this.current = next; this.key = key;
    if (previous) this.registry.release(previous);
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    try { this.consumer.setReflectionSource(null); }
    finally {
      if (this.current) this.registry.release(this.current);
      this.current = null; this.key = null;
    }
  }
}

export function createOceanReflectionUniforms() {
  return { reflectionTexture: { value: null as Texture | null }, reflectionMatrix: { value: new Matrix4() },
    reflectionTexelSize: { value: new Vector2(1, 1) }, planarReflectionEnabled: { value: 0 }, reflectionStrength: { value: 1 } };
}

// Geometry coverage stays premultiplied through filtering, like Lake/River.
// Empty/offscreen samples retain the borrowed sky/probe instead of painting black.
export const OCEAN_PLANAR_GLSL = /* glsl */ `
uniform sampler2D reflectionTexture;
uniform vec2 reflectionTexelSize;
uniform float planarReflectionEnabled;
uniform float reflectionStrength;
varying vec4 vReflection;
vec4 oceanPlanar(vec3 normal,float roughness) {
  if(planarReflectionEnabled<.5||vReflection.w<=0.)return vec4(0.);
  vec3 tilt=mat3(viewMatrix)*vec3(normal.x,0.,normal.z);
  vec2 uv=vReflection.xy/vReflection.w+tilt.xy*.006;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec4(0.);
  vec2 border=min(uv,vec2(1.)-uv);
  float edge=smoothstep(0.,.025,min(border.x,border.y));
  vec2 t=reflectionTexelSize*mix(.75,4.,roughness),lo=reflectionTexelSize*.5,hi=vec2(1.)-lo;
  vec4 c=texture(reflectionTexture,clamp(uv,lo,hi))*4.;
  c+=texture(reflectionTexture,clamp(uv+vec2(t.x,0.),lo,hi))*2.;
  c+=texture(reflectionTexture,clamp(uv-vec2(t.x,0.),lo,hi))*2.;
  c+=texture(reflectionTexture,clamp(uv+vec2(0.,t.y),lo,hi))*2.;
  c+=texture(reflectionTexture,clamp(uv-vec2(0.,t.y),lo,hi))*2.;
  c+=texture(reflectionTexture,clamp(uv+t,lo,hi));
  c+=texture(reflectionTexture,clamp(uv-t,lo,hi));
  c+=texture(reflectionTexture,clamp(uv+vec2(t.x,-t.y),lo,hi));
  c+=texture(reflectionTexture,clamp(uv+vec2(-t.x,t.y),lo,hi));
  return c*(edge/16.);
}`;
