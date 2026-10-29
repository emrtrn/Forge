/** Saved, immutable geometry foam. Runtime uploads texels; it never scans meshes. */
export interface LakeGeometryFoam {
  enabled: boolean; width: number; strength: number; scale: number; speed: number;
  bake?: { manifest: string; fingerprint: string };
}
export interface LakeFoamMetadata {
  schema: 1; min: [number, number]; max: [number, number]; level: number;
  /** Absent in existing Lake artifacts. River masks retain their fixed world frame. */
  surface?: "river";
  surfaceFingerprint?: string;
  width: number; nx: number; nz: number; sources: number; triangles: number;
  segments: number; milliseconds: number; fingerprint: string;
}
export interface LakeFoamData { metadata: LakeFoamMetadata; pixels: Uint8Array }
export const LAKE_FOAM_MAX_BYTES = 16 * 1024 * 1024;
export const defaultLakeGeometryFoam = (): LakeGeometryFoam => ({ enabled: true, width: .4, strength: .8, scale: .8, speed: .3 });
function publicRelative(path:string):boolean {
  return !!path&&!/[\\:%?#\u0000-\u001f<>"|*]/.test(path)&&!path.split("/").some(p=>!p||p==="."||p===".."||p.endsWith(".")||p.endsWith(" "));
}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid Lake foam object");
  return v as Record<string, unknown>;
};
const number = (v: unknown, min: number, max: number): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error("Invalid Lake foam number"); return v;
};
export function lakeFoamPath(level: string, hash: string): string {
  if (!publicRelative(level)||!/\.(?:level|layout)\.json$/i.test(level)||!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid Lake foam destination");
  return `${level.replace(/\.(?:level|layout)\.json$/i, "")}.foam/${hash}.foam.json`;
}
export function validateLakeGeometryFoam(value: unknown): LakeGeometryFoam {
  const v = object(value);
  if (typeof v.enabled !== "boolean") throw new Error("Invalid Lake foam enabled");
  const result: LakeGeometryFoam = { enabled: v.enabled, width: number(v.width,.1,4), strength: number(v.strength,0,1), scale: number(v.scale,.1,10), speed: number(v.speed,0,3) };
  if (v.bake !== undefined) {
    const b=object(v.bake);
    if (typeof b.manifest !== "string" || !publicRelative(b.manifest)||!/^.+\.foam\/[a-f0-9]{64}\.foam\.json$/.test(b.manifest) || typeof b.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(b.fingerprint)) throw new Error("Invalid Lake foam reference");
    result.bake={manifest:b.manifest,fingerprint:b.fingerprint};
  }
  return result;
}
export function validateLakeFoamMetadata(value: unknown): LakeFoamMetadata {
  const v=object(value);
  const pair=(v: unknown):[number,number]=>{if(!Array.isArray(v)||v.length!==2) throw new Error("Invalid Lake foam bounds");return [number(v[0],-1e9,1e9),number(v[1],-1e9,1e9)];};
  const integer=(v:unknown,max:number)=>{const n=number(v,0,max);if(!Number.isInteger(n))throw new Error("Invalid Lake foam integer");return n;};
  const min=pair(v.min), max=pair(v.max), nx=integer(v.nx,4096), nz=integer(v.nz,4096), width=number(v.width,.1,4);
  if(v.schema!==1 || !nx || !nz || max[0]<=min[0] || max[1]<=min[1] || nx*nz>LAKE_FOAM_MAX_BYTES ||
    (max[0]-min[0])/nx>width/4+1e-9 || (max[1]-min[1])/nz>width/4+1e-9 || typeof v.fingerprint!=="string" || !/^[a-f0-9]{64}$/.test(v.fingerprint)) throw new Error("Invalid Lake foam dimensions/fingerprint");
  if(v.surface!==undefined&&v.surface!=="river")throw new Error("Invalid foam surface");
  if(v.surfaceFingerprint!==undefined&&(typeof v.surfaceFingerprint!=="string"||!/^[a-f0-9]{64}$/.test(v.surfaceFingerprint)))throw new Error("Invalid foam surface fingerprint");
  if(v.surface==="river"&&v.surfaceFingerprint===undefined)throw new Error("Invalid River foam surface fingerprint");
  return {schema:1,min,max,nx,nz,width,...(v.surface==="river"?{surface:"river" as const}:{}),...(typeof v.surfaceFingerprint==="string"?{surfaceFingerprint:v.surfaceFingerprint}:{}),level:number(v.level,-1e9,1e9),sources:integer(v.sources,4096),triangles:integer(v.triangles,2e6),segments:integer(v.segments,131072),milliseconds:number(v.milliseconds,0,86400000),fingerprint:v.fingerprint};
}
export function encodeLakeFoam(data: LakeFoamData): Uint8Array {
  const metadata=validateLakeFoamMetadata(data.metadata);
  if(data.pixels.length!==metadata.nx*metadata.nz)throw new Error("Invalid Lake foam texel count");
  const json=new TextEncoder().encode(JSON.stringify(metadata)), result=new Uint8Array(8+json.length+data.pixels.length);
  const view=new DataView(result.buffer);view.setUint32(0,0x464f414d,true);view.setUint32(4,json.length,true);
  result.set(json,8);result.set(data.pixels,8+json.length);return result;
}
export function decodeLakeFoam(bytes: Uint8Array): LakeFoamData {
  if(bytes.byteLength<8 || bytes.byteLength>LAKE_FOAM_MAX_BYTES+32768)throw new Error("Invalid Lake foam binary size");
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), size=view.getUint32(4,true);
  if(view.getUint32(0,true)!==0x464f414d || size>32760 || 8+size>bytes.length)throw new Error("Invalid Lake foam binary header");
  const metadata=validateLakeFoamMetadata(JSON.parse(new TextDecoder().decode(bytes.subarray(8,8+size))));
  if(bytes.length!==8+size+metadata.nx*metadata.nz)throw new Error("Invalid Lake foam binary length");
  return {metadata,pixels:bytes.subarray(8+size)};
}
export async function lakeFoamHash(bytes: Uint8Array): Promise<string> {
  const buffer=bytes.buffer instanceof ArrayBuffer && bytes.byteOffset===0 && bytes.byteLength===bytes.buffer.byteLength?bytes.buffer:new Uint8Array(bytes).buffer;
  const hash=await globalThis.crypto.subtle.digest("SHA-256",buffer);
  return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,"0")).join("");
}
