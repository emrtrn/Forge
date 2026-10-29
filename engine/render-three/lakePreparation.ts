import type { BufferGeometry, DataTexture } from "three";
import type { LayoutLakeWaterBody } from "../scene/layout";
import { resolveLakeAppearance } from "../scene/waterBody";
import type { LakeGeometry } from "../terrain/terrainLakeWater";
import { LakeSurfaceQuery } from "../terrain/lakeInteraction";
import { lakeRenderGeometrySteps } from "./lakeRenderGeometry";
import { createLakeFoamMaskAsync } from "./waterFoam";
import { prepareLakeShoreMask } from "./terrain/terrainShoreWetness";
import type { CooperativeWork } from "../core/cooperativeWork";

/** Owns staging until the caller synchronously transfers it to the mesh and
 * scene registries. Cancelled/failed phases leave the published surface alone.
 */
export async function prepareLakePresentation(lake: LayoutLakeWaterBody, data: LakeGeometry, work: CooperativeWork) {
  let geometry: BufferGeometry | undefined, foam: DataTexture | null = null, shore: DataTexture | null = null;
  try {
    const a = resolveLakeAppearance(lake);
    geometry = await work.run("render-geometry", lakeRenderGeometrySteps(data));
    const query = await LakeSurfaceQuery.create(data, work);
    if (a.foamEnabled) foam = await createLakeFoamMaskAsync(lake, data, a.foamWidth, work);
    if (a.shoreWetnessEnabled) shore = await prepareLakeShoreMask(lake, data, work);
    work.check();
    return { geometry, query, foam, shore };
  } catch (error) { geometry?.dispose(); foam?.dispose(); shore?.dispose(); throw error; }
}
