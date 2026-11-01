import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { cleanupSmokeProject, prepareSmokeProject, smokeRunRoot, REPO_ROOT, SMOKE_PORT } from "./smokeProject.mjs";

const root = smokeRunRoot();
let server;
try {
  await prepareSmokeProject(root);
  // Select the disposable data/source root explicitly; application sources stay
  // in Forge. No process-wide cwd mutation is needed for authoring isolation.
  process.env.FORGE_PROJECT_ROOT = root;
  server = await createServer({
    configFile: resolve(REPO_ROOT, "vite.config.ts"),
    root: REPO_ROOT,
    publicDir: resolve(root, "public"),
    cacheDir: resolve(root, "vite-cache"),
    // A test must finish against the modules its page loaded, even when another
    // editor session changes source files. Reloads under test remain explicit.
    server: { host: "127.0.0.1", port: SMOKE_PORT, strictPort: true, hmr: false },
  });
  await writeFile(resolve(root, "server.json"), JSON.stringify({ root, pid: process.pid }), "utf8");
  await server.listen();
  server.printUrls();
} catch (error) {
  await server?.close();
  await cleanupSmokeProject(root);
  throw error;
}

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  process.exit(0);
}
process.on("SIGTERM", () => { void close(); });
process.on("SIGINT", () => { void close(); });
