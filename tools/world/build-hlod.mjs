import { build } from "esbuild";
import { mkdir, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const usage = "Usage: npm run world:build -- <level under public/> [--ratio 0.25] [--error 0.01]";

async function main() {
  const args = process.argv.slice(2);
  if (!args[0] || args[0].startsWith("--") || args.length % 2 !== 1) throw new Error(usage);
  const options = {};
  for (let index = 1; index < args.length; index += 2) {
    const name = { "--ratio": "ratio", "--error": "error" }[args[index]];
    const value = Number(args[index + 1]);
    if (!name || !Number.isFinite(value) || args[index + 1].trim() === "") throw new Error(usage);
    options[name] = value;
  }
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const root = await realpath(resolve(repo, "public"));
  const inside = (absolute) => {
    const rel = relative(root, absolute);
    if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
      throw new Error(`Path escapes public: ${absolute}`);
    }
  };
  const withinPublic = async (path) => {
    if (isAbsolute(path) || /^[a-z][a-z\d+.-]*:/i.test(path)) throw new Error(`Path escapes public: ${path}`);
    const absolute = resolve(root, path.replace(/\\/g, "/"));
    inside(absolute);
    // Resolve the closest existing ancestor before creating anything, including symlinks.
    let ancestor = absolute;
    while (ancestor !== root) {
      try {
        inside(await realpath(ancestor));
        break;
      } catch (cause) {
        if (cause.code !== "ENOENT") throw cause;
        ancestor = dirname(ancestor);
      }
    }
    return absolute;
  };
  const levelPath = relative(root, await withinPublic(args[0])).split(sep).join("/");
  const started = performance.now();
  // Absolute package URLs let a memory-only ESM bundle resolve external packages.
  const bundled = await build({
    absWorkingDir: repo,
    tsconfig: resolve(repo, "tsconfig.json"),
    entryPoints: [resolve(repo, "tools/world/hlodBuild.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [{
      name: "external-package-urls",
      setup(plugin) {
        plugin.onResolve({ filter: /^(?:@gltf-transform\/|meshoptimizer$|three$|sharp$|node:)/ }, (args) => {
          try {
            return { path: args.path.startsWith("node:") ? args.path : import.meta.resolve(args.path), external: true };
          } catch (cause) {
            if (args.path === "sharp") return { path: args.path, external: true };
            throw cause;
          }
        });
      },
    }],
  });
  const { buildLevelHlod } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
  const result = await buildLevelHlod(levelPath, {
    async read(path) {
      const absolute = await withinPublic(path);
      try {
        return new Uint8Array(await readFile(absolute));
      } catch (cause) {
        if (cause.code === "ENOENT") return null;
        throw cause;
      }
    },
  }, options);
  const outputs = [];
  for (const [path, bytes] of result.files) outputs.push({ absolute: await withinPublic(path), bytes });
  // Map insertion order commits the index after every referenced GLB has been written.
  for (const { absolute, bytes } of outputs) {
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(await withinPublic(relative(root, absolute)), bytes);
  }
  const keep = new Set(outputs.map(({ absolute }) => absolute));
  const indexPath = outputs.at(-1).absolute;
  const proxyDir = indexPath.replace(/\.hlod\.json$/, ".cells" + sep + "hlod");
  await withinPublic(relative(root, proxyDir));
  let stale = [];
  try {
    stale = await readdir(proxyDir, { withFileTypes: true });
  } catch (cause) {
    if (cause.code !== "ENOENT") throw cause;
  }
  for (const entry of stale) {
    if (!entry.isFile() || !entry.name.endsWith(".hlod.glb")) continue;
    const absolute = await withinPublic(relative(root, resolve(proxyDir, entry.name)));
    if (!keep.has(absolute)) await unlink(absolute);
  }
  let totalSource = 0;
  let totalTriangles = 0;
  for (const cell of result.index.cells) {
    const bytes = result.files.get(relative(root, resolve(proxyDir, `${cell.key}.hlod.glb`)).split(sep).join("/"));
    const jsonLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
    const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
    const source = gltf.extras.hlodSourceTriangles;
    totalSource += source;
    totalTriangles += cell.triangles;
    console.log(`[hlod] ${cell.key}: ${source} → ${cell.triangles}`);
  }
  for (const warning of result.warnings) console.warn(`[hlod] warning: ${warning}`);
  console.log(`[hlod] ${levelPath}: ${result.index.cells.length} cells, ${totalSource} → ${totalTriangles} triangles, `
    + `${((performance.now() - started) / 1000).toFixed(2)} s`);
}

main().catch((cause) => {
  console.error(`[hlod] ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exitCode = 1;
});
