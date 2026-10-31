const AXES = ["X", "Y", "Z"] as const;

/** A Location/Rotation row: three labelled, colour-coded X/Y/Z fields side by side. */
export function vectorRow(
  label: string,
  prefix: "p" | "r",
  values: readonly [number, number, number],
  step: number,
  disabled = false,
): string {
  const fields = AXES.map((axis, index) =>
    axisField(
      `${prefix}${axis.toLowerCase()}`,
      axis,
      index,
      values[index] ?? 0,
      step,
      "pr",
      disabled,
    ),
  ).join("");
  return `
    <div class="detail-vector">
      <span class="detail-vector-label">${label}</span>
      <div class="vector-fields">${fields}</div>
    </div>
  `;
}

/** The Scale row: three X/Y/Z fields plus a proportional-lock toggle. */
export function scaleRow(
  values: readonly [number, number, number],
  locked: boolean,
  transformLocked = false,
): string {
  const fields = AXES.map((axis, index) =>
    axisField(
      `s${axis.toLowerCase()}`,
      axis,
      index,
      values[index] ?? 0,
      0.05,
      "scale",
      transformLocked,
    ),
  ).join("");
  return `
    <div class="detail-vector detail-vector-scale">
      <span class="detail-vector-label">
        <span>Scale</span>
        <button type="button" class="scale-lock${locked ? " on" : ""}"
          data-scale-lock title="${locked ? "Ölçek oranı kilidini aç" : "Ölçek oranını kilitle"}"
          aria-label="${locked ? "Unlock scale ratio" : "Lock scale ratio"}"
          aria-pressed="${locked}">${locked ? "&#128274;" : "&#128275;"}</button>
      </span>
      <div class="vector-fields">${fields}</div>
    </div>
  `;
}

/** The Pivot row: three X/Y/Z fields (local model space), drag toggle, presets. */
export function pivotRow(
  values: readonly [number, number, number],
  disabled = false,
  dragActive = false,
): string {
  const fields = AXES.map(
    (axis, index) => `
    <label class="axis-field axis-${axis.toLowerCase()}">
      <span class="axis-tag">${axis}</span>
      <input data-pivot data-axis="${index}" type="number" step="0.05"
        value="${Number((values[index] ?? 0).toFixed(3))}" ${disabled ? "disabled" : ""} />
    </label>`,
  ).join("");
  const off = disabled ? "disabled" : "";
  return `
    <div class="detail-vector">
      <span class="detail-vector-label">Pivot</span>
      <div class="vector-fields">${fields}</div>
    </div>
    <div class="detail-actions-row">
      <button type="button" class="pivot-drag-toggle${dragActive ? " on" : ""}"
        data-pivot-drag aria-pressed="${dragActive}" ${off}
        title="Pivotu ayarlamak için viewport'taki gizmoyu sürükleyin">${
          dragActive ? "&#9679; Dragging pivot" : "Drag in viewport"
        }</button>
    </div>
    <div class="detail-actions-row">
      <button type="button" data-pivot-preset="reset" ${off}
        title="Pivot model orijininde">Reset Pivot</button>
      <button type="button" data-pivot-preset="center" ${off}
        title="Pivot sınır kutusunun merkezinde">Center Pivot</button>
      <button type="button" data-pivot-preset="base" ${off}
        title="Pivot alt merkezde (ör. zemine oturan bir menteşe)">Use Base</button>
    </div>
  `;
}

export function axisField(
  name: string,
  axis: string,
  index: number,
  value: number,
  step: number,
  detail: "pr" | "scale",
  disabled = false,
): string {
  return `
    <label class="axis-field axis-${axis.toLowerCase()}">
      <span class="axis-tag">${axis}</span>
      <input name="${name}" data-testid="detail-${name}" data-detail="${detail}" data-axis="${index}"
        type="number" step="${step}" value="${Number(value.toFixed(3))}" ${disabled ? "disabled" : ""} />
    </label>
  `;
}
