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

  it("rejects configured server externals from served browser modules", async () => {
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
        dev: true,
        config: { build: { serverExternalPackages: ["knex"] } },
      },
    );

    assertEquals(response.status, 500);
    const text = await response.text();
    assertStringIncludes(text, "knex");
    assertStringIncludes(text, "build.serverExternalPackages");
    assertStringIncludes(text, "components/Database.ts");
    assertEquals(text.includes("esm.sh/knex"), false);
  });

  it("preserves configured server externals in served SSR modules", async () => {
    const projectDir = "/server-external-package-ssr";
    const adapter = createMockAdapter();
    adapter.fs.files.set(
      `${projectDir}/components/Database.ts`,
      `import knex from "knex"; export default knex;\n`,
    );

    const response = await serveModule(
      new Request("http://localhost:3000/_vf_modules/components/Database.js?ssr=true", {
        headers: { "user-agent": "Deno/2.4.0" },
      }),
      {
        projectId: "server-external-package-ssr",
        projectDir,
        adapter,
        isLocalProject: true,
        allowSSRModuleMode: true,
        config: { build: { serverExternalPackages: ["knex"] } },
      },
    );

    assertEquals(response.status, 200);
    const text = await response.text();
    assertStringIncludes(text, 'from "knex"');
    assertEquals(text.includes("esm.sh/knex"), false);
  });
});
