import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = "tests/engine/fixtures/ridgebound-spatial-master-v0.2.json";
const run = args => spawnSync(process.execPath, ["tools/world/import-ridgebound.mjs", ...args], { cwd: root, encoding: "utf8" });

test("ridgebound CLI: dry run, fresh output, hash guards and refusal to overwrite edited files or public", async () => {
  const report = run(["--source", source]);
  assert.equal(report.status, 0, report.stderr);
  assert.equal(JSON.parse(report.stdout).mode, "dry-run");
  const badHash = run(["--source", source, "--expect-sha256", "0".repeat(64)]);
  assert.equal(badHash.status, 1);
  assert.match(badHash.stderr, /SHA-256/);
  const forbidden = run(["--source", source, "--out", "public/layouts"]);
  assert.equal(forbidden.status, 1);
  assert.match(forbidden.stderr, /output\/ridgebound/);
  const png = "tests/engine/fixtures/ridgebound-valley-heightfield-v0.2.png";
  const badRasterHash = run(["--source", source, "--heightmap", png, "--expect-heightmap-sha256", "0".repeat(64)]);
  assert.equal(badRasterHash.status, 1);
  assert.match(badRasterHash.stderr, /Heightmap SHA-256/);
  const terrain = run(["--source", source, "--heightmap", png]);
  assert.equal(terrain.status, 0, terrain.stderr);
  const terrainReport = JSON.parse(terrain.stdout);
  assert.equal(terrainReport.grid.sampling, "EXACT_U16_CROP_NO_RESAMPLING");
  assert.deepEqual(terrainReport.grid.extent, [3072, 1152]);
  const out = join(root, "output", "ridgebound", `cli-test-${randomUUID()}`);
  try {
    const first = run(["--source", source, "--out", out]);
    assert.equal(first.status, 0, first.stderr);
    const receipt = JSON.parse(await readFile(join(out, "import-report.json"), "utf8"));
    assert.equal(receipt.status, "SCHEMATIC_PREVIEW_NOT_TERRAIN_OR_DRIVING_ACCEPTANCE");
    const recipePath = join(out, "layouts", "RidgeboundP0.worldrecipe.json");
    await writeFile(recipePath, "user edited this preview", "utf8");
    const again = run(["--source", source, "--out", out]);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /EEXIST/);
    assert.equal(await readFile(recipePath, "utf8"), "user edited this preview");
  } finally {
    // Verify the full recursive-delete target is an isolated child of this workspace.
    assert.equal(dirname(out), join(root, "output", "ridgebound"));
    assert.match(out.slice(dirname(out).length + 1), /^cli-test-[a-f0-9-]+$/);
    await rm(out, { recursive: true, force: true });
  }
});
