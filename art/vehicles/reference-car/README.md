# Forge reference car

Original procedural model for the reusable Reference Car and AI Reference Car.
No third-party mesh or texture is used. Rebuild from the repository root:

```sh
node art/vehicles/reference-car/generate.mjs
```

Output: `public/assets/vehicles/reference-car/ReferenceCar.glb` and its checker
texture `ReferenceCarPalette.png`. The adjoining `ReferenceCar.deformable.json`
is authored separately and is not overwritten by the generator.

The model uses +Y up and +Z forward. It matches the existing actor scale (1.6),
chassis envelope and four named wheel hard points in
`assets/starter-content/Gameplay/ReferenceCar.vehicle.json`. Dense flat body
faces support the impact and save/load smoke tests; wheel meshes remain rigid.

The new dense mesh uses a 4500 N s dent threshold: the browser fixture's initial
ground contact measured about 2862 N s, which must not damage a parked car.
Larger impacts still dent it, up to the existing 9000 N s full-impact setting.
