/**
 * Measure every shipped clip's loudness, so a "level pass" is countable.
 *
 * A loudness pass is a listening job over hundreds of files, and a person cannot
 * hold a level in their head across two of them, let alone across a channel.
 * What they *can* do is fix the outliers — which needs somebody to say which
 * files are outliers, and against what. That is this script.
 *
 * **It reports; it never edits and never fails a build.** Loudness is authored,
 * and the same rule that keeps tuning tables out of the test suite applies here:
 * a check that pinned a magnitude would go red the first time a clip was
 * deliberately retuned, and what a red build teaches there is "edit the test".
 * So this prints a worklist and exits 0 — the judgement stays with the ear that
 * asked for it. `--strict` is available for a CI that wants the opposite, and
 * nothing in this repo turns it on.
 *
 * **Why the browser and not ffmpeg.** Chromium is already a project dependency,
 * decodes the shipped format natively, and has a property a separate decoder
 * does not: it is *the same decode path the game plays through*, so what is
 * measured here is what the player hears rather than a second opinion about the
 * file. (Playwright's bundled ffmpeg is built `--disable-everything` and can
 * neither decode Vorbis nor run `ebur128`.)
 *
 * The measurement is ITU-R BS.1770-4 integrated loudness (K-weighting, 400 ms
 * blocks at 75% overlap, absolute gate at -70 LUFS, relative gate 10 LU below
 * the ungated mean) plus sample peak. Not an approximation of it — the gating is
 * what makes a sparse ambience bed comparable to a dense one, and an RMS average
 * would rank every quiet bed as "too quiet" purely for having silence in it.
 *
 * Needs the project's audio folder and its audio event table (see
 * `engine/audio/audioEventTable.ts`); with neither present it says so and exits.
 *
 * Usage:
 *   npm run audio:loudness                 # full report, grouped by channel
 *   npm run audio:loudness -- --channel voice
 *   npm run audio:loudness -- --json out.json
 *   npm run audio:loudness -- --strict     # exit 1 if anything is flagged
 *   npm run audio:loudness -- --root public/assets/audio --events path/to/events.json
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname, posix, sep } from "node:path";
import { chromium } from "@playwright/test";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};

const AUDIO_ROOT = option("--root", "public/assets/audio");
const EVENTS_PATH = option("--events", "public/game-data/audio/events.json");
/** The shipped encode. Only these are measured; anything else is a stray file. */
const CLIP_EXTENSION = option("--extension", ".ogg");

/**
 * How far apart one event's own variants may sit before the set is worth a look.
 *
 * **This is the comparison that matters, and it took a run of the report to
 * learn.** Flagging every clip more than 3 LU from its *channel's* median marked
 * two thirds of the library — which is not a worklist, and was wrong rather than
 * merely noisy: a footstep and a cannon share the `sfx` bus and are supposed to
 * differ by 20 LU. What the player actually hears as uneven is a *pool*: four
 * hammer clips chosen at random, where one landing 8 LU under the others reads
 * as the hammer having missed rather than as variety.
 *
 * 4 LU sits above a typical pool's spread, so this flags the tail, not the norm.
 */
const VARIANT_SPREAD_LU = 4;
/**
 * How long a clip may sit above full scale before it is worth a re-render.
 *
 * **Peak alone is the wrong flag, and this took a second measurement to learn.**
 * Flagging every clip whose peak crosses full scale marked ambience beds at +1.5
 * to +2.1 dBFS as clipped; counting the offending samples showed a few dozen out
 * of a million, with the longest unbroken run lasting a third of a millisecond.
 * That is a lossy encoder overshooting isolated peaks, which is what every
 * encoder does — not a master squashed into a limiter, which is what the flag
 * implied.
 *
 * The two look identical in a peak reading and nothing alike here: a slammed
 * master holds full scale for tens of milliseconds at a time, because the
 * distortion is in the *content*.
 *
 * And in this pipeline the isolated kind cannot even be heard: Web Audio is
 * float throughout and only the output device clamps, so a peak above 1.0 on a
 * bus the table authors well below unity arrives nowhere near full scale. The
 * player's sliders only attenuate, so nothing downstream can push it back up.
 *
 * 5 ms total, then — long enough that no encoder overshoot reaches it, short
 * enough that a genuinely limited master does.
 */
const OVER_SCALE_MS = 5;
/**
 * Head silence past this delays a sound that is supposed to *answer* something.
 *
 * Only applied to the channels where that is true (below). A music bed or an
 * ambience loop that fades up from silence is not late for anything, and a rule
 * against dead air at the head of a clip was never addressed to them.
 */
const LEAD_SILENCE_MS = 150;
/** The channels whose sounds answer a player action, so latency is a fault. */
const PROMPT_BUSES = new Set(["ui", "notifications", "voice"]);

