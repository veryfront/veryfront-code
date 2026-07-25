import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import type { MDXModule } from "../types.ts";
import { loadModuleESM } from "./loader.ts";

describe("esm-module-loader/module-writer", () => {
  it("executes a real hosted MDX module with its request-scoped import map", async () => {
    const adapter = createMockAdapter();
    let projectConfigProbes = 0;
    Object.assign(adapter.fs, {
      getUnderlyingAdapter: () => adapter.fs,
      isMultiProjectMode: () => true,
      isVeryfrontAdapter: () => true,
      exists: async () => {
        projectConfigProbes += 1;
        return true;
      },
      readFile: async () => {
        projectConfigProbes += 1;
        throw new Error("Hosted module loading must not reload project config");
      },
    });

    const esmCacheDir = await Deno.makeTempDir({ prefix: "vf-hosted-mdx-map-" });
    const moduleCache = new LRUCache<string, MDXModule>({ maxEntries: 10 });

    try {
      const loaded = await loadModuleESM(
        [
          'import hostedValue from "hosted-package";',
          "export const resolvedValue = hostedValue;",
          "export default function Layout() { return null; }",
        ].join("\n"),
        {
          esmCacheDir,
          moduleCache,
          adapter,
          projectDir: "/hosted-project",
          projectId: "hosted-project-id",
          projectSlug: "hosted-project",
          contentSourceId: "release-hosted-map",
          reactVersion: "19.2.4",
          importMap: {
            imports: {
              "hosted-package": "data:text/javascript,export%20default%20%22from-config%22%3B",
            },
          },
        },
      );

      assertEquals(
        (loaded as MDXModule & { resolvedValue?: string }).resolvedValue,
        "from-config",
      );
      assertEquals(projectConfigProbes, 0);
    } finally {
      moduleCache.destroy();
      await Deno.remove(esmCacheDir, { recursive: true });
    }
  });
});
