import {
  Box3,
  Box3Helper,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Material,
  type Object3D,
  type Raycaster,
} from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";

import { DEFAULT_PHYSICS_FIXED_STEP } from "@engine/physics/fixedStep";
import { bakeFracture, type FractureBakeResult } from "@engine/physics/fracture/fractureBake";
import {
  anchoredChunks, bottomAnchorBox, damageRadius, releaseSupportHit,
} from "@engine/physics/fracture/fractureSupport";
import {
  FRACTURE_GRAIN_AXES,
  FRACTURE_LIMITS,
  FRACTURE_MAX_ANCHORS,
  FRACTURE_SUPPORT_LIMITS,
  createAssetFracture,
  fractureGrain,
  fractureSourceHash,
  fractureWarnings,
  normalizeAssetFracture,
  type AssetFractureDef,
  type FractureGrainAxis,
  type FracturePattern,
  type FractureSupportDef,
  type FractureSupportMode,
  type FractureWarning,
} from "@engine/physics/fracture/fractureTypes";
import {
  checkFractureSource, meshBounds, polyhedronFromMesh, polyhedronVolume, type FractureVec3,
} from "@engine/physics/fracture/voronoiFracture";
import { fractureChunkGeometry, fractureSourceFromObject } from "@engine/render-three/fractureGeometry";
import { loadAssetFracture, saveAssetFracture } from "@/editor/assetFractureStore";

/**
 * The Static Mesh Editor's "Fracture" section (DEFORMABLE_FRACTURABLE_WORK_PLAN
 * Faz 3): edits the asset's `<Model>.fracture.json`, bakes the chunks the
 * runtime will produce (same seed, same source mesh, same pure bake) and
 * previews them in the viewport, pulled apart by the Explode slider, with
 * their collision hulls as wires. The sidecar stores parameters only; Bake
 * records the mesh hash so a later mesh edit reads as a stale bake.
 */

export interface StaticMeshFractureHost {
  readonly modelPath: string;
  /** The loaded model root (`gltf.scene`), or null while it loads. */
  modelRoot(): Object3D | null;
  /** Viewport group the preview chunks live in (owned by the editor's scene). */
  readonly previewGroup: Group;
  /** Viewport group for the support overlay (anchor boxes), shown over the intact model too. */
  readonly supportGroup: Group;
  /** Hide the intact model while the chunks are shown. */
  setModelVisible(visible: boolean): void;
  /** Manifest material assets for the interior material picker. */
  materialAssets(): readonly { id: string; name: string }[];
  /** Manifest assets of these types (`effect`, `sound`, `soundCue`) for the break presentation pickers. */
  assetsOfType(types: readonly string[]): readonly { id: string; name: string }[];
  /** Loads a manifest material for the preview; null when it cannot. */
  loadMaterial(id: string): Promise<Material | null>;
  markDirty(): void;
  setStatus(message: string, tone?: "info" | "warning" | "error"): void;
  /** Re-renders the details panel (the section's HTML comes from {@link StaticMeshFracture.html}). */
  rerender(): void;
}

interface BakeState {
  readonly result: FractureBakeResult;
  readonly hash: string;
  readonly closed: boolean;
  readonly convex: boolean;
  readonly materialCount: number;
  readonly totalMass: number;
  readonly milliseconds: number;
  /** Centre the Explode slider pushes chunks away from. */
  readonly center: Vector3;
  readonly meshes: Mesh[];
  readonly hulls: LineSegments[];
}

type NumberKey = "cellCount" | "grainStretch" | "seed" | "density" | "interiorUvScale" | "breakImpulse" | "chunkLifetime"
  | "maxActiveChunks" | "crumbleBelow" | "maxSeparation";

/** Asset pickers of the break presentation, all optional (null = none). */
const ASSET_FIELDS: readonly {
  key: "breakEffect" | "breakSound" | "crumbleEffect";
  label: string;
  types: readonly string[];
  title: string;
}[] = [
  { key: "breakEffect", label: "Break Effect", types: ["effect"], title: "Kırıldığı noktada bir kez oynayan efekt (toz, kıymık)" },
  { key: "breakSound", label: "Break Sound", types: ["sound", "soundCue"], title: "Kırıldığı noktada bir kez çalan ses; Sound Cue rastgele çeşitleme verir" },
  { key: "crumbleEffect", label: "Crumble Effect", types: ["effect"], title: "Crumble Below'dan küçük parçaların yerinde oynayan efekt" },
];

const NUMBER_FIELDS: readonly { key: NumberKey; label: string; step: number; title: string; sliderMax?: number }[] = [
  { key: "cellCount", label: "Cell Count", step: 1, title: "Kaç parçaya bölüneceği" },
  { key: "grainStretch", label: "Grain Stretch", step: 0.5, title: "Kıymıklar lif yönünde enine göre kaç kat uzun olsun (1 = taş gibi)" },
  { key: "seed", label: "Seed", step: 1, title: "Aynı seed aynı parçaları üretir", sliderMax: 9999 },
  { key: "density", label: "Density (kg/m³)", step: 10, title: "Parça kütlesi = hacim × yoğunluk (ahşap ≈ 600, beton ≈ 2400)", sliderMax: 8000 },
  { key: "breakImpulse", label: "Break Impulse (N·s)", step: 10, title: "Bu impulse'u aşan çarpma nesneyi kırar", sliderMax: 5000 },
  { key: "chunkLifetime", label: "Chunk Lifetime (s)", step: 1, title: "Parçaların sahnede kalma süresi; 0 kalıcı" },
  { key: "maxActiveChunks", label: "Max Active Chunks", step: 1, title: "Bu nesneden aynı anda yaşayan en fazla parça", sliderMax: 64 },
  { key: "interiorUvScale", label: "Interior UV Scale (m)", step: 0.05, title: "Kesik yüz dokusunun bir tekrarı kaç metre", sliderMax: 10 },
  { key: "crumbleBelow", label: "Crumble Below", step: 0.005, title: "Toplam hacmin bu payından küçük parçalar gövde olmaz, efektle ufalanır (0.02 = %2; 0 kapalı)" },
  { key: "maxSeparation", label: "Max Separation (m)", step: 1, title: "Kırılma noktasından bu kadar uzaklaşan parça silinir; 0 sınırsız", sliderMax: 100 },
];

