import type {
  LayoutCloudLayer,
  LayoutHeightFog,
  LayoutPostProcess,
  LayoutSkyAtmosphere,
  Vec3,
} from "@engine/scene/layout";
import type { EditableSelection } from "@/scene/SceneApp";
import { resolveHeightFog } from "@engine/scene/heightFog";
import {
  exponentialFogDensityFor,
  heightFogOpacityAt,
  VIEW_DISTANCE_FOG_OPACITY,
  VIEW_DISTANCE_FOG_WARN_OPACITY,
} from "@engine/world/viewDistance";

export interface EnvironmentDetailsOptions {
  body: HTMLElement;
  selection: EditableSelection;
  setDetailsScale: (scale: Vec3) => void;
  setSkyAtmosphere: (
    patch: { [K in keyof LayoutSkyAtmosphere]?: LayoutSkyAtmosphere[K] | undefined },
    label?: string,
  ) => void;
  setHeightFog: (
    patch: { [K in keyof LayoutHeightFog]?: LayoutHeightFog[K] | undefined },
    label?: string,
  ) => void;
  setCloudLayer: (
    patch: { [K in keyof LayoutCloudLayer]?: LayoutCloudLayer[K] | undefined },
    label?: string,
  ) => void;
  setPostProcess: (
    patch: { [K in keyof LayoutPostProcess]?: LayoutPostProcess[K] | undefined },
    label?: string,
  ) => void;
  recaptureSkyLightCapture: () => void;
  /** The level's `worldSettings.viewDistance`, for the fog's Fit to View Distance. */
  viewDistance: number | null;
}

