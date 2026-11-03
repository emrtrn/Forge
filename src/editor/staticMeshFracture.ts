import {
  Box3,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";

import { DEFAULT_PHYSICS_FIXED_STEP } from "@engine/physics/fixedStep";
import { bakeFracture, type FractureBakeResult } from "@engine/physics/fracture/fractureBake";
import {
  FRACTURE_LIMITS,
  createAssetFracture,
  fractureSourceHash,
  fractureWarnings,
  normalizeAssetFracture,
  type AssetFractureDef,
  type FractureWarning,
} from "@engine/physics/fracture/fractureTypes";
import { checkFractureSource, polyhedronFromMesh, polyhedronVolume } from "@engine/physics/fracture/voronoiFracture";
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
  /** Hide the intact model while the chunks are shown. */
  setModelVisible(visible: boolean): void;
  /** Manifest material assets for the interior material picker. */
  materialAssets(): readonly { id: string; name: string }[];
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

type NumberKey = "cellCount" | "seed" | "density" | "interiorUvScale" | "breakImpulse" | "chunkLifetime" | "maxActiveChunks";

const NUMBER_FIELDS: readonly { key: NumberKey; label: string; step: number; title: string; sliderMax?: number }[] = [
  { key: "cellCount", label: "Cell Count", step: 1, title: "Kaç parçaya bölüneceği" },
  { key: "seed", label: "Seed", step: 1, title: "Aynı seed aynı parçaları üretir", sliderMax: 9999 },
  { key: "density", label: "Density (kg/m³)", step: 10, title: "Parça kütlesi = hacim × yoğunluk (ahşap ≈ 600, beton ≈ 2400)", sliderMax: 8000 },
  { key: "breakImpulse", label: "Break Impulse (N·s)", step: 10, title: "Bu impulse'u aşan çarpma nesneyi kırar", sliderMax: 5000 },
  { key: "chunkLifetime", label: "Chunk Lifetime (s)", step: 1, title: "Parçaların sahnede kalma süresi; 0 kalıcı" },
  { key: "maxActiveChunks", label: "Max Active Chunks", step: 1, title: "Bu nesneden aynı anda yaşayan en fazla parça", sliderMax: 64 },
  { key: "interiorUvScale", label: "Interior UV Scale (m)", step: 0.05, title: "Kesik yüz dokusunun bir tekrarı kaç metre", sliderMax: 10 },
];

const HULL_MATERIAL = new LineBasicMaterial({ color: 0x5fd4ff, transparent: true, opacity: 0.8, depthTest: false });
const FALLBACK_INTERIOR = new MeshStandardMaterial({ color: 0x8a7158, roughness: 0.95 });

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

  constructor(private readonly host: StaticMeshFractureHost) {}

  async load(): Promise<void> {
    this.def = await loadAssetFracture(this.host.modelPath);
    this.saved = JSON.stringify(this.def);
    await this.refreshInterior();
    this.refreshWarnings();
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
    const numberRows = NUMBER_FIELDS.map(({ key, label, step, title, sliderMax }) => {
      const [min, max] = FRACTURE_LIMITS[key];
      return `
        <label class="sm-row" title="${title}">
          <span>${label}</span>
          <input type="number" data-sm-fracture-num="${key}" min="${min}" max="${max}" step="${step}"
            ${sliderMax !== undefined ? `data-slider-max="${sliderMax}"` : ""} value="${def[key]}" />
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
        if (key === "cellCount" || key === "seed" || key === "interiorUvScale") this.bakeNow();
        else if (key === "density" && this.bake) this.bakeNow();
      });
    });
    root.querySelector<HTMLInputElement>("[data-sm-fracture-damage]")?.addEventListener("change", (event) => {
      const raw = (event.currentTarget as HTMLInputElement).value.trim();
      const value = Number(raw);
      this.patch({ damageToBreak: raw === "" || !Number.isFinite(value) ? null : value });
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
    this.setExplode(this.explode);
    this.applyVisibility();
    this.refreshWarnings();
    this.host.setStatus(`Fracture: ${result.chunks.length} parça bake edildi (${milliseconds.toFixed(1)} ms).`);
    this.host.rerender();
  }

  dispose(): void {
    this.clearPreview();
    this.host.setModelVisible(true);
  }

  private patch(values: Partial<AssetFractureDef>): void {
    if (!this.def) return;
    // Through the normalizer, so the editor never holds a value the save would change.
    this.def = normalizeAssetFracture({ ...this.def, ...values }) ?? this.def;
    this.changed();
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
      const materials = mesh.material as Material[];
      mesh.material = [materials[0]!, this.interior ?? materials[0]!];
    }
  }

  private clearPreview(): void {
    for (const mesh of this.bake?.meshes ?? []) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      for (const wire of mesh.children) (wire as LineSegments).geometry?.dispose();
    }
    this.bake = null;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
