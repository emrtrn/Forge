import {
  assetPath,
  assetType,
  type EditableAsset,
} from "@engine/assets/manifest";
import type {
  LayoutAudio,
  LayoutBehavior,
  LayoutInteraction,
  LayoutMovingPlatform,
  LayoutParticleEmitter,
} from "@engine/scene/layout";
import type { EditableSelection } from "@/scene/SceneApp";

type ComponentKind = "audio" | "behavior" | "particle" | "interaction" | "movingPlatform";

const COMPONENT_LABELS: Record<ComponentKind, string> = {
  audio: "Audio",
  behavior: "Behavior",
  particle: "Particle",
  interaction: "Interaction",
  movingPlatform: "Moving Platform",
};

const DEFAULT_BEHAVIOR_SCRIPT = "spin";

export interface ComponentDetailsBindOptions {
  body: HTMLElement;
  editableAssets: readonly EditableAsset[];
  currentSelection: () => EditableSelection | null;
  setSelectionAudio: (audio: LayoutAudio | undefined) => void;
  setSelectionBehavior: (behavior: LayoutBehavior | undefined) => void;
  setSelectionParticle: (particle: LayoutParticleEmitter | undefined) => void;
  setSelectionInteraction: (interaction: LayoutInteraction | undefined) => void;
  setSelectionMovingPlatform: (platform: LayoutMovingPlatform | undefined) => void;
}

export function renderComponentsSection(
  selection: EditableSelection,
  editableAssets: readonly EditableAsset[],
): string {
  if (selection.kind === "actor") return "";
  const cards: string[] = [];
  if (selection.audio) cards.push(componentCard("audio", renderAudioFields(selection.audio, editableAssets)));
  if (selection.behavior) {
    cards.push(componentCard("behavior", renderBehaviorFields(selection.behavior)));
  }
  if (selection.particle) {
    cards.push(componentCard("particle", renderParticleFields(selection.particle, editableAssets)));
  }
  if (selection.interaction) {
    cards.push(componentCard("interaction", renderInteractionFields(selection.interaction)));
  }
  if (selection.movingPlatform) {
    cards.push(componentCard("movingPlatform", renderMovingPlatformFields(selection.movingPlatform)));
  }

  return cards.join("");
}

export function bindComponentsInputs(options: ComponentDetailsBindOptions): void {
  const { body } = options;
  body.querySelectorAll<HTMLButtonElement>("[data-remove-component]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.removeComponent;
      if (isAddableComponent(kind)) removeComponent(kind, options);
    });
  });
  body.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-audio]").forEach((input) => {
    input.addEventListener("change", () => commitAudioInput(options));
  });
  body.querySelectorAll<HTMLInputElement>("[data-behavior]").forEach((input) => {
    input.addEventListener("change", () => commitBehaviorInput(options));
  });
  body.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-particle]").forEach((input) => {
    input.addEventListener("change", () => commitParticleInput(options));
  });
  body.querySelectorAll<HTMLInputElement>("[data-interaction]").forEach((input) => {
    input.addEventListener("change", () => commitInteractionInput(options));
  });
  body.querySelectorAll<HTMLInputElement>("[data-moving-platform]").forEach((input) => {
    input.addEventListener("change", () => commitMovingPlatformInput(options));
  });
}

function componentCard(kind: ComponentKind, fields: string): string {
  return `
      <div class="detail-section">
        <div class="detail-section-title detail-component-title">
          <span>${COMPONENT_LABELS[kind]}</span>
          <button type="button" data-remove-component="${kind}"
            title="Remove the ${COMPONENT_LABELS[kind]} component">Remove</button>
        </div>
        ${fields}
      </div>`;
}

