import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createServer, loadConfigFromFile } from "vite";
import { scanImportBoundaries } from "../builder/web/verify-imports.mjs";
import { buildGameProject, previewGameProject } from "../builder/web/game-project-build.mjs";
import { reproduceGameBuild } from "../builder/web/game-project-reproduce.mjs";

const forgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Load the exact same project selection/entry aliases used by the dev server. */
export async function projectConfig(projectRoot) {
  const previous = process.env.FORGE_PROJECT_ROOT;
  process.env.FORGE_PROJECT_ROOT = resolve(projectRoot);
  try {
    const loaded = await loadConfigFromFile({ command: "serve", mode: "development" }, resolve(forgeRoot, "vite.config.ts"));
    if (!loaded) throw new Error("Forge config could not be loaded");
    return loaded.config;
  } finally {
    if (previous === undefined) delete process.env.FORGE_PROJECT_ROOT;
    else process.env.FORGE_PROJECT_ROOT = previous;
  }
}

export async function checkGameProject(projectRoot, config = undefined) {
  config ??= await projectConfig(projectRoot);
  const base = ts.readConfigFile(resolve(forgeRoot, "tsconfig.json"), ts.sys.readFile);
  if (base.error) throw new Error(ts.flattenDiagnosticMessageText(base.error.messageText, "\n"));
  const raw = base.config;
  const paths = { ...raw.compilerOptions.paths, "*": ["node_modules/*", "node_modules/@types/*"] };
  paths["three"] = ["node_modules/@types/three/index.d.ts"];
  paths["three/*"] = ["node_modules/@types/three/*"];
  for (const name of ["@forge-game/module", "@forge-game/editor-catalog"]) {
    paths[name] = [config.resolve.alias[name]];
  }
  const parsed = ts.parseJsonConfigFileContent({
    ...raw,
    compilerOptions: { ...raw.compilerOptions, paths },
    include: [...raw.include, resolve(projectRoot, "src/**/*.ts")],
  }, ts.sys, forgeRoot);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => forgeRoot, getCanonicalFileName: (name) => name, getNewLine: () => "\n",
    }));
  }
  const boundaries = await scanImportBoundaries(projectRoot);
  if (boundaries.violations.length) throw new Error(`Game import boundary violation: ${JSON.stringify(boundaries.violations)}`);
  console.log(`[game-project] TypeScript and import boundaries passed: ${projectRoot}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!["check", "dev", "build", "preview", "verify-build"].includes(command)) throw new Error("Usage: run-game-project.mjs <check|dev|build|preview|verify-build> --project <root> [--port <port>] [--base /]");
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--project", "--port", "--base"].includes(args[i]) || !args[i + 1]) throw new Error(`Invalid option: ${args[i]}`);
    options.set(args[i], args[i + 1]);
  }
  if (!options.has("--project")) throw new Error("--project is required");
  const projectRoot = resolve(options.get("--project"));
  if (command === "verify-build") return reproduceGameBuild(projectRoot);
  const port = Number(options.get("--port") ?? (command === "preview" ? 4175 : 5175));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid server port");
  if (command === "preview") {
    const server = await previewGameProject(projectRoot, port);
    const close = () => server.httpServer.close(() => process.exit(0));
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
    return;
  }
  const config = await projectConfig(projectRoot);
  if (command === "check") return checkGameProject(projectRoot, config);
  if (command === "build") {
    await checkGameProject(projectRoot, config);
    return buildGameProject(projectRoot, { forgeRoot, config, base: options.get("--base") ?? "/" });
  }
  const server = await createServer({
    ...config,
    configFile: false,
    cacheDir: resolve(projectRoot, ".forge/vite-cache"),
    server: { ...config.server, host: "127.0.0.1", port, strictPort: true },
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  try {
    await server.listen();
  } catch (error) {
    await server.close();
    throw error;
  }
  console.log(`[game-project] Forge: ${forgeRoot}\n[game-project] Game: ${projectRoot}`);
  server.printUrls();
  console.log(`[game-project] Editor: http://127.0.0.1:${port}/?editor`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
