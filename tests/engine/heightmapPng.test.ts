import assert from "node:assert/strict";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { decodeHeightmapPng, encodeHeightmapPng16, HeightmapPngError } from "../../engine/terrain/heightmapPng";

type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

/** Written by Python's zlib/struct (an independent encoder): split IDAT, a tEXt chunk, every filter type. */
const FIXTURES = {
  gray16: "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFEAAAAAD4lKV6AAAAEnRFWHRDb21tZW50AGZvcmdlIHRlc3SQ2xDUAAAAB0lEQVR42mNgYFDWXRxhKgAAADVJREFUdAvKrO5ZwmhgqWYEgupGTAaWxk5m3lYhNrHMCUUGzkYexj4mgSwGlgZO+r6Wvga+AFIDDHDrX2EzAAAAAElFTkSuQmCC",
  rgb8: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEnRFWHRDb21tZW50AGZvcmdlIHRlc3SQ2xDUAAAAB0lEQVR42mPhOiH3E59D+wAAABZJREFU1fwhIyMj8595X27dunn2RjAAVe0KGynQ234AAAAASUVORK5CYII=",
  pal4: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACBAMAAABvWnspAAAACVBMVEUAAAD///+AQCBZ5Pc8AAAAEnRFWHRDb21tZW50AGZvcmdlIHRlc3SQ2xDUAAAAB0lEQVR42mNklGdSGmHKfAAAAAdJREFUeAAAAbMBJMxtt9QAAAAASUVORK5CYII=",
  gray2: "iVBORw0KGgoAAAANSUhEUgAAAAUAAAABAgAAAAB5JSOOAAAAEnRFWHRDb21tZW50AGZvcmdlIHRlc3SQ2xDUAAAAB0lEQVR42mOQbgAABO9wMgAAAARJREFUALkAnNkV/fcAAAAASUVORK5CYII=",
};
const png = (name: keyof typeof FIXTURES) => Uint8Array.from(Buffer.from(FIXTURES[name], "base64"));
const lum = (r: number, g: number, b: number, max: number) => Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) / max * 65535);

/** One chunk with a valid CRC. */
function makeChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** Rebuilds the file with `edit` applied to every `type` chunk's data. */
function editChunk(bytes: Uint8Array, type: string, edit: (data: Buffer) => Buffer): Uint8Array {
  const parts: Buffer[] = [Buffer.from(bytes.subarray(0, 8))];
  for (let at = 8; at < bytes.length;) {
    const length = Buffer.from(bytes).readUInt32BE(at);
    const name = Buffer.from(bytes.subarray(at + 4, at + 8)).toString("latin1");
    const data = Buffer.from(bytes.subarray(at + 8, at + 8 + length));
    parts.push(makeChunk(name, name === type ? edit(data) : data));
    at += length + 12;
  }
  return Uint8Array.from(Buffer.concat(parts));
}

async function rejects(bytes: Uint8Array, pattern: RegExp, options = {}): Promise<void> {
  await assert.rejects(decodeHeightmapPng(bytes, options), (error: unknown) => error instanceof HeightmapPngError && pattern.test(error.message));
}