function renderAudioFields(audio: LayoutAudio, editableAssets: readonly EditableAsset[]): string {
  const isCue = audio.sourceType === "soundCue";
  const sounds = editableAssets.filter((asset) => assetType(asset) === "sound");
  const cues = editableAssets.filter((asset) => assetType(asset) === "soundCue");

  const clipInList = sounds.some((asset) => asset.id === audio.clipId);
  const clipPreserved = clipInList
    ? ""
    : `<option value="${escapeHtml(audio.clipId)}" selected>${escapeHtml(audio.clipId)}</option>`;
  const clipOptions =
    clipPreserved +
    sounds
      .map(
        (asset) =>
          `<option value="${escapeHtml(asset.id)}" ${
            asset.id === audio.clipId ? "selected" : ""
          }>${escapeHtml(asset.displayName)}</option>`,
      )
      .join("");

  const cueId = audio.sourceId ?? "";
  const cueInList = cues.some((asset) => asset.id === cueId);
  const cuePreserved =
    !cueInList && cueId
      ? `<option value="${escapeHtml(cueId)}" selected>${escapeHtml(cueId)}</option>`
      : "";
  const cueOptions =
    cuePreserved +
    cues
      .map(
        (asset) =>
          `<option value="${escapeHtml(asset.id)}" ${
            asset.id === cueId ? "selected" : ""
          }>${escapeHtml(asset.displayName)}</option>`,
      )
      .join("");

  return `
      <label class="detail-row">
        <span>Source Type</span>
        <select data-audio="sourceType">
          <option value="sound"${!isCue ? " selected" : ""}>Sound (Raw Clip)</option>
          <option value="soundCue"${isCue ? " selected" : ""}>Sound Cue (Graph)</option>
        </select>
      </label>
      ${
        isCue
          ? `
      <label class="detail-row">
        <span>Cue</span>
        <select data-audio="sourceId">${cueOptions}</select>
      </label>`
          : `
      <label class="detail-row">
        <span>Clip</span>
        <select data-audio="clipId">${clipOptions}</select>
      </label>`
      }
      <label class="detail-row">
        <span>Volume</span>
        <input type="number" data-audio="volume" min="0" max="1" step="0.05"
          value="${audio.volume ?? ""}" placeholder="1" />
      </label>
      <label class="detail-row">
        <span>Pitch</span>
        <input type="number" data-audio="pitch" min="0.01" max="8" step="0.05"
          value="${audio.pitch ?? ""}" placeholder="1" />
      </label>
      <label class="detail-toggle">
        <input type="checkbox" data-audio="autoPlay" ${audio.autoPlay ? "checked" : ""} />
        <span>Auto Play</span>
      </label>
      <label class="detail-toggle">
        <input type="checkbox" data-audio="loop" ${audio.loop ? "checked" : ""} />
        <span>Loop</span>
      </label>
      <label class="detail-toggle">
        <input type="checkbox" data-audio="spatial" ${audio.spatial ? "checked" : ""} />
        <span>Spatial</span>
      </label>
      <div class="detail-subhead">Attenuation</div>
      <div class="detail-hint">Spatial açıkken uygulanır. Boş = runtime varsayılanı.</div>
      <label class="detail-row">
        <span>Min Distance</span>
        <input type="number" data-audio="refDistance" min="0" step="0.5"
          value="${audio.refDistance ?? ""}" placeholder="4" />
      </label>
      <label class="detail-row">
        <span>Max Distance</span>
        <input type="number" data-audio="maxDistance" min="0" step="1"
          value="${audio.maxDistance ?? ""}" placeholder="60" />
      </label>
      <label class="detail-row">
        <span>Rolloff</span>
        <input type="number" data-audio="rolloff" min="0" step="0.1"
          value="${audio.rolloff ?? ""}" placeholder="1" />
      </label>`;
}

function renderBehaviorFields(behavior: LayoutBehavior): string {
  const paramCount = behavior.params ? Object.keys(behavior.params).length : 0;
  const paramsHint =
    paramCount > 0
      ? `<div class="detail-hint">parametre girildi (${paramCount}); layout JSON'unda düzenleyin</div>`
      : "";
  return `
      <label class="detail-row">
        <span>Script</span>
        <input type="text" data-behavior="script" value="${escapeHtml(behavior.script)}"
          placeholder="${DEFAULT_BEHAVIOR_SCRIPT}" />
      </label>
      ${paramsHint}`;
}

