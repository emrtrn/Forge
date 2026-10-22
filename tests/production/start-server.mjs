// Serve built packages without Vite's HTML fallback. Each mount has its own
// origin so a mistaken /assets request cannot succeed against the root build.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const execute = promisify(execFile);
const servers = [];
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".gltf": "model/gltf+json", ".glb": "model/gltf-binary", ".png": "image/png", ".wasm": "application/wasm" };

async function serve(base, port, name) {
  const result = await execute(process.execPath, ["builder/web/build-release.mjs", "--profile", "starter", "--base", base, "--output", name], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  const dist = resolve(root, "builds/release", name);
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (!pathname.startsWith(base)) { response.writeHead(404).end(); return; }
      const suffix = pathname.slice(base.length) || "index.html";
      const path = resolve(dist, suffix);
      if (!path.startsWith(dist + sep) || !(await stat(path)).isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      response.end(await readFile(path));
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 400).end();
    }
  });
  servers.push(server);
  await new Promise((done, fail) => { server.once("error", fail); server.listen(port, "127.0.0.1", done); });
  console.log(`[production-smoke] http://127.0.0.1:${port}${base}`);
}

async function close() {
  await Promise.all(servers.map((server) => new Promise((done) => server.close(done))));
}
process.on("SIGTERM", () => { void close().then(() => process.exit(0)); });
process.on("SIGINT", () => { void close().then(() => process.exit(0)); });

try {
  // Build both before exposing readiness on the first port.
  await serve("/oyunlar/demo/", 5275, "production-subpath");
  await serve("/", 5274, "production-root");
} catch (error) {
  console.error(error);
  await close();
  process.exitCode = 1;
}
