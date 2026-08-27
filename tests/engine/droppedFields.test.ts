/**
 * Phase G: a save must not lose data silently (plan invariant I5).
 *
 * The save validators are allowlists, so a field nobody copied through simply
 * disappears — the historic failure mode this repo warns about in three places.
 * These checks pin the detector that turns that into a warning: it reports
 * missing keys, stays quiet about normalization, and finds nothing at all in the
 * layouts this template actually ships (which makes it a live regression guard —
 * add a layout field to the runtime but not to the validator and this fails).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { collectDroppedFields, formatDroppedFieldWarning } from "../../tools/droppedFields";
import { validateLayout, validateSavePayload } from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;

function playgroundLayout(): Record<string, unknown> {
  return JSON.parse(readFileSync("public/layouts/playground.json", "utf8")) as Record<
    string,
    unknown
  >;
}

export function registerDroppedFieldTests(check: Check): void {
  check("the template's own layout survives a save with nothing dropped", () => {
    const layout = playgroundLayout();
    const report = collectDroppedFields(layout, validateLayout(layout), "layout", 100);
    assert.deepEqual(
      report.paths,
      [],
      "a field the runtime reads but the validator does not copy would be lost on every save",
    );
  });

  check("a field the validator does not know is reported instead of vanishing", () => {
    const layout = playgroundLayout();
    const instances = layout.instances as Record<string, unknown>[];
    instances[0]!.glowIntensity = 3;
    (layout.worldSettings as Record<string, unknown>).newFeature = { enabled: true };

    const report = collectDroppedFields(layout, validateLayout(layout), "layout");
    assert.deepEqual(report.paths, ["layout.instances[0].glowIntensity", "layout.worldSettings.newFeature"]);
    const warning = formatDroppedFieldWarning(report, "playground.json");
    assert.match(warning ?? "", /2 field\(s\) were dropped/);
    assert.match(warning ?? "", /tools\/saveValidator\.ts/);
  });

  check("the save payload wrapper reports drops from the layout it carries", () => {
    const layout = playgroundLayout();
    (layout.instances as Record<string, unknown>[])[0]!.unknownFlag = true;
    const payload = validateSavePayload({ layout, editor: { gridSize: 1 } });
    const report = collectDroppedFields(layout, payload.layout, "layout");
    assert.deepEqual(report.paths, ["layout.instances[0].unknownFlag"]);
  });

  check("normalization is not a loss: added defaults and coerced values stay quiet", () => {
    const report = collectDroppedFields(
      { name: "level", count: "3", nested: { a: 1 } },
      { name: "level", count: 3, nested: { a: 1, b: 2 }, addedByValidator: true },
      "layout",
    );
    assert.deepEqual(report.paths, []);
  });

  check("a rejected array item is reported as a count, not as a shifted tail", () => {
    const report = collectDroppedFields(
      { items: [{ id: "a" }, { id: "bad" }, { id: "c" }] },
      { items: [{ id: "a" }, { id: "c" }] },
      "layout",
    );
    assert.deepEqual(report.paths, ["layout.items (1 of 3 item(s) dropped)"]);
  });

  check("nested keys are reported with a readable path, and the list is capped", () => {
    const input: Record<string, unknown> = { a: { b: { c: 1 } }, list: [{ x: 1 }] };
    const output: Record<string, unknown> = { a: { b: {} }, list: [{}] };
    assert.deepEqual(collectDroppedFields(input, output, "root").paths, [
      "root.a.b.c",
      "root.list[0].x",
    ]);

    const many: Record<string, unknown> = {};
    for (let index = 0; index < 10; index += 1) many[`field${index}`] = index;
    const capped = collectDroppedFields(many, {}, "root", 3);
    assert.equal(capped.paths.length, 3);
    assert.equal(capped.truncated, true);
    assert.match(formatDroppedFieldWarning(capped, "asset") ?? "", /, …\./);
  });

  check("a clean report formats to nothing at all", () => {
    assert.equal(formatDroppedFieldWarning({ paths: [], truncated: false }, "layout"), null);
  });
}
