import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { loadModuleFromSource } from "./component-loader.ts";

describe("modules/react-loader/component-loader", () => {
  afterEach(async () => {
    const bundler = await import("veryfront/extensions/bundler");
    await bundler.stop();
  });

  it("loads content-addressed revisions deterministically from paths with spaces", async () => {
    const root = await makeTempDir({ prefix: "vf module loader " });
    const filePath = join(root, "components", "Value.ts");
    const projectId = `component-loader-${crypto.randomUUID()}`;
    const options = {
      ssr: false,
      projectId,
      importMap: { imports: {} },
    } as const;

    try {
      const [first, second] = await Promise.all([
        loadModuleFromSource(
          `export const value = "first";`,
          filePath,
          root,
          denoAdapter,
          options,
        ),
        loadModuleFromSource(
          `export const value = "second";`,
          filePath,
          root,
          denoAdapter,
          options,
        ),
      ]);

      assertEquals(first.value, "first");
      assertEquals(second.value, "second");
    } finally {
      await remove(root, { recursive: true });
    }
  });

  it("rejects output paths outside the project root", async () => {
    const root = await makeTempDir({ prefix: "vf-module-loader-root-" });
    try {
      await assertRejects(
        () =>
          loadModuleFromSource(
            `export const value = true;`,
            "/outside/Value.ts",
            root,
            denoAdapter,
            {
              ssr: false,
              projectId: `component-loader-${crypto.randomUUID()}`,
              importMap: { imports: {} },
            },
          ),
        TypeError,
        "outside the project",
      );
    } finally {
      await remove(root, { recursive: true });
    }
  });
});
