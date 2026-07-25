import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { loadComponentsUnified } from "./unified-loader.ts";

describe("modules/react-loader/unified-loader", () => {
  afterEach(async () => {
    const esbuild = await import("veryfront/extensions/bundler");
    await esbuild.stop();
  });

  it("binds each explicit import-map snapshot without ambient filesystem reads", async () => {
    async function transformWith(target: string, projectId: string) {
      const adapter = createMockAdapter();
      const writes: Array<{ path: string; source: string }> = [];
      const readPaths: string[] = [];
      adapter.fs.readFile = (path) => {
        readPaths.push(path);
        return Promise.reject(new Error(`unexpected ambient read: ${path}`));
      };
      adapter.fs.writeFile = (path, source) => {
        writes.push({ path, source });
        return Promise.resolve();
      };

      // The adapter deliberately does not persist the generated entry point, so
      // the final dynamic import fails after the transform output is captured.
      try {
        await loadComponentsUnified(
          [{
            name: "Component",
            filePath: "/project/Component.js",
            source:
              'import dependency from "fixture"; export default function Component() { return dependency; }',
          }],
          "/project",
          adapter,
          {
            projectId,
            ssr: true,
            importMap: { imports: { fixture: target } },
          },
        );
      } catch {
        // Expected: the in-memory adapter cannot back a file:// dynamic import.
      }

      const transformed = writes.find(({ path }) => path.endsWith("/Component.js"))?.source;
      assertEquals(typeof transformed, "string");
      assertEquals(
        readPaths.filter((path) =>
          path.endsWith("/deno.json") ||
          path.endsWith("/veryfront.config.ts") ||
          path.endsWith("/veryfront.config.js")
        ),
        [],
      );
      return transformed ?? "";
    }

    const first = await transformWith("node:fs", "unified-map-a");
    const second = await transformWith("node:path", "unified-map-b");

    assertStringIncludes(first, "node:fs");
    assertStringIncludes(second, "node:path");
  });
});