export async function registerHeightmapPngTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("heightmap PNG reads independently encoded 16-bit grey, RGB, palette and 2-bit grey images", async () => {
    const gray16 = await decodeHeightmapPng(png("gray16"));
    assert.deepEqual([gray16.width, gray16.height, gray16.bitDepth, gray16.colorType], [5, 5, 16, 0]);
    assert.deepEqual(Array.from(gray16.samples), [0, 9001, 18002, 27003, 36004, 12345, 22123, 31901, 41679, 51457, 24690, 35245, 45800, 56355, 1374, 37035, 48367, 59699, 5495, 16827, 49380, 61489, 8062, 20171, 32280]);
    const rgb = await decodeHeightmapPng(png("rgb8"));
    assert.deepEqual(Array.from(rgb.samples), [[[10, 200, 30], [255, 255, 255], [0, 0, 0]], [[1, 2, 3], [90, 90, 90], [250, 5, 128]]].flat().map(([r, g, b]) => lum(r!, g!, b!, 255)));
    const palette = [[0, 0, 0], [255, 255, 255], [128, 64, 32]];
    const indexed = await decodeHeightmapPng(png("pal4"));
    assert.deepEqual(Array.from(indexed.samples), [[0, 1, 2], [2, 1, 0]].flat().map((i) => lum(...(palette[i]! as [number, number, number]), 255)));
    const gray2 = await decodeHeightmapPng(png("gray2"));
    assert.deepEqual(Array.from(gray2.samples), [0, 1, 2, 3, 2].map((v) => Math.round(v / 3 * 65535)));
  });

  await checkAsync("heightmap PNG 16-bit grey round-trips exactly with every filter and the adaptive choice", async () => {
    const width = 37, height = 23;
    const samples = Uint16Array.from({ length: width * height }, (_, i) => (i * 7919 + (i % width) * (i % 13) * 401) % 65536);
    samples[0] = 0;
    samples[1] = 65535;
    for (const filter of [0, 1, 2, 3, 4, "adaptive"] as const) {
      const bytes = await encodeHeightmapPng16(width, height, samples, { filter });
      const decoded = await decodeHeightmapPng(bytes);
      assert.deepEqual([decoded.width, decoded.height, decoded.bitDepth, decoded.colorType], [width, height, 16, 0]);
      assert.deepEqual(decoded.samples, samples, `filter ${filter}`);
      // The rows really use the requested filter (Node's zlib as the independent inflater).
      const at = 8 + 25;
      const idat = Buffer.from(bytes.subarray(at + 8, at + 8 + Buffer.from(bytes).readUInt32BE(at)));
      const rows = inflateSync(idat);
      if (filter !== "adaptive") for (let y = 0; y < height; y += 1) assert.equal(rows[y * (width * 2 + 1)], filter);
    }
    // A smooth ramp compresses well below its raw size with the adaptive filters.
    const ramp = Uint16Array.from({ length: 257 * 257 }, (_, i) => (i % 257) * 200 + Math.floor(i / 257) * 50);
    assert.ok((await encodeHeightmapPng16(257, 257, ramp)).length < ramp.length * 2 / 4);
    await assert.rejects(encodeHeightmapPng16(3, 3, new Uint16Array(8)), HeightmapPngError);
  });

  await checkAsync("heightmap PNG rejects corrupt, truncated, interlaced, oversized and malformed files", async () => {
    const good = await encodeHeightmapPng16(4, 3, Uint16Array.from({ length: 12 }, (_, i) => i * 5000));
    await rejects(good.subarray(1), /bad signature/);
    const flipped = good.slice();
    flipped[8 + 8 + 2]! ^= 1;
    await rejects(flipped, /IHDR has a bad CRC/);
    await rejects(good.subarray(0, good.length - 12), /truncated/);
    await rejects(good.subarray(0, good.length - 6), /truncated/);
    await rejects(editChunk(good, "IHDR", (data) => { data[12] = 1; return data; }), /Interlaced/);
    await rejects(editChunk(good, "IHDR", (data) => { data[8] = 12; return data; }), /bit depth 12 is invalid/);
    await rejects(editChunk(good, "IHDR", (data) => { data[9] = 3; data[8] = 8; return data; }), /PLTE/);
    await rejects(editChunk(good, "IDAT", (data) => { const rows = inflateSync(data); rows[0] = 9; return deflateSync(rows); }), /unknown filter type 9/);
    await rejects(editChunk(good, "IDAT", (data) => deflateSync(inflateSync(data).subarray(1))), /expected/);
    await rejects(editChunk(good, "IDAT", (data) => { data[data.length - 1]! ^= 0xff; return data; }), /does not inflate/);
    await rejects(editChunk(good, "IEND", () => Buffer.alloc(0)).slice(0, 8 + 25), /truncated/);
    await rejects(good, /1\.\.3 pixels/, { maxSize: 3 });
    // After IHDR (8 + 25 bytes): an unknown critical chunk fails, an ancillary one is skipped.
    const insert = (chunk: Buffer) => Uint8Array.from(Buffer.concat([Buffer.from(good.subarray(0, 33)), chunk, Buffer.from(good.subarray(33))]));
    await rejects(insert(makeChunk("ABCD", Buffer.from([1, 2]))), /unknown critical chunk ABCD/);
    assert.deepEqual((await decodeHeightmapPng(insert(makeChunk("abCD", Buffer.from([1, 2]))))).samples, (await decodeHeightmapPng(good)).samples);
  });
}
