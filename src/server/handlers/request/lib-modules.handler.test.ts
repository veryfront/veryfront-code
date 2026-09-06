import "#veryfront/schemas/_test-setup.ts";
/**
 * LibModulesHandler Tests
 *
 * Tests the allowed modules whitelist and module path resolution logic.
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
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
const WORKFLOW_MODULE_SOURCE = "export const useWorkflow = true;";
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
  const statFixtureFile = adapter.fs.stat.bind(adapter.fs);
  const fixtureMetadata = new Map<string, { content: string | undefined; mtimeMs: number }>();
  adapter.fs.stat = async (path) => {
    const info = await statFixtureFile(path);
    const content = adapter.fs.files.get(path);
    let metadata = fixtureMetadata.get(path);
    // The generic mock reports the current clock on every stat. A fixture file
    // changes only when its bytes change, including across asynchronous reads.
    if (!metadata || metadata.content !== content) {
      metadata = { content, mtimeMs: (metadata?.mtimeMs ?? 0) + 1 };
      fixtureMetadata.set(path, metadata);
    }
    return { ...info, mtime: new Date(metadata.mtimeMs) };
  };
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

async function requestModule(
  module: string,
  ctx: HandlerContext,
  query = "",
  method = "GET",
  headers?: HeadersInit,
): Promise<Response> {
  const result = await createHandler().handle(
    new Request(`http://localhost/_veryfront/lib/${module}${query}`, { method, headers }),
    ctx,
  );
  assertExists(result.response);
  return result.response;
}

function requestChat(
  ctx: HandlerContext,
  query = "",
  method = "GET",
  headers?: HeadersInit,
): Promise<Response> {
  return requestModule("chat.js", ctx, query, method, headers);
}

async function createPinnedFixture(adapter = createAdapter()): Promise<{
  adapter: MockRuntimeAdapter;
  ctx: HandlerContext;
  query: string;
}> {
  setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
  const snapshot = await getDependencyPinningSnapshot(sourceFor(adapter));
  return {
    adapter,
    ctx: createContext(adapter, {
      isLocalProject: false,
      projectId: "project-id",
      releaseId: "release-a",
    }),
    query: `?pins=${encodeURIComponent(snapshot.cacheKey)}`,
  };
}

function configThatThrowsDuringSnapshotResolution(failure: unknown): VeryfrontConfig {
  const config = {
    client: { moduleResolution: "self-hosted" },
  } as VeryfrontConfig;
  Object.defineProperty(config, "react", {
    enumerable: true,
    get() {
      throw failure;
    },
  });
  return config;
}

function getPattern(handler: LibModulesHandler): RegExp {
  const patterns = handler.metadata.patterns;
  if (!patterns?.length) throw new Error("No patterns defined");

  const pattern = patterns[0]?.pattern;
  if (!(pattern instanceof RegExp)) {
    throw new Error("Handler pattern not found or not a RegExp");
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

    it("owns the namespace for every method", () => {
      const handler = createHandler();
      assertExists(handler.metadata.patterns);
      assertEquals(handler.metadata.patterns?.length, 1);
      assertEquals(handler.metadata.patterns?.[0]?.method, undefined);
    });

    it("should match GET requests to /_veryfront/lib/", () => {
      const pattern = getPattern(createHandler());

      assertEquals(pattern.test("/_veryfront/lib/agent/react.js"), true);
      assertEquals(pattern.test("/_veryfront/lib/components/chat.js"), true);
      assertEquals(pattern.test("/_veryfront/lib/primitives.js"), true);
    });

    it("should match HEAD requests to /_veryfront/lib/", () => {
      const pattern = getPattern(createHandler());
      assertEquals(pattern.test("/_veryfront/lib/agent/react.js"), true);
    });

    it("should not match other paths", () => {
      const pattern = getPattern(createHandler());

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

    // The package builds and exports the React workflow entry from
    // src/workflow/react/index.ts, so the published file is
    // esm/src/workflow/react/index.js. Serving it from any other path 404s the
    // `veryfront/workflow` import that src/html/utils.ts maps to this route.
    it("should serve workflow.js from the published workflow/react build output", async () => {
      const adapter = createAdapter();
      adapter.fs.files.set(
        `${PROJECT_DIR}/node_modules/veryfront/esm/src/workflow/react/index.js`,
        WORKFLOW_MODULE_SOURCE,
      );

      const response = await requestModule("workflow.js", createContext(adapter));

      assertEquals(response.status, 200);
      assertEquals(await response.text(), WORKFLOW_MODULE_SOURCE);
    });
  });

  describe("URL pattern matching", () => {
    it("should match lib module path prefix", () => {
      const pattern = getPattern(createHandler());

      assertEquals(pattern.test("/_veryfront/lib/"), true);
      assertEquals(pattern.test("/_veryfront/lib/anything"), true);
    });

    it("should not match paths without /_veryfront/lib/ prefix", () => {
      const pattern = getPattern(createHandler());

      assertEquals(pattern.test("/veryfront/lib/agent/react.js"), false);
      assertEquals(pattern.test("/_veryfront/agent/react.js"), false);
      assertEquals(pattern.test("/lib/agent/react.js"), false);
    });

    it("should be case sensitive", () => {
      const pattern = getPattern(createHandler());

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

    it("rejects unsupported methods without falling through", async () => {
      const result = await createHandler().handle(
        new Request("http://localhost/_veryfront/lib/chat.js", { method: "POST" }),
        createContext(createAdapter()),
      );

      assertEquals(result.continue, false);
      assertExists(result.response);
      assertEquals(result.response.status, 405);
      assertEquals(result.response.headers.get("allow"), "GET, HEAD");
      assertEquals(result.response.headers.get("cache-control"), "no-store");
      assertEquals(await result.response.text(), "Method not allowed");
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

    it("falls through when the project has not opted into self-hosted module resolution", async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
      for (
        const config of [
          {},
          { client: { moduleResolution: "cdn" } },
        ] as Partial<HandlerContext>["config"][]
      ) {
        const result = await createHandler().handle(
          new Request("http://localhost/_veryfront/lib/chat.js"),
          createContext(createAdapter(), { isLocalProject: true, config }),
        );

        assertEquals(result.continue, true, "cdn mode must not claim the lib route");
        assertEquals(result.response, undefined, "cdn mode must not serve a lib module");
      }
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
      assertEquals(await historical.text(), "Unknown dependency snapshot");
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
      assertEquals(head.body, null);
    });

    it("uses the canonical conflict response for malformed pin requests", async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      const origin = "https://studio.example.com";
      const ctx = createContext(createAdapter(), {
        isLocalProject: false,
        projectId: "project-id",
        releaseId: "release-a",
        securityConfig: { cors: { origin } },
      });

      const response = await requestChat(ctx, "?pins=malformed", "GET", { origin });

      assertEquals(response.status, 409);
      assertEquals(await response.text(), "Unknown dependency snapshot");
      assertEquals(response.headers.get("cache-control"), "no-store");
      assertEquals(
        response.headers.get("vary")?.toLowerCase().includes("x-veryfront-dependency-pins"),
        true,
      );
      assertEquals(response.headers.get("access-control-allow-origin"), origin);
      assertEquals(response.headers.get("x-content-type-options"), "nosniff");
    });

    it("uses the canonical bodyless conflict response for HEAD", async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      const response = await requestChat(
        createContext(createAdapter(), {
          isLocalProject: false,
          projectId: "project-id",
          releaseId: "release-a",
        }),
        "",
        "HEAD",
      );

      assertEquals(response.status, 409);
      assertEquals(response.body, null);
      assertEquals(response.headers.get("cache-control"), "no-store");
      assertEquals(
        response.headers.get("vary")?.toLowerCase().includes("x-veryfront-dependency-pins"),
        true,
      );
    });

    for (
      const [label, installedMetadata] of [
        ["missing", undefined],
        ["malformed", "{"],
      ] as const
    ) {
      it(`returns a conflict when installed package metadata is ${label}`, async () => {
        const adapter = createAdapter();
        if (installedMetadata === undefined) {
          adapter.fs.files.delete(INSTALLED_PACKAGE_PATH);
        } else {
          adapter.fs.files.set(INSTALLED_PACKAGE_PATH, installedMetadata);
        }
        const { ctx, query } = await createPinnedFixture(adapter);

        const response = await requestChat(ctx, query);

        assertEquals(response.status, 409);
        assertEquals(await response.text(), "Unknown dependency snapshot");
        assertEquals(response.headers.get("cache-control"), "no-store");
      });
    }

    for (
      const [label, failure] of [
        [
          "an EACCES failure",
          Object.assign(new Error("snapshot access denied"), { code: "EACCES" }),
        ],
        ["an EIO failure", Object.assign(new Error("snapshot I/O failure"), { code: "EIO" })],
        ["an arbitrary failure", new Error("snapshot resolution failed")],
        ["a plain ENOENT-shaped rejection", Object.freeze({ code: "ENOENT" })],
      ] as const
    ) {
      it(`propagates ${label} from snapshot resolution unchanged`, async () => {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        const adapter = createAdapter();
        const ctx = createContext(adapter, {
          isLocalProject: false,
          projectId: "project-id",
          releaseId: "release-a",
          config: configThatThrowsDuringSnapshotResolution(failure),
        });

        const actual = await assertRejects(() =>
          createHandler().handle(
            new Request("http://localhost/_veryfront/lib/chat.js"),
            ctx,
          )
        );

        assertStrictEquals(actual, failure);
      });
    }

    it("propagates a hostile snapshot-resolution failure unchanged", async () => {
      const failure = new Proxy({}, {
        get() {
          throw new Error("snapshot failure must not be inspected");
        },
      });
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      const adapter = createAdapter();
      const ctx = createContext(adapter, {
        isLocalProject: false,
        projectId: "project-id",
        releaseId: "release-a",
        config: configThatThrowsDuringSnapshotResolution(failure),
      });

      let actual: unknown;
      try {
        await createHandler().handle(
          new Request("http://localhost/_veryfront/lib/chat.js"),
          ctx,
        );
      } catch (error) {
        actual = error;
      }

      assertEquals(Object.is(actual, failure), true);
    });

    for (
      const [label, failure] of [
        [
          "an EACCES failure",
          Object.assign(new Error("metadata access denied"), { code: "EACCES" }),
        ],
        ["an EIO failure", Object.assign(new Error("metadata I/O failure"), { code: "EIO" })],
        ["an arbitrary failure", new Error("metadata read failed")],
        ["a plain ENOENT-shaped rejection", Object.freeze({ code: "ENOENT" })],
      ] as const
    ) {
      it(`propagates ${label} from installed metadata access unchanged`, async () => {
        const { adapter, ctx, query } = await createPinnedFixture();
        const readFile = adapter.fs.readFile.bind(adapter.fs);
        adapter.fs.readFile = (path) =>
          path === INSTALLED_PACKAGE_PATH ? Promise.reject(failure) : readFile(path);

        const actual = await assertRejects(() =>
          createHandler().handle(
            new Request(`http://localhost/_veryfront/lib/chat.js${query}`),
            ctx,
          )
        );

        assertStrictEquals(actual, failure);
      });
    }

    it("propagates a hostile installed-metadata failure unchanged", async () => {
      const failure = new Proxy({}, {
        get() {
          throw new Error("installed metadata failure must not be inspected");
        },
      });
      const { adapter, ctx, query } = await createPinnedFixture();
      const readFile = adapter.fs.readFile.bind(adapter.fs);
      adapter.fs.readFile = (path) =>
        path === INSTALLED_PACKAGE_PATH ? Promise.reject(failure) : readFile(path);

      let actual: unknown;
      try {
        await createHandler().handle(
          new Request(`http://localhost/_veryfront/lib/chat.js${query}`),
          ctx,
        );
      } catch (error) {
        actual = error;
      }

      assertEquals(Object.is(actual, failure), true);
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

  describe("module source responses", () => {
    it("preserves successful GET, HEAD, and conditional request semantics", async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
      const ctx = createContext(createAdapter(), { isLocalProject: false });

      const get = await requestChat(ctx);
      const etag = get.headers.get("etag");
      assertExists(etag);
      assertEquals(get.status, 200);
      assertEquals(get.headers.get("cache-control")?.includes("immutable"), true);
      assertEquals(get.headers.get("content-type"), "application/javascript; charset=utf-8");
      assertEquals(await get.text(), MODULE_SOURCE);

      const head = await requestChat(ctx, "", "HEAD");
      assertEquals(head.status, 200);
      assertEquals(head.body, null);
      assertEquals(head.headers.get("etag"), etag);
      assertEquals(head.headers.get("cache-control")?.includes("immutable"), true);

      const notModified = await requestChat(ctx, "", "GET", { "if-none-match": etag });
      assertEquals(notModified.status, 304);
      assertEquals(notModified.body, null);
      assertEquals(notModified.headers.get("etag"), etag);
    });

    it("preserves the whitelist rejection response", async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
      const result = await createHandler().handle(
        new Request("http://localhost/_veryfront/lib/%2e%2e%2fprivate.js"),
        createContext(createAdapter(), { isLocalProject: false }),
      );
      assertExists(result.response);

      assertEquals(result.response.status, 404);
      assertEquals(result.response.headers.get("cache-control")?.includes("no-cache"), true);
      assertEquals(await result.response.text(), "Module not found");
    });

    it("maps only canonical module absence to the current no-cache 404", async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
      const adapter = createAdapter();
      adapter.fs.files.delete(MODULE_PATH);

      const response = await requestChat(
        createContext(adapter, { isLocalProject: false }),
      );

      assertEquals(response.status, 404);
      assertEquals(response.headers.get("cache-control")?.includes("no-cache"), true);
      assertEquals(await response.text(), "Module not found");
    });

    for (
      const [label, failure] of [
        ["an EACCES failure", Object.assign(new Error("module access denied"), { code: "EACCES" })],
        ["an EIO failure", Object.assign(new Error("module I/O failure"), { code: "EIO" })],
        ["an arbitrary failure", new Error("module read failed")],
        ["a plain ENOENT-shaped rejection", Object.freeze({ code: "ENOENT" })],
      ] as const
    ) {
      it(`propagates ${label} from the module source read unchanged`, async () => {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
        const adapter = createAdapter();
        const readFile = adapter.fs.readFile.bind(adapter.fs);
        adapter.fs.readFile = (path) =>
          path === MODULE_PATH ? Promise.reject(failure) : readFile(path);
        const ctx = createContext(adapter, { isLocalProject: false });

        const actual = await assertRejects(() =>
          createHandler().handle(
            new Request("http://localhost/_veryfront/lib/chat.js"),
            ctx,
          )
        );

        assertStrictEquals(actual, failure);
      });
    }
  });
});
