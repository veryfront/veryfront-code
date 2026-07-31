import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { loadModuleFromSource } from "./component-loader.ts";
import type { LoadComponentOptions } from "./types.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";

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

  it("captures every supplied option before a gated dependency read yields", async () => {
    const root = await makeTempDir({ prefix: "vf-component-options-" });
    const filePath = join(root, "components", "OptionSnapshot.ts");
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let releaseRead!: () => void;
    let markReadStarted!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const importMap = { imports: {} };
    const observedProperties = new Set<PropertyKey>();
    const callerOptions: LoadComponentOptions = {
      ssr: false,
      projectId: `component-options-${crypto.randomUUID()}`,
      importMap,
      moduleServerUrl: "/initial-modules",
      vendorBundleHash: "initial-vendor",
      dependencyPinningSource: {
        projectDir: root,
        cacheNamespace: `component-options-${crypto.randomUUID()}`,
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
      },
    };
    const options = new Proxy(callerOptions, {
      get(target, property, receiver) {
        observedProperties.add(property);
        return Reflect.get(target, property, receiver);
      },
    });

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      const loadPromise = loadModuleFromSource(
        `export const selected = "initial";`,
        filePath,
        root,
        denoAdapter,
        options,
      );
      await readStarted;

      assertEquals(observedProperties.has("moduleServerUrl"), true);
      assertEquals(observedProperties.has("vendorBundleHash"), true);
      assertEquals(observedProperties.has("importMap"), true);
      callerOptions.moduleServerUrl = "/mutated-modules";
      callerOptions.vendorBundleHash = "mutated-vendor";
      releaseRead();

      assertEquals((await loadPromise).selected, "initial");
    } finally {
      releaseRead();
      if (originalFlag === undefined) {
        deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
      } else {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      }
      await remove(root, { recursive: true });
    }
  });
});
