import type { LayoutPhysics } from "@engine/scene/layout";
import type { EditableSelection } from "@/scene/SceneApp";

const DEFAULT_LINEAR_DAMPING = 0.12;
const DEFAULT_ANGULAR_DAMPING = 0.45;
const PHYSICS_AXIS_LABELS = ["X", "Y", "Z"] as const;

type PhysicsNumberKey = keyof Pick<LayoutPhysics, "massKg" | "linearDamping" | "angularDamping">;

export type SelectionPhysicsPatch = Partial<LayoutPhysics>;

export interface PhysicsDetailsRenderOptions {
  selection: EditableSelection;
  locked: boolean;
  complexAsSimple: boolean;
}

export interface PhysicsDetailsBindOptions {
  body: HTMLElement;
  setSelectionPhysics: (patch: SelectionPhysicsPatch) => void;
}

export function renderPhysicsSection({
  selection,
  locked,
  complexAsSimple,
}: PhysicsDetailsRenderOptions): string {
  if (selection.kind === "actor") return "";
  const physics = selection.physics;
  const disabled = locked ? "disabled" : "";
  const linearDamping = physics.linearDamping ?? DEFAULT_LINEAR_DAMPING;
  const angularDamping = physics.angularDamping ?? DEFAULT_ANGULAR_DAMPING;
  const enableGravity = physics.enableGravity ?? true;
  const lockPosition = physics.lockPosition ?? [false, false, false];
  const lockRotation = physics.lockRotation ?? [false, false, false];
  // `complexAsSimple` collision uses the render mesh as a static trimesh, which
  // Rapier can't drive dynamically, so Simulate Physics is unavailable and
  // forced off for these assets (the runtime ignores the flag regardless).
  const simulateDisabled = locked || complexAsSimple ? "disabled" : "";

  return `
      <div class="detail-section detail-physics-section">
        <div class="detail-section-title">Physics</div>
        <label class="detail-toggle">
          <input type="checkbox" data-detail-toggle="simulatePhysics" ${
            selection.simulatePhysics && !complexAsSimple ? "checked" : ""
          } ${simulateDisabled} />
          <span>Simulate Physics</span>
        </label>
        ${
          complexAsSimple
            ? `<div class="detail-hint detail-hint-warning">Yalnızca statik: bu asset “Use Complex Collision As Simple” çarpışmasını kullanır.</div>`
            : ""
        }
        <label class="detail-row">
          <span>Mass (kg)</span>
          <input data-physics-number="massKg" type="number" step="0.1" min="0.001"
            max="1000000" value="${physics.massKg ?? ""}" placeholder="Auto" ${disabled} />
        </label>
        <label class="detail-row">
          <span>Linear Damping</span>
          <input data-physics-number="linearDamping" type="number" step="0.01" min="0"
            max="100" value="${linearDamping}" ${disabled} />
        </label>
        <label class="detail-row">
          <span>Angular Damping</span>
          <input data-physics-number="angularDamping" type="number" step="0.01" min="0"
            max="100" value="${angularDamping}" ${disabled} />
        </label>
        <label class="detail-toggle">
          <input type="checkbox" data-physics-toggle="enableGravity" ${
            enableGravity ? "checked" : ""
          } ${disabled} />
          <span>Enable Gravity</span>
        </label>
        <div class="detail-subsection-title">Constraints</div>
        ${physicsLockRow("Lock Position", "position", lockPosition, locked)}
        ${physicsLockRow("Lock Rotation", "rotation", lockRotation, locked)}
      </div>
    `;
}

export function bindPhysicsInputs({
  body,
  setSelectionPhysics,
}: PhysicsDetailsBindOptions): void {
  body.querySelectorAll<HTMLInputElement>("[data-physics-number]").forEach((input) => {
    input.addEventListener("change", () => commitPhysicsNumber(input, setSelectionPhysics));
  });

  body.querySelector<HTMLInputElement>('[data-physics-toggle="enableGravity"]')?.addEventListener(
    "change",
    (event) => {
      setSelectionPhysics({
        enableGravity: (event.currentTarget as HTMLInputElement).checked,
      });
    },
  );

  body.querySelectorAll<HTMLInputElement>("[data-physics-lock]").forEach((input) => {
    input.addEventListener("change", () => commitPhysicsLocks(body, setSelectionPhysics));
  });
}

function commitPhysicsNumber(
  input: HTMLInputElement,
  setSelectionPhysics: (patch: SelectionPhysicsPatch) => void,
): void {
  const key = input.dataset.physicsNumber as PhysicsNumberKey | undefined;
  if (!key) return;
  const trimmed = input.value.trim();
  if (trimmed === "") {
    setSelectionPhysics({ [key]: undefined });
    return;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return;
  setSelectionPhysics({ [key]: value });
}

function commitPhysicsLocks(
  body: HTMLElement,
  setSelectionPhysics: (patch: SelectionPhysicsPatch) => void,
): void {
  const readLocks = (kind: "position" | "rotation"): [boolean, boolean, boolean] => {
    return [0, 1, 2].map((axis) => {
      const input = body.querySelector<HTMLInputElement>(
        `input[data-physics-lock="${kind}"][data-axis="${axis}"]`,
      );
      return input?.checked ?? false;
    }) as [boolean, boolean, boolean];
  };
  setSelectionPhysics({
    lockPosition: readLocks("position"),
    lockRotation: readLocks("rotation"),
  });
}

function physicsLockRow(
  label: string,
  kind: "position" | "rotation",
  locks: readonly [boolean, boolean, boolean],
  disabled = false,
): string {
  const fields = PHYSICS_AXIS_LABELS.map(
    (axis, index) => `
      <label class="physics-axis-lock">
        <span>${axis}</span>
        <input type="checkbox" data-physics-lock="${kind}" data-axis="${index}"
          ${locks[index] ? "checked" : ""} ${disabled ? "disabled" : ""} />
      </label>`,
  ).join("");
  return `
    <div class="detail-row detail-constraint-row">
      <span>${label}</span>
      <div class="physics-lock-fields">${fields}</div>
    </div>
  `;
}
