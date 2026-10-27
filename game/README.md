# Game

**Game code lives in `src/game`, not here.** That is the ownership home for
project-specific runtime code (game rules, modes, scoring, missions, save model,
runtime UI). `src/game` is also the fork-owned area (see
`docs/planned/FORGE_GAME_PROJECT_WORKFLOW.md`): each game fork edits `src/game` + `public/`
and pulls platform updates from upstream.

This top-level `game/` is a **reserved placeholder**, kept intentionally empty:
migrating `src/game` here would force a large, conflict-heavy merge on every
downstream fork for no platform benefit, so the game boundary stays in
`src/game`. (The `@game/*` path alias points here and is currently unused.)

Rules (enforced by `builder/web/verify-imports.mjs`):

- Game code may depend on engine modules (`@engine/*`).
- Game code must not import editor modules — the editor stays generic. Game data
  the editor renders is injected via `@/editor/gameEditorRegistry` at startup
  (wired in `src/main.ts`), so the editor never imports `@/game`.
- Game rules, scoring, missions, save data, and runtime UI belong in `src/game`
  or project data, not in generic engine/editor modules.
