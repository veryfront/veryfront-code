import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { serveModule } from "./module-server.ts";

describe("module server external packages", () => {
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("preserves configured server externals in served project modules", async () => {
    const projectDir = "/server-external-package";
    const adapter = createMockAdapter();
    adapter.fs.files.set(
      `${projectDir}/components/Database.ts`,
      `import knex from "knex"; export default knex;\n`,
    );

    const response = await serveModule(
      new Request("http://localhost:3000/_vf_modules/components/Database.js"),
      {
        projectId: "server-external-package",
        projectDir,
        adapter,
        isLocalProject: true,
        config: { build: { serverExternalPackages: ["knex"] } },
      },
    );

    assertEquals(response.status, 200);
    const text = await response.text();
    assertStringIncludes(text, 'from "knex"');
    assertEquals(text.includes("esm.sh/knex"), false);
  });
});
