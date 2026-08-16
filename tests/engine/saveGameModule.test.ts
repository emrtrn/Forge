/**
 * Phase E: save-game is a Layer 2 capability module.
 *
 * The checks drive the module the way the runtime shell does — attach, build a
 * level, click a save widget, cross a checkpoint — with an in-memory storage
 * adapter and each host service stubbed, and pin the degraded paths that make
 * the module optional (no gameplay state, no travel, no UI, and the shell-side
 * case of no save module at all).
 */
import assert from "node:assert/strict";
import { PerspectiveCamera, Scene } from "three";

import { EngineApp } from "../../engine/core/EngineApp";
import type { StorageAdapter } from "../../engine/persistence/saveGameStore";
import type { GameSaveRestoreRequest, GameSaveState } from "../../engine/persistence/saveGameState";
import { UiViewModelStore } from "../../engine/ui/uiViewModel";
import type { RoomLayout } from "../../engine/scene/layout";
import type { SceneDocument } from "../../engine/scene/sceneDocument";
import type { AssetLoader } from "../../src/scene/assetLoader";
import { createCapabilityRegistry } from "../../src/scene/capabilities/capabilityRegistry";
import { createRuntimeContext } from "../../src/scene/capabilities/RuntimeContext";
import { createSaveGameModule } from "../../src/scene/capabilities/saveGameModule";
import {
  createRuntimeServiceHost,
  type RuntimeServiceHost,
} from "../../src/scene/capabilities/RuntimeServices";
import {
  gameplaySaveStateService,
  levelTravelService,
  projectIdentityService,
  saveGameCommandsService,
  uiScreenStackService,
  uiViewModelService,
} from "../../src/scene/capabilities/runtimeServiceKeys";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => void;

const LEVEL_A = "layouts/level-a.json";
const LEVEL_B = "layouts/level-b.json";

function memoryStorage(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    keys: () => [...map.keys()],
  };
}

function saveState(levelPath: string, z: number): GameSaveState {
  return {
    activeLevelPath: levelPath,
    player: { position: [0, 0, z], facingYawDeg: 90 },
    flags: [{ entityId: "door:0", key: "open", value: true }],
  };
}

function levelContext(host: RuntimeServiceHost, levelPath: string) {
  return createRuntimeContext({
    mode: "runtime",
    levelPath,
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    engineApp: new EngineApp(),
    assetLoader: { loadManifest: async () => ({ assets: [] }) } as unknown as AssetLoader,
    layout: { name: "test" } as unknown as RoomLayout,
    sceneDocument: { schema: 1, name: "test", entities: [] } as unknown as SceneDocument,
    services: host,
  });
}

/** A host wired the way `RuntimeSceneApp` wires it, with every dependency observable. */
function testHost(): {
  host: RuntimeServiceHost;
  uiStore: UiViewModelStore;
  travelled: string[];
  restored: GameSaveRestoreRequest[];
  clearedScreens: () => number;
  setCapture: (state: GameSaveState | null) => void;
} {
  const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
  const uiStore = new UiViewModelStore();
  const travelled: string[] = [];
  const restored: GameSaveRestoreRequest[] = [];
  let screensCleared = 0;
  let capture: GameSaveState | null = saveState(LEVEL_A, -4);

  host.provide(projectIdentityService, () => "forge-test");
  host.provide(gameplaySaveStateService, {
    capture: () => capture,
    restore: (request) => restored.push(request),
  });
  host.provide(levelTravelService, (levelPath) => travelled.push(levelPath));
  host.provide(uiViewModelService, uiStore);
  host.provide(uiScreenStackService, { clearScreens: () => (screensCleared += 1) });

  return {
    host,
    uiStore,
    travelled,
    restored,
    clearedScreens: () => screensCleared,
    setCapture: (state) => {
      capture = state;
    },
  };
}

