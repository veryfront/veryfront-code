import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { validateVeryfrontConfig } from "#veryfront/config";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { VirtualModuleSystem } from "./virtual-module-system.ts";

describe(
  "rendering/virtual-module-system",
  () => {
    afterAll(async () => {
      const { stop } = await import("veryfront/extensions/bundler");
      await stop();
    });

    it("uses hosted config context without an ambient config reload", async () => {
      const adapter = createMockAdapter();
      let configFileProbes = 0;
      Object.assign(adapter.fs, {
        getUnderlyingAdapter: () => adapter.fs,
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        exists: async () => {
          configFileProbes += 1;
          return true;
        },
        readFile: async (path: string) => {
          if (path === "deno.json") return "{}";
          configFileProbes += 1;
          throw new Error(`Unexpected hosted filesystem read: ${path}`);
        },
      });
      const config = validateVeryfrontConfig({
        resolve: {
          importMap: {
            imports: {
              "hosted-package": "https://config.example/hosted-package.ts",
            },
          },
        },
      });
      const modules = new VirtualModuleSystem("/_veryfront/modules", adapter, {
        projectId: "project-1",
        contentSourceId: "release-1",
        config,
      });

      await modules.registerModule(
        "hosted",
        'import hosted from "hosted-package"; export default hosted;',
        "/hosted-project",
        "ts",
      );

      assert(
        modules.getModule("hosted")?.transformed?.includes(
          "https://config.example/hosted-package.ts",
        ),
      );
      assertEquals(configFileProbes, 0);
    });

    it("keeps its request-bound import map after post-import Promise.resolve poisoning", async () => {
      const adapter = createMockAdapter();
      const importMap = {
        imports: {
          package: "https://config.example/request-package.ts",
        },
        scopes: {},
      };
      const substitutedMap = {
        imports: {
          package: "https://config.example/poisoned-package.ts",
        },
        scopes: {},
      };
      const substitutedPromise = Promise.resolve(substitutedMap);
      const resolveDescriptor = Object.getOwnPropertyDescriptor(Promise, "resolve");
      if (resolveDescriptor === undefined) {
        throw new Error("Promise.resolve descriptor is unavailable");
      }
      const modules = new VirtualModuleSystem("/_veryfront/modules", adapter, {
        importMap,
      });

      Object.defineProperty(Promise, "resolve", {
        ...resolveDescriptor,
        value: () => substitutedPromise,
      });
      let resolvedImportMap;
      try {
        resolvedImportMap = await modules.getImportMap("/project");
      } finally {
        Object.defineProperty(Promise, "resolve", resolveDescriptor);
      }

      assertEquals(resolvedImportMap, importMap);
    });
  },
);
