/**
 * World Builder window (RANDOM_WORLD_PLAN step 5): a few choices, a bird's-eye
 * preview that follows them, and Create, which builds the world into the level
 * the window was opened in (on the dev server, `/__world-random`) and reloads
 * it. The world replaces everything in that level, so Create asks first.
 *
 * The preview runs the builder's own generator in a worker
 * (`engine/worldbuilder/workers/randomWorldPreviewWorker.ts`), so mountains,
 * settlements and water sit where the built level will have them; roads are
 * drawn as straight lines. The choices are a per-viewer
 * convenience kept in browser storage, never in project data.
 */
import {
  COVERS,
  LANDFORMS,
  MOUNTAIN_HEIGHTS,
  ROAD_NETWORKS,
  SETTLEMENT_TYPES,
  WORLD_SIZES,
  worldExtent,
  type CoverName,
  type RandomWorldOptions,
  type SettlementType,
} from "@engine/worldbuilder/randomWorld";
import { MAX_RANDOM_WATER } from "@engine/worldbuilder/randomWater";
import { SEA_SIDES, type SeaSide } from "@engine/worldbuilder/island";
import type { RandomWorldPreview } from "@engine/worldbuilder/randomWorldPreview";
import type { RandomWorldPreviewRequest, RandomWorldPreviewResponse } from "@engine/worldbuilder/workers/randomWorldPreviewWorker";
import { COVER_DENSITY_LEVELS, WORLD_BUILD_STEPS, type CoverDensityLevel } from "@engine/worldbuilder/worldBrief";
import { PerspectiveCamera } from "three";
import { storeEditorCameraPose, type EditorCameraPose } from "@editor/input/editorCameraPose";
import { projectFileUrl } from "@/project/ProjectSystem";
import type { ForgeWindow } from "./worldBuilderWindow";

/** Most settlements a world may ask for (the endpoint's limit too). */
export const MAX_WINDOW_SETTLEMENTS = 8;
const STORAGE_KEY = "forge.worldBuilder.random";
/** Preview canvas side, CSS pixels. */
const PREVIEW_SIZE = 320;
/** Wait this long after the last change before drawing a new preview, ms. */
const PREVIEW_DELAY = 120;

type Density = "forest" | "rocks" | "fields";

export interface RandomWorldChoices {
  seed: number;
  size: keyof typeof WORLD_SIZES;
  landform: (typeof LANDFORMS)[number];
  seaSide: SeaSide;
  mountainHeight: (typeof MOUNTAIN_HEIGHTS)[number];
  settlements: SettlementType[];
  roads: (typeof ROAD_NETWORKS)[number];
  rivers: number;
  lakes: number;
  cover: CoverName;
  densities: Record<Density, CoverDensityLevel>;
}

interface StoredState {
  choices: RandomWorldChoices;
}

export interface RandomWorldPanelOptions {
  frame: ForgeWindow;
  /** The open level (public-root-relative); the world is built into it. Null before a level loads. */
  levelPath: () => string | null;
  /** True when the open level has edits the rebuild would discard. */
  hasUnsavedChanges: () => boolean;
  /** Makes `path` the open level and reloads the editor. */
  openLevel: (path: string) => Promise<void>;
  confirm?: (message: string) => boolean;
}

/** Farthest the opening view looks at the ground from, metres: the editor camera draws to 2000 m (`SCENE_CAMERA_FAR`). */
const OVERVIEW_REACH = 1500;
/** How far the opening view looks down, degrees. */
const OVERVIEW_PITCH = 52;

/**
 * A bird's-eye view of a built world from the south (north up, as in the
 * preview), for the editor to open the new level with: aimed a little north of
 * the middle and close enough that the ground stays inside the camera's reach,
 * so a small world shows whole and a large one its middle.
 */
export function overviewCameraPose(extent: number, groundHeight = 0): EditorCameraPose {
  const camera = new PerspectiveCamera();
  const reach = Math.min(0.8 * extent, OVERVIEW_REACH);
  const pitch = (OVERVIEW_PITCH * Math.PI) / 180;
  const target: [number, number, number] = [0, groundHeight, -0.1 * extent];
  camera.position.set(target[0], target[1] + reach * Math.sin(pitch), target[2] + reach * Math.cos(pitch));
  camera.lookAt(...target);
  camera.updateMatrixWorld();
  const { x, y, z, w } = camera.quaternion;
  return { position: [camera.position.x, camera.position.y, camera.position.z], quaternion: [x, y, z, w], up: [0, 1, 0] };
}

