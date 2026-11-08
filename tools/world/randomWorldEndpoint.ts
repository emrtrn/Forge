/**
 * `/__world-random` (dev server only, local requests only): the editor's World
 * Builder window builds a random world here (RANDOM_WORLD_PLAN step 5).
 *
 * The request is checked first (`validateRandomWorldRequest`); a level or brief
 * that already exists answers 409 `{ exists: true }` unless `force`, so the
 * window can ask before replacing it. The build runs in its own Node process
 * (`build-random-world.mjs --request`): a large world takes ~40 s of CPU and the
 * server must keep serving meanwhile. The answer streams one JSON line per
 * event: `progress` for each build step, then `done` or `error`. One build runs
 * at a time; a dropped connection does not stop a build half way through writing.
 */
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { worldBriefPath } from "../../engine/worldbuilder/worldBrief";
import { validateRandomWorldRequest } from "./randomWorldRequest";

export interface RandomWorldEndpointContext {
  forgeRoot: string;
  publicDir: string;
  /** Absolute path of a public-root-relative path, refusing one that escapes it. */
  resolvePublicPath: (path: string) => string;
}

/** Event line of the streamed answer. */
export type RandomWorldEvent =
  | { type: "progress"; step: string }
  | { type: "done"; level: string; brief: string; buildings: number; bridges: number; rivers: number; lakes: number; cells: number; files: number; seconds: number; notes: string[] }
  | { type: "error"; message: string };

let running = false;

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export async function handleRandomWorldRequest(
  body: unknown,
  _req: IncomingMessage,
  res: ServerResponse,
  context: RandomWorldEndpointContext,
): Promise<void> {
  let request;
  try {
    request = validateRandomWorldRequest(body);
  } catch (error) {
    json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    return;
  }
  const briefPath = worldBriefPath(request.out);
  const taken = [];
  for (const path of [request.out, briefPath]) if (await exists(context.resolvePublicPath(path))) taken.push(path);
  if (taken.length && !request.force) {
    json(res, 409, { ok: false, exists: true, paths: taken, error: `${taken.join(" and ")} already exist${taken.length === 1 ? "s" : ""}` });
    return;
  }
  if (running) {
    json(res, 409, { ok: false, busy: true, error: "another random world is still being built" });
    return;
  }
  running = true;
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const send = (event: RandomWorldEvent): void => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  const child = spawn(process.execPath, [resolve(context.forgeRoot, "tools/world/build-random-world.mjs"), "--request", context.publicDir], {
    cwd: context.forgeRoot,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let finished = false;
  let pending = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    pending += chunk;
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
      if (!line.startsWith("@@")) continue;
      try {
        const event = JSON.parse(line.slice(2)) as RandomWorldEvent;
        if (event.type === "done" || event.type === "error") finished = true;
        send(event);
      } catch {
        // Not an event line.
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  child.on("error", (error) => {
    if (!finished) send({ type: "error", message: `could not start the builder: ${error.message}` });
    finished = true;
  });
  child.on("close", (code) => {
    running = false;
    if (!finished) send({ type: "error", message: `the builder stopped (exit ${code ?? "?"})${stderr.trim() ? `: ${stderr.trim()}` : ""}` });
    res.end();
  });
  child.stdin.end(JSON.stringify(request));
}
