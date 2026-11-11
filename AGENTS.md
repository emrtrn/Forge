# Forge Codex Instructions

Forge is a reusable Three.js game platform template with a built-in editor
mode at `?editor`. Keep engine/editor code generic; project-specific game rules
belong in game runtime code or data.

**Maintenance mode (since 2026-11-11):** this repo is Forge WebGL and takes bug
fixes only; new engine work happens in Forge WebGPU
(`C:\Users\emret\Desktop\Forge-WebGPU`). The tag `forge-webgl-final` marks the
commit Forge WebGPU ports from. See `CLAUDE.md` "Maintenance mode".

## Validation

- After editing TypeScript, run `npx tsc --noEmit`; the Vite dev server does not
  type-check.
- For engine/runtime changes, prefer the full local gate when practical:
  `npx tsc --noEmit`, `npm run test:engine`, and `npm run build:verify`.
- If PowerShell blocks npm/npx shims, use `npm.cmd` and `npx.cmd`.

## Codex Tools

- Codex Security is installed for this workspace. Suggest using it when the task
  touches dev-server endpoints, save/load validation, asset ingestion, script
  execution, generated content, permission boundaries, or any change where a
  security review would be useful.
- Do not run a Codex Security scan silently. Recommend the appropriate scan
  scope and wait for the user to start or approve it unless the user explicitly
  asks for a Codex Security scan.
- A Playwright skill is installed. Suggest or use it for browser-facing editor
  and runtime validation: `?editor` smoke checks, canvas/viewport rendering,
  console errors, interaction flows, screenshots, responsive layout checks, and
  regressions that are hard to prove with headless engine tests alone.
- Prefer Playwright after substantial UI, Three.js rendering, picking/gizmo, or
  route-mode changes. Playwright is an additional browser verification layer,
  not a replacement for TypeScript and engine tests.

## Save Validation Gotchas

- New layout or environment fields must be allowlisted in
  `tools/saveValidator.ts`, which is imported by `vite.config.ts`, or they may be
  silently dropped on save.
- New `*.skeleton.json` sidecar fields must be added to the matching
  `validate*` function in `tools/saveValidator.ts`, mirroring
  `src/scene/assetSkeletonLoader.ts`.