export function renderSkyDetails(options: EnvironmentDetailsOptions): void {
  const { body, selection } = options;
  const sky = selection.sky;
  if (!sky) return;
  options.setDetailsScale([1, 1, 1]);
  body.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>visual effect / sky atmosphere</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-sky-name type="text" value="${escapeHtml(sky.name)}" placeholder="Sky Atmosphere" />
      </label>
      <div class="detail-section">
        <div class="detail-section-title">Atmosphere</div>
        <label class="detail-row">
          <span>Rayleigh</span>
          <input data-sky-number="rayleigh" type="number" step="0.1" min="0" max="6"
            value="${sky.rayleigh}" />
        </label>
        <label class="detail-row">
          <span>Turbidity</span>
          <input data-sky-number="turbidity" type="number" step="0.5" min="1" max="20"
            value="${sky.turbidity}" />
        </label>
        <label class="detail-row">
          <span>Mie</span>
          <input data-sky-number="mie" type="number" step="0.001" min="0" max="0.1"
            value="${sky.mie}" />
        </label>
        <label class="detail-row">
          <span>Mie Anisotropy</span>
          <input data-sky-number="mieDirectionalG" type="number" step="0.01" min="0" max="0.999"
            value="${sky.mieDirectionalG}" />
        </label>
        <label class="detail-row">
          <span>Exposure</span>
          <input data-sky-number="exposure" type="number" step="0.05" min="0" max="4"
            value="${sky.exposure}" />
        </label>
        <div class="detail-hint">Sun direction is set by rotating the Directional Sun light.</div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Sky Light Capture</div>
        <label class="detail-row">
          <span>Intensity</span>
          <input data-sky-capture-intensity type="number" step="0.05" min="0" max="4"
            value="${sky.skyLightCapture.intensity}" />
        </label>
        <button type="button" data-sky-recapture class="detail-button">Recapture from Sky</button>
        <div class="detail-hint">Fallback PBR reflection used where no Sphere Reflection Capture applies.</div>
      </div>
    `;

  const nameInput = body.querySelector<HTMLInputElement>("[data-sky-name]");
  nameInput?.addEventListener("change", () => {
    const value = nameInput.value.trim();
    options.setSkyAtmosphere(
      { name: value.length > 0 ? value : undefined },
      "Rename Sky Atmosphere",
    );
  });

  body.querySelectorAll<HTMLInputElement>("[data-sky-number]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.skyNumber as keyof LayoutSkyAtmosphere | undefined;
      const value = Number(input.value);
      if (!key || !Number.isFinite(value)) return;
      options.setSkyAtmosphere(
        { [key]: value } as Partial<LayoutSkyAtmosphere>,
        "Edit Sky Atmosphere",
      );
    });
  });

  body
    .querySelector<HTMLInputElement>("[data-sky-capture-intensity]")
    ?.addEventListener("change", (event) => {
      const value = Number((event.currentTarget as HTMLInputElement).value);
      if (!Number.isFinite(value)) return;
      options.setSkyAtmosphere(
        { skyLightCapture: { intensity: value } },
        "Edit Sky Light Capture",
      );
    });

  body.querySelector<HTMLButtonElement>("[data-sky-recapture]")?.addEventListener("click", () => {
    options.recaptureSkyLightCapture();
  });
}

export function renderFogDetails(options: EnvironmentDetailsOptions): void {
  const { body, selection } = options;
  const fog = selection.fog;
  if (!fog) return;
  options.setDetailsScale([1, 1, 1]);
  const densityRow = `
      <label class="detail-row">
        <span>Density</span>
        <input data-fog-number="density" type="number" step="0.005" min="0" max="2"
          value="${fog.density}" />
      </label>`;
  const linearRows = `
      <label class="detail-row">
        <span>Start</span>
        <input data-fog-number="start" type="number" step="1" min="0"
          value="${fog.start}" />
      </label>
      <label class="detail-row">
        <span>End</span>
        <input data-fog-number="end" type="number" step="1" min="0"
          value="${fog.end}" />
      </label>`;
  body.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>visual effect / exponential height fog</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-fog-name type="text" value="${escapeHtml(fog.name)}" placeholder="Exponential Height Fog" />
      </label>
      <div class="detail-section">
        <div class="detail-section-title">Fog</div>
        <label class="detail-row">
          <span>Mode</span>
          <select data-fog-mode>
            <option value="exp" ${fog.mode === "exp" ? "selected" : ""}>Exponential (FogExp2)</option>
            <option value="linear" ${fog.mode === "linear" ? "selected" : ""}>Linear (near/far)</option>
          </select>
        </label>
        <label class="detail-row">
          <span>Color</span>
          <input data-fog-color type="color" value="${escapeHtml(fog.color)}" />
        </label>
        ${fog.mode === "linear" ? linearRows : densityRow}
        <div class="detail-hint">Distance-based scene fog. Height falloff is a later phase.</div>
      </div>
      ${fogViewDistanceSection(fog, options.viewDistance)}
    `;

  body.querySelector<HTMLButtonElement>("[data-fog-fit-view]")?.addEventListener("click", () => {
    if (options.viewDistance === null) return;
    options.setHeightFog(
      { mode: "exp", density: Number(exponentialFogDensityFor(options.viewDistance).toFixed(6)) },
      "Fit Fog to View Distance",
    );
  });

  const nameInput = body.querySelector<HTMLInputElement>("[data-fog-name]");
  nameInput?.addEventListener("change", () => {
    const value = nameInput.value.trim();
    options.setHeightFog(
      { name: value.length > 0 ? value : undefined },
      "Rename Exponential Height Fog",
    );
  });

  body.querySelector<HTMLSelectElement>("[data-fog-mode]")?.addEventListener(
    "change",
    (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      if (value !== "exp" && value !== "linear") return;
      options.setHeightFog({ mode: value }, "Edit Exponential Height Fog");
    },
  );

  body.querySelector<HTMLInputElement>("[data-fog-color]")?.addEventListener(
    "change",
    (event) => {
      const value = (event.currentTarget as HTMLInputElement).value;
      options.setHeightFog({ color: value }, "Edit Exponential Height Fog");
    },
  );

  body.querySelectorAll<HTMLInputElement>("[data-fog-number]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.fogNumber as keyof LayoutHeightFog | undefined;
      const value = Number(input.value);
      if (!key || !Number.isFinite(value)) return;
      options.setHeightFog(
        { [key]: value } as Partial<LayoutHeightFog>,
        "Edit Exponential Height Fog",
      );
    });
  });
}

/**
 * Faz 7d: how opaque the fog is at the level's view distance, and a command that
 * fits an exponential fog to it (98% there), hiding the far plane's terrain edge.
 */
function fogViewDistanceSection(fog: LayoutHeightFog, viewDistance: number | null): string {
  if (viewDistance === null) {
    return `
      <div class="detail-section">
        <div class="detail-section-title">View Distance</div>
        <div class="detail-hint">Set World Settings &gt; View Distance to fit the fog to it.</div>
      </div>`;
  }
  const opacity = heightFogOpacityAt(resolveHeightFog(fog), viewDistance);
  const percent = Math.round(opacity * 100);
  const warning = opacity < VIEW_DISTANCE_FOG_WARN_OPACITY
    ? `<div class="detail-hint" data-fog-view-warning>Terrain will end in a hard edge at the far plane.</div>`
    : "";
  return `
      <div class="detail-section">
        <div class="detail-section-title">View Distance</div>
        <div class="detail-row">
          <span>At ${viewDistance} m</span>
          <span class="detail-value" data-fog-view-opacity>${percent}% fog</span>
        </div>
        ${warning}
        <button type="button" class="detail-button" data-fog-fit-view>Fit to View Distance</button>
        <div class="detail-hint">Exponential fog reaching ${Math.round(VIEW_DISTANCE_FOG_OPACITY * 100)}% at the view distance.</div>
      </div>`;
}