function newSeed(): number {
  return Math.floor(Math.random() * 100000);
}

export function defaultRandomWorldChoices(seed = newSeed()): RandomWorldChoices {
  return {
    seed,
    size: "medium",
    landform: "hills",
    seaSide: "west",
    mountainHeight: "medium",
    settlements: ["village", "hamlet"],
    roads: "exits",
    rivers: 1,
    lakes: 0,
    cover: "forest",
    densities: { forest: "medium", rocks: "medium", fields: "medium" },
  };
}

/** Stored choices, each field checked; anything unusable falls back to the default. */
function readStored(): StoredState {
  const fallback: StoredState = { choices: defaultRandomWorldChoices() };
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return fallback;
  }
  if (!raw || typeof raw !== "object") return fallback;
  const stored = raw as Partial<StoredState>;
  const choices = { ...fallback.choices };
  const given = (stored.choices ?? {}) as Partial<RandomWorldChoices>;
  const pick = <T extends string>(value: unknown, allowed: readonly T[], current: T): T => (allowed.includes(value as T) ? (value as T) : current);
  choices.size = pick(given.size, Object.keys(WORLD_SIZES) as RandomWorldChoices["size"][], choices.size);
  choices.landform = pick(given.landform, LANDFORMS, choices.landform);
  choices.seaSide = pick(given.seaSide, SEA_SIDES, choices.seaSide);
  choices.mountainHeight = pick(given.mountainHeight, MOUNTAIN_HEIGHTS, choices.mountainHeight);
  choices.roads = pick(given.roads, ROAD_NETWORKS, choices.roads);
  choices.cover = pick(given.cover, Object.keys(COVERS) as CoverName[], choices.cover);
  for (const key of ["rivers", "lakes"] as const) {
    const value = given[key];
    if (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_RANDOM_WATER) choices[key] = value as number;
  }
  if (Number.isInteger(given.seed) && (given.seed as number) >= 0 && (given.seed as number) <= 0xffffffff) choices.seed = given.seed as number;
  if (Array.isArray(given.settlements)) {
    const list = given.settlements.filter((type): type is SettlementType => type in SETTLEMENT_TYPES).slice(0, MAX_WINDOW_SETTLEMENTS);
    if (list.length) choices.settlements = list;
  }
  for (const key of ["forest", "rocks", "fields"] as const) {
    choices.densities[key] = pick(given.densities?.[key], COVER_DENSITY_LEVELS, choices.densities[key]);
  }
  if (choices.landform === "island") { choices.size = "small"; choices.roads = "between"; choices.rivers = 0; }
  if (choices.landform === "coast") choices.size = "small";
  return { choices };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

const LABELS = {
  size: { small: "Small", medium: "Medium", large: "Large" },
  landform: { plain: "Plain", hills: "Hills", mountains: "Mountains", valley: "Valley", island: "Island", coast: "Coast" },
  seaSide: { west: "West", east: "East", north: "North", south: "South" },
  mountainHeight: { low: "Low", medium: "Medium", high: "High" },
  roads: { between: "Between", exits: "Exits" },
  density: { low: "Low", medium: "Medium", high: "High" },
  settlement: { hamlet: "Hamlet", village: "Village", town: "Town" },
  cover: { forest: "Forest", meadow: "Meadow", farmland: "Farmland", steppe: "Steppe", desert: "Desert", alpine: "Alpine" },
} as const;

