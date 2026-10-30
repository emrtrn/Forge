// Offline water foam material bake. PNG channel layout follows the earlier
// Ultra-Water adaptation (MIT, Humpalumps; public/licenses/ultra-water.txt);
// the pattern itself is Forge's own.
// R: erosion field, histogram-equalised. Domain-warped fBm clusters plus filled
//    Worley-F1 bubbles, so a threshold leaves solid patches -> lace -> scattered
//    bubbles. No F2-F1 cell-edge term: edge networks read as caustics.
// G: soft billow height. BA: signed height gradient (0.5 + gradient/64).
// No dependency or runtime generation. Run: node tools/bake-water-foam.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const size = 512, fract = x => x - Math.floor(x), clamp = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp((x-a)/(b-a)); return t*t*(3-2*t); };
const wrap = (n, p) => ((n % p) + p) % p;
function hash(x, y, salt) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y + 0x165667b1, 0x85ebca77) ^ Math.imul(salt + 0x3c6ef372, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 16), 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// Periodic value noise and fBm: every lattice wraps at an integer period.
function valueNoise(u, v, period, salt) {
  const px = u * period, py = v * period, ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy, sx = fx*fx*(3-2*fx), sy = fy*fy*(3-2*fy);
  const h = (x, y) => hash(wrap(x, period), wrap(y, period), salt);
  const a = h(ix, iy), b = h(ix+1, iy), c = h(ix, iy+1), d = h(ix+1, iy+1);
  return a + (b-a)*sx + (c-a)*sy + (a-b-c+d)*sx*sy;
}
function fbm(u, v, period, salt) {
  let sum = 0, weight = .5, total = 0;
  for (let octave = 0; octave < 4; octave++) {
    sum += valueNoise(u, v, period << octave, salt + octave * 31) * weight;
    total += weight; weight *= .5;
  }
  return sum / total;
}
// Filled bubble: 1 at the jittered site, 0 beyond its own random radius.
function bubbles(u, v, period, salt) {
  const px = u * period, py = v * period, ix = Math.floor(px), iy = Math.floor(py);
  let value = 0;
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const cx = wrap(ix + x, period), cy = wrap(iy + y, period);
    const sx = ix + x + .15 + .7 * hash(cx, cy, salt), sy = iy + y + .15 + .7 * hash(cx, cy, salt + 7);
    const radius = .35 + .45 * hash(cx, cy, salt + 13);
    const d = Math.hypot(sx - px, sy - py) / radius;
    value = Math.max(value, 1 - smooth(.15, 1, d));
  }
  return value;
}
const pattern = new Float64Array(size * size), height = new Float64Array(size * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const u = (x + .5) / size, v = (y + .5) / size;
  // Periodic warp keeps the tile seamless while breaking straight lattice rows.
  const wu = u + (fbm(u, v, 3, 101) - .5) * .12, wv = v + (fbm(u, v, 3, 211) - .5) * .12;
  const cluster = smooth(.25, .75, fbm(wu, wv, 4, 7));
  const large = bubbles(wu, wv, 11, 401), medium = bubbles(wu, wv, 29, 503), tiny = bubbles(wu, wv, 71, 607);
  pattern[y * size + x] = cluster * .5 + large * .25 + medium * .17 + tiny * .08 + hash(x, y, 9) * .002;
  height[y * size + x] = cluster * .6 + large * .3 + medium * .1;
}
// Rank transform: threshold t then covers ~(1 - t) of the tile, so shader
// density maps to visible coverage instead of the raw blend's distribution.
const order = Array.from(pattern.keys()).sort((a, b) => pattern[a] - pattern[b]);
const equalised = new Float64Array(size * size);
order.forEach((index, rank) => { equalised[index] = rank / (order.length - 1); });
const rgba = Buffer.alloc(size * size * 4);
const at = (x, y) => height[wrap(y, size) * size + wrap(x, size)];
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const gx = (at(x + 1, y) - at(x - 1, y)) * size / 2, gy = (at(x, y + 1) - at(x, y - 1)) * size / 2;
  const values = [equalised[y * size + x], clamp(height[y * size + x]), clamp(.5 + gx / 64), clamp(.5 + gy / 64)];
  values.forEach((value, i) => rgba[(y * size + x) * 4 + i] = Math.round(value * 255));
}
// Minimal PNG encoder; RGBA channels are linear data, including alpha as slope Z.
function crc32(bytes) { let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0; }
function chunk(name,data) {
  const type=Buffer.from(name),header=Buffer.alloc(4),crc=Buffer.alloc(4);header.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));
  return Buffer.concat([header,type,data,crc]);
}
const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
const rows=Buffer.alloc(size*(1+size*4));for(let y=0;y<size;y++)rgba.copy(rows,y*(1+size*4)+1,y*size*4,(y+1)*size*4);
const target=new URL('../engine/render-three/textures/water-foam.png',import.meta.url);
mkdirSync(new URL('.',target),{recursive:true});
writeFileSync(target,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows,{level:9})),chunk('IEND',Buffer.alloc(0))]));
console.log('Baked 512x512 RGBA water foam.');
