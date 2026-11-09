/** FFT shader stages adapted from Humpalumps/Ultra-Water (MIT),
 * commit 30ea65ecb0a66b137aa200d099965634bdd84d51, src/water/OceanSim.js.
 * Copyright (c) 2026 Humpalumps. See public/licenses/ultra-water.txt.
 * Forge owns validation, renderer state, scheduling and resource disposal.
 */
// Tessendorf FFT ocean: 4 cascades of 256² stacked in one 256×1024 atlas so every
// IFFT stage is a single draw. Output per cascade (RGBA16F, mipmapped, repeat):
//   displacement = (λDx, Dy, λDz, turbulence)   slope = (sx, sz, sx², sz²)
// Slopes are divided out at full resolution so their mips give mean + second moment
// (slope variance -> roughness, LEAN style).

export const N = 256;
export const LOG_N = 8;
// last cascade is the gravity-capillary detail layer; 12/2.1 is non-integer so tiles don't align
export const CASCADE_LENGTHS = [600, 85, 12, 2.1];
const G = 9.81;
// surface tension / density (m³/s²): ω² = g·k + (σ/ρ)·k³
const SIGMA_RHO = 7.4e-5;
// ω is quantised to multiples of 2π/LOOP and time wraps at LOOP, so the sim loops
// seamlessly and fp32 phase never degrades.
const LOOP = 300;

const COMMON = /* glsl */`
precision highp float;
precision highp int;
#define N ${N}
#define PI 3.14159265359
#define G ${G.toFixed(2)}
#define ST ${SIGMA_RHO.toExponential()}
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
float omega(float k) { return sqrt(G * k + ST * k * k * k); }
`;

export const INIT_FRAG = COMMON + /* glsl */`
uniform vec4 uSpecA[2]; // scale, angle, spreadBlend, swell
uniform vec4 uSpecB[2]; // alpha, peakOmega, gamma, shortWavesFade
uniform vec4 uLength;
uniform vec4 uCut;      // c0 hi, c1 hi, c2 hi, -
uniform float uCapFade; // short-wave fade for cascade 3 (cascades 0-2 use uSpecB.w)
uniform uint uSeed;
out vec4 outColor;

uvec2 pcg2d(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return v;
}

vec2 gauss(ivec2 id, int c) {
  uvec2 h = pcg2d(uvec2(id) + uvec2(uint(c) * 7919u, uint(c) * 104729u) + uSeed);
  float u1 = (float(h.x) + 1.0) / 4294967296.0;
  float u2 = float(h.y) / 4294967296.0;
  float r = sqrt(-2.0 * log(u1));
  return r * vec2(cos(2.0 * PI * u2), sin(2.0 * PI * u2));
}

float jonswap(float w, vec4 a, vec4 b) {
  float wp = b.y;
  float sigma = w <= wp ? 0.07 : 0.09;
  float r = exp(-(w - wp) * (w - wp) / (2.0 * sigma * sigma * wp * wp));
  float iw = 1.0 / w;
  float q = wp * iw;
  return a.x * b.x * G * G * iw * iw * iw * iw * iw * exp(-1.25 * q * q * q * q) * pow(b.z, r);
}

float normalisation(float s) {
  float s2 = s * s, s3 = s2 * s, s4 = s3 * s;
  if (s < 5.0) return -0.000564 * s4 + 0.00776 * s3 - 0.044 * s2 + 0.192 * s + 0.163;
  return -4.80e-08 * s4 + 1.07e-05 * s3 - 9.53e-04 * s2 + 5.90e-02 * s + 3.93e-01;
}

float directional(float theta, float w, vec4 a, vec4 b) {
  float x = w / b.y;
  float s = x > 1.0 ? 9.77 * pow(x, -2.5) : 6.97 * pow(x, 5.0);
  s += 16.0 * tanh(min(x, 20.0)) * a.w * a.w;
  float t = theta - a.y;
  float cosine2s = normalisation(s) * pow(abs(cos(0.5 * t)), 2.0 * s);
  return mix(2.0 / PI * cos(t) * cos(t), cosine2s, a.z);
}

vec2 h0(ivec2 id, int c) {
  float L = uLength[c];
  float dk = 2.0 * PI / L;
  vec2 k = vec2(id - N / 2) * dk;
  float kl = length(k);
  float lo = c == 0 ? 1e-4 : uCut[c - 1];
  float hi = c == 3 ? 1e4 : uCut[c];
  if (kl < lo || kl > hi) return vec2(0.0);
  float w = omega(kl);
  float dwdk = (G + 3.0 * ST * kl * kl) / (2.0 * w);
  float theta = atan(k.y, k.x);
  float S = 0.0;
  for (int i = 0; i < 2; i++) {
    if (uSpecA[i].x <= 0.0) continue;
    float fade = c == 3 ? uCapFade : uSpecB[i].w;
    S += jonswap(w, uSpecA[i], uSpecB[i]) * directional(theta, w, uSpecA[i], uSpecB[i])
       * exp(-fade * fade * kl * kl);
  }
  return gauss(id, c) * sqrt(2.0 * S * dwdk / kl * dk * dk);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int c = p.y / N;
  ivec2 id = ivec2(p.x, p.y - c * N);
  vec2 a = h0(id, c);
  vec2 b = h0((N - id) % N, c);
  outColor = vec4(a, b.x, -b.y); // h0(k), conj(h0(-k))
}`;

