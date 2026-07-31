import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { DEFAULT_MAX_FILE_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import type { TransformOptions } from "#veryfront/transforms/esm/types.ts";
import type { LoadComponentOptions } from "./types.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { getProjectTmpDir } from "./temp-directory.ts";
import {
  _resolveUnifiedTransformOptionsForTest,
  _transformAllComponentsForTest,
  loadComponentsUnified,
} from "./unified-loader.ts";

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

  it("passes one immutable caller snapshot to every parallel transform", async () => {
    const callerDependencies = { lodash: "1.0.0" };
    const dependencyPinningCacheKey = `on:${hashString(JSON.stringify([["lodash", "1.0.0"]]))}`;
    const transformOptions = await _resolveUnifiedTransformOptionsForTest(
      "/project",
      {
        projectId: "project-id",
        moduleServerOrigin: "https://preview.example",
        dependencyPinningCacheKey,
        dependencyPinningDependencies: callerDependencies,
      },
    );
    callerDependencies.lodash = "2.0.0";

    const observedOptions: TransformOptions[] = [];
    const components = Array.from({ length: 8 }, (_, index) => ({
      name: `Component${index}`,
      source: `export default function Component${index}() { return null; }`,
      filePath: `/project/components/Component${index}.tsx`,
    }));
    const transformed = await _transformAllComponentsForTest(
      components,
      "/project",
      createMockAdapter(),
      transformOptions,
      ((_source, filePath, _projectDir, _adapter, options) => {
        observedOptions.push(options ?? {});
        return Promise.resolve(`export const filePath = ${JSON.stringify(filePath)};`);
      }) as Parameters<typeof _transformAllComponentsForTest>[4],
    );

    assertEquals(transformed.length, components.length);
    assertEquals(observedOptions.length, components.length);
    assertEquals(observedOptions.every((options) => options === transformOptions), true);
    assertEquals(
      observedOptions.every(
        (options) =>
          options.dependencyPinningCacheKey === dependencyPinningCacheKey &&
          options.dependencyPinningDependencies?.lodash === "1.0.0",
      ),
      true,
    );
    assertEquals(Object.isFrozen(transformOptions.dependencyPinningDependencies), true);
    assertEquals(transformOptions.moduleServerOrigin, "https://preview.example");
  });

  it("captures every option and nested map before a gated dependency read yields", async () => {
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let releaseRead!: () => void;
    let markReadStarted!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const importMap = { imports: { fixture: "node:fs" } };
    const dependencyPinningSource = {
      projectDir: "/project",
      cacheNamespace: `unified-options-${crypto.randomUUID()}`,
      fs: {
        stat: () =>
          Promise.resolve({
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            size: 45,
            mtime: new Date(0),
          }),
        readFile: async () => {
          markReadStarted();
          await readGate;
          return JSON.stringify({ dependencies: { lodash: "1.0.0" } });
        },
      },
    };
    const options: LoadComponentOptions = {
      projectId: "initial-project",
      moduleServerUrl: "/initial-modules",
      ssr: true,
      importMap,
      dependencyPinningSource,
    };

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      const transformOptionsPromise = _resolveUnifiedTransformOptionsForTest(
        "/project",
        options,
      );
      await readStarted;

      options.projectId = "mutated-project";
      options.moduleServerUrl = "/mutated-modules";
      importMap.imports.fixture = "node:path";
      releaseRead();

      const transformOptions = await transformOptionsPromise;
      assertEquals(transformOptions.projectId, "initial-project");
      assertEquals(transformOptions.moduleServerUrl, "/initial-modules");
      assertEquals(
        (await transformOptions.loadImportMap?.())?.imports?.fixture,
        "node:fs",
      );
    } finally {
      releaseRead();
      if (originalFlag === undefined) {
        deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
      } else {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      }
    }
  });

  it("does not vary flag-off transform options by request origin", async () => {
    const options = await _resolveUnifiedTransformOptionsForTest("/project", {
      moduleServerOrigin: "https://preview.example",
      dependencyPinningCacheKey: "off",
    });

    assertEquals(options.moduleServerOrigin, undefined);
  });
});
