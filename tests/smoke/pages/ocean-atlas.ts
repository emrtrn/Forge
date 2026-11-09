import { Camera, FloatType, GLSL3, Mesh, NoToneMapping, PlaneGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderer, WebGLRenderTarget } from "three";
import { CooperativeWork, finishWork } from "../../../engine/core/cooperativeWork";
import { createOceanCoverageStorage, packOceanCoverage } from "../../../engine/terrain/oceanCoverageStorage";
import { createOceanCoverageTexture, OCEAN_COVERAGE_SAMPLE_GLSL, uploadOceanCoverage } from "../../../engine/render-three/ocean/oceanCoverageTexture";

const renderer = new WebGLRenderer({ canvas: document.querySelector("canvas")! });
renderer.setSize(64, 64); renderer.toneMapping = NoToneMapping;
async function probe() {
  const nx = 1024, nz = 1024, storage = createOceanCoverageStorage(nx, nz), flags = new Uint8Array(nx * nz);
  for (let i = 0; i < storage.heights.length; i++) storage.heights[i] = i * .25 - 400000;
  for (let i = 0; i < flags.length; i++) flags[i] = ((i >> 3) >> ((i & 7) * 2)) & 3;
  finishWork(packOceanCoverage(storage, flags));
  const texture = createOceanCoverageTexture(storage), camera = new Camera(), scene = new Scene();
  const material = new ShaderMaterial({ glslVersion: GLSL3, uniforms: { atlas: { value: texture }, offset: { value: new Vector2() } },
    vertexShader: "void main(){gl_Position=vec4(position.xy,0.,1.);}", fragmentShader:
      "uniform sampler2D atlas;uniform vec2 offset;out vec4 result;" + OCEAN_COVERAGE_SAMPLE_GLSL
      + "void main(){vec2 bedSample=oceanCoverageSample(atlas,ivec2(1024),gl_FragCoord.xy-vec2(.5)+offset);result=vec4(bedSample,0.,1.);}" });
  const geometry = new PlaneGeometry(2, 2); scene.add(new Mesh(geometry, material));
  const target = new WebGLRenderTarget(nx, nz, { type: FloatType }), previous = renderer.getRenderTarget();
  const gl = renderer.getContext() as WebGL2RenderingContext, originalUpload = gl.texSubImage2D;
  let calls = 0, maxUploadBytes = 0;
  gl.texSubImage2D = function (...args: unknown[]) {
    calls++; const payload = args.at(-1); if (ArrayBuffer.isView(payload)) maxUploadBytes = Math.max(maxUploadBytes, payload.byteLength);
    return Reflect.apply(originalUpload, gl, args);
  } as typeof gl.texSubImage2D;
  const pixels = new Float32Array(nx * nz * 4); let mismatches = 0, samples = 0;
  try {
    renderer.setRenderTarget(target);
    await uploadOceanCoverage(renderer, texture, new CooperativeWork());
    const targetPreserved = renderer.getRenderTarget() === target;
    const uploadCalls = calls;
    for (const upper of [false, true]) {
      const fraction = upper ? .75 : .25;
      material.uniforms.offset!.value.setScalar(fraction);
      renderer.setRenderTarget(target); renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, nx, nz, pixels);
      for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
        const i = z * nx + x, expectedBed = Math.fround(((z + fraction) * (nx + 1) + x + fraction) * .25 - 400000);
        if (pixels[i * 4] !== expectedBed || pixels[i * 4 + 1] !== ((flags[i]! & (upper ? 2 : 1)) ? 1 : 0)) mismatches++;
        samples++;
      }
    }
    const repeatUploadCalls = calls - uploadCalls;
    const aborted = createOceanCoverageTexture(storage), aborter = new AbortController(); let yields = 0, cancelled = false;
    try {
      await uploadOceanCoverage(renderer, aborted, new CooperativeWork({ signal: aborter.signal, budgetMs: 0,
        yieldTask: async () => { if (++yields === 2) aborter.abort(); } }));
    } catch (error) { cancelled = (error as Error).name === "AbortError"; }
    finally { aborted.dispose(); }
    return { samples, mismatches, uploadCalls, repeatUploadCalls, maxUploadBytes, cancelled, targetPreserved, glError: gl.getError(),
      atlasBytes: storage.data.byteLength, dimensions: [storage.width, storage.height], maxTextures: renderer.capabilities.maxTextures };
  } finally {
    gl.texSubImage2D = originalUpload; renderer.setRenderTarget(previous); texture.dispose(); target.dispose(); material.dispose(); geometry.dispose();
  }
}
const lab = { probe, dispose: () => renderer.dispose() };
declare global { interface Window { __oceanAtlas: typeof lab } }
window.__oceanAtlas = lab;
