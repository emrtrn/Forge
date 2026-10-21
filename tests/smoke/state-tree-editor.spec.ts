import { expect, test } from "./test";

// Verifies the StateTree editor opens, derives its nested-state outline +
// transition table + validation from the engine normalizer, and reacts to raw
// JSON edits. It drives the editor component directly (dynamic import) and only
// ever fills the raw pane in-memory — it never saves, so no asset files are
// written and no cleanup is needed. There is no starter `*.stateTree.json`, so
// the missing path resolves to the editor's default template on open.
test("state tree editor renders outline, transitions and validation", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  await page.evaluate(async () => {
    const url = "/src/editor/StateTreeEditor.ts";
    const mod = await import(url) as typeof import("../../src/editor/StateTreeEditor");
    await mod.StateTreeEditor.open({
      path: "assets/AI/SmokeGuard.stateTree.json",
      label: "SmokeGuard",
    });
  });

  const win = page.locator(".ste-window");
  await expect(win).toBeVisible();
  await expect(win.locator("[data-ste-title]")).toHaveText("SmokeGuard");

  // Fill the raw pane with a deterministic hierarchical tree with guarded and
  // event transitions so the outline + transition table have a stable shape.
  // (No starter `*.stateTree.json` exists, so the opened path has no real file.)
  await win.locator("[data-ste-raw]").fill(
    JSON.stringify(
      {
        schema: 1,
        type: "stateTree",
        parameters: { routeTag: "outer", speed: 2 },
        context: { role: "guard" },
        states: [
          {
            id: "Patrol",
            tasks: [{ task: "forge.wait" }],
            transitions: [
              { to: "Alert", conditions: [{ kind: "blackboard", key: "alarm", op: "equals", value: true }] },
            ],
          },
          {
            id: "Alert",
            states: [{ id: "Look" }, { id: "Chase", transitions: [{ to: "Patrol", event: "lost" }] }],
          },
        ],
      },
      null,
      2,
    ),
  );
  await expect(win.locator(".ste-ok")).toBeVisible();

  // Outline: root states plus nested children (Patrol, Alert, Look, Chase).
  await expect(win.locator(".ste-node-id")).toHaveCount(4);
  await expect(win.locator(".ste-node-id").first()).toHaveText("Patrol");
  await expect(win.locator(".ste-node-id").filter({ hasText: "Chase" })).toBeVisible();
  // Patrol carries a task badge and an enter/guard-less state has none.
  await expect(win.locator(".ste-badge-task").first()).toContainText("1 task");

  // Transition table: a guarded Patrol→Alert row and an event Chase→Patrol row.
  const table = win.locator(".ste-trans-table");
  await expect(table).toBeVisible();
  await expect(table.locator("tr")).toHaveCount(2);
  await expect(table.locator(".ste-td-from").first()).toHaveText("Patrol");
  await expect(table.locator(".ste-td-to").first()).toHaveText("Alert");
  await expect(table.locator(".ste-cond").first()).toContainText("alarm equals");
  await expect(table.locator(".ste-chip-event")).toContainText("event lost");

  // --- State Details form CRUD (raw fill = in-memory, never saved). ---------
  // On load the first state is selected, so the form is populated for Patrol.
  await expect(win.locator('[data-ste-field="id"]')).toHaveValue("Patrol");
  await expect(win.locator("[data-ste-trans-cond-index]")).toHaveCount(1);

  // Edit the existing transition guard via condition cards; raw JSON mirrors it.
  const transCondKey = win.locator('[data-ste-trans-cond-f="key"]');
  await transCondKey.fill("enemyAlert");
  await transCondKey.blur();
  expect(await win.locator("[data-ste-raw]").inputValue()).toContain('"enemyAlert"');
  await expect(win.locator(".ste-ok")).toBeVisible();

  // Add an enter guard; the seeded cooldown condition is valid immediately.
  await win.locator("[data-ste-add-enter-cond-kind]").selectOption("cooldown");
  await win.locator("[data-ste-add-enter-cond]").click();
  await expect(win.locator("[data-ste-enter-cond-index]")).toHaveCount(1);
  await expect(win.locator('[data-ste-enter-cond-f="seconds"]')).toHaveValue("1");
  await expect(win.locator(".ste-chip-enter").filter({ hasText: "cooldown 1s" })).toBeVisible();
  await expect(win.locator(".ste-ok")).toBeVisible();

  // Add Child State: appends a child under Patrol and selects it; tree stays valid.
  await win.locator("[data-ste-add-child]").click();
  await expect(win.locator(".ste-node-id")).toHaveCount(5);
  await expect(win.locator(".ste-ok")).toBeVisible();
  await expect(win.locator('[data-ste-field="id"]')).toHaveValue("State");

  // Rename the new child via the form; the outline reflects it.
  const idField = win.locator('[data-ste-field="id"]');
  await idField.fill("Rest");
  await idField.blur();
  await expect(win.locator(".ste-node-id").filter({ hasText: "Rest" })).toBeVisible();
  await expect(win.locator(".ste-ok")).toBeVisible();

  // Add a task to Rest; the seeded default (forge.wait) is valid and shows a badge.
  await win.locator("[data-ste-add-task]").click();
  await expect(win.locator("[data-ste-task-index]")).toHaveCount(1);
  await expect(win.locator("[data-ste-task-name]")).toHaveValue("forge.wait");
  await expect(win.locator(".ste-ok")).toBeVisible();

  // Add a transition from Rest; the To dropdown seeds a known target, tree valid.
  await win.locator("[data-ste-add-trans]").click();
  await expect(win.locator("[data-ste-trans-index]")).toHaveCount(1);
  await win.locator('[data-ste-trans-f="to"]').selectOption("Patrol");
  await expect(win.locator(".ste-ok")).toBeVisible();
  await expect(table.locator("tr")).toHaveCount(3);

  // Remove Rest; the outline drops back to the four original states, still valid.
  await win.locator("[data-ste-remove]").click();
  await expect(win.locator(".ste-node-id")).toHaveCount(4);
  await expect(win.locator(".ste-ok")).toBeVisible();

  // Reorder root states: select Alert and move it above Patrol in the raw JSON.
  await win.locator(".ste-node-id", { hasText: "Alert" }).click();
  await expect(win.locator('[data-ste-field="id"]')).toHaveValue("Alert");
  await win.locator("[data-ste-up]").click();
  const rawAfterMove = await win.locator("[data-ste-raw]").inputValue();
  expect(rawAfterMove.indexOf('"Alert"')).toBeLessThan(rawAfterMove.indexOf('"Patrol"'));
  await expect(win.locator(".ste-ok")).toBeVisible();

  // An invalid tree (unknown transition target) flips validation to an error and
  // the outline still renders the lenient shape without crashing.
  await win.locator("[data-ste-raw]").fill(
    JSON.stringify({ schema: 1, type: "stateTree", states: [{ id: "A", transitions: [{ to: "Missing" }] }] }),
  );
  await expect(win.locator(".ste-issue")).toBeVisible();
  await expect(win.locator(".ste-node-id").first()).toHaveText("A");

  await page.keyboard.press("Escape");
  await expect(win).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});
