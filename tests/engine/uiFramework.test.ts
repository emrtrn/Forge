/** UI data/render contracts; the runner supplies filtering, timing and counters. */
import assert from "node:assert/strict";
import { formatUiDebug } from "../../src/scene/debugStats";
import { validateSaveUiPayload } from "../../tools/saveValidator";
import {
  createUiNode,
  defaultUiWidgetDef,
  findUiNode,
  findUiNodeParent,
  normalizeUiWidgetDef,
  readUiAction,
  readUiBindingPath,
  readUiTextKey,
  UI_WIDGET_KINDS,
  type UiNode,
} from "../../engine/ui/uiWidget";
import { buildUiRenderTree, buildUiRenderNode, resolveInlineStyle } from "../../engine/ui/uiRenderer";
import { UiViewModelStore } from "../../engine/ui/uiViewModel";
import { collectUiBindings, collectUiLocBindings, resolveUiBoundValue } from "../../engine/ui/uiBinding";
import { normalizeUiThemeDef, themeToCssVariables, tokenToCssVar } from "../../engine/ui/uiTheme";
import { applyLocParams, LocaleRegistry, normalizeUiLocaleTable } from "../../engine/ui/uiLocale";
import {
  normalizeUiTransition,
  transitionClasses,
  UI_TRANSITION_BASE_CLASS,
} from "../../engine/ui/uiTransition";
import {
  auditUiA11y,
  collectFocusables,
  isUiNodeFocusable,
  nextFocusIndex,
  normalizeUiA11y,
  resolveUiA11yAttrs,
} from "../../engine/ui/uiA11y";
import {
  ndcToScreen,
  normalizeWorldWidget,
  normalizeWorldWidgets,
  resolveWorldWidgetVisibility,
} from "../../engine/ui/uiWorldWidget";

type Check = (label: string, fn: () => void) => void;

