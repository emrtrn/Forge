# Lake caustics visibility — 2026-10-28

The existing light network was visible at the shoreline but became an almost
uniform lift from the overview camera. The 256-pixel procedural tile contained
six Voronoi cells per axis: a saved 1 m pattern produced roughly 17 cm features.
Mipmap filtering removed most spatial contrast at normal editor distances.

The tile now contains two cells per axis, making the light network three times
larger at existing saved settings. Pattern size still controls the full repeat
in metres. Strength, depth attenuation, water transmission, exact connected-face
masks and mip filtering are unchanged. This changes the appearance of existing
caustics-enabled lakes deliberately; it needs no scene migration or extra
samplers, texture memory, per-frame generation or draw passes. The tradeoff is a
coarser repeating network; authors can reduce Pattern Size for a finer look.

The browser regression now measures the standard deviation of the on-minus-off
luminance field at both overview and shoreline cameras. A uniform brightness
increase cannot satisfy this check. Existing animation, night, dry shore/island/
separate-basin, shadow, toggle/undo, Save/Reload and runtime checks remain active.
The expensive GPU timer pilot is explicitly opt-in with
`FORGE_CAUSTICS_GPU_PILOT=1`, allowing functional coverage on software renderers.

Validation uses the cloud system Chromium with SwiftShader, not a target GPU
performance measurement. See the task results for measured contrast and checks.

## Local results

- Overview luminance-difference standard deviation: **2.081 → 3.190**
  (approximately **53%** higher spatial contrast); shoreline: **5.370** after.
- The old six-cell pattern fails the new overview threshold of 2.7. The new
  pattern passes the complete visual/persistence/runtime case.
- Night and dry/isolated areas remain unchanged; four CSM cascades are active;
  WebGL reports no error and caustics off/on both use 28 draw calls in the fixture.
- `npm run build:verify` passed, including TypeScript, 1,960 engine checks,
  production build, strict distribution scan and world-data validation.
- Hardware GPU timing was not requested; no performance delta is claimed.
