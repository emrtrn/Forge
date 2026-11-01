import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { buildPath, captureInputs, latestBuild } from "./game-project-build.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Retry only an incomplete offline cache; integrity/version locks stay in force. */
export function installReproductionDependencies(forge, npmCli, run = execFileSync) {
  const install = (mode) => {
    const output = run(process.execPath, [npmCli, "ci", mode, "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: forge, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    if (output) process.stdout.write(output);
    return `npm ci ${mode} --ignore-scripts --no-audit --no-fund`;
  };
  try { return install("--offline"); }
  catch (error) {
    if (!String(error.stderr).includes("ENOTCACHED")) throw error;
    console.log("[game-reproduce] Offline cache incomplete; fetching missing packages with the same lockfile");
    return install("--prefer-offline");
  }
}

/** Restores evidence into a disposable workspace, never the live Forge/game. */
export async function reproduceGameBuild(projectRoot) {
  const original = await latestBuild(projectRoot);
  const bytes = await readFile(await buildPath(original.directory, original.record.snapshot.file));
  if (hash(bytes) !== original.record.snapshot.sha256) throw new Error("Input snapshot checksum mismatch");
  const snapshot = JSON.parse(gunzipSync(bytes));
  if (snapshot.schema !== 1) throw new Error("Unsupported input snapshot");
  const workspace = await mkdtemp(resolve(tmpdir(), "forge-game-reproduce-"));
  const forge = resolve(workspace, "Forge");
  const game = resolve(workspace, "Games/Game");
  try {
    for (const [root, input] of [[forge, snapshot.forge], [game, snapshot.game]]) {
      await mkdir(root, { recursive: true });
      for (const file of input.files) {
        const content = Buffer.from(file.content, "base64");
        if (content.length !== file.bytes || hash(content) !== file.sha256) throw new Error(`Input checksum mismatch: ${file.path}`);
        const target = await buildPath(root, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
      }
    }
    const restoredForge = await captureInputs(forge, "forge");
    const restoredGame = await captureInputs(game, "game");
    if (restoredForge.digest !== original.record.forge.digest || restoredGame.digest !== original.record.game.digest) throw new Error("Restored source inputs differ");
    const npmCli = process.env.npm_execpath ?? resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    if (!existsSync(npmCli)) throw new Error("npm CLI not found for clean installation");
    console.log("[game-reproduce] Installing locked dependencies in an empty temporary workspace (offline)");
    const install = installReproductionDependencies(forge, npmCli);
    const env = { ...process.env, FORGE_ROOT: forge };
    delete env.FORGE_PROJECT_ROOT;
    console.log("[game-reproduce] Building from restored inputs, without live source or node_modules links");
    execFileSync(process.execPath, [resolve(forge, "tools/run-game-project.mjs"), "build", "--project", game, "--base", original.record.base], {
      cwd: forge, env, stdio: "inherit",
    });
    const rebuilt = await latestBuild(game);
    if (original.record.outputDigest !== rebuilt.record.outputDigest) {
      const different = original.record.output.filter((file) => !rebuilt.record.output.some((other) => other.path === file.path && other.sha256 === file.sha256));
      throw new Error(`Clean build output differs: ${different.map((file) => file.path).join(", ")}`);
    }
    const report = { schema: 1, status: "passed", verifiedAt: new Date().toISOString(), sourceBuild: original.record.id,
      node: process.version, install,
      sourceDigestsMatch: true, outputDigestMatches: true, outputDigest: rebuilt.record.outputDigest,
      outputFiles: rebuilt.record.output.length, usedLiveSourceLinks: false };
    await writeFile(await buildPath(original.directory, "reproduction.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(`[game-reproduce] PASS: ${report.outputFiles} output files match byte-for-byte`);
    return report;
  } finally {
    // Only remove the exact mkdtemp result, after verifying its actual parent.
    if (await realpath(dirname(workspace)) !== await realpath(tmpdir())) throw new Error("Unexpected reproduction cleanup root");
    await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}
