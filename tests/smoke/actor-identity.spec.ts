import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "./test";
import { REPO_ROOT } from "./smokeProject.mjs";

/**
 * Stable actor ids (vehicle damage contract VCD-D12): the editor gives every actor
 * an id it writes on Save and keeps across a reload. The runtime half, a save
 * finding its actor after the level renumbered them, is in `deformable-parts`.
 */

const LEVEL = "layouts/__playwright-actor-identity.level.json";
const CAR = "assets/starter-content/Gameplay/Script_ReferenceCar.actor.json";

test("the editor gives every actor an id on Save and keeps it after a reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let level = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  level.name = "__playwright-actor-identity";
  level.actors = [
    { classRef: CAR, name: "First", position: [0, 1, 0] },
    { classRef: CAR, name: "Second", id: "kept-by-hand", position: [6, 1, 0] },
    { classRef: CAR, name: "Third", id: "kept-by-hand", position: [12, 1, 0] },
  ];
  await page.route(`**/${LEVEL}`, (route) => route.fulfill({ json: level }));
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  await page.route("**/__save-layout**", async (route) => {
    level = JSON.parse(route.request().postData() ?? "{}").layout;
    await route.fulfill({ status: 200, json: { ok: true, path: LEVEL, dropped: [] } });
  });

  const saveAfterBoot = async (): Promise<string[]> => {
    await page.goto(`/?editor&actorIdentity=${Date.now()}`);
    await expect(page.getByTestId("editor-save")).toBeVisible({ timeout: 60_000 });
    const saved = page.waitForRequest((request) => request.url().includes("/__save-layout") && request.method() === "POST");
    await page.getByTestId("editor-save").click();
    await saved;
    return (level.actors as { id?: string }[]).map((actor) => actor.id ?? "");
  };

  const first = await saveAfterBoot();
  console.log(`[actor identity] ${JSON.stringify(first)}`);
  expect(first[0]).toMatch(/^act-/);
  expect(first[1], "an id that is already there is left alone").toBe("kept-by-hand");
  expect(first[2], "the later of two equal ids gets its own").toMatch(/^act-/);
  expect(new Set(first).size).toBe(3);

  expect(await saveAfterBoot()).toEqual(first);
  expect(errors).toEqual([]);
});
