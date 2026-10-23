import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "vite";
import { collectReleaseContent, measureRelease, readJson, stageReleaseContent } from "./release-content.mjs";
import { createStarterContent } from "./starter-content.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing value for ${name}`);
  return args[index + 1];
}

async function main() {
  for (let index = 0; index < args.length; index += 2) if (!["--profile", "--base", "--output"].includes(args[index])) throw new Error(`Unknown option: ${args[index]}`);
  const name = option("--profile", "starter");
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Invalid release profile name");
  const profile = await readJson(resolve(root, `builder/web/profiles/${name}.json`));
  if (profile.schema !== 1 || profile.name !== name) throw new Error("Invalid release profile schema/name");
  const base = option("--base", "/");
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) throw new Error("Release base must be / or an absolute subpath with a trailing slash");
  const output = option("--output", name);
  if (!/^[a-z0-9-]+$/.test(output)) throw new Error("Output must be a simple name under builds/release/");
  const workspace = resolve(root, "builds/release");
  await mkdir(workspace, { recursive: true });
  const realRoot = await realpath(root);
  const realWorkspace = await realpath(workspace);
  if (!realWorkspace.startsWith(realRoot + sep)) throw new Error("Release workspace escapes the repository");
  const stage = await mkdtemp(resolve(workspace, ".stage-"));
  try {
    let publicDir, provenance;
    if (profile.content === "generated-starter") {
      publicDir = resolve(stage, "source");
      provenance = await createStarterContent(publicDir);
    } else if (profile.content === "project") {
      publicDir = resolve(root, "public");
      if (!/^builder\/web\/provenance\/[a-z0-9-]+\.json$/.test(profile.provenanceFile ?? "")) throw new Error("Project profile requires a provenance registry under builder/web/provenance/");
      provenance = await readJson(resolve(root, profile.provenanceFile));
    } else throw new Error("Unknown release content source");
    const selection = await collectReleaseContent({ publicDir, profile, provenance });
    const stagedPublic = resolve(stage, "public");
    await stageReleaseContent(selection, publicDir, stagedPublic);
    const dist = resolve(workspace, output);
    await mkdir(dist, { recursive: true });
    if (dirname(await realpath(dist)) !== realWorkspace) throw new Error("Release output escapes its build workspace");
    // Vite may empty only this validated build-owned output directory.
    await build({ root, configFile: resolve(root, "vite.config.ts"), base, publicDir: stagedPublic, build: { outDir: dist, emptyOutDir: true } });
    const scan = spawnSync(process.execPath, [resolve(root, "builder/web/verify-dist.mjs"), "--strict", "--dist", dist], { cwd: root, encoding: "utf8" });
    process.stdout.write(scan.stdout ?? ""); process.stderr.write(scan.stderr ?? "");
    if (scan.status !== 0) throw new Error("Release dist boundary scan failed");
    const attribution = selection.files.filter((f) => f.provenance.kind === "third-party").map((f) => `${f.path}: ${f.provenance.attribution}`);
    const notice = attribution.length ? attribution.join("\n") + "\n" : "Original starter source assets; see the provenance report. Project owner controls distribution.\n";
    await writeFile(resolve(dist, "ASSET_NOTICES.txt"), notice);
    const measurement = await measureRelease(dist, profile.budgets);
    const report = { schema: 1, profile: name, base, ...measurement, assets: selection.manifest.assets.map((asset) => asset.id), content: selection.files };
    await writeFile(resolve(workspace, `${output}.report.json`), JSON.stringify(report, null, 2) + "\n");
    await writeFile(resolve(workspace, `${output}.attribution.txt`), notice);
    console.log("[release]", JSON.stringify({ profile: name, base, assets: report.assets.length, ...measurement.totals }));
    if (measurement.failures.length) throw new Error(`Release budget exceeded: ${measurement.failures.join("; ")}`);
    // Ensure all selected files survived packaging (not just their manifest records).
    for (const entry of selection.files) await readFile(resolve(dist, entry.path));
  } finally {
    // stage is the exact mkdtemp result inside the verified build workspace.
    if (dirname(stage) !== workspace) throw new Error("Invalid stage cleanup target");
    await rm(stage, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error("[release]", error); process.exitCode = 1; });
