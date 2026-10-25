# LT Wet Mud roughness

LT Wet Mud now uses `lt-wet-mud-roughness`, registered in the asset manifest.
The scalar multiplier is 1, so the map controls roughness without the previous
0.5 multiplier making every texel twice as smooth.

Asset: `public/assets/LandscapeTest/Textures/LT_Wet_Mud_Roughness.webp`.
Generated with built-in `image_gen`, using the existing base color as a spatial
reference. Generation ID: `01a1734a-4c11-7c61-aaae-227ddbba1a77`.
The 1254 x 1254 RGB PNG was converted losslessly to WebP. Green is the linear
roughness channel, matching ordinary Three.js materials.

The terrain layer loader previously ignored roughness maps. It now packs the
green roughness channel into albedo alpha at load time, leaving the source
albedo and regular material opacity unchanged. RGB remains sRGB and alpha is
linear. A per-layer flag enables alpha roughness; layers without maps retain
their scalar roughness. Editor and runtime pass this flag to the terrain.
The existing eight albedo samplers also carry roughness, avoiding extra texture
units or reads. Runtime deformation/puddle shading is applied afterwards.

No authored level, terrain weight or height data was changed.

## Generation prompt

```text
Use case: precise-object-edit. Asset type: seamless PBR ROUGHNESS data texture for Forge LT Wet Mud, 1536x1536 square. Input image is the existing mud BASE COLOR texture, a spatial reference, not a scene to render. Create a single grayscale roughness map precisely registered to the reference: preserve every clod, ridge, smoothed muddy patch and its exact position and scale. Soft smooth wet clay patches should have lower roughness, medium-dark gray 80-125; granular clods, raised fine earth and rough crumbs should have higher roughness, light gray 170-235. Overall predominantly medium-light gray, broad irregular mottling at multiple scales, fine granular detail, irregular small smooth wet patches between rougher islands. White means rough, black means smooth. No pure black mirror puddles, no added water or tracks, no new features. This is technical scalar data, NOT a shaded photograph, height map, normal map or specular beauty render: remove directional illumination, shadows, highlights and brown color completely. No gradients caused by lighting, no text, no borders, no perspective. Opposite edges must tile seamlessly. Output only the full-bleed roughness texture.
```

## Validation

- `npx.cmd tsc --noEmit`: passed.
- `npm.cmd run test:engine`: all 1,870 checks passed.
- `npm.cmd run build:verify`: passed, including fixture/content/UI typing,
  production build, 1,870 engine checks, strict dist and world-data validation.
- Playwright `wet-mud.spec.ts --grep 'fifth layer renders'`: 1/1 passed.
  The fixture uses the production layer loader, compares rendered pixels with
  map sampling enabled/disabled, then checks water on/off and a second camera
  angle. No page or console errors were reported. Screenshots were inspected.

Browser evidence is under
`test-results/wet-mud-wet-mud-fifth-laye-bdb10-ctive-water-on-track-floors-chromium/`.
The build log is `test-results/wet-mud-build-verify.log`.
Initial esbuild runs were blocked by sandbox filesystem access; the final
engine, build and browser runs completed with approved sandbox escalation.
Final appearance in the user's current LandscapeTest editor lighting still
requires visual acceptance there. No performance comparison was measured.
