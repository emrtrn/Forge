/** Test-only host: the real Terrain level and runtime; a vehicle driven out of a Lake. */
import type { PhysicsSubsystem } from "@engine/physics/physicsSubsystem";
import { sharedTerrainDeformation } from "@engine/render-three/terrain/terrainDeformation";
import { createForgeRuntime } from "@/scene/ForgeRuntime";
import { createDefaultRuntimeModules } from "@/scene/capabilities/defaultRuntimeModules";
import { terrainDeformationService, terrainSurfaceHostService } from "@/scene/capabilities/runtimeServiceKeys";
import type { RuntimeServices } from "@/scene/capabilities/RuntimeServices";
import { createGameModule } from "@/game/gameModule";

async function boot() {
  let services: RuntimeServices | null = null;
  const forge = await createForgeRuntime({
    canvas: document.querySelector<HTMLCanvasElement>("#game-canvas")!,
    modules: [...createDefaultRuntimeModules(), { id: "wet-trail-qa", onRuntimeStart(host) { services = host; } }],
    gameModules: [createGameModule()],
  });
  await forge.loadLevel("assets/starter-content/Levels/Terrain.level.json");
  const physics = (forge.app as unknown as { physicsSubsystem: PhysicsSubsystem }).physicsSubsystem;
  const id = physics.vehicleEntityIds()[0]!;
  const host = () => (services as RuntimeServices | null)?.resolve(terrainSurfaceHostService);
  /** Inside a Lake's connected water at X/Z (any depth). */
  const wetAt = (x: number, z: number) => host()?.waterDepthAt?.(x, -1000, z) != null;
  /** March from `from` toward `to`; the last wet point and the unit direction. */
  const findShore = (from: [number, number], to: [number, number]) => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const dir: [number, number] = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
    let last: [number, number] | null = null;
    for (let d = 0; d <= length; d += 0.25) {
      const p: [number, number] = [from[0] + dir[0] * d, from[1] + dir[1] * d];
      if (wetAt(p[0], p[1])) last = p; else if (last) break;
    }
    return { shore: last, dir, seedWet: wetAt(from[0], from[1]) };
  };
  const place = (x: number, y: number, z: number, dir: [number, number]) => {
    const yaw = Math.atan2(dir[0], dir[1]) * 180 / Math.PI;
    physics.resetVehicle(id, { position: [x, y, z], rotation: [0, yaw, 0], scale: [1, 1, 1] });
  };
  const push = (kmh: number, dir: [number, number]) => {
    const motion = physics.vehicleMotion(id)!;
    const mass = physics.vehicleDefinition(id)!.massKg;
    const v = kmh / 3.6;
    physics.applyImpulse(id, [(dir[0] * v - motion.linearVelocity[0]) * mass, 0, (dir[1] * v - motion.linearVelocity[2]) * mass]);
  };
  const read = () => {
    const state = physics.vehicleState(id)!;
    const snapshot = (services as RuntimeServices | null)?.resolve(terrainDeformationService)?.snapshot() ?? null;
    return {
      speed: state.forwardSpeed,
      wheels: state.wheels.map((wheel) => ({
        contact: wheel.inContact, ground: wheel.groundEntityId, point: wheel.contactPoint,
        water: wheel.contactPoint ? host()?.waterDepthAt?.(...wheel.contactPoint) ?? null : null,
        shore: wheel.contactPoint ? host()?.groundWetnessAt?.(...wheel.contactPoint) ?? 0 : 0,
      })),
      wetTrailCells: snapshot?.wetTrailCells ?? null, activeCells: snapshot?.activeCells ?? null,
      hasWaterQuery: typeof host()?.waterDepthAt === "function",
    };
  };
  /** Wet print (0..255) in the track texture's B channel at world X/Z, or null off the window. */
  const textureWet = (x: number, z: number) => {
    const texture = sharedTerrainDeformation();
    const window = texture.trackWindow();
    const image = (texture.uniforms.uDeformTex!.value as { image: { data: Uint8Array; width: number } } | null)?.image;
    if (!window || !image) return null;
    const n = image.width, cell = window.size / n;
    const mod = (v: number) => ((v % n) + n) % n;
    return image.data[(mod(Math.floor(z / cell)) * n + mod(Math.floor(x / cell))) * 4 + 2]!;
  };
  Object.assign(window, { wetTrailQA: { read, findShore, place, push, textureWet, wetAt } });
  forge.start();
  const label = document.querySelector("#debug-stats")!;
  const update = () => { label.textContent = JSON.stringify(read(), null, 2); requestAnimationFrame(update); };
  update();
}
void boot().catch((error) => { console.error(error); document.body.dataset.error = String(error); });
