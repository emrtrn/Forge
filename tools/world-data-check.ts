/** Offline world-data reference gate. Run via tools/run-world-data-check.mjs. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { formatWorldDataLevel, scanWorldData } from "./worldDataFiles";

function main(args: readonly string[]): void {
  let root = resolve(process.cwd(), "dist");
  let printReport = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--report") printReport = true;
    else if (arg === "--root" && args[index + 1] && !args[index + 1]!.startsWith("--")) {
      root = resolve(process.cwd(), args[++index]!);
    } else {
      throw new Error(`invalid argument: ${arg}; usage: --root <dir> --report`);
    }
  }
  const report = scanWorldData(root);
  console.log(`[world-data] scanned ${report.scanned} level(s) under ${root}; ${report.levels.length} with world data`);
  for (const issue of report.issues) {
    console.log(`[world-data] ${issue.severity.toUpperCase()} ${issue.level} → ${issue.path}: ${issue.reason}`);
  }
  if (printReport) {
    for (const level of report.levels) console.log(formatWorldDataLevel(level));
  }
  if (report.issues.some((issue) => issue.severity === "fail")) process.exitCode = 1;
}

// The runner forwards argv with the bundled module as its entry path.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[world-data] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
