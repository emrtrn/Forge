import { decodeLakeFoam, lakeFoamPath } from "../engine/scene/lakeFoamBake";
export function validateLakeFoamSave(level: unknown, hash: unknown, bytes: Uint8Array) {
  if(typeof level!=="string"||typeof hash!=="string")throw new Error("Invalid Lake foam save destination");
  const path=lakeFoamPath(level,hash),data=decodeLakeFoam(bytes);
  return {path,dataPath:path.replace(/\.json$/,".bin"),metadata:data.metadata};
}
