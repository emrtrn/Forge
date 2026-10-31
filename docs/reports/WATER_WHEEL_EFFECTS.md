# Wheel ripples and dynamic foam

River now reuses the Lake fixed-step ripple emitter and analytic ring shader.
The runtime's existing vehicle/water physics subscription drives both bodies,
including levels with rivers and no Lake actor. River contacts test the finite
tyre cylinder against the actual displaced, transformed wet triangles. Spline
elevation, parent transforms, wave interpolation, dry bed and terrain holes are
respected; ground contact is not required, and fully submerged tyres cannot
agitate the surface. Ring distance includes the local surface slope.

Both surfaces emit transient wheel foam on continuous movement or traction slip.
Stopped wheels do not continuously emit. The same bounded motion emitter rejects
teleports/re-entry bursts. Puffs expand, fade over 2.8 seconds and, on rivers,
advect with the sampled current. They use the existing foam texture, erosion and
lighting in the existing water draw; no extra scene render, target or terrain
write is introduced. Static shore foam and Lake ripple toggles do not disable
wheel foam. The existing graphics `foamAllowed` gate disables it, and the ripple
budget also caps foam history at 24/12/8 entries per body by graphics profile.

River geometry indexing is lazy and rebuilt only on transform changes. Contact
queries evaluate only candidate wave-displaced vertices, cached per physics
slice. Existing River surface-query limits apply; an over-budget interaction
falls back without replacing or invalidating the rendered water. Removal,
visibility changes, rebuilds and travel clear transient contact history. Saved
layouts and vehicle dynamics are unchanged.

Verification:

- `npm run build:verify`: TypeScript, import/content/release checks, 2183 engine
  checks, production build and distribution/world-data checks passed.
- New engine cases cover tilted/sloped contacts, transformed moving triangles,
  dry/outside/submerged rejection, stopped/moving/slipping/teleporting wheels,
  current advection, bounded history, expiry, river-only subscriptions, quality
  gates and disposal. Existing Lake interactions also exercise live Rapier wheels.
- `water-wheels.spec.ts`: real WebGL test passed for moving/stationary/submerged
  tyres on Lake and downhill River, shared material readiness, visible foam,
  ripple-only rendering (verified against an otherwise identical flat frame),
  graphics gating and unchanged draw count. Eight existing planar/optical
  regression tests also passed, including twenty quality-switch cycles.
- Browser screenshots and measurements are attached to Playwright results.
  Browser checks use software WebGL in the cloud; hardware GPU performance has
  not been measured.
