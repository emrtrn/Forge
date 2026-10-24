// Bundles the world-data CLI with esbuild and runs it on Node.
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "world-data-"));
const outfile = join(dir, "world-data.mjs");
const argv = process.argv;

console.log("[world-data] bundling tools/world-data-check.ts");
try {
  await build({
    entryPoints: ["tools/world-data-check.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "warning",
  });
  process.argv = [argv[0], outfile, ...argv.slice(2)];
  await import(pathToFileURL(outfile).href);
} catch (error) {
  console.error("[world-data] FAILED");
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
} finally {
  process.argv = argv;
  rmSync(dir, { recursive: true, force: true });
}
