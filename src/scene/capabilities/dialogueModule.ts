/**
 * Layer 2 capability: Dialogue & Voice — barks, subtitles and conversations.
 *
 * Owns everything that used to be baked into `RuntimeSceneApp` for dialogue:
 * the {@link DialogueSubsystem}, the {@link ConversationDirector}, the two DOM
 * overlays (subtitle line + choice panel), the manifest registration of
 * `dialogueVoice` / `dialogueLine` / `conversation` assets, and the
 * `play-dialogue` / `start-conversation` script-message triggers.
 *
 * Everything it needs from outside is resolved from the service container, and
 * every one of those is optional:
 *   - no script-message bus → nothing can trigger a line (a game with no
 *     behavior scripts simply never speaks);
 *   - no dialogue audio → subtitles still show, timed by their text-length
 *     estimate;
 *   - no localization → the authored text is used as written.
 * Switching this module off removes dialogue playback only; the level's actors,
 * audio assets and scripts (Layer 1 + the rest of Layer 2) are untouched.
 */
import { assetPath, assetType, type AssetManifest } from "@engine/assets/manifest";
import { ConversationDirector } from "@engine/dialogue/conversationDirector";
import { isConversationAsset } from "@engine/dialogue/conversationTypes";
import { DialogueSubsystem } from "@engine/dialogue/dialogueSubsystem";
import {
  isDialogueLineAsset,
  isDialogueVoiceAsset,
  type DialoguePlayContext,
} from "@engine/dialogue/dialogueTypes";
import { projectFileUrl } from "@/project/ProjectSystem";

import { ConversationOverlay } from "../conversationOverlay";
import { SubtitleOverlay } from "../subtitleOverlay";
import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeServices } from "./RuntimeServices";
import {
  dialogueAudioService,
  scriptMessageBusService,
  localizationService,
} from "./runtimeServiceKeys";

export const DIALOGUE_MODULE_ID = "dialogue";

/** Mounts an overlay into `#ui-overlay`, or null in a host without one. */
function uiOverlayHost(): HTMLElement | null {
  return typeof document !== "undefined" ? document.getElementById("ui-overlay") : null;
}

