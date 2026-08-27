/**
 * Sound Cue evaluator — pure, headless, no Web Audio dependency.
 *
 * Traverses the cue's DAG from the output node inward and produces a flat list
 * of concrete play events. Each event carries a `clipId`, resolved volume/pitch
 * multipliers, a `loop` flag, and an optional `delaySeconds` offset so the host
 * can schedule them with `context.currentTime + delaySeconds`.
 *
 * The `rng` parameter accepts any `() => number` in [0, 1). Pass a seeded PRNG
 * in unit tests to get deterministic results.
 */
import { SOUND_CUE_NODE_KINDS } from "./soundCueTypes";
import type {
  SoundCueAsset,
  SoundCueConnection,
  SoundCueDelayNode,
  SoundCueModulatorNode,
  SoundCueNode,
  SoundCueOutputNode,
  SoundCueRandomNode,
  SoundCueSourceNode,
} from "./soundCueTypes";

/** A single concrete play instruction produced by the evaluator. */
export interface ResolvedPlayEvent {
  clipId: string;
  volume: number;
  pitch: number;
  loop: boolean;
  /** Seconds after trigger time to start this event (0 = immediate). */
  delaySeconds: number;
}

/** Build a map: node ID → list of node IDs that feed into it (incoming edges). */
function buildIncomingMap(connections: SoundCueConnection[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const { from, to } of connections) {
    let list = map.get(to);
    if (!list) {
      list = [];
      map.set(to, list);
    }
    list.push(from);
  }
  return map;
}

function clampPositive(value: number | undefined, fallback: number): number {
  const v = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, v);
}

function clampPitch(value: number | undefined, fallback: number): number {
  const v = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0.01, v);
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

function weightedPick(weights: number[], rng: () => number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let cursor = rng() * total;
  for (let i = 0; i < weights.length - 1; i++) {
    cursor -= weights[i] ?? 0;
    if (cursor <= 0) return i;
  }
  return weights.length - 1;
}

interface EvalCtx {
  nodes: Map<string, SoundCueNode>;
  incoming: Map<string, string[]>;
  rng: () => number;
}

function evalNode(
  nodeId: string,
  volScale: number,
  pitchScale: number,
  delaySeconds: number,
  ctx: EvalCtx,
): ResolvedPlayEvent[] {
  const node = ctx.nodes.get(nodeId);
  if (!node) return [];

  switch (node.kind) {
    case "output":
      // Should not be reached via evalNode (output is the entry point, not recursed into).
      return [];

    case "source": {
      const n = node as SoundCueSourceNode;
      return [
        {
          clipId: n.clipId,
          volume: clampPositive(n.volume, 1) * volScale,
          pitch: clampPitch(n.pitch, 1) * pitchScale,
          loop: n.loop ?? false,
          delaySeconds,
        },
      ];
    }

    case "mixer": {
      const inputs = ctx.incoming.get(node.id) ?? [];
      return inputs.flatMap((id) => evalNode(id, volScale, pitchScale, delaySeconds, ctx));
    }

    case "random": {
      const inputs = ctx.incoming.get(node.id) ?? [];
      if (inputs.length === 0) return [];
      const n = node as SoundCueRandomNode;
      const weights =
        n.weights && n.weights.length === inputs.length ? n.weights : inputs.map(() => 1);
      const idx = weightedPick(weights, ctx.rng);
      const chosen = inputs[idx];
      if (!chosen) return [];
      return evalNode(chosen, volScale, pitchScale, delaySeconds, ctx);
    }

    case "modulator": {
      const n = node as SoundCueModulatorNode;
      const vMin = clampPositive(n.volumeMin, 1);
      const vMax = clampPositive(n.volumeMax, vMin);
      const pMin = clampPitch(n.pitchMin, 1);
      const pMax = clampPitch(n.pitchMax, pMin);
      const vol = lerp(vMin, Math.max(vMin, vMax), ctx.rng()) * volScale;
      const pit = lerp(pMin, Math.max(pMin, pMax), ctx.rng()) * pitchScale;
      const inputs = ctx.incoming.get(node.id) ?? [];
      return inputs.flatMap((id) => evalNode(id, vol, pit, delaySeconds, ctx));
    }

    case "loop": {
      const inputs = ctx.incoming.get(node.id) ?? [];
      return inputs
        .flatMap((id) => evalNode(id, volScale, pitchScale, delaySeconds, ctx))
        .map((e) => ({ ...e, loop: true }));
    }

    case "delay": {
      const n = node as SoundCueDelayNode;
      const dMin = clampPositive(n.secondsMin, 0);
      const dMax = Math.max(dMin, clampPositive(n.secondsMax, dMin));
      const d = delaySeconds + lerp(dMin, dMax, ctx.rng());
      const inputs = ctx.incoming.get(node.id) ?? [];
      return inputs.flatMap((id) => evalNode(id, volScale, pitchScale, d, ctx));
    }
  }
}