export const EVOLVE_FRAG = COMMON + /* glsl */`
uniform highp sampler2D uH0;
uniform vec4 uLength;
uniform float uTime;
layout(location = 0) out vec4 out0;
layout(location = 1) out vec4 out1;

// two real fields packed as one complex spectrum: IFFT(A + iB) = a + ib
vec2 pack2(vec2 a, vec2 b) { return vec2(a.x - b.y, a.y + b.x); }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int c = p.y / N;
  vec2 k = vec2(ivec2(p.x, p.y - c * N) - N / 2) * (2.0 * PI / uLength[c]);
  float kl = length(k);
  float ik = kl > 1e-6 ? 1.0 / kl : 0.0;
  const float W0 = 2.0 * PI / ${LOOP.toFixed(1)};
  // ω = n·W0; phase reduced to [0, 2π) before sin/cos (the capillary cascade reaches ω ≈ 130)
  float ph = 2.0 * PI * fract(floor(omega(kl) / W0) * (uTime / ${LOOP.toFixed(1)}));
  vec2 e = vec2(cos(ph), sin(ph));
  vec4 h0 = texelFetch(uH0, p, 0);
  vec2 h = cmul(h0.xy, e) + cmul(h0.zw, vec2(e.x, -e.y));
  vec2 ih = vec2(-h.y, h.x);

  vec2 dx = ih * k.x * ik, dz = ih * k.y * ik;
  vec2 dxdx = -h * k.x * k.x * ik, dzdz = -h * k.y * k.y * ik, dxdz = -h * k.x * k.y * ik;
  vec2 dydx = ih * k.x, dydz = ih * k.y;

  out0 = vec4(pack2(dx, dz), pack2(h, dxdz));
  out1 = vec4(pack2(dydx, dydz), pack2(dxdx, dzdz));
}`;

// Stockham radix-2 inverse FFT stage (e^{+i}); verified against a naive DFT.
export const FFT_FRAG = COMMON + /* glsl */`
uniform highp sampler2D uIn0;
uniform highp sampler2D uIn1;
uniform int uSub;      // sub-transform size 2..N
uniform int uVertical;
layout(location = 0) out vec4 out0;
layout(location = 1) out vec4 out1;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int i = uVertical == 1 ? p.y % N : p.x;
  int hs = uSub >> 1;
  int e = (i / uSub) * hs + (i & (hs - 1));
  ivec2 pe, po;
  if (uVertical == 1) { int base = p.y - i; pe = ivec2(p.x, base + e); po = ivec2(p.x, base + e + N / 2); }
  else { pe = ivec2(e, p.y); po = ivec2(e + N / 2, p.y); }
  float a = 2.0 * PI * float(i & (uSub - 1)) / float(uSub);
  vec2 tw = vec2(cos(a), sin(a));
  vec4 e0 = texelFetch(uIn0, pe, 0), o0 = texelFetch(uIn0, po, 0);
  vec4 e1 = texelFetch(uIn1, pe, 0), o1 = texelFetch(uIn1, po, 0);
  out0 = vec4(e0.xy + cmul(tw, o0.xy), e0.zw + cmul(tw, o0.zw));
  out1 = vec4(e1.xy + cmul(tw, o1.xy), e1.zw + cmul(tw, o1.zw));
}`;

export const ASSEMBLE_FRAG = COMMON + /* glsl */`
uniform highp sampler2D uIn0;
uniform highp sampler2D uIn1;
uniform sampler2D uPrev;
uniform int uCascade;
uniform float uLambda;
uniform float uDt;
uniform float uFoamRecovery;
layout(location = 0) out vec4 outDisp;
layout(location = 1) out vec4 outSlope;

void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  ivec2 p = id + ivec2(0, uCascade * N);
  // undo the centred-k frequency shift
  float s = ((id.x + id.y) & 1) == 0 ? 1.0 : -1.0;
  vec4 a = texelFetch(uIn0, p, 0) * s; // Dx, Dz, Dy, Dxz
  vec4 b = texelFetch(uIn1, p, 0) * s; // Dyx, Dyz, Dxx, Dzz
  float dxx = uLambda * b.z, dzz = uLambda * b.w, dxz = uLambda * a.w;
  float jac = (1.0 + dxx) * (1.0 + dzz) - dxz * dxz;
  vec2 slope = b.xy / max(vec2(1.0 + dxx, 1.0 + dzz), vec2(0.2));
  float prev = texelFetch(uPrev, id, 0).w;
  // foam follows the jacobian down instantly and recovers at a dt-based rate
  float turb = min(jac, prev + uDt * uFoamRecovery / max(jac, 0.5));
  outDisp = vec4(uLambda * a.x, a.z, uLambda * a.y, turb);
  outSlope = vec4(slope, slope * slope);
}`;

