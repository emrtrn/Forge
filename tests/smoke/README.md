# Browser smoke tests

Run `npm.cmd run smoke:browser`. Playwright owns a loopback-only Vite server on
port 5273 with `strictPort` and `reuseExistingServer: false`.

Each invocation receives a unique `.playwright-smoke/run-<uuid>` project. The
launcher copies `public/` into it before starting Vite. Application source and
the existing Vite middleware come from the working tree; static reads and
authoring writes use the copied public directory. No links to writable authoring
files are used. Generated behavior stubs also resolve inside the disposable cwd.

`fixtures/` owns the base level, AI actor/behavior/closed route, save/load menu
and a three-segment asphalt road descriptor. The project default scene and
editable demo landscape do not define these scenarios. Real starter templates
and production assets are copied as dependencies, so their integration remains
under test.

All specs import `test` from `./test`. Its automatic fixture resets the generated
levels, manifests, menu and sidecars before each case, including after a failed
case. A new browser context owns storage/UI state. Keep `workers: 1`: different
cases still share this run's project, and increasing workers requires one
isolated project/server per worker.

Use `smokePublicPath()` for filesystem assertions about saved files. Browser
requests keep their regular public-relative URLs. The spline-chain spec selects
its own level and sidecar explicitly; sculpt/paint save into a level-specific
`.landscapes/` directory without affecting the chain or the user's terrain.
`terrain-isolation.spec.ts` creates the same terrain actor ID in two levels,
sculpts the second, then checks that the first level's definition and tile bytes
are unchanged and that its original heights survive reload.

Teardown stops only the server recorded by this run, then removes the validated
run directory. Setup failure also cleans its run directory. A forcibly killed
runner can leave ignored temporary files, but it cannot leave authoring files
half-rewritten. Never recursively remove the whole `.playwright-smoke` directory
while another run might own a child project.

`npm.cmd run verify:smoke-fixtures` type-checks the smoke tests and Playwright
config, then runs fixture isolation/reset/failure tests. It is included in
`build:verify`. The full browser suite remains a separate local command.
`npm.cmd run smoke:critical` runs the CI subset: boot and content error/recovery checks,
editor authoring/save/Play, runtime save/load/travel, and checkpoint autosave.
`npm.cmd run smoke:production` builds and serves the starter package at root and
subpath; it covers packaged content, menus, save/load/travel, and boot failures.
Both commands are configured in `.github/workflows/ci.yml`; a local pass is not
evidence of a remote CI run.

`content-loading.spec.ts` injects malformed project/manifest/level responses,
verifies file-specific boot/travel errors and Retry, and checks nonfatal collision
sidecar diagnostics. It intercepts HTTP responses without modifying authoring
files. See [content read contracts](../../docs/architecture/CONTENT_LOADING_CONTRACT.md).

The debug readout is passive by default. **Inspect text** enables scrolling and
selection; Escape from the readout turns that mode off. Buttons remain usable
in either mode. Menu tests use normal clicks, with no forced click workaround.
