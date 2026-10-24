/**
 * Offline asset performance report (Performance Infrastructure, P5.4).
 *
 * Walks `public/assets`, measures each GLB's triangle/vertex/texture cost and
 * each standalone texture's size/resolution (via the pure helpers in
 * ./assetPerfReport), and prints the heaviest assets plus advisory threshold
 * warnings. Informational only — it never sets a failing exit code for a
 * budget overage, so CI can run it as a non-gating step. Run: npm run perf:assets
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, relative, extname } from "node:path";

import { formatByteSize } from "../engine/perf/perfBudget";
import {
  computeGltfGeometry,
  computeGltfTextures,
  evaluateGlbThresholds,
  evaluateTextureThresholds,
  imageDimensions,
  parseGlb,
  topBy,
  type GlbAssetStat,
  type GltfJson,
  type TextureAssetStat,
} from "./assetPerfReport";
import { formatWorldDataLevel, scanWorldData } from "./worldDataFiles";

const projectRoot = process.cwd();
const assetsRoot = resolve(projectRoot, "public/assets");
const TOP_N = 10;
const MODEL_EXTENSIONS = new Set([".glb", ".gltf"]);
const TEXTURE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function toPublicPath(full: string): string {
  return relative(assetsRoot, full).replace(/\\/g, "/");
}

async function readGlbStat(full: string): Promise<GlbAssetStat | null> {
  const bytes = new Uint8Array(await readFile(full));
  const ext = extname(full).toLowerCase();
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  if (ext === ".glb") {
    const parsed = parseGlb(bytes);
    if (!parsed) return null;
    json = parsed.json;
    bin = parsed.bin;
  } else {
    // .gltf text container: geometry from accessors; textures are external.
    try {
      json = JSON.parse(new TextDecoder().decode(bytes)) as GltfJson;
    } catch {
      return null;
    }
  }
  const geometry = computeGltfGeometry(json);
  const textures = computeGltfTextures(json, bin);
  return {
    path: toPublicPath(full),
    bytes: bytes.byteLength,
    triangles: geometry.triangles,
    vertices: geometry.vertices,
    textureCount: textures.count,
    maxTextureDimension: textures.maxDimension,
  };
}

async function readTextureStat(full: string): Promise<TextureAssetStat> {
  const bytes = new Uint8Array(await readFile(full));
  const dims = imageDimensions(bytes);
  return {
    path: toPublicPath(full),
    bytes: bytes.byteLength,
    maxDimension: dims ? Math.max(dims.width, dims.height) : 0,
  };
}

function padEnd(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

async function main(): Promise<void> {
  const assetsStat = await stat(assetsRoot).catch(() => null);
  if (!assetsStat?.isDirectory()) {
    console.error(`[asset-perf] FAIL assets directory not found: ${assetsRoot}`);
    process.exitCode = 1;
    return;
  }

  const files = await walkFiles(assetsRoot);
  const modelFiles = files.filter((f) => MODEL_EXTENSIONS.has(extname(f).toLowerCase()));
  const textureFiles = files.filter((f) => TEXTURE_EXTENSIONS.has(extname(f).toLowerCase()));

  const glbStats = (await Promise.all(modelFiles.map(readGlbStat))).filter(
    (s): s is GlbAssetStat => s !== null,
  );
  const textureStats = await Promise.all(textureFiles.map(readTextureStat));

  const totalTriangles = glbStats.reduce((sum, s) => sum + s.triangles, 0);
  const totalModelBytes = glbStats.reduce((sum, s) => sum + s.bytes, 0);
  const totalTextureBytes = textureStats.reduce((sum, s) => sum + s.bytes, 0);

  console.log(
    `[asset-perf] models=${glbStats.length} textures=${textureStats.length} ` +
      `tris=${totalTriangles} modelBytes=${formatByteSize(totalModelBytes)} ` +
      `textureBytes=${formatByteSize(totalTextureBytes)}`,
  );

  console.log(`\n[asset-perf] Top ${TOP_N} models by triangles:`);
  for (const stat of topBy(glbStats, (s) => s.triangles, TOP_N)) {
    const warnings = evaluateGlbThresholds(stat);
    const flag = warnings.length > 0 ? ` !! ${warnings.join("; ")}` : "";
    console.log(
      `  ${padEnd(`${stat.triangles} tris`, 14)} ${padEnd(`${stat.vertices} v`, 12)} ` +
        `${padEnd(formatByteSize(stat.bytes), 10)} ${stat.path}${flag}`,
    );
  }

  console.log(`\n[asset-perf] Top ${TOP_N} textures by bytes:`);
  for (const stat of topBy(textureStats, (s) => s.bytes, TOP_N)) {
    const warnings = evaluateTextureThresholds(stat);
    const flag = warnings.length > 0 ? ` !! ${warnings.join("; ")}` : "";
    const res = stat.maxDimension > 0 ? `${stat.maxDimension}px` : "?px";
    console.log(
      `  ${padEnd(formatByteSize(stat.bytes), 10)} ${padEnd(res, 8)} ${stat.path}${flag}`,
    );
  }

  const glbWarnings = glbStats.filter((s) => evaluateGlbThresholds(s).length > 0).length;
  const textureWarnings = textureStats.filter((s) => evaluateTextureThresholds(s).length > 0).length;
  console.log(
    `\n[asset-perf] advisories: ${glbWarnings} model(s), ${textureWarnings} texture(s) over budget ` +
      "(informational — does not fail the build).",
  );

  console.log("\n[asset-perf] World data:");
  try {
    const worldData = scanWorldData(resolve(projectRoot, "public"));
    for (const level of worldData.levels) console.log(`  ${formatWorldDataLevel(level)}`);
    console.log("[asset-perf] Top 5 cell files by bytes:");
    for (const file of worldData.cellFiles.slice(0, 5)) {
      console.log(`  ${file.path} ${formatByteSize(file.bytes)}`);
    }
    for (const issue of worldData.issues) {
      console.log(`[asset-perf] advisory ${issue.severity.toUpperCase()} ${issue.level} → ${issue.path}: ${issue.reason}`);
    }
  } catch (error) {
    console.log(`[asset-perf] advisory world data: ${error instanceof Error ? error.message : String(error)}`);
  }
}

main().catch((error) => {
  console.error("[asset-perf] unexpected failure");
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
