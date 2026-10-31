# River planar reflection

River reflection uses the Lake planar capture and coverage composite. The saved
mode is `sharedPlanar`; legacy `environment` reads/saves as `sharedPlanar`.
Explicit `off` survives save/load. Default quality remains Medium.

## Surface and budgets

The undeformed wet ribbon is partitioned into connected world-space patches.
Each patch uses an actual triangle plane; merging is limited to 3 degrees of
normal deviation and 0.1 m of plane distance. Anchoring the plane prevents a
gradually changing slope from accumulating into one incorrect horizontal mirror.
Transform changes rebuild CPU patches; waves only distort the reflection sample.
Incident-triangle weights interpolate across shared vertices without overlapping
water draws. Four shader slots keep sampler use and GPU targets bounded.

| Effective quality | Capture size | Minimum interval | Scene active-plane cap | Captures/render cap |
| --- | --- | --- | --- | --- |
| Low | Environment only | — | 0 | 0 |
| Medium | 256 px | 32 ms | 2 | 1 |
| High | 512 px, 2x MSAA | 4 ms | 4 | 2 |

The authored quality is capped by the existing Lake graphics-quality gate. The
gate does not modify saved data. Mixed scenes retain at most two Medium slots
within the total four-slot High budget. Visible patch bounds must cover at least
1% of the viewport. Coverage ranks patches; 10% retention hysteresis prevents
churn. Selected targets refresh oldest-first. New captures fade in over 150 ms;
unselected patches retain environment reflection through their spatial weights.

The scheduler runs after world matrices update and before geometry upload, so
slot reassignment cannot draw yesterday's weights against today's textures.
Weights upload only when patch/slot membership changes. Scene-owned leases share
targets only for the same group, normalized world plane and effective quality.
Water surfaces and the sky dome are excluded from captures. Nested planar cameras
cannot start another capture. Lake capture budgets are otherwise unchanged.

Planar approximation remains local: steep curvature and patches below the screen
coverage threshold or outside the target budget use the environment. The caps
bound extra scene renders; they do not guarantee a GPU frame time.

## Verification

- Engine coverage: downhill and changing slopes, disconnected branches, dry
  triangles, transformed planes, seam energy, arbitrary-plane camera mirroring,
  perspective/orthographic clipping in conventional and reversed Z, shared
  leases, quality ceilings, nested renders, refresh fairness and cleanup.
- `river-planar.spec.ts`: real WebGL captures, Low/Medium/High render caps and
  target sizes, visible reflected geometry, flat and descending ribbons,
  transformed parent groups, perspective/orthographic views, hidden surfaces,
  repeated quality switches and texture cleanup. Screenshots and CPU submission
  medians are attached to the Playwright report. Software WebGL measurements are
  diagnostic, not a hardware GPU benchmark.
- Existing river optics and Lake tests cover reflection energy, transmission,
  environment/probe binding and source lifetime regressions.

Run `npm run build:verify`, then Playwright for `river-planar.spec.ts`,
`river-water-optics.spec.ts` and `terrain-spline-editor.spec.ts`.
