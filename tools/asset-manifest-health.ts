import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";

import { compareAssetHealthWarnings, validateAssetManifest } from "../engine/assets/manifest";

interface ProjectManifestForAssets {
  publicDir?: string;
  editor?: {
    assetManifest?: string;
  };
}

const projectRoot = process.cwd();
const projectManifestPath = resolve(projectRoot, "public/project.3dgame.json");

function toPublicPath(path: string, publicDir: string): string {
  return relative(resolve(projectRoot, publicDir), path).replace(/\\/g, "/");
}

async function walkFiles(root: string, publicDir: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full, publicDir)));
    } else if (entry.isFile()) {
      files.push(toPublicPath(full, publicDir));
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function main(): Promise<void> {
  const project = (await readJson(projectManifestPath)) as ProjectManifestForAssets;
  const publicDir = project.publicDir ?? "public";
  const manifestPath = project.editor?.assetManifest ?? "assets/manifest.json";
  const publicRoot = resolve(projectRoot, publicDir);
  const manifestFullPath = resolve(publicRoot, manifestPath);

  const manifestStat = await stat(manifestFullPath).catch(() => null);
  if (!manifestStat?.isFile()) {
    console.error(`[asset-health] FAIL manifest not found: ${manifestPath}`);
    process.exitCode = 1;
    return;
  }

  const [manifest, publicFiles] = await Promise.all([
    readJson(manifestFullPath),
    walkFiles(resolve(publicRoot, "assets"), publicDir),
  ]);
  const report = validateAssetManifest(manifest, { publicFiles });
  const baselineIndex = process.argv.indexOf("--baseline");
  let baseline: string[] | null = null;
  if (baselineIndex !== -1) {
    const path = process.argv[baselineIndex + 1];
    if (!path) throw new Error("--baseline requires a JSON file path");
    const raw = await readJson(resolve(projectRoot, path)) as { schema?: unknown; warnings?: unknown } | null;
    if (!raw || raw.schema !== 1 || !Array.isArray(raw.warnings) || !raw.warnings.every((key) => typeof key === "string")) {
      throw new Error(`Invalid asset-health baseline: ${path}`);
    }
    baseline = raw.warnings as string[];
  }
  const comparison = compareAssetHealthWarnings(report, baseline ?? []);
  const reportPath = resolve(projectRoot, "builds/reports/asset-health.json");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ schema: 1, ...report, baseline: baseline === null ? null : comparison }, null, 2) + "\n");

  console.log(
    `[asset-health] assets=${report.assetCount} placeable=${report.placeableCount} ` +
      `errors=${report.errorCount} warnings=${report.warningCount} info=${report.infoCount}`,
  );

  for (const issue of report.issues) {
    if (issue.level === "info") continue;
    const target = issue.assetId ?? issue.path ?? "manifest";
    const prefix = issue.level === "error" ? "ERROR" : "WARN";
    console.log(`[asset-health] ${prefix} ${issue.code} ${target}: ${issue.message}`);
  }
  if (report.infoCount) console.log(`[asset-health] INFO ${report.infoCount} assets use generated previews (no manifest thumbnail).`);
  console.log("[asset-health] JSON report: builds/reports/asset-health.json");
  if (baseline !== null) {
    for (const key of comparison.added) console.error(`[asset-health] NEW warning: ${key}`);
    for (const key of comparison.resolved) console.log(`[asset-health] Resolved warning: ${key}`);
  }

  if (report.valid && (baseline === null || comparison.added.length === 0)) {
    console.log("[asset-health] PASS manifest is valid.");
    return;
  }

  console.error("[asset-health] FAIL manifest has blocking errors or new warnings outside the reviewed baseline.");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("[asset-health] unexpected failure");
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