export function registerUiFrameworkTests(check: Check): void {
  // --- UI Widget (UMG Lite): schema normalization + render-tree builder ---

  check("normalizeUiWidgetDef upgrades the legacy empty-root stub to a Canvas", () => {
    const def = normalizeUiWidgetDef({ schema: 1, type: "ui", name: "Menu", root: {} });
    assert.equal(def.type, "ui");
    assert.equal(def.name, "Menu");
    assert.equal(def.root.widget, "Canvas");
    assert.deepEqual(def.root.children, []);
    assert.deepEqual(def.preview, { width: 1280, height: 720 });
  });

  check("normalizeUiWidgetDef coerces garbage into a valid Canvas-rooted def", () => {
    const def = normalizeUiWidgetDef(null, "Fallback");
    assert.equal(def.name, "Fallback");
    assert.equal(def.root.widget, "Canvas");
  });

  check("normalizeUiWidgetDef maps unknown kinds to Panel and drops leaf children", () => {
    const def = normalizeUiWidgetDef({
      name: "X",
      root: {
        id: "root",
        widget: "Canvas",
        children: [
          { id: "weird", widget: "Hologram", children: [{ widget: "Text" }] },
          { id: "label", widget: "Text", props: { text: "hi" }, children: [{ widget: "Text" }] },
        ],
      },
    });
    const weird = def.root.children[0]!;
    const label = def.root.children[1]!;
    assert.equal(weird.widget, "Panel"); // unknown -> safe container, keeps its child
    assert.equal(weird.children.length, 1);
    assert.equal(label.widget, "Text"); // leaf drops authored children
    assert.equal(label.children.length, 0);
  });

  check("normalizeUiWidgetDef mints unique ids and dedupes collisions", () => {
    const def = normalizeUiWidgetDef({
      name: "X",
      root: {
        id: "dup",
        widget: "Stack",
        children: [{ id: "dup", widget: "Text" }, { widget: "Text" }],
      },
    });
    const ids: string[] = [];
    const walk = (node: UiNode): void => {
      ids.push(node.id);
      node.children.forEach(walk);
    };
    walk(def.root);
    assert.equal(ids.length, 3);
    assert.equal(new Set(ids).size, 3);
  });

  check("defaultUiWidgetDef is a minimal empty Canvas asset", () => {
    const def = defaultUiWidgetDef("HUD");
    assert.equal(def.schema, 1);
    assert.equal(def.type, "ui");
    assert.equal(def.name, "HUD");
    assert.equal(def.root.id, "root");
    assert.equal(def.root.widget, "Canvas");
    assert.equal(UI_WIDGET_KINDS.includes(def.root.widget), true);
  });

  check("readUiAction parses message + back actions and rejects malformed ones", () => {
    const def = normalizeUiWidgetDef({
      name: "X",
      root: {
        widget: "Canvas",
        children: [
          { id: "ok", widget: "Button", props: { onClick: { type: "message", message: "Go" } } },
          { id: "back", widget: "Button", props: { onClick: { type: "back" } } },
          { id: "bad", widget: "Button", props: { onClick: { type: "nope" } } },
        ],
      },
    });
    assert.deepEqual(readUiAction(def.root.children[0]!), { type: "message", message: "Go" });
    assert.deepEqual(readUiAction(def.root.children[1]!), { type: "back" });
    assert.equal(readUiAction(def.root.children[2]!), null);
  });

  check("readUiBindingPath extracts a binding path but not a literal", () => {
    const def = normalizeUiWidgetDef({
      name: "X",
      root: {
        widget: "Canvas",
        children: [
          { id: "hp", widget: "ProgressBar", props: { value: { bind: "player.health" }, max: 100 } },
        ],
      },
    });
    const bar = def.root.children[0]!;
    assert.equal(readUiBindingPath(bar, "value"), "player.health");
    assert.equal(readUiBindingPath(bar, "max"), undefined); // literal, not a binding
  });

  check("buildUiRenderTree maps the menu widget set to tags/classes/actions", () => {
    const def = normalizeUiWidgetDef({
      name: "Menu",
      root: {
        id: "root",
        widget: "Canvas",
        props: { align: "center", justify: "center" },
        children: [
          { id: "title", widget: "Text", props: { text: "Forge" } },
          {
            id: "start",
            widget: "Button",
            props: { text: "Start", onClick: { type: "message", message: "Go" } },
          },
        ],
      },
    });
    const tree = buildUiRenderTree(def);
    assert.equal(tree.tag, "div");
    assert.match(tree.className, /forge-ui-canvas/);
    assert.equal(tree.style["align-items"], "center");
    assert.equal(tree.style["justify-content"], "center");
    const title = tree.children[0]!;
    const start = tree.children[1]!;
    assert.equal(title.tag, "div");
    assert.match(title.className, /forge-ui-text/);
    assert.equal(title.text, "Forge");
    assert.equal(start.tag, "button");
    assert.match(start.className, /ui-interactive/);
    assert.equal(start.text, "Start");
    assert.deepEqual(start.action, { type: "message", message: "Go" });
  });

  check("resolveInlineStyle allowlists tokens (px, flex aliases, passthrough)", () => {
    const def = normalizeUiWidgetDef({
      name: "X",
      root: {
        widget: "Stack",
        props: { gap: 16, padding: 8, align: "between", background: "#101010", grow: 1 },
      },
    });
    const style = resolveInlineStyle(def.root);
    assert.equal(style["gap"], "16px");
    assert.equal(style["padding"], "8px");
    assert.equal(style["align-items"], "space-between");
    assert.equal(style["background"], "#101010");
    assert.equal(style["flex-grow"], "1");
  });

  check("ProgressBar renders a clamped inline-width fill child", () => {
    const def = normalizeUiWidgetDef({
      name: "X",
      root: {
        widget: "Canvas",
        children: [
          { id: "a", widget: "ProgressBar", props: { value: 30, max: 100 } },
          { id: "b", widget: "ProgressBar", props: { value: 999, max: 100 } },
        ],
      },
    });
    const tree = buildUiRenderTree(def);
    const a = tree.children[0]!;
    const b = tree.children[1]!;
    assert.equal(a.children.length, 1);
    assert.equal(a.children[0]!.synthetic, true);
    assert.equal(a.children[0]!.style["width"], "30.00%");
    assert.equal(b.children[0]!.style["width"], "100.00%"); // clamped to max
  });

  check("Stack direction sets the modifier class; default is column", () => {
    const row = buildUiRenderNode(
      normalizeUiWidgetDef({ name: "X", root: { widget: "Stack", props: { direction: "row" } } }).root,
    );
    const col = buildUiRenderNode(
      normalizeUiWidgetDef({ name: "X", root: { widget: "Stack" } }).root,
    );
    assert.match(row.className, /forge-ui-stack--row/);
    assert.match(col.className, /forge-ui-stack--column/);
  });

  check("createUiNode seeds default props per kind; containers start empty", () => {
    assert.deepEqual(createUiNode("Text", "t1"), { id: "t1", widget: "Text", props: { text: "Text" }, children: [] });
    assert.deepEqual(createUiNode("ProgressBar", "p1").props, { value: 50, max: 100 });
    assert.deepEqual(createUiNode("Stack", "s1").props, { direction: "column", gap: 8 });
    assert.deepEqual(createUiNode("Panel", "c1").props, {});
  });

  check("findUiNode + findUiNodeParent walk the widget tree", () => {
    const def = normalizeUiWidgetDef({
      name: "X",
      root: {
        id: "root",
        widget: "Canvas",
        children: [
          { id: "stack", widget: "Stack", children: [{ id: "label", widget: "Text" }] },
        ],
      },
    });
    assert.equal(findUiNode(def.root, "label")?.widget, "Text");
    assert.equal(findUiNode(def.root, "missing"), null);
    assert.equal(findUiNodeParent(def.root, "label")?.id, "stack");
    assert.equal(findUiNodeParent(def.root, "stack")?.id, "root");
    assert.equal(findUiNodeParent(def.root, "root"), null);
  });

  check("validateSaveUiPayload requires a .ui.json path and normalizes the body", () => {
    const payload = validateSaveUiPayload({
      path: "assets/ui/Main.ui.json",
      ui: { name: "Main", root: {} },
    });
    assert.equal(payload.path, "assets/ui/Main.ui.json");
    assert.equal((payload.ui as { type: string }).type, "ui");
    assert.equal((payload.ui as { root: { widget: string } }).root.widget, "Canvas");
    assert.throws(() => validateSaveUiPayload({ path: "assets/ui/Main.json", ui: {} }));
    assert.throws(() => validateSaveUiPayload({ path: "../secret.ui.json", ui: {} }));
  });

  check("UiViewModelStore notifies only changed fields and dedups unchanged writes", () => {
    const store = new UiViewModelStore();
    let health = 0;
    let gold = 0;
    store.subscribe("player.health", () => { health += 1; });
    store.subscribe("player.gold", () => { gold += 1; });
    store.setField("player.health", 100);
    store.setField("player.gold", 5);
    store.flush();
    assert.equal(health, 1);
    assert.equal(gold, 1);
    assert.equal(store.getField("player.health"), 100);
    store.setField("player.health", 100); // unchanged -> not dirty
    store.flush();
    assert.equal(health, 1);
  });

  check("UiViewModelStore fires a multi-path listener once per flush (batched)", () => {
    const store = new UiViewModelStore();
    let calls = 0;
    const apply = (): void => { calls += 1; };
    store.subscribe("a", apply);
    store.subscribe("b", apply);
    store.setField("a", 1);
    store.setField("b", 2);
    store.flush();
    assert.equal(calls, 1);
  });

  check("UiViewModelStore unsubscribe stops notifications", () => {
    const store = new UiViewModelStore();
    let calls = 0;
    const off = store.subscribe("x", () => { calls += 1; });
    store.setField("x", 1);
    store.flush();
    off();
    store.setField("x", 2);
    store.flush();
    assert.equal(calls, 1);
  });

  check("collectUiBindings + resolveUiBoundValue resolve bound vs static props", () => {
    const def = normalizeUiWidgetDef({
      name: "HUD",
      root: {
        widget: "Canvas",
        children: [
          { id: "bar", widget: "ProgressBar", props: { value: { bind: "player.hp" }, max: 100 } },
          { id: "label", widget: "Text", props: { text: { bind: "player.hpLabel" } } },
          { id: "plain", widget: "Text", props: { text: "Static" } },
        ],
      },
    });
    const bindings = collectUiBindings(def);
    assert.equal(bindings.length, 2); // bar + label (plain has no binding)
    const bar = findUiNode(def.root, "bar")!;
    const store = new UiViewModelStore();
    store.setField("player.hp", 42);
    assert.equal(resolveUiBoundValue(bar, "value", store), 42); // bound -> store field
    assert.equal(resolveUiBoundValue(bar, "max", store), 100); // static literal kept
    assert.equal(resolveUiBoundValue(bar, "value", new UiViewModelStore()), undefined);
  });

  check("normalizeUiThemeDef keeps scalar tokens and drops the rest", () => {
    const theme = normalizeUiThemeDef({
      name: "T",
      tokens: { "color.text": "#fff", "radius.lg": 12, bad: { x: 1 }, nan: Number.NaN },
    });
    assert.equal(theme.type, "uiTheme");
    assert.equal(theme.tokens["color.text"], "#fff");
    assert.equal(theme.tokens["radius.lg"], 12);
    assert.equal("bad" in theme.tokens, false);
    assert.equal("nan" in theme.tokens, false);
  });

  check("themeToCssVariables maps tokens to --forge-ui vars (px for numbers)", () => {
    const vars = themeToCssVariables(
      normalizeUiThemeDef({ name: "T", tokens: { "color.surface": "#101010", "space.md": 12 } }),
    );
    assert.equal(vars["--forge-ui-color-surface"], "#101010");
    assert.equal(vars["--forge-ui-space-md"], "12px");
    assert.equal(tokenToCssVar("radius.lg"), "--forge-ui-radius-lg");
  });

  check("resolveInlineStyle resolves $token refs to CSS variables", () => {
    const def = normalizeUiWidgetDef({
      name: "X",
      root: {
        widget: "Stack",
        props: { background: "$color.surface", padding: "$space.lg", gap: 8 },
      },
    });
    const style = resolveInlineStyle(def.root);
    assert.equal(style["background"], "var(--forge-ui-color-surface)");
    assert.equal(style["padding"], "var(--forge-ui-space-lg)"); // token wins over px
    assert.equal(style["gap"], "8px"); // literal still px
  });

  check("Include node normalizes to a valid UiNode (not a container)", () => {
    const node = createUiNode("Include", "inc1");
    assert.equal(node.widget, "Include");
    assert.equal(node.props.src, "");
    assert.deepEqual(node.children, []);
  });

  check("buildUiRenderNode renders Include placeholder when resolveWidget is absent", () => {
    const def = normalizeUiWidgetDef({
      name: "Test",
      root: {
        id: "root",
        widget: "Canvas",
        children: [{ id: "inc", widget: "Include", props: { src: "some-widget" }, children: [] }],
      },
    });
    const tree = buildUiRenderTree(def);
    const incNode = tree.children[0];
    assert.ok(incNode, "Include child should exist");
    assert.equal(incNode.widget, "Include");
    assert.equal(incNode.text, "[some-widget]");
    assert.equal(incNode.children.length, 0);
  });

  check("buildUiRenderNode inlines referenced widget when resolveWidget returns a def", () => {
    const buttonDef = normalizeUiWidgetDef({
      name: "Button",
      root: { id: "btn-root", widget: "Button", props: { text: "Click" }, children: [] },
    });
    const parentDef = normalizeUiWidgetDef({
      name: "Parent",
      root: {
        id: "root",
        widget: "Canvas",
        children: [{ id: "inc", widget: "Include", props: { src: "my-button" }, children: [] }],
      },
    });
    const tree = buildUiRenderTree(parentDef, { resolveWidget: (src) => src === "my-button" ? buttonDef : null });
    const wrapper = tree.children[0];
    assert.ok(wrapper, "Include wrapper should exist");
    assert.equal(wrapper.widget, "Include");
    assert.equal(wrapper.style["display"], "contents");
    assert.equal(wrapper.children.length, 1);
    assert.equal(wrapper.children[0]!.widget, "Button");
    assert.equal(wrapper.children[0]!.text, "Click");
  });

  check("buildUiRenderNode guards against Include cycles (depth limit)", () => {
    let callCount = 0;
    const cyclicResolver = (): ReturnType<typeof normalizeUiWidgetDef> => {
      callCount += 1;
      return normalizeUiWidgetDef({
        name: "Cyclic",
        root: { id: "self", widget: "Include", props: { src: "self" }, children: [] },
      });
    };
    const def = normalizeUiWidgetDef({
      name: "Root",
      root: { id: "root", widget: "Include", props: { src: "self" }, children: [] },
    });
    // Should not throw or recurse infinitely; stops at MAX_INCLUDE_DEPTH (5)
    const tree = buildUiRenderTree(def, { resolveWidget: cyclicResolver });
    assert.ok(callCount <= 6, `resolver called ${callCount} times (expected ≤ 6)`);
    assert.ok(tree, "tree should be non-null after depth-limited recursion");
  });

  check("UiViewModelStore.snapshot returns path-sorted [path, value] pairs", () => {
    const store = new UiViewModelStore();
    store.setField("player.speed", 2.5);
    store.setField("inventory.gold", 10);
    store.setField("player.healthLabel", "100/100");
    assert.deepEqual(store.snapshot(), [
      ["inventory.gold", 10],
      ["player.healthLabel", "100/100"],
      ["player.speed", 2.5],
    ]);
  });

  check("formatUiDebug renders the HUD, screen stack, locale and bound fields", () => {
    const lines = formatUiDebug({
      hud: "Hud",
      screens: ["Menu", "Options"],
      locale: "tr",
      fields: [
        ["player.speed", 2.5],
        ["player.speedLabel", "Speed 2.5 m/s"],
      ],
      audit: [],
      world: { count: 2, visible: 1 },
    });
    assert.deepEqual(lines, [
      "ui",
      "hud: Hud",
      "screens(2): Menu > Options",
      "locale: tr",
      "world: 1/2",
      "fields(2):",
      '  player.speed = 2.5',
      '  player.speedLabel = "Speed 2.5 m/s"',
    ]);
  });

  check("formatUiDebug shows placeholders when nothing is mounted", () => {
    const lines = formatUiDebug({
      hud: null,
      screens: [],
      locale: null,
      fields: [],
      audit: [],
      world: { count: 0, visible: 0 },
    });
    assert.deepEqual(lines, [
      "ui",
      "hud: none",
      "screens: none",
      "locale: none",
      "world: 0/0",
      "fields: none",
    ]);
  });

  check("formatUiDebug clips long string values", () => {
    const long = "x".repeat(40);
    const lines = formatUiDebug({
      hud: null,
      screens: [],
      locale: null,
      fields: [["msg", long]],
      audit: [],
      world: { count: 0, visible: 0 },
    });
    assert.equal(lines.at(-1), `  msg = "${"x".repeat(29)}..."`);
  });

  check("formatUiDebug lists accessibility audit findings", () => {
    const lines = formatUiDebug({
      hud: null,
      screens: ["Menu"],
      locale: null,
      fields: [],
      audit: ['Menu: Button "go" — Button has no text or label'],
      world: { count: 0, visible: 0 },
    });
    assert.deepEqual(lines.slice(-2), [
      "a11y(1):",
      '  Menu: Button "go" — Button has no text or label',
    ]);
  });

  check("normalizeUiTransition: shorthand string expands to enter+exit", () => {
    assert.deepEqual(normalizeUiTransition("fade"), {
      enter: "fade",
      exit: "fade",
      durationMs: 160,
    });
  });

  check("normalizeUiTransition: object form keeps valid presets, clamps duration", () => {
    assert.deepEqual(normalizeUiTransition({ enter: "slide-up", exit: "scale", durationMs: 9999 }), {
      enter: "slide-up",
      exit: "scale",
      durationMs: 2000,
    });
  });

  check("normalizeUiTransition: invalid preset falls back to none on that end", () => {
    assert.deepEqual(normalizeUiTransition({ enter: "spin", exit: "fade", durationMs: 100 }), {
      enter: "none",
      exit: "fade",
      durationMs: 100,
    });
  });

  check("normalizeUiTransition: both ends none (or junk) → null (no-op)", () => {
    assert.equal(normalizeUiTransition({ enter: "none", exit: "none" }), null);
    assert.equal(normalizeUiTransition("none"), null);
    assert.equal(normalizeUiTransition(undefined), null);
    assert.equal(normalizeUiTransition(42), null);
  });

  check("transitionClasses: preset maps to base + offset, none/reduced → null", () => {
    assert.deepEqual(transitionClasses("slide-left"), {
      base: UI_TRANSITION_BASE_CLASS,
      offset: `${UI_TRANSITION_BASE_CLASS}-slide-left`,
    });
    assert.equal(transitionClasses("none"), null);
    assert.equal(transitionClasses("fade", true), null); // reduced motion
  });

  check("normalizeUiWidgetDef carries a valid transition and drops a no-op one", () => {
    const withTx = normalizeUiWidgetDef({
      name: "T",
      transition: { enter: "fade", exit: "fade", durationMs: 200 },
      root: { id: "root", widget: "Canvas", children: [] },
    });
    assert.deepEqual(withTx.transition, { enter: "fade", exit: "fade", durationMs: 200 });
    const noTx = normalizeUiWidgetDef({
      name: "T",
      transition: { enter: "none", exit: "none" },
      root: { id: "root", widget: "Canvas", children: [] },
    });
    assert.equal(noTx.transition, undefined);
  });

  check("normalizeUiLocaleTable keeps string entries and drops the rest", () => {
    const table = normalizeUiLocaleTable({
      locale: "tr",
      strings: { "menu.title": "Duraklatıldı", bad: 12, nested: { a: 1 }, ok: "Tamam" },
    });
    assert.equal(table.type, "uiLoc");
    assert.equal(table.locale, "tr");
    assert.equal(table.strings["menu.title"], "Duraklatıldı");
    assert.equal(table.strings.ok, "Tamam");
    assert.equal("bad" in table.strings, false);
    assert.equal("nested" in table.strings, false);
    // Garbage / missing locale falls back to the default "en".
    assert.equal(normalizeUiLocaleTable(null).locale, "en");
  });

  check("applyLocParams substitutes {name} and leaves unknown placeholders intact", () => {
    assert.equal(applyLocParams("build {version}", { version: "0.1" }), "build 0.1");
    assert.equal(applyLocParams("hi {name}", {}), "hi {name}"); // unknown param kept
    assert.equal(applyLocParams("plain text"), "plain text"); // no params
  });

  check("LocaleRegistry.resolve uses the active locale, params, and key fallback", () => {
    const registry = new LocaleRegistry();
    registry.register(normalizeUiLocaleTable({ locale: "en", strings: { "menu.resume": "Resume" } }));
    registry.register(normalizeUiLocaleTable({ locale: "tr", strings: { "menu.resume": "Devam Et" } }));
    assert.equal(registry.activeLocale, "en"); // first registered is active
    assert.equal(registry.resolve("menu.resume"), "Resume");
    registry.setActiveLocale("tr");
    assert.equal(registry.resolve("menu.resume"), "Devam Et");
    // Missing key falls back to the key itself (or a supplied default).
    assert.equal(registry.resolve("menu.missing"), "menu.missing");
    assert.equal(registry.resolve("menu.missing", undefined, "—"), "—");
    // Unknown locale is ignored (keeps the current one, never blanks).
    registry.setActiveLocale("fr");
    assert.equal(registry.activeLocale, "tr");
  });

  check("LocaleRegistry notifies subscribers only on a real locale change", () => {
    const registry = new LocaleRegistry();
    registry.register(normalizeUiLocaleTable({ locale: "en", strings: {} }));
    registry.register(normalizeUiLocaleTable({ locale: "tr", strings: {} }));
    let calls = 0;
    const off = registry.subscribe(() => {
      calls += 1;
    });
    registry.setActiveLocale("en"); // already active -> no notify
    registry.setActiveLocale("tr"); // change -> notify
    registry.setActiveLocale("zz"); // unknown -> no notify
    off();
    registry.setActiveLocale("en"); // unsubscribed -> not counted
    assert.equal(calls, 1);
  });

  check("readUiTextKey reads a localized text prop and sanitizes params", () => {
    const def = normalizeUiWidgetDef({
      name: "M",
      root: {
        widget: "Canvas",
        children: [
          { id: "t", widget: "Text", props: { text: { key: "menu.build", params: { version: 1, junk: { x: 1 } } } } },
          { id: "lit", widget: "Text", props: { text: "Static" } },
          { id: "bound", widget: "Text", props: { text: { bind: "player.label" } } },
        ],
      },
    });
    const textKey = readUiTextKey(findUiNode(def.root, "t")!, "text");
    assert.equal(textKey?.key, "menu.build");
    assert.deepEqual(textKey?.params, { version: "1" }); // number coerced, object dropped
    assert.equal(readUiTextKey(findUiNode(def.root, "lit")!, "text"), undefined);
    assert.equal(readUiTextKey(findUiNode(def.root, "bound")!, "text"), undefined);
  });

  check("buildUiRenderTree resolves localized text via resolveLoc (key fallback)", () => {
    const def = normalizeUiWidgetDef({
      name: "M",
      root: {
        widget: "Canvas",
        children: [
          { id: "t", widget: "Text", props: { text: { key: "menu.build", params: { version: "0.1" } } } },
          { id: "b", widget: "Button", props: { text: { key: "menu.resume" } } },
        ],
      },
    });
    const registry = new LocaleRegistry();
    registry.register(
      normalizeUiLocaleTable({
        locale: "en",
        strings: { "menu.build": "Build {version}", "menu.resume": "Resume" },
      }),
    );
    const tree = buildUiRenderTree(def, { resolveLoc: (key, params) => registry.resolve(key, params) });
    const text = tree.children[0]!;
    const button = tree.children[1]!;
    assert.equal(text.text, "Build 0.1");
    assert.equal(button.text, "Resume");
    // Without a resolver the raw key is shown (editor preview without a table).
    assert.equal(buildUiRenderTree(def).children[0]!.text, "menu.build");
  });

  check("collectUiLocBindings finds only Text/Button nodes with localized text", () => {
    const def = normalizeUiWidgetDef({
      name: "M",
      root: {
        widget: "Canvas",
        children: [
          { id: "t", widget: "Text", props: { text: { key: "a" } } },
          { id: "b", widget: "Button", props: { text: { key: "b" } } },
          { id: "lit", widget: "Text", props: { text: "Static" } },
          { id: "bar", widget: "ProgressBar", props: { value: { bind: "x" } } },
        ],
      },
    });
    const locNodes = collectUiLocBindings(def);
    assert.equal(locNodes.length, 2);
    assert.deepEqual(
      locNodes.map((entry) => entry.node.id).sort(),
      ["b", "t"],
    );
  });

  // --- U7c accessibility -----------------------------------------------------

  check("normalizeUiA11y keeps valid fields and drops empty/garbage", () => {
    assert.deepEqual(normalizeUiA11y({ label: "Go", role: "button", focusable: true }), {
      label: "Go",
      role: "button",
      focusable: true,
    });
    assert.deepEqual(normalizeUiA11y({ focusable: false }), { focusable: false });
    // Empty strings + wrong types are dropped; an all-empty object → undefined.
    assert.equal(normalizeUiA11y({ label: "", role: 5 }), undefined);
    assert.equal(normalizeUiA11y(null), undefined);
  });

  check("normalizeUiWidgetDef round-trips node a11y + initialFocus, dropping no-ops", () => {
    const def = normalizeUiWidgetDef({
      name: "M",
      initialFocus: "go",
      root: {
        id: "root",
        widget: "Canvas",
        children: [
          { id: "img", widget: "Image", a11y: { label: "Logo" } },
          { id: "go", widget: "Button", a11y: { focusable: false }, props: { text: "Go" } },
          { id: "plain", widget: "Text", a11y: { label: "" }, props: { text: "x" } },
        ],
      },
    });
    assert.equal(def.initialFocus, "go");
    assert.deepEqual(findUiNode(def.root, "img")!.a11y, { label: "Logo" });
    assert.deepEqual(findUiNode(def.root, "go")!.a11y, { focusable: false });
    // An a11y that normalizes to nothing leaves the node without the field.
    assert.equal(findUiNode(def.root, "plain")!.a11y, undefined);
    // initialFocus pointing at nothing useful is dropped (empty string).
    assert.equal(normalizeUiWidgetDef({ name: "M", initialFocus: "", root: {} }).initialFocus, undefined);
  });

  check("resolveUiA11yAttrs maps widget kinds + a11y overrides to ARIA", () => {
    const def = normalizeUiWidgetDef({
      name: "M",
      root: {
        id: "root",
        widget: "Canvas",
        children: [
          { id: "bar", widget: "ProgressBar", props: { value: 30, max: 60 } },
          { id: "img", widget: "Image", a11y: { label: "Logo" } },
          { id: "btn", widget: "Button", a11y: { label: "Start", focusable: false }, props: { text: "x" } },
          { id: "box", widget: "Panel", a11y: { focusable: true, role: "menu" } },
        ],
      },
    });
    assert.deepEqual(resolveUiA11yAttrs(findUiNode(def.root, "bar")!), {
      role: "progressbar",
      "aria-valuemin": "0",
      "aria-valuemax": "60",
      "aria-valuenow": "30",
    });
    assert.deepEqual(resolveUiA11yAttrs(findUiNode(def.root, "img")!), {
      role: "img",
      "aria-label": "Logo",
    });
    // Button: native focus, label override, focusable:false → tabindex -1.
    assert.deepEqual(resolveUiA11yAttrs(findUiNode(def.root, "btn")!), {
      "aria-label": "Start",
      tabindex: "-1",
    });
    // Focusable non-Button gets tabindex 0 + the role override.
    assert.deepEqual(resolveUiA11yAttrs(findUiNode(def.root, "box")!), {
      role: "menu",
      tabindex: "0",
    });
  });

  check("collectFocusables + isUiNodeFocusable follow the focusable rules", () => {
    const def = normalizeUiWidgetDef({
      name: "M",
      root: {
        id: "root",
        widget: "Canvas",
        children: [
          { id: "a", widget: "Button", props: { text: "A" } },
          { id: "b", widget: "Button", a11y: { focusable: false }, props: { text: "B" } },
          { id: "c", widget: "Panel", a11y: { focusable: true } },
          { id: "d", widget: "Text", props: { text: "D" } },
        ],
      },
    });
    assert.deepEqual(collectFocusables(def.root), ["a", "c"]);
    assert.equal(isUiNodeFocusable(findUiNode(def.root, "a")!), true);
    assert.equal(isUiNodeFocusable(findUiNode(def.root, "b")!), false);
    assert.equal(isUiNodeFocusable(findUiNode(def.root, "d")!), false);
  });

  check("nextFocusIndex wraps both ways and seeds from an empty selection", () => {
    assert.equal(nextFocusIndex(0, 3, 1), 1);
    assert.equal(nextFocusIndex(2, 3, 1), 0); // wrap forward
    assert.equal(nextFocusIndex(0, 3, -1), 2); // wrap back
    assert.equal(nextFocusIndex(-1, 3, 1), 0); // none focused, forward → first
    assert.equal(nextFocusIndex(-1, 3, -1), 2); // none focused, back → last
    assert.equal(nextFocusIndex(0, 0, 1), -1); // nothing to focus
  });

  check("buildUiRenderTree attaches ARIA attrs to render nodes", () => {
    const def = normalizeUiWidgetDef({
      name: "M",
      root: {
        id: "root",
        widget: "Canvas",
        children: [{ id: "bar", widget: "ProgressBar", props: { value: 1, max: 4 } }],
      },
    });
    const tree = buildUiRenderTree(def);
    assert.equal(tree.children[0]!.attrs?.role, "progressbar");
    assert.equal(tree.children[0]!.attrs?.["aria-valuenow"], "1");
    // A bare container with no a11y carries no attrs.
    assert.equal(tree.attrs, undefined);
  });

  check("auditUiA11y flags nameless Button + Image, passes named ones", () => {
    const def = normalizeUiWidgetDef({
      name: "Menu",
      root: {
        id: "root",
        widget: "Canvas",
        children: [
          { id: "blank", widget: "Button", props: {} },
          { id: "named", widget: "Button", props: { text: "Go" } },
          { id: "keyed", widget: "Button", props: { text: { key: "menu.go" } } },
          { id: "logo", widget: "Image", props: {} },
          { id: "alt", widget: "Image", a11y: { label: "Logo" } },
        ],
      },
    });
    const issues = auditUiA11y(def);
    assert.deepEqual(
      issues.map((issue) => issue.nodeId).sort(),
      ["blank", "logo"],
    );
  });

  // --- U7d world-space widgets -----------------------------------------------

  check("normalizeWorldWidget keeps valid fields, defaults the anchor, drops junk", () => {
    assert.deepEqual(
      normalizeWorldWidget({ widget: "label", anchor: { worldPos: [1, 2, 3] }, offset: [0, -8], maxDistance: 30 }),
      { widget: "label", anchor: { worldPos: [1, 2, 3] }, offset: [0, -8], maxDistance: 30 },
    );
    // Missing/garbage anchor → origin; bad offset/maxDistance dropped.
    assert.deepEqual(normalizeWorldWidget({ widget: "label", offset: [1], maxDistance: -5 }), {
      widget: "label",
      anchor: { worldPos: [0, 0, 0] },
    });
    // No widget id → unusable.
    assert.equal(normalizeWorldWidget({ anchor: { worldPos: [0, 0, 0] } }), null);
    assert.equal(normalizeWorldWidget(null), null);
  });

  check("normalizeWorldWidget reads an entity anchor + world offset", () => {
    assert.deepEqual(
      normalizeWorldWidget({ widget: "tag", anchor: { entityId: "actor:0", offset3d: [0, 1.5, 0] } }),
      { widget: "tag", anchor: { worldPos: [0, 0, 0], entityId: "actor:0", offset3d: [0, 1.5, 0] } },
    );
    // worldPos coexists as the fallback; an empty entityId is dropped.
    assert.deepEqual(
      normalizeWorldWidget({ widget: "tag", anchor: { worldPos: [1, 1, 1], entityId: "" } }),
      { widget: "tag", anchor: { worldPos: [1, 1, 1] } },
    );
  });

  check("normalizeWorldWidgets drops unusable entries", () => {
    const list = normalizeWorldWidgets([
      { widget: "a", anchor: { worldPos: [0, 1, 0] } },
      { anchor: { worldPos: [0, 0, 0] } },
      "junk",
    ]);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.widget, "a");
    assert.deepEqual(normalizeWorldWidgets("nope"), []);
  });

  check("resolveWorldWidgetVisibility fades + scales by distance", () => {
    // No maxDistance → never culled, perspective scale shrinks with distance.
    const near = resolveWorldWidgetVisibility(4);
    assert.equal(near.visible, true);
    assert.equal(near.opacity, 1);
    assert.equal(near.scale, 1.6); // 8/4 = 2, clamped to maxScale 1.6
    const far = resolveWorldWidgetVisibility(16);
    assert.equal(far.scale, 0.5); // 8/16
    // maxDistance: full opacity until the last 20% (fadeStart=80), then linear to 0.
    assert.equal(resolveWorldWidgetVisibility(50, { maxDistance: 100 }).opacity, 1);
    assert.equal(resolveWorldWidgetVisibility(80, { maxDistance: 100 }).opacity, 1);
    assert.equal(resolveWorldWidgetVisibility(90, { maxDistance: 100 }).opacity, 0.5);
    assert.equal(resolveWorldWidgetVisibility(95, { maxDistance: 100 }).opacity, 0.25);
    const culled = resolveWorldWidgetVisibility(100, { maxDistance: 100 });
    assert.equal(culled.visible, false);
    assert.equal(culled.opacity, 0);
  });

  check("ndcToScreen maps clip space to viewport pixels + front/back", () => {
    // Center of clip space → center of the viewport.
    assert.deepEqual(ndcToScreen(0, 0, 0.5, 800, 600), { x: 400, y: 300, inFront: true });
    // Top-right NDC (1, 1) → top-right pixel (y axis flips).
    assert.deepEqual(ndcToScreen(1, 1, 0, 800, 600), { x: 800, y: 0, inFront: true });
    // Bottom-left NDC (-1, -1) → bottom-left pixel.
    assert.deepEqual(ndcToScreen(-1, -1, 0, 800, 600), { x: 0, y: 600, inFront: true });
    // NDC z > 1 means behind the camera.
    assert.equal(ndcToScreen(0, 0, 1.2, 800, 600).inFront, false);
  });
}