const TIPS = {
  size: "Dünyanın kenar uzunluğu: Small 1 km, Medium 2 km, Large 4 km (Large'da World Partition açılır).",
  landform: "Arazinin genel şekli. Plain: düze yakın; Hills: tepeler; Mountains: sırtlı dağlar; Valley: haritayı kuzeyden güneye geçen vadi; Island: Ocean ile çevrili küçük ada.",
  mountainHeight: "Dağların ve tepelerin yüksekliği; küçük dünyada kendiliğinden alçalır.",
  settlements: "Yerleşimler ve türleri. Hamlet: mezra (~40 kişi), Village: köy (~180), Town: kasaba (~600). Yer kalmazsa yerleşim çıkarılır.",
  roads: "Between: yollar yalnız yerleşimleri bağlar. Exits: ayrıca iki yol harita kenarına çıkar.",
  rivers: "Nehir sayısı. Nehirler yüksekten başlar, yokuş aşağı akar; yol nehri köprüyle geçer.",
  lakes: "Göl sayısı. Göller önce çanaklara, yoksa nehrin aşağı kısmına konur.",
  cover: "Örtü / iklim: boya katmanları, orman, tarla ve kar kuralları.",
  forest: "Ormanın yoğunluğu ve köylere ne kadar yaklaştığı.",
  rocks: "Kaya sayısı.",
  fields: "Köy çevresindeki tarlaların ne kadar uzağa uzandığı (tarla olan örtülerde).",
  seed: "Aynı seçimler ve aynı tohum aynı dünyayı verir. Roll Dice başka bir dünya seçer.",
} as const;

/** What the window says while each build step runs. */
export const BUILD_STEP_LABELS: Record<(typeof WORLD_BUILD_STEPS)[number], string> = {
  terrain: "Arazi şekilleniyor…",
  paint: "Arazi boyanıyor…",
  settlements: "Yollar, yerleşimler ve yapılar planlanıyor…",
  roads: "Yollar ve yapı setleri araziye işleniyor…",
  ground: "Donatılar ve çitler yerleştiriliyor…",
  placements: "Kayalar, bitkiler ve su yerleştiriliyor…",
  files: "Dosyalar yazılıyor…",
};

/**
 * Why the world cannot be built into `path` (the open level), or null when it
 * can: generated levels live under `public/assets` with plain folder and file
 * names (the endpoint's rule, `validateRandomWorldLevelPath`).
 */
export function randomWorldTargetProblem(path: string | null): string | null {
  if (!path) return "Açık level yok.";
  const parts = path.replace(/\\/g, "/").split("/");
  if (parts[0] !== "assets" || parts.length < 2 || !/\.level\.json$/i.test(path)) {
    return "Bu level public/assets altında değil; World Builder yalnız assets altındaki level'lara kurar. Content Browser'da assets altında yeni bir level oluşturup onu açın.";
  }
  if (parts.some((part) => !/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(part) || part.endsWith(".") || part.endsWith(" "))) {
    return "Level'ın klasör ya da dosya adında kullanılamayan bir karakter var (yalnız harf, rakam, boşluk, _ . -). Level'ı yeniden adlandırın.";
  }
  return null;
}

function segmented<T extends string>(name: string, values: readonly T[], labels: Record<T, string>): string {
  return `<div class="forge-segmented random-world-segmented" role="group" aria-label="${name}" data-choice="${name}">${values
    .map((value) => `<button type="button" data-value="${value}" aria-pressed="false">${labels[value]}</button>`)
    .join("")}</div>`;
}

function row(label: string, tip: string, control: string): string {
  return `<div class="detail-row"><span title="${escapeHtml(tip)}">${label}</span>${control}</div>`;
}

export class RandomWorldPanel {
  private state: StoredState = readStored();
  private worker: Worker | null = null;
  private previewId = 0;
  private previewTimer: number | null = null;
  private readonly covers = new Map<CoverName, Promise<unknown>>();
  private building = false;
  /** Middle of the last preview's ground heights, for the new level's first view. */
  private groundHeight = 0;
  private readonly root: HTMLElement;

  constructor(private readonly options: RandomWorldPanelOptions) {
    const body = options.frame.body;
    body.innerHTML = this.markup();
    this.root = body.querySelector<HTMLElement>("[data-testid='random-world-panel']")!;
    this.bind();
    this.syncControls();
  }

  /** Redraws the preview (the window was opened). */
  update(): void {
    this.syncControls();
    this.schedulePreview(0);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
  }

  get choices(): RandomWorldChoices {
    return structuredClone(this.state.choices);
  }

