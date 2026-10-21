import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { resolve } from "node:path";
import { cleanupSmokeProject, smokeRunRoot } from "./smokeProject.mjs";

export default async function globalTeardown() {
  const root = smokeRunRoot();
  const server = await readFile(resolve(root, "server.json"), "utf8").then(JSON.parse).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  // Stop only the server recorded by this run. Releasing its cwd first also
  // allows Windows to remove the entire isolated project directory.
  if (server?.root === root && Number.isInteger(server.pid) && server.pid > 0 && server.pid !== process.pid) {
    try { process.kill(server.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(server.pid, 0); } catch (error) {
        if (error.code === "ESRCH") break;
        throw error;
      }
      await setTimeout(50);
    }
  }
  await cleanupSmokeProject(root);
}
