import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { build, preview } from "vite";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const portable = (path) => path.replaceAll("\\", "/");
const forgeDirs = new Set(["src", "engine", "editor", "builder", "tools", "templates", "game", "project"]);
const forgeFiles = new Set(["index.html", "package.json", "package-lock.json", "vite.config.ts"]);
const gameDirs = new Set(["src", "public", "tools", "docs"]);
const gameFiles = new Set(["package.json", "package-lock.json", "tsconfig.json", ".gitignore", "README.md"]);
const dependencies = ["three", "@dimforge/rapier3d-compat", "@recast-navigation/core", "meshoptimizer"];

/** Existing ancestors must stay inside the authorized root; no output links. */
export async function buildPath(root, path) {
  if (isAbsolute(path) || path.includes(":") || path.includes("\0")) throw new Error("Build path must be relative");
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Build path escapes root");
  let current = root;
  for (const part of ["", ...rel.split(sep).filter(Boolean)]) {
    if (part) current = resolve(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Build links are not allowed: ${current}`);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
  }
  return target;
}

async function walk(root, prefix = "") {
  const files = [];
  for (const entry of (await readdir(resolve(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Source/output link is not allowed: ${path}`);
    if (entry.isDirectory()) files.push(...await walk(root, path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function gitState(root) {
  const run = (...args) => {
    try { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { return null; }
  };
  // Restored snapshots intentionally have no .git directory.
  const top = run("rev-parse", "--show-toplevel");
  if (!top || relative(root, resolve(top)) !== "") return { commit: null, dirty: null };
  return { commit: run("rev-parse", "--verify", "HEAD"), dirty: Boolean(run("status", "--porcelain", "--untracked-files=normal")) };
}

export async function captureInputs(root, kind) {
  const directories = kind === "forge" ? forgeDirs : gameDirs;
  const names = kind === "forge" ? forgeFiles : gameFiles;
  const paths = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (directories.has(entry.name) && entry.isSymbolicLink()) throw new Error(`Input root link is not allowed: ${entry.name}`);
    if (entry.isDirectory() && directories.has(entry.name)) {
      // Keep generated/raw asset libraries out of the shared source snapshot.
      const visit = async (prefix) => {
        for (const item of await readdir(resolve(root, prefix), { withFileTypes: true })) {
          if (item.name === "node_modules" || item.name === "raw-assets" || item.name.startsWith(".") || /-index\.json$/.test(item.name)) continue;
          const path = `${prefix}/${item.name}`;
          if (item.isSymbolicLink()) throw new Error(`Input links are not allowed: ${path}`);
          if (item.isDirectory()) await visit(path);
          else if (item.isFile()) paths.push(path);
        }
      };
      await visit(entry.name);
    } else if (names.has(entry.name) || (kind === "forge" && /^tsconfig.*\.json$/.test(entry.name))) {
      await buildPath(root, entry.name);
      paths.push(entry.name);
    }
  }
  const files = [];
  for (const path of paths.sort()) {
    const bytes = await readFile(await buildPath(root, path));
    files.push({ path, bytes: bytes.length, sha256: hash(bytes), content: bytes.toString("base64") });
  }
  const digest = hash(JSON.stringify(files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))));
  return { ...gitState(root), digest, files };
}

export function runtimeProjectManifest(project) {
  return {
    schema: project.schema, name: project.name, type: project.type, version: project.version,
    entry: "index.html", publicDir: ".",
    editor: { defaultScene: project.editor.defaultScene, assetManifest: project.editor.assetManifest },
    scripts: {}, output: { distDir: "." },
  };
}

export function validateBase(base) {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) throw new Error("Base must be / or an absolute subpath ending in /");
  return base;
}

async function installedDependencies(forgeRoot) {
  const pkg = JSON.parse(await readFile(resolve(forgeRoot, "package.json"), "utf8"));
  const lockBytes = await readFile(resolve(forgeRoot, "package-lock.json"));
  const lock = JSON.parse(lockBytes);
  const versions = {};
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort()) {
    const installed = JSON.parse(await readFile(resolve(forgeRoot, "node_modules", name, "package.json"), "utf8"));
    if (installed.version !== lock.packages?.[`node_modules/${name}`]?.version) throw new Error(`Installed dependency differs from lock: ${name}`);
    versions[name] = installed.version;
  }
  return { lockSha256: hash(lockBytes), lockfileVersion: lock.lockfileVersion, versions };
}

export async function outputInventory(dist, forbiddenRoots = []) {
  const files = [];
  for (const path of await walk(dist)) {
    if (/(^|\/)(?:src|node_modules|\.git)(\/|$)|\.map$|\.[cm]?tsx?$/.test(path)) throw new Error(`Source-only output: ${path}`);
    const bytes = await readFile(resolve(dist, path));
    if (/\.(?:js|mjs|css|html|json|txt|svg)$/.test(path)) {
      const text = bytes.toString("utf8");
      if (/\b[A-Za-z]:[\\/]|\/@fs\/|file:\/\/\/|\/__save-|\/__content-|\/__import-asset|\/__new-behavior/.test(text)) throw new Error(`Local/dev path in output: ${path}`);
      for (const root of forbiddenRoots) {
        if ([root, portable(root), root.replaceAll("\\", "\\\\")].some((value) => text.includes(value))) throw new Error(`Source root leaked into output: ${path}`);
      }
    }
    files.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  }
  return files;
}

