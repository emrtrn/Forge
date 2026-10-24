/** Offline HLOD baking with public-relative, injected reads. */
import { posix, resolve } from "node:path";
import { createRequire } from "node:module";
import { Document, Logger, NodeIO, Verbosity, getBounds, type Material, type Node, type Primitive, type Texture } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { simplify, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
import { BufferGeometry, Color, Float32BufferAttribute, Matrix3, Matrix4, Vector3 } from "three";
import { assetPath, assetRecordById, type AssetManifest } from "../../engine/assets/manifest";
import { normalizeForgeMaterialDef } from "../../engine/assets/material";
import { composeTransformMatrix } from "../../engine/render-three/transforms";
import type { RoomLayout } from "../../engine/scene/layout";
import { isMarkerAssetId } from "../../engine/scene/shapes";
import {
  HLOD_SCHEMA, averageLinearColor, hlodCellPath, hlodCellPlacements, hlodCellSourceHash,
  hlodIncludesPlacement, hlodIndexPath, type HlodIndex, type HlodPlacementInput,
} from "../../engine/world/hlod";
import {
  mergeWorldCells, normalizeWorldCellDocument, normalizeWorldPartitionSettings, worldCellPath,
  worldPartitionCellContents,
} from "../../engine/world/worldPartition";

export interface HlodBuildIO {
  /** Public-root-relative read; null when missing. */
  read(path: string): Promise<Uint8Array | null>;
}

export interface HlodBuildOptions {
  /** Simplification target ratio in (0, 1], default 0.25. */
  readonly ratio?: number;
  /** Relative simplification error, default 0.01. */
  readonly error?: number;
}

export interface HlodBuildResult {
  readonly index: HlodIndex;
  readonly files: Map<string, Uint8Array>;
  readonly warnings: string[];
}

type RGB = [number, number, number];
interface AssetPart {
  primitive: Primitive;
  matrix: Matrix4;
  color: RGB;
}
interface LoadedAsset {
  radius: number;
  parts: AssetPart[];
}

function publicPath(path: string): string {
  const input = path.replace(/\\/g, "/");
  if (/^[a-z][a-z\d+.-]*:/i.test(input) || input.startsWith("/")) throw new Error(`Path escapes public: ${path}`);
  const normalized = posix.normalize(input);
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("\0")) {
    throw new Error(`Path escapes public: ${path}`);
  }
  return normalized;
}

/** NodeIO resource reads also go through the injected public-root boundary. */
class PublicNodeIO extends NodeIO {
  constructor(private readonly input: HlodBuildIO) {
    super();
  }

  protected override readURI(uri: string, type: "view"): Promise<Uint8Array<ArrayBuffer>>;
  protected override readURI(uri: string, type: "text"): Promise<string>;
  protected override async readURI(uri: string, type: "view" | "text"): Promise<Uint8Array<ArrayBuffer> | string> {
    const bytes = await this.input.read(publicPath(uri));
    if (bytes === null) throw new Error(`Missing public resource: ${uri}`);
    return type === "text" ? new TextDecoder().decode(bytes) : new Uint8Array(bytes);
  }

  protected override resolve(base: string, path: string): string {
    if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("/") || path.startsWith("\\")) {
      throw new Error(`Path escapes public: ${path}`);
    }
    return publicPath(posix.join(base, decodeURIComponent(path)));
  }

  protected override dirname(uri: string): string {
    return posix.dirname(uri);
  }
}

function multiply(a: readonly number[], b: readonly number[]): RGB {
  return [a[0]! * b[0]!, a[1]! * b[1]!, a[2]! * b[2]!];
}

/** Matches ensureVertexNormals before a runtime model is instanced. */
function ensureNormals(doc: Document, primitive: Primitive): void {
  if (primitive.getAttribute("NORMAL")) return;
  const position = primitive.getAttribute("POSITION")!;
  const values = new Float32Array(position.getCount() * 3);
  for (let index = 0; index < position.getCount(); index += 1) values.set(position.getElement(index, []), index * 3);
  const geometry = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(values, 3));
  const indices = primitive.getIndices();
  if (indices) geometry.setIndex(Array.from(indices.getArray()!));
  geometry.computeVertexNormals();
  primitive.setAttribute("NORMAL", doc.createAccessor().setType("VEC3")
    .setArray(new Float32Array(geometry.getAttribute("normal").array))
    .setBuffer(position.getBuffer() ?? doc.createBuffer()));
  geometry.dispose();
}