function renderParticleFields(
  particle: LayoutParticleEmitter,
  editableAssets: readonly EditableAsset[],
): string {
  const effects = editableAssets.filter((asset) => assetPath(asset).endsWith(".effect.json"));
  const inList = effects.some((asset) => asset.id === particle.effectId);
  const preserved = inList
    ? ""
    : `<option value="${escapeHtml(particle.effectId)}" selected>${escapeHtml(particle.effectId)}</option>`;
  const options =
    preserved +
    effects
      .map(
        (asset) =>
          `<option value="${escapeHtml(asset.id)}" ${
            asset.id === particle.effectId ? "selected" : ""
          }>${escapeHtml(asset.displayName)}</option>`,
      )
      .join("");
  const missing = inList
    ? ""
    : `<div class="detail-hint detail-hint-warning">⚠ Efekt “${escapeHtml(
        particle.effectId,
      )}” bilinen bir efekt asset'i değil; id çözülene kadar hiçbir şey oynamaz.</div>`;
  const tintOn = typeof particle.tint === "string";
  const loopValue = particle.loop === undefined ? "default" : particle.loop ? "on" : "off";
  const loopOption = (value: string, label: string): string =>
    `<option value="${value}" ${loopValue === value ? "selected" : ""}>${label}</option>`;
  return `
      <label class="detail-row">
        <span>Effect</span>
        <select data-particle="effectId">${options}</select>
      </label>
      ${missing}
      <label class="detail-toggle">
        <input type="checkbox" data-particle="enabled" ${particle.enabled !== false ? "checked" : ""} />
        <span>Enabled</span>
      </label>
      <label class="detail-toggle">
        <input type="checkbox" data-particle="autoPlay" ${particle.autoPlay ? "checked" : ""} />
        <span>Auto Play</span>
      </label>
      <label class="detail-row">
        <span>Scale</span>
        <input type="number" data-particle="scale" min="0.01" max="100" step="0.05"
          value="${particle.scale ?? ""}" placeholder="1" />
      </label>
      <label class="detail-toggle">
        <input type="checkbox" data-particle="tintEnabled" ${tintOn ? "checked" : ""} />
        <span>Tint</span>
      </label>
      ${
        tintOn
          ? `<label class="detail-row">
        <span>Tint Color</span>
        <input type="color" data-particle="tint" value="${escapeHtml(particle.tint ?? "#ffffff")}" />
      </label>`
          : ""
      }
      <label class="detail-row">
        <span>Loop</span>
        <select data-particle="loop">
          ${loopOption("default", "Asset default")}
          ${loopOption("on", "Force loop")}
          ${loopOption("off", "Force one-shot")}
        </select>
      </label>
      <div class="detail-hint">Emitter davranışı efekt asset'indedir (.effect.json); bunlar yalnızca bu yerleşimi geçersiz kılar.</div>`;
}

function renderInteractionFields(interaction: LayoutInteraction): string {
  return `
      <label class="detail-row">
        <span>Action</span>
        <input type="text" data-interaction="action"
          value="${escapeHtml(interaction.action)}" placeholder="interact" />
      </label>
      <label class="detail-row">
        <span>Prompt</span>
        <input type="text" data-interaction="prompt"
          value="${escapeHtml(interaction.prompt ?? "")}" placeholder="(none)" />
      </label>
      <label class="detail-toggle">
        <input type="checkbox" data-interaction="enabled" ${
          interaction.enabled !== false ? "checked" : ""
        } />
        <span>Enabled</span>
      </label>
      <label class="detail-row">
        <span>Cooldown (s)</span>
        <input type="number" data-interaction="cooldown" min="0" max="3600" step="0.1"
          value="${interaction.cooldown ?? ""}" placeholder="0" />
      </label>`;
}

