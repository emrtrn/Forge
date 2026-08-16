/**
 * Layer 2 capability: Runtime UI — the HUD, the screen stack and world-space
 * widgets.
 *
 * Owns what used to be `setupRuntimeUi` in `RuntimeSceneApp`: loading the
 * level's `.ui.json` widgets and their themes, mounting {@link RuntimeUiSubsystem}
 * (HUD + screens) and {@link WorldUiSubsystem} (projected billboards), the pause
 * menu, and routing widget `message` actions.
 *
 * The split with the shell is *presentation vs. data*: this module decides how a
 * widget is loaded, mounted and shown; the shell keeps the ViewModel store the
 * widgets bind to (many shell systems write `player.*`, `loading.*`, `graphics.*`
 * into it), the locale registry (shared with dialogue subtitles) and the game
 * rules that decide *what* to show — rules are Layer 3, and a capability module
 * may not import game code.
 *
 * Everything it needs from outside is resolved from the service container:
 *   - no UI host element → nothing mounts, and every presenter call is a no-op;
 *   - no `ui-host` service → no menu key, no world-widget projection, and
 *     reserved messages are not intercepted (they still reach gameplay);
 *   - no script-message bus → widget messages simply go nowhere.
 * Switching this module off removes the HUD, menus and world widgets; the level,
 * its rules and its scripts keep running headless (an RTS with its own DOM HUD
 * is exactly that case).
 */
import type { PerspectiveCamera } from "three";

import { assetPath, assetType } from "@engine/assets/manifest";
import { normalizeUiThemeDef, type UiThemeDef } from "@engine/ui/uiTheme";
import { normalizeUiWidgetDef, type UiWidgetDef } from "@engine/ui/uiWidget";
import { normalizeWorldWidgets } from "@engine/ui/uiWorldWidget";
import { projectFileUrl } from "@/project/ProjectSystem";
import { RuntimeUiSubsystem } from "@/ui/RuntimeUiSubsystem";
import { WorldUiSubsystem } from "@/ui/WorldUiSubsystem";

import type { AssetLoader } from "../assetLoader";
import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeContext } from "./RuntimeContext";
import type { RuntimeServices } from "./RuntimeServices";
import {
  localizationService,
  scriptMessageBusService,
  uiDebugService,
  uiHostService,
  uiPresenterService,
  uiViewModelService,
} from "./runtimeServiceKeys";

export const RUNTIME_UI_MODULE_ID = "runtime-ui";

/** The overlay element both UI hosts mount into; null in a host without a DOM. */
function uiOverlayHost(): HTMLElement | null {
  return typeof document !== "undefined" ? document.getElementById("ui-overlay") : null;
}

