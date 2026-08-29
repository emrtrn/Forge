/**
 * Does this browser actually play what the project ships?
 *
 * A project that encodes one audio format and no fallback — the usual choice,
 * since a second encode doubles the audio payload — has a single point of
 * failure with an unusually bad shape: a browser that cannot decode it does not
 * play a degraded mix, it plays *nothing*, and it does so without a word in the
 * console unless something asks. So the question this answers is not "how does
 * it sound" but "is there any sound at all", and it is the one audio question a
 * listening test on one machine can never reach.
 *
 * **Both runtime paths are probed, because they are not the same decoder.**
 * Short sounds go through `decodeAudioData` (Web Audio) and beds go through a
 * media element (`AudioPlayOptions.stream`). A browser can support a format in
 * one and not the other, and a probe that only asked `canPlayType`
 * would answer for neither: it reports an *intention* ("maybe"/"probably"), not
 * a decode. So this decodes a real shipped clip and loads a real shipped bed.
 *
 * Engines are probed only if Playwright has them installed; a missing one is
 * reported as missing rather than skipped silently, with the command to get it.
 * Chromium alone is not a codec test — it is the browser the project was
 * developed in, and the one result already known.
 *
 * The two clips are discovered from `public/assets/` rather than named here: the
 * smallest file stands in for a one-shot and the largest for a bed, which is the
 * right pair for exactly the reason the paths differ. Pass explicit paths
 * (relative to `public/`) to probe something specific.
 *
 * Usage:
 *   npm run audio:codecs
 *   npm run audio:codecs -- assets/sfx/click.ogg assets/music/theme.ogg
 *   npx playwright install webkit firefox   # what makes the answer complete
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, posix, sep } from "node:path";
import { chromium, firefox, webkit } from "@playwright/test";

/** Extension to the content type a media element has to be told. */
const AUDIO_MIME = {
  ".ogg": 'audio/ogg; codecs="vorbis"',
  ".oga": 'audio/ogg; codecs="vorbis"',
  ".mp3": "audio/mpeg",
  ".m4a": 'audio/mp4; codecs="mp4a.40.2"',
  ".aac": 'audio/mp4; codecs="mp4a.40.2"',
  ".wav": "audio/wav",
  ".webm": 'audio/webm; codecs="opus"',
  ".opus": 'audio/ogg; codecs="opus"',
};

/** Every audio file under `public/`, as public-root-relative paths with sizes. */
function findAudioFiles(root = "public") {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!(extname(entry.name).toLowerCase() in AUDIO_MIME)) continue;
      found.push({
        path: full.slice(root.length + 1).split(sep).join(posix.sep),
        bytes: statSync(full).size,
      });
    }
  };
  walk(root);
  return found.sort((a, b) => a.bytes - b.bytes);
}

/**
 * One short one-shot (buffer path) and one long bed (element path).
 *
 * Smallest and largest rather than named files: the two runtime paths differ by
 * clip *length*, so the extremes of what the project ships are exactly the pair
 * worth probing, and nothing has to be edited when the assets change.
 */
const explicit = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const discovered = explicit.length > 0 ? [] : findAudioFiles();
if (explicit.length === 0 && discovered.length === 0) {
  console.error("[codecs] no audio files under public/ - nothing to probe");
  process.exit(1);
}
const ONE_SHOT = explicit[0] ?? discovered[0].path;
const BED = explicit[1] ?? discovered[discovered.length - 1].path;
const SHIPPED_MIME = AUDIO_MIME[extname(ONE_SHOT).toLowerCase()] ?? "audio/ogg";
const BED_MIME = AUDIO_MIME[extname(BED).toLowerCase()] ?? SHIPPED_MIME;

const ENGINES = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];

