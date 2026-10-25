# LT Alpine Snow roughness

Asset: `public/assets/LandscapeTest/Textures/LT_Snow_Roughness.webp`.
Material: `public/assets/LandscapeTest/Materials/lt-snow.material.json`.
Manifest ID: `lt-snow-roughness`.

Generated with built-in OpenAI `image_gen` using the existing snow base color
as a spatial reference. Source output:
`01a1734a-4c11-7c61-aaae-227ddbba1a77/exec-fb53338d-84ec-4fd6-857e-90ab73054ee0.png`.
Converted losslessly from RGB PNG to 1254 x 1254 WebP (1,799,454 bytes).
The green channel has raw values 113-252 with mean 193.76. The material scalar
is 1, allowing the map to supply its full roughness range. Granular regions
are rougher and compressed regions smoother.

Uses the terrain roughness support added for Wet Mud. No additional engine or
TypeScript changes were needed; existing snow material settings were preserved
except for the roughness map reference and scalar. No terrain data was edited.

## Prompt

```text
Use case: precise-object-edit. Asset type: seamless tileable PBR ROUGHNESS scalar data texture for Forge LT Alpine Snow. Input image: existing snow BASE COLOR texture, used ONLY as an exact spatial reference. Generate one square grayscale roughness map registered to the same snow grain clusters, soft ridges and compressed troughs, retaining their positions and scale. Fresh loose granular powder and rough crystal clusters must be predominantly light gray 210-245 (roughness 0.82-0.96). Sparse compacted, smoother snow between granular clusters should be medium gray 145-195 (roughness 0.57-0.76), irregularly distributed with soft transitions. Keep the overall snow surface mostly matte, with restrained fine-scale variation and subtle medium-scale mottling that breaks a uniform specular highlight. Not wet mud, not a polished ice sheet. This is technical material data: white = rough, black = smooth. NO directional light, baked shadows, highlights, ambient occlusion, depth shading, metallic sheen or photographic lighting. Do not merely desaturate the input or make a height map. Never add cracks, rocks, tire tracks, footprints, grass, text, borders, black pools or new large features. Flat orthographic full-bleed single texture; no perspective. Opposite edges should tile seamlessly; 1536x1536 or match the square reference resolution.
```

## Validation

Manifest IDs, texture references and updated asset byte sizes passed.
Playwright WebGL validation used the existing terrain fixture, intercepting its
module response to select `lt-snow`, the snow physical profile and snow tint.
Production material loading and terrain rendering were unchanged. Map on/off
comparison changed 28 sampled color channels by more than one byte, with a
maximum difference of 3 in this mostly diffuse lighting. The first trial's
arbitrary threshold of more than 30 channels was not met; the final check
verified a nonzero render effect and captured both views. No page or console
errors occurred. Front and side screenshots were inspected under
`test-results/snow-roughness/`; uniform-map baseline is also saved there.

The fixture shows a restrained roughness effect, rather than a dramatic change
to the white albedo. Final visual acceptance under the user's scene lighting
remains open. TypeScript/engine/build gates were not repeated for this
asset-and-material-only follow-up; the shared roughness rendering support was
validated during the preceding Wet Mud task. `git diff --check` passed.
