# Engine Physics

Pure engine physics layer.

- `physicsSubsystem.ts`: deterministic placeholder physics that derives AABB
  contacts from `Transform` + `Collider` components and exposes them through a
  query contract. No Three.js, DOM, WASM, or editor imports. With the Rapier
  backend the world advances in fixed slices (default 1/60 s, max 4 per frame)
  and dynamic render poses are interpolated between the last two slices.
- `vehicle/`: ray-cast wheeled vehicles (`Vehicle` component → Rapier
  `DynamicRayCastVehicleController`) plus the pure pedal/steer mapping.
- `fixedStep.ts`: the fixed-timestep accumulator (`FixedStepClock`) and the
  pose blend helpers it drives. See `docs/planned/VEHICLE_PHYSICS_PLAN.md` Faz 0.
