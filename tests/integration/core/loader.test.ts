// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assertEquals } from "std/assert/mod.ts";
import { getAdapter } from "@veryfront/platform";
import { clearConfigCache, getConfig, type VeryfrontConfig } from "@veryfront/config";
import { withTestContext } from "../../_helpers/context.ts";

Deno.test("config/loader | defaults when no config file", async () => {
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

Deno.test("config/loader | merges partial user config", async () => {
  await withTestContext("config-merge", async (context) => {
    const adapter = await getAdapter();
    // Remove the default config created by TestContext
    await Deno.remove(`${context.projectDir}/veryfront.config.js`);

    const user: Partial<VeryfrontConfig> = {
      title: "X",
      dev: { port: 9999 },
      theme: { colors: { primary: "#000" } },
      build: { outDir: "out" },
      resolve: {
        importMap: { imports: { react: "https://esm.sh/react@18" } } as any,
      },
    };
    await Deno.writeTextFile(
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

Deno.test("config/loader | failure to execute config falls back to defaults", async () => {
  await withTestContext("config-error-fallback", async (context) => {
    await Deno.writeTextFile(
      `${context.projectDir}/veryfront.config.ts`,
      `export default (()=>{ throw new Error('boom') })()`,
    );
    clearConfigCache();
    const adapter = await getAdapter();
    const cfg = await getConfig(context.projectDir, adapter);
    assertEquals(cfg.experimental?.esmLayouts, true);
  });
});

Deno.test("config/loader test", async () => {
  await withTestContext("config-validation", async (context) => {
    // Remove the default config created by TestContext
    await Deno.remove(`${context.projectDir}/veryfront.config.js`);

    // Invalid config that should fail validation
    await Deno.writeTextFile(
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

Deno.test("config/loader test", async () => {
  await withTestContext("config-cors-validation", async (context) => {
    // Remove the default config created by TestContext
    await Deno.remove(`${context.projectDir}/veryfront.config.js`);

    // Invalid CORS config
    await Deno.writeTextFile(
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

Deno.test("config/loader test", async () => {
  await withTestContext("config-unknown-keys", async (context) => {
    // Remove the default config created by TestContext
    await Deno.remove(`${context.projectDir}/veryfront.config.js`);

    // Config with unknown keys
    await Deno.writeTextFile(
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

Deno.test("config/loader test", async () => {
  await withTestContext("config-js-file", async (context) => {
    // TestContext already creates a default .js config, so we'll update it
    await Deno.writeTextFile(
      `${context.projectDir}/veryfront.config.js`,
      `export default { title: "JS Config" };`,
    );
    clearConfigCache();
    const adapter = await getAdapter();
    const cfg = await getConfig(context.projectDir, adapter);
    assertEquals(cfg.title, "JS Config");
  });
});

Deno.test("config/loader test", async () => {
  await withTestContext("config-mjs-file", async (context) => {
    // Remove the default config created by TestContext
    await Deno.remove(`${context.projectDir}/veryfront.config.js`);

    await Deno.writeTextFile(
      `${context.projectDir}/veryfront.config.mjs`,
      `export default { title: "MJS Config" };`,
    );
    clearConfigCache();
    const adapter = await getAdapter();
    const cfg = await getConfig(context.projectDir, adapter);
    assertEquals(cfg.title, "MJS Config");
  });
});

Deno.test("config/loader test", async () => {
  await withTestContext("config-precedence", async (context) => {
    // Create all three config files
    await Deno.writeTextFile(
      `${context.projectDir}/veryfront.config.js`,
      `export default { title: "JS wins" };`,
    );
    await Deno.writeTextFile(
      `${context.projectDir}/veryfront.config.ts`,
      `export default { title: "TS loses" };`,
    );
    await Deno.writeTextFile(
      `${context.projectDir}/veryfront.config.mjs`,
      `export default { title: "MJS loses" };`,
    );
    clearConfigCache();
    const adapter = await getAdapter();
    const cfg = await getConfig(context.projectDir, adapter);
    assertEquals(cfg.title, "JS wins");
  });
});

Deno.test("config/loader test", async () => {
  // For tests needing multiple directories, we can nest TestContext calls
  await withTestContext("config-cache-project1", async (context1) => {
    await withTestContext("config-cache-project2", async (context2) => {
      clearConfigCache();

      // Remove default configs
      await Deno.remove(`${context1.projectDir}/veryfront.config.js`);
      await Deno.remove(`${context2.projectDir}/veryfront.config.js`);

      await Deno.writeTextFile(
        `${context1.projectDir}/veryfront.config.ts`,
        `export default { title: "Project 1" };`,
      );
      await Deno.writeTextFile(
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

Deno.test("config/loader test", async () => {
  await withTestContext("config-import-map-merge", async (context) => {
    // Remove the default config created by TestContext
    await Deno.remove(`${context.projectDir}/veryfront.config.js`);

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
    await Deno.writeTextFile(
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

Deno.test("config/loader test", async () => {
  await withTestContext("config-named-export", async (context) => {
    // Remove the default config created by TestContext
    await Deno.remove(`${context.projectDir}/veryfront.config.js`);

    await Deno.writeTextFile(
      `${context.projectDir}/veryfront.config.ts`,
      `export const title = "Named Export";`,
    );
    clearConfigCache();
    const adapter = await getAdapter();
    const cfg = await getConfig(context.projectDir, adapter);
    assertEquals(cfg.title, "Named Export");
  });
});

Deno.test("config/loader test", async () => {
  await withTestContext("config-no-resolve", async (context) => {
    // Remove the default config created by TestContext
    await Deno.remove(`${context.projectDir}/veryfront.config.js`);

    const user = {
      title: "No Resolve",
      // No resolve section
    };
    await Deno.writeTextFile(
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
