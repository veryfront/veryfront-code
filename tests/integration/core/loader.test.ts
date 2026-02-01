// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { getAdapter } from "#veryfront/platform";
import { clearConfigCache, getConfig, type VeryfrontConfig } from "#veryfront/config";
import { remove, writeTextFile } from "#veryfront/testing/deno-compat";
import { withTestContext } from "../../_helpers/context.ts";

function projectFile(projectDir: string, file: string): string {
  return `${projectDir}/${file}`;
}

async function removeDefaultConfig(projectDir: string): Promise<void> {
  await remove(projectFile(projectDir, "veryfront.config.js"));
}

async function getConfigWithAdapter(projectDir: string): Promise<VeryfrontConfig> {
  const adapter = await getAdapter();
  return await getConfig(projectDir, adapter);
}

async function expectConfigError(
  projectDir: string,
  includes: string[],
): Promise<void> {
  let error: Error | null = null;

  try {
    await getConfigWithAdapter(projectDir);
  } catch (e) {
    error = e as Error;
  }

  assertEquals(error !== null, true);
  for (const text of includes) {
    assertEquals(error?.message.includes(text), true);
  }
}

describe("config/loader", () => {
  it("defaults when no config file", async () => {
    await withTestContext("config-defaults", async (context) => {
      clearConfigCache();
      const cfg = await getConfigWithAdapter(context.projectDir);

      assertEquals(cfg.experimental?.esmLayouts, true);
      assertEquals(!!cfg.theme?.colors?.primary, true);
    });
  });

  it("merges partial user config", async () => {
    await withTestContext("config-merge", async (context) => {
      await removeDefaultConfig(context.projectDir);

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
        projectFile(context.projectDir, "veryfront.config.ts"),
        `export default ${JSON.stringify(user)};`,
      );

      clearConfigCache();
      const cfg = await getConfigWithAdapter(context.projectDir);

      assertEquals(cfg.title, "X");
      assertEquals(cfg.dev?.port, 9999);
      assertEquals(cfg.experimental?.esmLayouts, true);
      assertEquals(cfg.build?.outDir, "out");
      assertEquals((cfg.resolve as any)?.importMap?.imports?.react?.includes("react@18"), true);
    });
  });

  it("failure to execute config falls back to defaults", async () => {
    await withTestContext("config-error-fallback", async (context) => {
      await writeTextFile(
        projectFile(context.projectDir, "veryfront.config.ts"),
        `export default (()=>{ throw new Error('boom') })()`,
      );

      clearConfigCache();
      const cfg = await getConfigWithAdapter(context.projectDir);

      assertEquals(cfg.experimental?.esmLayouts, true);
    });
  });

  it("rejects invalid title type", async () => {
    await withTestContext("config-validation", async (context) => {
      await removeDefaultConfig(context.projectDir);

      await writeTextFile(
        projectFile(context.projectDir, "veryfront.config.ts"),
        `export default { title: 123 };`,
      );

      clearConfigCache();
      await expectConfigError(context.projectDir, ["Invalid veryfront.config"]);
    });
  });

  it("rejects invalid CORS config", async () => {
    await withTestContext("config-cors-validation", async (context) => {
      await removeDefaultConfig(context.projectDir);

      await writeTextFile(
        projectFile(context.projectDir, "veryfront.config.ts"),
        `export default { security: { cors: { origin: 123 } } };`,
      );

      clearConfigCache();
      await expectConfigError(context.projectDir, ["security.cors.origin", "must be a string"]);
    });
  });

  it("rejects unknown keys", async () => {
    await withTestContext("config-unknown-keys", async (context) => {
      await removeDefaultConfig(context.projectDir);

      await writeTextFile(
        projectFile(context.projectDir, "veryfront.config.ts"),
        `export default { title: "Test", unknownKey: "value", anotherUnknown: 123 };`,
      );

      clearConfigCache();
      const adapter = await getAdapter();

      await assertRejects(
        () => getConfig(context.projectDir, adapter),
        Error,
        "Unknown config keys: unknownKey, anotherUnknown",
      );
    });
  });

  it("loads .js config file", async () => {
    await withTestContext("config-js-file", async (context) => {
      await writeTextFile(
        projectFile(context.projectDir, "veryfront.config.js"),
        `export default { title: "JS Config" };`,
      );

      clearConfigCache();
      const cfg = await getConfigWithAdapter(context.projectDir);

      assertEquals(cfg.title, "JS Config");
    });
  });

  it("loads .mjs config file", async () => {
    await withTestContext("config-mjs-file", async (context) => {
      await removeDefaultConfig(context.projectDir);

      await writeTextFile(
        projectFile(context.projectDir, "veryfront.config.mjs"),
        `export default { title: "MJS Config" };`,
      );

      clearConfigCache();
      const cfg = await getConfigWithAdapter(context.projectDir);

      assertEquals(cfg.title, "MJS Config");
    });
  });

  it("prioritizes .js over .ts and .mjs", async () => {
    await withTestContext("config-precedence", async (context) => {
      await writeTextFile(
        projectFile(context.projectDir, "veryfront.config.js"),
        `export default { title: "JS wins" };`,
      );
      await writeTextFile(
        projectFile(context.projectDir, "veryfront.config.ts"),
        `export default { title: "TS loses" };`,
      );
      await writeTextFile(
        projectFile(context.projectDir, "veryfront.config.mjs"),
        `export default { title: "MJS loses" };`,
      );

      clearConfigCache();
      const cfg = await getConfigWithAdapter(context.projectDir);

      assertEquals(cfg.title, "JS wins");
    });
  });

  it("caches config per project directory", async () => {
    await withTestContext("config-cache-project1", async (context1) => {
      await withTestContext("config-cache-project2", async (context2) => {
        clearConfigCache();

        await removeDefaultConfig(context1.projectDir);
        await removeDefaultConfig(context2.projectDir);

        await writeTextFile(
          projectFile(context1.projectDir, "veryfront.config.ts"),
          `export default { title: "Project 1" };`,
        );
        await writeTextFile(
          projectFile(context2.projectDir, "veryfront.config.ts"),
          `export default { title: "Project 2" };`,
        );

        const adapter = await getAdapter();
        const cfg1 = await getConfig(context1.projectDir, adapter);
        const cfg2 = await getConfig(context2.projectDir, adapter);

        assertEquals(cfg1.title, "Project 1");
        assertEquals(cfg2.title, "Project 2");

        const cfg1Again = await getConfig(context1.projectDir, adapter);
        const cfg2Again = await getConfig(context2.projectDir, adapter);

        assertEquals(cfg1 === cfg1Again, true);
        assertEquals(cfg2 === cfg2Again, true);
      });
    });
  });

  it("merges import maps correctly", async () => {
    await withTestContext("config-import-map-merge", async (context) => {
      await removeDefaultConfig(context.projectDir);

      const user = {
        resolve: {
          importMap: {
            imports: {
              "my-lib": "https://example.com/my-lib.js",
              react: "https://esm.sh/react@17",
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
        projectFile(context.projectDir, "veryfront.config.ts"),
        `export default ${JSON.stringify(user)};`,
      );

      clearConfigCache();
      const cfg = await getConfigWithAdapter(context.projectDir);

      const importMap = (cfg.resolve as any)?.importMap;
      assertEquals(importMap?.imports?.["my-lib"], "https://example.com/my-lib.js");
      assertEquals(importMap?.imports?.react, "https://esm.sh/react@17");
      assertEquals(importMap?.imports?.["react-dom"]?.includes("react-dom"), true);
      assertEquals(
        importMap?.scopes?.["/some/scope/"]?.["scoped-lib"],
        "https://example.com/scoped.js",
      );
    });
  });

  it("loads named export config", async () => {
    await withTestContext("config-named-export", async (context) => {
      await removeDefaultConfig(context.projectDir);

      await writeTextFile(
        projectFile(context.projectDir, "veryfront.config.ts"),
        `export const title = "Named Export";`,
      );

      clearConfigCache();
      const cfg = await getConfigWithAdapter(context.projectDir);

      assertEquals(cfg.title, "Named Export");
    });
  });

  it("provides default import map when resolve is not specified", async () => {
    await withTestContext("config-no-resolve", async (context) => {
      await removeDefaultConfig(context.projectDir);

      const user = { title: "No Resolve" };

      await writeTextFile(
        projectFile(context.projectDir, "veryfront.config.ts"),
        `export default ${JSON.stringify(user)};`,
      );

      clearConfigCache();
      const cfg = await getConfigWithAdapter(context.projectDir);

      const importMap = (cfg.resolve as any)?.importMap;
      assertEquals(importMap?.imports?.react?.includes("react"), true);
    });
  });
});
