import type { LakeFoamStore } from "@/scene/lakeFoamStore";
import type { LayoutLakeWaterBody } from "@engine/scene/layout";
import type { EditorSaveStep } from "./editorSaveCoordinator";
export function lakeFoamSaveSteps(store:LakeFoamStore|undefined,bodies:readonly Pick<LayoutLakeWaterBody,"geometryFoam">[]):EditorSaveStep[] {
  const paths=new Set(bodies.flatMap(l=>l.geometryFoam?.bake?[l.geometryFoam.bake.manifest]:[]));
  return [...paths].flatMap(path=>{const item=store?.artifact(path);if(!item)return [];
    return [{path,write:async()=>{
      const response=await fetch(`/__save-lake-foam?level=${encodeURIComponent(item.level)}&hash=${item.hash}`,{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:new Uint8Array(item.bytes).buffer});
      if(!response.ok)throw new Error(`Lake foam save failed: ${response.status} ${await response.text()}`);
    }}];});
}
