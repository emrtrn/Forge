import { createForgeRuntime } from "@/scene/ForgeRuntime";
import { createDefaultRuntimeModules } from "@/scene/capabilities/defaultRuntimeModules";
import { createGameModule } from "@/game/gameModule";
import { installLakeProbe } from "./terrain-lake-probe";
const forge = await createForgeRuntime({ canvas: document.querySelector("canvas")!, modules: createDefaultRuntimeModules(), gameModules: [createGameModule()], debug: false });
await forge.loadLevel("layouts/__playwright-lake-world.level.json");
installLakeProbe(forge.app); forge.start();