export function createDialogueModule(): CapabilityModule {
  let dialogue: DialogueSubsystem | null = null;
  let director: ConversationDirector | null = null;
  let subtitleOverlay: SubtitleOverlay | null = null;
  let conversationOverlay: ConversationOverlay | null = null;
  /** Script-message triggers for the current level; re-subscribed on every load. */
  let triggers: (() => void)[] = [];

  function releaseTriggers(): void {
    for (const unsubscribe of triggers) unsubscribe();
    triggers = [];
  }

  /**
   * Registers every `dialogueVoice` / `dialogueLine` / `conversation` asset in
   * the manifest. Conversations are re-registered fresh per level (the director
   * drops any running conversation and its stale registrations first).
   */
  async function loadDialogueAssets(manifest: AssetManifest): Promise<void> {
    director?.clear();
    await Promise.all(
      manifest.assets.map(async (asset) => {
        const kind = assetType(asset);
        if (kind !== "dialogueVoice" && kind !== "dialogueLine" && kind !== "conversation") return;
        try {
          const response = await fetch(projectFileUrl(assetPath(asset)), { cache: "no-cache" });
          if (!response.ok) return;
          const data = (await response.json()) as unknown;
          if (kind === "dialogueVoice" && isDialogueVoiceAsset(data)) {
            dialogue?.registerVoice(data);
          } else if (kind === "dialogueLine" && isDialogueLineAsset(data)) {
            dialogue?.registerLine(data);
          } else if (kind === "conversation" && isConversationAsset(data)) {
            director?.register(data);
          }
        } catch {
          // Missing/malformed dialogue asset: skip it (the scene still plays).
        }
      }),
    );
  }

  /**
   * Subscribes the two triggers gameplay uses: `play-dialogue` with a `lineId`
   * (plus optional `speakerVoiceId` / `targetVoiceId` / `locale`) starts a bark,
   * `start-conversation` with a `conversationId` runs a conversation graph.
   */
  function subscribeTriggers(services: RuntimeServices): void {
    const bus = services.resolve(scriptMessageBusService);
    if (!bus) return;
    // A level rebuild clears bus subscriptions, so always re-subscribe fresh.
    releaseTriggers();
    triggers.push(
      bus.subscribe("play-dialogue", (envelope) => {
        const payload = envelope.payload;
        const lineId = typeof payload.lineId === "string" ? payload.lineId : "";
        if (!lineId) return;
        const context: DialoguePlayContext = {};
        if (typeof payload.speakerVoiceId === "string") {
          context.speakerVoiceId = payload.speakerVoiceId;
        }
        if (typeof payload.targetVoiceId === "string") {
          context.targetVoiceId = payload.targetVoiceId;
        }
        if (typeof payload.locale === "string") context.locale = payload.locale;
        dialogue?.playLine(lineId, context);
      }),
      bus.subscribe("start-conversation", (envelope) => {
        const conversationId =
          typeof envelope.payload.conversationId === "string"
            ? envelope.payload.conversationId
            : "";
        if (conversationId) director?.start(conversationId);
      }),
    );
  }

  return {
    id: DIALOGUE_MODULE_ID,

    onRuntimeStart(services) {
      const subtitleHost = uiOverlayHost();
      subtitleOverlay = subtitleHost ? new SubtitleOverlay(subtitleHost) : null;
      const choiceHost = uiOverlayHost();
      conversationOverlay = choiceHost ? new ConversationOverlay(choiceHost) : null;

      dialogue = new DialogueSubsystem({
        playAudio: (request) => services.resolve(dialogueAudioService)?.(request) ?? null,
        // D4 localization: a line's localizationKey resolves against the active
        // `.loc.json` table, read live so a locale switch takes effect. Missing
        // entries fall back to the authored text. Per-locale *audio* stays as
        // context mappings, so no audio lookup is wired here.
        localization: {
          resolveSubtitle: (key) =>
            services.resolve(localizationService)?.resolveSubtitle(key),
        },
        onSubtitleShow: (event) =>
          subtitleOverlay?.show({
            lineId: event.lineId,
            text: event.text,
            ...(event.speakerName ? { speakerName: event.speakerName } : {}),
          }),
        onSubtitleHide: (lineId) => subtitleOverlay?.hide(lineId),
        // Line completion advances a running conversation to its next node.
        onLineEnd: (info) => director?.notifyLineEnd(info.lineId, info.interrupted),
      });

      director = new ConversationDirector({
        playLine: (lineId, context) => dialogue?.playLine(lineId, context),
        stopLine: (lineId) => dialogue?.stopLine(lineId),
        emitEvent: (event) =>
          services
            .resolve(scriptMessageBusService)
            ?.emit(event.eventId, "conversation", event.payload ?? {}),
        showChoices: (view) =>
          conversationOverlay?.show(
            {
              choices: view.choices,
              ...(view.prompt !== undefined ? { prompt: view.prompt } : {}),
            },
            (index) => director?.choose(index),
          ),
        hideChoices: () => conversationOverlay?.hide(),
      });

      // Dialogue is output: it ticks with the other presentation subsystems,
      // after this frame's world is resolved.
      services.addSubsystem("presentation", dialogue);
    },

    async onLevelLoaded(context) {
      await loadDialogueAssets(await context.assetLoader.loadManifest());
      // Subtitles must localize even in a scene with no HUD or menu, where the
      // UI never loads the locale tables.
      await context.resolve(localizationService)?.ensureLoaded();
      if (context.services) subscribeTriggers(context.services);
    },

    onLevelUnloaded() {
      releaseTriggers();
      director?.stop();
    },

    dispose() {
      releaseTriggers();
      director?.stop();
      subtitleOverlay?.dispose();
      conversationOverlay?.dispose();
      subtitleOverlay = null;
      conversationOverlay = null;
      dialogue = null;
      director = null;
    },
  };
}
