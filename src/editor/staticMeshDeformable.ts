import { Vector3, type BufferGeometry, type Group, type Mesh, type Object3D, type Raycaster } from "three";

import {
  DEFORMABLE_LIMITS,
  createAssetDeformable,
  normalizeAssetDeformable,
  type AssetDeformableDef,
} from "@engine/physics/deformable/deformableTypes";
import { dentDepthForImpulse } from "@engine/physics/deformable/impactDeform";
import { DentTarget } from "@engine/render-three/deformableMeshSync";
import { loadAssetDeformable, saveAssetDeformable } from "@/editor/assetDeformableStore";

/**
 * The Static Mesh Editor's "Deformable" section (DEFORMABLE_FRACTURABLE_WORK_PLAN
 * Faz 7): edits the asset's `<Model>.deformable.json` and tries it with Test Hit.
 *
 * A test hit lands on a copy of the model shown in its place, never on the model
 * itself: the fracture bake, its source hash and hull generation all read the
 * loaded model, and a forgotten preview must not leak into any of them. The
 * dent code is the runtime's, and nothing of a test hit is saved.
 */

export interface StaticMeshDeformableHost {
  readonly modelPath: string;
  /** The loaded model root (`gltf.scene`), or null while it loads. */
  modelRoot(): Object3D | null;
  /** Holds the dented copy; the host keeps it in the scene. */
  readonly previewGroup: Group;
  modelVisible(): boolean;
  setModelVisible(visible: boolean): void;
  markDirty(): void;
  setStatus(message: string, tone?: "info" | "warning" | "error"): void;
  rerender(): void;
}

type NumberKey = "dentImpulse" | "fullImpulse" | "radius" | "maxDepth" | "plasticity" | "maxDents";

const NUMBER_FIELDS: readonly { key: NumberKey; label: string; step: number; title: string; sliderMax?: number }[] = [
  { key: "dentImpulse", label: "Dent Impulse (N·s)", step: 10, title: "Bundan zayıf çarpma iz bırakmaz", sliderMax: 20000 },
  { key: "fullImpulse", label: "Full Impulse (N·s)", step: 10, title: "Bu impulse'ta darbe tam derinliğe ulaşır", sliderMax: 50000 },
  { key: "radius", label: "Radius (m)", step: 0.01, title: "Bir göçüğün yarıçapı, dünya metresi", sliderMax: 3 },
  { key: "maxDepth", label: "Max Depth (m)", step: 0.01, title: "Bir vertex'in durduğu yerden en çok ne kadar uzaklaşabileceği", sliderMax: 0.5 },
  { key: "plasticity", label: "Plasticity", step: 0.05, title: "Tek tam darbenin Max Depth'in ne kadarını kullandığı; düşükse aynı yer birkaç darbeyle derinleşir" },
  { key: "maxDents", label: "Max Dents", step: 1, title: "Bir nesnenin tuttuğu en çok göçük; dolunca yeni bir noktaya vuruş iz bırakmaz" },
];

/** Vertices one dent should move to read as a curve rather than a single spike. */
const SPARSE_MOVED_VERTICES = 8;
/** Triangles looked at per mesh to estimate its edge length. */
const EDGE_SAMPLE_TRIANGLES = 2000;

/** Mean triangle edge of a model, metres at scale 1; 0 when it has no triangles. */
function meanEdgeLength(root: Object3D): number {
  root.updateWorldMatrix(true, true);
  const a = new Vector3();
  const b = new Vector3();
  let total = 0;
  let count = 0;
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const geometry: BufferGeometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    const triangles = Math.floor((index ? index.count : position.count) / 3);
    const stride = Math.max(1, Math.floor(triangles / EDGE_SAMPLE_TRIANGLES));
    for (let triangle = 0; triangle < triangles; triangle += stride) {
      const first = index ? index.getX(triangle * 3) : triangle * 3;
      const second = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
      a.fromBufferAttribute(position, first).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, second).applyMatrix4(mesh.matrixWorld);
      total += a.distanceTo(b);
      count += 1;
    }
  });
  return count > 0 ? total / count : 0;
}