export async function buildGameProject(projectRoot, { forgeRoot, config, base = "/" }) {
  base = validateBase(base);
  projectRoot = await realpath(projectRoot);
  forgeRoot = await realpath(forgeRoot);
  const [forge, game, installed] = await Promise.all([captureInputs(forgeRoot, "forge"), captureInputs(projectRoot, "game"), installedDependencies(forgeRoot)]);
  const projectFile = game.files.find((file) => file.path === "public/project.3dgame.json");
  if (!projectFile) throw new Error("Missing game project manifest");
  const project = JSON.parse(Buffer.from(projectFile.content, "base64"));
  const id = `${new Date().toISOString().replace(/[-:.]/g, "")}-${game.digest.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const directory = await buildPath(projectRoot, `builds/${id}`);
  await mkdir(directory, { recursive: true });
  const stage = resolve(directory, "staged-public");
  const dist = resolve(directory, "dist");
  await mkdir(stage);
  // Stage captured game data, never Forge's public/ or the mutable live scene.
  for (const file of game.files.filter((file) => file.path.startsWith("public/"))) {
    const target = await buildPath(stage, file.path.slice("public/".length));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.content, "base64"));
  }
  await writeFile(resolve(stage, "project.3dgame.json"), JSON.stringify(runtimeProjectManifest(project), null, 2) + "\n");
  const bundled = new Map(dependencies.map((name) => [name, new Set()]));
  await build({
    ...config, configFile: false, base, publicDir: stage,
    plugins: [...config.plugins, {
      name: "forge-game-dependency-boundary",
      async generateBundle() {
        for (const id of this.getModuleIds()) {
          if (id.includes("\0")) continue;
          const normalized = portable(id);
          for (const name of dependencies) {
            const marker = `/node_modules/${name}/`;
            const index = normalized.lastIndexOf(marker);
            if (index >= 0) bundled.get(name).add(await realpath(normalized.slice(0, index + marker.length - 1)));
          }
        }
        for (const [name, roots] of bundled) {
          if (roots.size > 1 || [...roots].some((root) => relative(resolve(forgeRoot, "node_modules", name), root) !== "")) {
            throw new Error(`Duplicate or non-Forge dependency instance: ${name}`);
          }
        }
      },
    }],
    cacheDir: resolve(directory, "vite-cache"),
    build: { ...config.build, outDir: dist, emptyOutDir: false, sourcemap: false },
  });
  execFileSync(process.execPath, [resolve(forgeRoot, "builder/web/verify-dist.mjs"), "--strict", "--dist", dist], { cwd: forgeRoot, stdio: "inherit" });
  const output = await outputInventory(dist, [forgeRoot, projectRoot]);
  const [afterForge, afterGame] = await Promise.all([captureInputs(forgeRoot, "forge"), captureInputs(projectRoot, "game")]);
  if (forge.digest !== afterForge.digest || game.digest !== afterGame.digest) throw new Error("Build inputs changed during compilation; previous accepted build is unchanged. Retry after edits settle.");
  const snapshot = gzipSync(Buffer.from(JSON.stringify({ schema: 1, forge, game })), { level: 9 });
  await writeFile(resolve(directory, "inputs.json.gz"), snapshot);
  const summary = ({ files, ...metadata }) => ({ ...metadata, files: files.map(({ content, ...file }) => file) });
  const record = {
    schema: 1, id, createdAt: new Date().toISOString(), name: project.name, base,
    forge: summary(forge), game: summary(game), dependencies: installed,
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    saveSchema: { gameDeclared: null, note: "No project save schema is declared yet; generic implementation is preserved in the source input snapshot." },
    snapshot: { file: "inputs.json.gz", bytes: snapshot.length, sha256: hash(snapshot) },
    bundledPackages: Object.fromEntries([...bundled].map(([name, roots]) => [name, { instances: roots.size, version: installed.versions[name] }])),
    output, outputDigest: hash(JSON.stringify(output)), status: "verified-build",
  };
  await writeFile(resolve(directory, "build-record.json"), JSON.stringify(record, null, 2) + "\n");
  const pointer = await buildPath(projectRoot, ".forge/latest-build.json");
  await mkdir(dirname(pointer), { recursive: true });
  await writeFile(pointer, JSON.stringify({ schema: 1, directory: `builds/${id}` }, null, 2) + "\n");
  console.log(`[game-build] Runtime: ${dist}\n[game-build] Record: ${resolve(directory, "build-record.json")}`);
  return { directory, dist, record };
}

export async function latestBuild(projectRoot) {
  const pointer = JSON.parse(await readFile(await buildPath(projectRoot, ".forge/latest-build.json"), "utf8"));
  if (pointer.schema !== 1 || !/^builds\/[a-zA-Z0-9-]+$/.test(pointer.directory)) throw new Error("Invalid latest-build pointer");
  const directory = await buildPath(projectRoot, pointer.directory);
  const record = JSON.parse(await readFile(await buildPath(directory, "build-record.json"), "utf8"));
  if (record.schema !== 1 || record.status !== "verified-build") throw new Error("Build has not passed verification");
  const dist = await buildPath(directory, "dist");
  if (hash(JSON.stringify(await outputInventory(dist))) !== record.outputDigest) throw new Error("Build output changed after verification");
  return { directory, dist, record };
}

export async function previewGameProject(projectRoot, port = 4175) {
  const { directory, dist, record } = await latestBuild(projectRoot);
  const server = await preview({ configFile: false, root: directory, base: validateBase(record.base), publicDir: false,
    build: { outDir: dist }, preview: { host: "127.0.0.1", port, strictPort: true } });
  server.printUrls();
  console.log(`[game-preview] Static verified artifact: ${dist}`);
  return server;
}
