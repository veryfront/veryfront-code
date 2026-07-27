import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
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

    it("matches only the configured path boundary and handles malformed IDs", () => {
      const modules = new VirtualModuleSystem(
        "/_veryfront/modules",
        createMockAdapter(),
        { importMap: { imports: {}, scopes: {} } },
      );

      assertEquals(
        modules.handleRequest(
          new Request("http://local/_veryfront/modules-evil/component"),
        ),
        null,
      );
      assertEquals(
        modules.handleRequest(
          new Request("http://local/_veryfront/modules/%E0%A4%A"),
        )?.status,
        400,
      );
    });

    it("admits only GET, HEAD, and OPTIONS requests", async () => {
      const modules = new VirtualModuleSystem(
        "/_veryfront/modules",
        createMockAdapter(),
        { importMap: { imports: {}, scopes: {} } },
      );
      const url = await modules.registerModule(
        "method-test",
        "export const value = 1;",
        "/project",
        "ts",
      );

      const post = modules.handleRequest(
        new Request(`http://local${url}`, { method: "POST" }),
      );
      const head = modules.handleRequest(
        new Request(`http://local${url}`, { method: "HEAD" }),
      );
      const options = modules.handleRequest(
        new Request(`http://local${url}`, { method: "OPTIONS" }),
      );

      assertEquals(post?.status, 405);
      assertEquals(post?.headers.get("allow"), "GET, HEAD, OPTIONS");
      assertEquals(head?.status, 200);
      assertEquals(await head?.text(), "");
      assertEquals(options?.status, 204);
    });

    it("normalizes its base URL and rewrites relative imports to that base", async () => {
      const modules = new VirtualModuleSystem(
        "/_custom/modules/",
        createMockAdapter(),
        { importMap: { imports: {}, scopes: {} } },
      );

      const url = await modules.registerModule(
        "component:entry",
        'import Button from "./my-button"; export default Button;',
        "/project",
        "ts",
      );

      assertEquals(url, "/_custom/modules/component%3Aentry");
      assert(
        modules.getModule("component:entry")?.transformed?.includes(
          '"/_custom/modules/component:my-button"',
        ),
      );
    });

    it("rejects invalid base URLs, module IDs, and oversized sources", async () => {
      const adapter = createMockAdapter();
      assertThrows(
        () => new VirtualModuleSystem("relative/modules", adapter),
        TypeError,
        "absolute path",
      );
      assertThrows(
        () => new VirtualModuleSystem("/modules/../escape", adapter),
        TypeError,
        "canonical",
      );

      const modules = new VirtualModuleSystem("/_veryfront/modules", adapter, {
        importMap: { imports: {}, scopes: {} },
      });
      await assertRejects(
        () => modules.registerModule("", "export {};", "/project", "ts"),
        TypeError,
        "module ID",
      );
      await assertRejects(
        () =>
          modules.registerModule(
            "oversized",
            "x".repeat(5 * 1024 * 1024 + 1),
            "/project",
            "ts",
          ),
        RangeError,
        "source byte limit",
      );
    });

    it("does not expose mutable retained modules or permissive CORS headers", async () => {
      const modules = new VirtualModuleSystem(
        "/_veryfront/modules",
        createMockAdapter(),
        { importMap: { imports: {}, scopes: {} } },
      );
      const url = await modules.registerModule(
        "immutable",
        "export const original = true;",
        "/project",
        "ts",
      );
      const exposed = modules.getModule("immutable") as
        | { transformed?: string }
        | undefined;
      if (!exposed) throw new Error("Expected registered module");
      exposed.transformed = "export const poisoned = true;";

      const response = modules.handleRequest(new Request(`http://local${url}`));
      const source = await response?.text();

      assertEquals(source?.includes("poisoned"), false);
      assertEquals(response?.headers.get("access-control-allow-origin"), null);
      assertEquals(response?.headers.get("access-control-allow-methods"), null);
    });

    it("registers module batches atomically", async () => {
      const modules = new VirtualModuleSystem(
        "/_veryfront/modules",
        createMockAdapter(),
        { importMap: { imports: {}, scopes: {} } },
      );
      await modules.registerModule(
        "component:existing",
        "export const original = true;",
        "/project",
        "ts",
      );

      await assertRejects(
        () =>
          modules.registerModules(
            [
              {
                id: "component:existing",
                source: "export const replacement = true;",
                fileType: "ts",
              },
              {
                id: "component:new",
                source: "export const broken = ;",
                fileType: "ts",
              },
            ],
            "/project",
          ),
      );

      assert(
        modules.getModule("component:existing")?.source.includes("original"),
      );
      assertEquals(modules.getModule("component:new"), undefined);
    });
  },
);