const strict = argv.includes("--strict");
const jsonIndex = argv.indexOf("--json");
const jsonPath = jsonIndex >= 0 ? argv[jsonIndex + 1] : null;
const channelIndex = argv.indexOf("--channel");
const channelFilter = channelIndex >= 0 ? argv[channelIndex + 1] : null;

/** Every file under a directory, depth-first, as repo-relative POSIX paths. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full.split(sep).join(posix.sep));
  }
  return out;
}

/**
 * The mix bus each clip plays on, read from the event table rather than guessed
 * from the folder.
 *
 * The bus is the right grouping for a loudness pass because it is the grouping
 * the *mix* uses: two clips on one bus are heard against each other, and one on
 * `ui` against one on `sfx` are not — the table's own `buses` block already
 * decided how those two channels compare, and a pass that levelled them together
 * would undo it. A clip no event plays has no channel and is reported apart.
 */
function clipBuses() {
  const table = readEventTable();
  const buses = new Map();
  for (const [eventId, definition] of Object.entries(table.events ?? {})) {
    const bus = definition.bus ?? "master";
    for (const clipId of definition.clips ?? []) {
      const existing = buses.get(clipId);
      // A clip on two buses is not an error worth stopping for, but it is worth
      // saying: it will be levelled against two different sets of neighbours.
      if (existing && existing.bus !== bus) existing.shared = true;
      else if (!existing) buses.set(clipId, { bus, event: eventId, shared: false });
    }
  }
  return buses;
}

/**
 * The audio event table, or an empty one when the project ships none.
 *
 * Absent is a legitimate state for a template rather than an error: the levels
 * are still measurable, they just cannot be grouped by channel or checked as
 * variant pools, and the report says so instead of failing.
 */
function readEventTable() {
  try {
    return JSON.parse(readFileSync(EVENTS_PATH, "utf8"));
  } catch {
    return { events: {} };
  }
}

/** `public/assets/audio/sfx/ui/sfx_ui_click_01.ogg` → `sfx-ui-click-01`. */
function clipIdFor(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.slice(0, base.length - extname(base).length).replace(/_/gu, "-");
}