  private markup(): string {
    const densities = (["forest", "rocks", "fields"] as const)
      .map((key) => row(key[0]!.toUpperCase() + key.slice(1), TIPS[key], segmented(key, COVER_DENSITY_LEVELS, LABELS.density)))
      .join("");
    const count = (name: "rivers" | "lakes", label: string): string =>
      `<label class="detail-row"><span title="${escapeHtml(TIPS[name])}">${label}</span><input type="number" min="0" max="${MAX_RANDOM_WATER}" step="1" data-count="${name}" aria-label="${label}"></label>`;
    return `
      <div class="random-world" data-testid="random-world-panel">
        <div class="random-world-options">
          ${row("Size", TIPS.size, segmented("size", Object.keys(WORLD_SIZES) as RandomWorldChoices["size"][], LABELS.size))}
          ${row("Landform", TIPS.landform, segmented("landform", LANDFORMS, LABELS.landform))}
          <div class="random-world-hint" data-island-info hidden>Ada: Small (1 km), Ocean ve kıyı otomatik oluşturulur. Yollar ada içinde kalır. Nehir ağzı desteği sonraki aşamada; göl için yeterli iç alan aranır.</div>
          <div data-coast-options hidden>${row("Sea Side", "Denizin haritanın hangi tarafında olacağı. Yol çıkışları karada kalır.", segmented("seaSide", SEA_SIDES, LABELS.seaSide))}
            <div class="random-world-hint">Kıyı: Small (1 km). Denize ulaşan nehirler ortak su kotunda birleşir; yol çıkışları karadan seçilir.</div></div>
          ${row("Mountains", TIPS.mountainHeight, segmented("mountainHeight", MOUNTAIN_HEIGHTS, LABELS.mountainHeight))}
          ${row("Settlements", TIPS.settlements, `<div class="random-world-settlements">
              <div class="random-world-chips" data-settlement-list></div>
              <div class="random-world-add">${(Object.keys(SETTLEMENT_TYPES) as SettlementType[])
                .map((type) => `<button type="button" class="forge-btn-ghost" data-add-settlement="${type}">+ ${LABELS.settlement[type]}</button>`)
                .join("")}</div>
            </div>`)}
          ${row("Roads", TIPS.roads, segmented("roads", ROAD_NETWORKS, LABELS.roads))}
          ${count("rivers", "Rivers")}
          ${count("lakes", "Lakes")}
          <label class="detail-row"><span title="${escapeHtml(TIPS.cover)}">Cover</span><select data-cover aria-label="Cover">${(Object.keys(COVERS) as CoverName[])
            .map((cover) => `<option value="${cover}">${LABELS.cover[cover]}</option>`)
            .join("")}</select></label>
          ${densities}
          ${row("Seed", TIPS.seed, `<div class="random-world-seed">
              <input type="number" min="0" max="4294967295" step="1" data-seed aria-label="Seed" data-param-slider="off">
              <button type="button" class="forge-btn-ghost" data-roll title="Başka bir tohum seç">Roll Dice</button>
            </div>`)}
        </div>
        <div class="random-world-preview">
          <canvas data-preview-canvas data-testid="random-world-preview" aria-label="Preview" width="${PREVIEW_SIZE}" height="${PREVIEW_SIZE}"></canvas>
          <div class="random-world-summary" data-preview-summary data-testid="random-world-summary">Önizleme hazırlanıyor…</div>
          <div class="random-world-hint">Kuzey yukarıda. Yollar düz çizgiyle gösterilir; gerçek güzergâh kurulumda çizilir. Sokak, yapı ve ağaç önizlemede yok.</div>
          <ul class="random-world-notes" data-preview-notes hidden></ul>
          <div class="random-world-error" data-preview-error role="alert" hidden></div>
        </div>
        <div class="random-world-create">
          <div class="random-world-target">Dünya açık level'a kurulur ve içindeki her şeyin yerini alır:</div>
          <div class="random-world-actions">
            <span class="random-world-path" data-level-path data-testid="random-world-level"></span>
            <button type="button" class="forge-btn-primary" data-create data-testid="random-world-create">Create</button>
          </div>
          <div class="random-world-progress" data-progress data-testid="random-world-progress" hidden>
            <progress max="1" value="0"></progress>
            <span data-progress-label></span>
          </div>
          <div class="random-world-error" data-target-problem data-testid="random-world-target-problem" hidden></div>
          <div class="random-world-error" data-create-error data-testid="random-world-error" role="alert" hidden></div>
        </div>
      </div>`;
  }

