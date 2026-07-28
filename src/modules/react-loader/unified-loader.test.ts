import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { DEFAULT_MAX_FILE_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { getProjectTmpDir } from "./temp-directory.ts";
import { loadComponentsUnified } from "./unified-loader.ts";

describe("modules/react-loader/unified-loader", () => {
  afterEach(async () => {
    const esbuild = await import("veryfront/extensions/bundler");
    await esbuild.stop();
  });

  it("binds each explicit import-map snapshot without ambient filesystem reads", async () => {
    async function transformWith(target: string, projectId: string) {
      const adapter = createMockAdapter();
      const readPaths: string[] = [];
      adapter.fs.readFile = (path) => {
        readPaths.push(path);
        return Promise.reject(new Error(`unexpected ambient read: ${path}`));
      };

      const loaded = await loadComponentsUnified(
        [{
          name: "Component",
          filePath: "/project/Component.js",
          source: `
            import * as dependency from "fixture";
            export default function Component() {
              if (typeof dependency.readFile === "function") return "fs";
              if (typeof dependency.join === "function") return "path";
              return "unknown";
            }
          `,
        }],
        "/project",
        adapter,
        {
          projectId,
          ssr: true,
          importMap: { imports: { fixture: target } },
        },
      );

      assertEquals(
        readPaths.filter((path) =>
          path.endsWith("/deno.json") ||
          path.endsWith("/veryfront.config.ts") ||
          path.endsWith("/veryfront.config.js")
        ),
        [],
      );
      return (loaded.Component as () => string)();
    }

    const first = await transformWith("node:fs", "unified-map-a");
    const second = await transformWith("node:path", "unified-map-b");

    assertStrictEquals(first, "fs");
    assertStrictEquals(second, "path");
  });

  it("treats component names only as map keys", async () => {
    const projectId = `unified-names-${crypto.randomUUID()}`;
    const projectTmpDir = await getProjectTmpDir(projectId);
    const escapedPath = join(projectTmpDir, "escaped.js");
    const fs = createFileSystem();

    try {
      const loaded = await loadComponentsUnified(
        [
          {
            name: "__proto__",
            filePath: "/project/Prototype.ts",
            source: "export default function Prototype() { return 1; }",
          },
          {
            name: "not-an-identifier",
            filePath: "/project/Hyphen.ts",
            source: "export default function Hyphen() { return 2; }",
          },
          {
            name: "../escaped",
            filePath: "/project/Traversal.ts",
            source: "export default function Traversal() { return 3; }",
          },
        ],
        "/project",
        denoAdapter,
        { projectId, ssr: true, importMap: { imports: {} } },
      );

      assertStrictEquals(Object.getPrototypeOf(loaded), Object.prototype);
      assertEquals(Object.keys(loaded), [
        "__proto__",
        "not-an-identifier",
        "../escaped",
      ]);
      assertStrictEquals((loaded["__proto__"] as () => number)(), 1);
      assertStrictEquals((loaded["not-an-identifier"] as () => number)(), 2);
      assertStrictEquals((loaded["../escaped"] as () => number)(), 3);
      assertStrictEquals(await fs.exists(escapedPath), false);
    } finally {
      if (await fs.exists(escapedPath)) {
        await fs.remove(escapedPath);
      }
    }
  });

  it("rejects duplicate component names before transforming", async () => {
    await assertRejects(
      () =>
        loadComponentsUnified(
          [
            {
              name: "Duplicate",
              filePath: "/project/First.ts",
              source: "export default function First() { return null; }",
            },
            {
              name: "Duplicate",
              filePath: "/project/Second.ts",
              source: "export default function Second() { return null; }",
            },
          ],
          "/project",
          createMockAdapter(),
          { projectId: "unified-duplicates", ssr: true, importMap: { imports: {} } },
        ),
      TypeError,
      'duplicate component name "Duplicate"',
    );
  });

  it("rejects values that are not React component types", async () => {
    await assertRejects(
      () =>
        loadComponentsUnified(
          [{
            name: "Invalid",
            filePath: "/project/Invalid.ts",
            source: "export default { invalid: true };",
          }],
          "/project",
          denoAdapter,
          {
            projectId: `unified-invalid-${crypto.randomUUID()}`,
            ssr: true,
            importMap: { imports: {} },
          },
        ),
      TypeError,
      "/project/Invalid.ts did not export a React component",
    );
  });

  it("rejects oversized sources before invoking the project adapter", async () => {
    const adapter = createMockAdapter();
    let reads = 0;
    adapter.fs.readFile = (path) => {
      reads++;
      return Promise.reject(new Error(`unexpected read: ${path}`));
    };

    await assertRejects(
      () =>
        loadComponentsUnified(
          [{
            name: "Oversized",
            filePath: "/project/Oversized.ts",
            source: "x".repeat(DEFAULT_MAX_FILE_SIZE_BYTES + 1),
          }],
          "/project",
          adapter,
          { projectId: "unified-oversized", ssr: true, importMap: { imports: {} } },
        ),
      RangeError,
      `Component source exceeds ${DEFAULT_MAX_FILE_SIZE_BYTES} bytes`,
    );
    assertStrictEquals(reads, 0);
  });

  it("removes its exclusive materialization after module evaluation fails", async () => {
    const projectId = `unified-cleanup-${crypto.randomUUID()}`;
    const projectTmpDir = await getProjectTmpDir(projectId);
    const fs = createFileSystem();

    async function listMaterializations(): Promise<string[]> {
      const names: string[] = [];
      for await (const entry of fs.readDir(projectTmpDir)) {
        if (entry.isDirectory && entry.name.startsWith("unified-")) {
          names.push(entry.name);
        }
      }
      return names.sort();
    }

    const before = await listMaterializations();
    await assertRejects(
      () =>
        loadComponentsUnified(
          [{
            name: "Explodes",
            filePath: "/project/Explodes.ts",
            source: `
              throw new Error("unified evaluation failed");
              export default function Explodes() { return null; }
            `,
          }],
          "/project",
          denoAdapter,
          { projectId, ssr: true, importMap: { imports: {} } },
        ),
      Error,
      "unified evaluation failed",
    );
    assertEquals(await listMaterializations(), before);
  });
});