export class StaticMeshDeformable {
  private def: AssetDeformableDef | null = null;
  private saved = "null";
  /** Test Hit impulse; null follows the asset's Full Impulse. */
  private hitImpulse: number | null = null;
  /** Test Hit armed: the next viewport click on the model hits there. */
  private hitArmed = false;
  private preview: Object3D | null = null;
  private target: DentTarget | null = null;
  /** Mean edge of the model, once it has loaded. */
  private edgeLength = 0;
  private stats = "";

  constructor(private readonly host: StaticMeshDeformableHost) {}

  async load(): Promise<void> {
    this.def = await loadAssetDeformable(this.host.modelPath);
    this.saved = JSON.stringify(this.def);
  }

  /** The model arrived: the density hint can read it. */
  modelLoaded(): void {
    const root = this.host.modelRoot();
    this.edgeLength = root ? meanEdgeLength(root) : 0;
  }

  /** True while Test Hit waits for a viewport click; the editor then routes clicks to {@link pickHit}. */
  get wantsViewportHit(): boolean {
    return this.hitArmed && this.def !== null;
  }

  get dirty(): boolean {
    return JSON.stringify(this.def) !== this.saved;
  }

  /** Writes the sidecar when it changed; a never-added deformable writes nothing. */
  async save(): Promise<{ path: string; changed: boolean; dropped: string[] } | null> {
    if (!this.def || !this.dirty) return null;
    const result = await saveAssetDeformable(this.host.modelPath, this.def);
    this.saved = JSON.stringify(this.def);
    return result;
  }

  /** Dents the preview under the ray; false when the ray misses the model. */
  pickHit(raycaster: Raycaster): boolean {
    const def = this.def;
    const root = this.host.modelRoot();
    if (!def || !root || (!this.preview && !this.host.modelVisible())) return false;
    const hit = raycaster.intersectObject(this.preview ?? root, true)[0];
    if (!hit?.face) return false;
    const preview = this.ensurePreview(root);
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const impulse = this.hitImpulse ?? def.fullImpulse;
    const depth = dentDepthForImpulse(def, impulse);
    const target = this.target ?? new DentTarget(preview, { parts: def.parts });
    this.target = target;
    const outcome = target.hit([hit.point.x, hit.point.y, hit.point.z], [-normal.x, -normal.y, -normal.z], depth, def);
    if (outcome === "dented") {
      const sparse = target.lastMoved < SPARSE_MOVED_VERTICES;
      this.stats = `${target.dentList.length} göçük, son darbe ${target.lastMoved} vertex`;
      this.host.setStatus(
        sparse ? "Mesh bu yarıçap için seyrek: göçük köşeli görünür." : "Test darbesi uygulandı (kaydedilmez).",
        sparse ? "warning" : "info",
      );
    } else {
      this.host.setStatus(depth > 0 ? "Darbe iz bırakmadı: liste dolu ya da derinlik sınırda." : "Impulse, Dent Impulse'un altında.", "warning");
    }
    this.host.rerender();
    return true;
  }

  dispose(): void {
    this.resetPreview();
  }

