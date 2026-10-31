/**
 * Dialogue editor — Forge's form-based authoring shell for the two Dialogue &
 * Voice asset kinds, opened from the Content Browser (double-click):
 *
 *   - **Dialogue Voice** (`*.dialoguevoice.json`) — speaker identity/metadata.
 *   - **Dialogue Line**  (`*.dialogue.json`)      — spoken/subtitle text plus
 *     context mappings that bind the line to recorded audio.
 *
 * One overlay shell serves both (mode = "voice" | "line"), mirroring the
 * SoundCueEditor's overlay/save/preview plumbing. Line mode adds an audio-source
 * picker (raw `sound` or `soundCue`), a subtitle + playback preview, and a live
 * validation panel. Saves round-trip through the dev endpoints in
 * `dialogueStore.ts` (server re-validates via `tools/saveValidator.ts`).
 */

import type {
  DialogueContextMapping,
  DialogueLineAsset,
  DialogueVoiceAsset,
} from "@engine/dialogue/dialogueTypes";
import {
  estimateSubtitleDurationSeconds,
  resolveDialogueLine,
  validateDialogueLine,
  validateDialogueVoice,
} from "@engine/dialogue/dialogueResolver";
import { evaluateSoundCue } from "@engine/audio/soundCueEvaluator";
import type { SoundCueAsset } from "@engine/audio/soundCueTypes";
import {
  loadDialogueLineAsset,
  loadDialogueVoiceAsset,
  saveDialogueLineAsset,
  saveDialogueVoiceAsset,
} from "@/editor/dialogueStore";
import { projectFileUrl } from "@/project/ProjectSystem";

type StatusTone = "info" | "success" | "warning" | "error";

export type DialogueEditorMode = "voice" | "line";

export interface DialogueAudioOption {
  id: string;
  name: string;
  assetType: "sound" | "soundCue";
  path: string;
}

export interface DialogueEditorOptions {
  mode: DialogueEditorMode;
  path: string;
  label: string;
  /** Public paths of dialogueVoice assets — line mode speaker/target suggestions. */
  voicePaths?: readonly string[];
  /** `sound` + `soundCue` assets for the audio-source picker + preview. */
  audioAssets?: readonly DialogueAudioOption[];
  onStatus?: (message: string, tone?: StatusTone) => void;
  onSaved?: () => void;
}

const GENDER_OPTIONS = [
  { value: "neutral", label: "Neutral" },
  { value: "feminine", label: "Feminine" },
  { value: "masculine", label: "Masculine" },
];
const PLURALITY_OPTIONS = [
  { value: "", label: "—" },
  { value: "singular", label: "Singular" },
  { value: "plural", label: "Plural" },
];
const SOURCE_TYPE_OPTIONS = [
  { value: "sound", label: "Sound" },
  { value: "soundCue", label: "Sound Cue" },
];

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── DOM builders ────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const wrap = el("label", "dlg-field");
  const labelEl = el("span", "dlg-field-label");
  labelEl.textContent = label;
  wrap.append(labelEl, control);
  if (hint) {
    const hintEl = el("span", "dlg-field-hint");
    hintEl.textContent = hint;
    wrap.append(hintEl);
  }
  return wrap;
}

