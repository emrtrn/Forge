/** Shared, pure acceptance rules: software results can never close the GPU gate. */
export const WES_SCENARIOS = [
  { id: 'off-a', enabled: false, hour: 12, weather: 'clear' },
  { id: 'noon-a', enabled: true, hour: 12, weather: 'clear' },
  { id: 'noon-b', enabled: true, hour: 12, weather: 'clear' },
  { id: 'off-b', enabled: false, hour: 12, weather: 'clear' },
  { id: 'sunrise-0700', enabled: true, hour: 7, weather: 'clear' },
  { id: 'low-sun-0630', enabled: true, hour: 6.5, weather: 'clear' },
  { id: 'sunset-1830', enabled: true, hour: 18.5, weather: 'clear' },
  { id: 'night-2300', enabled: true, hour: 23, weather: 'clear' },
  { id: 'cloudy', enabled: true, hour: 12, weather: 'cloudy' },
  { id: 'fog', enabled: true, hour: 12, weather: 'fog' },
  { id: 'clock-24min', enabled: true, hour: 12, weather: 'clear', dayLengthMinutes: 24 },
  { id: 'clock-stress-1min', enabled: true, hour: 16.5, weather: 'clear', dayLengthMinutes: 1 },
];

export function classifyGpu(renderer) {
  if (typeof renderer !== 'string' || !renderer.trim()) return 'unknown';
  if (/swiftshader|llvmpipe|lavapipe|softpipe|software|basic render|swiftgl/i.test(renderer)) return 'software';
  if (/nvidia|geforce|quadro|radeon|\bAMD\b|\bATI\b|intel|apple|adreno|mali|powervr/i.test(renderer)) return 'hardware';
  return 'unknown';
}

export function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = fraction => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
  return { count: sorted.length, p50Ms: at(.5), p95Ms: at(.95), p99Ms: at(.99), maxMs: sorted.at(-1) ?? null };
}

export function measurementGate({ device, timerAvailable, cases, ibl }) {
  const reasons = [];
  if (classifyGpu(device) !== 'hardware') reasons.push('Hardware GPU not verified');
  if (!timerAvailable) reasons.push('EXT_disjoint_timer_query_webgl2 unavailable');
  for (const scenario of WES_SCENARIOS) {
    const result = cases.find(entry => entry.id === scenario.id);
    if (!result || result.frames.count < 30) reasons.push(`${scenario.id}: fewer than 30 frame samples`);
    if (!result?.gpuRender || result.gpuRender.count < 30) reasons.push(`${scenario.id}: fewer than 30 valid render GPU samples`);
    if (result?.disjoint) reasons.push(`${scenario.id}: GPU disjoint event`);
  }
  if (!ibl?.gpu || ibl.gpu.count < 5 || ibl.disjoint) reasons.push('Fewer than five valid isolated IBL GPU samples');
  return { measurementReady: reasons.length === 0, visualAccepted: false, budgetAccepted: false, reasons };
}
