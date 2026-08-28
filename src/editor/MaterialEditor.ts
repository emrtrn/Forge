import {
  AmbientLight,
  BufferAttribute,
  Color,
  DirectionalLight,
  GridHelper,
  Mesh,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  WebGLRenderer,
  type Material,
} from "three";

import {
  FORGE_MATERIAL_ALPHA_MODES,
  FORGE_MATERIAL_LAYER_BLEND_DRIVERS,
  FORGE_MATERIAL_SIDES,
  FORGE_MATERIAL_TYPES,
  defaultForgeMaterialNormalMotion,
  normalizeForgeMaterialDef,
  type ForgeMaterialAlphaMode,
  type ForgeMaterialDef,
  type ForgeMaterialLayerBlend,
  type ForgeMaterialLayerBlendDriver,
  type ForgeMaterialNormalMotion,
  type ForgeMaterialSide,
  type ForgeMaterialType,
} from "@engine/assets/material";
import { projectFileUrl } from "@/project/ProjectSystem";
import { loadMaterialAsset, saveMaterialAsset } from "@/editor/materialStore";
import {
  advanceForgeMaterialAnimations,
  createThreeMaterialFromForgeDef,
  hasForgeMaterialNormalMotion,
} from "@engine/render-three/materials";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type StatusTone = "info" | "success" | "warning" | "error";

export interface MaterialEditorAssetOption {
  id: string;
  name: string;
  assetType: string;
  path: string;
}

export interface MaterialEditorOptions {
  path: string;
  label: string;
  materialId?: string;
  assets?: readonly MaterialEditorAssetOption[];
  hideDevelopmentContent?: boolean;
  onStatus?: (message: string, tone?: StatusTone) => void;
  onSaved?: () => void;
  onApplyToSelected?: (materialId: string) => void;
  onBrowse?: () => void;
}

type TextureField =
  | "baseColorTexture"
  | "normalTexture"
  | "roughnessTexture"
  | "metalnessTexture"
  | "aoTexture"
  | "opacityTexture"
  | "emissiveTexture"
  | "ormTexture"
  | "layer1BaseColorTexture"
  | "layer1NormalTexture"
  | "layer1RoughnessTexture"
  | "layer1MetalnessTexture"
  | "layer1OpacityTexture"
  | "layer1EmissiveTexture"
  | "layer1AoTexture"
  | "layerBlendMaskTexture";

const textureAssetCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDevelopmentContentPath(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/").replace(/^\/+/, "").toLocaleLowerCase();
  const normalized = normalizedPath.startsWith("public/assets/")
    ? normalizedPath.slice("public/".length)
    : normalizedPath;
  return normalized === "assets/developmentcontent" || normalized.startsWith("assets/developmentcontent/");
}

export class MaterialEditor {
  private static activeInstance: MaterialEditor | null = null;

  static async open(options: MaterialEditorOptions): Promise<MaterialEditor> {
    MaterialEditor.activeInstance?.close();
    const editor = new MaterialEditor(options);
    MaterialEditor.activeInstance = editor;
    await editor.load();
    return editor;
  }

  private readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly previewHost: HTMLElement;
  private readonly detailsHost: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(32, 1, 0.01, 100);
  // The preview deliberately carries an RGBA gradient so the Vertex Color
  // driver remains inspectable before a level placement has been painted.
  private readonly sphere = new Mesh(createPreviewSphereGeometry());
  private readonly textureLoader = new TextureLoader();
  private readonly loadedTextures: Texture[] = [];
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;

  private def: ForgeMaterialDef;
  private previewMaterial: Material | null = null;
  private dirty = false;
  private disposed = false;
  private contextLost = false;
  private previewAnimationFrame = 0;
  private lastPreviewShaderError: string | null = null;
  private textureSearchText = "";
  private textureSearchUntil = 0;
  private textureSearchSelect: HTMLSelectElement | null = null;

