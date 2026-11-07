/**
 * Track step 2e: scene checks across stages — roads crossing building pads and
 * entrances meeting their pad off level (the Derekavak greybox findings).
 */
import assert from "node:assert/strict";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import { checkScene, type CheckPad, type CheckRoad } from "../../engine/worldbuilder/sceneCheck";

type Check = (label: string, fn: () => void) => void;

const pad: CheckPad = { id: "house", polygon: [[0, 0], [12, 0], [12, 9], [0, 9]] as WorldPoint[], height: 50 };
const road = (id: string, points: Array<[number, number, number]>, width = 4.5): CheckRoad => ({ id, points, width });

export function registerSceneCheckTests(check: Check): void {
  check("scene check: a road through a pad is reported; one beside it is not", () => {
    const through = road("through", [[-20, 50, 4], [40, 50, 4]]);
    const beside = road("beside", [[-20, 50, -4], [40, 50, -4]]);
    const issues = checkScene([through, beside], [pad]);
    assert.deepEqual(issues.map((issue) => [issue.kind, issue.road]), [["roadCrossesPad", "through"]]);
    assert.match(issues[0]!.message, /^road through runs [\d.]+ m into pad house$/);
    // Grazing the edge by less than the overlap allowance is fine.
    assert.deepEqual(checkScene([road("graze", [[-20, 50, -1.9], [40, 50, -1.9]])], [pad]), []);
  });

  check("scene check: a road ending at a pad is its entrance; off level it is reported", () => {
    // Arrives from the south and stops at the front edge (z = 0).
    const level = road("drive", [[6, 50, -30], [6, 50, -10], [6, 50, -1]]);
    assert.deepEqual(checkScene([level], [pad]), [], "an entrance at the pad's level, touching its edge");
    const low = road("cutting", [[6, 47, -30], [6, 47, -10], [6, 47, -1]]);
    const issues = checkScene([low], [pad]);
    assert.deepEqual(issues.map((issue) => issue.kind), ["entranceStep"]);
    assert.equal(issues[0]!.message, "road cutting reaches pad house 3 m below its level");
    // Leaving from the pad's edge is the same entrance, the other way round.
    assert.deepEqual(checkScene([road("leaving", [[6, 47, -1], [6, 47, -30]])], [pad]).map((issue) => issue.kind), ["entranceStep"]);
    // A road running past the front and ending beside the pad (at a junction, say) is not its entrance.
    const past = road("past", [[-30, 47, -3], [6, 47, -3]]);
    assert.deepEqual(checkScene([past], [pad]), []);
    // An entrance that runs on into the pad still crosses it.
    const into = road("into", [[6, 50, -30], [6, 50, 6]]);
    assert.deepEqual(checkScene([into], [pad]).map((issue) => issue.kind), ["roadCrossesPad"]);
  });
}