export function renderCloudDetails(options: EnvironmentDetailsOptions): void {
  const { body, selection } = options;
  const cloud = selection.cloud;
  if (!cloud) return;
  options.setDetailsScale([1, 1, 1]);
  body.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>visual effect / cloud layer</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-cloud-name type="text" value="${escapeHtml(cloud.name)}" placeholder="Cloud Layer" />
      </label>
      <div class="detail-section">
        <div class="detail-section-title">Clouds</div>
        <label class="detail-row">
          <span>Color</span>
          <input data-cloud-color type="color" value="${escapeHtml(cloud.color)}" />
        </label>
        <label class="detail-row">
          <span>Coverage</span>
          <input data-cloud-number="coverage" type="number" step="0.05" min="0" max="1"
            value="${cloud.coverage}" />
        </label>
        <label class="detail-row">
          <span>Density</span>
          <input data-cloud-number="density" type="number" step="0.05" min="0" max="1"
            value="${cloud.density}" />
        </label>
        <label class="detail-row">
          <span>Softness</span>
          <input data-cloud-number="softness" type="number" step="0.05" min="0" max="1"
            value="${cloud.softness}" />
        </label>
        <label class="detail-row">
          <span>Scale</span>
          <input data-cloud-number="scale" type="number" step="0.25" min="0.1" max="20"
            value="${cloud.scale}" />
        </label>
        <label class="detail-row">
          <span>Wind</span>
          <input data-cloud-number="speed" type="number" step="0.05" min="0" max="5"
            value="${cloud.speed}" />
        </label>
        <div class="detail-hint">Static procedural cloud dome. Wind 0 keeps it frozen; not volumetric.</div>
      </div>
    `;

  const nameInput = body.querySelector<HTMLInputElement>("[data-cloud-name]");
  nameInput?.addEventListener("change", () => {
    const value = nameInput.value.trim();
    options.setCloudLayer({ name: value.length > 0 ? value : undefined }, "Rename Cloud Layer");
  });

  body.querySelector<HTMLInputElement>("[data-cloud-color]")?.addEventListener(
    "change",
    (event) => {
      const value = (event.currentTarget as HTMLInputElement).value;
      options.setCloudLayer({ color: value }, "Edit Cloud Layer");
    },
  );

  body.querySelectorAll<HTMLInputElement>("[data-cloud-number]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.cloudNumber as keyof LayoutCloudLayer | undefined;
      const value = Number(input.value);
      if (!key || !Number.isFinite(value)) return;
      options.setCloudLayer({ [key]: value } as Partial<LayoutCloudLayer>, "Edit Cloud Layer");
    });
  });
}

export function renderPostDetails(options: EnvironmentDetailsOptions): void {
  const { body, selection } = options;
  const post = selection.post;
  if (!post) return;
  options.setDetailsScale([1, 1, 1]);
  body.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>visual effect / post process</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-post-name type="text" value="${escapeHtml(post.name)}" placeholder="Post Process" />
      </label>
      <div class="detail-section">
        <div class="detail-section-title">Exposure & Tone Mapping</div>
        <label class="detail-row">
          <span>Exposure</span>
          <input data-post-exposure type="number" step="0.05" min="0" max="4"
            value="${post.exposure}" />
        </label>
        <label class="detail-row">
          <span>Tonemapper</span>
          <select data-post-tone-mapping>
            <option value="aces" ${post.toneMapping === "aces" ? "selected" : ""}>ACES Filmic</option>
            <option value="neutral" ${post.toneMapping === "neutral" ? "selected" : ""}>Neutral</option>
            <option value="none" ${post.toneMapping === "none" ? "selected" : ""}>None</option>
          </select>
        </label>
        <div class="detail-hint">Post Process controls scene exposure; Sky Atmosphere scales its own exposure locally.</div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Anti-alias</div>
        <label class="detail-row">
          <span>Mode</span>
          <select data-post-antialias>
            <option value="none" ${post.antialias === "none" ? "selected" : ""}>None</option>
            <option value="smaa" ${post.antialias === "smaa" ? "selected" : ""}>SMAA</option>
          </select>
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Bloom</div>
        <label class="detail-toggle">
          <input type="checkbox" data-post-bloom-enabled ${post.bloom.enabled ? "checked" : ""} />
          <span>Enabled</span>
        </label>
        <label class="detail-row">
          <span>Threshold</span>
          <input data-post-bloom-number="threshold" type="number" step="0.05" min="0" max="2"
            value="${post.bloom.threshold}" />
        </label>
        <label class="detail-row">
          <span>Intensity</span>
          <input data-post-bloom-number="intensity" type="number" step="0.05" min="0" max="5"
            value="${post.bloom.intensity}" />
        </label>
        <label class="detail-row">
          <span>Radius</span>
          <input data-post-bloom-number="radius" type="number" step="0.05" min="0" max="2"
            value="${post.bloom.radius}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Color Grading</div>
        <label class="detail-row">
          <span>Saturation</span>
          <input data-post-number="saturation" type="number" step="0.05" min="0" max="2"
            value="${post.saturation}" />
        </label>
        <label class="detail-row">
          <span>Contrast</span>
          <input data-post-number="contrast" type="number" step="0.05" min="0" max="2"
            value="${post.contrast}" />
        </label>
        <label class="detail-row">
          <span>Temperature</span>
          <input data-post-number="temperature" type="number" step="0.05" min="-1" max="1"
            value="${post.temperature}" />
        </label>
        <label class="detail-row">
          <span>Tint</span>
          <input data-post-number="tint" type="number" step="0.05" min="-1" max="1"
            value="${post.tint}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Vignette</div>
        <label class="detail-toggle">
          <input type="checkbox" data-post-vignette-enabled ${post.vignette.enabled ? "checked" : ""} />
          <span>Enabled</span>
        </label>
        <label class="detail-row">
          <span>Intensity</span>
          <input data-post-vignette-number="intensity" type="number" step="0.05" min="0" max="2"
            value="${post.vignette.intensity}" />
        </label>
        <label class="detail-row">
          <span>Offset</span>
          <input data-post-vignette-number="offset" type="number" step="0.05" min="0" max="2"
            value="${post.vignette.offset}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Depth of Field</div>
        <label class="detail-toggle">
          <input type="checkbox" data-post-dof-enabled ${post.dof.enabled ? "checked" : ""} />
          <span>Enabled</span>
        </label>
        <label class="detail-row">
          <span>Focus Distance</span>
          <input data-post-dof-number="focusDistance" type="number" step="0.5" min="0" max="100"
            value="${post.dof.focusDistance}" />
        </label>
        <label class="detail-row">
          <span>Aperture</span>
          <input data-post-dof-number="aperture" type="number" step="0.05" min="0" max="2"
            value="${post.dof.aperture}" />
        </label>
        <label class="detail-row">
          <span>Max Blur</span>
          <input data-post-dof-number="maxBlur" type="number" step="0.05" min="0" max="2"
            value="${post.dof.maxBlur}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Ambient Occlusion</div>
        <label class="detail-toggle">
          <input type="checkbox" data-post-ao-enabled ${post.ao.enabled ? "checked" : ""} />
          <span>Enabled</span>
        </label>
        <label class="detail-row">
          <span>Radius</span>
          <input data-post-ao-number="radius" type="number" step="0.05" min="0" max="4"
            value="${post.ao.radius}" />
        </label>
        <label class="detail-row">
          <span>Intensity</span>
          <input data-post-ao-number="intensity" type="number" step="0.05" min="0" max="2"
            value="${post.ao.intensity}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Chromatic Aberration</div>
        <label class="detail-toggle">
          <input type="checkbox" data-post-ca-enabled ${post.chromaticAberration.enabled ? "checked" : ""} />
          <span>Enabled</span>
        </label>
        <label class="detail-row">
          <span>Amount</span>
          <input data-post-ca-number="amount" type="number" step="0.05" min="0" max="2"
            value="${post.chromaticAberration.amount}" />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Film Grain</div>
        <label class="detail-toggle">
          <input type="checkbox" data-post-grain-enabled ${post.grain.enabled ? "checked" : ""} />
          <span>Enabled</span>
        </label>
        <label class="detail-row">
          <span>Intensity</span>
          <input data-post-grain-number="intensity" type="number" step="0.05" min="0" max="1"
            value="${post.grain.intensity}" />
        </label>
      </div>
    `;

  bindPostInputs(options, post);
}