/**
 * Evaluates a Sound Cue graph and returns a flat list of concrete play events.
 *
 * Returns an empty list when the cue has no output node or no connected sources.
 *
 * @param cue   - The parsed soundcue.json asset.
 * @param rng   - Random number generator in [0, 1). Defaults to `Math.random`.
 */
/**
 * Structural gate for JSON that claims to be a Sound Cue.
 *
 * {@link evaluateSoundCue} and {@link validateSoundCueGraph} both walk `nodes`,
 * `connections` and `output` without re-checking them, so anything that fails
 * this must never reach them. A hand-edited, truncated or half-written
 * `*.soundcue.json` would otherwise throw out of its caller — and on the
 * runtime's fire-and-forget load path that surfaces as an unhandled rejection
 * (a dead tab) instead of one missing sound.
 *
 * Deliberately shallow: it checks the shape the traversal relies on, not the
 * graph's semantics. `validateSoundCueGraph` is what reports authoring problems
 * in a cue that *is* structurally a cue.
 */
export function isSoundCueAsset(value: unknown): value is SoundCueAsset {
  if (typeof value !== "object" || value === null) return false;
  const cue = value as Partial<SoundCueAsset>;
  if (cue.schema !== 1 || cue.type !== "soundCue") return false;
  if (typeof cue.output !== "object" || cue.output === null) return false;
  if (!Array.isArray(cue.nodes) || !Array.isArray(cue.connections)) return false;
  const kinds = new Set<string>(SOUND_CUE_NODE_KINDS);
  for (const node of cue.nodes) {
    if (typeof node !== "object" || node === null) return false;
    const { id, kind } = node as { id?: unknown; kind?: unknown };
    if (typeof id !== "string" || typeof kind !== "string" || !kinds.has(kind)) return false;
  }
  for (const connection of cue.connections) {
    if (typeof connection !== "object" || connection === null) return false;
    const { from, to } = connection as { from?: unknown; to?: unknown };
    if (typeof from !== "string" || typeof to !== "string") return false;
  }
  return true;
}

export function evaluateSoundCue(
  cue: SoundCueAsset,
  rng: () => number = Math.random,
): ResolvedPlayEvent[] {
  const outputNode = cue.nodes.find((n) => n.kind === "output") as
    | SoundCueOutputNode
    | undefined;
  if (!outputNode) return [];

  const nodes = new Map<string, SoundCueNode>(cue.nodes.map((n) => [n.id, n]));
  const incoming = buildIncomingMap(cue.connections);
  const ctx: EvalCtx = { nodes, incoming, rng };

  const outVol = clampPositive(outputNode.volume ?? cue.output.volume, 1);
  const outPitch = clampPitch(outputNode.pitch ?? cue.output.pitch, 1);

  const inputs = incoming.get(outputNode.id) ?? [];
  return inputs.flatMap((id) => evalNode(id, outVol, outPitch, 0, ctx));
}

/**
 * Validates the structural integrity of a Sound Cue asset and returns a list
 * of human-readable issue strings (empty = valid).
 */
export function validateSoundCueGraph(cue: SoundCueAsset): string[] {
  const issues: string[] = [];
  const nodeIds = new Set(cue.nodes.map((n) => n.id));

  // Must have exactly one output node.
  const outputNodes = cue.nodes.filter((n) => n.kind === "output");
  if (outputNodes.length === 0) issues.push("Missing output node");
  if (outputNodes.length > 1) issues.push("Multiple output nodes");

  // All connection endpoints must reference existing nodes.
  for (const { from, to } of cue.connections) {
    if (!nodeIds.has(from)) issues.push(`Connection references missing node: ${from}`);
    if (!nodeIds.has(to)) issues.push(`Connection references missing node: ${to}`);
  }

  // Source nodes must have a non-empty clipId.
  for (const node of cue.nodes) {
    if (node.kind === "source" && !node.clipId) {
      issues.push(`Source node "${node.id}" has no clipId`);
    }
  }

  // Output node must have at least one incoming connection.
  const outputId = outputNodes[0]?.id;
  if (outputId) {
    const hasInput = cue.connections.some((c) => c.to === outputId);
    if (!hasInput) issues.push("Output node has no connected inputs");
  }

  return issues;
}