/** Serves `public/` so the page can `fetch` the clips the way the game does. */
function serveProject() {
  const server = createServer((request, response) => {
    const url = decodeURIComponent((request.url ?? "/").split("?")[0]);
    // A page on `about:blank` has an opaque origin and cannot fetch anything, so
    // the measuring page is served from here too — same origin as the clips.
    if (url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>loudness</title>");
      return;
    }
    try {
      const body = readFileSync(join("public", url.replace(/^\/+/u, "")));
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/**
 * BS.1770 integrated loudness + peak for one decoded buffer.
 *
 * Runs inside the page (it needs the decoded samples), so it is written as a
 * string-free function passed to `page.evaluate` and must not close over
 * anything from this module.
 */
function measureInPage() {
  /** K-weighting stage 1: the shelving filter, per BS.1770-4 for any sample rate. */
  const shelving = (rate) => {
    const f0 = 1681.974450955533;
    const G = 3.999843853973347;
    const Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / rate);
    const Vh = Math.pow(10, G / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    return {
      b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
      a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
    };
  };
  /** K-weighting stage 2: the high-pass. */
  const highpass = (rate) => {
    const f0 = 38.13547087602444;
    const Q = 0.5003270373238773;
    const K = Math.tan((Math.PI * f0) / rate);
    return {
      b: [1, -2, 1],
      a: [1, (2 * (K * K - 1)) / (1 + K / Q + K * K), (1 - K / Q + K * K) / (1 + K / Q + K * K)],
    };
  };
  const biquad = (input, { b, a }) => {
    const out = new Float32Array(input.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < input.length; i += 1) {
      const x0 = input[i];
      const y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      out[i] = y0;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
    }
    return out;
  };

  return async (url) => {
    const bytes = await (await fetch(url)).arrayBuffer();
    // Decoded at the file's own rate: `decodeAudioData` resamples to the
    // context, and resampling before measuring would report the resampler's
    // peak rather than the clip's.
    const probe = new OfflineAudioContext(1, 1, 48000);
    const buffer = await probe.decodeAudioData(bytes);
    const rate = buffer.sampleRate;
    const channels = [];
    let peak = 0;
    let firstLoud = -1;
    let lastLoud = -1;
    // -60 dBFS is the floor for "this is silence", used only for the head/tail
    // measurements. Not shared with the module's constants: this function is
    // serialized into the page and can close over nothing.
    const floor = Math.pow(10, -60 / 20);
    // Samples past full scale, and the longest unbroken stretch of them — the
    // pair that separates an encoder's isolated overshoot from a master that was
    // limited before it was encoded.
    let overScale = 0;
    let longestOverRun = 0;
    for (let c = 0; c < buffer.numberOfChannels; c += 1) {
      const data = buffer.getChannelData(c);
      let overRun = 0;
      for (let i = 0; i < data.length; i += 1) {
        const magnitude = Math.abs(data[i]);
        if (magnitude > peak) peak = magnitude;
        if (magnitude > 1) {
          overScale += 1;
          overRun += 1;
          if (overRun > longestOverRun) longestOverRun = overRun;
        } else overRun = 0;
        if (magnitude > floor) {
          if (firstLoud < 0 || i < firstLoud) firstLoud = i;
          if (i > lastLoud) lastLoud = i;
        }
      }
      channels.push(biquad(biquad(data, shelving(rate)), highpass(rate)));
    }

    // 400 ms blocks, 75% overlap — the gating window BS.1770 specifies.
    const blockSize = Math.round(rate * 0.4);
    const hop = Math.round(blockSize / 4);
    const blocks = [];
    for (let start = 0; start + blockSize <= buffer.length; start += hop) {
      let sum = 0;
      for (const data of channels) {
        let square = 0;
        for (let i = start; i < start + blockSize; i += 1) square += data[i] * data[i];
        // Channel weight 1.0 for L/R/C; this project ships mono and stereo only.
        sum += square / blockSize;
      }
      blocks.push(sum);
    }
    // A clip shorter than one block (a UI tick can be) has no gated measurement
    // to make; its mean square over the whole file is the honest answer.
    if (blocks.length === 0) {
      let sum = 0;
      for (const data of channels) {
        let square = 0;
        for (let i = 0; i < buffer.length; i += 1) square += data[i] * data[i];
        sum += square / Math.max(1, buffer.length);
      }
      blocks.push(sum);
    }
    const loudnessOf = (mean) => -0.691 + 10 * Math.log10(Math.max(mean, 1e-12));
    const aboveAbsolute = blocks.filter((mean) => loudnessOf(mean) > -70);
    const ungated = aboveAbsolute.length
      ? aboveAbsolute.reduce((total, mean) => total + mean, 0) / aboveAbsolute.length
      : 0;
    const relativeGate = loudnessOf(ungated) - 10;
    const gated = aboveAbsolute.filter((mean) => loudnessOf(mean) > relativeGate);
    const integrated = gated.length
      ? loudnessOf(gated.reduce((total, mean) => total + mean, 0) / gated.length)
      : loudnessOf(ungated);

    return {
      lufs: integrated,
      peakDbfs: 20 * Math.log10(Math.max(peak, 1e-12)),
      seconds: buffer.duration,
      channelCount: buffer.numberOfChannels,
      sampleRate: rate,
      leadMs: firstLoud < 0 ? 0 : (firstLoud / rate) * 1000,
      tailMs: lastLoud < 0 ? 0 : ((buffer.length - 1 - lastLoud) / rate) * 1000,
      overScaleMs: (overScale / channels.length / rate) * 1000,
      overScaleRunMs: (longestOverRun / rate) * 1000,
    };
  };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const fixed = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : "—");

async function main() {
  let files;
  try {
    files = walk(AUDIO_ROOT).filter((path) => extname(path) === CLIP_EXTENSION);
  } catch {
    files = [];
  }
  if (files.length === 0) {
    console.log(`[loudness] no ${CLIP_EXTENSION} clips under ${AUDIO_ROOT} — nothing to measure`);
    return;
  }
  const buses = clipBuses();
  const { server, port } = await serveProject();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const measure = await page.evaluateHandle(measureInPage);

  const rows = [];
  for (const path of files) {
    const clipId = clipIdFor(path);
    const routing = buses.get(clipId) ?? null;
    const bus = routing?.bus ?? "(no event)";
    if (channelFilter && bus !== channelFilter) continue;
    const url = `http://127.0.0.1:${port}/${path.slice("public/".length)}`;
    try {
      const measured = await page.evaluate(
        ([fn, target]) => fn(target),
        [measure, url],
      );
      rows.push({ clipId, path, bus, event: routing?.event ?? null, ...measured });
    } catch (error) {
      rows.push({ clipId, path, bus, event: routing?.event ?? null, error: String(error) });
    }
  }

  await browser.close();
  server.close();

  const byBus = new Map();
  for (const row of rows) {
    if (!byBus.has(row.bus)) byBus.set(row.bus, []);
    byBus.get(row.bus).push(row);
  }
  const byClip = new Map(rows.map((row) => [row.clipId, row]));

  console.log(`[loudness] ${rows.length} clip(s), measured through Chromium's Vorbis decoder (BS.1770 integrated)
`);

  // Context first, and deliberately without flags: a channel's spread describes
  // its contents rather than judging them. `sfx` is *supposed* to run 30 LU from
  // a footstep to a gun.
  console.log("Channels");
  for (const [bus, clips] of [...byBus].sort((a, b) => a[0].localeCompare(b[0]))) {
    const measured = clips.filter((row) => !row.error && Number.isFinite(row.lufs));
    if (measured.length === 0) continue;
    const levels = measured.map((row) => row.lufs);
    console.log(
      `   ${bus.padEnd(16)} ${String(measured.length).padStart(3)} clip(s)   median ${fixed(median(levels)).padStart(6)} LUFS   spread ${fixed(Math.max(...levels) - Math.min(...levels)).padStart(5)} LU`,
    );
  }

  // 1. Uneven variant pools — the flag that names a fault the player can hear.
  const table = readEventTable();
  const pools = [];
  for (const [eventId, definition] of Object.entries(table.events ?? {})) {
    const clips = (definition.clips ?? []).map((id) => byClip.get(id)).filter((row) => row && !row.error);
    if (clips.length < 2) continue;
    const levels = clips.map((row) => row.lufs);
    const spread = Math.max(...levels) - Math.min(...levels);
    if (spread <= VARIANT_SPREAD_LU) continue;
    const quietest = clips.reduce((a, b) => (a.lufs < b.lufs ? a : b));
    const loudest = clips.reduce((a, b) => (a.lufs > b.lufs ? a : b));
    pools.push({ eventId, spread, quietest, loudest, count: clips.length });
  }
  pools.sort((a, b) => b.spread - a.spread);
  console.log(`
Uneven variant pools — ${pools.length} event(s) over ${VARIANT_SPREAD_LU} LU`);
  console.log("   (one clip of a pool landing well under the others is heard as a miss, not as variety)");
  for (const pool of pools) {
    console.log(
      `   ${pool.eventId.padEnd(32)} ${fixed(pool.spread).padStart(5)} LU across ${pool.count}` +
        `   quietest ${pool.quietest.clipId} (${fixed(pool.quietest.lufs)})` +
        `   loudest ${pool.loudest.clipId} (${fixed(pool.loudest.lufs)})`,
    );
  }

  // 2. Clipping — measured as time spent over full scale, not as peak height.
  const clipped = rows
    .filter((row) => !row.error && row.overScaleMs > OVER_SCALE_MS)
    .sort((a, b) => b.overScaleMs - a.overScaleMs);
  const overshoot = rows.filter(
    (row) => !row.error && row.overScaleMs > 0 && row.overScaleMs <= OVER_SCALE_MS,
  );
  console.log(`
Clipping — ${clipped.length} clip(s) over full scale for more than ${OVER_SCALE_MS} ms`);
  for (const row of clipped) {
    console.log(
      `   ${row.clipId.padEnd(32)} ${fixed(row.overScaleMs, 1).padStart(7)} ms over scale ` +
        `(longest run ${fixed(row.overScaleRunMs, 2)} ms)   peak ${fixed(row.peakDbfs, 2)} dBFS`,
    );
  }
  const worstOvershoot = overshoot.reduce((worst, row) => Math.max(worst, row.peakDbfs), -Infinity);
  console.log(
    `   ${overshoot.length} further clip(s) cross it for isolated samples (worst peak ${fixed(worstOvershoot, 2)} dBFS) — ordinary lossy-encoder overshoot, and inaudible in a float pipeline whose buses attenuate.`,
  );

  // 3. Slow answers.
  const late = rows
    .filter((row) => !row.error && PROMPT_BUSES.has(row.bus) && row.leadMs > LEAD_SILENCE_MS)
    .sort((a, b) => b.leadMs - a.leadMs);
  console.log(`
Late answers — ${late.length} clip(s) on ${[...PROMPT_BUSES].join("/")} with over ${LEAD_SILENCE_MS} ms of head silence`);
  for (const row of late) {
    console.log(`   ${row.clipId.padEnd(32)} ${String(Math.round(row.leadMs)).padStart(4)} ms before the sound starts`);
  }

  const flagged = pools.length + clipped.length + late.length;

  const failures = rows.filter((row) => row.error);
  for (const row of failures) console.log(`[loudness] could not measure ${row.path}: ${row.error}`);

  if (jsonPath) {
    writeFileSync(jsonPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
    console.log(`[loudness] wrote ${jsonPath}`);
  }
  console.log(
    `[loudness] ${flagged} clip(s) worth a listen; levels are authored, so this is a worklist, not a verdict.`,
  );
  if (strict && (flagged > 0 || failures.length > 0)) process.exit(1);
}

main().catch((error) => {
  console.error(`[loudness] ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
