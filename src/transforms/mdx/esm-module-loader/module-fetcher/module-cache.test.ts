import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  makeTempDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import { join, toFileUrl } from "#veryfront/compat/path/index.ts";
import { cacheModule } from "./module-cache.ts";

const noopLog = {
  debug: () => {},
  warn: () => {},
} as never;

describe("module-cache", () => {
  it("adds a default export for filename-matched named component exports", async () => {
    const esmCacheDir = await makeTempDir({ prefix: "vf-module-cache-default-" });
    const projectDir = await makeTempDir({ prefix: "vf-module-cache-entry-" });
    const entryPath = join(projectDir, "entry.mjs");
    const sourceMap = "//# sourceMappingURL=data:application/json;base64,e30=";

    try {
      const cachedPath = await cacheModule(
        "_vf_modules/components/PlatformOverview.js",
        [
          `const PlatformOverview = () => "ok";`,
          `export {`,
          `  PlatformOverview,`,
          `};`,
          sourceMap,
        ].join("\n"),
        esmCacheDir,
        new Map(),
        noopLog,
      );
      if (!cachedPath) throw new Error("Expected module to be cached");

      const cachedCode = await readTextFile(cachedPath);
      assertEquals(cachedCode.includes("export { PlatformOverview as default };"), true);
      assertEquals(cachedCode.trimEnd().endsWith(sourceMap), true);

      await writeTextFile(
        entryPath,
        [
          `import PlatformOverview from ${JSON.stringify(toFileUrl(cachedPath).href)};`,
          `export const value = PlatformOverview();`,
        ].join("\n"),
      );

      const imported = await import(`${toFileUrl(entryPath).href}?v=${Date.now()}`);
      assertEquals(imported.value, "ok");
    } finally {
      await remove(esmCacheDir, { recursive: true }).catch(() => {});
      await remove(projectDir, { recursive: true }).catch(() => {});
    }
  });

  it("adds a default re-export for filename-matched barrel exports", async () => {
    const esmCacheDir = await makeTempDir({ prefix: "vf-module-cache-barrel-" });
    const projectDir = await makeTempDir({ prefix: "vf-module-cache-barrel-entry-" });
    const namedImplPath = join(projectDir, "named-impl.mjs");
    const defaultImplPath = join(projectDir, "default-impl.mjs");

    try {
      await writeTextFile(namedImplPath, `export const PlatformOverview = () => "named";`);
      await writeTextFile(defaultImplPath, `export default () => "default";`);

      const cases = [
        {
          code: `export { PlatformOverview } from ${
            JSON.stringify(toFileUrl(namedImplPath).href)
          };`,
          expectedExport: `export { PlatformOverview as default } from ${
            JSON.stringify(toFileUrl(namedImplPath).href)
          };`,
          expectedValue: "named",
        },
        {
          code: `export { default as PlatformOverview } from ${
            JSON.stringify(toFileUrl(defaultImplPath).href)
          };`,
          expectedExport: `export { default as default } from ${
            JSON.stringify(toFileUrl(defaultImplPath).href)
          };`,
          expectedValue: "default",
        },
      ];

      for (const [index, barrel] of cases.entries()) {
        const cachedPath = await cacheModule(
          "_vf_modules/components/PlatformOverview.js",
          barrel.code,
          esmCacheDir,
          new Map(),
          noopLog,
        );
        if (!cachedPath) throw new Error("Expected module to be cached");

        const cachedCode = await readTextFile(cachedPath);
        assertEquals(cachedCode.includes(barrel.expectedExport), true);

        const entryPath = join(projectDir, `barrel-entry-${index}.mjs`);
        await writeTextFile(
          entryPath,
          [
            `import PlatformOverview from ${JSON.stringify(toFileUrl(cachedPath).href)};`,
            `export const value = PlatformOverview();`,
          ].join("\n"),
        );

        const imported = await import(`${toFileUrl(entryPath).href}?v=${Date.now()}-${index}`);
        assertEquals(imported.value, barrel.expectedValue);
      }
    } finally {
      await remove(esmCacheDir, { recursive: true }).catch(() => {});
      await remove(projectDir, { recursive: true }).catch(() => {});
    }
  });
});
