import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { WebGLRenderer } from "three";

import {
  projectFileUrl,
  projectPublicFileUrl,
  type ProjectManifest,
} from "@/project/ProjectSystem";
import {
  assetRecordById,
  assetPath,
  assetType,
  editableAssetsFromManifest,
  isModelAssetType,
  recordsForGroup,
  readAssetManifest,
  totalBytesForGroups,
} from "@engine/assets/manifest";
import type {
  AssetCatalog,
  AssetManifest,
  AssetRecord,
  EditableAsset,
} from "@engine/assets/manifest";
import type { MetadataSchema } from "@engine/scene/metadataSchema";
import { GltfModelLoader } from "@engine/render-three/gltfModelLoader";
import { readContentJson } from "@/project/contentLoader";

export type {
  AssetCatalog,
  AssetCatalogRecord,
  AssetManifest,
  AssetPlacementRules,
  AssetRecord,
  EditableAsset,
  PlacementSurface,
} from "@engine/assets/manifest";

/**
 * Optional per-model load reporter (Boot / Loading UX, P4). Every model that
 * passes through {@link AssetLoader.loadModel} — across load groups, missing
 * scene models and actor meshes — reports its settle here, so the runtime can
 * drive a loading bar without the loader knowing what a "progress tracker" is.
 */
export interface ModelLoadProgress {
  onLoaded(id: string): void;
  onFailed(id: string, error: unknown): void;
}

export class AssetLoader {
  private manifestPromise: Promise<AssetManifest> | null = null;
  private catalogPromise: Promise<AssetCatalog | null> | null = null;
  private metadataSchemaPromise: Promise<MetadataSchema | null> | null = null;
  private readonly modelLoader: GltfModelLoader;

  constructor(
    private readonly project: ProjectManifest,
    renderer?: WebGLRenderer,
    private readonly modelProgress?: ModelLoadProgress,
  ) {
    this.modelLoader = new GltfModelLoader(renderer);
  }

  /** Drops the cached manifest so the next load re-fetches it (after edits). */
  invalidateManifest(): void {
    this.manifestPromise = null;
  }

  loadManifest(): Promise<AssetManifest> {
    const path = this.project.editor.assetManifest;
    this.manifestPromise ??= readContentJson(path).then((raw) => readAssetManifest(raw, path)).catch((error: unknown) => {
      this.manifestPromise = null;
      throw error;
    });
    return this.manifestPromise;
  }

  loadCatalog(): Promise<AssetCatalog | null> {
    const catalogPath = this.project.editor.assetCatalog;
    if (!catalogPath) return Promise.resolve(null);
    this.catalogPromise ??= fetch(projectFileUrl(catalogPath)).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Asset catalog failed: ${response.status} ${response.statusText}`);
      }
      return (await response.json()) as AssetCatalog;
    });
    return this.catalogPromise;
  }

  loadMetadataSchema(): Promise<MetadataSchema | null> {
    const schemaPath = this.project.editor.metadataSchema;
    if (!schemaPath) return Promise.resolve(null);
    this.metadataSchemaPromise ??= fetch(projectFileUrl(schemaPath)).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Metadata schema failed: ${response.status} ${response.statusText}`);
      }
      return (await response.json()) as MetadataSchema;
    });
    return this.metadataSchemaPromise;
  }

  async loadEditableAssets(): Promise<EditableAsset[]> {
    const [manifest, catalog] = await Promise.all([
      this.loadManifest(),
      this.loadCatalog().catch(() => null),
    ]);
    return editableAssetsFromManifest(manifest, catalog);
  }

  async recordsForGroup(loadGroup: string): Promise<AssetRecord[]> {
    const manifest = await this.loadManifest();
    return recordsForGroup(manifest, loadGroup).filter((record) =>
      isModelAssetType(assetType(record)),
    );
  }

  async loadGroup(loadGroup: string): Promise<Map<string, GLTF>> {
    const records = await this.recordsForGroup(loadGroup);
    const entries = await Promise.all(
      records.map(async (record) => [record.id, await this.loadModel(record.id)] as const),
    );
    return new Map(entries);
  }

  async loadGroups(loadGroups: string[]): Promise<Map<string, GLTF>> {
    const groups = await Promise.all(
      loadGroups.map((loadGroup) => this.loadGroup(loadGroup)),
    );
    const models = new Map<string, GLTF>();
    for (const group of groups) {
      for (const [id, model] of group) models.set(id, model);
    }
    return models;
  }

  async loadModels(ids: readonly string[]): Promise<Map<string, GLTF>> {
    const uniqueIds = [...new Set(ids)];
    const entries = await Promise.all(
      uniqueIds.map(async (id) => [id, await this.loadModel(id)] as const),
    );
    return new Map(entries);
  }

  async loadModel(id: string): Promise<GLTF> {
    const manifest = await this.loadManifest();
    const record = assetRecordById(manifest, id);
    if (!record) throw new Error(`Asset not found in manifest: ${id}`);
    if (!isModelAssetType(assetType(record))) {
      throw new Error(`Asset is not a loadable mesh: ${id}`);
    }
    try {
      const gltf = await this.modelLoader.load(
        id,
        projectPublicFileUrl(this.project, assetPath(record)),
      );
      this.modelProgress?.onLoaded(id);
      return gltf;
    } catch (error) {
      this.modelProgress?.onFailed(id, error);
      throw error;
    }
  }

  async totalBytesForGroups(loadGroups: string[]): Promise<number> {
    const manifest = await this.loadManifest();
    return totalBytesForGroups(manifest, loadGroups);
  }

}