  private element<T extends HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }

  private bind(): void {
    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const segment = target.closest<HTMLButtonElement>("[data-choice] > button");
      if (segment) {
        const name = segment.parentElement!.dataset.choice!;
        const value = segment.dataset.value!;
        if (name === "forest" || name === "rocks" || name === "fields") this.state.choices.densities[name] = value as CoverDensityLevel;
        else (this.state.choices as unknown as Record<string, string>)[name] = value;
        this.changed();
        return;
      }
      const add = target.closest<HTMLButtonElement>("[data-add-settlement]");
      if (add && this.state.choices.settlements.length < MAX_WINDOW_SETTLEMENTS) {
        this.state.choices.settlements.push(add.dataset.addSettlement as SettlementType);
        this.changed();
        return;
      }
      const remove = target.closest<HTMLButtonElement>("[data-remove-settlement]");
      if (remove && this.state.choices.settlements.length > 1) {
        this.state.choices.settlements.splice(Number(remove.dataset.removeSettlement), 1);
        this.changed();
        return;
      }
      if (target.closest("[data-roll]")) {
        let seed = newSeed();
        while (seed === this.state.choices.seed) seed = newSeed();
        this.state.choices.seed = seed;
        this.changed();
        return;
      }
      if (target.closest("[data-create]")) void this.create();
    });
    const onCount = (event: Event): void => {
      const input = event.target as HTMLInputElement;
      const name = input.dataset.count as "rivers" | "lakes" | undefined;
      if (!name) return;
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < 0 || value > MAX_RANDOM_WATER) return;
      if (this.state.choices[name] === value) return;
      this.state.choices[name] = value;
      this.changed(false);
    };
    this.root.addEventListener("input", onCount);
    this.root.addEventListener("change", onCount);
    this.element<HTMLSelectElement>("[data-cover]").addEventListener("change", (event) => {
      this.state.choices.cover = (event.target as HTMLSelectElement).value as CoverName;
      this.changed();
    });
    const seed = this.element<HTMLInputElement>("[data-seed]");
    seed.addEventListener("change", () => {
      const value = Number(seed.value);
      if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff) {
        this.state.choices.seed = value;
        this.changed();
      } else {
        seed.value = String(this.state.choices.seed);
      }
    });
  }

  /** A choice changed: store it, redraw the controls (unless an input is being typed in) and the preview. */
  private changed(redraw = true): void {
    if (this.state.choices.landform === "island") {
      this.state.choices.size = "small";
      this.state.choices.roads = "between";
      this.state.choices.rivers = 0;
    }
    if (this.state.choices.landform === "coast") this.state.choices.size = "small";
    this.store();
    if (redraw) this.syncControls();
    else this.syncSettlementButtons();
    this.schedulePreview(PREVIEW_DELAY);
  }

  private store(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Browser storage is a convenience; the window works without it.
    }
  }

  private syncControls(): void {
    const { choices } = this.state;
    for (const group of this.root.querySelectorAll<HTMLElement>("[data-choice]")) {
      const name = group.dataset.choice!;
      const current = name === "forest" || name === "rocks" || name === "fields"
        ? choices.densities[name]
        : (choices as unknown as Record<string, string>)[name];
      for (const button of group.querySelectorAll<HTMLButtonElement>("button")) {
        const active = button.dataset.value === current;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
        button.disabled = ((choices.landform === "island" || choices.landform === "coast") && name === "size" && button.dataset.value !== "small")
          || (choices.landform === "island" && name === "roads" && button.dataset.value === "exits");
      }
    }
    for (const name of ["rivers", "lakes"] as const) {
      const input = this.element<HTMLInputElement>(`[data-count="${name}"]`);
      input.disabled = name === "rivers" && choices.landform === "island";
      if (input.value !== String(choices[name])) {
        input.value = String(choices[name]);
        // The slider beside it (paramFields) follows its number box on change.
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    this.element<HTMLSelectElement>("[data-cover]").value = choices.cover;
    this.element<HTMLInputElement>("[data-seed]").value = String(choices.seed);
    this.element<HTMLElement>("[data-settlement-list]").innerHTML = choices.settlements
      .map((type, index) => `<span class="random-world-chip" data-testid="random-world-settlement">${LABELS.settlement[type]}<button type="button" data-remove-settlement="${index}" aria-label="Remove ${LABELS.settlement[type]}" title="Yerleşimi çıkar">×</button></span>`)
      .join("");
    this.element<HTMLElement>("[data-island-info]").hidden = choices.landform !== "island";
    this.element<HTMLElement>("[data-coast-options]").hidden = choices.landform !== "coast";
    this.syncSettlementButtons();
    this.syncPath();
  }

  private syncSettlementButtons(): void {
    const count = this.state.choices.settlements.length;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-add-settlement]")) button.disabled = count >= MAX_WINDOW_SETTLEMENTS;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-remove-settlement]")) button.disabled = count <= 1;
  }

  /** The level Create builds into: the open one. */
  levelPath(): string | null {
    const path = this.options.levelPath();
    return path ? path.replace(/\\/g, "/").replace(/^\/+/, "") : null;
  }

  private syncPath(): void {
    const path = this.levelPath();
    const problem = randomWorldTargetProblem(path);
    this.element<HTMLElement>("[data-level-path]").textContent = path ?? "—";
    const box = this.element<HTMLElement>("[data-target-problem]");
    box.hidden = problem === null;
    box.textContent = problem ?? "";
    this.element<HTMLButtonElement>("[data-create]").disabled = this.building || problem !== null;
  }

  private generatorOptions(): RandomWorldOptions {
    const { choices } = this.state;
    return {
      id: "preview",
      name: "Preview",
      seed: choices.seed,
      size: choices.size,
      landform: choices.landform,
      seaSide: choices.seaSide,
      mountainHeight: choices.mountainHeight,
      settlements: choices.settlements.map((type) => ({ type })),
      roads: choices.roads,
      rivers: choices.rivers,
      lakes: choices.lakes,
      cover: choices.cover,
      densities: { ...choices.densities },
    };
  }

  private cover(name: CoverName): Promise<unknown> {
    let pending = this.covers.get(name);
    if (!pending) {
      pending = fetch(projectFileUrl(COVERS[name]), { cache: "no-cache" }).then(async (response) => {
        if (!response.ok) throw new Error(`${COVERS[name]}: ${response.status} ${response.statusText}`);
        return response.json() as Promise<unknown>;
      });
      pending.catch(() => this.covers.delete(name));
      this.covers.set(name, pending);
    }
    return pending;
  }

  private schedulePreview(delay: number): void {
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    // Invalidate an in-flight worker immediately, including during the debounce.
    // A ready picture must always describe the current choices, never the last request.
    this.previewId++;
    this.root.dataset.previewState = "pending";
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      void this.requestPreview();
    }, delay);
  }

  private async requestPreview(): Promise<void> {
    const id = ++this.previewId;
    this.root.dataset.previewState = "pending";
    const options = this.generatorOptions();
    let cover: unknown;
    try {
      cover = await this.cover(options.cover!);
    } catch (error) {
      if (id === this.previewId) this.showPreviewError(error);
      return;
    }
    if (id !== this.previewId) return;
    this.worker ??= this.createWorker();
    const request: RandomWorldPreviewRequest = { id, options, cover };
    this.worker.postMessage(request);
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL("../../../../engine/worldbuilder/workers/randomWorldPreviewWorker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<RandomWorldPreviewResponse>) => {
      const response = event.data;
      if (response.id !== this.previewId) return;
      if ("error" in response) {
        this.showPreviewError(new Error(response.error));
        return;
      }
      this.element<HTMLElement>("[data-preview-error]").hidden = true;
      this.drawPreview(response.preview);
      this.root.dataset.previewState = "ready";
      this.root.dataset.previewId = String(response.id);
      this.root.dataset.previewMs = String(response.milliseconds);
    });
    worker.addEventListener("error", (event) => {
      this.showPreviewError(new Error(event.message || "preview worker failed"));
      this.worker?.terminate();
      this.worker = null;
    });
    return worker;
  }

  private showPreviewError(error: unknown): void {
    const box = this.element<HTMLElement>("[data-preview-error]");
    box.textContent = `Önizleme çizilemedi: ${error instanceof Error ? error.message : String(error)}`;
    box.hidden = false;
    this.root.dataset.previewState = "error";
  }

  private drawPreview(preview: RandomWorldPreview): void {
    const canvas = this.element<HTMLCanvasElement>("[data-preview-canvas]");
    const scale = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const size = PREVIEW_SIZE * scale;
    if (canvas.width !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = new ImageData(new Uint8ClampedArray(preview.pixels), preview.resolution, preview.resolution);
    const source = document.createElement("canvas");
    source.width = preview.resolution;
    source.height = preview.resolution;
    source.getContext("2d")!.putImageData(image, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, size, size);
    const at = ([u, v]: readonly [number, number]): [number, number] => [u * size, v * size];
    context.lineCap = "round";
    context.lineJoin = "round";
    // Lakes: the raster fills them; a shore line keeps small ones readable.
    context.strokeStyle = "rgba(160, 205, 240, 0.9)";
    context.lineWidth = 1.2 * scale;
    for (const lake of preview.lakes) {
      context.beginPath();
      lake.polygon.forEach((point, index) => (index ? context.lineTo(...at(point)) : context.moveTo(...at(point))));
      context.closePath();
      context.stroke();
    }
    context.strokeStyle = "rgb(70, 130, 190)";
    for (const river of preview.rivers) {
      context.lineWidth = Math.max(2 * scale, river.width * size);
      context.beginPath();
      river.points.forEach((point, index) => (index ? context.lineTo(...at(point)) : context.moveTo(...at(point))));
      context.stroke();
    }
    for (const road of preview.roads) {
      context.strokeStyle = "rgba(40, 32, 24, 0.55)";
      context.lineWidth = (road.roadClass === "track" ? 3 : 4) * scale;
      context.beginPath();
      context.moveTo(...at(road.from));
      context.lineTo(...at(road.to));
      context.stroke();
      context.strokeStyle = road.roadClass === "track" ? "rgb(222, 200, 160)" : "rgb(246, 232, 196)";
      context.lineWidth = (road.roadClass === "track" ? 1.5 : 2) * scale;
      context.stroke();
    }
    context.font = `${10 * scale}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const settlement of preview.settlements) {
      const [x, y] = at(settlement.at);
      const radius = Math.max(5 * scale, settlement.radius * size);
      context.fillStyle = "rgba(255, 255, 255, 0.22)";
      context.strokeStyle = "rgba(255, 255, 255, 0.95)";
      context.lineWidth = 1.5 * scale;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = "#ffffff";
      context.strokeStyle = "rgba(0, 0, 0, 0.7)";
      context.lineWidth = 3 * scale;
      const label = LABELS.settlement[settlement.type as SettlementType] ?? settlement.type;
      context.strokeText(label, x, y);
      context.fillText(label, x, y);
    }
    // North mark.
    context.fillStyle = "rgba(0, 0, 0, 0.45)";
    context.fillRect(6 * scale, 6 * scale, 18 * scale, 18 * scale);
    context.fillStyle = "#ffffff";
    context.font = `bold ${11 * scale}px system-ui, sans-serif`;
    context.fillText("N", 15 * scale, 15.5 * scale);

    // 8 tiles of 64/128/256 quads 2 m apart: 1024, 2048 or 4096 m, called 1, 2 and 4 km.
    const km = Math.round(preview.extent / 1000);
    const [low, high] = preview.heightRange;
    this.groundHeight = (low + high) / 2;
    const summary = this.element<HTMLElement>("[data-preview-summary]");
    summary.textContent = `${km} × ${km} km · ${preview.settlements.length} yerleşim · ${preview.rivers.length} nehir · ${preview.lakes.length} göl · yükseklik ${Math.round(low)}–${Math.round(high)} m`;
    const notes = this.element<HTMLUListElement>("[data-preview-notes]");
    notes.hidden = preview.notes.length === 0;
    notes.innerHTML = preview.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  }

  private setProgress(fraction: number, label: string): void {
    const box = this.element<HTMLElement>("[data-progress]");
    box.hidden = false;
    box.querySelector("progress")!.value = fraction;
    this.element<HTMLElement>("[data-progress-label]").textContent = label;
  }

  private showCreateError(message: string | null): void {
    const box = this.element<HTMLElement>("[data-create-error]");
    box.hidden = message === null;
    box.textContent = message ?? "";
  }

  private async create(): Promise<void> {
    if (this.building) return;
    const out = this.levelPath();
    if (!out || randomWorldTargetProblem(out) !== null) return;
    const confirm = this.options.confirm ?? ((message: string) => window.confirm(message));
    const unsaved = this.options.hasUnsavedChanges() ? " Kaydedilmemiş değişiklikler de kaybolur." : "";
    if (!confirm(`Yeni dünya "${out}" level'ına kurulacak ve level'daki mevcut her şeyin (arazi, nesneler, elle yapılan değişiklikler) yerini alacak.${unsaved} Devam edilsin mi?`)) {
      this.root.dataset.createState = "cancelled";
      return;
    }
    const { choices } = this.state;
    const world = {
      seed: choices.seed, size: choices.size, landform: choices.landform, mountainHeight: choices.mountainHeight,
      seaSide: choices.seaSide,
      settlements: choices.settlements.map((type) => ({ type })), roads: choices.roads, rivers: choices.rivers, lakes: choices.lakes,
      cover: choices.cover, densities: { ...choices.densities },
    };
    this.building = true;
    this.root.dataset.createState = "building";
    this.element<HTMLButtonElement>("[data-create]").disabled = true;
    this.showCreateError(null);
    this.setProgress(0, "Kurucu başlatılıyor…");
    try {
      // The open level exists: the confirmation above is the permission to replace it.
      const response = await fetch("/__world-random", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ out, world, force: true }) });
      if (!response.ok || !response.body) {
        const answer = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(answer?.error ?? `${response.status} ${response.statusText}`);
      }
      const done = await this.readEvents(response.body);
      this.setProgress(1, `Bitti (${done.seconds} s): ${done.buildings} yapı, ${done.rivers} nehir, ${done.lakes} göl, ${done.bridges} köprü. Sahne açılıyor…`);
      this.root.dataset.createState = "done";
      // A new world opens looking over all of it, not at the ground at the origin.
      storeEditorCameraPose(done.level, overviewCameraPose(worldExtent(choices.size), this.groundHeight));
      await this.options.openLevel(done.level);
    } catch (error) {
      this.root.dataset.createState = "error";
      this.element<HTMLElement>("[data-progress]").hidden = true;
      this.showCreateError(`Dünya kurulamadı: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.building = false;
      this.syncPath();
    }
  }

  /** Reads the endpoint's event lines until `done` (returned) or `error` (thrown). */
  private async readEvents(stream: ReadableStream<Uint8Array>): Promise<{ level: string; seconds: number; buildings: number; rivers: number; lakes: number; bridges: number }> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    for (;;) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
        if (!line) continue;
        const event = JSON.parse(line) as { type: string; step?: string; message?: string } & Record<string, unknown>;
        if (event.type === "progress") {
          const index = WORLD_BUILD_STEPS.indexOf(event.step as (typeof WORLD_BUILD_STEPS)[number]);
          const label = index >= 0 ? BUILD_STEP_LABELS[WORLD_BUILD_STEPS[index]!] : String(event.step);
          this.setProgress((index + 1) / (WORLD_BUILD_STEPS.length + 1), label);
        } else if (event.type === "error") {
          throw new Error(event.message ?? "the builder failed");
        } else if (event.type === "done") {
          return event as unknown as { level: string; seconds: number; buildings: number; rivers: number; lakes: number; bridges: number };
        }
      }
      if (done) throw new Error("the server closed the connection before the build finished");
    }
  }
}