const HULL_MATERIAL = new LineBasicMaterial({ color: 0x5fd4ff, transparent: true, opacity: 0.8, depthTest: false });
const FALLBACK_INTERIOR = new MeshStandardMaterial({ color: 0x8a7158, roughness: 0.95 });

type SupportNumberKey = "damageRadius" | "damageRadiusPerImpulse" | "damageRadiusMax";

const SUPPORT_NUMBER_FIELDS: readonly { key: SupportNumberKey; label: string; step: number; title: string; sliderMax?: number }[] = [
  { key: "damageRadius", label: "Damage Radius (m)", step: 0.05, title: "Darbe noktasının bu yarıçapındaki parçalar kopar (en az en yakın parça)", sliderMax: 5 },
  { key: "damageRadiusPerImpulse", label: "Radius Per Impulse (m/N·s)", step: 0.00005, title: "Darbe impulse'unun her N·s'si yarıçapa bu kadar ekler", sliderMax: 0.002 },
  { key: "damageRadiusMax", label: "Damage Radius Max (m)", step: 0.1, title: "Yarıçapın üst sınırı; 0 sınırsız", sliderMax: 10 },
];

/** Support preview tints: anchored, released by the hit's radius, collapsed with no path to an anchor. */
const ANCHORED_MATERIAL = new MeshStandardMaterial({ color: 0x3fbf6f, roughness: 0.8 });
const RELEASED_MATERIAL = new MeshStandardMaterial({ color: 0xe0533d, roughness: 0.8 });
const COLLAPSED_MATERIAL = new MeshStandardMaterial({ color: 0xf0a030, roughness: 0.8 });
const LINK_MATERIAL = new LineBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthTest: false });
const ANCHOR_BOX_COLOR = new Color(0x3fbf6f);

/** Simulate Hit state over the current bake (preview only, never saved). */
interface SupportSimulation {
  readonly present: boolean[];
  readonly inRadius: Set<number>;
  readonly collapsed: Set<number>;
  hits: number;
}

export class StaticMeshFracture {
  private def: AssetFractureDef | null = null;
  /** The def as last loaded or saved, to tell whether saving has anything to write. */
  private saved: string = "null";
  private bake: BakeState | null = null;
  private interior: Material | null = null;
  private explode = 0.35;
  private showChunks = true;
  private showHulls = false;
  private warnings: FractureWarning[] = [];
  /** Support preview (Faz 4c-4): chunk anchored flags of the current bake, box anchors only. */
  private anchored: boolean[] = [];
  private showSupport = true;
  private showLinks = false;
  private bottomPercent = 20;
  /** Simulate Hit impulse; null follows the asset's Break Impulse. */
  private hitImpulse: number | null = null;
  /** Simulate Hit armed: the next viewport click on a chunk hits there. */
  private hitArmed = false;
  private sim: SupportSimulation | null = null;
  private links: LineSegments | null = null;

  constructor(private readonly host: StaticMeshFractureHost) {}

  /** True while Simulate Hit waits for a viewport click; the editor then routes clicks to {@link pickHit}. */
  get wantsViewportHit(): boolean {
    return this.hitArmed && this.bake !== null && this.def?.support.mode === "anchored";
  }

  /** Hits the chunk under the ray (model space); false when the ray misses every chunk. */
  pickHit(raycaster: Raycaster): boolean {
    const bake = this.bake;
    if (!bake || !this.showChunks) return false;
    const standing = bake.meshes.filter((_, index) => this.sim?.present[index] ?? true);
    const hit = raycaster.intersectObjects(standing, false)[0];
    if (!hit) return false;
    const mesh = hit.object as Mesh;
    // Undo the Explode offset: the hit lands on the chunk where the bake put it.
    const local = this.host.previewGroup.worldToLocal(hit.point.clone())
      .sub(mesh.position).add(mesh.userData.fracturePivot as Vector3);
    this.hitAt([local.x, local.y, local.z]);
    return true;
  }

  async load(): Promise<void> {
    this.def = await loadAssetFracture(this.host.modelPath);
    this.saved = JSON.stringify(this.def);
    await this.refreshInterior();
    this.refreshWarnings();
    this.refreshSupportPreview();
  }

  /** The model arrived: warnings can now compare against its real hash. */
  modelLoaded(): void {
    this.refreshWarnings();
  }

  /** True when the sidecar differs from what is on disk. */
  get dirty(): boolean {
    return JSON.stringify(this.def) !== this.saved;
  }

  /** Writes the sidecar when it changed; a never-added fracture writes nothing. */
  async save(): Promise<{ path: string; changed: boolean; dropped: string[] } | null> {
    if (!this.def || !this.dirty) return null;
    const result = await saveAssetFracture(this.host.modelPath, this.def);
    this.saved = JSON.stringify(this.def);
    return result;
  }

