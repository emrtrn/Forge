/** Test-only host: real LandscapeTest and runtime, with a repeatable entry velocity. */
import type { PhysicsSubsystem } from "@engine/physics/physicsSubsystem";
import { createForgeRuntime } from "@/scene/ForgeRuntime";
import { createDefaultRuntimeModules } from "@/scene/capabilities/defaultRuntimeModules";
import { terrainDeformationService } from "@/scene/capabilities/runtimeServiceKeys";
import type { RuntimeServices } from "@/scene/capabilities/RuntimeServices";
import { createGameModule } from "@/game/gameModule";

async function boot() {
  let services: RuntimeServices | null = null;
  const forge = await createForgeRuntime({
    canvas: document.querySelector<HTMLCanvasElement>("#game-canvas")!,
    modules: [...createDefaultRuntimeModules(), { id: "soft-ground-qa", onRuntimeStart(host) { services = host; } }],
    gameModules: [createGameModule()],
  });
  await forge.loadLevel("assets/starter-content/Levels/LandscapeTest.level.json");
  // Keep entry-velocity injection entirely in the test host, with no debug API
  // or new save/motion contract in the production runtime.
  const physics = (forge.app as unknown as { physicsSubsystem: PhysicsSubsystem }).physicsSubsystem;
  let seconds = 0;
  physics.onFixedStep((dt) => { seconds += dt; });
  const id = physics.vehicleEntityIds()[0]!;
  const read = () => {
    const state = physics.vehicleState(id)!;
    const tracks = (services as RuntimeServices | null)?.resolve(terrainDeformationService)?.snapshot();
    return { seconds, speed: state.forwardSpeed, sinks: state.wheels.map((wheel) => wheel.sinkDepth ?? 0),
      forces: state.wheels.map((wheel) => wheel.groundResistanceForce ?? 0),
      slip: state.wheels.map((wheel) => wheel.tractionSlip ?? 0),
      grounds: state.wheels.map((wheel) => wheel.groundEntityId),
      contacts: state.wheels.filter((wheel) => wheel.inContact).length, tracks: tracks?.activeCells ?? 0 };
  };
  const enter = (kmh: number) => {
    const motion = physics.vehicleMotion(id)!;
    const mass = physics.vehicleDefinition(id)!.massKg;
    physics.applyImpulse(id, [-motion.linearVelocity[0] * mass, 0, (kmh / 3.6 - motion.linearVelocity[2]) * mass]);
  };
  Object.assign(window, { softGroundQA: { read, enter } });
  forge.start();
  const label = document.querySelector("#debug-stats")!;
  const update = () => { label.textContent = JSON.stringify(read(), null, 2); requestAnimationFrame(update); };
  update();
}
void boot().catch((error) => { console.error(error); document.body.dataset.error = String(error); });
