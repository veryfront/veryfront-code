import "#veryfront/schemas/_test-setup.ts";
/**
 * LibModulesHandler Tests
 *
 * Tests the allowed modules whitelist and module path resolution logic.
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { LIB_MODULE_PATHS, LibModulesHandler } from "./lib-modules.handler.ts";
import {
  clearReactVersionCache,
  createDependencyPinningSource,
  type DependencyPinningSource,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { createMockAdapter, type MockRuntimeAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { HandlerContext } from "../types.ts";
import type { VeryfrontConfig } from "#veryfront/config";

const PROJECT_DIR = "/project";
const MODULE_PATH = `${PROJECT_DIR}/node_modules/veryfront/esm/src/chat/index.js`;
const INSTALLED_PACKAGE_PATH = `${PROJECT_DIR}/node_modules/veryfront/package.json`;
const PROJECT_PACKAGE_PATH = `${PROJECT_DIR}/package.json`;
const MODULE_SOURCE = "export const chat = true;";
const originalPinningFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);

afterEach(() => {
  setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalPinningFlag ?? "");
  clearReactVersionCache();
});

function createHandler(): LibModulesHandler {
  return new LibModulesHandler();
}

function createAdapter(
  projectDeclaration = "0.1.10",
  installedVersion = "0.1.10",
): MockRuntimeAdapter {
  const adapter = createMockAdapter();
  adapter.fs.files.set(
    PROJECT_PACKAGE_PATH,
    JSON.stringify({ dependencies: { veryfront: projectDeclaration } }),
  );
  adapter.fs.files.set(
    INSTALLED_PACKAGE_PATH,
    JSON.stringify({ version: installedVersion }),
  );
  adapter.fs.files.set(MODULE_PATH, MODULE_SOURCE);
  Object.assign(adapter.fs, {
    getUnderlyingAdapter: () => adapter.fs,
    getAdapterType: () => "VeryfrontFSAdapter",
    isMultiProjectMode: () => false,
    isVeryfrontAdapter: () => true,
  });
  return adapter;
}

function createContext(
  adapter: MockRuntimeAdapter,
  overrides: Partial<HandlerContext> = {},
): HandlerContext {
  return {
    projectDir: PROJECT_DIR,
    adapter,
    securityConfig: {},
    cspUserHeader: null,
    config: { client: { moduleResolution: "self-hosted" } },
    parsedDomain: { allowIframeEmbed: false } as HandlerContext["parsedDomain"],
    ...overrides,
  };
}

function sourceFor(
  adapter: MockRuntimeAdapter,
  projectScope = "project-id",
  contentScope = "release-a",
  config?: VeryfrontConfig,
): DependencyPinningSource {
  return createDependencyPinningSource({
    projectDir: PROJECT_DIR,
    adapter,
    projectId: projectScope,
    contentSourceId: contentScope,
    isLocalProject: false,
    config,
  });
}

async function requestChat(
  ctx: HandlerContext,
  query = "",
  method = "GET",
): Promise<Response> {
  const result = await createHandler().handle(
    new Request(`http://localhost/_veryfront/lib/chat.js${query}`, { method }),
    ctx,
  );
  assertExists(result.response);
  return result.response;
}

function getPattern(handler: LibModulesHandler, method: string): RegExp {
  const patterns = handler.metadata.patterns;
  if (!patterns?.length) throw new Error("No patterns defined");

  const pattern = patterns.find((p) => p.method === method)?.pattern;
  if (!(pattern instanceof RegExp)) {
    throw new Error(`Pattern for method ${method} not found or not a RegExp`);
  }

  return pattern;
}

describe("LibModulesHandler", () => {
  describe("metadata", () => {
    it("should have correct handler name", () => {
      const handler = createHandler();
      assertEquals(handler.metadata.name, "LibModulesHandler");
    });

    it("should have priority defined", () => {
      const handler = createHandler();
      assertExists(handler.metadata.priority);
      assertEquals(typeof handler.metadata.priority, "number");
    });

    it("should have two patterns (GET and HEAD)", () => {
      const handler = createHandler();
      assertExists(handler.metadata.patterns);
      assertEquals(handler.metadata.patterns?.length, 2);
    });

    it("should match GET requests to /_veryfront/lib/", () => {
      const pattern = getPattern(createHandler(), "GET");

      assertEquals(pattern.test("/_veryfront/lib/agent/react.js"), true);
      assertEquals(pattern.test("/_veryfront/lib/components/chat.js"), true);
      assertEquals(pattern.test("/_veryfront/lib/primitives.js"), true);
    });

    it("should match HEAD requests to /_veryfront/lib/", () => {
      const pattern = getPattern(createHandler(), "HEAD");
      assertEquals(pattern.test("/_veryfront/lib/agent/react.js"), true);
    });

    it("should not match other paths", () => {
      const pattern = getPattern(createHandler(), "GET");

      assertEquals(pattern.test("/api/users"), false);
      assertEquals(pattern.test("/veryfront/lib/chat/react.js"), false);
      assertEquals(pattern.test("/"), false);
    });
  });

  describe("ALLOWED_MODULES whitelist", () => {
    it("should resolve allowed self-hosted module paths", () => {
      assertEquals(LIB_MODULE_PATHS["chat.js"], "esm/src/chat/index.js");
      assertEquals(LIB_MODULE_PATHS["markdown.js"], "esm/src/markdown/index.js");
      assertEquals(LIB_MODULE_PATHS["mdx.js"], "esm/src/mdx/index.js");
      assertEquals(LIB_MODULE_PATHS["workflow.js"], "esm/src/workflow/react/index.js");
    });
  });

  describe("URL pattern matching", () => {
    it("should match lib module path prefix", () => {
      const pattern = getPattern(createHandler(), "GET");

      assertEquals(pattern.test("/_veryfront/lib/"), true);
      assertEquals(pattern.test("/_veryfront/lib/anything"), true);
    });

    it("should not match paths without /_veryfront/lib/ prefix", () => {
      const pattern = getPattern(createHandler(), "GET");

      assertEquals(pattern.test("/veryfront/lib/agent/react.js"), false);
      assertEquals(pattern.test("/_veryfront/agent/react.js"), false);
      assertEquals(pattern.test("/lib/agent/react.js"), false);
    });

    it("should be case sensitive", () => {
      const pattern = getPattern(createHandler(), "GET");

      assertEquals(pattern.test("/_veryfront/lib/agent/react.js"), true);
      assertEquals(pattern.test("/_VERYFRONT/lib/agent/react.js"), false);
      assertEquals(pattern.test("/_Veryfront/lib/agent/react.js"), false);
    });
  });

  describe("handler instance", () => {
    it("should be instantiable", () => {
      const handler = createHandler();
      assertExists(handler);
    });

    it("should have handle method", () => {
      const handler = createHandler();
      assertEquals(typeof handler.handle, "function");
    });

    it("should extend BaseHandler", () => {
      const handler = createHandler();
      assertExists(handler.metadata);
      assertExists(handler.handle);
    });
  });

  describe("dependency snapshot enforcement", () => {
    it("keeps flag-off serving behavior unchanged", async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
      const response = await requestChat(
        createContext(createAdapter(), { isLocalProject: true }),
        "?pins=malformed&pins=duplicate",
      );

      assertEquals(response.status, 200);
      assertEquals(await response.text(), MODULE_SOURCE);
    });

    it("serves exactly matching source-scoped snapshots", async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      const adapter = createAdapter();
      const snapshot = await getDependencyPinningSnapshot(sourceFor(adapter));
      const ctx = createContext(adapter, {
        isLocalProject: false,
        projectId: "project-id",
        releaseId: "release-a",
      });

      const response = await requestChat(
        ctx,
        `?pins=${encodeURIComponent(snapshot.cacheKey)}`,
      );

      assertEquals(response.status, 200);
      assertEquals(await response.text(), MODULE_SOURCE);
      assertEquals(response.headers.get("cache-control")?.includes("immutable"), true);
    });

    it("isolates equal project paths across content sources", async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      const adapterA = createAdapter("0.1.10", "0.1.10");
      const adapterB = createAdapter("0.2.0", "0.2.0");
      const snapshotA = await getDependencyPinningSnapshot(
        sourceFor(adapterA, "project-id", "release-a"),
      );
      const snapshotB = await getDependencyPinningSnapshot(
        sourceFor(adapterB, "project-id", "release-b"),
      );

      const responseA = await requestChat(
        createContext(adapterA, {
          isLocalProject: false,
          projectId: "project-id",
          releaseId: "release-a",
        }),
        `?pins=${encodeURIComponent(snapshotA.cacheKey)}`,
      );
      const responseB = await requestChat(
        createContext(adapterB, {
          isLocalProject: false,
          projectId: "project-id",
          releaseId: "release-b",
        }),
        `?pins=${encodeURIComponent(snapshotB.cacheKey)}`,
      );
      const crossed = await requestChat(
        createContext(adapterB, {
          isLocalProject: false,
          projectId: "project-id",
          releaseId: "release-b",
        }),
        `?pins=${encodeURIComponent(snapshotA.cacheKey)}`,
      );

      assertEquals(responseA.status, 200);
      assertEquals(responseB.status, 200);
      assertEquals(crossed.status, 409);
      assertEquals(crossed.headers.get("cache-control"), "no-store");
    });

    it("fails closed when installed code moved from snapshot A to B", async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      const adapter = createAdapter("0.1.10", "0.1.10");
      let revision = 1;
      const stat = adapter.fs.stat.bind(adapter.fs);
      adapter.fs.stat = async (path) => ({
        ...await stat(path),
        mtime: new Date(revision),
      });
      const source = sourceFor(adapter);
      const snapshotA = await getDependencyPinningSnapshot(source);

      revision++;
      adapter.fs.files.set(
        PROJECT_PACKAGE_PATH,
        JSON.stringify({ dependencies: { veryfront: "0.2.0" } }),
      );
      adapter.fs.files.set(
        INSTALLED_PACKAGE_PATH,
        JSON.stringify({ version: "0.2.0" }),
      );
      const snapshotB = await getDependencyPinningSnapshot(source);
      const ctx = createContext(adapter, {
        isLocalProject: false,
        projectId: "project-id",
        releaseId: "release-a",
      });

      const historical = await requestChat(
        ctx,
        `?pins=${encodeURIComponent(snapshotA.cacheKey)}`,
      );
      const current = await requestChat(
        ctx,
        `?pins=${encodeURIComponent(snapshotB.cacheKey)}`,
      );

      assertEquals(historical.status, 409);
      assertEquals(historical.headers.get("cache-control"), "no-store");
      assertEquals(current.status, 200);
    });

    it("requires exactly one valid enabled snapshot token", async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      const adapter = createAdapter();
      const ctx = createContext(adapter, {
        isLocalProject: false,
        projectId: "project-id",
        releaseId: "release-a",
      });

      for (
        const query of [
          "",
          "?pins=off",
          "?pins=on%3A",
          "?pins=on%3Amissing",
          "?pins=on%3Aa&pins=on%3Ab",
        ]
      ) {
        const response = await requestChat(ctx, query);
        assertEquals(response.status, 409, query);
        assertEquals(response.headers.get("cache-control"), "no-store", query);
      }

      const head = await requestChat(ctx, "", "HEAD");
      assertEquals(head.status, 409);
      assertEquals(await head.text(), "");
    });

    it("rejects ranges, tags, missing declarations, and installed mismatches", async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");

      for (
        const [declaration, installed] of [
          ["^0.1.10", "0.1.10"],
          ["latest", "0.1.10"],
          ["0.1.10", "0.2.0"],
        ]
      ) {
        const adapter = createAdapter(declaration, installed);
        const snapshot = await getDependencyPinningSnapshot(sourceFor(adapter));
        const response = await requestChat(
          createContext(adapter, {
            isLocalProject: false,
            projectId: "project-id",
            releaseId: "release-a",
          }),
          `?pins=${encodeURIComponent(snapshot.cacheKey)}`,
        );

        assertEquals(response.status, 409, `${declaration} / ${installed}`);
        assertEquals(response.headers.get("cache-control"), "no-store");
      }

      const unresolvedAdapter = createAdapter();
      unresolvedAdapter.fs.files.set(PROJECT_PACKAGE_PATH, JSON.stringify({ dependencies: {} }));
      const unresolved = await getDependencyPinningSnapshot(sourceFor(unresolvedAdapter));
      const unresolvedResponse = await requestChat(
        createContext(unresolvedAdapter, {
          isLocalProject: false,
          projectId: "project-id",
          releaseId: "release-a",
        }),
        `?pins=${encodeURIComponent(unresolved.cacheKey)}`,
      );
      assertEquals(unresolvedResponse.status, 409);
      assertEquals(unresolvedResponse.headers.get("cache-control"), "no-store");
    });

    it("lets an exact config version override the snapshot declaration", async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      const adapter = createAdapter("0.2.0", "0.1.10");
      const exactConfig: VeryfrontConfig = {
        client: {
          moduleResolution: "self-hosted",
          cdn: { versions: { veryfront: "0.1.10" } },
        },
      };
      const snapshot = await getDependencyPinningSnapshot(
        sourceFor(adapter, "project-id", "release-a", exactConfig),
      );
      const ctx = createContext(adapter, {
        isLocalProject: false,
        projectId: "project-id",
        releaseId: "release-a",
        config: exactConfig,
      });

      const exact = await requestChat(
        ctx,
        `?pins=${encodeURIComponent(snapshot.cacheKey)}`,
      );
      assertEquals(exact.status, 200);

      const rangeConfig: VeryfrontConfig = {
        client: {
          moduleResolution: "self-hosted",
          cdn: { versions: { veryfront: "^0.1.10" } },
        },
      };
      ctx.config = rangeConfig;
      const historical = await requestChat(
        ctx,
        `?pins=${encodeURIComponent(snapshot.cacheKey)}`,
      );
      assertEquals(historical.status, 200);

      const rangeSnapshot = await getDependencyPinningSnapshot(
        sourceFor(adapter, "project-id", "release-a", rangeConfig),
      );
      const range = await requestChat(
        ctx,
        `?pins=${encodeURIComponent(rangeSnapshot.cacheKey)}`,
      );
      assertEquals(range.status, 409);
      assertEquals(range.headers.get("cache-control"), "no-store");
    });
  });
});
