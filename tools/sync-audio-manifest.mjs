/**
 * Stamp an audio folder into the asset manifest.
 *
 * Dropping a produced clip into a project is meant to be three steps, of which
 * only the first is creative: put the file in its folder, register it as a
 * manifest `sound` asset, and point an audio event at it. The middle step is 30
 * lines of boilerplate per clip with four fields that actually vary, and one of
 * them — `bytes` — is a number a human has no way to know. That is a
 * transcription job, so it belongs to a script.
 *
 * **There is deliberately no second table to maintain.** The obvious design is a
 * list of clips somewhere that this reads; the reason not to is that the folder
 * already *is* that list. The file name carries the id
 * (`sfx_artillery_fire_01` → `sfx-artillery-fire-01`), the folder carries the
 * tag, and the manifest carries the result. A hand-written table in between
 * would be a third place to keep in sync with the other two, and the failure it
 * invites is the quiet kind: a table row for a file that was renamed, or a file
 * no row ever mentions.
 *
 * What is *not* derived is anything a person authored. An existing entry keeps
 * its `name` and `license` — "UI Click" and "Notification Info" are editorial
 * and a title-caser would flatten them to "Ui Click" and "Notify Info". Only the
 * mechanical fields are rewritten, so running this twice changes nothing.
 *
 * Scoped by a manifest category (`--category`, default `project-audio`): entries
 * outside it are never read, written, or reported on, so a fork's imported and
 * hand-authored sounds are untouched by a run of this.
 *
 * Usage:
 *   npm run audio:manifest             # write
 *   npm run audio:manifest -- --check  # report only; non-zero if out of date
 *   npm run audio:manifest -- --root public/assets/audio --category my-audio
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, posix, sep } from "node:path";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};

const MANIFEST_PATH = option("--manifest", "public/assets/manifest.json");
const EVENTS_PATH = option("--events", "public/game-data/audio/events.json");
const AUDIO_ROOT = option("--root", "public/assets/audio");
/** The manifest category this script owns. Entries outside it are never touched. */
const CATEGORY = option("--category", "project-audio");
const PACK = option("--pack", "Project Audio");
const DEFAULT_LICENSE = option("--license", "Project-local audio");
/**
 * The runtime format. Anything else is flagged rather than silently accepted —
 * a project ships one encode, and a stray .wav beside the .ogg files is either
 * an un-transcoded delivery or a second format nothing was told about.
 */
const RUNTIME_EXTENSION = option("--extension", ".ogg");
const AUDIO_EXTENSIONS = new Set([".ogg", ".wav", ".mp3", ".m4a"]);

/**
 * Words the title-caser must not mangle. Only consulted for a *new* entry — an
 * existing one keeps whatever name a person gave it.
 */
const NAME_WORDS = new Map([
  ["ui", "UI"],
  ["notify", "Notification"],
  ["sfx", null],
  ["amb", "Ambience"],
  ["mus", "Music"],
  ["stg", "Stinger"],
  ["vo", "Voice"],
]);

const checkOnly = argv.includes("--check");

/** Every file under a directory, depth-first, as repo-relative POSIX paths. */
function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full.split(sep).join(posix.sep));
  }
  return out;
}

/** `sfx_artillery_fire_01.ogg` → `sfx-artillery-fire-01`. */
function idFor(fileName) {
  return fileName.replace(/\.[^.]+$/u, "").replace(/_/gu, "-");
}

/**
 * A first-guess display name; overwritten by the author's on any existing entry.
 *
 * The trailing variant number is *kept*, and that is the point rather than an
 * oversight in the title-caser. This name is what the editor's clip picker
 * shows, and a multi-variant sound is exactly the case that picker exists for:
 * four options all reading "Combat Sword Swing" cannot be told apart, so binding
 * variant 3 to an event would be guesswork.
 */
function nameFor(fileName) {
  const stem = fileName.replace(/\.[^.]+$/u, "");
  const parts = stem.split("_");
  const words = [];
  for (const part of parts) {
    if (NAME_WORDS.has(part)) {
      const mapped = NAME_WORDS.get(part);
      if (mapped) words.push(mapped);
      continue;
    }
    words.push(part.charAt(0).toUpperCase() + part.slice(1));
  }
  return words.join(" ") || stem;
}

const manifestRaw = readFileSync(MANIFEST_PATH, "utf8");
const manifest = JSON.parse(manifestRaw);
const assets = manifest.assets;
if (!Array.isArray(assets)) throw new Error(`${MANIFEST_PATH} has no assets array`);

const files = walk(AUDIO_ROOT).filter((path) =>
  AUDIO_EXTENSIONS.has(path.slice(path.lastIndexOf(".")).toLowerCase()),
);

