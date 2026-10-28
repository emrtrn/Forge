/**
 * `LayoutPlacement.color` (World Builder F1 step 12a): a `#rrggbb` base colour
 * replacing the material's, used by role placeholders. It survives save and
 * undo snapshots, the save rejects anything else, and instanced rendering
 * shows exactly that colour while uncoloured instances keep the material's.
 */
import assert from "node:assert/strict";
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Matrix4 } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { clonePlacement } from "../../editor/core/layoutSnapshots";
import { createInstancedModelGroup, tintedMaterial } from "../../engine/render-three/models";
import type { LayoutPlacement } from "../../engine/scene/layout";
import { collectDroppedFields } from "../../tools/droppedFields";
import { validatePlacement } from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;

function model(color: string): { gltf: GLTF; material: MeshStandardMaterial } {
  const material = new MeshStandardMaterial({ color });
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(1, 1, 1), material));
  return { gltf: { scene } as unknown as GLTF, material };
}

const close = (a: Color, b: Color) => Math.abs(a.r - b.r) < 1e-6 && Math.abs(a.g - b.g) < 1e-6 && Math.abs(a.b - b.b) < 1e-6;

export function registerPlacementColorTests(check: Check): void {
  check("placement color: #rrggbb survives the save and undo snapshots; anything else is rejected", () => {
    const authored: LayoutPlacement = { id: "wb-building-v1.p1", role: "building.civic.hall", position: [1, 0, 2], color: "#7b4fc4" };
    const saved = validatePlacement(authored);
    assert.equal(saved.color, "#7b4fc4");
    assert.deepEqual(collectDroppedFields(authored, saved).paths, []);
    assert.equal(clonePlacement(authored).color, "#7b4fc4");
    assert.equal("color" in validatePlacement({ position: [0, 0, 0] }), false);
    for (const color of ["red", "#fff", "#12345g", 7]) {
      assert.throws(() => validatePlacement({ position: [0, 0, 0], color }), /placement color must be a #rrggbb color/, String(color));
    }
  });

  check("placement color: instances show their colour over the material's; uncoloured ones keep it", () => {
    const { gltf, material } = model("#b9c0c6");
    const items = [
      { matrix: new Matrix4(), hidden: false, color: "#f2a65a" },
      { matrix: new Matrix4(), hidden: false },
    ];
    const [mesh] = createInstancedModelGroup({ assetId: "shape:cube", gltf, items, castShadow: false, receiveShadow: false }).meshes;
    assert.ok(mesh!.instanceColor, "an instance colour buffer");
    const shown = (index: number) => {
      const instance = new Color();
      mesh!.getColorAt(index, instance);
      return instance.multiply(material.color);
    };
    assert.ok(close(shown(0), new Color("#f2a65a")), shown(0).getHexString());
    assert.ok(close(shown(1), material.color));

    const plain = createInstancedModelGroup({ assetId: "shape:cube", gltf: model("#ffffff").gltf, items: [items[1]!], castShadow: false, receiveShadow: false });
    assert.equal(plain.meshes[0]!.instanceColor, null, "no buffer without colours");
  });

  check("placement color: a clone's tinted material copy takes the colour and is owned for disposal", () => {
    const { material } = model("#b9c0c6");
    const owned: MeshStandardMaterial[] = [];
    const tinted = tintedMaterial(material, "#2f7fd8", owned);
    assert.notEqual(tinted, material);
    assert.equal(tinted.color.getHexString(), "2f7fd8");
    assert.equal(material.color.getHexString(), "b9c0c6");
    assert.deepEqual(owned, [tinted]);
  });
}
