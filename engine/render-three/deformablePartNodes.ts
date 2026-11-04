/**
 * Reads a model's node tree for the Static Mesh Editor's deformable parts.
 *
 * A glTF exporter usually wraps each mesh in a node of the object's own name
 * (`Door_L` holding `Door_L_Gaz-52_0`), so that wrapper is the name worth showing
 * and the node that moves when the part tears off.
 */
import { Box3, Matrix4, type Mesh, type Object3D } from "three";

import type { DeformableVec3 } from "../physics/deformable/deformableTypes";

const isMesh = (object: Object3D): object is Mesh => (object as Mesh).isMesh === true;

/** How many meshes sit at or below a node. */
function meshCount(node: Object3D): number {
  let count = 0;
  node.traverse((object) => {
    if (isMesh(object)) count += 1;
  });
  return count;
}

/** The node a part should name for a mesh: its wrapper when it wraps nothing else, or the mesh. */
export function partNodeOfMesh(mesh: Object3D, root: Object3D): Object3D {
  const parent = mesh.parent;
  return parent && parent !== root && meshCount(parent) === 1 ? parent : mesh;
}

/** Every node a part can name, each once, in scene order. Unnamed nodes cannot be saved, so they are left out. */
export function modelPartNodes(root: Object3D): string[] {
  const names = new Set<string>();
  root.traverse((object) => {
    if (isMesh(object)) {
      const name = partNodeOfMesh(object, root).name;
      if (name) names.add(name);
    }
  });
  return [...names];
}

/** The box of the named nodes in the root's space; null when none of them is in the model. */
export function nodeBounds(root: Object3D, names: readonly string[]): { min: DeformableVec3; max: DeformableVec3 } | null {
  root.updateWorldMatrix(true, true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const bounds = new Box3();
  const box = new Box3();
  root.traverse((object) => {
    if (!names.includes(object.name)) return;
    box.setFromObject(object, true);
    if (!box.isEmpty()) bounds.union(box);
  });
  if (bounds.isEmpty()) return null;
  bounds.applyMatrix4(toRoot);
  return { min: bounds.min.toArray(), max: bounds.max.toArray() };
}
