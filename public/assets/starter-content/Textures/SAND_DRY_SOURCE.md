# Dry sand colour texture

`T_Sand_Dry_BC.png` derives from `T_Shallow_Water_Bed_BC.jpg` (Poly Haven
Gravelly Sand, CC0; see `SHALLOW_WATER_BED_SOURCE.md`).

The source sRGB pixels are decoded to linear RGB, mixed 40% toward
`[0.65, 0.5, 0.3]`, and encoded back to sRGB in a lossless RGB PNG.
This matches the `sand` deformation profile's tint at full disturbance,
before track-depth darkening, lighting, and Lake wetness are applied.
It does not bake a track shape, shadows, or Lake wetness into the texture.

`M_Sand_Dry` reuses the source normal and roughness maps, with roughness 0.95
and a 2.4 m repeat. Runtime deformation can still tint this texture further;
this asset change does not alter the global sand physics or track shader.