export async function buildLevelHlod(
  levelPath: string,
  io: HlodBuildIO,
  options: HlodBuildOptions = {},
): Promise<HlodBuildResult> {
  levelPath = publicPath(levelPath);
  const ratio = options.ratio ?? 0.25;
  const error = options.error ?? 0.01;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) throw new Error("HLOD ratio must be in (0, 1]");
  if (!Number.isFinite(error) || error < 0) throw new Error("HLOD error must be finite and non-negative");
  const warnings: string[] = [];
  const warned = new Set<string>();
  const warn = (key: string, message: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push(message);
  };
  const read = (path: string) => io.read(publicPath(path));
  const json = async (path: string): Promise<unknown> => {
    const bytes = await read(path);
    if (!bytes) throw new Error(`Missing public resource: ${path}`);
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  let layout = await json(levelPath) as RoomLayout;
  const settings = normalizeWorldPartitionSettings(layout.worldSettings?.partition);
  if (!settings.enabled) throw new Error(`World Partition is not enabled for ${levelPath}`);
  if (layout.worldCells) {
    const seen = new Set<string>();
    const cells = [];
    for (const key of layout.worldCells) {
      if (seen.has(key)) throw new Error(`Duplicate worldCells key: ${key}`);
      seen.add(key);
      const cell = normalizeWorldCellDocument(await json(worldCellPath(levelPath, "main", key)));
      if (cell.key !== key) throw new Error(`worldCell.key does not match ${key}`);
      cells.push(cell);
    }
    layout = mergeWorldCells(layout, cells);
  }
  const manifest = await json("assets/manifest.json") as AssetManifest;
  if (!manifest || !Array.isArray(manifest.assets)) throw new Error("Invalid assets/manifest.json assets");
  const quiet = new Logger(Verbosity.SILENT);
  const nodeIO = new PublicNodeIO(io).registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder }).setStrictResources(false).setLogger({
      debug() {}, info() {},
      warn(message) { warn(`gltf:${message}`, message); },
      error(message) { warn(`gltf:${message}`, message); },
    });
  // Draco is optional: unsupported compressed assets are reported and skipped.
  try {
    const draco = createRequire(resolve("package.json"))("draco3dgltf");
    nodeIO.registerDependencies({ "draco3d.decoder": await (draco.default ?? draco).createDecoderModule() });
  } catch {
    // No warning unless an asset actually needs the unavailable decoder.
  }
  await Promise.all([MeshoptDecoder.ready, MeshoptSimplifier.ready]);

  const textureAverages = new Map<string | Texture, Promise<RGB>>();
  const loadSharp = () => import("sharp").then((module) => module.default);
  let sharpModule: ReturnType<typeof loadSharp> | undefined;
  const average = (key: string | Texture, bytes: () => Promise<Uint8Array | null>): Promise<RGB> => {
    let result = textureAverages.get(key);
    if (result) return result;
    result = (async (): Promise<RGB> => {
      let sharp: Awaited<ReturnType<typeof loadSharp>>;
      try {
        sharpModule ??= loadSharp();
        sharp = await sharpModule;
      } catch {
        warn("sharp", "sharp is unavailable; texture colours use their material factor alone");
        return [1, 1, 1];
      }
      try {
        const image = await bytes();
        if (!image) throw new Error("Missing texture image");
        const pixels = await sharp(image).resize({ width: 32, height: 32, fit: "inside", withoutEnlargement: true })
          .toColourspace("srgb").ensureAlpha().raw().toBuffer();
        return averageLinearColor(pixels, 4);
      } catch (cause) {
        warn(`texture:${typeof key === "string" ? key : key.getName() + key.getURI()}`,
          `Texture ${typeof key === "string" ? key : key.getName() || "embedded image"}: ${String(cause)}; using factor alone`);
        return [1, 1, 1];
      }
    })();
    textureAverages.set(key, result);
    return result;
  };
  const slotColors = new Map<string, Promise<RGB | null>>();
  const slotColor = (id: string): Promise<RGB | null> => {
    let result = slotColors.get(id);
    if (result) return result;
    result = (async (): Promise<RGB | null> => {
      try {
        const record = assetRecordById(manifest, id);
        if (!record) throw new Error("Material asset missing from manifest");
        const def = normalizeForgeMaterialDef(await json(assetPath(record)));
        // Three's CSS/hex colour constructor performs the sRGB-to-linear conversion.
        const color = new Color(def.baseColor);
        const factor: RGB = [color.r, color.g, color.b];
        if (!def.baseColorTexture) return factor;
        const texture = assetRecordById(manifest, def.baseColorTexture);
        const path = texture ? assetPath(texture) : def.baseColorTexture;
        return multiply(factor, await average(path, async () => texture ? read(path) : null));
      } catch (cause) {
        warn(`material:${id}`, `Material ${id}: ${String(cause)}; using GLTF material`);
        return null;
      }
    })();
    slotColors.set(id, result);
    return result;
  };
  const gltfColor = async (material: Material | null, modelPath: string): Promise<RGB> => {
    if (!material) return [1, 1, 1];
    const factor = material.getBaseColorFactor();
    const texture = material.getBaseColorTexture();
    if (!texture) return [factor[0], factor[1], factor[2]];
    const uri = texture.getURI();
    const key = uri && !uri.startsWith("__")
      ? publicPath(posix.join(posix.dirname(modelPath), decodeURIComponent(uri))) : texture;
    return multiply(factor, await average(key, async () => texture.getImage()));
  };
  const assets = new Map<string, Promise<LoadedAsset | null>>();
  const loadAsset = (id: string): Promise<LoadedAsset | null> => {
    let result = assets.get(id);
    if (result) return result;
    result = (async () => {
      try {
        const record = assetRecordById(manifest, id);
        const path = record ? assetPath(record) : "";
        if (id.startsWith("shape:") || path.startsWith("shape:") || !/\.(glb|gltf)$/i.test(path)) {
          throw new Error("Missing asset or unsupported model path");
        }
        const doc = await nodeIO.read(publicPath(path));
        const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
        if (!scene) throw new Error("GLTF has no scene");
        const bounds = getBounds(scene);
        const radius = Math.hypot(...bounds.max.map((value, index) => value - bounds.min[index]!)) / 2;
        const sidecarPath = path.replace(/\\/g, "/").replace(/\.[^./]+$/, ".materials.json");
        let slots: unknown[] = [];
        const sidecar = await read(sidecarPath);
        if (sidecar) {
          try {
            const input = JSON.parse(new TextDecoder().decode(sidecar));
            if (!Array.isArray(input.slots)) throw new Error("slots must be an array");
            slots = input.slots;
          } catch (cause) {
            warn(`slots:${id}`, `${sidecarPath}: ${String(cause)}; using GLTF materials`);
          }
        }
        const materials = new Map<Material | null, number>();
        const parts: AssetPart[] = [];
        const nodes: Node[] = [];
        scene.traverse((node) => nodes.push(node));
        for (const node of nodes) {
          for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
            const material = primitive.getMaterial();
            if (!materials.has(material)) materials.set(material, materials.size);
            if (primitive.getMode() !== 4 || !primitive.getAttribute("POSITION")) {
              warn(`primitive:${id}`, `Asset ${id}: skipped a non-triangle or undecodable primitive`);
              continue;
            }
            try {
              ensureNormals(doc, primitive);
            } catch (cause) {
              warn(`decode:${id}`, `Asset ${id}: ${String(cause)}; skipped undecodable primitive`);
              continue;
            }
            const slot = slots[materials.get(material)!];
            const override = typeof slot === "string" && slot ? await slotColor(slot) : null;
            parts.push({ primitive, matrix: new Matrix4().fromArray(node.getWorldMatrix()),
              color: override ?? await gltfColor(material, path) });
          }
        }
        return { radius, parts };
      } catch (cause) {
        warn(`asset:${id}`, `Asset ${id}: ${String(cause)}; skipped`);
        return null;
      }
    })();
    assets.set(id, result);
    return result;
  };

  const files = new Map<string, Uint8Array>();
  const entries: HlodIndex["cells"][number][] = [];
  for (const [key, cell] of worldPartitionCellContents(layout, settings)) {
    const placements = hlodCellPlacements(layout, cell.instances);
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    for (const placement of placements) {
      const visibility = placement as HlodPlacementInput & { hidden?: boolean };
      if (visibility.hidden || isMarkerAssetId(placement.assetId)) continue;
      const asset = await loadAsset(placement.assetId);
      if (!asset || !hlodIncludesPlacement(visibility, asset.radius,
        Math.max(...placement.scale.map(Math.abs)), settings.grids.main.loadRange)) continue;
      const placementMatrix = composeTransformMatrix([...placement.position], [...placement.rotation], [...placement.scale]);
      const override = placement.materialSlot ? await slotColor(placement.materialSlot) : null;
      for (const part of asset.parts) {
        const source = part.primitive.getAttribute("POSITION")!;
        const sourceNormals = part.primitive.getAttribute("NORMAL");
        const indices = part.primitive.getIndices();
        const count = indices?.getCount() ?? source.getCount();
        const matrix = placementMatrix.clone().multiply(part.matrix);
        const normalMatrix = new Matrix3().getNormalMatrix(matrix);
        const mirrored = matrix.determinant() < 0;
        const color = override ?? part.color;
        for (let offset = 0; offset + 2 < count; offset += 3) {
          const corners = [0, 1, 2].map((corner) => indices ? indices.getScalar(offset + corner) : offset + corner);
          if (mirrored) [corners[1], corners[2]] = [corners[2]!, corners[1]!];
          if (corners.some((index) => index < 0 || index >= source.getCount())) {
            warn(`indices:${placement.assetId}`, `Asset ${placement.assetId}: skipped invalid triangle indices`);
            continue;
          }
          const vertices = corners.map((index) => new Vector3().fromArray(source.getElement(index, [])).applyMatrix4(matrix));
          if (vertices.some((vertex) => ![vertex.x, vertex.y, vertex.z].every(Number.isFinite))) continue;
          const faceNormal = new Vector3().subVectors(vertices[1]!, vertices[0]!)
            .cross(new Vector3().subVectors(vertices[2]!, vertices[0]!)).normalize();
          vertices.forEach((vertex, corner) => {
            const normal = sourceNormals
              ? new Vector3().fromArray(sourceNormals.getElement(corners[corner]!, [])).applyNormalMatrix(normalMatrix)
              : faceNormal;
            positions.push(vertex.x, vertex.y, vertex.z);
            normals.push(normal.x, normal.y, normal.z);
            colors.push(...color);
          });
        }
      }
    }
    if (!positions.length) continue;
    const doc = new Document().setLogger(quiet);
    const buffer = doc.createBuffer();
    const attribute = (values: number[]) => doc.createAccessor().setType("VEC3")
      .setArray(new Float32Array(values)).setBuffer(buffer);
    const primitive = doc.createPrimitive().setAttribute("POSITION", attribute(positions))
      .setAttribute("NORMAL", attribute(normals)).setAttribute("COLOR_0", attribute(colors))
      .setIndices(doc.createAccessor().setType("SCALAR")
        .setArray(Uint32Array.from({ length: positions.length / 3 }, (_, index) => index)).setBuffer(buffer))
      .setMaterial(doc.createMaterial().setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(1).setMetallicFactor(0));
    doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(primitive)));
    // Build statistics stay in GLB extras so the shared index contract stays fixed.
    doc.getRoot().setExtras({ hlodSourceTriangles: positions.length / 9 });
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error }));
    const simplifiedIndices = doc.getRoot().listMeshes()[0]?.listPrimitives()[0]?.getIndices();
    if (!simplifiedIndices?.getCount()) continue;
    simplifiedIndices.setArray(new Uint32Array(simplifiedIndices.getArray()!));
    const triangles = simplifiedIndices.getCount() / 3;
    files.set(hlodCellPath(levelPath, key), await nodeIO.writeBinary(doc));
    entries.push({ key, triangles, sourceHash: hlodCellSourceHash(placements) });
  }
  const index: HlodIndex = { schema: HLOD_SCHEMA, type: "hlod", cellSize: settings.grids.main.cellSize, cells: entries };
  files.set(hlodIndexPath(levelPath), new TextEncoder().encode(JSON.stringify(index, null, 2) + "\n"));
  return { index, files, warnings };
}