  html(): string {
    const def = this.def;
    if (!def) {
      return `
      <div class="sm-section" data-sm-fracture>
        <div class="sm-section-title">Fracture</div>
        <div class="sm-hint">Bu asset kırılmaz. Fracture eklemek, modelin yanına parametre dosyası (.fracture.json) yazar; parçalar oyunda aynı seed'den yeniden üretilir.</div>
        <div class="sm-prim-list"><button type="button" data-sm-fracture-add>Add Fracture</button></div>
      </div>`;
    }
    const materials = this.host.materialAssets();
    const materialOptions = [`<option value="" ${def.interiorMaterialId ? "" : "selected"}>Exterior material</option>`]
      .concat(materials.map((asset) =>
        `<option value="${escapeHtml(asset.id)}" ${asset.id === def.interiorMaterialId ? "selected" : ""}>${escapeHtml(asset.name)}</option>`))
      .join("");
    const splinter = def.pattern === "splinter";
    const axisOptions = FRACTURE_GRAIN_AXES.map((axis) =>
      `<option value="${axis}" ${axis === def.grainAxis ? "selected" : ""}>${axis.toUpperCase()}</option>`).join("");
    const patternRows = `
        <label class="sm-row" title="Uniform: her yönde eşit parçalar (taş, cam). Splinter: lif yönünde uzayan kıymıklar (ahşap)">
          <span>Pattern</span>
          <select data-sm-fracture-pattern>
            <option value="uniform" ${splinter ? "" : "selected"}>Uniform</option>
            <option value="splinter" ${splinter ? "selected" : ""}>Splinter</option>
          </select>
        </label>
        ${splinter ? `<label class="sm-row" title="Modelin lif (damar) yönü; kıymıklar bu eksen boyunca uzar, kesik yüz dokusu da bu yönde akar">
          <span>Grain Axis</span>
          <select data-sm-fracture-grain-axis>${axisOptions}</select>
        </label>` : ""}`;
    const numberRows = NUMBER_FIELDS.filter(({ key }) => key !== "grainStretch" || splinter).map(({ key, label, step, title, sliderMax }) => {
      const [min, max] = FRACTURE_LIMITS[key];
      return `
        <label class="sm-row" title="${title}">
          <span>${label}</span>
          <input type="number" data-sm-fracture-num="${key}" min="${min}" max="${max}" step="${step}"
            ${sliderMax !== undefined ? `data-slider-max="${sliderMax}"` : ""} value="${def[key]}" />
        </label>`;
    }).join("");
    const assetRows = ASSET_FIELDS.map(({ key, label, types, title }) => {
      const current = def[key];
      const options = [`<option value="" ${current ? "" : "selected"}>None</option>`]
        .concat(this.host.assetsOfType(types).map((asset) =>
          `<option value="${escapeHtml(asset.id)}" ${asset.id === current ? "selected" : ""}>${escapeHtml(asset.name)}</option>`))
        .join("");
      return `
        <label class="sm-row" title="${title}">
          <span>${label}</span>
          <select data-sm-fracture-asset="${key}">${options}</select>
        </label>`;
    }).join("");
    const [damageMin, damageMax] = FRACTURE_LIMITS.damageToBreak;
    const bake = this.bake;
    const stats = bake
      ? `${bake.result.chunks.length} parça · ${bake.totalMass.toFixed(1)} kg · ${bake.milliseconds.toFixed(1)} ms${bake.result.mergedCells > 0 ? ` · ${bake.result.mergedCells} hücre birleşti` : ""}`
      : "Önizleme yok.";
    const warnings = this.warnings.length
      ? this.warnings.map((warning) => `<div class="sm-hint sm-fracture-warning" data-sm-fracture-warning="${warning.code}">⚠ ${escapeHtml(warning.message)}</div>`).join("")
      : "";
    return `
      <div class="sm-section" data-sm-fracture>
        <div class="sm-section-title">Fracture</div>
        <label class="sm-row sm-toggle" title="Kapalıyken dosya kalır ama asset kırılmaz">
          <input type="checkbox" data-sm-fracture-enabled ${def.enabled ? "checked" : ""} />
          <span>Enabled</span>
        </label>
        ${patternRows}
        ${numberRows}
        <label class="sm-row" title="Bu kadar Damage.Apply birikince kırılır; boş = yalnız çarpma">
          <span>Damage To Break</span>
          <input type="number" data-sm-fracture-damage min="${damageMin}" max="${damageMax}" step="1"
            data-param-slider="off" placeholder="none" value="${def.damageToBreak ?? ""}" />
        </label>
        <label class="sm-row" title="Kesik yüzlerin materyali">
          <span>Interior Material</span>
          <select data-sm-fracture-interior>${materialOptions}</select>
        </label>
        ${assetRows}
        <div class="sm-prim-list">
          <button type="button" data-sm-fracture-bake title="Parçaları üret ve önizle; mesh'in izi kaydedilir">Bake</button>
          <button type="button" data-sm-fracture-reseed title="Yeni bir seed seç ve yeniden bake et">New Seed</button>
        </div>
        <div class="sm-hint" data-sm-fracture-stats>${stats}</div>
        <label class="sm-row sm-toggle" title="Bütün model yerine parçaları göster">
          <input type="checkbox" data-sm-fracture-show ${this.showChunks ? "checked" : ""} ${bake ? "" : "disabled"} />
          <span>Show Chunks</span>
        </label>
        <label class="sm-row" title="Parçaları merkezden dışarı it (yalnız önizleme)">
          <span>Explode</span>
          <input type="number" data-sm-fracture-explode min="0" max="1" step="0.05" value="${this.explode}" ${bake ? "" : "disabled"} />
        </label>
        <label class="sm-row sm-toggle" title="Parçaların çarpışma gövdelerini (convex hull) tel kafes göster">
          <input type="checkbox" data-sm-fracture-hulls ${this.showHulls ? "checked" : ""} ${bake ? "" : "disabled"} />
          <span>Show Hulls</span>
        </label>
        ${warnings}
      </div>
      ${this.supportHtml(def.support)}`;
  }

