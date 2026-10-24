import type { Entity } from "./entity";

export const SCENE_DOCUMENT_SCHEMA_VERSION = 1;

export interface SceneWorldSettings {
  backgroundColor?: string;
  ambientColor?: string;
  ambientIntensity?: number;
  staticObjectsCastShadow?: boolean;
  staticObjectsReceiveShadow?: boolean;
  killZ?: number;
  viewDistance?: number;
}

export interface SceneDocument {
  schema: typeof SCENE_DOCUMENT_SCHEMA_VERSION;
  name: string;
  entities: Entity[];
  worldSettings?: SceneWorldSettings;
}