function renderMovingPlatformFields(platform: LayoutMovingPlatform): string {
  const axis = (index: 0 | 1 | 2, label: string): string => `
      <label class="detail-row">
        <span>${label}</span>
        <input type="number" data-moving-platform="offset${index}" step="0.1"
          value="${platform.offset[index]}" />
      </label>`;
  return `
      <div class="detail-hint">Offset, yerleştirilen konuma görelidir; platform oraya gidip geri gelir.</div>
      ${axis(0, "Offset X")}
      ${axis(1, "Offset Y")}
      ${axis(2, "Offset Z")}
      <label class="detail-row">
        <span>Speed (u/s)</span>
        <input type="number" data-moving-platform="speed" min="0" step="0.1"
          value="${platform.speed}" />
      </label>
      <label class="detail-row">
        <span>Start Phase</span>
        <input type="number" data-moving-platform="startPhase" min="0" max="1" step="0.05"
          value="${platform.startPhase ?? 0}" />
      </label>`;
}

function removeComponent(kind: ComponentKind, options: ComponentDetailsBindOptions): void {
  if (kind === "audio") options.setSelectionAudio(undefined);
  else if (kind === "behavior") options.setSelectionBehavior(undefined);
  else if (kind === "particle") options.setSelectionParticle(undefined);
  else if (kind === "movingPlatform") options.setSelectionMovingPlatform(undefined);
  else options.setSelectionInteraction(undefined);
}

function commitAudioInput(options: ComponentDetailsBindOptions): void {
  const { body, editableAssets } = options;
  const sourceTypeEl = body.querySelector<HTMLSelectElement>('[data-audio="sourceType"]');
  const sourceType = sourceTypeEl?.value as "sound" | "soundCue" | undefined;
  const isCue = sourceType === "soundCue";

  let audio: LayoutAudio;
  if (isCue) {
    const sourceIdEl = body.querySelector<HTMLSelectElement>('[data-audio="sourceId"]');
    const sourceId =
      sourceIdEl?.value.trim() ||
      options.currentSelection()?.audio?.sourceId ||
      editableAssets.find((asset) => assetType(asset) === "soundCue")?.id ||
      "";
    audio = { clipId: "", sourceId, sourceType: "soundCue" };
  } else {
    const clip = body.querySelector<HTMLSelectElement | HTMLInputElement>('[data-audio="clipId"]');
    const clipId = clip?.value.trim();
    if (!clipId) return;
    audio = { clipId };
  }

  const volumeRaw = body.querySelector<HTMLInputElement>('[data-audio="volume"]')?.value.trim();
  if (volumeRaw) {
    const volume = Number(volumeRaw);
    if (Number.isFinite(volume) && volume >= 0 && volume <= 1) audio.volume = volume;
  }
  const readAudioNumber = (field: string, min: number, max: number): number | undefined => {
    const raw = body.querySelector<HTMLInputElement>(`[data-audio="${field}"]`)?.value.trim();
    if (!raw) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value >= min && value <= max ? value : undefined;
  };
  const pitch = readAudioNumber("pitch", 0.01, 8);
  if (pitch !== undefined) audio.pitch = pitch;
  const refDistance = readAudioNumber("refDistance", 0, 100000);
  if (refDistance !== undefined) audio.refDistance = refDistance;
  const maxDistance = readAudioNumber("maxDistance", 0, 100000);
  if (maxDistance !== undefined) audio.maxDistance = maxDistance;
  const rolloff = readAudioNumber("rolloff", 0, 100);
  if (rolloff !== undefined) audio.rolloff = rolloff;
  if (body.querySelector<HTMLInputElement>('[data-audio="autoPlay"]')?.checked) {
    audio.autoPlay = true;
  }
  if (body.querySelector<HTMLInputElement>('[data-audio="loop"]')?.checked) {
    audio.loop = true;
  }
  if (body.querySelector<HTMLInputElement>('[data-audio="spatial"]')?.checked) {
    audio.spatial = true;
  }
  options.setSelectionAudio(audio);
}

