import {
  BoxGeometry,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  type Group,
  type Mesh,
  type Object3D,
  type Raycaster,
} from "three";

import {
  DEFORMABLE_DETACH_DEFAULTS,
  DEFORMABLE_DETACH_LIMITS,
  DEFORMABLE_MAX_PARTS,
  DEFORMABLE_ZONE_COORDINATE,
  fitPartZone,
  type AssetDeformablePart,
  type DeformablePartDetach,
  type DeformablePartZone,
} from "@engine/physics/deformable/deformableTypes";
import { modelPartNodes, nodeBounds, partNodeOfMesh } from "@engine/render-three/deformablePartNodes";

/**
 * The "Parts" block of the Static Mesh Editor's Deformable section: which nodes
 * dent on their own, the zone that catches their hits, and how they tear off.
 * Zones are drawn in the viewport over the model.
 */

export interface DeformablePartsHost {
  /** The loaded model root (`gltf.scene`), or null while it loads. */
  modelRoot(): Object3D | null;
  /** Holds the zone boxes; the host keeps it in the scene. */
  readonly zoneGroup: Group;
  parts(): readonly AssetDeformablePart[];
  /** Stores the list, which marks the asset dirty and rerenders the section. */
  setParts(parts: AssetDeformablePart[]): void;
  setStatus(message: string, tone?: "info" | "warning" | "error"): void;
  rerender(): void;
}

type DetachKey = keyof DeformablePartDetach;

const DETACH_FIELDS: readonly { key: DetachKey; label: string; step: number; title: string; sliderMax: number }[] = [
  { key: "impulse", label: "Detach Impulse (N·s)", step: 50, title: "Parçaya bu kadar sert vuran darbe onu koparır", sliderMax: 20000 },
  { key: "massKg", label: "Mass (kg)", step: 1, title: "Kopan parçanın kütlesi; nesnenin kendi kütlesi değişmez", sliderMax: 500 },
  { key: "kick", label: "Kick (m/s)", step: 0.1, title: "Koparken nesneden uzağa eklenen hız", sliderMax: 10 },
];

const ZONE_COLOR = 0xffa040;
const SELECTED_ZONE_COLOR = 0xffff60;

