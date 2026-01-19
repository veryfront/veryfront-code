// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { getAdapter } from "@veryfront/platform";
import { clearConfigCache, getConfig, type VeryfrontConfig } from "@veryfront/config";
import { remove, writeTextFile } from "@veryfront/testing/deno-compat";
import { withTestContext } from "../../_helpers/context.ts";

describe("config/loader", () => {
  it("defaults when no config file", async () => {
    await withTestContext("config-defaults", async (context) => {
      const adapter = await getAdapter();
      clearConfigCache();
      const cfg = await getConfig(context.projectDir, adapter);
      // esmLayouts default true
      assertEquals(cfg.experimental?.esmLayouts, true);
      // has default theme color
      assertEquals(!!cfg.theme?.colors?.primary, true);
    });
  });

  it("merges partial user config", async () => {
    await withTestContext("config-merge", async (context) => {
      const adapter = await getAdapter();
      // Remove the default config created by TestContext
      await remove(`${context.projectDir}/veryfront.config.js`);

      const user: Partial<VeryfrontConfig> = {
        title: "X",
        dev: { port: 9999 },
        theme: { colors: { primary: "#000" } },
        build: { outDir: "out" },
        resolve: {
          importMap: { imports: { react: "https://esm.sh/react@18" } } as any,
        },
      };
      await writeTextFile(
        `${context.projectDir}/veryfront.config.ts`,
        `export default ${JSON.stringify(user)};`,
      );
      clearConfigCache();
      const cfg = await getConfig(context.projectDir, adapter);
      assertEquals(cfg.title, "X");
      assertEquals(cfg.dev?.port, 9999);
      // untouched defaults should still exist (esmLayouts)
      assertEquals(cfg.experimental?.esmLayouts, true);
      assertEquals(cfg.build?.outDir, "out");
      assertEquals((cfg.resolve as any)?.importMap?.imports?.react?.includes("react@18"), true);
    });
  });

  it("failure to execute config falls back to defaults", async () => {
    await withTestContext("config-error-fallback", async (context) => {
      await writeTextFile(
        `${context.projectDir}/veryfront.config.ts`,
        `export default (()=>{ throw new Error('boom') })()`,
      );
      clearConfigCache();
      const adapter = await getAdapter();
      const cfg = await getConfig(context.projectDir, adapter);
      assertEquals(cfg.experimental?.esmLayouts, true);
    });
  });

  it("rejects invalid title type", async () => {
    await withTestContext("config-validation", async (context) => {
      // Remove the default config created by TestContext
      await remove(`${context.projectDir}/veryfront.config.js`);

      // Invalid config that should fail validation
      await writeTextFile(
        `${context.projectDir}/veryfront.config.ts`,
        `export default { title: 123 };`, // title should be string
      );
      clearConfigCache();

      let error: Error | null = null;
      try {
        const adapter = await getAdapter();
        await getConfig(context.projectDir, adapter);
      } catch (e) {
        error = e as Error;
      }

      assertEquals(error !== null, true);
      assertEquals(error?.message.includes("Invalid veryfront.config"), true);
    });
  });

  it("rejects invalid CORS config", async () => {
    await withTestContext("config-cors-validation", async (context) => {
      // Remove the default config created by TestContext
      await remove(`${context.projectDir}/veryfront.config.js`);

      // Invalid CORS config
      await writeTextFile(
        `${context.projectDir}/veryfront.config.ts`,
        `export default { security: { cors: { origin: 123 } } };`, // origin should be string
      );
      clearConfigCache();

      let error: Error | null = null;
      try {
        const adapter = await getAdapter();
        await getConfig(context.projectDir, adapter);
      } catch (e) {
        error = e as Error;
      }

      assertEquals(error !== null, true);
      // Error message is more specific now: "security.cors.origin must be a string..."
      assertEquals(error?.message.includes("security.cors.origin"), true);
      assertEquals(error?.message.includes("must be a string"), true);
    });
  });

  it("warns about unknown keys", async () => {
    await withTestContext("config-unknown-keys", async (context) => {
      // Remove the default config created by TestContext
      await remove(`${context.projectDir}/veryfront.config.js`);

      // Config with unknown keys
      await writeTextFile(
        `${context.projectDir}/veryfront.config.ts`,
        `export default { title: "Test", unknownKey: "value", anotherUnknown: 123 };`,
      );
      clearConfigCache();

      // Capture console.warn
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (msg: string) => warnings.push(msg);

      try {
        const adapter = await getAdapter();
        const cfg = await getConfig(context.projectDir, adapter);
        assertEquals(cfg.title, "Test");
        assertEquals(warnings.length > 0, true);
        assertEquals(warnings[0]?.includes("Unknown config keys"), true);
        assertEquals(warnings[0]?.includes("unknownKey"), true);
        assertEquals(warnings[0]?.includes("anotherUnknown"), true);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  it("loads .js config file", async () => {
    await withTestContext("config-js-file", async (context) => {
      // TestContext already creates a default .js config, so we'll update it
      await writeTextFile(
        `${context.projectDir}/veryfront.config.js`,
        `export default { title: "JS Config" };`,
      );
      clearConfigCache();
      const adapter = await getAdapter();
      const cfg = await getConfig(context.projectDir, adapter);
      assertEquals(cfg.title, "JS Config");
    });
  });

  it("loads .mjs config file", async () => {
    await withTestContext("config-mjs-file", async (context) => {
      // Remove the default config created by TestContext
      await remove(`${context.projectDir}/veryfront.config.js`);

      await writeTextFile(
        `${context.projectDir}/veryfront.config.mjs`,
        `export default { title: "MJS Config" };`,
      );
      clearConfigCache();
      const adapter = await getAdapter();
      const cfg = await getConfig(context.projectDir, adapter);
      assertEquals(cfg.title, "MJS Config");
    });
  });

  it("prioritizes .js over .ts and .mjs", async () => {
    await withTestContext("config-precedence", async (context) => {
      // Create all three config files
      await writeTextFile(
        `${context.projectDir}/veryfront.config.js`,
        `export default { title: "JS wins" };`,
      );
      await writeTextFile(
        `${context.projectDir}/veryfront.config.ts`,
        `export default { title: "TS loses" };`,
      );
      await writeTextFile(
        `${context.projectDir}/veryfront.config.mjs`,
        `export default { title: "MJS loses" };`,
      );
      clearConfigCache();
      const adapter = await getAdapter();
      const cfg = await getConfig(context.projectDir, adapter);
      assertEquals(cfg.title, "JS wins");
    });
  });

  it("caches config per project directory", async () => {
    // For tests needing multiple directories, we can nest TestContext calls
    await withTestContext("config-cache-project1", async (context1) => {
      await withTestContext("config-cache-project2", async (context2) => {
        clearConfigCache();

        // Remove default configs
        await remove(`${context1.projectDir}/veryfront.config.js`);
        await remove(`${context2.projectDir}/veryfront.config.js`);

        await writeTextFile(
          `${context1.projectDir}/veryfront.config.ts`,
          `export default { title: "Project 1" };`,
        );
        await writeTextFile(
          `${context2.projectDir}/veryfront.config.ts`,
          `export default { title: "Project 2" };`,
        );

        // Load both configs
        const adapter = await getAdapter();
        const cfg1 = await getConfig(context1.projectDir, adapter);
        const cfg2 = await getConfig(context2.projectDir, adapter);

        assertEquals(cfg1.title, "Project 1");
        assertEquals(cfg2.title, "Project 2");

        // Load again - should come from cache
        const cfg1Again = await getConfig(context1.projectDir, adapter);
        const cfg2Again = await getConfig(context2.projectDir, adapter);

        // Should be the same object reference (cached)
        assertEquals(cfg1 === cfg1Again, true);
        assertEquals(cfg2 === cfg2Again, true);
      });
    });
  });

  it("merges import maps correctly", async () => {
    await withTestContext("config-import-map-merge", async (context) => {
      // Remove the default config created by TestContext
      await remove(`${context.projectDir}/veryfront.config.js`);

      const user = {
        resolve: {
          importMap: {
            imports: {
              "my-lib": "https://example.com/my-lib.js",
              react: "https://esm.sh/react@17", // Override default React
            },
            scopes: {
              "/some/scope/": {
                "scoped-lib": "https://example.com/scoped.js",
              },
            },
          },
        },
      };
      await writeTextFile(
        `${context.projectDir}/veryfront.config.ts`,
        `export default ${JSON.stringify(user)};`,
      );
      clearConfigCache();
      const adapter = await getAdapter();
      const cfg = await getConfig(context.projectDir, adapter);

      const importMap = (cfg.resolve as any)?.importMap;
      // User's custom import
      assertEquals(importMap?.imports?.["my-lib"], "https://example.com/my-lib.js");
      // User's React override
      assertEquals(importMap?.imports?.react, "https://esm.sh/react@17");
      // Default React DOM should still exist
      assertEquals(importMap?.imports?.["react-dom"]?.includes("react-dom"), true);
      // User's scopes
      assertEquals(
        importMap?.scopes?.["/some/scope/"]?.["scoped-lib"],
        "https://example.com/scoped.js",
      );
    });
  });

  it("loads named export config", async () => {
    await withTestContext("config-named-export", async (context) => {
      // Remove the default config created by TestContext
      await remove(`${context.projectDir}/veryfront.config.js`);

      await writeTextFile(
        `${context.projectDir}/veryfront.config.ts`,
        `export const title = "Named Export";`,
      );
      clearConfigCache();
      const adapter = await getAdapter();
      const cfg = await getConfig(context.projectDir, adapter);
      assertEquals(cfg.title, "Named Export");
    });
  });

  it("provides default import map when resolve is not specified", async () => {
    await withTestContext("config-no-resolve", async (context) => {
      // Remove the default config created by TestContext
      await remove(`${context.projectDir}/veryfront.config.js`);

      const user = {
        title: "No Resolve",
        // No resolve section
      };
      await writeTextFile(
        `${context.projectDir}/veryfront.config.ts`,
        `export default ${JSON.stringify(user)};`,
      );
      clearConfigCache();
      const adapter = await getAdapter();
      const cfg = await getConfig(context.projectDir, adapter);

      // Should still have default import map
      const importMap = (cfg.resolve as any)?.importMap;
      assertEquals(importMap?.imports?.react?.includes("react"), true);
    });
  });
});