function textInput(value: string, onInput: (value: string) => void, placeholder = ""): HTMLInputElement {
  const input = el("input", "dlg-input");
  input.type = "text";
  input.value = value;
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function textArea(value: string, onInput: (value: string) => void, placeholder = ""): HTMLTextAreaElement {
  const area = el("textarea", "dlg-textarea");
  area.value = value;
  if (placeholder) area.placeholder = placeholder;
  area.rows = 2;
  area.addEventListener("input", () => onInput(area.value));
  return area;
}

function selectInput(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const select = el("select", "dlg-select");
  for (const opt of options) {
    const optionEl = el("option");
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    if (opt.value === value) optionEl.selected = true;
    select.append(optionEl);
  }
  // Preserve an unknown current value (e.g. a source id no longer in the project).
  if (value && !options.some((o) => o.value === value)) {
    const optionEl = el("option");
    optionEl.value = value;
    optionEl.textContent = `${value} (missing)`;
    optionEl.selected = true;
    select.append(optionEl);
  }
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

/** Sets an optional string field: trims + assigns, or deletes when blank. */
function setOpt<T extends object>(obj: T, key: keyof T, value: string): void {
  const trimmed = value.trim();
  const record = obj as Record<string, unknown>;
  if (trimmed.length === 0) delete record[key as string];
  else record[key as string] = trimmed;
}

// ─── Editor class ─────────────────────────────────────────────────────────────

export class DialogueEditor {
  private static activeInstance: DialogueEditor | null = null;

  static async open(options: DialogueEditorOptions): Promise<DialogueEditor> {
    DialogueEditor.activeInstance?.close();
    const editor = new DialogueEditor(options);
    DialogueEditor.activeInstance = editor;
    await editor.load();
    return editor;
  }

  private readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly formHost: HTMLElement;
  private readonly warningsHost: HTMLElement;
  private readonly subtitleStrip: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly previewBtn: HTMLButtonElement;

  private voice: DialogueVoiceAsset | null = null;
  private line: DialogueLineAsset | null = null;
  /** Voice id → display label, loaded from `voicePaths` for the speaker pickers. */
  private voiceSuggestions: Array<{ id: string; name: string }> = [];
  private disposed = false;

  private previewCtx: AudioContext | null = null;
  private previewSources: AudioBufferSourceNode[] = [];
  private previewTimers: ReturnType<typeof setTimeout>[] = [];
  private readonly previewBuffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly cueCache = new Map<string, Promise<SoundCueAsset | null>>();

  private constructor(private readonly options: DialogueEditorOptions) {
    const badge = options.mode === "voice" ? "Dialogue Voice" : "Dialogue Line";
    this.overlay = el("div", "dlg-overlay");
    this.overlay.innerHTML = `
<div class="dlg-window">
  <header class="dlg-header">
    <span class="dlg-tab">
      <span class="dlg-tab-icon">${options.mode === "voice" ? "VOX" : "LINE"}</span>
      <strong data-dlg-title></strong>
      <span class="dlg-badge">${badge}</span>
    </span>
    <div class="dlg-toolbar">
      <button type="button" class="dlg-tool-btn" data-dlg-preview title="Altyazı ve sesi önizle">▶ Preview</button>
      <button type="button" class="dlg-tool-btn" data-dlg-stop title="Stop preview">■ Stop</button>
    </div>
    <div class="dlg-header-actions">
      <button type="button" class="dlg-save" data-dlg-save title="Save (Ctrl+S)">Save</button>
      <button type="button" class="dlg-close" data-dlg-close title="Close (Esc)">×</button>
    </div>
  </header>
  <div class="dlg-body">
    <div class="dlg-form" data-dlg-form></div>
    <aside class="dlg-side">
      <div class="dlg-section-title">Subtitle preview</div>
      <div class="dlg-subtitle-strip" data-dlg-subtitle></div>
      <div class="dlg-section-title">Validation</div>
      <div class="dlg-warnings" data-dlg-warnings></div>
    </aside>
  </div>
  <footer class="dlg-status" data-dlg-status>Loading…</footer>
</div>`;
    document.body.append(this.overlay);

    this.titleEl = this.req("[data-dlg-title]");
    this.formHost = this.req("[data-dlg-form]");
    this.warningsHost = this.req("[data-dlg-warnings]");
    this.subtitleStrip = this.req("[data-dlg-subtitle]");
    this.statusEl = this.req("[data-dlg-status]");
    this.saveBtn = this.req<HTMLButtonElement>("[data-dlg-save]");
    this.previewBtn = this.req<HTMLButtonElement>("[data-dlg-preview]");

    this.req<HTMLButtonElement>("[data-dlg-close]").addEventListener("click", () => this.close());
    this.saveBtn.addEventListener("click", () => void this.save());
    this.previewBtn.addEventListener("click", () => void this.preview());
    this.req<HTMLButtonElement>("[data-dlg-stop]").addEventListener("click", () => this.stopPreview());

    // Line mode has no global audio; hide the toolbar preview for voices.
    if (options.mode === "voice") {
      this.previewBtn.hidden = true;
      this.req<HTMLButtonElement>("[data-dlg-stop]").hidden = true;
    }

    this.overlay.tabIndex = -1;
    this.overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void this.save();
      }
    });
    this.overlay.focus();
    this.titleEl.textContent = options.label;
  }

  private req<T extends Element = HTMLElement>(selector: string): T {
    const node = this.overlay.querySelector<T>(selector);
    if (!node) throw new Error(`DialogueEditor: missing ${selector}`);
    return node;
  }

  // ─── Load ────────────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    try {
      if (this.options.mode === "voice") {
        this.voice = await loadDialogueVoiceAsset(this.options.path, this.options.label);
      } else {
        this.line = await loadDialogueLineAsset(this.options.path, this.options.label);
        this.voiceSuggestions = await this.loadVoiceSuggestions();
      }
      this.renderForm();
      this.refreshWarnings();
      this.setStatus("Ready.");
    } catch (error) {
      this.setStatus(`Failed to load: ${describeError(error)}`, "error");
    }
  }

  private async loadVoiceSuggestions(): Promise<Array<{ id: string; name: string }>> {
    const paths = this.options.voicePaths ?? [];
    const loaded = await Promise.all(
      paths.map(async (path) => {
        try {
          const response = await fetch(projectFileUrl(path), { cache: "no-cache" });
          if (!response.ok) return null;
          const data = (await response.json()) as DialogueVoiceAsset;
          if (data?.type !== "dialogueVoice" || typeof data.id !== "string") return null;
          return { id: data.id, name: data.displayName ?? data.name ?? data.id };
        } catch {
          return null;
        }
      }),
    );
    return loaded.filter((entry): entry is { id: string; name: string } => entry !== null);
  }

  // ─── Form rendering ────────────────────────────────────────────────────────

  private renderForm(): void {
    this.formHost.textContent = "";
    if (this.options.mode === "voice" && this.voice) this.renderVoiceForm(this.voice);
    else if (this.line) this.renderLineForm(this.line);
  }

  private renderVoiceForm(voice: DialogueVoiceAsset): void {
    const idRow = el("div", "dlg-readonly");
    idRow.textContent = `Voice id: ${voice.id}`;
    this.formHost.append(idRow);

    this.formHost.append(
      field(
        "Name",
        textInput(voice.name, (v) => {
          voice.name = v;
          this.onEdited();
        }),
      ),
      field(
        "Display name",
        textInput(voice.displayName ?? "", (v) => {
          setOpt(voice, "displayName", v);
          this.onEdited();
        }, "Shown on the subtitle (defaults to name)"),
      ),
      field(
        "Actor binding",
        textInput(voice.actorId ?? "", (v) => {
          setOpt(voice, "actorId", v);
          this.onEdited();
        }, "Optional scene actor/character id"),
      ),
      field(
        "Gender",
        selectInput(GENDER_OPTIONS, voice.gender ?? "neutral", (v) => {
          voice.gender = v as NonNullable<DialogueVoiceAsset["gender"]>;
          this.onEdited();
        }),
      ),
      field(
        "Plurality",
        selectInput(PLURALITY_OPTIONS, voice.plurality ?? "", (v) => {
          if (v === "") delete voice.plurality;
          else voice.plurality = v as NonNullable<DialogueVoiceAsset["plurality"]>;
          this.onEdited();
        }),
      ),
      field(
        "Locale hints",
        textInput((voice.localeHints ?? []).join(", "), (v) => {
          const hints = v
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (hints.length > 0) voice.localeHints = hints;
          else delete voice.localeHints;
          this.onEdited();
        }, "Comma-separated, e.g. en, tr"),
      ),
    );
  }

  private renderLineForm(line: DialogueLineAsset): void {
    const idRow = el("div", "dlg-readonly");
    idRow.textContent = `Line id: ${line.id}`;
    this.formHost.append(idRow);

    // Shared datalist of known voice ids for speaker/target inputs.
    const datalist = el("datalist");
    datalist.id = "dlg-voice-ids";
    for (const voice of this.voiceSuggestions) {
      const optionEl = el("option");
      optionEl.value = voice.id;
      optionEl.textContent = voice.name;
      datalist.append(optionEl);
    }
    this.formHost.append(datalist);

    this.formHost.append(
      field(
        "Spoken text",
        textArea(line.spokenText, (v) => {
          line.spokenText = v;
          this.onEdited();
        }, "The canonical script line"),
      ),
      field(
        "Subtitle override",
        textArea(line.subtitleText ?? "", (v) => {
          setOpt(line, "subtitleText", v);
          this.onEdited();
        }, "Defaults to spoken text"),
      ),
      field(
        "Voice actor direction",
        textArea(line.voiceActorDirection ?? "", (v) => {
          setOpt(line, "voiceActorDirection", v);
          this.onEdited();
        }, "Delivery notes (not shown in game)"),
      ),
    );

    const matureRow = el("label", "dlg-field dlg-field--inline");
    const matureBox = el("input");
    matureBox.type = "checkbox";
    matureBox.checked = line.mature === true;
    matureBox.addEventListener("change", () => {
      if (matureBox.checked) line.mature = true;
      else delete line.mature;
      this.onEdited();
    });
    const matureLabel = el("span", "dlg-field-label");
    matureLabel.textContent = "Mature content";
    matureRow.append(matureBox, matureLabel);
    this.formHost.append(matureRow);

    const ctxHeader = el("div", "dlg-contexts-header");
    const ctxTitle = el("span", "dlg-section-title");
    ctxTitle.textContent = "Context mappings";
    const addBtn = el("button", "dlg-add-btn");
    addBtn.type = "button";
    addBtn.textContent = "+ Add context";
    addBtn.addEventListener("click", () => {
      line.contexts.push({ speakerVoiceId: "" });
      this.renderContexts(line);
      this.onEdited();
    });
    ctxHeader.append(ctxTitle, addBtn);
    this.formHost.append(ctxHeader);

    const ctxHost = el("div", "dlg-contexts");
    ctxHost.dataset.dlgContexts = "";
    this.formHost.append(ctxHost);
    this.renderContexts(line);
  }

  private renderContexts(line: DialogueLineAsset): void {
    const host = this.formHost.querySelector<HTMLElement>("[data-dlg-contexts]");
    if (!host) return;
    host.textContent = "";
    if (line.contexts.length === 0) {
      const empty = el("div", "dlg-contexts-empty");
      empty.textContent = "No context mappings — this line shows as subtitle-only.";
      host.append(empty);
      return;
    }
    line.contexts.forEach((context, index) => {
      host.append(this.renderContextRow(line, context, index));
    });
  }

  private renderContextRow(
    line: DialogueLineAsset,
    context: DialogueContextMapping,
    index: number,
  ): HTMLElement {
    const row = el("div", "dlg-context");

    const head = el("div", "dlg-context-head");
    const title = el("span", "dlg-context-title");
    title.textContent = `Context ${index + 1}`;
    const previewBtn = el("button", "dlg-context-preview");
    previewBtn.type = "button";
    previewBtn.textContent = "▶";
    previewBtn.title = "Bu bağlamı önizle";
    previewBtn.addEventListener("click", () => void this.previewContext(line, context));
    const removeBtn = el("button", "dlg-context-remove");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.title = "Remove context";
    removeBtn.addEventListener("click", () => {
      line.contexts.splice(index, 1);
      this.renderContexts(line);
      this.onEdited();
    });
    head.append(title, previewBtn, removeBtn);
    row.append(head);

    const speakerInput = textInput(context.speakerVoiceId, (v) => {
      context.speakerVoiceId = v.trim();
      this.onEdited();
    }, "Speaker voice id");
    speakerInput.setAttribute("list", "dlg-voice-ids");
    row.append(field("Speaker", speakerInput));

    const targetInput = textInput((context.targetVoiceIds ?? []).join(", "), (v) => {
      const ids = v
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (ids.length > 0) context.targetVoiceIds = ids;
      else delete context.targetVoiceIds;
      this.onEdited();
    }, "Listener voice ids (comma-separated)");
    targetInput.setAttribute("list", "dlg-voice-ids");
    row.append(field("Targets", targetInput));

    row.append(
      field(
        "Locale",
        textInput(context.locale ?? "", (v) => {
          setOpt(context, "locale", v);
          this.onEdited();
        }, "e.g. en (blank = any)"),
      ),
    );

    const type = context.audioSourceType ?? "sound";
    row.append(
      field(
        "Audio type",
        selectInput(SOURCE_TYPE_OPTIONS, type, (v) => {
          context.audioSourceType = v as NonNullable<DialogueContextMapping["audioSourceType"]>;
          this.renderContexts(line); // repopulate the source picker for the new type
          this.onEdited();
        }),
      ),
    );

    const audioOptions = [
      { value: "", label: "— (subtitle only)" },
      ...(this.options.audioAssets ?? [])
        .filter((asset) => asset.assetType === type)
        .map((asset) => ({ value: asset.id, label: asset.name })),
    ];
    row.append(
      field(
        "Audio source",
        selectInput(audioOptions, context.audioSourceId ?? "", (v) => {
          if (v === "") delete context.audioSourceId;
          else context.audioSourceId = v;
          this.onEdited();
        }),
      ),
    );

    row.append(
      field(
        "Localization key",
        textInput(context.localizationKey ?? "", (v) => {
          setOpt(context, "localizationKey", v);
          this.onEdited();
        }, "e.g. dialogue.welcome"),
      ),
    );

    return row;
  }

  // ─── Validation panel ──────────────────────────────────────────────────────

  private refreshWarnings(): void {
    const issues = this.collectIssues();
    this.warningsHost.textContent = "";
    if (issues.length === 0) {
      const ok = el("div", "dlg-warning dlg-warning--ok");
      ok.textContent = "No issues.";
      this.warningsHost.append(ok);
      return;
    }
    for (const issue of issues) {
      const item = el("div", `dlg-warning dlg-warning--${issue.tone}`);
      item.textContent = issue.message;
      this.warningsHost.append(item);
    }
  }

  private collectIssues(): Array<{ message: string; tone: "warning" | "error" }> {
    const issues: Array<{ message: string; tone: "warning" | "error" }> = [];
    if (this.options.mode === "voice" && this.voice) {
      for (const message of validateDialogueVoice(this.voice)) issues.push({ message, tone: "error" });
      return issues;
    }
    const line = this.line;
    if (!line) return issues;

    const voiceIds = new Set(this.voiceSuggestions.map((v) => v.id));
    for (const message of validateDialogueLine(line, { voiceIds })) {
      issues.push({ message, tone: "error" });
    }
    // Soft, author-facing warnings beyond structural validity.
    if (!line.subtitleText) {
      issues.push({ message: "No subtitle override — spoken text will be shown.", tone: "warning" });
    }
    const audioAssetIds = new Set((this.options.audioAssets ?? []).map((a) => a.id));
    line.contexts.forEach((context, index) => {
      if (!context.audioSourceId) {
        issues.push({ message: `Context ${index + 1}: no audio (subtitle-only).`, tone: "warning" });
      } else if (!audioAssetIds.has(context.audioSourceId)) {
        issues.push({
          message: `Context ${index + 1}: audio "${context.audioSourceId}" is not in the project.`,
          tone: "error",
        });
      }
    });
    return issues;
  }

  // ─── Preview ───────────────────────────────────────────────────────────────

  private async preview(): Promise<void> {
    if (!this.line) return;
    const context = this.line.contexts[0] ?? { speakerVoiceId: "" };
    await this.previewContext(this.line, context);
  }

  private async previewContext(
    line: DialogueLineAsset,
    context: DialogueContextMapping,
  ): Promise<void> {
    this.stopPreview();
    const resolved = resolveDialogueLine(line, {
      ...(context.speakerVoiceId ? { speakerVoiceId: context.speakerVoiceId } : {}),
      ...(context.locale ? { locale: context.locale } : {}),
    });
    const estimated = estimateSubtitleDurationSeconds(resolved.subtitleText);
    this.showSubtitleStrip(resolved.subtitleText, estimated, Boolean(resolved.audioSourceId));

    if (!resolved.audioSourceId) {
      this.setStatus(`Subtitle only — ~${estimated.toFixed(1)}s estimated.`, "info");
      return;
    }
    const asset = (this.options.audioAssets ?? []).find((a) => a.id === resolved.audioSourceId);
    if (!asset) {
      this.setStatus(`Audio "${resolved.audioSourceId}" is not in the project.`, "warning");
      return;
    }
    const ctx = this.audioCtx();
    if (!ctx) {
      this.setStatus("Web Audio not available.", "error");
      return;
    }
    void ctx.resume().catch(() => undefined);

    if (resolved.audioSourceType === "soundCue") {
      await this.previewCue(ctx, asset);
    } else {
      void this.playBuf(ctx, projectFileUrl(asset.path), 1, 1, false);
      this.setStatus(`Previewing "${asset.name}".`, "info");
    }
  }

  private async previewCue(ctx: AudioContext, asset: DialogueAudioOption): Promise<void> {
    const cue = await this.loadCue(asset.path);
    if (!cue) {
      this.setStatus(`Could not load Sound Cue "${asset.name}".`, "warning");
      return;
    }
    const events = evaluateSoundCue(cue);
    if (events.length === 0) {
      this.setStatus("Sound Cue has no connected sources.", "warning");
      return;
    }
    const sounds = (this.options.audioAssets ?? []).filter((a) => a.assetType === "sound");
    let missing = 0;
    for (const ev of events) {
      const clip = sounds.find((a) => a.id === ev.clipId);
      if (!clip) {
        missing += 1;
        continue;
      }
      const url = projectFileUrl(clip.path);
      const play = (): void => void this.playBuf(ctx, url, ev.volume, ev.pitch, ev.loop);
      if (ev.delaySeconds > 0) this.previewTimers.push(setTimeout(play, ev.delaySeconds * 1000));
      else play();
    }
    this.setStatus(
      missing > 0
        ? `Previewing cue (${missing} clip(s) missing).`
        : `Previewing cue "${asset.name}".`,
      missing > 0 ? "warning" : "info",
    );
  }

  private loadCue(path: string): Promise<SoundCueAsset | null> {
    let pending = this.cueCache.get(path);
    if (!pending) {
      pending = fetch(projectFileUrl(path), { cache: "no-cache" })
        .then((r) => (r.ok ? (r.json() as Promise<SoundCueAsset>) : null))
        .catch(() => null);
      this.cueCache.set(path, pending);
    }
    return pending;
  }

  private showSubtitleStrip(text: string, seconds: number, hasAudio: boolean): void {
    this.subtitleStrip.textContent = "";
    const line = el("div", "dlg-subtitle-line");
    line.textContent = text;
    const meta = el("div", "dlg-subtitle-meta");
    meta.textContent = hasAudio ? `audio + subtitle` : `subtitle only · ~${seconds.toFixed(1)}s`;
    this.subtitleStrip.append(line, meta);
  }

  private async playBuf(
    ctx: AudioContext,
    url: string,
    vol: number,
    pitch: number,
    loop: boolean,
  ): Promise<void> {
    const buf = await this.fetchBuf(ctx, url);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.playbackRate.value = Math.max(0.01, pitch);
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, vol);
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    this.previewSources.push(src);
    src.onended = () => {
      const i = this.previewSources.indexOf(src);
      if (i >= 0) this.previewSources.splice(i, 1);
    };
  }

  private fetchBuf(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
    let pending = this.previewBuffers.get(url);
    if (!pending) {
      pending = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .catch(() => null);
      this.previewBuffers.set(url, pending);
    }
    return pending;
  }

  private stopPreview(): void {
    for (const timer of this.previewTimers) clearTimeout(timer);
    this.previewTimers = [];
    for (const src of this.previewSources) {
      try {
        src.stop();
      } catch {
        // already ended
      }
    }
    this.previewSources = [];
  }

  private audioCtx(): AudioContext | null {
    if (this.previewCtx) return this.previewCtx;
    const Ctor =
      globalThis.AudioContext ??
      ((globalThis as Record<string, unknown>)["webkitAudioContext"] as typeof AudioContext | undefined);
    if (!Ctor) return null;
    this.previewCtx = new Ctor();
    return this.previewCtx;
  }

  // ─── Save / lifecycle ──────────────────────────────────────────────────────

  private onEdited(): void {
    this.markDirty();
    this.refreshWarnings();
  }

  private async save(): Promise<void> {
    try {
      this.setStatus("Saving…");
      if (this.options.mode === "voice" && this.voice) {
        await saveDialogueVoiceAsset(this.options.path, this.voice);
      } else if (this.line) {
        await saveDialogueLineAsset(this.options.path, this.line);
      }
      this.saveBtn.classList.remove("is-dirty");
      this.setStatus("Saved.", "success");
      this.options.onSaved?.();
    } catch (error) {
      this.setStatus(`Save failed: ${describeError(error)}`, "error");
    }
  }

  private setStatus(message: string, tone?: StatusTone): void {
    this.statusEl.textContent = message;
    this.statusEl.dataset.tone = tone ?? "";
    this.options.onStatus?.(message, tone);
  }

  private markDirty(): void {
    this.saveBtn.classList.add("is-dirty");
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopPreview();
    void this.previewCtx?.close().catch(() => undefined);
    this.previewCtx = null;
    this.previewBuffers.clear();
    this.overlay.remove();
    if (DialogueEditor.activeInstance === this) DialogueEditor.activeInstance = null;
  }
}
