import { decodeLakeFoam, lakeFoamHash, lakeFoamPath, type LakeFoamData } from "@engine/scene/lakeFoamBake";
import { projectFileUrl } from "@/project/ProjectSystem";

async function boundedBytes(response:Response,limit:number):Promise<Uint8Array> {
  if(Number(response.headers.get("content-length"))>limit)throw new Error("Lake foam response exceeds byte budget");
  const reader=response.body?.getReader();if(!reader)throw new Error("Missing Lake foam response body");
  const chunks:Uint8Array[]=[];let count=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;
    if(count>limit){await reader.cancel();throw new Error("Lake foam response exceeds byte budget");}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}

/** Pending immutable artifacts participate in the same save queue, before level refs. */
export class LakeFoamStore {
  private readonly pending=new Map<string,{bytes:Uint8Array;level:string;hash:string;data:LakeFoamData}>();
  private readonly loaded=new Map<string,LakeFoamData>();
  async stage(level:string,bytes:Uint8Array) {
    const hash=await lakeFoamHash(bytes),path=lakeFoamPath(level,hash),data=decodeLakeFoam(bytes);
    const total=[...this.pending.values()].reduce((n,v)=>n+v.bytes.length,0);
    if(total-(this.pending.get(path)?.bytes.length??0)+bytes.length>64*1024**2)throw new Error("over-budget: foam undo artifacts exceed 64 MiB; save/reload before continuing");
    this.pending.set(path,{bytes,level,hash,data});return {manifest:path,fingerprint:data.metadata.fingerprint};
  }
  async read(path:string,signal?:AbortSignal):Promise<LakeFoamData> {
    const cached=this.pending.get(path)?.data??this.loaded.get(path);if(cached)return cached;
    const manifestResponse=await fetch(projectFileUrl(path),{signal:signal??null,cache:"no-cache"});
    if(!manifestResponse.ok)throw new Error(`Lake foam manifest: HTTP ${manifestResponse.status}`);
    const manifest=JSON.parse(new TextDecoder().decode(await boundedBytes(manifestResponse,32768))) as {schema?:number;dataPath?:string;sha256?:string};
    const binaryPath=path.replace(/\.json$/,".bin"),hash=path.match(/\/([a-f0-9]{64})\.foam\.json$/)?.[1];
    if(manifest.schema!==1||manifest.dataPath!==binaryPath||manifest.sha256!==hash)throw new Error("Invalid Lake foam manifest");
    const response=await fetch(projectFileUrl(binaryPath),{signal:signal??null,cache:"no-cache"});if(!response.ok)throw new Error(`Lake foam binary: HTTP ${response.status}`);
    const bytes=await boundedBytes(response,16*1024**2+32768);if(await lakeFoamHash(bytes)!==hash)throw new Error("Lake foam binary checksum mismatch");
    const data=decodeLakeFoam(bytes);
    while([...this.loaded.values()].reduce((n,v)=>n+v.pixels.length,0)+data.pixels.length>32*1024**2) {
      const first=this.loaded.keys().next().value;if(first===undefined)break;this.loaded.delete(first);
    }
    if(signal?.aborted)throw new DOMException("Lake foam cancelled","AbortError");
    this.loaded.set(path,data);return data;
  }
  artifact(path:string){return this.pending.get(path);}
  discard(path:string){this.pending.delete(path);}
  /** Runtime quality changes must never discard editor pending/undo artifacts. */
  clearLoaded(){this.loaded.clear();}
  clear(){this.pending.clear();this.loaded.clear();}
}
