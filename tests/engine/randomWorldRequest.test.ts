/**
 * `/__world-random` request allowlist (`tools/world/randomWorldRequest.ts`):
 * the World Builder window's choices pass as they are, anything else is refused.
 */
import assert from "node:assert/strict";
import { validateRandomWorldRequest } from "../../tools/world/randomWorldRequest";
import { WORLD_BUILD_STEPS } from "../../tools/world/worldBriefBuild";

type Check = (label: string, run: () => void) => void;

const VALID = {
  out: "assets/Worlds/My World.level.json",
  world: {
    seed: 48213, size: "medium", landform: "valley", mountainHeight: "high",
    settlements: [{ type: "village" }, { type: "town" }], roads: "exits", rivers: 2, lakes: 1,
    cover: "alpine", densities: { forest: "low", rocks: "high" },
  },
};

function refuses(change: (body: Record<string, any>) => void, pattern: RegExp): void {
  const body = structuredClone(VALID) as Record<string, any>;
  change(body);
  assert.throws(() => validateRandomWorldRequest(body), pattern);
}

export function registerRandomWorldRequestTests(check: Check): void {
  check("random world request: the window's choices pass unchanged", () => {
    const request = validateRandomWorldRequest(VALID);
    assert.equal(request.out, VALID.out);
    assert.equal(request.force, false);
    assert.deepEqual(request.world, VALID.world);
    assert.equal(validateRandomWorldRequest({ ...VALID, force: true }).force, true);
    assert.deepEqual(validateRandomWorldRequest({ ...VALID, out: "assets\\Worlds\\A.level.json" }).out, "assets/Worlds/A.level.json");
    const bare = validateRandomWorldRequest({ ...VALID, world: { ...VALID.world, rivers: undefined, lakes: undefined, densities: undefined } });
    assert.equal(bare.world.rivers, 0);
    assert.deepEqual(bare.world.densities, {});
  });

  check("random world request: levels stay under assets/ with plain names", () => {
    for (const out of [
      "layouts/A.level.json", "assets/../project.3dgame.json", "assets/a/../../b.level.json", "/assets/A.level.json",
      "assets/A.json", "assets/.level.json", "C:/x/A.level.json", "assets//A.level.json", "assets/A<b>.level.json", "assets/A .level.json ",
    ]) refuses((body) => { body.out = out; }, /out/);
  });

  check("random world request: only known choices", () => {
    refuses((body) => { body.extra = 1; }, /unknown field/);
    refuses((body) => { body.world.player = true; }, /unknown field/);
    refuses((body) => { body.world.size = "huge"; }, /world\.size/);
    refuses((body) => { body.world.landform = "canyon"; }, /world\.landform/);
    refuses((body) => { body.world.rivers = 4; }, /world\.rivers/);
    refuses((body) => { body.world.lakes = 1.5; }, /world\.lakes/);
    refuses((body) => { body.world.seed = -1; }, /world\.seed/);
    refuses((body) => { body.world.settlements = Array.from({ length: 9 }, () => ({ type: "hamlet" })); }, /settlements/);
    refuses((body) => { body.world.settlements = [{ type: "city" }]; }, /settlements\[0\]\.type/);
    refuses((body) => { body.world.settlements = [{ type: "village", population: 9000 }]; }, /unknown field/);
    refuses((body) => { body.world.densities = { trees: "high" }; }, /unknown field/);
    refuses((body) => { body.world.densities = { forest: "extreme" }; }, /densities\.forest/);
    refuses((body) => { body.force = "yes"; }, /force/);
  });

  check("random world request: build steps are reported in order", () => {
    assert.deepEqual([...WORLD_BUILD_STEPS], ["terrain", "paint", "settlements", "roads", "ground", "placements", "files"]);
  });
}