  /** The "Support" section (Faz 4c-4): anchors, damage radius and the Simulate Hit preview. */
  private supportHtml(support: FractureSupportDef): string {
    const anchored = support.mode === "anchored";
    const modeRow = `
        <label class="sm-row" title="None: vurulunca bütün nesne kırılır. Anchored: yalnız darbe çevresi kopar, sabitlenmiş parçalara bağlı kalanlar ayakta durur">
          <span>Mode</span>
          <select data-sm-fracture-support-mode>
            <option value="none" ${anchored ? "" : "selected"}>None</option>
            <option value="anchored" ${anchored ? "selected" : ""}>Anchored</option>
          </select>
        </label>`;
    if (!anchored) {
      return `
      <div class="sm-section" data-sm-fracture-support>
        <div class="sm-section-title">Support</div>
        ${modeRow}
      </div>`;
    }
    const numberRows = SUPPORT_NUMBER_FIELDS.map(({ key, label, step, title, sliderMax }) => {
      const [min, max] = FRACTURE_SUPPORT_LIMITS[key];
      return `
        <label class="sm-row" title="${title}">
          <span>${label}</span>
          <input type="number" data-sm-fracture-support-num="${key}" min="${min}" max="${max}" step="${step}"
            ${sliderMax !== undefined ? `data-slider-max="${sliderMax}"` : ""} value="${support[key]}" />
        </label>`;
    }).join("");
    const [low, high] = FRACTURE_SUPPORT_LIMITS.anchorCoordinate;
    const corner = (index: number, name: "min" | "max", values: readonly number[]): string => `
        <div class="sm-row" title="Kutunun model uzayındaki ${name === "min" ? "alt" : "üst"} köşesi (m)">
          <span>${name === "min" ? "Min" : "Max"}</span>
          <div class="sm-fracture-vec">${[0, 1, 2].map((axis) => `
            <input type="number" data-sm-fracture-anchor="${index}" data-corner="${name}" data-axis="${axis}"
              min="${low}" max="${high}" step="0.05" aria-label="${name} ${"XYZ"[axis]}" value="${round(values[axis]!)}" />`).join("")}
          </div>
        </div>`;
    const anchorRows = support.anchors.map((box, index) => `
        <div class="sm-fracture-anchor" data-sm-fracture-anchor-row="${index}">
          <div class="sm-row">
            <span>Anchor ${index + 1}</span>
            <button type="button" data-sm-fracture-anchor-remove="${index}" title="Bu anchor kutusunu sil">Remove</button>
          </div>
          ${corner(index, "min", box.min)}
          ${corner(index, "max", box.max)}
        </div>`).join("");
    const full = support.anchors.length >= FRACTURE_MAX_ANCHORS;
    const bake = this.bake;
    const anchoredCount = this.anchored.filter(Boolean).length;
    const supportStats = bake
      ? `${anchoredCount} / ${bake.result.chunks.length} parça anchor'lı · ${bake.result.links.length} bağ`
      : "Önizleme için Bake et.";
    const sim = this.sim;
    const standing = sim ? sim.present.filter(Boolean).length : bake?.result.chunks.length ?? 0;
    const simStats = sim
      ? `${sim.hits} vuruş · ${sim.inRadius.size} yarıçapta koptu · ${sim.collapsed.size} desteksiz düştü · ${standing} ayakta`
      : "Simulate Hit'e basıp önizlemede bir parçaya tıkla ya da Hit Center ile ortadan vur.";
    const impulse = this.hitImpulse ?? this.def?.breakImpulse ?? 0;
    const [impulseMin, impulseMax] = FRACTURE_LIMITS.breakImpulse;
    return `
      <div class="sm-section" data-sm-fracture-support>
        <div class="sm-section-title">Support</div>
        ${modeRow}
        <label class="sm-row sm-toggle" title="Oyunda ilk darbe anında statik dünyaya (zemin, duvar) değen parçalar da anchor olur">
          <input type="checkbox" data-sm-fracture-world-support ${support.worldSupport ? "checked" : ""} />
          <span>World Support</span>
        </label>
        ${support.worldSupport ? `<div class="sm-hint">World Support editörde hesaplanmaz (burada zemin yok); önizleme yalnız anchor kutularını kullanır.</div>` : ""}
        ${numberRows}
        <div class="sm-section-title">Anchors <span class="sm-count">${support.anchors.length}</span></div>
        ${anchorRows || `<div class="sm-hint">Anchor kutusu yok${support.worldSupport ? "; oyunda yalnız World Support tutar" : ""}.</div>`}
        <label class="sm-row" title="Bottom kısayolu modelin alttan bu yüzdesini kaplayan bir kutu ekler">
          <span>Bottom %</span>
          <input type="number" data-sm-fracture-bottom-percent min="1" max="100" step="1" value="${this.bottomPercent}" />
        </label>
        <div class="sm-prim-list">
          <button type="button" data-sm-fracture-anchor-bottom ${full ? "disabled" : ""} title="Modelin alttan Bottom % kadarını anchor yap">Add Bottom ${this.bottomPercent}%</button>
          <button type="button" data-sm-fracture-anchor-add ${full ? "disabled" : ""} title="Modelin sınırları büyüklüğünde bir kutu ekle; köşelerini sonra daralt">Add Box</button>
        </div>
        <div class="sm-hint" data-sm-fracture-support-stats data-anchored="${anchoredCount}">${supportStats}</div>
        <label class="sm-row sm-toggle" title="Anchor'lı parçaları yeşil, kopanları kırmızı, desteksiz düşenleri turuncu göster; anchor kutularını tel kafes çiz">
          <input type="checkbox" data-sm-fracture-show-support ${this.showSupport ? "checked" : ""} />
          <span>Show Support</span>
        </label>
        <label class="sm-row sm-toggle" title="Parça komşuluk grafiğini (ortak kesim yüzü olan parçalar) tel çiz">
          <input type="checkbox" data-sm-fracture-links ${this.showLinks ? "checked" : ""} ${bake ? "" : "disabled"} />
          <span>Show Links</span>
        </label>
        <label class="sm-row" title="Simulate Hit'in impulse'u; yarıçap = Damage Radius + Per Impulse × impulse (yalnız önizleme)">
          <span>Hit Impulse (N·s)</span>
          <input type="number" data-sm-fracture-hit-impulse min="${impulseMin}" max="${impulseMax}" step="100"
            data-slider-max="50000" value="${impulse}" ${bake ? "" : "disabled"} />
        </label>
        <div class="sm-prim-list">
          <button type="button" data-sm-fracture-simulate aria-pressed="${this.hitArmed}" ${bake ? "" : "disabled"}
            title="Açıkken önizlemede tıkladığın parçaya vurur; art arda vuruşlar birikir (dosyaya yazılmaz)">Simulate Hit</button>
          <button type="button" data-sm-fracture-hit-center ${bake ? "" : "disabled"} title="Modelin ortasına vur">Hit Center</button>
          <button type="button" data-sm-fracture-sim-reset ${sim ? "" : "disabled"} title="Bütün parçaları geri getir">Reset Hits</button>
        </div>
        <div class="sm-hint">Önizleme model ölçeğindedir; yerleşimin ölçeği oyunda parçaları büyütür ama yarıçap metre olarak kalır.</div>
        <div class="sm-hint" data-sm-fracture-sim
          data-released="${sim?.inRadius.size ?? 0}" data-collapsed="${sim?.collapsed.size ?? 0}" data-standing="${standing}">${simStats}</div>
      </div>`;
  }

