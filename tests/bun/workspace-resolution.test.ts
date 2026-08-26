import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { chmod, mkdir, writeTextFile } from "#veryfront/platform/compat/fs.ts";
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
      const configPath = `${projectDir}/veryfront.config.ts`;
      const source =
        'import marker from "config-local-dependency";\nconst title: string = marker;\nexport default { title };\n';
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
      await chmod(projectDir, 0o555);

      try {
        const config = await getConfig(projectDir, adapter);

        assertEquals(config.title, "project-local");
      } finally {
        await chmod(projectDir, 0o755);
      }
    }, { prefix: "vf-config-local-dependency-" });
  });

  it("reloads a changed project config after cache invalidation", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const configPath = `${projectDir}/veryfront.config.ts`;
      const writeConfig = async (title: string): Promise<void> => {
        const source = `export default { title: ${JSON.stringify(title)} };\n`;
        await writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);
      };

      await writeConfig("before");
      assertEquals((await getConfig(projectDir, adapter)).title, "before");

      await writeConfig("after");
      clearConfigCache();

      assertEquals((await getConfig(projectDir, adapter)).title, "after");
    }, { prefix: "vf-config-bun-reload-" });
  });

  it("recovers after a missing project dependency is installed", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const packageDir = `${projectDir}/node_modules/config-late-dependency`;
      const configPath = `${projectDir}/veryfront.config.ts`;
      const source =
        'import marker from "config-late-dependency";\nexport default { title: marker };\n';
      await writeTextFile(configPath, source);
      adapter.fs.files.set(configPath, source);

      await assertRejects(() => getConfig(projectDir, adapter), Error);

      await mkdir(packageDir, { recursive: true });
      await writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({
          name: "config-late-dependency",
          type: "module",
          exports: "./index.js",
        }),
      );
      await writeTextFile(`${packageDir}/index.js`, 'export default "installed";\n');
      clearConfigCache();

      assertEquals((await getConfig(projectDir, adapter)).title, "installed");
    }, { prefix: "vf-config-bun-recovery-" });
  });

  it("reloads a changed project config that uses top-level await", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const configPath = `${projectDir}/veryfront.config.ts`;
      const writeConfig = async (title: string): Promise<void> => {
        const source = `const title = await Promise.resolve(${JSON.stringify(title)});\n` +
          "export default { title };\n";
        await writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);
      };

      await writeConfig("before");
      assertEquals((await getConfig(projectDir, adapter)).title, "before");

      await writeConfig("after");
      clearConfigCache();

      assertEquals((await getConfig(projectDir, adapter)).title, "after");
    }, { prefix: "vf-config-bun-top-level-await-" });
  });
});
