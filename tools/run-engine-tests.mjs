// Bundles tools/engine-tests.ts with esbuild (already present via vite) and
// runs it on node. No test framework or extra dependency; mirrors the plain
// node style of builder/web/verify-dist.mjs. Run via: npm run test:engine
//
// Flags (all optional; the bare command is the full default suite):
//   --filter <terms>  comma-separated, case-insensitive label substrings, OR'd.
//   -f <terms>        Skips everything else *without running it*, which is what
//   --filter=<terms>  makes an iteration cheap. A filtered run is never green.
//   --slow            also run the checks tagged `checkSlow` (a filter implies
//                     this, so narrowing to a subject never hides its slow ones).
//   --timing          print each check's wall time — the instrument for deciding
//                     what is actually expensive, rather than guessing.
//
// Bundle and run times are printed separately, because they answer different
// questions: bundling is what the file's *size* costs, running is what the
// checks cost, and only the second one is ever the reason a suite is slow.
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const valueFor = (names) => {
  for (const name of names) {
    const inline = argv.find((arg) => arg.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = argv.indexOf(name);
    if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
  }
  return null;
};

const filter = valueFor(["--filter", "-f"]);
if (filter) process.env.ENGINE_TESTS_FILTER = filter;
if (argv.includes("--slow")) process.env.ENGINE_TESTS_SLOW = "1";
if (argv.includes("--timing")) process.env.ENGINE_TESTS_TIMING = "1";

const dir = mkdtempSync(join(tmpdir(), "engine-tests-"));
const outfile = join(dir, "tests.mjs");

console.log("[engine-tests] bundling tools/engine-tests.ts");
if (filter) console.log(`[engine-tests] filter: ${filter}`);
const bundleStartedAt = performance.now();
try {
  await build({
    entryPoints: ["tools/engine-tests.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "warning",
  });
  const bundledAt = performance.now();
  await import(pathToFileURL(outfile).href);
  const finishedAt = performance.now();
  console.log(
    `[engine-tests] bundle ${((bundledAt - bundleStartedAt) / 1000).toFixed(1)} s, ` +
      `run ${((finishedAt - bundledAt) / 1000).toFixed(1)} s`,
  );
} catch (error) {
  console.error("[engine-tests] FAILED");
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
