// S4 open-world stress: the S2 terrain scene plus the reference level's real
// static placements (level instances + World Partition cells in load range,
// GLTFLoader) and its Landscape foliage grown by Forge's rules
// (shared/content.ts), drawn in one of the S4 structures (shared/contentRender.ts),
// through the S3 pipeline. Witness adds CPU: the whole rAF callback (main
// thread) and the render submission (`renderer.render` / `pipeline.render`).
// URL: level=<project path>, mode=forge|per-placement|instanced|batched|gpu-cull
// (cullRule=<rule id>, default meadow-grass; noCull=<rule id> draws that rule
// with no culling at all, the G7 reference), config=<post-process>:
//   forge-high (default): Forge WebGL's authored set on `high` - GTAO if the
//     level enables ao, bloom if it enables bloom, SMAA if antialias is smaa;
//     nothing authored -> direct render (G1);
//   balanced / balanced-ssr-half / direct: the S3 rows (G2 / G3).
import { report, startMeasuredLoop } from "../shared/spike";
import { buildTerrainScene } from "../shared/terrainScene";
import { CONFIGS, createPipeline, DEFAULT_BLOOM, type BloomSettings, type PipelineFlags, type SpikePipeline } from "../shared/pipeline";
import { loadLevelContent } from "../shared/content";
import { buildContentView, type ContentMode } from "../shared/contentRender";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const loading = document.querySelector<HTMLElement>(".forge-loading")!;

interface AuthoredPost { ao?: { enabled?: boolean }; antialias?: string; bloom?: { enabled?: boolean; threshold?: number; intensity?: number; radius?: number } }

function authoredBloom(post: AuthoredPost | undefined): BloomSettings | null {
  const b = post?.bloom;
  if (!b || b.enabled !== true) return null;
  return { strength: b.intensity ?? DEFAULT_BLOOM.strength, radius: b.radius ?? DEFAULT_BLOOM.radius, threshold: b.threshold ?? DEFAULT_BLOOM.threshold };
}

/** The pipeline flags for `config`, gated by what the level authors (profiles allow, never force). */
function resolveFlags(config: string, post: AuthoredPost | undefined, bloom: BloomSettings | null): PipelineFlags | null {
  if (config === "forge-high") {
    const flags: PipelineFlags = { gtao: post?.ao?.enabled === true ? "composite" : false, bloom: bloom !== null, smaa: post?.antialias === "smaa" };
    return flags.gtao || flags.bloom || flags.smaa ? flags : null;
  }
  if (!(config in CONFIGS)) throw new Error(`unknown config ${config}`);
  const flags = CONFIGS[config]!;
  return flags && flags.bloom && !bloom ? { ...flags, bloom: false } : flags;
}

async function main(): Promise<void> {
  const mode = (params.get("mode") ?? "forge") as ContentMode;
  const config = params.get("config") ?? "forge-high";
  const ts = await buildTerrainScene(canvas, params, { raiseLimits: { maxColorAttachmentBytesPerSample: 64 } });
  const { spike, renderer, proof, scene, camera, terrain, view, env } = ts;
  renderer.info.autoReset = false;

  const content = await loadLevelContent(ts.assets, ts.levelPath, ts.level, terrain, camera.position);
  const built = performance.now();
  const contentView = buildContentView(renderer, ts.level, content, mode, {
    cullRule: params.get("cullRule") ?? (mode === "gpu-cull" ? "meadow-grass" : undefined),
    noCullRule: params.get("noCull") ?? undefined,
  });
  scene.add(contentView.root);
  const buildMs = performance.now() - built;

  const post = ts.level.postProcess as AuthoredPost | undefined;
  const bloom = authoredBloom(post);
  const flags = resolveFlags(config, post, bloom);
  const pipeline: SpikePipeline | null = flags ? createPipeline(renderer, scene, camera, flags, bloom ?? DEFAULT_BLOOM) : null;

  contentView.update(camera, 0);
  const compileStarted = performance.now();
  await renderer.compileAsync(scene, camera);
  const compileMs = performance.now() - compileStarted;

  const started = performance.now();
  startMeasuredLoop(spike, () => {
    renderer.info.reset();
    ts.update();
    contentView.update(camera, (performance.now() - started) / 1000);
    const r0 = performance.now();
    if (pipeline) pipeline.render();
    else renderer.render(scene, camera);
    return performance.now() - r0;
  }, `s4-${mode}-${config}`);
  await new Promise((res) => setTimeout(res, 500));
  // ?drawTally=1: one frame's real draws (draw parameters not null) by camera and content kind.
  let drawTally: Record<string, number> | null = null;
  if (params.get("drawTally") === "1") {
    await new Promise((res) => setTimeout(res, 3000));
    const backend = renderer.backend as unknown as { draw(renderObject: unknown, info: unknown): void };
    const original = backend.draw.bind(backend);
    const tally: Record<string, number> = {};
    let active = false;
    backend.draw = (renderObject: unknown, info: unknown) => {
      const ro = renderObject as { camera: { isOrthographicCamera?: boolean; isPerspectiveCamera?: boolean; type?: string }; object: { name: string; parent: unknown; isInstancedMesh?: boolean }; getDrawParameters(): unknown };
      if (active && ro.getDrawParameters() !== null) {
        const cam = ro.camera.isOrthographicCamera ? "ortho" : ro.camera.isPerspectiveCamera ? "persp" : (ro.camera.type ?? "other");
        let kind = "other";
        for (let n = ro.object as { name: string; parent: unknown } | null; n; n = n.parent as { name: string; parent: unknown } | null) {
          if (/^foliage-far/.test(n.name)) { kind = "far"; break; }
          if (/^foliage-/.test(n.name)) { kind = "foliage"; break; }
          if (/^static-/.test(n.name)) { kind = "static"; break; }
        }
        tally[`${cam}/${kind}`] = (tally[`${cam}/${kind}`] ?? 0) + 1;
        if (kind === "static") {
          const parent = (ro.object.parent as { name?: string } | null)?.name ?? "?";
          const nk = `${cam}:${parent}`;
          tally[nk] = (tally[nk] ?? 0) + 1;
        }
      }
      original(renderObject, info);
    };
    await new Promise<void>((res) => requestAnimationFrame(() => { active = true; requestAnimationFrame(() => { active = false; backend.draw = original; res(); }); }));
    drawTally = tally;
  }
  loading.hidden = true;
  report("complete", {
    mode: "view", contentMode: mode, config, level: ts.levelPath,
    proof: { backend: proof.backend, isWebGPUBackend: proof.isWebGPUBackend, timestampQuery: proof.timestampQuery },
    loadMs: Math.round(ts.loadedMs), buildMs: Math.round(buildMs), compileMs: Math.round(compileMs),
    readyMs: Math.round(performance.now() - ts.startedAt),
    terrain: { tiles: terrain.tiles.size, resident: view.residentKeys.length }, selection: ts.selection(),
    content: content.describe, view: contentView.describe,
    pipeline: pipeline ? pipeline.describe : { effects: [], direct: true },
    environment: env.describe, canvas: [canvas.width, canvas.height], drawTally,
    skipDebug: params.get("drawTally") === "1" ? contentView.skipDebug(camera) : undefined,
    gpuVisible: await contentView.gpuVisible(camera),
  });
}

main().catch((error: unknown) => {
  loading.hidden = true;
  document.getElementById("out")?.classList.remove("quiet");
  report("failed", { error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) });
});