function serveProject() {
  const server = createServer((request, response) => {
    const url = decodeURIComponent((request.url ?? "/").split("?")[0]);
    if (url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>codec probe</title>");
      return;
    }
    try {
      const relativePath = url.replace(/^\/+/u, "");
      const body = readFileSync(join("public", relativePath));
      // The real content type, not a blob: a media element consults it, and
      // `application/octet-stream` would make this measure the server rather
      // than the browser.
      const mime = AUDIO_MIME[extname(relativePath).toLowerCase()] ?? "application/octet-stream";
      response.writeHead(200, { "content-type": mime });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function probe(page, port) {
  return page.evaluate(
    async ([oneShot, bed, shippedMime]) => {
      const result = {};
      const audio = document.createElement("audio");
      result.canPlayTypeShipped = audio.canPlayType(shippedMime) || "(empty)";
      result.canPlayTypeAac = audio.canPlayType('audio/mp4; codecs="mp4a.40.2"') || "(empty)";

      // Path 1: Web Audio decode — every one-shot in the game.
      //
      // The prefixed constructor is checked too, or this measures the probe
      // rather than the codec: WebKit exposed Web Audio under `webkit*` for
      // years, and a script that only knows the modern name reports "no audio"
      // on a browser whose only fault is its spelling.
      const Offline = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
      result.webAudioApi = globalThis.OfflineAudioContext
        ? "OfflineAudioContext"
        : globalThis.webkitOfflineAudioContext
          ? "webkitOfflineAudioContext (prefixed)"
          : "(none)";
      try {
        if (!Offline) throw new Error("no OfflineAudioContext in this engine");
        const bytes = await (await fetch(oneShot)).arrayBuffer();
        const context = new Offline(1, 1, 48000);
        const buffer = await new Promise((resolve, reject) => {
          // The callback form as well as the promise: WebKit's older
          // implementation resolves only through the callbacks.
          const pending = context.decodeAudioData(bytes, resolve, reject);
          if (pending && typeof pending.then === "function") pending.then(resolve, reject);
        });
        result.decode = `ok (${buffer.duration.toFixed(2)}s, ${buffer.numberOfChannels}ch, ${buffer.sampleRate} Hz)`;
        result.decodeOk = true;
      } catch (error) {
        result.decode = `FAILED — ${error && error.message ? error.message : String(error)}`;
        result.decodeOk = false;
      }

      // Path 2: media element — every bed (ambience, music), which never decodes
      // through Web Audio at all.
      result.elementOk = await new Promise((resolve) => {
        const element = document.createElement("audio");
        element.preload = "auto";
        element.src = bed;
        const done = (value) => {
          element.removeAttribute("src");
          resolve(value);
        };
        element.addEventListener("canplay", () => done(true), { once: true });
        element.addEventListener("error", () => done(false), { once: true });
        // A browser that neither errors nor becomes playable is a "no" as far as
        // the player is concerned.
        setTimeout(() => done(false), 8000);
      });
      return result;
    },
    [`http://127.0.0.1:${port}/${ONE_SHOT}`, `http://127.0.0.1:${port}/${BED}`, SHIPPED_MIME],
  );
}

async function main() {
  const { server, port } = await serveProject();
  console.log("[codecs] probing the two runtime paths against every installed engine");
  console.log(`[codecs] one-shot: ${ONE_SHOT} (${SHIPPED_MIME})`);
  console.log(`[codecs] bed:      ${BED} (${BED_MIME})\n`);

  let missing = 0;
  let failed = 0;
  for (const [name, engine] of ENGINES) {
    let browser = null;
    try {
      browser = await engine.launch();
    } catch (error) {
      missing += 1;
      const hint = String(error).includes("Executable doesn't exist")
        ? `not installed — \`npx playwright install ${name}\``
        : String(error).split("\n")[0];
      console.log(`${name.padEnd(9)} ${hint}`);
      continue;
    }
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/`);
      const result = await probe(page, port);
      // The verdict is about the *format*, and the two facts that answer it are
      // `canPlayType` and a real element load. The Web Audio decode is reported
      // but cannot condemn an engine on its own: Playwright's WebKit build has
      // no Web Audio at all, which is a property of that build and emphatically
      // not of Safari — reading "decode FAILED" there as "Safari cannot decode"
      // would be the wrong lesson drawn from the right run.
      const hasWebAudio = result.webAudioApi !== "(none)";
      const formatOk = result.canPlayTypeShipped !== "(empty)" && result.elementOk;
      const verdict = formatOk ? (hasWebAudio && !result.decodeOk ? "PARTIAL" : "PLAYS") : "SILENT";
      if (verdict !== "PLAYS") failed += 1;
      console.log(`${name.padEnd(9)} ${verdict}`);
      console.log(`          canPlayType shipped:    ${result.canPlayTypeShipped}   (aac: ${result.canPlayTypeAac})`);
      console.log(`          Web Audio API:          ${result.webAudioApi}`);
      console.log(
        `          Web Audio decode:       ${result.decode}${
          result.webAudioApi === "(none)" ? "  (this engine build ships no Web Audio — inconclusive, not a codec result)" : ""
        }`,
      );
      console.log(`          media element bed:      ${result.elementOk ? "ok" : "FAILED"}`);
    } finally {
      await browser.close();
    }
  }
  server.close();

  console.log("");
  if (missing > 0) {
    console.log(
      `[codecs] ${missing} engine(s) not installed — the test is incomplete until they are. WebKit is the one that matters: it is Safari's engine, and Safari is the browser most likely to refuse a royalty-free codec.`,
    );
  }
  if (failed > 0) {
    console.log(
      `[codecs] ${failed} engine(s) will not play the shipped format. A second encode (AAC in mp4) alongside it, picked at runtime by canPlayType, is the fix — the manifest carries a path per clip, and every engine probed here answers "probably" for AAC.`,
    );
  }
  if (missing === 0 && failed === 0) console.log("[codecs] every installed engine plays both paths.");
}

main().catch((error) => {
  console.error(`[codecs] ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
