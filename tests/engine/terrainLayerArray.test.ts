import assert from "node:assert/strict";
import {
  DataTexture, FloatType, LinearMipmapLinearFilter, RedFormat, RepeatWrapping, SRGBColorSpace, Texture,
  type DataArrayTexture,
} from "three";
import {
  createTerrainLayerArray,
  flipTerrainLayerRows,
  readTerrainLayerPixels,
  resampleTerrainLayer,
  TERRAIN_LAYER_ARRAY_MAX_SIZE,
  terrainLayerArraySize,
} from "../../engine/render-three/terrain/terrainLayerArray";

type Check = (label: string, fn: () => void) => void;

/** RGBA8 data texture whose texel (x, y) is `[x, y, layer, 255 - x]`. */
function gradient(width: number, height: number, layer: number, flipY = false): DataTexture {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set([x, y, layer, 255 - x], (y * width + x) * 4);
  }
  const texture = new DataTexture(data, width, height);
  texture.flipY = flipY;
  texture.anisotropy = 4 + layer;
  texture.needsUpdate = true;
  return texture;
}

function layerPixels(array: DataArrayTexture, layer: number): Uint8Array {
  const { width, height } = array.image;
  return (array.image.data as Uint8Array).subarray(layer * width * height * 4, (layer + 1) * width * height * 4);
}

/**
 * OPEN_WORLD_PLAN Faz 2 / 7c2: paint layer albedos packed into one
 * `sampler2DArray` so a textured terrain takes one texture unit, not eight.
 */
export function registerTerrainLayerArrayTests(check: Check): void {
  check("terrain layer array: shared size is the largest edge, capped", () => {
    assert.equal(terrainLayerArraySize([{ width: 512, height: 512 }, { width: 1254, height: 1254 }, { width: 1024, height: 256 }]), 1254);
    assert.equal(terrainLayerArraySize([{ width: 300, height: 900 }]), 900);
    assert.equal(terrainLayerArraySize([{ width: 8192, height: 4096 }]), TERRAIN_LAYER_ARRAY_MAX_SIZE);
  });

  check("terrain layer array: resampling copies same-size layers and blends tiling layers with wrap", () => {
    const source = { width: 2, height: 2, data: new Uint8Array([0, 0, 0, 0, 100, 100, 100, 100, 0, 0, 0, 0, 100, 100, 100, 100]) };
    const same = resampleTerrainLayer(source, 2);
    assert.deepEqual(Array.from(same), Array.from(source.data));
    assert.notEqual(same, source.data, "a copy, not the decoded cache");
    // 2 → 4 with wrap: texel 0 sits between source column 1 (wrapped) and 0.
    const up = resampleTerrainLayer(source, 4);
    assert.deepEqual([0, 1, 2, 3].map((x) => up[x * 4]), [25, 25, 75, 75]);
    // A uniform layer stays uniform at any size (no edge darkening from clamping).
    const flat = { width: 3, height: 5, data: new Uint8Array(3 * 5 * 4).fill(77) };
    assert.ok(resampleTerrainLayer(flat, 7).every((value) => value === 77));
  });

  check("terrain layer array: flipY reverses rows like the GL upload, data textures read without a canvas", () => {
    const rows = { width: 1, height: 3, data: new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]) };
    assert.deepEqual(Array.from(flipTerrainLayerRows(rows).data), [3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1]);
    const upright = readTerrainLayerPixels(gradient(2, 3, 0))!;
    assert.deepEqual(Array.from(upright.data.subarray(0, 4)), [0, 0, 0, 255], "row 0 stays v = 0");
    const flipped = readTerrainLayerPixels(gradient(2, 3, 0, true))!;
    assert.deepEqual(Array.from(flipped.data.subarray(0, 4)), [0, 2, 0, 255], "a flipY texture's last data row is v = 0");
    // Unreadable sources draw their colour instead: no image (headless), non-RGBA8 data.
    assert.equal(readTerrainLayerPixels(new Texture()), null);
    const float = new DataTexture(new Float32Array(4), 2, 2, RedFormat, FloatType);
    assert.equal(readTerrainLayerPixels(float), null);
  });

  check("terrain layer array: textured layers pack in order, untextured layers keep -1, settings match the layer textures", () => {
    const textures = [gradient(4, 4, 10), null, gradient(2, 2, 20, true), new Texture(), gradient(4, 2, 30)];
    const { texture, index } = createTerrainLayerArray(textures);
    try {
      assert.deepEqual(index, [0, -1, 1, -1, 2]);
      assert.ok(texture);
      assert.equal(texture.image.width, 4);
      assert.equal(texture.image.height, 4);
      assert.equal(texture.image.depth, 3);
      assert.deepEqual(Array.from(layerPixels(texture, 0)), Array.from(textures[0]!.image.data as Uint8Array));
      assert.ok(layerPixels(texture, 1).every((value, i) => i % 4 !== 2 || value === 20), "layer 2's texels in array layer 1");
      assert.ok(layerPixels(texture, 2).every((value, i) => i % 4 !== 2 || value === 30), "layer 4's texels in array layer 2");
      assert.equal(texture.colorSpace, SRGBColorSpace);
      assert.equal(texture.wrapS, RepeatWrapping);
      assert.equal(texture.wrapT, RepeatWrapping);
      assert.equal(texture.minFilter, LinearMipmapLinearFilter);
      assert.equal(texture.generateMipmaps, true);
      assert.equal(texture.anisotropy, 34, "the sharpest layer's anisotropy");
    } finally {
      texture?.dispose();
    }
    assert.deepEqual(createTerrainLayerArray([null, new Texture()]), { texture: null, index: [-1, -1] });
  });

  check("terrain layer array: a re-uploaded source texture is decoded again", () => {
    const texture = gradient(1, 1, 5);
    assert.equal(readTerrainLayerPixels(texture)!.data[2], 5);
    (texture.image.data as Uint8Array)[2] = 9;
    assert.equal(readTerrainLayerPixels(texture)!.data[2], 5, "cached while unchanged");
    texture.needsUpdate = true;
    assert.equal(readTerrainLayerPixels(texture)!.data[2], 9);
  });
}