export function createRuntimeUiModule(): CapabilityModule {
  let services: RuntimeServices | null = null;
  let screens: RuntimeUiSubsystem | null = null;
  let worldUi: WorldUiSubsystem | null = null;
  /** The level's camera, kept for projecting world-space widgets each frame. */
  let camera: PerspectiveCamera | null = null;
  /** All `.ui.json` defs of the current level, keyed by asset id (Include refs). */
  const widgetDefs = new Map<string, UiWidgetDef>();
  /** Theme defs keyed by the `theme` reference that pulled them in. */
  const themeDefs = new Map<string, UiThemeDef>();
  let pauseMenu: UiWidgetDef | null = null;
  let winScreen: UiWidgetDef | null = null;
  let loseScreen: UiWidgetDef | null = null;

  /** Loads every `.ui.json` widget so an Include ref in any widget resolves. */
  async function loadWidgetDefs(assetLoader: AssetLoader): Promise<void> {
    const manifest = await assetLoader.loadManifest();
    const uiAssets = manifest.assets.filter(
      (entry) => assetType(entry) === "ui" && assetPath(entry).endsWith(".ui.json"),
    );
    await Promise.all(
      uiAssets.map(async (asset) => {
        try {
          const response = await fetch(projectFileUrl(assetPath(asset)), { cache: "no-cache" });
          if (!response.ok) return;
          widgetDefs.set(asset.id, normalizeUiWidgetDef(await response.json(), asset.name));
        } catch {
          // Missing/malformed UI asset: skip it (the scene still plays).
        }
      }),
    );
  }

  /**
   * Loads the themes the loaded widgets reference (`def.theme`). A reference
   * resolves as a manifest `ui` asset id first, else as a direct public-relative
   * path. Missing/malformed themes are skipped — a themeless widget falls back
   * to the built-in CSS variables.
   */
  async function loadThemeDefs(assetLoader: AssetLoader): Promise<void> {
    const refs = new Set<string>();
    for (const widget of widgetDefs.values()) if (widget.theme) refs.add(widget.theme);
    if (refs.size === 0) return;
    const manifest = await assetLoader.loadManifest();
    await Promise.all(
      [...refs].map(async (ref) => {
        const asset = manifest.assets.find((entry) => entry.id === ref);
        const path = asset ? assetPath(asset) : ref;
        try {
          const response = await fetch(projectFileUrl(path), { cache: "no-cache" });
          if (!response.ok) return;
          themeDefs.set(ref, normalizeUiThemeDef(await response.json(), ref));
        } catch {
          // Missing/malformed theme: skip it (widget uses default CSS variables).
        }
      }),
    );
  }

  /**
   * Reserved messages (`game:*`, `travel:`, `save:*`, `settings:*`) are claimed
   * by the shell's chain; anything else is gameplay's, forwarded as a
   * `ui-action` script message.
   */
  function routeMessage(message: string): void {
    if (services?.resolve(uiHostService)?.handleReservedMessage(message)) return;
    services?.resolve(scriptMessageBusService)?.emit("ui-action", "ui", { message });
  }

  function mountScreens(host: HTMLElement, hudId: string | undefined): void {
    const store = services?.resolve(uiViewModelService);
    if (!store) return;
    const locale = services?.resolve(localizationService)?.registry() ?? null;
    screens = new RuntimeUiSubsystem(host, {
      store,
      ...(locale ? { locale } : {}),
      resolveTheme: (ref) => themeDefs.get(ref) ?? null,
      resolveWidget: (src) => widgetDefs.get(src) ?? null,
      onMessageAction: (action) => routeMessage(action.message),
      onScreenStackChange: (depth) => services?.resolve(uiHostService)?.onScreenStackChange(depth),
    });
    if (hudId) {
      const hud = widgetDefs.get(hudId);
      if (hud) screens.setHud(hud);
    }
  }

  function mountWorldWidgets(host: HTMLElement, context: RuntimeContext): void {
    const store = services?.resolve(uiViewModelService);
    if (!store) return;
    const widgets = normalizeWorldWidgets(context.layout.worldWidgets);
    if (widgets.length === 0) return;
    const locale = services?.resolve(localizationService)?.registry() ?? null;
    worldUi = new WorldUiSubsystem(host, {
      store,
      ...(locale ? { locale } : {}),
      resolveWidget: (src) => widgetDefs.get(src) ?? null,
      resolveTheme: (ref) => themeDefs.get(ref) ?? null,
      // World widgets sit outside the pause/menu stack, so they route through
      // the same reserved chain minus the screen-only `game:*` messages, which
      // the shell's chain declines anyway when no screen is open.
      onMessageAction: (action) => routeMessage(action.message),
      resolveEntityPosition: (entityId, target) =>
        services?.resolve(uiHostService)?.resolveEntityPosition(entityId, target) ?? false,
    });
    worldUi.setWidgets(widgets);
  }

  /** Pushes the level's pause menu, if it authored one and nothing is open. */
  function openPauseMenu(): void {
    if (!screens || !pauseMenu) return;
    if (screens.screenDepth > 0) return;
    screens.pushScreen(pauseMenu);
  }

  /** Drops every per-level host and asset; the next level reloads its own. */
  function unmount(): void {
    screens?.dispose();
    screens = null;
    worldUi?.dispose();
    worldUi = null;
    widgetDefs.clear();
    themeDefs.clear();
    pauseMenu = null;
    winScreen = null;
    loseScreen = null;
  }

  return {
    id: RUNTIME_UI_MODULE_ID,

    onRuntimeStart(runtimeServices) {
      services = runtimeServices;

      runtimeServices.provide(uiPresenterService, {
        screenDepth: () => screens?.screenDepth ?? 0,
        clearScreens: () => screens?.clearScreens(),
        openPauseMenu,
        pushWidget(widgetId) {
          const def = widgetDefs.get(widgetId);
          if (!screens || !def) return false;
          screens.pushScreen(def);
          return true;
        },
        showOutcomeScreen(outcome) {
          const def = outcome === "won" ? winScreen : loseScreen;
          if (!screens || !def) return false;
          if (screens.screenDepth > 0) screens.clearScreens();
          screens.pushScreen(def);
          return true;
        },
        projectWorldWidgets() {
          if (!worldUi || !camera) return;
          const size = services?.resolve(uiHostService)?.viewportSize();
          if (!size) return;
          worldUi.update(camera, size.width, size.height);
        },
      });

      runtimeServices.provide(uiDebugService, {
        host: () => screens?.getDebugSnapshot() ?? null,
        world: () => worldUi?.getDebugSnapshot() ?? { count: 0, visible: 0 },
      });
    },

    async onLevelLoaded(context) {
      camera = context.camera;
      const host = uiOverlayHost();
      if (!host) return;
      const settings = context.layout.worldSettings;
      const hudId = settings?.hudWidget;
      const wantsScreens = Boolean(
        hudId || settings?.pauseMenuWidget || settings?.winScreenWidget || settings?.loseScreenWidget,
      );
      const wantsWorldWidgets = normalizeWorldWidgets(context.layout.worldWidgets).length > 0;
      // A scene with no authored UI pays nothing: no asset loads, no DOM hosts.
      if (!wantsScreens && !wantsWorldWidgets) return;

      await loadWidgetDefs(context.assetLoader);
      await loadThemeDefs(context.assetLoader);
      // Widget text localizes against the same tables as dialogue subtitles, so
      // make sure they are loaded before either host binds to the registry.
      await context.resolve(localizationService)?.ensureLoaded();

      if (wantsScreens) {
        mountScreens(host, hudId);
        if (settings?.pauseMenuWidget) pauseMenu = widgetDefs.get(settings.pauseMenuWidget) ?? null;
        if (settings?.winScreenWidget) winScreen = widgetDefs.get(settings.winScreenWidget) ?? null;
        if (settings?.loseScreenWidget) loseScreen = widgetDefs.get(settings.loseScreenWidget) ?? null;
      }
      if (wantsWorldWidgets) mountWorldWidgets(host, context);
    },

    /**
     * The menu edge (Escape / gamepad Start) is consumed here — after the engine
     * has advanced input and before the Game Mode reads it — so opening a screen
     * suppresses this frame's camera and movement.
     */
    update() {
      if (!screens) return;
      if (!services?.resolve(uiHostService)?.menuPressed()) return;
      if (screens.screenDepth > 0) screens.back();
      else openPauseMenu();
    },

    onLevelUnloaded() {
      unmount();
    },

    dispose() {
      unmount();
      services = null;
    },
  };
}