export async function registerSaveGameModuleTests(
  check: Check,
  checkAsync: CheckAsync,
): Promise<void> {
  await checkAsync("save-game module writes a slot, seeds its UI fields and restores on load", async () => {
    const { host, uiStore, travelled, restored, clearedScreens } = testHost();
    const registry = createCapabilityRegistry([createSaveGameModule({ storage: memoryStorage() })]);
    registry.runtimeStart(host);
    const commands = host.resolve(saveGameCommandsService);
    assert.ok(commands, "the module publishes its command surface at start");

    await registry.levelLoaded(levelContext(host, LEVEL_A));
    assert.equal(uiStore.getField("save.slots.quick.status"), "Empty");
    assert.equal(uiStore.getField("save.slots.quick.label"), "Quick Save");

    // A save widget click writes the slot and the menu reflects it immediately.
    assert.equal(commands.handleUiMessage("save:write:quick"), true);
    assert.match(String(uiStore.getField("save.slots.quick.status")), /^Saved /);
    assert.equal(uiStore.getField("save.slots.quick.level"), "level-a.json");

    // Loading travels to the saved level and closes the menu it was clicked in.
    assert.equal(commands.handleUiMessage("save:load:quick"), true);
    assert.deepEqual(travelled, [LEVEL_A]);
    assert.equal(clearedScreens(), 1);
    assert.deepEqual(restored, [], "nothing is restored until that level is built");

    // The restore lands when — and only when — the saved level finishes loading.
    await registry.levelLoaded(levelContext(host, LEVEL_B));
    assert.deepEqual(restored, [], "a different level leaves the restore latched");
    await registry.levelLoaded(levelContext(host, LEVEL_A));
    assert.equal(restored.length, 1);
    assert.deepEqual(restored[0]?.player, { position: [0, 0, -4], facingYawDeg: 90 });
    assert.deepEqual(restored[0]?.persistentState, [
      { entityId: "door:0", key: "open", value: true },
    ]);

    // Applied once: a later build of the same level must not replay it.
    await registry.levelLoaded(levelContext(host, LEVEL_A));
    assert.equal(restored.length, 1);

    assert.equal(commands.handleUiMessage("save:delete:quick"), true);
    assert.equal(uiStore.getField("save.slots.quick.status"), "Empty");
    assert.equal(commands.handleUiMessage("travel:layouts/other.json"), false, "not a save message");
  });

  await checkAsync("save-game module autosaves from a checkpoint and drops a superseded load", async () => {
    const { host, uiStore, travelled, restored } = testHost();
    const registry = createCapabilityRegistry([createSaveGameModule({ storage: memoryStorage() })]);
    registry.runtimeStart(host);
    const commands = host.resolve(saveGameCommandsService)!;
    await registry.levelLoaded(levelContext(host, LEVEL_A));

    commands.writeCheckpointSave("quick");
    assert.match(String(uiStore.getField("save.slots.quick.status")), /^Saved /);

    // A portal travel that supersedes a load in flight must not re-apply the
    // save state on arrival.
    assert.equal(commands.requestSaveGameLoad(saveState(LEVEL_A, -9)), true);
    assert.deepEqual(travelled, [LEVEL_A]);
    commands.clearPendingRestore();
    await registry.levelLoaded(levelContext(host, LEVEL_A));
    assert.deepEqual(restored, []);

    // A malformed payload is rejected rather than latched.
    assert.equal(commands.requestSaveGameLoad({ nope: true }), false);
    assert.deepEqual(travelled, [LEVEL_A]);
  });

  await checkAsync("save-game module degrades instead of failing when host services are missing", async () => {
    // No gameplay state to capture: the slot reports it rather than persisting
    // an empty save.
    const withoutState = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    const uiStore = new UiViewModelStore();
    withoutState.provide(projectIdentityService, () => "forge-test");
    withoutState.provide(uiViewModelService, uiStore);
    const stateless = createCapabilityRegistry([
      createSaveGameModule({ storage: memoryStorage() }),
    ]);
    stateless.runtimeStart(withoutState);
    await stateless.levelLoaded(levelContext(withoutState, LEVEL_A));
    assert.equal(withoutState.resolve(saveGameCommandsService)!.handleUiMessage("save:write:quick"), true);
    assert.equal(uiStore.getField("save.slots.quick.status"), "Save unavailable");

    // A bare host — no project, no UI, no travel — still boots the level, and
    // every command is a no-op instead of a throw.
    const bare = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    const registry = createCapabilityRegistry([createSaveGameModule({ storage: memoryStorage() })]);
    registry.runtimeStart(bare);
    const commands = bare.resolve(saveGameCommandsService)!;
    await registry.levelLoaded(levelContext(bare, LEVEL_A));
    assert.equal(commands.handleUiMessage("save:load:quick"), true);
    assert.equal(commands.requestSaveGameLoad(saveState(LEVEL_A, 0)), false, "nowhere to travel");
    commands.writeCheckpointSave("quick");
    registry.levelUnloaded();
    registry.dispose();
  });

  check("a runtime without the save module resolves no save commands", () => {
    // The opt-out case the shell must tolerate (I3): checkpoints and `save:*`
    // widget messages find nothing, and the level is otherwise untouched.
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    createCapabilityRegistry([]).runtimeStart(host);
    assert.equal(host.resolve(saveGameCommandsService), undefined);
  });
}
