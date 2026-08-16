/**
 * Phase E: the runtime UI (HUD, screens, world widgets) is a Layer 2 capability.
 *
 * These checks run in a DOM-less host on purpose: without an `#ui-overlay` the
 * module must mount nothing and every presenter call must stay a no-op, which is
 * exactly the shape a fork with its own HUD (or a headless test) sees. The rest
 * pins the contract the shell depends on — the presenter service exists whether
 * or not anything mounted, and reserved widget messages route through the shell.
 */
import assert from "node:assert/strict";
import { PerspectiveCamera, Scene } from "three";

import { EngineApp } from "../../engine/core/EngineApp";
import type { RoomLayout } from "../../engine/scene/layout";
import type { SceneDocument } from "../../engine/scene/sceneDocument";
import { UiViewModelStore } from "../../engine/ui/uiViewModel";
import type { AssetLoader } from "../../src/scene/assetLoader";
import { createCapabilityRegistry } from "../../src/scene/capabilities/capabilityRegistry";
import { createRuntimeContext } from "../../src/scene/capabilities/RuntimeContext";
import { createRuntimeUiModule } from "../../src/scene/capabilities/runtimeUiModule";
import {
  createRuntimeServiceHost,
  type RuntimeServiceHost,
} from "../../src/scene/capabilities/RuntimeServices";
import {
  localizationService,
  uiDebugService,
  uiHostService,
  uiPresenterService,
  uiViewModelService,
} from "../../src/scene/capabilities/runtimeServiceKeys";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => void;

function levelContext(host: RuntimeServiceHost, layout: Partial<RoomLayout>) {
  return createRuntimeContext({
    mode: "runtime",
    levelPath: "layouts/test.json",
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    engineApp: new EngineApp(),
    assetLoader: { loadManifest: async () => ({ assets: [] }) } as unknown as AssetLoader,
    layout: { name: "test", ...layout } as unknown as RoomLayout,
    sceneDocument: { schema: 1, name: "test", entities: [] } as unknown as SceneDocument,
    services: host,
  });
}

export async function registerRuntimeUiModuleTests(
  check: Check,
  checkAsync: CheckAsync,
): Promise<void> {
  await checkAsync("runtime UI module mounts nothing in a host with no overlay element", async () => {
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    let menuPolls = 0;
    let localeLoads = 0;
    host.provide(uiViewModelService, new UiViewModelStore());
    host.provide(localizationService, {
      ensureLoaded: async () => {
        localeLoads += 1;
      },
      registry: () => null,
      resolveSubtitle: () => undefined,
    });
    host.provide(uiHostService, {
      menuPressed: () => {
        menuPolls += 1;
        return true;
      },
      onScreenStackChange: () => {},
      viewportSize: () => ({ width: 800, height: 600 }),
      resolveEntityPosition: () => false,
      handleReservedMessage: () => false,
    });

    const registry = createCapabilityRegistry([createRuntimeUiModule()]);
    registry.runtimeStart(host);

    const presenter = host.resolve(uiPresenterService);
    assert.ok(presenter, "the shell can always resolve a presenter, mounted or not");
    assert.equal(host.resolve(uiDebugService)?.host(), null);

    // A layout that authors a HUD, but no DOM to mount it into.
    await registry.levelLoaded(levelContext(host, { worldSettings: { hudWidget: "hud" } } as never));
    assert.equal(localeLoads, 0, "no mount means no widget/locale loading at all");

    // Every presenter call degrades to a no-op rather than throwing.
    assert.equal(presenter.screenDepth(), 0);
    assert.equal(presenter.pushWidget("hud"), false);
    assert.equal(presenter.showOutcomeScreen("won"), false);
    presenter.openPauseMenu();
    presenter.clearScreens();
    presenter.projectWorldWidgets();

    // With nothing mounted the menu edge is never even polled.
    registry.update(1 / 60);
    assert.equal(menuPolls, 0);

    registry.levelUnloaded();
    registry.dispose();
  });

  await checkAsync("runtime UI module skips asset loading for a level that authors no UI", async () => {
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    let manifestReads = 0;
    const registry = createCapabilityRegistry([createRuntimeUiModule()]);
    registry.runtimeStart(host);
    await registry.levelLoaded(
      createRuntimeContext({
        mode: "runtime",
        levelPath: "layouts/bare.json",
        scene: new Scene(),
        camera: new PerspectiveCamera(),
        engineApp: new EngineApp(),
        assetLoader: {
          loadManifest: async () => {
            manifestReads += 1;
            return { assets: [] };
          },
        } as unknown as AssetLoader,
        layout: { name: "bare" } as unknown as RoomLayout,
        sceneDocument: { schema: 1, name: "bare", entities: [] } as unknown as SceneDocument,
        services: host,
      }),
    );
    assert.equal(manifestReads, 0, "a scene with no authored UI pays nothing");
  });

  check("a runtime without the UI module resolves no presenter", () => {
    // The opt-out case (I3): a fork with its own HUD switches the module off and
    // the shell's `uiPresenter()?.` calls all become no-ops.
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    createCapabilityRegistry([]).runtimeStart(host);
    assert.equal(host.resolve(uiPresenterService), undefined);
    assert.equal(host.resolve(uiDebugService), undefined);
  });
}
