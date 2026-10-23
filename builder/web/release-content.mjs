import { copyFile, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";

export function publicPath(path) {
  if (typeof path !== "string" || !path || /[?#\0]/.test(path) || /^[a-z][a-z\d+.-]*:/i.test(path)) throw new Error(`Invalid public path: ${path}`);
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error(`Invalid public path: ${path}`);
  return normalized;
}

async function contentPath(root, path) {
  const file = await realpath(resolve(root, publicPath(path)));
  const absoluteRoot = await realpath(root);
  if (!file.startsWith(absoluteRoot + sep)) throw new Error(`Content escapes public root: ${path}`);
  return file;
}

export async function readJson(path) {
  return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
}

function pathReference(value) {
  const travel = value.match(/^travel:([^#]+)(?:#.*)?$/);
  if (travel) return travel[1];
  return /^(?:\/?[\w.-]+[\/\\])*[\w.-]+\.(?:json|glb|gltf|bin|png|jpe?g|webp|ktx2|ogg|mp3|wav|svg|woff2?)$/i.test(value) ? value : null;
}

function checkProvenance(path, provenance) {
  const entry = provenance[path];
  if (!entry || !["project-original", "third-party"].includes(entry.kind) || !entry.evidence?.trim() || !entry.license?.trim() ||
      /unknown|placeholder/i.test(entry.license)) throw new Error(`Missing or unresolved provenance: ${path}`);
  if (entry.kind === "project-original" && !entry.description?.trim()) throw new Error(`Missing authorship description: ${path}`);
  if (entry.kind === "third-party" && (!/^https?:\/\//.test(entry.sourceUrl ?? "") || !entry.licenseFile || typeof entry.attribution !== "string")) {
    throw new Error(`Incomplete third-party provenance: ${path}`);
  }
  return entry;
}

/** Conservative JSON/manifest + glTF dependency closure, with explicit dynamic includes. */
export async function collectReleaseContent({ publicDir, profile, provenance }) {
  const project = await readJson(await contentPath(publicDir, "project.3dgame.json"));
  const manifestPath = publicPath(project.editor.assetManifest);
  const manifest = await readJson(await contentPath(publicDir, manifestPath));
  const byId = new Map();
  const byPath = new Map();
  for (const asset of manifest.assets) {
    if (byId.has(asset.id)) throw new Error(`Duplicate manifest id: ${asset.id}`);
    byId.set(asset.id, asset);
    const path = publicPath(asset.path ?? asset.file);
    const entries = byPath.get(path) ?? [];
    entries.push(asset);
    byPath.set(path, entries);
  }
  const files = new Map(), selectedIds = new Set(), queue = [];
  const enqueue = (path, reason) => {
    path = publicPath(path);
    if (!files.has(path)) { files.set(path, { path, reasons: [reason] }); queue.push(path); }
    else if (!files.get(path).reasons.includes(reason)) files.get(path).reasons.push(reason);
  };
  const selectAsset = (id, reason) => {
    if (/^(shape|marker):/.test(id)) return;
    const record = byId.get(id);
    if (!record) throw new Error(`Unresolved asset ${id} referenced by ${reason}`);
    if (selectedIds.has(id)) return;
    if (!record.license?.trim() || /unknown|placeholder/i.test(record.license)) throw new Error(`Unresolved asset license: ${id}`);
    selectedIds.add(id);
    enqueue(record.path ?? record.file, reason);
    if (record.thumbnail) enqueue(record.thumbnail, `thumbnail:${id}`);
  };
  const visit = (value, owner, key = "") => {
    if (Array.isArray(value)) { for (const item of value) visit(item, owner, key); return; }
    if (value && typeof value === "object") {
      for (const [field, child] of Object.entries(value)) {
        if (field === "source" || field === "license") continue;
        if (field === "loadGroups" && Array.isArray(child)) {
          for (const group of child) for (const record of manifest.assets) {
            if ((record.runtime?.loadGroup ?? record.loadGroup) === group) selectAsset(record.id, `${owner}:loadGroup:${group}`);
          }
        }
        visit(child, owner, field);
      }
      return;
    }
    if (typeof value !== "string") return;
    if (byId.has(value)) selectAsset(value, owner);
    else if (["assetId", "meshAssetId"].includes(key) && value && !/^(shape|marker):/.test(value)) selectAsset(value, owner);
    const path = pathReference(value);
    if (path) enqueue(path, owner);
  };
  const optional = async (path, owner) => {
    try { await contentPath(publicDir, path); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    enqueue(path, owner);
  };
  enqueue("project.3dgame.json", "project manifest");
  enqueue(manifestPath, "asset manifest");
  enqueue(profile.defaultScene, "default scene");
  for (const path of profile.levels ?? []) enqueue(path, "profile level");
  for (const path of profile.includeFiles ?? []) enqueue(path, "explicit dynamic file");
  for (const id of profile.includeAssets ?? []) selectAsset(id, "explicit dynamic asset");
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index];
    const file = await contentPath(publicDir, path);
    for (const record of byPath.get(path) ?? []) selectAsset(record.id, path);
    const entry = checkProvenance(path, provenance);
    if (entry.licenseFile) enqueue(entry.licenseFile, `license:${path}`);
    const bytes = await readFile(file);
    Object.assign(files.get(path), { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), provenance: entry });
    if (path === "project.3dgame.json" || path === manifestPath) continue;
    let json;
    if (extname(path) === ".json" || extname(path) === ".gltf") json = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    else if (extname(path) === ".glb") {
      if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`Invalid GLB: ${path}`);
      json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8").trim());
    }
    if (/\.(gltf|glb)$/.test(path)) {
      for (const ref of [...(json.buffers ?? []), ...(json.images ?? [])]) {
        if (!ref.uri || ref.uri.startsWith("data:")) continue;
        // External resources must be packaged, not fetched from an untracked host.
        if (/^[a-z][a-z\d+.-]*:|^\//i.test(ref.uri)) throw new Error(`External glTF resource needs a local copy: ${path} -> ${ref.uri}`);
        const target = relative(publicDir, resolve(publicDir, dirname(path), decodeURIComponent(ref.uri))).replace(/\\/g, "/");
        enqueue(target, `gltf:${path}`);
      }
      const stem = path.replace(/\.[^.]+$/, "");
      for (const suffix of ["collision", "uvw", "materials", "skeleton", "vertexcolors"]) await optional(`${stem}.${suffix}.json`, path);
    } else if (json) {
      visit(json, path);
      if (path.endsWith(".terrain.json") && json.type === "worldTerrain") {
        if (!Array.isArray(json.tiles)) throw new Error(`Invalid terrain tile list: ${path}`);
        const seen = new Set();
        for (const tile of json.tiles) {
          if (typeof tile.key !== "string" || !/^(0|[1-9]\d*)_(0|[1-9]\d*)$/.test(tile.key) || seen.has(tile.key)) {
            throw new Error(`Invalid terrain tile key: ${path}`);
          }
          seen.add(tile.key);
          enqueue(`${path.slice(0, -".terrain.json".length)}.tiles/${tile.key}.tile.bin`, `terrain:${path}`);
        }
      }
    }
    if (/\.(level|layout)\.json$/i.test(path)) {
      const stem = path.replace(/\.(level|layout)\.json$/i, "");
      for (const suffix of ["foliage", "meshpaint"]) await optional(`${stem}.${suffix}.json`, path);
    }
  }
  // Build-generated manifests contain only selected records and the chosen boot level.
  const outputProject = structuredClone(project);
  outputProject.editor = { ...outputProject.editor, defaultScene: profile.defaultScene };
  delete outputProject.editor.assetCatalog;
  delete outputProject.editor.metadataSchema;
  delete outputProject.editor.previewUrl;
  const outputManifest = { ...manifest, assets: manifest.assets.filter((asset) => selectedIds.has(asset.id)) };
  return { files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), project: outputProject, manifest: outputManifest, manifestPath };
}

export async function stageReleaseContent(selection, publicDir, outputDir) {
  for (const entry of selection.files) {
    const target = resolve(outputDir, publicPath(entry.path));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(await contentPath(publicDir, entry.path), target);
  }
  await writeFile(resolve(outputDir, "project.3dgame.json"), JSON.stringify(selection.project, null, 2) + "\n");
  await writeFile(resolve(outputDir, selection.manifestPath), JSON.stringify(selection.manifest, null, 2) + "\n");
}

export async function measureRelease(distDir, budgets) {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push({ path: relative(distDir, path).replace(/\\/g, "/"), bytes: (await stat(path)).size });
      else throw new Error(`Non-file output in release: ${path}`);
    }
  }
  await walk(distDir);
  const js = files.filter((file) => file.path.endsWith(".js"));
  const totals = {
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), fileBytes: Math.max(0, ...files.map((f) => f.bytes)),
    assetBytes: Math.max(0, ...files.filter((f) => !/\.(js|css|html)$/.test(f.path)).map((f) => f.bytes)),
    entryJsBytes: Math.max(0, ...js.filter((f) => /\/index-[^/]+\.js$/.test(f.path)).map((f) => f.bytes)),
    jsBytes: js.reduce((sum, file) => sum + file.bytes, 0), fileCount: files.length,
  };
  const failures = [];
  for (const [name, limit] of Object.entries(budgets ?? {})) {
    if (!(name in totals) || !Number.isFinite(limit) || limit <= 0) throw new Error(`Invalid release budget: ${name}`);
    if (totals[name] > limit) failures.push(`${name}: ${totals[name]} > ${limit}`);
  }
  if (Object.keys(budgets ?? {}).length !== Object.keys(totals).length) throw new Error("All release budget categories must be configured");
  return { totals, budgets, failures, files };
}