const problems = [];
const notes = [];
const byId = new Map(assets.map((asset) => [asset.id, asset]));
const seen = new Map();

for (const path of files) {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  const relPath = relative("public", path).split(sep).join(posix.sep);
  const folder = relPath.split("/").at(-2) ?? "audio";

  // Not a style rule: Windows is case-insensitive, the git index is not, and a
  // deploy target usually is Linux. An asset whose name differs only in case
  // works locally and 404s on the host.
  if (fileName !== fileName.toLowerCase()) {
    problems.push(`${relPath}: file name must be all lower-case`);
    continue;
  }
  if (!fileName.endsWith(RUNTIME_EXTENSION)) {
    notes.push(`${relPath}: not ${RUNTIME_EXTENSION} — the runtime format for this project`);
  }

  const id = idFor(fileName);
  const previous = seen.get(id);
  if (previous) {
    problems.push(`id "${id}" is claimed by two files: ${previous} and ${relPath}`);
    continue;
  }
  seen.set(id, relPath);

  const existing = byId.get(id);
  if (existing && existing.category !== CATEGORY) {
    problems.push(`id "${id}" already belongs to a non-audio asset (${existing.category})`);
    continue;
  }

  const entry = {
    id,
    // Authored fields survive; everything below them is derived.
    name: existing?.name ?? nameFor(fileName),
    assetType: "sound",
    category: CATEGORY,
    path: relPath,
    tags: ["sound", folder],
    placeable: false,
    placement: { surface: "floor", snapToWall: false, allowRotation: false, allowScale: false },
    runtime: {
      loadGroup: CATEGORY,
      castShadow: false,
      receiveShadow: false,
      collision: false,
      bytes: statSync(path).size,
    },
    source: { origin: "project", pack: PACK, packVersion: "0.1" },
    license: existing?.license ?? DEFAULT_LICENSE,
  };

  if (existing) Object.assign(existing, entry);
  else {
    // Appended next to its siblings rather than at the end of 1200 assets, so the
    // audio block stays readable and the diff stays local.
    const lastAudio = assets.map((asset) => asset.category === CATEGORY).lastIndexOf(true);
    assets.splice(lastAudio >= 0 ? lastAudio + 1 : assets.length, 0, entry);
    byId.set(id, entry);
  }
}

// A manifest entry whose file is gone resolves to a 404 at play time, which
// sounds exactly like an event that was never wired.
for (const asset of assets) {
  if (asset.category !== CATEGORY) continue;
  if (!seen.has(asset.id)) {
    problems.push(`manifest entry "${asset.id}" has no file under ${AUDIO_ROOT}`);
  }
}

// And the other direction, against the table that actually names these ids.
let referenced = new Set();
try {
  const table = JSON.parse(readFileSync(EVENTS_PATH, "utf8"));
  for (const definition of Object.values(table.events ?? {})) {
    for (const clip of definition.clips ?? []) referenced.add(clip);
  }
} catch (error) {
  notes.push(`could not read ${EVENTS_PATH}: ${String(error)}`);
}
for (const clipId of referenced) {
  // Against the whole manifest, not just this script's category: a table is free
  // to name a hand-authored or imported sound, and those are provided too. What
  // is a real fault is an id *no* asset provides, which plays as silence and is
  // indistinguishable from an event that was never wired.
  if (!byId.has(clipId)) problems.push(`events.json names "${clipId}", which no asset provides`);
}
for (const id of seen.keys()) {
  // Not a problem: a produced variant lands before the table points at it, which
  // is the normal order of a delivery.
  if (!referenced.has(id)) notes.push(`${id} is shipped but no event plays it yet`);
}

const nextRaw = `${JSON.stringify(manifest, null, 2)}\n`;
const changed = nextRaw !== manifestRaw;

console.log(`[audio-manifest] ${files.length} file(s) under ${AUDIO_ROOT}, ${seen.size} sound asset(s)`);
for (const note of notes) console.log(`  note: ${note}`);
for (const problem of problems) console.error(`  ERROR: ${problem}`);

if (problems.length > 0) {
  console.error(`[audio-manifest] ${problems.length} problem(s); manifest not written`);
  process.exit(1);
}
if (!changed) {
  console.log("[audio-manifest] manifest already up to date");
  process.exit(0);
}
if (checkOnly) {
  console.error("[audio-manifest] manifest is out of date — run `npm run audio:manifest`");
  process.exit(1);
}
writeFileSync(MANIFEST_PATH, nextRaw, "utf8");
console.log(`[audio-manifest] wrote ${MANIFEST_PATH}`);