  html(): string {
    const def = this.def;
    if (!def) {
      return `
      <div class="sm-section" data-sm-deformable>
        <div class="sm-section-title">Deformable</div>
        <div class="sm-hint">Bu asset göçmez. Deformable eklemek, modelin yanına parametre dosyası (.deformable.json) yazar; göçükler oyunda oluşur ve yalnız save'e girer.</div>
        <div class="sm-prim-list"><button type="button" data-sm-deformable-add>Add Deformable</button></div>
      </div>`;
    }
    const rows = NUMBER_FIELDS.map(({ key, label, step, title, sliderMax }) => {
      const [min, max] = DEFORMABLE_LIMITS[key];
      return `
        <label class="sm-row" title="${title}">
          <span>${label}</span>
          <input type="number" data-sm-deformable-num="${key}" min="${min}" max="${max}" step="${step}"
            ${sliderMax !== undefined ? `data-slider-max="${sliderMax}"` : ""} value="${def[key]}" />
        </label>`;
    }).join("");
    const sparse = this.edgeLength > 0 && this.edgeLength > def.radius / 2;
    return `
      <div class="sm-section" data-sm-deformable>
        <div class="sm-section-title">Deformable</div>
        <label class="sm-row sm-toggle" title="Kapalıyken dosya kalır ama asset göçmez">
          <input type="checkbox" data-sm-deformable-enabled ${def.enabled ? "checked" : ""} />
          <span>Enabled</span>
        </label>
        ${rows}
        ${sparse ? `<div class="sm-hint" data-sm-deformable-sparse>Mesh bu yarıçap için seyrek görünüyor (ortalama kenar ${this.edgeLength.toFixed(2)} m): göçük köşeli çıkar. Yarıçapı büyüt ya da modeli böl.</div>` : ""}
        <div class="sm-hint">Çarpışma şekli değişmez (Visual Only). Ölçek 1 ile önizlenir; placement ölçeğinde yarıçap yine dünya metresidir.</div>
        <label class="sm-row" title="Test darbesinin impulse'u (yalnız önizleme); boş = Full Impulse">
          <span>Hit Impulse (N·s)</span>
          <input type="number" data-sm-deformable-hit-impulse min="0" max="${DEFORMABLE_LIMITS.fullImpulse[1]}" step="10"
            data-slider-max="50000" value="${this.hitImpulse ?? ""}" placeholder="${def.fullImpulse}" />
        </label>
        <div class="sm-prim-list">
          <button type="button" data-sm-deformable-hit class="${this.hitArmed ? "is-active" : ""}" title="Sonra modele tıkla: tıklanan yere runtime'ın kodu ile darbe uygulanır, kaydedilmez">Test Hit</button>
          <button type="button" data-sm-deformable-reset ${this.target ? "" : "disabled"}>Reset</button>
        </div>
        ${this.stats ? `<div class="sm-hint" data-sm-deformable-stats>${this.stats}</div>` : ""}
      </div>`;
  }

  bind(root: HTMLElement): void {
    root.querySelector<HTMLButtonElement>("[data-sm-deformable-add]")?.addEventListener("click", () => {
      this.def = createAssetDeformable();
      this.changed();
    });
    root.querySelector<HTMLInputElement>("[data-sm-deformable-enabled]")?.addEventListener("change", (event) => {
      this.patch({ enabled: (event.currentTarget as HTMLInputElement).checked });
    });
    root.querySelectorAll<HTMLInputElement>("[data-sm-deformable-num]").forEach((input) => {
      input.addEventListener("change", () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        this.patch({ [input.dataset.smDeformableNum as NumberKey]: value });
      });
    });
    root.querySelector<HTMLInputElement>("[data-sm-deformable-hit-impulse]")?.addEventListener("change", (event) => {
      const raw = (event.currentTarget as HTMLInputElement).value.trim();
      const value = Number(raw);
      this.hitImpulse = raw === "" || !Number.isFinite(value) ? null : Math.max(0, value);
    });
    root.querySelector<HTMLButtonElement>("[data-sm-deformable-hit]")?.addEventListener("click", () => {
      this.hitArmed = !this.hitArmed;
      this.host.rerender();
    });
    root.querySelector<HTMLButtonElement>("[data-sm-deformable-reset]")?.addEventListener("click", () => {
      this.resetPreview();
      this.host.rerender();
    });
  }

  private patch(patch: Partial<AssetDeformableDef>): void {
    this.def = normalizeAssetDeformable({ ...this.def, ...patch });
    // Dents on screen were made with the old values.
    this.resetPreview();
    this.changed();
  }

  private changed(): void {
    this.host.markDirty();
    this.host.rerender();
  }

  private ensurePreview(root: Object3D): Object3D {
    if (this.preview) return this.preview;
    root.updateWorldMatrix(true, false);
    const group = this.host.previewGroup;
    group.matrixAutoUpdate = false;
    if (root.parent) group.matrix.copy(root.parent.matrixWorld);
    group.matrixWorldNeedsUpdate = true;
    this.preview = root.clone(true);
    group.add(this.preview);
    group.updateWorldMatrix(true, true);
    this.host.setModelVisible(false);
    return this.preview;
  }

  private resetPreview(): void {
    this.target?.dispose();
    this.target = null;
    this.stats = "";
    if (!this.preview) return;
    this.preview.removeFromParent();
    this.preview = null;
    this.host.setModelVisible(true);
  }
}