const round = (value: number): number => Math.round(value * 1000) / 1000;

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** `Door_L` → `door_l`, numbered when taken. */
function partIdFor(node: string, taken: readonly string[]): string {
  const base = node.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "part";
  if (!taken.includes(base)) return base;
  let index = 2;
  while (taken.includes(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

export class DeformablePartsEditor {
  /** The next viewport click on the model adds that part. */
  private pickArmed = false;
  private selected: string | null = null;
  /** The node in the Add Part list. */
  private nodeChoice = "";

  constructor(private readonly host: DeformablePartsHost) {}

  get wantsViewportPick(): boolean {
    return this.pickArmed;
  }

  /** Adds the part under the ray; false when it misses the model. */
  pick(raycaster: Raycaster): boolean {
    const root = this.host.modelRoot();
    if (!root) return false;
    const hit = raycaster.intersectObject(root, true).find((item) => (item.object as Mesh).isMesh && item.object.visible);
    if (!hit) return false;
    this.pickArmed = false;
    const name = partNodeOfMesh(hit.object, root).name;
    if (!name) {
      this.host.setStatus("Bu mesh'in adı yok, parça olarak kaydedilemez.", "warning");
      this.host.rerender();
      return true;
    }
    this.addPart(name);
    return true;
  }

  /** Draws the zones over the model. */
  refreshZones(): void {
    const group = this.host.zoneGroup;
    this.clearZones();
    const root = this.host.modelRoot();
    if (!root) return;
    root.updateWorldMatrix(true, false);
    group.matrixAutoUpdate = false;
    group.matrix.copy(root.matrixWorld);
    group.matrixWorldNeedsUpdate = true;
    for (const part of this.host.parts()) {
      const { min, max } = part.zone;
      const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as const;
      const box = new BoxGeometry(Math.max(size[0], 1e-3), Math.max(size[1], 1e-3), Math.max(size[2], 1e-3));
      const edges = new EdgesGeometry(box);
      box.dispose();
      const color = part.id === this.selected ? SELECTED_ZONE_COLOR : ZONE_COLOR;
      const wire = new LineSegments(edges, new LineBasicMaterial({ color, depthTest: false, transparent: true }));
      wire.position.set(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2);
      wire.renderOrder = 10;
      wire.name = part.id;
      group.add(wire);
    }
  }

  dispose(): void {
    this.clearZones();
  }

  html(): string {
    const parts = this.host.parts();
    const root = this.host.modelRoot();
    const used = new Set(parts.flatMap((part) => part.nodes));
    const nodes = root ? modelPartNodes(root).filter((node) => !used.has(node)) : [];
    if (!nodes.includes(this.nodeChoice)) this.nodeChoice = nodes[0] ?? "";
    const full = parts.length >= DEFORMABLE_MAX_PARTS;
    const options = nodes
      .map((node) => `<option value="${escapeAttribute(node)}" ${node === this.nodeChoice ? "selected" : ""}>${escapeAttribute(node)}</option>`)
      .join("");
    return `
        <div class="sm-section-title">Parts <span class="sm-count">${parts.length}</span></div>
        <div data-sm-deformable-parts data-zones="${parts.length}">
          ${parts.map((part) => this.partHtml(part, root)).join("") || `<div class="sm-hint">Parça yok: model tek yüzey olarak göçer. Parça eklersen kapı, ayna gibi düğümler ayrı göçer ve kopabilir.</div>`}
        </div>
        <label class="sm-row" title="Parça yapılacak model düğümü">
          <span>Node</span>
          <select data-sm-deformable-part-node ${options ? "" : "disabled"}>${options}</select>
        </label>
        <div class="sm-prim-list">
          <button type="button" data-sm-deformable-part-add ${full || !options ? "disabled" : ""} title="Seçili düğümü parça yapar, bölgesini otomatik kurar">Add Part</button>
          <button type="button" data-sm-deformable-part-pick class="${this.pickArmed ? "is-active" : ""}" ${full ? "disabled" : ""} title="Sonra modele tıkla: tıklanan düğüm parça olur">Pick Part</button>
        </div>`;
  }

  private partHtml(part: AssetDeformablePart, root: Object3D | null): string {
    const id = escapeAttribute(part.id);
    const missing = root ? part.nodes.filter((node) => nodeBounds(root, [node]) === null) : [];
    const corner = (name: "min" | "max", values: readonly number[]): string => `
          <div class="sm-row" title="Bölgenin model uzayındaki ${name === "min" ? "alt" : "üst"} köşesi (m)">
            <span>Zone ${name === "min" ? "Min" : "Max"}</span>
            <div class="sm-fracture-vec">${[0, 1, 2].map((axis) => `
              <input type="number" data-sm-part-zone="${id}" data-corner="${name}" data-axis="${axis}"
                min="${DEFORMABLE_ZONE_COORDINATE[0]}" max="${DEFORMABLE_ZONE_COORDINATE[1]}" step="0.05"
                aria-label="Zone ${name} ${"XYZ"[axis]}" value="${round(values[axis]!)}" />`).join("")}
            </div>
          </div>`;
    const detach = part.detach
      ? DETACH_FIELDS.map(({ key, label, step, title, sliderMax }) => `
          <label class="sm-row" title="${title}">
            <span>${label}</span>
            <input type="number" data-sm-part-detach="${id}" data-key="${key}" min="${DEFORMABLE_DETACH_LIMITS[key][0]}"
              max="${DEFORMABLE_DETACH_LIMITS[key][1]}" step="${step}" data-slider-max="${sliderMax}" value="${part.detach![key]}" />
          </label>`).join("")
      : "";
    const open = part.id === this.selected;
    const head = `
          <div class="sm-prim-row ${open ? "is-selected" : ""}" data-sm-part-open="${id}" title="Parçayı aç veya kapat">
            <span class="sm-part-id">${id}</span>
            <span class="sm-part-nodes">${escapeAttribute(part.nodes.join(", "))}</span>
            <span class="sm-part-nodes">${part.detach ? "Detach" : ""}</span>
          </div>`;
    if (!open) return `<div class="sm-part" data-sm-part="${id}">${head}</div>`;
    return `
        <div class="sm-part" data-sm-part="${id}">
          ${head}
          <label class="sm-row" title="Parçanın kalıcı adı; kayıtlar buna bakar, sonradan değiştirme">
            <span>Part Id</span>
            <input type="text" data-sm-part-id="${id}" value="${id}" />
          </label>
          <label class="sm-row" title="Bu parçaya ait model düğümleri, virgülle ayrılır">
            <span>Nodes</span>
            <input type="text" data-sm-part-nodes="${id}" value="${escapeAttribute(part.nodes.join(", "))}" />
          </label>
          ${missing.length > 0 ? `<div class="sm-hint" data-sm-part-missing>Modelde yok: ${escapeAttribute(missing.join(", "))}. Bu parçaya gelen darbe gövdeye düşer.</div>` : ""}
          ${corner("min", part.zone.min)}
          ${corner("max", part.zone.max)}
          <label class="sm-row sm-toggle" title="Yeterince sert darbede parça göçükleriyle birlikte kopar">
            <input type="checkbox" data-sm-part-detach-on="${id}" ${part.detach ? "checked" : ""} />
            <span>Detach</span>
          </label>
          ${detach}
          <div class="sm-prim-list">
            <button type="button" data-sm-part-fit="${id}" title="Bölgeyi düğümlere göre yeniden kurar; ince eksende modelin dış yüzeyine kadar uzatır">Fit Zone</button>
            <button type="button" data-sm-part-remove="${id}" title="Bu parçayı sil">Remove</button>
          </div>
        </div>`;
  }

  bind(root: HTMLElement): void {
    const each = <T extends HTMLElement>(selector: string, run: (element: T) => void): void => {
      root.querySelectorAll<T>(selector).forEach(run);
    };
    root.querySelector<HTMLSelectElement>("[data-sm-deformable-part-node]")?.addEventListener("change", (event) => {
      this.nodeChoice = (event.currentTarget as HTMLSelectElement).value;
    });
    root.querySelector<HTMLButtonElement>("[data-sm-deformable-part-add]")?.addEventListener("click", () => {
      if (this.nodeChoice) this.addPart(this.nodeChoice);
    });
    root.querySelector<HTMLButtonElement>("[data-sm-deformable-part-pick]")?.addEventListener("click", () => {
      this.pickArmed = !this.pickArmed;
      this.host.rerender();
    });
    each<HTMLElement>("[data-sm-part-open]", (row) => {
      row.addEventListener("click", () => {
        const id = row.dataset.smPartOpen!;
        this.selected = this.selected === id ? null : id;
        this.host.rerender();
      });
    });
    each<HTMLInputElement>("[data-sm-part-id]", (input) => {
      input.addEventListener("change", () => this.rename(input.dataset.smPartId!, input.value.trim()));
    });
    each<HTMLInputElement>("[data-sm-part-nodes]", (input) => {
      input.addEventListener("change", () => this.setNodes(input.dataset.smPartNodes!, input.value));
    });
    each<HTMLInputElement>("[data-sm-part-zone]", (input) => {
      input.addEventListener("change", () => {
        const value = Number(input.value);
        if (Number.isFinite(value)) this.setZoneCorner(input.dataset.smPartZone!, input.dataset.corner as "min" | "max", Number(input.dataset.axis), value);
      });
    });
    each<HTMLInputElement>("[data-sm-part-detach-on]", (input) => {
      input.addEventListener("change", () => {
        this.editPart(input.dataset.smPartDetachOn!, (part) => {
          const { detach: _detach, ...rest } = part;
          return input.checked ? { ...rest, detach: { ...DEFORMABLE_DETACH_DEFAULTS } } : rest;
        });
      });
    });
    each<HTMLInputElement>("[data-sm-part-detach]", (input) => {
      input.addEventListener("change", () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        this.editPart(input.dataset.smPartDetach!, (part) => (part.detach
          ? { ...part, detach: { ...part.detach, [input.dataset.key as DetachKey]: value } }
          : part));
      });
    });
    each<HTMLButtonElement>("[data-sm-part-fit]", (button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.smPartFit!;
        const zone = this.fitZone(this.host.parts().find((part) => part.id === id)?.nodes ?? []);
        if (zone) this.editPart(id, (part) => ({ ...part, zone }));
        else this.host.setStatus("Bu parçanın düğümleri modelde yok.", "warning");
      });
    });
    each<HTMLButtonElement>("[data-sm-part-remove]", (button) => {
      button.addEventListener("click", () => {
        this.host.setParts(this.host.parts().filter((part) => part.id !== button.dataset.smPartRemove));
      });
    });
    this.refreshZones();
  }

  private clearZones(): void {
    const group = this.host.zoneGroup;
    for (const child of [...group.children]) {
      const wire = child as LineSegments;
      group.remove(wire);
      wire.geometry.dispose();
      (wire.material as LineBasicMaterial).dispose();
    }
  }

  private fitZone(nodes: readonly string[]): DeformablePartZone | null {
    const root = this.host.modelRoot();
    const part = root ? nodeBounds(root, nodes) : null;
    const model = root ? nodeBounds(root, modelPartNodes(root)) : null;
    return part && model ? fitPartZone(part, model) : null;
  }

  private addPart(node: string): void {
    const zone = this.fitZone([node]);
    if (!zone) {
      this.host.setStatus(`${node} düğümünün geometrisi yok.`, "warning");
      this.host.rerender();
      return;
    }
    const parts = this.host.parts();
    const id = partIdFor(node, parts.map((part) => part.id));
    this.selected = id;
    this.host.setParts([...parts, { id, nodes: [node], zone }]);
  }

  private editPart(id: string, edit: (part: AssetDeformablePart) => AssetDeformablePart): void {
    this.host.setParts(this.host.parts().map((part) => (part.id === id ? edit(part) : part)));
  }

  private rename(id: string, next: string): void {
    if (!next || this.host.parts().some((part) => part.id === next)) {
      this.host.setStatus(next ? `"${next}" adlı bir parça zaten var.` : "Parçanın bir adı olmalı.", "warning");
      this.host.rerender();
      return;
    }
    this.selected = next;
    this.editPart(id, (part) => ({ ...part, id: next }));
  }

  private setNodes(id: string, value: string): void {
    const nodes = [...new Set(value.split(",").map((node) => node.trim()).filter(Boolean))];
    if (nodes.length === 0) {
      this.host.setStatus("Parçanın en az bir düğümü olmalı.", "warning");
      this.host.rerender();
      return;
    }
    this.editPart(id, (part) => ({ ...part, nodes }));
  }

  /** A corner never crosses the other one: the normalizer would drop such a part. */
  private setZoneCorner(id: string, corner: "min" | "max", axis: number, value: number): void {
    this.editPart(id, (part) => {
      const min = [...part.zone.min] as DeformablePartZone["min"];
      const max = [...part.zone.max] as DeformablePartZone["max"];
      if (corner === "min") min[axis] = Math.min(value, max[axis]!);
      else max[axis] = Math.max(value, min[axis]!);
      return { ...part, zone: { min, max } };
    });
  }
}
