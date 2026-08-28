import type {
  LayoutActorInstance,
  LayoutAiNavigationVolume,
  LayoutBehavior,
  LayoutBlockingVolume,
  LayoutCharacter,
  LayoutLandscape,
  LayoutLightActor,
  LayoutMetadata,
  LayoutMovingPlatform,
  LayoutParticleEmitter,
  LayoutPlacement,
  LayoutPhysics,
  LayoutReflectionPlane,
  LayoutReflectiveSurface,
  LayoutSphereReflectionCapture,
  LayoutTargetPoint,
  MetadataValue,
  Vec3,
} from "@engine/scene/layout";
import type { WorldUiWidget } from "@engine/ui/uiWorldWidget";

export interface EditableTransformLike {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export function cloneMetadata(metadata: LayoutMetadata | undefined): LayoutMetadata {
  const clone: LayoutMetadata = {};
  if (!metadata) return clone;
  for (const [key, value] of Object.entries(metadata)) {
    clone[key] = cloneMetadataValue(value) as MetadataValue;
  }
  return clone;
}

export function cloneMetadataValue(
  value: MetadataValue | undefined,
): MetadataValue | undefined {
  return Array.isArray(value) ? [...value] : value;
}

export function cloneScale(scale: number | Vec3): number | Vec3 {
  return Array.isArray(scale) ? [scale[0], scale[1], scale[2]] : scale;
}

export function cloneBehavior(behavior: LayoutBehavior): LayoutBehavior {
  const clone: LayoutBehavior = { script: behavior.script };
  if (behavior.params) clone.params = cloneMetadata(behavior.params);
  return clone;
}

export function cloneParticle(particle: LayoutParticleEmitter): LayoutParticleEmitter {
  // All override fields are primitives now, so a shallow spread is a full copy.
  return { ...particle };
}

export function cloneMovingPlatform(platform: LayoutMovingPlatform): LayoutMovingPlatform {
  const clone: LayoutMovingPlatform = {
    offset: [...platform.offset],
    speed: platform.speed,
  };
  if (platform.startPhase !== undefined) clone.startPhase = platform.startPhase;
  return clone;
}

export function clonePhysics(physics: LayoutPhysics | undefined): LayoutPhysics | undefined {
  if (!physics) return undefined;
  const clone: LayoutPhysics = {};
  if (physics.massKg !== undefined) clone.massKg = physics.massKg;
  if (physics.linearDamping !== undefined) clone.linearDamping = physics.linearDamping;
  if (physics.angularDamping !== undefined) clone.angularDamping = physics.angularDamping;
  if (physics.enableGravity !== undefined) clone.enableGravity = physics.enableGravity;
  if (physics.lockPosition !== undefined) clone.lockPosition = [...physics.lockPosition];
  if (physics.lockRotation !== undefined) clone.lockRotation = [...physics.lockRotation];
  return Object.keys(clone).length > 0 ? clone : undefined;
}

export function clonePlacement(placement: LayoutPlacement): LayoutPlacement {
  const clone: LayoutPlacement = {
    position: [...placement.position],
  };
  if (placement.name !== undefined) clone.name = placement.name;
  if (placement.hidden !== undefined) clone.hidden = placement.hidden;
  if (placement.locked !== undefined) clone.locked = placement.locked;
  if (placement.groupId !== undefined) clone.groupId = placement.groupId;
  if (placement.rotationYDeg !== undefined) clone.rotationYDeg = placement.rotationYDeg;
  if (placement.rotation !== undefined) clone.rotation = [...placement.rotation];
  if (placement.pivot !== undefined) clone.pivot = [...placement.pivot];
  if (placement.scale !== undefined) clone.scale = cloneScale(placement.scale);
  if (placement.scaleLocked !== undefined) clone.scaleLocked = placement.scaleLocked;
  if (placement.castShadow !== undefined) clone.castShadow = placement.castShadow;
  if (placement.collision !== undefined) clone.collision = placement.collision;
  if (placement.collisionPreset !== undefined) clone.collisionPreset = placement.collisionPreset;
  if (placement.collisionEnabled !== undefined) clone.collisionEnabled = placement.collisionEnabled;
  if (placement.objectType !== undefined) clone.objectType = placement.objectType;
  if (placement.responses !== undefined) clone.responses = { ...placement.responses };
  if (placement.physicalMaterialId !== undefined) clone.physicalMaterialId = placement.physicalMaterialId;
  if (placement.navigationRole !== undefined) clone.navigationRole = placement.navigationRole;
  if (placement.generateOverlapEvents !== undefined) {
    clone.generateOverlapEvents = placement.generateOverlapEvents;
  }
  if (placement.simulationGeneratesHitEvents !== undefined) {
    clone.simulationGeneratesHitEvents = placement.simulationGeneratesHitEvents;
  }
  if (placement.materialSlot !== undefined) clone.materialSlot = placement.materialSlot;
  if (placement.sensor !== undefined) clone.sensor = placement.sensor;
  if (placement.simulatePhysics !== undefined) clone.simulatePhysics = placement.simulatePhysics;
  if (placement.physics !== undefined) {
    const physics = clonePhysics(placement.physics);
    if (physics) clone.physics = physics;
  }
  if (placement.metadata !== undefined) clone.metadata = cloneMetadata(placement.metadata);
  if (placement.audio !== undefined) clone.audio = { ...placement.audio };
  if (placement.behavior !== undefined) clone.behavior = cloneBehavior(placement.behavior);
  if (placement.particle !== undefined) clone.particle = cloneParticle(placement.particle);
  if (placement.interaction !== undefined) clone.interaction = { ...placement.interaction };
  if (placement.movingPlatform !== undefined) {
    clone.movingPlatform = cloneMovingPlatform(placement.movingPlatform);
  }
  if (placement.nodeId !== undefined) clone.nodeId = placement.nodeId;
  if (placement.parentId !== undefined) clone.parentId = placement.parentId;
  return clone;
}

export function cloneUngroupedPlacement(placement: LayoutPlacement): LayoutPlacement {
  const clone = clonePlacement(placement);
  delete clone.groupId;
  return clone;
}

export function cloneCharacter(character: LayoutCharacter): LayoutCharacter {
  const clone: LayoutCharacter = {
    assetId: character.assetId,
    position: [...character.position],
  };
  if (character.name !== undefined) clone.name = character.name;
  if (character.hidden !== undefined) clone.hidden = character.hidden;
  if (character.locked !== undefined) clone.locked = character.locked;
  if (character.groupId !== undefined) clone.groupId = character.groupId;
  if (character.rotationYDeg !== undefined) clone.rotationYDeg = character.rotationYDeg;
  if (character.rotation !== undefined) clone.rotation = [...character.rotation];
  if (character.pivot !== undefined) clone.pivot = [...character.pivot];
  if (character.scale !== undefined) clone.scale = cloneScale(character.scale);
  if (character.scaleLocked !== undefined) clone.scaleLocked = character.scaleLocked;
  if (character.castShadow !== undefined) clone.castShadow = character.castShadow;
  if (character.collision !== undefined) clone.collision = character.collision;
  if (character.collisionPreset !== undefined) clone.collisionPreset = character.collisionPreset;
  if (character.collisionEnabled !== undefined) clone.collisionEnabled = character.collisionEnabled;
  if (character.objectType !== undefined) clone.objectType = character.objectType;
  if (character.responses !== undefined) clone.responses = { ...character.responses };
  if (character.physicalMaterialId !== undefined) clone.physicalMaterialId = character.physicalMaterialId;
  if (character.generateOverlapEvents !== undefined) {
    clone.generateOverlapEvents = character.generateOverlapEvents;
  }
  if (character.simulationGeneratesHitEvents !== undefined) {
    clone.simulationGeneratesHitEvents = character.simulationGeneratesHitEvents;
  }
  if (character.sensor !== undefined) clone.sensor = character.sensor;
  if (character.simulatePhysics !== undefined) clone.simulatePhysics = character.simulatePhysics;
  if (character.physics !== undefined) {
    const physics = clonePhysics(character.physics);
    if (physics) clone.physics = physics;
  }
  if (character.metadata !== undefined) clone.metadata = cloneMetadata(character.metadata);
  if (character.audio !== undefined) clone.audio = { ...character.audio };
  if (character.behavior !== undefined) clone.behavior = cloneBehavior(character.behavior);
  if (character.particle !== undefined) clone.particle = cloneParticle(character.particle);
  if (character.interaction !== undefined) clone.interaction = { ...character.interaction };
  if (character.nodeId !== undefined) clone.nodeId = character.nodeId;
  if (character.parentId !== undefined) clone.parentId = character.parentId;
  if (character.animation !== undefined) clone.animation = character.animation;
  return clone;
}

export function cloneUngroupedCharacter(character: LayoutCharacter): LayoutCharacter {
  const clone = cloneCharacter(character);
  delete clone.groupId;
  return clone;
}

export function cloneActorInstance(actor: LayoutActorInstance): LayoutActorInstance {
  const clone: LayoutActorInstance = {
    classRef: actor.classRef,
    position: [...actor.position],
  };
  if (actor.name !== undefined) clone.name = actor.name;
  if (actor.hidden !== undefined) clone.hidden = actor.hidden;
  if (actor.locked !== undefined) clone.locked = actor.locked;
  if (actor.groupId !== undefined) clone.groupId = actor.groupId;
  if (actor.nodeId !== undefined) clone.nodeId = actor.nodeId;
  if (actor.parentId !== undefined) clone.parentId = actor.parentId;
  if (actor.rotationYDeg !== undefined) clone.rotationYDeg = actor.rotationYDeg;
  if (actor.rotation !== undefined) clone.rotation = [...actor.rotation];
  if (actor.scale !== undefined) clone.scale = cloneScale(actor.scale);
  if (actor.scaleLocked !== undefined) clone.scaleLocked = actor.scaleLocked;
  // Not just a spread: a tags override is an array, and copying it by reference
  // would let an undo snapshot and the live layout share one list.
  if (actor.variableOverrides !== undefined) clone.variableOverrides = cloneMetadata(actor.variableOverrides);
  if (actor.patrolRoute !== undefined) clone.patrolRoute = { ...actor.patrolRoute };
  return clone;
}

export function cloneUngroupedActorInstance(actor: LayoutActorInstance): LayoutActorInstance {
  const clone = cloneActorInstance(actor);
  delete clone.groupId;
  return clone;
}

export function cloneLightActor(light: LayoutLightActor): LayoutLightActor {
  const clone: LayoutLightActor = {
    id: light.id,
    type: light.type,
    position: [...light.position],
  };
  if (light.name !== undefined) clone.name = light.name;
  if (light.hidden !== undefined) clone.hidden = light.hidden;
  if (light.locked !== undefined) clone.locked = light.locked;
  if (light.scaleLocked !== undefined) clone.scaleLocked = light.scaleLocked;
  if (light.groupId !== undefined) clone.groupId = light.groupId;
  if (light.nodeId !== undefined) clone.nodeId = light.nodeId;
  if (light.parentId !== undefined) clone.parentId = light.parentId;
  if (light.rotation !== undefined) clone.rotation = [...light.rotation];
  if (light.color !== undefined) clone.color = light.color;
  if (light.intensity !== undefined) clone.intensity = light.intensity;
  if (light.castShadow !== undefined) clone.castShadow = light.castShadow;
  if (light.distance !== undefined) clone.distance = light.distance;
  if (light.angle !== undefined) clone.angle = light.angle;
  if (light.penumbra !== undefined) clone.penumbra = light.penumbra;
  if (light.decay !== undefined) clone.decay = light.decay;
  return clone;
}

export function cloneUngroupedLightActor(light: LayoutLightActor): LayoutLightActor {
  const clone = cloneLightActor(light);
  delete clone.groupId;
  return clone;
}

export function cloneReflectionPlane(plane: LayoutReflectionPlane): LayoutReflectionPlane {
  const clone: LayoutReflectionPlane = {
    id: plane.id,
    position: [...plane.position],
  };
  if (plane.name !== undefined) clone.name = plane.name;
  if (plane.hidden !== undefined) clone.hidden = plane.hidden;
  if (plane.locked !== undefined) clone.locked = plane.locked;
  if (plane.scaleLocked !== undefined) clone.scaleLocked = plane.scaleLocked;
  if (plane.groupId !== undefined) clone.groupId = plane.groupId;
  if (plane.nodeId !== undefined) clone.nodeId = plane.nodeId;
  if (plane.parentId !== undefined) clone.parentId = plane.parentId;
  if (plane.rotation !== undefined) clone.rotation = [...plane.rotation];
  if (plane.scale !== undefined) clone.scale = cloneScale(plane.scale);
  if (plane.color !== undefined) clone.color = plane.color;
  if (plane.resolution !== undefined) clone.resolution = plane.resolution;
  return clone;
}

export function cloneReflectiveSurface(
  surface: LayoutReflectiveSurface,
): LayoutReflectiveSurface {
  const clone: LayoutReflectiveSurface = {
    id: surface.id,
    position: [...surface.position],
  };
  if (surface.name !== undefined) clone.name = surface.name;
  if (surface.hidden !== undefined) clone.hidden = surface.hidden;
  if (surface.locked !== undefined) clone.locked = surface.locked;
  if (surface.scaleLocked !== undefined) clone.scaleLocked = surface.scaleLocked;
  if (surface.groupId !== undefined) clone.groupId = surface.groupId;
  if (surface.nodeId !== undefined) clone.nodeId = surface.nodeId;
  if (surface.parentId !== undefined) clone.parentId = surface.parentId;
  if (surface.rotation !== undefined) clone.rotation = [...surface.rotation];
  if (surface.scale !== undefined) clone.scale = cloneScale(surface.scale);
  if (surface.material !== undefined) clone.material = surface.material;
  if (surface.reflectionStrength !== undefined) clone.reflectionStrength = surface.reflectionStrength;
  if (surface.fresnelPower !== undefined) clone.fresnelPower = surface.fresnelPower;
  if (surface.fresnelBias !== undefined) clone.fresnelBias = surface.fresnelBias;
  if (surface.distortion !== undefined) clone.distortion = surface.distortion;
  if (surface.tint !== undefined) clone.tint = surface.tint;
  if (surface.resolution !== undefined) clone.resolution = surface.resolution;
  return clone;
}

export function cloneSphereReflectionCapture(
  capture: LayoutSphereReflectionCapture,
): LayoutSphereReflectionCapture {
  const clone: LayoutSphereReflectionCapture = {
    id: capture.id,
    position: [...capture.position],
  };
  if (capture.name !== undefined) clone.name = capture.name;
  if (capture.hidden !== undefined) clone.hidden = capture.hidden;
  if (capture.locked !== undefined) clone.locked = capture.locked;
  if (capture.scaleLocked !== undefined) clone.scaleLocked = capture.scaleLocked;
  if (capture.groupId !== undefined) clone.groupId = capture.groupId;
  if (capture.nodeId !== undefined) clone.nodeId = capture.nodeId;
  if (capture.parentId !== undefined) clone.parentId = capture.parentId;
  if (capture.rotation !== undefined) clone.rotation = [...capture.rotation];
  if (capture.radius !== undefined) clone.radius = capture.radius;
  if (capture.intensity !== undefined) clone.intensity = capture.intensity;
  if (capture.resolution !== undefined) clone.resolution = capture.resolution;
  if (capture.near !== undefined) clone.near = capture.near;
  if (capture.far !== undefined) clone.far = capture.far;
  if (capture.parallax !== undefined) clone.parallax = capture.parallax;
  if (capture.priority !== undefined) clone.priority = capture.priority;
  return clone;
}

export function cloneLandscape(landscape: LayoutLandscape): LayoutLandscape {
  const clone: LayoutLandscape = {
    id: landscape.id,
    position: [...landscape.position],
    dataRef: landscape.dataRef,
  };
  if (landscape.name !== undefined) clone.name = landscape.name;
  if (landscape.hidden !== undefined) clone.hidden = landscape.hidden;
  if (landscape.locked !== undefined) clone.locked = landscape.locked;
  if (landscape.scaleLocked !== undefined) clone.scaleLocked = landscape.scaleLocked;
  if (landscape.groupId !== undefined) clone.groupId = landscape.groupId;
  if (landscape.nodeId !== undefined) clone.nodeId = landscape.nodeId;
  if (landscape.parentId !== undefined) clone.parentId = landscape.parentId;
  if (landscape.rotation !== undefined) clone.rotation = [...landscape.rotation];
  if (landscape.material !== undefined) clone.material = landscape.material;
  if (landscape.collision !== undefined) clone.collision = landscape.collision;
  return clone;
}

export function cloneBlockingVolume(volume: LayoutBlockingVolume): LayoutBlockingVolume {
  const clone: LayoutBlockingVolume = {
    id: volume.id,
    position: [...volume.position],
  };
  if (volume.name !== undefined) clone.name = volume.name;
  if (volume.hidden !== undefined) clone.hidden = volume.hidden;
  if (volume.locked !== undefined) clone.locked = volume.locked;
  if (volume.scaleLocked !== undefined) clone.scaleLocked = volume.scaleLocked;
  if (volume.groupId !== undefined) clone.groupId = volume.groupId;
  if (volume.nodeId !== undefined) clone.nodeId = volume.nodeId;
  if (volume.parentId !== undefined) clone.parentId = volume.parentId;
  if (volume.rotation !== undefined) clone.rotation = [...volume.rotation];
  if (volume.scale !== undefined) clone.scale = cloneScale(volume.scale);
  if (volume.brushShape !== undefined) clone.brushShape = volume.brushShape;
  if (volume.size !== undefined) clone.size = [...volume.size];
  if (volume.brushSides !== undefined) clone.brushSides = volume.brushSides;
  if (volume.renderInGame !== undefined) clone.renderInGame = volume.renderInGame;
  if (volume.color !== undefined) clone.color = volume.color;
  return clone;
}

export function cloneAiNavigationVolume(
  volume: LayoutAiNavigationVolume,
): LayoutAiNavigationVolume {
  const clone: LayoutAiNavigationVolume = {
    id: volume.id,
    position: [...volume.position],
  };
  if (volume.name !== undefined) clone.name = volume.name;
  if (volume.hidden !== undefined) clone.hidden = volume.hidden;
  if (volume.locked !== undefined) clone.locked = volume.locked;
  if (volume.scaleLocked !== undefined) clone.scaleLocked = volume.scaleLocked;
  if (volume.groupId !== undefined) clone.groupId = volume.groupId;
  if (volume.nodeId !== undefined) clone.nodeId = volume.nodeId;
  if (volume.parentId !== undefined) clone.parentId = volume.parentId;
  if (volume.rotation !== undefined) clone.rotation = [...volume.rotation];
  if (volume.scale !== undefined) clone.scale = cloneScale(volume.scale);
  if (volume.size !== undefined) clone.size = [...volume.size];
  if (volume.agentRadius !== undefined) clone.agentRadius = volume.agentRadius;
  if (volume.clearancePadding !== undefined) clone.clearancePadding = volume.clearancePadding;
  return clone;
}

export function cloneTargetPoint(point: LayoutTargetPoint): LayoutTargetPoint {
  const clone: LayoutTargetPoint = {
    id: point.id,
    position: [...point.position],
  };
  if (point.name !== undefined) clone.name = point.name;
  if (point.hidden !== undefined) clone.hidden = point.hidden;
  if (point.locked !== undefined) clone.locked = point.locked;
  if (point.scaleLocked !== undefined) clone.scaleLocked = point.scaleLocked;
  if (point.groupId !== undefined) clone.groupId = point.groupId;
  if (point.nodeId !== undefined) clone.nodeId = point.nodeId;
  if (point.parentId !== undefined) clone.parentId = point.parentId;
  if (point.rotation !== undefined) clone.rotation = [...point.rotation];
  if (point.scale !== undefined) clone.scale = cloneScale(point.scale);
  if (point.nextTargetPoint !== undefined) clone.nextTargetPoint = point.nextTargetPoint;
  if (point.startPoint !== undefined) clone.startPoint = point.startPoint;
  if (point.waitTime !== undefined) clone.waitTime = point.waitTime;
  if (point.acceptanceRadius !== undefined) clone.acceptanceRadius = point.acceptanceRadius;
  if (point.speedOverride !== undefined) clone.speedOverride = point.speedOverride;
  if (point.patrolTag !== undefined) clone.patrolTag = point.patrolTag;
  if (point.color !== undefined) clone.color = point.color;
  return clone;
}

export function cloneWorldWidget(widget: WorldUiWidget): WorldUiWidget {
  const clone: WorldUiWidget = {
    widget: widget.widget,
    anchor: { worldPos: [...widget.anchor.worldPos] },
  };
  if (widget.anchor.entityId !== undefined) clone.anchor.entityId = widget.anchor.entityId;
  if (widget.anchor.offset3d !== undefined) clone.anchor.offset3d = [...widget.anchor.offset3d];
  if (widget.space !== undefined) clone.space = widget.space;
  if (widget.offset !== undefined) clone.offset = [widget.offset[0], widget.offset[1]];
  if (widget.maxDistance !== undefined) clone.maxDistance = widget.maxDistance;
  return clone;
}

export function transformsEqual(
  left: EditableTransformLike,
  right: EditableTransformLike,
): boolean {
  return (
    vecEqual(left.position, right.position) &&
    vecEqual(left.rotation, right.rotation) &&
    vecEqual(left.scale, right.scale)
  );
}

export function vecEqual(left: Vec3, right: Vec3): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

export function lightActorsEqual(left: LayoutLightActor, right: LayoutLightActor): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
