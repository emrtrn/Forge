import assert from "node:assert/strict";
import { Box3, BoxGeometry, Group, Matrix4, Mesh, Object3D, ShaderChunk, ShaderLib, Vector3 } from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

import { REFLECTION_CAPTURE_SHADER_ANCHORS } from "../../engine/render-three/reflectionCapture";
import { setFixedMatrix } from "../../engine/render-three/transforms";
import { WORLD_MASK_SHADER_SOURCE } from "../../engine/render-three/worldMaskPatch";

type Check = (label: string, fn: () => void) => void;

/**
 * Text Forge's `onBeforeCompile` patches anchor on. Most patches check for their
 * anchor and quietly do nothing when it is gone, so after a three upgrade the
 * picture is just a little wrong. This list makes that upgrade fail here instead.
 * A new patch adds its anchors; one that stops using an include removes it.
 */
const STANDARD_VERTEX_INCLUDES = [
  "#include <common>",
  "#include <begin_vertex>",
  "#include <beginnormal_vertex>",
  "#include <project_vertex>",
  "#include <worldpos_vertex>",
];

const STANDARD_FRAGMENT_INCLUDES = [
  "#include <common>",
  "#include <clipping_planes_fragment>",
  "#include <color_fragment>",
  "#include <map_fragment>",
  "#include <alphamap_fragment>",
  "#include <alphatest_fragment>",
  "#include <roughnessmap_fragment>",
  "#include <metalnessmap_fragment>",
  "#include <emissivemap_fragment>",
  "#include <aomap_fragment>",
  "#include <normal_pars_fragment>",
  "#include <normal_fragment_begin>",
  "#include <normal_fragment_maps>",
  "#include <lights_pars_begin>",
  "#include <lights_fragment_begin>",
  "#include <lights_fragment_maps>",
  "#include <lights_fragment_end>",
  "#include <envmap_physical_pars_fragment>",
  "#include <opaque_fragment>",
];

function assertAnchors(source: string, anchors: readonly string[], where: string): void {
  const missing = anchors.filter((anchor) => !source.includes(anchor));
  assert.deepEqual(missing, [], `${where} lost anchors Forge patches on`);
}

export function registerShaderChunkAnchorTests(check: Check): void {
  check("shader anchors: the standard material keeps every include Forge patches", () => {
    assertAnchors(ShaderLib.standard.vertexShader, STANDARD_VERTEX_INCLUDES, "standard vertex shader");
    assertAnchors(ShaderLib.standard.fragmentShader, STANDARD_FRAGMENT_INCLUDES, "standard fragment shader");
  });

  check("shader anchors: AO normal pass, mesh paint view and moon disc", () => {
    assertAnchors(
      ShaderLib.normal.fragmentShader,
      ["#define NORMAL", "#include <uv_pars_fragment>", "#include <clipping_planes_fragment>"],
      "normal fragment shader",
    );
    assertAnchors(ShaderLib.basic.fragmentShader, ["#include <color_fragment>"], "basic fragment shader");
    assertAnchors(new Sky().material.fragmentShader, ["#include <tonemapping_fragment>"], "Sky fragment shader");
  });

  check("shader anchors: world mask patch", () => {
    assertAnchors(ShaderLib.standard.vertexShader, [WORLD_MASK_SHADER_SOURCE.vertexAnchor], "standard vertex shader");
    assertAnchors(ShaderLib.standard.fragmentShader, [WORLD_MASK_SHADER_SOURCE.fragmentAnchor], "standard fragment shader");
  });

  check("shader anchors: reflection capture lines exist in the IBL chunk", () => {
    const { reflectLine, envColorLine, irradianceLine, worldPositionInclude, fragmentInclude } = REFLECTION_CAPTURE_SHADER_ANCHORS;
    assertAnchors(ShaderChunk.envmap_physical_pars_fragment, [reflectLine, envColorLine, irradianceLine], "envmap_physical_pars_fragment");
    assertAnchors(ShaderLib.standard.vertexShader, [worldPositionInclude], "standard vertex shader");
    assertAnchors(ShaderLib.standard.fragmentShader, [fragmentInclude], "standard fragment shader");
  });

  check("setFixedMatrix: bounds are right before the first render", () => {
    const parent = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));
    parent.add(mesh);
    setFixedMatrix(mesh, new Matrix4().makeTranslation(10, 0, 0));
    assert.equal(new Box3().setFromObject(mesh).getCenter(new Vector3()).x, 10);
  });

  check("setFixedMatrix: a world position query needs no render either", () => {
    const object = new Object3D();
    setFixedMatrix(object, new Matrix4().makeTranslation(0, 7, 0));
    assert.equal(object.getWorldPosition(new Vector3()).y, 7);
    assert.equal(object.matrixAutoUpdate, false);
  });
}
