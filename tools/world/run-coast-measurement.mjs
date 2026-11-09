import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = mkdtempSync(join(tmpdir(), "forge-coast-measure-"));
try {
  const outfile = join(dir, "measure.mjs");
  await build({ entryPoints: ["tools/world/measure-coast-shoreline.ts"], outfile, bundle: true, platform: "node", format: "esm" });
  await import(pathToFileURL(outfile).href);
} finally { rmSync(dir, { recursive: true, force: true }); }