function commitBehaviorInput(options: ComponentDetailsBindOptions): void {
  const scriptInput = options.body.querySelector<HTMLInputElement>('[data-behavior="script"]');
  if (!scriptInput) return;
  const behavior: LayoutBehavior = { script: scriptInput.value.trim() || DEFAULT_BEHAVIOR_SCRIPT };
  const params = options.currentSelection()?.behavior?.params;
  if (params && Object.keys(params).length > 0) behavior.params = { ...params };
  options.setSelectionBehavior(behavior);
}

function commitParticleInput(options: ComponentDetailsBindOptions): void {
  const { body } = options;
  const effect = body.querySelector<HTMLSelectElement | HTMLInputElement>('[data-particle="effectId"]');
  const effectId = effect?.value.trim();
  if (!effectId) return;
  const particle: LayoutParticleEmitter = { effectId };
  if (body.querySelector<HTMLInputElement>('[data-particle="enabled"]')?.checked === false) {
    particle.enabled = false;
  }
  if (body.querySelector<HTMLInputElement>('[data-particle="autoPlay"]')?.checked) {
    particle.autoPlay = true;
  }
  const scaleRaw = body.querySelector<HTMLInputElement>('[data-particle="scale"]')?.value.trim();
  if (scaleRaw) {
    const scale = Number(scaleRaw);
    if (Number.isFinite(scale) && scale > 0 && scale !== 1) particle.scale = scale;
  }
  if (body.querySelector<HTMLInputElement>('[data-particle="tintEnabled"]')?.checked) {
    const color = body.querySelector<HTMLInputElement>('[data-particle="tint"]')?.value;
    particle.tint =
      color && /^#[0-9a-fA-F]{6}$/.test(color)
        ? color
        : options.currentSelection()?.particle?.tint ?? "#ffffff";
  }
  const loop = body.querySelector<HTMLSelectElement>('[data-particle="loop"]')?.value;
  if (loop === "on") particle.loop = true;
  else if (loop === "off") particle.loop = false;
  options.setSelectionParticle(particle);
}

function commitInteractionInput(options: ComponentDetailsBindOptions): void {
  const actionInput = options.body.querySelector<HTMLInputElement>('[data-interaction="action"]');
  if (!actionInput) return;
  const interaction: LayoutInteraction = { action: actionInput.value.trim() || "interact" };
  const prompt = options.body.querySelector<HTMLInputElement>('[data-interaction="prompt"]')?.value.trim();
  if (prompt) interaction.prompt = prompt;
  const enabled = options.body.querySelector<HTMLInputElement>('[data-interaction="enabled"]');
  if (enabled && !enabled.checked) interaction.enabled = false;
  const cooldownRaw = options.body
    .querySelector<HTMLInputElement>('[data-interaction="cooldown"]')
    ?.value.trim();
  if (cooldownRaw) {
    const cooldown = Number(cooldownRaw);
    if (Number.isFinite(cooldown) && cooldown > 0) interaction.cooldown = cooldown;
  }
  options.setSelectionInteraction(interaction);
}

function commitMovingPlatformInput(options: ComponentDetailsBindOptions): void {
  const { body } = options;
  const readNumber = (field: string, fallback: number): number => {
    const raw = body.querySelector<HTMLInputElement>(`[data-moving-platform="${field}"]`)?.value.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const prior = options.currentSelection()?.movingPlatform;
  const platform: LayoutMovingPlatform = {
    offset: [
      readNumber("offset0", prior?.offset[0] ?? 0),
      readNumber("offset1", prior?.offset[1] ?? 0),
      readNumber("offset2", prior?.offset[2] ?? 0),
    ],
    speed: Math.max(0, readNumber("speed", prior?.speed ?? 0)),
  };
  const startPhase = Math.min(Math.max(readNumber("startPhase", prior?.startPhase ?? 0), 0), 1);
  if (startPhase > 0) platform.startPhase = startPhase;
  options.setSelectionMovingPlatform(platform);
}

function isAddableComponent(kind: string | undefined): kind is ComponentKind {
  return kind === "audio" || kind === "behavior" || kind === "particle" || kind === "interaction" || kind === "movingPlatform";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
