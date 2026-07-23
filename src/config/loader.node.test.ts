import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import type { Bundler } from "#veryfront/extensions/bundler/bundler.ts";
import {
  register as registerExtensionContract,
  resolve as resolveExtensionContract,
} from "#veryfront/extensions/contracts.ts";
import { clearConfigCache, getConfig } from "./loader.ts";

it("loads a typed config module in Node", async () => {
  if (!isNode) return;

  const originalBundler = resolveExtensionContract<Bundler>("Bundler");
  registerExtensionContract<Bundler>("Bundler", {
    bundle: () => Promise.reject(new Error("Unexpected bundle call")),
    transform: () =>
      Promise.resolve({
        code:
          'import { defineConfig } from "veryfront"; export default defineConfig({ title: "Node config" });',
        warnings: [],
      }),
  });
  const fs = createFileSystem();
  const projectDir = await fs.makeTempDir({ prefix: "vf-config-node-" });
  try {
    const configPath = join(projectDir, "veryfront.config.ts");
    const source = `
      import { defineConfig } from "veryfront";
      enum ProjectTitle { Value = "Node config" }
      const config = { title: ProjectTitle.Value };
      export default defineConfig(config);
    `;
    await fs.writeTextFile(configPath, source);

    const adapter = createMockAdapter();
    adapter.fs.files.set(configPath, source);
    const config = await getConfig(projectDir, adapter);

    assertEquals(config.title, "Node config");
  } finally {
    clearConfigCache();
    registerExtensionContract("Bundler", originalBundler);
    await fs.remove(projectDir, { recursive: true });
  }
});
