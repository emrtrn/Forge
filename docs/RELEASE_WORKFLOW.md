# Selected-content release builds

The ordinary `npm.cmd run build` remains the full authoring project's runtime
build. A separate release command packages a selected content set:

```powershell
npm.cmd run build:release
npm.cmd run build:release -- --base /oyunlar/demo/ --output starter-subpath
```

The default profile is [starter](../builder/web/profiles/starter.json). Output is
`builds/release/starter/`, with `starter.report.json` and
`starter.attribution.txt` alongside it. Publish only the contents of the output
directory, at the base used during the build. A local build does not publish it.
The report and attribution artifact should travel with the release handoff.

## Starter content and source records

[starter-content.mjs](../builder/web/starter-content.mjs) creates the starter's
public files only inside a disposable build staging directory. It authors a
unit cube from coordinates, a two-color 2×2 PNG from RGB values, a checker
material, a flat landscape, two levels and HUD/menu JSON. The glTF uses an
external buffer and image so the production checks exercise relative model
dependencies as well as manifest URLs.

These are original source assets authored by this project. The provenance
report records the generator as evidence and explicitly states that the
project owner controls distribution. This does not assign a new public license
to the repository or to the existing asset library. The ordinary demo's
`Unknown` and placeholder entries remain unresolved and excluded from this
starter package. JavaScript library dependencies still ship in the runtime
bundle; the source-asset provenance report is not a dependency-license audit.

`ASSET_NOTICES.txt` is included in the package. For third-party source assets,
the packager requires a source URL, license identifier/text description,
packaged `licenseFile`, evidence and an explicit attribution string (empty only
when no attribution is required). License files themselves must also have
source records. These checks enforce completeness of the supplied records;
they cannot independently establish the truth of an authorship/license claim.

## Adding a project-content profile

Add `builder/web/profiles/<name>.json`, using the starter's schema and budget
keys. Set `content` to `project`, `defaultScene` to a public-relative level and
`levels` to the supported travel destinations. Provide `provenanceFile` under
`builder/web/provenance/<name>.json`, keyed by public-relative file path.

An original file's record has `kind: "project-original"`, `license`, `evidence`
and an authorship `description`. A third-party record instead uses
`kind: "third-party"`, `license`, `evidence`, `sourceUrl`, `licenseFile` and
`attribution`. Selected manifest assets must also have a nonempty license that
is neither `Unknown` nor placeholder. Missing files, malformed JSON and
unresolved asset references fail the build.

The dependency closure follows manifest IDs in JSON, public file references,
`travel:` UI messages, level `loadGroups`, existing model sidecars and level
foliage/mesh-paint sidecars. World Terrain `.terrain.json` definitions also
include their implicit `<name>.tiles/x_z.tile.bin` dependencies; each needs its
own provenance record. glTF/GLB external buffer and image URIs resolve
relative to the model and must stay within the content root. HTTP model
resources need local copies; embedded data URIs stay in the model.

Runtime-computed paths/IDs and dependencies known only to game code are not
discoverable from JSON. List those in `includeAssets` and `includeFiles`.
Engine/game extensions that introduce another reference format must extend the
collector and add a regression. This is a conservative content collector, not
a general analysis of arbitrary game scripts. The packager generates a filtered
manifest, updates its boot level and omits authoring-only catalog/metadata/
preview fields. It does not edit the source manifest, levels or assets.

## Budgets and validation

All profiles must set byte limits for the total package, largest file, largest
non-JS/CSS/HTML asset, entry JS, total JS, and file count. These use
uncompressed disk sizes; they do not measure initial transfer, GPU memory or
frame rate. The JSON report lists actual values, configured limits, failures,
selected assets and content provenance. Exceeding a limit fails the build.
The normal strict editor/runtime dist boundary scan also runs on the package.

```powershell
npm.cmd run build:verify
npm.cmd run check:assets
npm.cmd run smoke:critical
npm.cmd run smoke:production
```

The dev smoke harness defaults to port 5273 and always owns a copied project.
If a user server already occupies that port, set `$env:FORGE_SMOKE_PORT='5274'`
for the test command, then remove it with `Remove-Item Env:FORGE_SMOKE_PORT`.
The override retains strict port ownership and rejects authoring port 5173.

The production smoke command builds the actual starter twice and serves it on
loopback ports 5274 (`/`) and 5275 (`/oyunlar/demo/`). The subpath origin has no
root-mounted copy to conceal incorrect requests. Missing files return 404,
including JSON; there is no SPA HTML fallback. Chromium checks model/buffer,
material/texture, terrain, UI save/load, travel and return travel, plus request
paths and browser errors. Browser screenshots and failure traces go to
`test-results-production/`; the HTML report is `playwright-production-report/`.
Runtime save slots are namespaced by the starter project name and are private
to the browser test context.

CI has a separate Chromium job running the critical editor authoring/save/Play,
runtime save/load/travel and checkpoint tests, followed by the root/subpath
production tests. Reports, traces/screenshots and package reports are uploaded
even after failure. A configured workflow is not proof of a successful remote
CI run. The full local 49-case development browser suite remains a separate
command; Firefox/WebKit and physical-device acceptance are outside this gate.
