# Lake underwater rendering

Underwater presentation is owned by the active camera and a ready Lake's exact
wet geometry. It works with the runtime free/vehicle camera and editor viewport,
including levels without a global Post Process actor. Outside water, the runtime
retains its direct renderer path when no other effect requires a composer.

## Appearance and authoring

The Lake's existing shallow/deep colours and absorption distance drive spectral
attenuation and distance fog. Near objects remain readable; distant objects lose
contrast and converge to the Lake colour. Low-amplitude animated distortion and
depth-guarded far softening share one HDR composite before bloom/grading/output.
The underwater surface branch shades only the interface, avoiding a second
application of the above-water bed column. It approximates a Snell window and
increasing internal reflection without a new scene capture.

`underwater` settings on a Lake are enabled by default, including legacy Lakes:

| Field | Default | Range |
| --- | --- | --- |
| enabled | true | boolean |
| fogDensity | 1 | 0–3 |
| distortionStrength | 0.35 | 0–1 |
| blurStrength | 0.2 | 0–1 |
| particleDensity | 0.25 | 0–1 |

The editor's Underwater group uses the shared read/save validation and normal
Lake undo/rebuild/save workflow. Colour remains authored through Appearance.
Global DoF suppresses the additional underwater blur to avoid stacking it.

## Masks, ordering and resources

A lazy watertight top/bed/edge mesh follows the welded wet triangles and the
same GPU wave uniforms as the visible Lake. Two water-only entry/exit passes
identify pixels whose near-plane origin is submerged and bound their optical
path by the first water exit and opaque scene depth. Pixels looking down through
the above-water interface retain its existing volume shading. Dry land, islands,
outside points and cameras below the bed do not become underwater volumes.

The beauty depth attachment is copied before post-processing can overwrite it;
no second full-scene depth render is required. This supports ordinary depth,
resolved MSAA and reversed Z. The order is beauty → stable depth → AO → underwater
→ authored DoF/bloom/grading → editor overlays/AA → output. Nested planar cameras
do not activate the effect. One Lake is selected deterministically when volumes
overlap (nearest upper surface, then id).

Low uses half-size masks without distortion, softening or particles. Medium uses
half-size masks, subtle distortion and at most 16 particles before density
scaling. High/Ultra use full-size masks, permitted softening and at most 48
particles before density scaling. Particles are seeded in world cells, fade at
the camera neighbourhood boundary, and are clipped by stable depth and water
exit. Their one draw uses no scene depth writes or additional captures.

Mask/depth targets are released when inactive and on disposal; each Lake owns
and releases its cached volume. Buffer resolution scales with the renderer.
The extra targets and geometry draws have a real GPU cost; the caps bound work,
not milliseconds on arbitrary hardware.

## Verification

- Engine: finite settings and save round-trip, closed volume topology and outward
  winding, exact wet bed, island rejection, camera/near-plane selection, hidden
  and removed owners, graphics ceilings and post-process ordering/lifecycles.
- WebGL: disabled/enabled colour comparison, untouched above-water half, animated
  waterline, upward view, orthographic/reversed-depth selection, MSAA, Low/High,
  resize, repeated enter/exit cleanup and inherited colour changes.
- Editor/runtime: Underwater controls, undo, disk save/reload, and the real runtime
  pipeline with the camera below the water and no global Post Process actor.
- `npm run build:verify` passed, including 2186 engine checks and distribution and
  world-data verification. Cloud screenshots/timings use software WebGL; hardware
  GPU frame times remain to be measured on the target device.

The architecture follows the camera-volume and partial-submersion approach in
[Epic's Water documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/water-meshing-system-and-surface-rendering-in-unreal-engine)
and the HDR pass placement described in
[Post Process Materials](https://dev.epicgames.com/documentation/en-us/unreal-engine/post-process-materials-in-unreal-engine).
