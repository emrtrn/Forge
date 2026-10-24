import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  inferAssetTypeFromPath,
  validateAssetManifest,
} from "../../engine/assets/manifest";
import {
  createReferenceCarDefinition,
  normalizeVehicleAsset,
  normalizeVehicleDefinition,
  vehicleDefinitionFromComponent,
} from "../../engine/physics/vehicle/vehicleTypes";
import { normalizeActorScriptDef } from "../../engine/scene/actorScript";
import {
  createVehicleAssetLoader,
  resolveActorVehicleAssets,
} from "../../src/scene/vehicleAssetLoader";
import { collectDroppedFields } from "../../tools/droppedFields";
import {
  buildImportedAssetRecord,
  validateSaveActorPayload,
  validateSaveVehiclePayload,
} from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;
const PATH = "assets/starter-content/Gameplay/ReferenceCar.vehicle.json";

export async function registerVehicleAssetTests(check: Check, checkAsync: CheckAsync): Promise<void> {
  check("vehicle asset classification produces valid non-placeable manifest records", () => {
    assert.equal(inferAssetTypeFromPath(PATH), "vehicle");
    const asset = buildImportedAssetRecord(PATH, 100, [])!;
    assert.equal(asset.assetType, "vehicle");
    assert.equal(asset.placeable, false);
    const report = validateAssetManifest({ version: 1, generated: "2026-10-18", ktx2: false, assets: [asset] });
    assert.deepEqual(report.issues.filter((issue) => issue.level === "error"), []);
  });

  check("vehicle normalizer handles malformed JSON fields and preserves asset defaults under overrides", () => {
    assert.equal(normalizeVehicleDefinition(null), null);
    assert.equal(normalizeVehicleDefinition([]), null);
    const base = normalizeVehicleDefinition({ massKg: 800, maxEngineForce: 9000 })!;
    const normalized = vehicleDefinitionFromComponent({
      massKg: -1,
      maxEngineForce: "fast",
      centerOfMassOffset: { length: 3 },
      maxSteerAngleDeg: 999,
      wheels: [null, { position: [1, Number.NaN, 2] }, { radius: 5 }],
    }, base)!;
    assert.equal(normalized.massKg, 800);
    assert.equal(normalized.maxEngineForce, 9000);
    assert.equal(normalized.maxSteerAngleDeg, 80);
    assert.deepEqual(normalized.centerOfMassOffset, base.centerOfMassOffset);
    assert.deepEqual(normalized.wheels, base.wheels);
    assert.notEqual(normalized.wheels, base.wheels);
    const replaced = vehicleDefinitionFromComponent({
      maxEngineForce: 0,
      wheels: [{ position: [0, 0, 1], drive: true, brake: false, radius: -2 }],
    }, base)!;
    assert.equal(replaced.maxEngineForce, 0);
    assert.equal(replaced.wheels.length, 1);
    assert.equal(replaced.wheels[0]?.drive, true);
    assert.equal(replaced.wheels[0]?.brake, false);
    assert.equal(replaced.wheels[0]?.radius, 0.35);
  });

  check("vehicle asset saves retain every normalized field and report unknown fields", () => {
    const reference = createReferenceCarDefinition();
    const asset = normalizeVehicleAsset({ schema: 1, type: "vehicle", ...reference })!;
    const saved = validateSaveVehiclePayload({ path: PATH, vehicle: asset });
    assert.deepEqual(saved.vehicle, asset);
    assert.deepEqual(collectDroppedFields(asset, saved.vehicle).paths, []);
    const extra = { ...asset, ignored: true, wheels: [{ ...asset.wheels[0]!, ignoredWheel: 1 }] };
    const clean = validateSaveVehiclePayload({ path: PATH, vehicle: extra });
    assert.deepEqual([...collectDroppedFields(extra, clean.vehicle, "vehicle").paths].sort(),
      ["vehicle.ignored", "vehicle.wheels[0].ignoredWheel"]);
  });

  check("vehicle wheel width: an authored tyre width saves intact; invalid widths stay absent", () => {
    const reference = createReferenceCarDefinition();
    const wide = { ...reference, wheels: reference.wheels.map((wheel) => ({ ...wheel, width: 0.42 })) };
    const asset = normalizeVehicleAsset({ schema: 1, type: "vehicle", ...wide })!;
    assert.ok(asset.wheels.every((wheel) => wheel.width === 0.42));
    const saved = validateSaveVehiclePayload({ path: PATH, vehicle: asset });
    assert.deepEqual(saved.vehicle, asset);
    assert.deepEqual(collectDroppedFields(asset, saved.vehicle).paths, []);
    for (const width of [0, -0.3, Number.NaN, "wide", null]) {
      const wheel = normalizeVehicleDefinition({ wheels: [{ position: [1, 0, 1], width }] })!.wheels[0]!;
      assert.equal("width" in wheel, false, String(width));
    }
  });

  check("vehicle engine sound: the asset block saves intact, inline fields override one by one, null silences", () => {
    const asset = normalizeVehicleAsset(JSON.parse(readFileSync(`public/${PATH}`, "utf8")))!;
    assert.deepEqual(asset.engineSound, {
      sound: "starter-snd-engine-loop",
      idlePitch: 1,
      maxPitch: 2.2,
      idleVolume: 0.35,
      loadVolume: 0.9,
      speedForMaxPitch: 30,
      refDistance: 6,
      maxDistance: 80,
    });
    const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8")) as {
      assets: { id: string; assetType: string; path: string }[];
    };
    const sound = manifest.assets.find((entry) => entry.id === asset.engineSound!.sound);
    assert.equal(sound?.assetType, "sound", "the reference car's engine is a manifest sound");
    assert.ok(readFileSync(`public/${sound!.path}`).length > 1000);

    const saved = validateSaveVehiclePayload({ path: PATH, vehicle: asset });
    assert.deepEqual(saved.vehicle.engineSound, asset.engineSound);
    assert.deepEqual(collectDroppedFields(asset, saved.vehicle).paths, []);

    const tuned = vehicleDefinitionFromComponent({ engineSound: { maxPitch: 3, idleVolume: "loud" } }, asset)!;
    assert.deepEqual(tuned.engineSound, { ...asset.engineSound!, maxPitch: 3 });
    assert.equal(vehicleDefinitionFromComponent({ engineSound: null }, asset)!.engineSound, null);
    assert.deepEqual(vehicleDefinitionFromComponent({ massKg: 900 }, asset)!.engineSound, asset.engineSound);

    // No sound id to play, and none to inherit: no engine sound at all.
    assert.equal(normalizeVehicleDefinition({ engineSound: { idlePitch: 1 } })!.engineSound, null);
    assert.equal(normalizeVehicleDefinition({})!.engineSound, null);
    const clamped = normalizeVehicleDefinition({
      engineSound: { sound: "  engine  ", idlePitch: 99, idleVolume: 2, refDistance: 50, maxDistance: 10 },
    })!.engineSound!;
    assert.equal(clamped.sound, "engine");
    assert.equal(clamped.idlePitch, 4);
    assert.equal(clamped.idleVolume, 1);
    assert.equal(clamped.maxDistance, 51, "the far end stays past the near one");
  });

  check("vehicle asset saves reject invalid envelopes and unsafe paths", () => {
    const vehicle = { schema: 1, type: "vehicle" };
    for (const path of ["../x.vehicle.json", "assets/../x.vehicle.json", "assets\\..\\x.vehicle.json",
      "/x.vehicle.json", "C:\\x.vehicle.json", "https://a/x.vehicle.json", "assets/%2e%2e/x.vehicle.json",
      "assets//x.vehicle.json", "assets/./x.vehicle.json", "x.json", "x\u0000.vehicle.json"]) {
      assert.throws(() => validateSaveVehiclePayload({ path, vehicle }), undefined, path);
    }
    for (const body of [null, [], {}, { schema: 2, type: "vehicle" }, { schema: 1, type: "effect" }]) {
      assert.equal(normalizeVehicleAsset(body), null);
      assert.throws(() => validateSaveVehiclePayload({ path: PATH, vehicle: body }));
    }
    assert.equal(validateSaveVehiclePayload({ path: "assets\\car.vehicle.json", vehicle }).path,
      "assets/car.vehicle.json");
  });

  check("vehicle component asset and inline wheel props survive the actor save path", () => {
    const actor = normalizeActorScriptDef(JSON.parse(readFileSync(
      "public/assets/starter-content/Gameplay/Script_ReferenceCar.actor.json", "utf8")));
    const node = actor.components.find((node) => node.component === "Vehicle")!;
    node.props = { asset: PATH, ...JSON.parse(JSON.stringify(createReferenceCarDefinition())), massKg: 950 };
    const saved = validateSaveActorPayload({ path: "assets/test.actor.json", actor });
    const reloaded = normalizeActorScriptDef(JSON.parse(JSON.stringify(saved.actor)));
    assert.deepEqual(reloaded.components.find((node) => node.component === "Vehicle")?.props, node.props);
    assert.deepEqual(collectDroppedFields(actor, saved.actor).paths, []);
  });

  await checkAsync("vehicle asset loader caches parallel reads and actor resolution leaves authored props intact", async () => {
    let reads = 0;
    const asset = { schema: 1, type: "vehicle", massKg: 800, maxEngineForce: 9000 };
    const load = createVehicleAssetLoader(async (url) => {
      reads += 1;
      assert.equal(url, `/${PATH}`);
      return new Response(JSON.stringify(asset));
    });
    const def = normalizeActorScriptDef({ components: [{ id: "car", component: "Vehicle", props: {
      asset: PATH, massKg: 950,
    } }] });
    const original = JSON.stringify(def);
    const [first, second] = await Promise.all([
      resolveActorVehicleAssets(def, load), resolveActorVehicleAssets(def, load),
    ]);
    assert.equal(reads, 1);
    assert.equal(JSON.stringify(def), original);
    const props = first.components.find((node) => node.component === "Vehicle")!.props;
    assert.equal(props.massKg, 950);
    assert.equal(props.maxEngineForce, 9000);
    assert.deepEqual(second, first);
  });

  await checkAsync("vehicle asset loader tolerates missing malformed and failed static reads", async () => {
    for (const response of [new Response("missing", { status: 404 }), new Response("{"),
      new Response(JSON.stringify({ schema: 2, type: "vehicle" }))]) {
      const load = createVehicleAssetLoader(async () => response);
      assert.equal(await load(PATH), null);
    }
    const load = createVehicleAssetLoader(async () => { throw new Error("offline"); });
    assert.equal(await load(PATH), null);
    let reads = 0;
    const fenced = createVehicleAssetLoader(async () => { reads += 1; return new Response("{}"); });
    assert.equal(await fenced("../bad.vehicle.json"), null);
    assert.equal(reads, 0);
    const def = normalizeActorScriptDef({ components: [{ id: "car", component: "Vehicle", props: {
      asset: PATH, massKg: 950,
    } }] });
    const fallback = await resolveActorVehicleAssets(def, load);
    const props = fallback.components.find((node) => node.component === "Vehicle")!.props;
    assert.equal(props.massKg, 950);
    assert.equal((props.wheels as unknown[]).length, 4);
  });
}
