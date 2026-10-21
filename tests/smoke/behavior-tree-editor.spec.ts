import { expect, test } from "./test";

// Verifies the Behavior Tree editor opens a real `*.behavior.json` asset and
// derives its outline + validation from the engine normalizer. It drives the
// editor component directly (dynamic import) rather than navigating the Content
// Browser folder tree, keeping the smoke fast and deterministic. Read-only: it
// never saves, so no asset files are written and no cleanup is needed.
test("behavior tree editor renders outline and validation for a real asset", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });

  // Open the editor on the starter-content AI_Test behavior tree (selector root
  // with services + children) via the component's own dynamic-import entry point.
  await page.evaluate(async () => {
    const url = "/src/editor/BehaviorTreeEditor.ts";
    const mod = await import(url) as typeof import("../../src/editor/BehaviorTreeEditor");
    await mod.BehaviorTreeEditor.open({
      path: "assets/starter-content/AI/AI_Test.behavior.json",
      label: "AI_Test",
    });
  });

  const win = page.locator(".bte-window");
  await expect(win).toBeVisible();
  await expect(win.locator("[data-bte-title]")).toHaveText("AI_Test");

  // Outline: the root node is a selector, and its services surface as chips.
  await expect(win.locator(".bte-node-kind").first()).toHaveText("selector");
  await expect(win.locator(".bte-chip-svc").first()).toContainText(
    "forge.updatePerceptionBlackboard",
  );

  // Validation: the real asset passes the engine normalizer.
  await expect(win.locator(".bte-ok")).toBeVisible();

  // On open the root is selected, so the node form is populated.
  await expect(win.locator('[data-bte-field="kind"]')).toHaveValue("selector");

  // --- Node-form CRUD on a controlled tree (raw fill = in-memory, never saved).
  // Switch the raw pane to a small deterministic sequence so the structured
  // add/edit/reorder/remove/kind actions have a stable shape to act on.
  await win.locator("[data-bte-raw]").fill(
    JSON.stringify(
      {
        schema: 1,
        type: "behaviorTree",
        root: {
          kind: "sequence",
          children: [
            { kind: "wait", seconds: 1 },
            { kind: "task", task: "forge.wait" },
          ],
        },
      },
      null,
      2,
    ),
  );
  await expect(win.locator(".bte-ok")).toBeVisible();

  const beforeNodes = await win.locator(".bte-node").count();

  // Add Child: appends a task node and selects it; the tree stays valid.
  await win.locator("[data-bte-add-kind]").selectOption("task");
  await win.locator("[data-bte-add]").click();
  await expect(win.locator(".bte-node")).toHaveCount(beforeNodes + 1);
  await expect(win.locator(".bte-ok")).toBeVisible();

  // The new node is selected; edit its task field via the node form.
  const taskField = win.locator('[data-bte-field="task"]');
  await expect(taskField).toHaveValue("forge.setBlackboard");
  await taskField.fill("forge.sendMessage");
  await taskField.blur();
  await expect(win.locator(".bte-node-sub").filter({ hasText: "forge.sendMessage" })).toBeVisible();

  // Reorder: the edited node is last; moving it up puts it before "forge.wait".
  await win.locator("[data-bte-up]").click();
  const rawAfterMove = await win.locator("[data-bte-raw]").inputValue();
  expect(rawAfterMove.indexOf("forge.sendMessage")).toBeLessThan(rawAfterMove.indexOf("forge.wait"));

  // Remove: drops the added node and re-selects the parent.
  await win.locator("[data-bte-remove]").click();
  await expect(win.locator(".bte-node")).toHaveCount(beforeNodes);

  // Kind conversion preserves children (count stays) and stays valid.
  const kindField = win.locator('[data-bte-field="kind"]');
  await expect(kindField).toHaveValue("sequence");
  await kindField.selectOption("selector");
  await expect(win.locator(".bte-node-kind").first()).toHaveText("selector");
  await expect(win.locator(".bte-node")).toHaveCount(beforeNodes);
  await expect(win.locator(".bte-ok")).toBeVisible();

  // --- Decorator + service form authoring on the (selected) root node.
  // Add a distance decorator; the seeded default (key target / lte / 2) is valid
  // and surfaces as a decorator chip on the root row.
  await win.locator("[data-bte-add-dec-kind]").selectOption("distance");
  await win.locator("[data-bte-add-dec]").click();
  await expect(win.locator("[data-bte-dec-index]")).toHaveCount(1);
  await expect(win.locator(".bte-chip-dec").first()).toContainText("dist");
  await expect(win.locator(".bte-ok")).toBeVisible();

  // Edit the decorator key via the form; the raw JSON reflects the new value.
  const decKey = win.locator('[data-bte-dec-f="key"]');
  await decKey.fill("enemy");
  await decKey.blur();
  expect(await win.locator("[data-bte-raw]").inputValue()).toContain('"enemy"');
  await expect(win.locator(".bte-ok")).toBeVisible();

  // Add a service; the seeded default service name is valid and shows as a chip.
  await win.locator("[data-bte-add-svc]").click();
  await expect(win.locator("[data-bte-svc-index]")).toHaveCount(1);
  await expect(win.locator(".bte-chip-svc").first()).toContainText(
    "forge.updatePerceptionBlackboard",
  );
  await expect(win.locator(".bte-ok")).toBeVisible();

  // Remove the decorator; the card and its chip disappear, tree stays valid.
  await win.locator("[data-bte-dec-remove]").click();
  await expect(win.locator("[data-bte-dec-index]")).toHaveCount(0);
  await expect(win.locator(".bte-chip-dec")).toHaveCount(0);
  await expect(win.locator(".bte-ok")).toBeVisible();

  // Editing the raw JSON to something invalid flips validation to an error and
  // the outline still reflects the (now un-normalizable) shape without crashing.
  await win.locator("[data-bte-raw]").fill('{ "schema": 1, "type": "behaviorTree" }');
  await expect(win.locator(".bte-issue")).toBeVisible();

  // Close without saving.
  await page.keyboard.press("Escape");
  await expect(win).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});