function bindPostInputs(options: EnvironmentDetailsOptions, post: NonNullable<EditableSelection["post"]>): void {
  const { body } = options;
  const nameInput = body.querySelector<HTMLInputElement>("[data-post-name]");
  nameInput?.addEventListener("change", () => {
    const value = nameInput.value.trim();
    options.setPostProcess(
      { name: value.length > 0 ? value : undefined },
      "Rename Post Process",
    );
  });

  body.querySelector<HTMLInputElement>("[data-post-exposure]")?.addEventListener(
    "change",
    (event) => {
      const value = Number((event.currentTarget as HTMLInputElement).value);
      if (!Number.isFinite(value)) return;
      options.setPostProcess({ exposure: value }, "Edit Post Process");
    },
  );

  body.querySelector<HTMLSelectElement>("[data-post-tone-mapping]")?.addEventListener(
    "change",
    (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      if (value !== "aces" && value !== "neutral" && value !== "none") return;
      options.setPostProcess(
        { toneMapping: value as LayoutPostProcess["toneMapping"] },
        "Edit Post Process",
      );
    },
  );

  body.querySelector<HTMLSelectElement>("[data-post-antialias]")?.addEventListener(
    "change",
    (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      if (value !== "none" && value !== "smaa") return;
      options.setPostProcess(
        { antialias: value as LayoutPostProcess["antialias"] },
        "Edit Post Process Anti-alias",
      );
    },
  );

  body.querySelector<HTMLInputElement>("[data-post-bloom-enabled]")?.addEventListener(
    "change",
    (event) => {
      options.setPostProcess(
        { bloom: { ...post.bloom, enabled: (event.currentTarget as HTMLInputElement).checked } },
        "Edit Post Process Bloom",
      );
    },
  );

  body.querySelectorAll<HTMLInputElement>("[data-post-bloom-number]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.postBloomNumber as keyof LayoutPostProcess["bloom"] | undefined;
      const value = Number(input.value);
      if (!key || !Number.isFinite(value)) return;
      options.setPostProcess(
        { bloom: { ...post.bloom, [key]: value } },
        "Edit Post Process Bloom",
      );
    });
  });

  body.querySelectorAll<HTMLInputElement>("[data-post-number]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.postNumber as
        | "saturation"
        | "contrast"
        | "temperature"
        | "tint"
        | undefined;
      const value = Number(input.value);
      if (!key || !Number.isFinite(value)) return;
      options.setPostProcess({ [key]: value }, "Edit Post Process Color Grading");
    });
  });

  bindPostNestedGroup({
    body,
    selectorEnabled: "[data-post-vignette-enabled]",
    selectorNumber: "[data-post-vignette-number]",
    datasetKey: "postVignetteNumber",
    current: post.vignette,
    commit: (value) => options.setPostProcess({ vignette: value }, "Edit Post Process Vignette"),
  });
  bindPostNestedGroup({
    body,
    selectorEnabled: "[data-post-dof-enabled]",
    selectorNumber: "[data-post-dof-number]",
    datasetKey: "postDofNumber",
    current: post.dof,
    commit: (value) => options.setPostProcess({ dof: value }, "Edit Post Process Depth of Field"),
  });
  bindPostNestedGroup({
    body,
    selectorEnabled: "[data-post-ao-enabled]",
    selectorNumber: "[data-post-ao-number]",
    datasetKey: "postAoNumber",
    current: post.ao,
    commit: (value) => options.setPostProcess({ ao: value }, "Edit Post Process Ambient Occlusion"),
  });
  bindPostNestedGroup({
    body,
    selectorEnabled: "[data-post-ca-enabled]",
    selectorNumber: "[data-post-ca-number]",
    datasetKey: "postCaNumber",
    current: post.chromaticAberration,
    commit: (value) =>
      options.setPostProcess(
        { chromaticAberration: value },
        "Edit Post Process Chromatic Aberration",
      ),
  });
  bindPostNestedGroup({
    body,
    selectorEnabled: "[data-post-grain-enabled]",
    selectorNumber: "[data-post-grain-number]",
    datasetKey: "postGrainNumber",
    current: post.grain,
    commit: (value) => options.setPostProcess({ grain: value }, "Edit Post Process Film Grain"),
  });
}

function bindPostNestedGroup<T extends { enabled: boolean }>(options: {
  body: HTMLElement;
  selectorEnabled: string;
  selectorNumber: string;
  datasetKey: string;
  current: T;
  commit: (value: T) => void;
}): void {
  options.body.querySelector<HTMLInputElement>(options.selectorEnabled)?.addEventListener(
    "change",
    (event) => {
      options.commit({
        ...options.current,
        enabled: (event.currentTarget as HTMLInputElement).checked,
      });
    },
  );

  options.body.querySelectorAll<HTMLInputElement>(options.selectorNumber).forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset[options.datasetKey] as keyof T | undefined;
      const value = Number(input.value);
      if (!key || !Number.isFinite(value)) return;
      options.commit({ ...options.current, [key]: value });
    });
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
