# Engine Physics

Pure engine physics layer.

- `physicsSubsystem.ts`: deterministic placeholder physics that derives AABB
  contacts from `Transform` + `Collider` components and exposes them through a
  query contract. No Three.js, DOM, WASM, or editor imports. With the Rapier
  backend the world advances in fixed slices (default 1/60 s, max 4 per frame)
  and dynamic render poses are interpolated between the last two slices.
- `vehicle/`: ray-cast wheeled vehicles (`Vehicle` component → Rapier
  `DynamicRayCastVehicleController`) plus the pure pedal/steer mapping.
- `impactEvents.ts`: pure impact aggregation (`PhysicsImpact`,
  `ImpactAccumulator`): merges a frame's fixed-slice contact-force samples into
  one impulse/point/normal per body pair, with a noise floor and a per-frame
  budget. See `docs/planned/DEFORMABLE_FRACTURABLE_WORK_PLAN.md` Faz 1.
  `PhysicsSubsystem.setImpactEventThreshold(id, minImpulse)` opts an entity
  in (Rapier contact-force events, drained per slice, manifold point/normal);
  `impacts()` returns the frame's result. Without an opt-in the step is unchanged.
- `fixedStep.ts`: the fixed-timestep accumulator (`FixedStepClock`) and the
  pose blend helpers it drives. See `VEHICLE_PHYSICS_PLAN.md` Faz 0 (archived, see `docs/COMPLETED_WORK_INDEX.md`).
