/**
 * The narrow, stable context a Layer 2 capability module receives once the
 * LevelRuntime pipeline has built a level's scene content.
 *
 * Deliberately small: modules get the shell-independent facts about the loaded
 * level (scene graph, camera, engine spine, asset loader, authored layout and
 * the derived scene document) and nothing else. Widening this surface would let
 * modules reach back into a shell's private orchestration, which is exactly the
 * coupling the layered runtime plan removes.
 */
import type { PerspectiveCamera, Scene } from "three";

import type { EngineApp } from "@engine/core/EngineApp";
import type { Entity } from "@engine/scene/entity";
import type { RoomLayout } from "@engine/scene/layout";
import type { SceneDocument } from "@engine/scene/sceneDocument";

import type { LevelRuntimeMode } from "../LevelRuntime";
import type { AssetLoader } from "../assetLoader";

export interface RuntimeContextInit {
  /** Which shell built the level; modules that are runtime-only can bail on "editor". */
  readonly mode: LevelRuntimeMode;
  /** Public-root relative path of the level that was just built. */
  readonly levelPath: string;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly engineApp: EngineApp;
  readonly assetLoader: AssetLoader;
  readonly layout: RoomLayout;
  /**
   * The document actually fed to the engine subsystems — already includes the
   * flattened actor, landscape and spline collider entities, so a module never
   * has to re-derive them from the layout.
   */
  readonly sceneDocument: SceneDocument;
}

export interface RuntimeContext extends RuntimeContextInit {
  /** Every entity of the built level, in scene-document order. */
  readonly entities: readonly Entity[];
  /** Entity lookup by id, or undefined when this level has no such entity. */
  entity(id: string): Entity | undefined;
}

/**
 * Wraps the raw init facts with the id lookup modules would otherwise each
 * rebuild. The index is built lazily so a module set that never looks entities
 * up costs nothing on levels with thousands of entities.
 */
export function createRuntimeContext(init: RuntimeContextInit): RuntimeContext {
  let index: Map<string, Entity> | null = null;
  return {
    ...init,
    get entities(): readonly Entity[] {
      return init.sceneDocument.entities;
    },
    entity(id: string): Entity | undefined {
      if (!index) {
        index = new Map<string, Entity>();
        for (const entity of init.sceneDocument.entities) index.set(entity.id, entity);
      }
      return index.get(id);
    },
  };
}