  private constructor(private readonly options: MaterialEditorOptions) {
    this.def = normalizeForgeMaterialDef({ name: options.label }, options.label);
    this.overlay = document.createElement("div");
    this.overlay.className = "me-editor-overlay";
    this.overlay.innerHTML = `
      <div class="me-editor-window">
        <header class="me-editor-header">
          <span class="me-editor-tab">
            <span class="me-editor-tab-icon">M</span>
            <strong data-me-title></strong>
            <span class="me-editor-badge">Material</span>
          </span>
          <div class="me-editor-header-actions">
            <button type="button" class="me-editor-save" data-me-save title="Save (Ctrl+S)">Save</button>
            <button type="button" class="me-editor-close" data-me-close title="Close (Esc)">x</button>
          </div>
        </header>
        <div class="me-editor-toolbar">
          <button type="button" data-me-tb-save title="Save (Ctrl+S)">Save</button>
          <button type="button" data-me-apply title="Assign this material to the selected static mesh" ${options.materialId ? "" : "disabled"}>Apply to Selected</button>
          <button type="button" data-me-browse title="Reveal in Content Browser">Browse</button>
          <span class="me-editor-toolbar-spacer"></span>
          <span>MeshStandardMaterial first pass</span>
        </div>
        <div class="me-editor-body">
          <main class="me-editor-preview" data-me-preview></main>
          <aside class="me-editor-details" data-me-details></aside>
        </div>
        <footer class="me-editor-status" data-me-status>Loading...</footer>
      </div>
    `;
    document.body.append(this.overlay);

    this.titleEl = this.requireEl("[data-me-title]");
    this.previewHost = this.requireEl("[data-me-preview]");
    this.detailsHost = this.requireEl("[data-me-details]");
    this.statusEl = this.requireEl("[data-me-status]");

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.debug.checkShaderErrors = true;
    this.renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
      const programLog = gl.getProgramInfoLog(program)?.trim() ?? "";
      const vertexLog = gl.getShaderInfoLog(vertexShader)?.trim() ?? "";
      const fragmentLog = gl.getShaderInfoLog(fragmentShader)?.trim() ?? "";
      const message = fragmentLog || vertexLog || programLog || "unknown shader compile error";
      this.lastPreviewShaderError = message;
      this.setStatus(`Preview shader failed: ${message}`, "error");
      console.error("[MaterialEditor] Preview shader failed", {
        programLog,
        vertexLog,
        fragmentLog,
      });
    };
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.previewHost.append(this.renderer.domElement);
    // The preview renders on demand (no animation loop), so if the GPU drops this
    // canvas' WebGL context — e.g. under the memory pressure of regenerating content
    // thumbnails + rebuilding the scene on Save — nothing repaints it and the sphere
    // just vanishes. Recover by rebuilding the material once the context is back.
    this.renderer.domElement.addEventListener("webglcontextlost", this.onContextLost);
    this.renderer.domElement.addEventListener("webglcontextrestored", this.onContextRestored);
    this.setupPreviewScene();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.controls.addEventListener("change", () => this.renderPreview());
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.previewHost);

    this.requireEl<HTMLButtonElement>("[data-me-close]").addEventListener("click", () =>
      this.close(),
    );
    this.requireEl<HTMLButtonElement>("[data-me-save]").addEventListener("click", () =>
      void this.save(),
    );
    this.requireEl<HTMLButtonElement>("[data-me-tb-save]").addEventListener("click", () =>
      void this.save(),
    );
    this.requireEl<HTMLButtonElement>("[data-me-browse]").addEventListener("click", () =>
      this.options.onBrowse?.(),
    );
    this.requireEl<HTMLButtonElement>("[data-me-apply]").addEventListener("click", () => {
      if (!this.options.materialId) return;
      this.options.onApplyToSelected?.(this.options.materialId);
    });
    this.overlay.tabIndex = -1;
    this.overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void this.save();
      }
    });
    window.addEventListener("resize", this.resize);
    requestAnimationFrame(() => this.resize());
    this.overlay.focus();
  }

  private requireEl<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.overlay.querySelector<T>(selector);
    if (!el) throw new Error(`MaterialEditor: missing element ${selector}`);
    return el;
  }

  private setupPreviewScene(): void {
    this.scene.background = new Color(0x191b1f);
    this.scene.add(new AmbientLight(0xffffff, 1.1));
    const key = new DirectionalLight(0xffffff, 3);
    key.position.set(3, 4, 3);
    this.scene.add(key);
    const rim = new DirectionalLight(0x9fc7ff, 1.2);
    rim.position.set(-3, 2, -2);
    this.scene.add(rim);
    const grid = new GridHelper(4, 16, 0x464a51, 0x292c31);
    grid.position.y = -0.95;
    this.scene.add(grid);
    this.scene.add(this.sphere);
    this.camera.position.set(0, 0.15, 4.2);
    this.camera.lookAt(0, 0, 0);
  }

  private async load(): Promise<void> {
    try {
      this.def = await loadMaterialAsset(this.options.path, this.options.label);
      this.dirty = false;
      this.render();
      await this.updatePreviewMaterial();
      this.setStatus("Ready.");
    } catch (error) {
      this.render();
      this.setStatus(`Failed to load: ${describeError(error)}`, "error");
    }
  }

  private render(): void {
    if (this.disposed) return;
    this.titleEl.textContent = this.def.name;
    this.renderDetails();
    this.resize();
  }

  private renderDetails(): void {
    const blend = this.def.layerBlend;
    this.detailsHost.innerHTML = `
      <div class="me-details-heading">Details</div>
      <div class="me-section">
        <div class="me-section-title">Material</div>
        <label class="me-row"><span>Name</span><input data-me-field="name" type="text" value="${escapeHtml(this.def.name)}" /></label>
        <label class="me-row"><span>Type</span><select data-me-field="materialType">${this.enumOptions(FORGE_MATERIAL_TYPES, this.def.materialType)}</select></label>
        <label class="me-row"><span>Alpha Mode</span><select data-me-field="alphaMode">${this.enumOptions(FORGE_MATERIAL_ALPHA_MODES, this.def.alphaMode)}</select></label>
        ${this.numberRow("Alpha Test", "alphaTest", this.def.alphaTest, 0, 1, 0.01)}
        <label class="me-row"><span>Side</span><select data-me-field="side">${this.enumOptions(FORGE_MATERIAL_SIDES, this.def.side)}</select></label>
      </div>
      <div class="me-section">
        <div class="me-section-title">Base Material</div>
        ${this.textureColorRow("Base Color Map", "baseColorTexture", "baseColor", this.def.baseColor)}
        ${this.textureVector3Row("Normal Map", "normalTexture", [0, 0, 1], false)}
        ${this.textureNumberRow("Roughness Map", "roughnessTexture", "roughness", this.def.roughness, 0, 1, 0.01)}
        ${this.textureNumberRow("Metalness Map", "metalnessTexture", "metalness", this.def.metalness, 0, 1, 0.01)}
        ${this.textureNumberRow("Opacity Map", "opacityTexture", "opacity", this.def.opacity, 0, 1, 0.01)}
        <label class="me-row" title="Use the alpha channel already stored in Base Color Map instead of a separate opacity texture."><span>Use Base Color Alpha</span><input data-me-field="useBaseColorAlphaForOpacity" type="checkbox" ${this.def.useBaseColorAlphaForOpacity ? "checked" : ""} /></label>
        ${this.textureColorNumberRow("Emissive Map", "emissiveTexture", "emissive", this.def.emissive, "emissiveIntensity", this.def.emissiveIntensity, 0, 20, 0.1)}
        ${this.textureNumberRow("Ambient Occlusion Map", "aoTexture", "aoIntensity", this.def.aoIntensity, 0, 1, 0.01)}
        ${this.vector2Row("UV Tiling", "uvTilingX", "uvTilingY", this.def.uvTiling.x, this.def.uvTiling.y)}
        <label class="me-row" title="Flip textures vertically on upload (three.js' default). Leave it on for engine-generated UVs — landscape layers, UVW projection, primitives. Turn it OFF when this material is assigned to a glTF/GLB mesh's material slot: glTF UVs run downward from the image top, so a flipped texture binds upside down and reads as a broken UV layout."><span>Flip Y</span><input data-me-field="flipY" type="checkbox" ${this.def.flipY ? "checked" : ""} /></label>
      </div>
      ${this.normalMotionSection()}
      ${this.layerBlendSection()}
      ${blend ? this.layerSettingsSection(blend) : ""}
    `;
    this.detailsHost.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-me-field]")
      .forEach((input) => {
        input.addEventListener("input", () => void this.applyField(input));
        input.addEventListener("change", () => void this.applyField(input));
      });
    this.detailsHost.querySelectorAll<HTMLSelectElement>("select[data-me-field]")
      .forEach((select) => {
        if (isTextureField(select.dataset.meField ?? "")) {
          select.addEventListener("keydown", (event) => this.handleTextureSelectSearch(event, select));
        }
      });
  }

  private normalMotionSection(): string {
    const motion = this.def.normalMotion ?? defaultForgeMaterialNormalMotion();
    const enabled = this.def.normalMotion !== null;
    return `
      <div class="me-section">
        <div class="me-section-title">Normal Motion</div>
        <label class="me-row" title="Samples the same normal map twice with independent UV motion."><span>Enabled</span><input data-me-field="normalMotionEnabled" type="checkbox" ${enabled ? "checked" : ""} /></label>
        ${enabled ? `
          ${this.numberRow("Primary Speed X", "normalMotionPrimaryX", motion.primaryVelocity.x, -10, 10, 0.001)}
          ${this.numberRow("Primary Speed Y", "normalMotionPrimaryY", motion.primaryVelocity.y, -10, 10, 0.001)}
          ${this.numberRow("Second Tiling X", "normalMotionSecondaryTilingX", motion.secondaryTiling.x, 0.001, 100, 0.01)}
          ${this.numberRow("Second Tiling Y", "normalMotionSecondaryTilingY", motion.secondaryTiling.y, 0.001, 100, 0.01)}
          ${this.numberRow("Second Speed X", "normalMotionSecondaryX", motion.secondaryVelocity.x, -10, 10, 0.001)}
          ${this.numberRow("Second Speed Y", "normalMotionSecondaryY", motion.secondaryVelocity.y, -10, 10, 0.001)}
          ${this.numberRow("Normal Strength", "normalMotionStrength", motion.strength, 0.05, 4, 0.01)}
        ` : ""}
      </div>`;
  }

  private enumOptions<T extends string>(values: readonly T[], current: T): string {
    return values
      .map((value) => `<option value="${value}" ${value === current ? "selected" : ""}>${value}</option>`)
      .join("");
  }

  private numberRow(
    label: string,
    field: (
      | keyof Pick<
          ForgeMaterialDef,
          "roughness" | "metalness" | "aoIntensity" | "opacity" | "alphaTest" | "emissiveIntensity"
        >
      | "normalMotionPrimaryX"
      | "normalMotionPrimaryY"
      | "normalMotionSecondaryTilingX"
      | "normalMotionSecondaryTilingY"
      | "normalMotionSecondaryX"
      | "normalMotionSecondaryY"
      | "normalMotionStrength"
    ),
    value: number,
    min: number,
    max: number,
    step: number,
  ): string {
    return `
      <label class="me-row">
        <span>${label}</span>
        <input data-me-field="${field}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" />
      </label>
    `;
  }

  private textureColorRow(
    label: string,
    textureField: "baseColorTexture" | "layer1BaseColorTexture",
    colorField: "baseColor" | "layer1BaseColor",
    color: string,
  ): string {
    return `
      <label class="me-row">
        <span>${label}</span>
        <span class="me-input-pair">
          <select data-me-field="${textureField}">${this.textureOptions(textureField)}</select>
          <input data-me-field="${colorField}" type="color" value="${escapeHtml(color)}" title="Constant color" />
        </span>
      </label>
    `;
  }

  private textureNumberRow(
    label: string,
    textureField:
      | "roughnessTexture"
      | "metalnessTexture"
      | "aoTexture"
      | "opacityTexture"
      | "layer1RoughnessTexture"
      | "layer1MetalnessTexture"
      | "layer1OpacityTexture"
      | "layer1AoTexture",
    numberField:
      | "roughness"
      | "metalness"
      | "aoIntensity"
      | "opacity"
      | "layer1Roughness"
      | "layer1Metalness"
      | "layer1Opacity"
      | "layer1AoIntensity",
    value: number,
    min: number,
    max: number,
    step: number,
  ): string {
    return `
      <label class="me-row">
        <span>${label}</span>
        <span class="me-input-pair">
          <select data-me-field="${textureField}">${this.textureOptions(textureField)}</select>
          <input data-me-field="${numberField}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" title="Constant value" />
        </span>
      </label>
    `;
  }

  private textureVector3Row(
    label: string,
    textureField: "normalTexture" | "layer1NormalTexture",
    value: [number, number, number],
    enabled: boolean,
  ): string {
    const disabled = enabled ? "" : "disabled";
    const title = enabled
      ? "Constant3Vector"
      : "Constant3Vector authoring is not implemented yet; material uses the mesh normal when no normal map is assigned.";
    return `
      <label class="me-row">
        <span>${label}</span>
        <span class="me-input-pair">
          <select data-me-field="${textureField}">${this.textureOptions(textureField)}</select>
          <span class="me-vector3">
            <input type="number" value="${value[0]}" step="0.01" title="${title}" ${disabled} />
            <input type="number" value="${value[1]}" step="0.01" title="${title}" ${disabled} />
            <input type="number" value="${value[2]}" step="0.01" title="${title}" ${disabled} />
          </span>
        </span>
      </label>
    `;
  }

  private textureColorNumberRow(
    label: string,
    textureField: "emissiveTexture" | "layer1EmissiveTexture",
    colorField: "emissive" | "layer1Emissive",
    color: string,
    numberField: "emissiveIntensity" | "layer1EmissiveIntensity",
    value: number,
    min: number,
    max: number,
    step: number,
  ): string {
    return `
      <label class="me-row">
        <span>${label}</span>
        <span class="me-input-triple">
          <select data-me-field="${textureField}">${this.textureOptions(textureField)}</select>
          <input data-me-field="${colorField}" type="color" value="${escapeHtml(color)}" title="Color picker" />
          <input data-me-field="${numberField}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" title="Constant value" />
        </span>
      </label>
    `;
  }

  private vector2Row(
    label: string,
    xField: "uvTilingX" | "layer1UvTilingX",
    yField: "uvTilingY" | "layer1UvTilingY",
    x: number,
    y: number,
  ): string {
    return `
      <label class="me-row">
        <span>${label}</span>
        <span class="me-vector2">
          <input data-me-field="${xField}" type="number" min="0.001" max="100" step="0.1" value="${x}" title="Constant2Vector X" />
          <input data-me-field="${yField}" type="number" min="0.001" max="100" step="0.1" value="${y}" title="Constant2Vector Y" />
        </span>
      </label>
    `;
  }

  private layerBlendSection(): string {
    const enabled = this.def.layerBlend !== null;
    const blend = this.def.layerBlend ?? defaultLayerBlend(null);
    return `
      <div class="me-section">
        <div class="me-section-title">Layer Blend</div>
        <label class="me-row"><span>Layer Enabled</span><input data-me-field="layerBlendEnabled" type="checkbox" ${enabled ? "checked" : ""} /></label>
        ${
          enabled
            ? `
              ${this.textureColorRow("Layer BC Map", "layer1BaseColorTexture", "layer1BaseColor", blend.layer1.baseColor)}
              ${this.textureVector3Row("Layer N Map", "layer1NormalTexture", [0, 0, 1], false)}
              ${this.textureNumberRow("Layer R Map", "layer1RoughnessTexture", "layer1Roughness", blend.layer1.roughness, 0, 1, 0.01)}
              ${this.textureNumberRow("Layer M Map", "layer1MetalnessTexture", "layer1Metalness", blend.layer1.metalness, 0, 1, 0.01)}
              ${this.textureNumberRow("Layer O Map", "layer1OpacityTexture", "layer1Opacity", blend.layer1.opacity, 0, 1, 0.01)}
              ${this.textureColorNumberRow("Layer E Map", "layer1EmissiveTexture", "layer1Emissive", blend.layer1.emissive, "layer1EmissiveIntensity", blend.layer1.emissiveIntensity, 0, 20, 0.1)}
              ${this.textureNumberRow("Layer AO Map", "layer1AoTexture", "layer1AoIntensity", blend.layer1.aoIntensity, 0, 1, 0.01)}
              ${this.vector2Row("Layer UV Tiling", "layer1UvTilingX", "layer1UvTilingY", blend.layer1.uvTiling.x, blend.layer1.uvTiling.y)}
            `
            : ""
        }
      </div>
    `;
  }

  private layerNumberRow(
    label: string,
    field: string,
    value: number,
    min: number,
    max: number,
    step: number,
  ): string {
    return `
      <label class="me-row">
        <span>${label}</span>
        <input data-me-field="${field}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" />
      </label>
    `;
  }

  private layerSettingsSection(blend: ForgeMaterialLayerBlend): string {
    return `
      <div class="me-section">
        <div class="me-section-title">Layer Settings</div>
        <label class="me-row"><span>Driver</span><select data-me-field="layerBlendDriver">${this.enumOptions(FORGE_MATERIAL_LAYER_BLEND_DRIVERS, blend.driver)}</select></label>
        ${
          blend.driver === "maskTexture"
            ? `<label class="me-row"><span>Blend Mask</span><select data-me-field="layerBlendMaskTexture">${this.textureOptions("layerBlendMaskTexture")}</select></label>`
            : ""
        }
        ${
          blend.driver === "vertexColor"
            ? `<label class="me-row"><span>Invert Vertex Color</span><input data-me-field="layerBlendInvertVertexColor" type="checkbox" ${blend.invertVertexColor ? "checked" : ""} /></label>`
            : ""
        }
        ${this.layerNumberRow("Blend Amount", "layerBlendAmount", blend.amount, 0, 1, 0.01)}
        <label class="me-row">
          <span>Blend Min + Max</span>
          <span class="me-vector2">
            <input data-me-field="layerBlendMin" type="number" min="-100000" max="100000" step="0.1" value="${blend.min}" />
            <input data-me-field="layerBlendMax" type="number" min="-100000" max="100000" step="0.1" value="${blend.max}" />
          </span>
        </label>
        ${this.layerNumberRow("Blend Contrast", "layerBlendContrast", blend.contrast, 0.01, 8, 0.01)}
      </div>
    `;
  }

  private textureOptions(field: TextureField): string {
    const current = isLayerTextureField(field)
      ? this.layerTextureValue(field)
      : this.def[field];
    const textures = this.sortedTextureAssets(current);
    return [`<option value="" ${current ? "" : "selected"}>None</option>`]
      .concat(
        textures.map(
          (asset) =>
            `<option value="${escapeHtml(asset.id)}" ${
              current === asset.id ? "selected" : ""
            }>${escapeHtml(asset.name)}</option>`,
        ),
      )
      .join("");
  }

  private sortedTextureAssets(currentTextureId?: string | null): MaterialEditorAssetOption[] {
    return (this.options.assets?.filter((asset) => asset.assetType === "texture") ?? [])
      .filter(
        (asset) =>
          !this.options.hideDevelopmentContent ||
          asset.id === currentTextureId ||
          !isDevelopmentContentPath(asset.path),
      )
      .slice()
      .sort((a, b) => {
        const byName = textureAssetCollator.compare(a.name, b.name);
        return byName || textureAssetCollator.compare(a.id, b.id);
      });
  }

  private handleTextureSelectSearch(event: KeyboardEvent, select: HTMLSelectElement): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (this.textureSearchSelect !== select) {
      this.textureSearchText = "";
      this.textureSearchSelect = select;
    }
    if (event.key === "Escape") {
      this.textureSearchText = "";
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      this.updateTextureSearch(select, this.textureSearchText.slice(0, -1));
      return;
    }
    if (event.key.length !== 1) return;
    event.preventDefault();
    const now = window.performance.now();
    const prefix = now <= this.textureSearchUntil ? this.textureSearchText : "";
    this.updateTextureSearch(select, `${prefix}${event.key}`);
  }

  private updateTextureSearch(select: HTMLSelectElement, text: string): void {
    this.textureSearchText = text.toLowerCase();
    this.textureSearchUntil = window.performance.now() + 1200;
    const asset = this.findTextureSearchMatch(this.textureSearchText, select.value || null);
    if (!asset || select.value === asset.id) return;
    select.value = asset.id;
    void this.applyField(select);
  }

  private findTextureSearchMatch(
    query: string,
    currentTextureId?: string | null,
  ): MaterialEditorAssetOption | null {
    const normalizedQuery = normalizeTextureSearchText(query);
    if (!normalizedQuery) return null;
    const textures = this.sortedTextureAssets(currentTextureId);
    return (
      textures.find((asset) => normalizeTextureSearchText(asset.name).startsWith(normalizedQuery)) ??
      textures.find((asset) => textureSearchTokens(asset).some((token) => token.startsWith(normalizedQuery))) ??
      textures.find((asset) => normalizeTextureSearchText(asset.name).includes(normalizedQuery)) ??
      textures.find((asset) => normalizeTextureSearchText(asset.id).includes(normalizedQuery)) ??
      null
    );
  }

  private layerTextureValue(field: string): string | null {
    const layer1 = this.def.layerBlend?.layer1;
    if (!layer1) return null;
    if (field === "layer1BaseColorTexture") return layer1.baseColorTexture;
    if (field === "layer1NormalTexture") return layer1.normalTexture;
    if (field === "layer1RoughnessTexture") return layer1.roughnessTexture;
    if (field === "layer1MetalnessTexture") return layer1.metalnessTexture;
    if (field === "layer1OpacityTexture") return layer1.opacityTexture;
    if (field === "layer1EmissiveTexture") return layer1.emissiveTexture;
    if (field === "layer1AoTexture") return layer1.aoTexture;
    if (field === "layerBlendMaskTexture") return this.def.layerBlend?.maskTexture ?? null;
    return null;
  }

  private async applyField(input: HTMLInputElement | HTMLSelectElement): Promise<void> {
    const field = input.dataset.meField;
    if (!field) return;
    const next = { ...this.def };
    if (field === "name") next.name = input.value.trim() || this.options.label;
    else if (field === "materialType") next.materialType = input.value as ForgeMaterialType;
    else if (field === "baseColor") next.baseColor = input.value;
    else if (field === "baseColorTexture") next.baseColorTexture = input.value || null;
    else if (field === "normalTexture") next.normalTexture = input.value || null;
    else if (field === "roughnessTexture") next.roughnessTexture = input.value || null;
    else if (field === "metalnessTexture") next.metalnessTexture = input.value || null;
    else if (field === "aoTexture") next.aoTexture = input.value || null;
    else if (field === "opacityTexture") next.opacityTexture = input.value || null;
    else if (field === "useBaseColorAlphaForOpacity") {
      next.useBaseColorAlphaForOpacity = input instanceof HTMLInputElement && input.checked;
      if (next.useBaseColorAlphaForOpacity && next.alphaMode === "opaque") next.alphaMode = "mask";
    }
    else if (field === "emissiveTexture") next.emissiveTexture = input.value || null;
    else if (field === "ormTexture") {
      next.ormTexture = input.value || null;
      next.maskTexture = null;
    }
    else if (field === "flipY") next.flipY = !(input instanceof HTMLInputElement) || input.checked;
    else if (field === "uvTilingX") next.uvTiling = { ...next.uvTiling, x: numberInput(input.value, 0.001, 100) };
    else if (field === "uvTilingY") next.uvTiling = { ...next.uvTiling, y: numberInput(input.value, 0.001, 100) };
    else if (field === "normalMotionEnabled") {
      next.normalMotion = input instanceof HTMLInputElement && input.checked
        ? defaultForgeMaterialNormalMotion()
        : null;
    }
    else if (field.startsWith("normalMotion")) {
      next.normalMotion = this.applyNormalMotionField(next.normalMotion, field, input);
    }
    else if (field === "roughness") next.roughness = numberInput(input.value, 0, 1);
    else if (field === "metalness") next.metalness = numberInput(input.value, 0, 1);
    else if (field === "aoIntensity") next.aoIntensity = numberInput(input.value, 0, 1);
    else if (field === "opacity") next.opacity = numberInput(input.value, 0, 1);
    else if (field === "alphaMode") next.alphaMode = input.value as ForgeMaterialAlphaMode;
    else if (field === "alphaTest") next.alphaTest = numberInput(input.value, 0, 1);
    else if (field === "side") next.side = input.value as ForgeMaterialSide;
    else if (field === "emissive") next.emissive = input.value;
    else if (field === "emissiveIntensity") next.emissiveIntensity = numberInput(input.value, 0, 20);
    else if (field === "layerBlendEnabled") {
      const checked = input instanceof HTMLInputElement && input.checked;
      next.layerBlend = checked ? defaultLayerBlend(next.layerBlend) : null;
    }
    else if (field.startsWith("layer1") || field.startsWith("layerBlend")) {
      next.layerBlend = this.applyLayerBlendField(next.layerBlend, field, input);
    }
    this.def = normalizeForgeMaterialDef(next, this.options.label);
    this.dirty = true;
    this.titleEl.textContent = this.def.name;
    this.syncFieldControls(field, input.value);
    this.markDirty();
    if (
      field === "layerBlendEnabled" ||
      field === "layerBlendDriver" ||
      field === "useBaseColorAlphaForOpacity" ||
      field === "normalMotionEnabled"
    ) this.renderDetails();
    await this.updatePreviewMaterial();
    this.warnIfTransparentMaterial(field);
    this.warnIfBaseColorAlphaOpacity(field);
    this.warnIfSurfaceMapUsesScalar(field);
    this.warnIfLayerBlendMaskUsesWrongTexture(field);
  }

  private applyNormalMotionField(
    current: ForgeMaterialNormalMotion | null,
    field: string,
    input: HTMLInputElement | HTMLSelectElement,
  ): ForgeMaterialNormalMotion {
    const next = current ?? defaultForgeMaterialNormalMotion();
    if (field === "normalMotionPrimaryX") next.primaryVelocity = { ...next.primaryVelocity, x: numberInput(input.value, -10, 10) };
    else if (field === "normalMotionPrimaryY") next.primaryVelocity = { ...next.primaryVelocity, y: numberInput(input.value, -10, 10) };
    else if (field === "normalMotionSecondaryTilingX") next.secondaryTiling = { ...next.secondaryTiling, x: numberInput(input.value, 0.001, 100) };
    else if (field === "normalMotionSecondaryTilingY") next.secondaryTiling = { ...next.secondaryTiling, y: numberInput(input.value, 0.001, 100) };
    else if (field === "normalMotionSecondaryX") next.secondaryVelocity = { ...next.secondaryVelocity, x: numberInput(input.value, -10, 10) };
    else if (field === "normalMotionSecondaryY") next.secondaryVelocity = { ...next.secondaryVelocity, y: numberInput(input.value, -10, 10) };
    else if (field === "normalMotionStrength") next.strength = numberInput(input.value, 0.05, 4);
    return next;
  }

  private applyLayerBlendField(
    blend: ForgeMaterialLayerBlend | null,
    field: string,
    input: HTMLInputElement | HTMLSelectElement,
  ): ForgeMaterialLayerBlend {
    const next = defaultLayerBlend(blend);
    if (field === "layer1BaseColor") next.layer1.baseColor = input.value;
    else if (field === "layer1BaseColorTexture") next.layer1.baseColorTexture = input.value || null;
    else if (field === "layer1NormalTexture") next.layer1.normalTexture = input.value || null;
    else if (field === "layer1RoughnessTexture") next.layer1.roughnessTexture = input.value || null;
    else if (field === "layer1MetalnessTexture") next.layer1.metalnessTexture = input.value || null;
    else if (field === "layer1OpacityTexture") next.layer1.opacityTexture = input.value || null;
    else if (field === "layer1EmissiveTexture") next.layer1.emissiveTexture = input.value || null;
    else if (field === "layer1AoTexture") next.layer1.aoTexture = input.value || null;
    else if (field === "layer1Roughness") next.layer1.roughness = numberInput(input.value, 0, 1);
    else if (field === "layer1Metalness") next.layer1.metalness = numberInput(input.value, 0, 1);
    else if (field === "layer1Opacity") next.layer1.opacity = numberInput(input.value, 0, 1);
    else if (field === "layer1Emissive") next.layer1.emissive = input.value;
    else if (field === "layer1EmissiveIntensity") next.layer1.emissiveIntensity = numberInput(input.value, 0, 20);
    else if (field === "layer1AoIntensity") next.layer1.aoIntensity = numberInput(input.value, 0, 1);
    else if (field === "layer1UvTilingX") next.layer1.uvTiling = { ...next.layer1.uvTiling, x: numberInput(input.value, 0.001, 100) };
    else if (field === "layer1UvTilingY") next.layer1.uvTiling = { ...next.layer1.uvTiling, y: numberInput(input.value, 0.001, 100) };
    else if (field === "layerBlendDriver") next.driver = input.value as ForgeMaterialLayerBlendDriver;
    else if (field === "layerBlendInvertVertexColor") next.invertVertexColor = input instanceof HTMLInputElement && input.checked;
    else if (field === "layerBlendAmount") next.amount = numberInput(input.value, 0, 1);
    else if (field === "layerBlendMin") next.min = numberInput(input.value, -100000, 100000);
    else if (field === "layerBlendMax") next.max = numberInput(input.value, -100000, 100000);
    else if (field === "layerBlendContrast") next.contrast = numberInput(input.value, 0.01, 8);
    else if (field === "layerBlendMaskTexture") next.maskTexture = input.value || null;
    return next;
  }

  private syncFieldControls(field: string, value: string): void {
    this.detailsHost
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[data-me-field="${field}"]`)
      .forEach((control) => {
        if (control.value !== value) control.value = value;
      });
  }

  private warnIfTransparentMaterial(field: string): void {
    if (field !== "opacity" && field !== "alphaMode") return;
    if (this.def.alphaMode === "blend" || this.def.opacity < 1) {
      this.setStatus("Transparent materials are supported, but render sorting can still depend on scene order.", "warning");
    }
  }

  private warnIfBaseColorAlphaOpacity(field: string): void {
    if (field !== "useBaseColorAlphaForOpacity" || !this.def.useBaseColorAlphaForOpacity) return;
    if (!this.def.baseColorTexture) {
      this.setStatus("Assign a Base Color Map with an alpha channel to use this opacity source.", "warning");
    } else if (this.def.opacityTexture) {
      this.setStatus("Base Color alpha and Opacity Map are multiplied. Clear Opacity Map to avoid using an extra texture.", "info");
    } else {
      this.setStatus("Base Color Map alpha is now the opacity source. Mask is selected; choose Blend for soft transparency.", "info");
    }
  }

  private warnIfSurfaceMapUsesScalar(field: string): void {
    if (
      field !== "roughnessTexture" &&
      field !== "metalnessTexture" &&
      field !== "aoTexture" &&
      field !== "ormTexture"
    ) {
      return;
    }
    this.setStatus("Surface maps multiply the scalar sliders; set Roughness/Metalness near 1 for map-driven results.", "info");
  }

  private warnIfLayerBlendMaskUsesWrongTexture(field: string): void {
    if (field !== "layerBlendMaskTexture") return;
    if (this.statusEl.dataset.tone === "error") return;
    const textureId = this.def.layerBlend?.maskTexture;
    if (!textureId) return;
    const asset = this.textureAssetById(textureId);
    if (!asset) return;
    const semantic = inferTextureSemantic(asset);
    if (semantic === "normal") {
      this.setStatus("Blend Mask expects a linear grayscale mask, not a normal map.", "warning");
    } else if (semantic === "color") {
      this.setStatus("Blend Mask expects a linear grayscale mask; color/base-color textures may give the wrong blend.", "warning");
    } else {
      this.setStatus("Blend Mask assigned. Black keeps Layer 0; white shows Layer 1.", "info");
    }
  }

  private async updatePreviewMaterial(): Promise<void> {
    const loadedTextures: Texture[] = [];
    try {
      this.lastPreviewShaderError = null;
      const baseMap = await this.loadTexture(this.def.baseColorTexture, loadedTextures);
      const normalMap = await this.loadTexture(this.def.normalTexture, loadedTextures);
      const roughnessMap = await this.loadTexture(this.def.roughnessTexture, loadedTextures);
      const metalnessMap = await this.loadTexture(this.def.metalnessTexture, loadedTextures);
      const aoMap = await this.loadTexture(this.def.aoTexture, loadedTextures);
      const opacityMap = await this.loadTexture(this.def.opacityTexture, loadedTextures);
      const emissiveMap = await this.loadTexture(this.def.emissiveTexture, loadedTextures);
      const ormMap = await this.loadTexture(this.def.ormTexture, loadedTextures);
      const layer1BaseColorMap = await this.loadTexture(this.def.layerBlend?.layer1.baseColorTexture ?? null, loadedTextures);
      const layer1NormalMap = await this.loadTexture(this.def.layerBlend?.layer1.normalTexture ?? null, loadedTextures);
      const layer1RoughnessMap = await this.loadTexture(this.def.layerBlend?.layer1.roughnessTexture ?? null, loadedTextures);
      const layer1MetalnessMap = await this.loadTexture(this.def.layerBlend?.layer1.metalnessTexture ?? null, loadedTextures);
      const layer1OpacityMap = await this.loadTexture(this.def.layerBlend?.layer1.opacityTexture ?? null, loadedTextures);
      const layer1EmissiveMap = await this.loadTexture(this.def.layerBlend?.layer1.emissiveTexture ?? null, loadedTextures);
      const layer1AoMap = await this.loadTexture(this.def.layerBlend?.layer1.aoTexture ?? null, loadedTextures);
      const layerBlendMaskMap = await this.loadTexture(this.def.layerBlend?.maskTexture ?? null, loadedTextures);
      const material = createThreeMaterialFromForgeDef(
        this.def,
        {
          baseColorTexture: baseMap,
          normalTexture: normalMap,
          roughnessTexture: roughnessMap,
          metalnessTexture: metalnessMap,
          aoTexture: aoMap,
          opacityTexture: opacityMap,
          emissiveTexture: emissiveMap,
          ormTexture: ormMap,
          layer1BaseColorTexture: layer1BaseColorMap,
          layer1NormalTexture: layer1NormalMap,
          layer1RoughnessTexture: layer1RoughnessMap,
          layer1MetalnessTexture: layer1MetalnessMap,
          layer1OpacityTexture: layer1OpacityMap,
          layer1EmissiveTexture: layer1EmissiveMap,
          layer1AoTexture: layer1AoMap,
          layerBlendMaskTexture: layerBlendMaskMap,
        },
        { maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy() },
      );
      const previousMaterial = this.previewMaterial;
      this.previewMaterial = material;
      this.sphere.material = material;
      this.renderPreview();
      if (this.lastPreviewShaderError) {
        this.previewMaterial = previousMaterial;
        if (previousMaterial) this.sphere.material = previousMaterial;
        material.dispose();
        loadedTextures.forEach((texture) => texture.dispose());
        this.renderPreview();
        return;
      }
      const previousTextures = this.loadedTextures.splice(0);
      previousTextures.forEach((texture) => texture.dispose());
      previousMaterial?.dispose();
      this.loadedTextures.push(...loadedTextures);
      this.syncPreviewAnimation();
    } catch (error) {
      loadedTextures.forEach((texture) => texture.dispose());
      this.setStatus(`Preview texture failed: ${describeError(error)}`, "error");
    }
  }

  private async loadTexture(assetId: string | null, loadedTextures: Texture[]): Promise<Texture | null> {
    if (!assetId) return null;
    const asset = this.textureAssetById(assetId);
    if (!asset) return null;
    const texture = await this.textureLoader.loadAsync(projectFileUrl(asset.path));
    loadedTextures.push(texture);
    return texture;
  }

  private textureAssetById(assetId: string): MaterialEditorAssetOption | null {
    return this.options.assets?.find((entry) => entry.id === assetId && entry.assetType === "texture") ?? null;
  }

  private resize = (): void => {
    if (this.disposed) return;
    const rect = this.previewHost.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderPreview();
  };

  private renderPreview(): void {
    if (this.disposed || this.contextLost) return;
    advanceForgeMaterialAnimations(performance.now() / 1000);
    this.renderer.render(this.scene, this.camera);
  }

  private syncPreviewAnimation(): void {
    if (!hasForgeMaterialNormalMotion(this.previewMaterial)) {
      if (this.previewAnimationFrame) cancelAnimationFrame(this.previewAnimationFrame);
      this.previewAnimationFrame = 0;
      return;
    }
    if (this.previewAnimationFrame) return;
    const tick = () => {
      if (this.disposed || !hasForgeMaterialNormalMotion(this.previewMaterial)) {
        this.previewAnimationFrame = 0;
        return;
      }
      this.previewAnimationFrame = requestAnimationFrame(tick);
      this.renderPreview();
    };
    this.previewAnimationFrame = requestAnimationFrame(tick);
  }

  private onContextLost = (event: Event): void => {
    // preventDefault is what lets the browser fire `webglcontextrestored` afterwards.
    event.preventDefault();
    this.contextLost = true;
    this.setStatus("Preview GPU context lost; restoring…", "warning");
  };

  private onContextRestored = (): void => {
    if (this.disposed) return;
    this.contextLost = false;
    // GPU resources were discarded with the old context; rebuild material + textures.
    void this.updatePreviewMaterial();
  };

  private async save(): Promise<void> {
    try {
      const result = await saveMaterialAsset(this.options.path, this.def);
      this.dirty = false;
      this.overlay.querySelector<HTMLButtonElement>("[data-me-save]")?.classList.remove("is-dirty");
      this.setStatus(result.changed ? `Saved ${result.path}` : "No changes to save.", "success");
      this.options.onSaved?.();
    } catch (error) {
      this.setStatus(`Save failed: ${describeError(error)}`, "error");
    }
  }

  private markDirty(): void {
    this.overlay.querySelector<HTMLButtonElement>("[data-me-save]")?.classList.add("is-dirty");
  }

  private setStatus(message: string, tone: StatusTone = "info"): void {
    this.statusEl.textContent = message;
    this.statusEl.dataset.tone = tone;
    this.options.onStatus?.(message, tone);
  }

  close(): void {
    if (this.disposed) return;
    if (this.dirty && !window.confirm("Close Material Editor without saving?")) return;
    this.disposed = true;
    if (this.previewAnimationFrame) cancelAnimationFrame(this.previewAnimationFrame);
    this.previewAnimationFrame = 0;
    window.removeEventListener("resize", this.resize);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onContextLost);
    this.renderer.domElement.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.disposePreviewMaterial();
    this.sphere.geometry.dispose();
    this.renderer.dispose();
    this.overlay.remove();
    if (MaterialEditor.activeInstance === this) MaterialEditor.activeInstance = null;
  }

  private disposePreviewMaterial(): void {
    for (const texture of this.loadedTextures.splice(0)) texture.dispose();
    this.previewMaterial?.dispose();
    this.previewMaterial = null;
  }
}

function numberInput(value: string, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

function defaultLayerBlend(current: ForgeMaterialLayerBlend | null): ForgeMaterialLayerBlend {
  return {
    layer1: {
      baseColor: current?.layer1.baseColor ?? "#ffffff",
      baseColorTexture: current?.layer1.baseColorTexture ?? null,
      normalTexture: current?.layer1.normalTexture ?? null,
      roughnessTexture: current?.layer1.roughnessTexture ?? null,
      metalnessTexture: current?.layer1.metalnessTexture ?? null,
      opacityTexture: current?.layer1.opacityTexture ?? null,
      emissiveTexture: current?.layer1.emissiveTexture ?? null,
      aoTexture: current?.layer1.aoTexture ?? null,
      roughness: current?.layer1.roughness ?? 0.8,
      metalness: current?.layer1.metalness ?? 0,
      opacity: current?.layer1.opacity ?? 1,
      emissive: current?.layer1.emissive ?? "#000000",
      emissiveIntensity: current?.layer1.emissiveIntensity ?? 0,
      aoIntensity: current?.layer1.aoIntensity ?? 1,
      uvTiling: current?.layer1.uvTiling ?? { x: 1, y: 1 },
    },
    driver: current?.driver ?? "constant",
    amount: current?.amount ?? 0.5,
    min: current?.min ?? 0,
    max: current?.max ?? 1,
    contrast: current?.contrast ?? 1,
    maskTexture: current?.maskTexture ?? null,
    vertexColorChannel: current?.vertexColorChannel ?? "r",
    invertVertexColor: current?.invertVertexColor ?? false,
  };
}

function createPreviewSphereGeometry(): SphereGeometry {
  const geometry = new SphereGeometry(0.9, 64, 40);
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 4);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index) / 1.8 + 0.5;
    const y = position.getY(index) / 1.8 + 0.5;
    const offset = index * 4;
    colors[offset] = x;
    colors[offset + 1] = y;
    colors[offset + 2] = 1 - x;
    colors[offset + 3] = y;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 4));
  return geometry;
}

function isLayerTextureField(field: string): field is
  | "layer1BaseColorTexture"
  | "layer1NormalTexture"
  | "layer1RoughnessTexture"
  | "layer1MetalnessTexture"
  | "layer1OpacityTexture"
  | "layer1EmissiveTexture"
  | "layer1AoTexture"
  | "layerBlendMaskTexture" {
  return field.startsWith("layer1") || field === "layerBlendMaskTexture";
}

function isTextureField(field: string): field is TextureField {
  return (
    field === "baseColorTexture" ||
    field === "normalTexture" ||
    field === "roughnessTexture" ||
    field === "metalnessTexture" ||
    field === "aoTexture" ||
    field === "opacityTexture" ||
    field === "emissiveTexture" ||
    field === "ormTexture" ||
    isLayerTextureField(field)
  );
}

function normalizeTextureSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function textureSearchTokens(asset: MaterialEditorAssetOption): string[] {
  return `${asset.name} ${asset.id} ${asset.path}`
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function inferTextureSemantic(
  asset: MaterialEditorAssetOption,
): "color" | "normal" | "scalar" | "unknown" {
  const text = `${asset.id} ${asset.name} ${asset.path}`.toLowerCase();
  if (/(^|[_\-\s])(n|normal)([_\-\s.]|$)/.test(text)) return "normal";
  if (/(normalmap|_n\.|[-_]n[-_.])/.test(text)) return "normal";
  if (/(basecolor|base-color|albedo|diffuse|_d\.|[-_]d[-_.])/.test(text)) {
    return "color";
  }
  if (/(mask|rough|metal|orm|ao|noise|variation|_m\.|[-_]m[-_.])/.test(text)) {
    return "scalar";
  }
  return "unknown";
}