  bind(root: HTMLElement): void {
    root.querySelector<HTMLButtonElement>("[data-sm-fracture-add]")?.addEventListener("click", () => {
      this.def = createAssetFracture();
      this.changed();
      this.bakeNow();
    });
    root.querySelector<HTMLInputElement>("[data-sm-fracture-enabled]")?.addEventListener("change", (event) => {
      this.patch({ enabled: (event.currentTarget as HTMLInputElement).checked });
    });
    root.querySelectorAll<HTMLInputElement>("[data-sm-fracture-num]").forEach((input) => {
      input.addEventListener("change", () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        const key = input.dataset.smFractureNum as NumberKey;
        this.patch({ [key]: value });
        // Shape parameters change the chunks: re-bake so the preview never lies.
        if (key === "cellCount" || key === "seed" || key === "interiorUvScale" || key === "grainStretch") this.bakeNow();
        else if (key === "density" && this.bake) this.bakeNow();
      });
    });
    root.querySelector<HTMLSelectElement>("[data-sm-fracture-pattern]")?.addEventListener("change", (event) => {
      this.patch({ pattern: (event.currentTarget as HTMLSelectElement).value as FracturePattern });
      this.bakeNow();
    });
    root.querySelector<HTMLSelectElement>("[data-sm-fracture-grain-axis]")?.addEventListener("change", (event) => {
      this.patch({ grainAxis: (event.currentTarget as HTMLSelectElement).value as FractureGrainAxis });
      this.bakeNow();
    });
    root.querySelector<HTMLInputElement>("[data-sm-fracture-damage]")?.addEventListener("change", (event) => {
      const raw = (event.currentTarget as HTMLInputElement).value.trim();
      const value = Number(raw);
      this.patch({ damageToBreak: raw === "" || !Number.isFinite(value) ? null : value });
    });
    root.querySelectorAll<HTMLSelectElement>("[data-sm-fracture-asset]").forEach((select) => {
      select.addEventListener("change", () => {
        const key = select.dataset.smFractureAsset as (typeof ASSET_FIELDS)[number]["key"];
        this.patch({ [key]: select.value || null });
      });
    });
    root.querySelector<HTMLSelectElement>("[data-sm-fracture-interior]")?.addEventListener("change", (event) => {
      const id = (event.currentTarget as HTMLSelectElement).value;
      this.patch({ interiorMaterialId: id || null });
      void this.refreshInterior().then(() => this.applyInterior());
    });
    root.querySelector<HTMLButtonElement>("[data-sm-fracture-bake]")?.addEventListener("click", () => this.bakeNow());
    root.querySelector<HTMLButtonElement>("[data-sm-fracture-reseed]")?.addEventListener("click", () => {
      const current = this.def?.seed ?? 0;
      // Deterministic next seed (Knuth multiplicative step) so New Seed is reproducible.
      this.patch({ seed: (Math.imul(current + 1, 2654435761) >>> 0) % 100000 });
      this.bakeNow();
    });
    root.querySelector<HTMLInputElement>("[data-sm-fracture-show]")?.addEventListener("change", (event) => {
      this.showChunks = (event.currentTarget as HTMLInputElement).checked;
      this.applyVisibility();
    });
    root.querySelector<HTMLInputElement>("[data-sm-fracture-explode]")?.addEventListener("input", (event) => {
      const value = Number((event.currentTarget as HTMLInputElement).value);
      if (Number.isFinite(value)) this.setExplode(value);
    });
    root.querySelector<HTMLInputElement>("[data-sm-fracture-explode]")?.addEventListener("change", (event) => {
      const value = Number((event.currentTarget as HTMLInputElement).value);
      if (Number.isFinite(value)) this.setExplode(value);
    });
    root.querySelector<HTMLInputElement>("[data-sm-fracture-hulls]")?.addEventListener("change", (event) => {
      this.showHulls = (event.currentTarget as HTMLInputElement).checked;
      this.applyVisibility();
    });
    this.bindSupport(root);
  }

  private bindSupport(root: HTMLElement): void {
    root.querySelector<HTMLSelectElement>("[data-sm-fracture-support-mode]")?.addEventListener("change", (event) => {
      this.patchSupport({ mode: (event.currentTarget as HTMLSelectElement).value as FractureSupportMode });
    });
    root.querySelector<HTMLInputElement>("[data-sm-fracture-world-support]")?.addEventListener("change", (event) => {
      this.patchSupport({ worldSupport: (event.currentTarget as HTMLInputElement).checked });
    });
    root.querySelectorAll<HTMLInputElement>("[data-sm-fracture-support-num]").forEach((input) => {
      input.addEventListener("change", () => {
        const value = Number(input.value);
        if (Number.isFinite(value)) this.patchSupport({ [input.dataset.smFractureSupportNum as SupportNumberKey]: value });
      });
    });
    root.querySelectorAll<HTMLInputElement>("[data-sm-fracture-anchor]").forEach((input) => {
      input.addEventListener("change", () => {
        const value = Number(input.value);
        const anchors = this.def?.support.anchors;
        const index = Number(input.dataset.smFractureAnchor);
        const box = anchors?.[index];
        if (!anchors || !box || !Number.isFinite(value)) return;
        const corner = input.dataset.corner === "max" ? "max" : "min";
        const point = [...box[corner]] as [number, number, number];
        point[Number(input.dataset.axis)] = value;
        this.patchSupport({ anchors: anchors.map((entry, at) => at === index ? { ...entry, [corner]: point } : entry) });
      });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-sm-fracture-anchor-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.smFractureAnchorRemove);
        this.patchSupport({ anchors: (this.def?.support.anchors ?? []).filter((_, at) => at !== index) });
      });
    });
    root.querySelector<HTMLInputElement>("[data-sm-fracture-bottom-percent]")?.addEventListener("change", (event) => {
      const value = Number((event.currentTarget as HTMLInputElement).value);
      if (!Number.isFinite(value)) return;
      this.bottomPercent = Math.min(100, Math.max(1, Math.round(value)));
      this.host.rerender();
    });
    root.querySelector<HTMLButtonElement>("[data-sm-fracture-anchor-bottom]")?.addEventListener("click", () => {
      const bounds = this.modelBounds();
      if (bounds) this.addAnchor(bottomAnchorBox(bounds, this.bottomPercent / 100));
    });
    root.querySelector<HTMLButtonElement>("[data-sm-fracture-anchor-add]")?.addEventListener("click", () => {
      const bounds = this.modelBounds();
      if (bounds) this.addAnchor(bounds);
    });
    root.querySelector<HTMLInputElement>("[data-sm-fracture-show-support]")?.addEventListener("change", (event) => {
      this.showSupport = (event.currentTarget as HTMLInputElement).checked;
      this.refreshSupportPreview();
    });
    root.querySelector<HTMLInputElement>("[data-sm-fracture-links]")?.addEventListener("change", (event) => {
      this.showLinks = (event.currentTarget as HTMLInputElement).checked;
      this.refreshSupportPreview();
    });
    root.querySelector<HTMLInputElement>("[data-sm-fracture-hit-impulse]")?.addEventListener("change", (event) => {
      const value = Number((event.currentTarget as HTMLInputElement).value);
      if (Number.isFinite(value)) this.hitImpulse = Math.max(0, value);
    });
    root.querySelector<HTMLButtonElement>("[data-sm-fracture-simulate]")?.addEventListener("click", () => {
      this.hitArmed = !this.hitArmed;
      if (this.hitArmed) {
        this.showChunks = true;
        this.applyVisibility();
        this.host.setStatus("Simulate Hit: önizlemede bir parçaya tıkla (kapatmak için düğmeye tekrar bas).");
      }
      this.host.rerender();
    });
    root.querySelector<HTMLButtonElement>("[data-sm-fracture-hit-center]")?.addEventListener("click", () => {
      const bounds = this.modelBounds();
      if (!bounds) return;
      this.showChunks = true;
      this.applyVisibility();
      this.hitAt(bounds.min.map((value, axis) => (value + bounds.max[axis]!) / 2) as unknown as FractureVec3);
    });
    root.querySelector<HTMLButtonElement>("[data-sm-fracture-sim-reset]")?.addEventListener("click", () => {
      this.sim = null;
      this.setExplode(this.explode);
      this.refreshSupportPreview();
      this.host.rerender();
    });
  }

  /** Bakes from the loaded model and swaps the preview in. */
  bakeNow(): void {
    const def = this.def;
    const root = this.host.modelRoot();
    if (!def || !root) return;
    const started = performance.now();
    const source = fractureSourceFromObject(root);
    if (source.mesh.indices!.length === 0) {
      this.host.setStatus("Fracture: modelde üçgen yok.", "warning");
      return;
    }
    const volume = polyhedronVolume(polyhedronFromMesh(source.mesh));
    const result = bakeFracture(source.mesh, {
      seed: def.seed,
      cellCount: def.cellCount,
      totalMass: volume * def.density,
      interiorUvScale: def.interiorUvScale,
      ...(fractureGrain(def) ? { grain: fractureGrain(def)! } : {}),
    });
    const milliseconds = performance.now() - started;
    const check = checkFractureSource(source.mesh, 1e-6 * new Box3().setFromObject(root).getSize(new Vector3()).length());
    const hash = fractureSourceHash(source.mesh);
    this.clearPreview();
    const exterior = source.materials[0] ?? FALLBACK_INTERIOR;
    const meshes: Mesh[] = [];
    const hulls: LineSegments[] = [];
    const center = new Vector3();
    for (const chunk of result.chunks) center.add(new Vector3(...chunk.pivot).multiplyScalar(chunk.volume));
    center.multiplyScalar(1 / Math.max(result.sourceVolume, 1e-12));
    for (const chunk of result.chunks) {
      const mesh = new Mesh(fractureChunkGeometry(chunk), [exterior, this.interior ?? exterior]);
      mesh.name = `fracture-${chunk.id}`;
      mesh.userData.fracturePivot = new Vector3(...chunk.pivot);
      mesh.userData.baseMaterials = mesh.material;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.host.previewGroup.add(mesh);
      meshes.push(mesh);
      if (chunk.hull.length >= 4) {
        const hullGeometry = new ConvexGeometry(chunk.hull.map((point) => new Vector3(...point)));
        const edges = new EdgesGeometry(hullGeometry, 20);
        hullGeometry.dispose();
        const wire = new LineSegments(edges, HULL_MATERIAL);
        wire.renderOrder = 10;
        mesh.add(wire);
        hulls.push(wire);
      }
    }
    // Record which mesh this preview came from; a later mesh edit then reads as stale.
    if (def.sourceHash !== hash) this.patch({ sourceHash: hash });
    this.bake = {
      result, hash, closed: check.closed, convex: check.convex,
      materialCount: source.materials.length,
      totalMass: result.chunks.reduce((sum, chunk) => sum + chunk.mass, 0),
      milliseconds, center, meshes, hulls,
    };
    // New chunk indices: an earlier Simulate Hit points at chunks that no longer exist.
    this.sim = null;
    this.setExplode(this.explode);
    this.applyVisibility();
    this.refreshSupportPreview();
    this.refreshWarnings();
    this.host.setStatus(`Fracture: ${result.chunks.length} parça bake edildi (${milliseconds.toFixed(1)} ms).`);
    this.host.rerender();
  }

  dispose(): void {
    this.clearPreview();
    for (const child of [...this.host.supportGroup.children]) {
      child.removeFromParent();
      (child as Box3Helper).geometry.dispose();
      ((child as Box3Helper).material as Material).dispose();
    }
    this.host.setModelVisible(true);
  }

  private patch(values: Partial<AssetFractureDef>): void {
    if (!this.def) return;
    // Through the normalizer, so the editor never holds a value the save would change.
    this.def = normalizeAssetFracture({ ...this.def, ...values }) ?? this.def;
    this.changed();
  }

  private patchSupport(values: Partial<FractureSupportDef>): void {
    if (!this.def) return;
    // The anchors or the radius changed: an earlier Simulate Hit no longer says what the asset does.
    this.sim = null;
    this.def = normalizeAssetFracture({ ...this.def, support: { ...this.def.support, ...values } }) ?? this.def;
    // Preview first, so the re-rendered section counts the new anchors.
    this.setExplode(this.explode);
    this.refreshSupportPreview();
    this.changed();
  }

  private addAnchor(box: { readonly min: FractureVec3; readonly max: FractureVec3 }): void {
    const anchors = this.def?.support.anchors ?? [];
    if (anchors.length >= FRACTURE_MAX_ANCHORS) return;
    const rounded = (point: FractureVec3): [number, number, number] => [round(point[0]), round(point[1]), round(point[2])];
    this.patchSupport({ anchors: [...anchors, { min: rounded(box.min), max: rounded(box.max) }] });
  }

  /** Model-space bounds of the source mesh (the space anchors and chunk pivots live in). */
  private modelBounds(): { min: FractureVec3; max: FractureVec3 } | null {
    const root = this.host.modelRoot();
    if (!root) return null;
    const mesh = fractureSourceFromObject(root).mesh;
    return mesh.positions.length ? meshBounds(mesh) : null;
  }

  /** One Simulate Hit at a model-space point: the runtime's anchored-break rule over box anchors. */
  private hitAt(point: FractureVec3): void {
    const def = this.def;
    const bake = this.bake;
    if (!def || !bake) return;
    const chunks = bake.result.chunks;
    const sim = this.sim ??= { present: chunks.map(() => true), inRadius: new Set(), collapsed: new Set(), hits: 0 };
    if (!sim.present.some(Boolean)) {
      this.host.setStatus("Simulate Hit: ayakta parça kalmadı; Reset Hits ile geri getir.", "warning");
      return;
    }
    const support = def.support;
    const impulse = this.hitImpulse ?? def.breakImpulse;
    const radius = damageRadius(support.damageRadius, support.damageRadiusPerImpulse, impulse, support.damageRadiusMax);
    const { inRadius, collapsed } = releaseSupportHit(
      chunks.map((chunk) => chunk.pivot), bake.result.links, this.anchored, sim.present, point, radius);
    for (const index of inRadius) sim.inRadius.add(index);
    for (const index of collapsed) sim.collapsed.add(index);
    sim.hits += 1;
    this.setExplode(this.explode);
    this.refreshSupportPreview();
    this.host.setStatus(`Simulate Hit: yarıçap ${radius.toFixed(2)} m · ${inRadius.length} koptu · ${collapsed.length} desteksiz düştü.`);
    this.host.rerender();
  }

  /** Re-derives the anchored chunks and redraws tints, anchor boxes and links. */
  private refreshSupportPreview(): void {
    const support = this.def?.support;
    const anchored = support?.mode === "anchored";
    const chunks = this.bake?.result.chunks ?? [];
    this.anchored = anchored && support ? anchoredChunks(chunks, support.anchors) : chunks.map(() => false);
    const sim = this.sim;
    this.bake?.meshes.forEach((mesh, index) => {
      const base = mesh.userData.baseMaterials as Material[];
      mesh.material = sim?.inRadius.has(index) ? RELEASED_MATERIAL
        : sim?.collapsed.has(index) ? COLLAPSED_MATERIAL
          : this.showSupport && this.anchored[index] ? ANCHORED_MATERIAL
            : base;
    });
    const group = this.host.supportGroup;
    for (const child of [...group.children]) {
      child.removeFromParent();
      (child as Box3Helper).geometry.dispose();
      ((child as Box3Helper).material as Material).dispose();
    }
    if (anchored && support && this.showSupport) {
      for (const box of support.anchors) {
        const helper = new Box3Helper(new Box3(new Vector3(...box.min), new Vector3(...box.max)), ANCHOR_BOX_COLOR);
        (helper.material as LineBasicMaterial).depthTest = false;
        helper.renderOrder = 11;
        group.add(helper);
      }
    }
    this.updateLinks();
  }

  /** Neighbour graph wires between the standing chunks' (exploded) pivots. */
  private updateLinks(): void {
    if (this.links) {
      this.links.removeFromParent();
      this.links.geometry.dispose();
      this.links = null;
    }
    const bake = this.bake;
    if (!bake || !this.showLinks || this.def?.support.mode !== "anchored") return;
    const present = this.sim?.present;
    const points: number[] = [];
    for (const { a, b } of bake.result.links) {
      if (present && (!present[a] || !present[b])) continue;
      points.push(...bake.meshes[a]!.position.toArray(), ...bake.meshes[b]!.position.toArray());
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
    this.links = new LineSegments(geometry, LINK_MATERIAL);
    this.links.renderOrder = 12;
    this.host.previewGroup.add(this.links);
  }

  private changed(): void {
    this.refreshWarnings();
    this.host.markDirty();
    this.host.rerender();
  }

  private refreshWarnings(): void {
    const def = this.def;
    const bake = this.bake;
    if (!def) {
      this.warnings = [];
      return;
    }
    this.warnings = fractureWarnings({
      def,
      // Before the model loads there is nothing to compare: assume it matches.
      currentHash: bake?.hash ?? this.currentHash() ?? def.sourceHash ?? "",
      closed: bake?.closed ?? true,
      convex: bake?.convex ?? true,
      materialCount: bake?.materialCount ?? 1,
      totalMass: bake?.totalMass ?? 0,
      step: DEFAULT_PHYSICS_FIXED_STEP,
    });
  }

  private currentHash(): string | null {
    const root = this.host.modelRoot();
    return root ? fractureSourceHash(fractureSourceFromObject(root).mesh) : null;
  }

  private setExplode(value: number): void {
    this.explode = Math.min(1, Math.max(0, value));
    const bake = this.bake;
    if (!bake) return;
    // Push each chunk out along centre → pivot, scaled by the model's size.
    const size = new Box3().setFromObject(this.host.modelRoot() ?? this.host.previewGroup).getSize(new Vector3()).length();
    for (const mesh of bake.meshes) {
      const pivot = mesh.userData.fracturePivot as Vector3;
      const away = pivot.clone().sub(bake.center);
      const length = away.length();
      if (length > 1e-9) away.multiplyScalar((this.explode * size * 0.5) / length);
      mesh.position.copy(pivot).add(length > 1e-9 ? away : new Vector3());
    }
    // Simulate Hit: chunks that fell sink below the standing ones so the gap reads at a glance.
    const sim = this.sim;
    bake.meshes.forEach((mesh, index) => {
      if (sim && !sim.present[index]) mesh.position.y -= size * 0.15;
    });
    this.updateLinks();
  }

  private applyVisibility(): void {
    const preview = this.bake !== null && this.showChunks;
    this.host.previewGroup.visible = preview;
    this.host.setModelVisible(!preview);
    for (const wire of this.bake?.hulls ?? []) wire.visible = this.showHulls;
  }

  private async refreshInterior(): Promise<void> {
    const id = this.def?.interiorMaterialId ?? null;
    this.interior = id ? (await this.host.loadMaterial(id)) ?? FALLBACK_INTERIOR : null;
  }

  private applyInterior(): void {
    for (const mesh of this.bake?.meshes ?? []) {
      const materials = mesh.userData.baseMaterials as Material[];
      mesh.userData.baseMaterials = [materials[0]!, this.interior ?? materials[0]!];
    }
    this.refreshSupportPreview();
  }

  private clearPreview(): void {
    this.links?.removeFromParent();
    this.links?.geometry.dispose();
    this.links = null;
    for (const mesh of this.bake?.meshes ?? []) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      for (const wire of mesh.children) (wire as LineSegments).geometry?.dispose();
    }
    this.bake = null;
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
