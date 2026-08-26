import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { MdxContentProcessor } from "@veryfront/ext-content-mdx";
import {
  ensureBuiltinEvalReportExporterRegistry,
  ensureBuiltinLLMProviders,
  ensureBuiltinSchemaValidator,
} from "#veryfront/extensions/builtin-extensions.ts";
import { clearConfigCache, getConfig } from "#veryfront/config/loader.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";

describe("Bun workspace resolution", () => {
  it("loads built-in extension modules through workspace package names", () => {
    assertEquals(typeof ensureBuiltinEvalReportExporterRegistry, "function");
    assertEquals(typeof ensureBuiltinLLMProviders, "function");
    assertEquals(typeof ensureBuiltinSchemaValidator, "function");
    assertEquals(typeof MdxContentProcessor, "function");
  });

  it("resolves a dependency installed beneath the project config", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const packageDir = `${projectDir}/node_modules/config-local-dependency`;
      const configPath = `${projectDir}/veryfront.config.js`;
      const source =
        'import marker from "config-local-dependency";\nexport default { title: marker };\n';
      await mkdir(packageDir, { recursive: true });
      await writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({
          name: "config-local-dependency",
          type: "module",
          exports: "./index.js",
        }),
      );
      await writeTextFile(`${packageDir}/index.js`, 'export default "project-local";\n');
      await writeTextFile(configPath, source);
      adapter.fs.files.set(configPath, source);

      const config = await getConfig(projectDir, adapter);

      assertEquals(config.title, "project-local");
    }, { prefix: "vf-config-local-dependency-" });
  });
});
