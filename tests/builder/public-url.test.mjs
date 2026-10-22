import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

for (const base of ["/", "/oyunlar/demo/"]) {
  test(`actual project + layout loaders use the deployment base ${base}`, async () => {
    const compiled = await build({
      stdin: { contents: 'export * from "./src/project/ProjectSystem.ts"; export * from "./src/scene/roomLayout.ts";', resolveDir: process.cwd() },
      bundle: true, write: false, format: "esm", platform: "node", define: { "import.meta.env.BASE_URL": JSON.stringify(base) },
    });
    const module = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
    const requests = [], previous = globalThis.fetch;
    globalThis.fetch = async (url) => {
      requests.push(url);
      return { ok: true, json: async () => url.endsWith("project.3dgame.json") ? { name: "test" } : { name: "test", instances: [] } };
    };
    try {
      await module.loadActiveProject();
      await module.loadRoomLayout("assets/levels/demo.level.json");
      await module.loadRoomLayout("bare");
      assert.deepEqual(requests, [`${base}project.3dgame.json`, `${base}assets/levels/demo.level.json`, `${base}layouts/bare.json`]);
      assert.equal(module.projectFileUrl("\\assets\\checker.png"), `${base}assets/checker.png`);
      assert.equal(module.projectFileUrl("/landscapes/test.landscape.json"), `${base}landscapes/test.landscape.json`);
    } finally { globalThis.fetch = previous; }
  });
}
