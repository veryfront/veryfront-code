import "#veryfront/schemas/_test-setup.ts";

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { API_CLIENT_ERROR, VeryfrontError } from "#veryfront/errors";
import { VeryfrontFSAdapter } from "./adapter.ts";
import { waitFor } from "./adapter.test-helpers.ts";
import { ProxyFSAdapterManager } from "./proxy-manager.ts";
import type { FSAdapterConfig } from "./types.ts";

const baseConfig = {
  veryfront: {
    apiBaseUrl: "https://api.example.com",
    apiToken: "test-token",
    projectSlug: "test-project",
    cache: { enabled: false },
  },
};

function createManager(
  options: Partial<ConstructorParameters<typeof ProxyFSAdapterManager>[0]> = {},
): ProxyFSAdapterManager {
  return new ProxyFSAdapterManager({ baseConfig, ...options });
}

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function assertGetAdapterRejects(
  manager: ProxyFSAdapterManager,
  args: Parameters<ProxyFSAdapterManager["getAdapter"]>,
  messageIncludes: string,
): Promise<void> {
  try {
    await manager.getAdapter(...args);
    assertEquals(true, false, "Should have thrown");
  } catch (e) {
    assertExists(e);
    assertEquals(e instanceof Error, true);
    assertEquals((e as Error).message.includes(messageIncludes), true);
  }
}

describe("ProxyFSAdapterManager", () => {
  describe("exact preview source", () => {
    it("preserves missing-branch status without exposing branch context", async () => {
      const branch = "push-20260324t121046";
      const error = API_CLIENT_ERROR.create({
        detail: `Branch '${branch}' was not found at pages/private.tsx`,
        status: 404,
        context: {
          details: {
            responseText: JSON.stringify({ detail: `Branch '${branch}' not found` }),
            url:
              `https://api.example.com/projects/my-project/files?limit=100&sort_by=updated_at&sort_order=desc&branch=${
                encodeURIComponent(branch)
              }`,
          },
        },
      });
      const attemptedBranches: Array<string | null | undefined> = [];
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = async () => {
            const context = adapter.getContentContext();
            attemptedBranches.push(context?.sourceType === "branch" ? context.branch : null);
            throw error;
          };
          return adapter;
        },
      });

      try {
        const publicError = await assertRejects(
          () =>
            manager.getAdapter(
              "my-project",
              "test-token",
              undefined,
              false,
              null,
              null,
              branch,
            ),
          VeryfrontError,
          "Filesystem resource was not found",
        );
        assert(publicError instanceof VeryfrontError);
        assertEquals(publicError.slug, "api-client-error");
        assertEquals(publicError.status, 404);
        assertEquals(publicError.context, undefined);
        assertEquals(publicError.message.includes(branch), false);
        assertEquals(publicError.message.includes("pages/private.tsx"), false);
        assertEquals(attemptedBranches, [branch]);
        assertEquals(manager.hasAdapter("my-project", false, null, "main"), false);
      } finally {
        manager.dispose();
      }
    });

    it("preserves sanitized registered API errors", async () => {
      const error = API_CLIENT_ERROR.create({
        detail: "API request failed with status 503",
        status: 503,
        context: {
          details: {
            method: "GET",
            operation: "listFiles",
            route: "/projects/:projectSlug/files",
            status: 503,
          },
        },
      });
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.reject(error);
          return adapter;
        },
      });

      try {
        const publicError = await assertRejects(
          () =>
            manager.getAdapter(
              "my-project",
              "test-token",
              undefined,
              false,
              null,
              null,
              "main",
            ),
          VeryfrontError,
          "API request failed with status 503",
        );
        assert(publicError instanceof VeryfrontError);
        assertEquals(publicError, error);
        assertEquals(publicError.status, 503);
      } finally {
        manager.dispose();
      }
    });
  });

  describe("exact production source", () => {
    it("rejects mutable environment selection without an immutable release", async () => {
      const manager = createManager();
      try {
        await assertGetAdapterRejects(
          manager,
          ["my-project", "test-token", undefined, true, null, "Production", null],
          "releaseId is required in production mode",
        );
      } finally {
        manager.dispose();
      }
    });

    it("keeps environment name and release id in the resolved context", async () => {
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });
      try {
        const adapter = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          true,
          "release-42",
          "Production",
          null,
        );

        assertEquals(adapter.getContentContext(), {
          sourceType: "environment",
          projectSlug: "my-project",
          environmentName: "Production",
          releaseId: "release-42",
        });
      } finally {
        manager.dispose();
      }
    });

    it("keeps a release-only source distinct from the production environment", async () => {
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });
      try {
        const adapter = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          true,
          "release-42",
          null,
          null,
        );

        assertEquals(adapter.getContentContext(), {
          sourceType: "release",
          projectSlug: "my-project",
          releaseId: "release-42",
        });
      } finally {
        manager.dispose();
      }
    });

    it("uses the release-only identity for lookup and eviction", async () => {
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });
      try {
        await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          true,
          "release-42",
          null,
          null,
        );

        assertEquals(manager.hasAdapter("my-project", true, "release-42"), true);
        assertEquals(
          manager.hasAdapter("my-project", true, "release-42", null, "Production"),
          false,
        );

        manager.evictAdapter("my-project", true, "release-42");
        assertEquals(manager.hasAdapter("my-project", true, "release-42"), false);
      } finally {
        manager.dispose();
      }
    });
  });

  describe("class", () => {
    it("should export ProxyFSAdapterManager class", () => {
      assertExists(ProxyFSAdapterManager);
      assertEquals(typeof ProxyFSAdapterManager, "function");
    });
  });

  describe("constructor", () => {
    it("should be instantiable with minimal config", () => {
      const manager = createManager();
      assertExists(manager);
      manager.dispose();
    });

    it("should accept maxAdapters option", () => {
      const manager = createManager({ maxAdapters: 50 });
      assertExists(manager);
      manager.dispose();
    });

    it("should accept maxIdleMs option", () => {
      const manager = createManager({ maxIdleMs: 60000 });
      assertExists(manager);
      manager.dispose();
    });

    it("should accept cleanupIntervalMs option", () => {
      const manager = createManager({ cleanupIntervalMs: 30000 });
      assertExists(manager);
      manager.dispose();
    });

    it("should default maxAdapters to 100", () => {
      const manager = createManager();
      assertExists(manager);
      manager.dispose();
    });

    it("snapshots base configuration before adapters are created", async () => {
      const originalReload = () => {};
      const replacementReload = () => {};
      const mutableBaseConfig: FSAdapterConfig = {
        type: "veryfront-api",
        projectDir: "/tmp/project-before",
        veryfront: {
          apiBaseUrl: "https://before.example.com",
          apiToken: "token-before",
          projectSlug: "base-project",
          contentSource: { type: "branch", branch: "main" },
          cache: { enabled: false },
          retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
        },
        invalidationCallbacks: { triggerReload: originalReload },
      };
      let capturedConfig: FSAdapterConfig | undefined;
      const manager = new ProxyFSAdapterManager({
        baseConfig: mutableBaseConfig,
        adapterFactory: (config) => {
          capturedConfig = config;
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });

      mutableBaseConfig.projectDir = "/tmp/project-after";
      mutableBaseConfig.veryfront!.apiBaseUrl = "https://after.example.com";
      (mutableBaseConfig.veryfront!.contentSource as { branch?: string }).branch = "after";
      mutableBaseConfig.veryfront!.retry!.maxRetries = 9;
      mutableBaseConfig.invalidationCallbacks!.triggerReload = replacementReload;

      try {
        await manager.getAdapter("request-project", "request-token", undefined, false);

        assertExists(capturedConfig);
        assertEquals(capturedConfig.projectDir, "/tmp/project-before");
        assertEquals(capturedConfig.veryfront?.apiBaseUrl, "https://before.example.com");
        assertEquals(capturedConfig.veryfront?.contentSource, {
          type: "branch",
          branch: "main",
        });
        assertEquals(capturedConfig.veryfront?.retry?.maxRetries, 1);
        assertStrictEquals(
          capturedConfig.invalidationCallbacks?.triggerReload,
          originalReload,
        );
        assertEquals(typeof capturedConfig.invalidationCallbacks?.evictCurrentAdapter, "function");
        assertEquals(Object.isFrozen(capturedConfig), true);
        assertEquals(Object.isFrozen(capturedConfig.veryfront), true);
        assertEquals(Object.isFrozen(capturedConfig.veryfront?.contentSource), true);
        assertEquals(Object.isFrozen(capturedConfig.veryfront?.retry), true);
        assertEquals(Object.isFrozen(capturedConfig.invalidationCallbacks), true);
      } finally {
        manager.dispose();
      }
    });

    it("reads manager options once before creating side effects", () => {
      const reads = new Map<string, number>();
      const values = {
        baseConfig,
        adapterFactory: (config: FSAdapterConfig) => new VeryfrontFSAdapter(config),
        maxAdapters: 5,
        cleanupIntervalMs: 60_000,
        maxIdleMs: 30_000,
      };
      const options = Object.create(null);
      for (const property of Object.keys(values) as Array<keyof typeof values>) {
        Object.defineProperty(options, property, {
          get() {
            reads.set(property, (reads.get(property) ?? 0) + 1);
            return values[property];
          },
        });
      }

      const manager = new ProxyFSAdapterManager(options);
      try {
        assertEquals(Object.fromEntries(reads), {
          baseConfig: 1,
          adapterFactory: 1,
          maxAdapters: 1,
          cleanupIntervalMs: 1,
          maxIdleMs: 1,
        });
      } finally {
        manager.dispose();
      }
    });

    it("snapshots base configuration before reading later option getters", async () => {
      const mutableBaseConfig: FSAdapterConfig = {
        veryfront: {
          apiBaseUrl: "https://before.example.com",
          apiToken: "token-before",
          projectSlug: "base-project",
          cache: { enabled: false },
        },
      };
      let capturedConfig: FSAdapterConfig | undefined;
      const options = Object.create(null);
      Object.defineProperty(options, "baseConfig", { value: mutableBaseConfig });
      Object.defineProperty(options, "adapterFactory", {
        get() {
          mutableBaseConfig.veryfront!.apiBaseUrl = "https://mutated.example.com";
          return (config: FSAdapterConfig) => {
            capturedConfig = config;
            const adapter = new VeryfrontFSAdapter(config);
            adapter.initialize = () => Promise.resolve();
            return adapter;
          };
        },
      });

      const manager = new ProxyFSAdapterManager(options);
      try {
        await manager.getAdapter("request-project", "request-token", undefined, false);
        assertEquals(capturedConfig?.veryfront?.apiBaseUrl, "https://before.example.com");
      } finally {
        manager.dispose();
      }
    });

    it("rejects unreadable manager configuration with a sanitized typed error", () => {
      const secret = "PRIVATE_PROXY_MANAGER_CONFIG/project-411";
      const options = Object.create(null);
      Object.defineProperty(options, "baseConfig", {
        get() {
          throw new Error(secret);
        },
      });

      let thrown: unknown;
      try {
        new ProxyFSAdapterManager(options);
      } catch (error) {
        thrown = error;
      }

      assertStrictEquals(thrown instanceof VeryfrontError, true);
      assertEquals((thrown as VeryfrontError).slug, "config-invalid");
      assertEquals(JSON.stringify(thrown).includes(secret), false);
    });

    it("rejects invalid manager limits and factories", () => {
      for (
        const options of [
          { maxAdapters: 0 },
          { maxAdapters: 1.5 },
          { maxAdapters: null },
          { maxAdapters: 1_001 },
          { maxIdleMs: -1 },
          { maxIdleMs: null },
          { cleanupIntervalMs: Number.NaN },
          { cleanupIntervalMs: null },
          { adapterFactory: "not-a-function" },
        ]
      ) {
        assertThrows(
          () => new ProxyFSAdapterManager({ baseConfig, ...options } as never),
          VeryfrontError,
        );
      }
    });
  });

  describe("methods", () => {
    it("should have getAdapter method", () => {
      const manager = createManager();
      assertEquals(typeof manager.getAdapter, "function");
      manager.dispose();
    });

    it("should have hasAdapter method", () => {
      const manager = createManager();
      assertEquals(typeof manager.hasAdapter, "function");
      manager.dispose();
    });

    it("should have getStats method", () => {
      const manager = createManager();
      assertEquals(typeof manager.getStats, "function");
      manager.dispose();
    });

    it("should have dispose method", () => {
      const manager = createManager();
      assertEquals(typeof manager.dispose, "function");
      manager.dispose();
    });
  });

  describe("hasAdapter", () => {
    it("should return false for non-existent adapter", () => {
      const manager = createManager();
      assertEquals(manager.hasAdapter("non-existent-project"), false);
      manager.dispose();
    });

    it("should differentiate adapters by branch in preview mode", () => {
      const manager = createManager();
      assertEquals(manager.hasAdapter("project", false, null, "main"), false);
      assertEquals(manager.hasAdapter("project", false, null, "feature-x"), false);
      assertEquals(manager.hasAdapter("project", false, null, null), false);
      manager.dispose();
    });

    it("should treat null branch as main branch", () => {
      const manager = createManager();
      assertEquals(
        manager.hasAdapter("project", false, null, null),
        manager.hasAdapter("project", false, null, "main"),
      );
      manager.dispose();
    });

    it("should ignore branch for production mode", () => {
      const manager = createManager();
      assertEquals(
        manager.hasAdapter("project", true, "rel-123", "main"),
        manager.hasAdapter("project", true, "rel-123", "feature-x"),
      );
      manager.dispose();
    });

    it("should differentiate by releaseId in production mode", () => {
      const manager = createManager();
      assertEquals(manager.hasAdapter("project", true, "rel-1"), false);
      assertEquals(manager.hasAdapter("project", true, "rel-2"), false);
      manager.dispose();
    });

    it("rejects release-less production cache lookups", () => {
      const manager = createManager();
      assertThrows(
        () => manager.hasAdapter("project", true, null, null, "Production"),
        Error,
        "Missing releaseId in production",
      );
      assertThrows(
        () => manager.evictAdapter("project", true, null, null, "Production"),
        Error,
        "Missing releaseId in production",
      );
      manager.dispose();
    });
  });

  describe("getStats", () => {
    it("should return stats object with zero adapters initially", () => {
      const manager = createManager();
      const stats = manager.getStats();
      assertExists(stats);
      assertEquals(stats.adapters, 0);
      assertExists(stats.stats);
      assertEquals(Object.keys(stats.stats).length, 0);
      manager.dispose();
    });
  });

  describe("dispose", () => {
    it("should dispose without error", () => {
      const manager = createManager();
      manager.dispose();
    });

    it("should allow multiple dispose calls", () => {
      const manager = createManager();
      manager.dispose();
      manager.dispose();
    });

    it("should stop cleanup timer on dispose", () => {
      const manager = createManager({ cleanupIntervalMs: 1000 });
      manager.dispose();
    });

    it("should clear all adapters on dispose", () => {
      const manager = createManager();
      assertEquals(manager.getStats().adapters, 0);
      manager.dispose();
      assertEquals(manager.getStats().adapters, 0);
    });

    it("rejects new adapter requests after disposal", async () => {
      let factoryCalls = 0;
      const manager = createManager({
        adapterFactory: (config) => {
          factoryCalls++;
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });
      manager.dispose();

      const error = await assertRejects(
        () => manager.getAdapter("project", "token", undefined, false),
        VeryfrontError,
        "disposed",
      );

      assert(error instanceof VeryfrontError);
      assertEquals(factoryCalls, 0);
      assertEquals(manager.getStats().adapters, 0);
    });

    it("does not resurrect an adapter whose initialization finishes after disposal", async () => {
      const initialization = createDeferred();
      let adapterCreated = false;
      let requestSettled = false;
      let disposeCalls = 0;
      let simulatedResourceActive = false;
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = async () => {
            await initialization.promise;
            simulatedResourceActive = true;
          };
          adapter.dispose = () => {
            disposeCalls++;
            simulatedResourceActive = false;
          };
          adapterCreated = true;
          return adapter;
        },
      });
      const outcomePromise = manager.getAdapter("project", "token", undefined, false).then(
        (adapter) => {
          requestSettled = true;
          return { adapter, error: undefined };
        },
        (error: unknown) => {
          requestSettled = true;
          return { adapter: undefined, error };
        },
      );

      await waitFor(async () => adapterCreated);
      manager.dispose();
      await waitFor(async () => requestSettled);
      const outcome = await outcomePromise;

      assertEquals(outcome.adapter, undefined);
      assert(outcome.error instanceof VeryfrontError);
      assertEquals(outcome.error.message.includes("disposed"), true);
      assertEquals(disposeCalls, 1);

      initialization.resolve();
      await waitFor(async () => disposeCalls === 2);
      assertEquals(disposeCalls, 2);
      assertEquals(simulatedResourceActive, false);
      assertEquals(manager.getStats().adapters, 0);
      assertEquals(manager.hasAdapter("project", false, null, "main"), false);
    });
  });

  describe("getAdapter validation", () => {
    it("should reject empty projectSlug", async () => {
      const manager = createManager();
      try {
        await assertGetAdapterRejects(
          manager,
          ["", "valid-token", undefined, false],
          "projectSlug",
        );
      } finally {
        manager.dispose();
      }
    });

    it("should reject empty token", async () => {
      const manager = createManager();
      try {
        await assertGetAdapterRejects(
          manager,
          ["valid-slug", "", undefined, false],
          "token",
        );
      } finally {
        manager.dispose();
      }
    });

    it("should accept valid parameters structurally", () => {
      const manager = createManager();
      assertExists(manager);
      manager.dispose();
    });

    it("rejects oversized project slugs and tokens before creating adapters", async () => {
      const inputs = [
        { projectSlug: "p".repeat(256), token: "token", field: "projectSlug" },
        { projectSlug: "project", token: "t".repeat(4_097), field: "token" },
      ];

      for (const input of inputs) {
        let factoryCalls = 0;
        const manager = createManager({
          adapterFactory: (config) => {
            factoryCalls++;
            const adapter = new VeryfrontFSAdapter(config);
            adapter.initialize = () => Promise.resolve();
            return adapter;
          },
        });
        try {
          const error = await assertRejects(
            () => manager.getAdapter(input.projectSlug, input.token, undefined, false),
            VeryfrontError,
            input.field,
          );
          assert(error instanceof VeryfrontError);
          assertEquals(factoryCalls, 0);
          assertEquals(JSON.stringify(error).includes(input.projectSlug), false);
          assertEquals(JSON.stringify(error).includes(input.token), false);
        } finally {
          manager.dispose();
        }
      }
    });

    it("rejects invalid optional identifiers before creating adapters", async () => {
      const oversized = "private-" + "x".repeat(256);
      const invalidInputs: Array<{
        args: Parameters<ProxyFSAdapterManager["getAdapter"]>;
        field: string;
      }> = [
        {
          args: ["project", "token", oversized, false],
          field: "projectId",
        },
        {
          args: ["project", "token", undefined, true, oversized],
          field: "releaseId",
        },
        {
          args: ["project", "token", undefined, true, "release", oversized],
          field: "environmentName",
        },
        {
          args: ["project", "token", undefined, false, null, null, oversized],
          field: "branch",
        },
        {
          args: ["project", "token", "private\nidentifier", false],
          field: "projectId",
        },
      ];

      for (const input of invalidInputs) {
        let factoryCalls = 0;
        const manager = createManager({
          adapterFactory: (config) => {
            factoryCalls++;
            return new VeryfrontFSAdapter(config);
          },
        });
        try {
          await assertRejects(
            () => manager.getAdapter(...input.args),
            VeryfrontError,
            input.field,
          );
          assertEquals(factoryCalls, 0);
        } finally {
          manager.dispose();
        }
      }
    });
  });

  describe("adapter lifecycle", () => {
    it("should not have adapter before getAdapter is called", () => {
      const manager = createManager();
      assertEquals(manager.hasAdapter("test-project", false, null, "main"), false);
      manager.dispose();
    });

    it("should remove all adapters on dispose", () => {
      const manager = createManager();
      assertEquals(manager.getStats().adapters, 0);
      manager.dispose();
      assertEquals(manager.getStats().adapters, 0);
    });

    it("isolates cached adapters by a non-reversible authorization scope", async () => {
      const configuredTokens: Array<string | undefined> = [];
      const manager = createManager({
        adapterFactory: (config) => {
          configuredTokens.push(config.veryfront?.apiToken);
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });

      try {
        const adapterA = await manager.getAdapter(
          "test-project",
          "request-token-a",
          undefined,
          false,
          null,
          null,
          "main",
        );
        const adapterB = await manager.getAdapter(
          "test-project",
          "request-token-b",
          undefined,
          false,
          null,
          null,
          "main",
        );
        const adapterAAgain = await manager.getAdapter(
          "test-project",
          "request-token-a",
          undefined,
          false,
          null,
          null,
          "main",
        );

        assertEquals(adapterA === adapterB, false);
        assertEquals(adapterAAgain === adapterA, true);
        assertEquals(configuredTokens, ["test-token", "test-token"]);
        assertEquals(manager.getStats().adapters, 2);
      } finally {
        manager.dispose();
      }
    });

    it("accounts for pending distinct adapters when enforcing capacity", async () => {
      const initializations: Array<ReturnType<typeof createDeferred>> = [];
      const rejected: unknown[] = [];
      const manager = createManager({
        maxAdapters: 2,
        adapterFactory: (config) => {
          const initialization = createDeferred();
          initializations.push(initialization);
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => initialization.promise;
          return adapter;
        },
      });
      const outcomes = ["project-a", "project-b", "project-c"].map((projectSlug) =>
        manager.getAdapter(projectSlug, "token", undefined, false).then(
          () => "resolved" as const,
          (error: unknown) => {
            rejected.push(error);
            return "rejected" as const;
          },
        )
      );

      try {
        await waitFor(async () => initializations.length === 3 || rejected.length === 1);
        assertEquals(initializations.length, 2);
        assertEquals(rejected.length, 1);
        assert(rejected[0] instanceof VeryfrontError);
        assertEquals(manager.getStats().adapters, 0);
      } finally {
        for (const initialization of initializations) initialization.resolve();
        await Promise.all(outcomes);
        manager.dispose();
      }
    });

    it("sanitizes adapter factory failures, including hostile thrown values", async () => {
      const secret = "PRIVATE_FACTORY_FAILURE/project-427";
      const revocable = Proxy.revocable({}, {});
      revocable.revoke();

      for (const thrown of [new Error(secret), revocable.proxy]) {
        const manager = createManager({
          adapterFactory: () => {
            throw thrown;
          },
        });
        try {
          const error = await assertRejects(
            () => manager.getAdapter("project", "token", undefined, false),
            VeryfrontError,
            "Filesystem operation failed",
          );
          assert(error instanceof VeryfrontError);
          assertEquals(JSON.stringify(error).includes(secret), false);
          assertEquals(manager.getStats().adapters, 0);
        } finally {
          manager.dispose();
        }
      }
    });

    it("disposes partially created adapters when setting context fails", async () => {
      const secret = "PRIVATE_CONTEXT_FAILURE/project-431";
      let disposeCalls = 0;
      let initializeCalls = 0;
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.setContentContext = () => {
            throw new Error(secret);
          };
          adapter.initialize = () => {
            initializeCalls++;
            return Promise.resolve();
          };
          adapter.dispose = () => {
            disposeCalls++;
          };
          return adapter;
        },
      });

      try {
        const error = await assertRejects(
          () => manager.getAdapter("project", "token", undefined, false),
          VeryfrontError,
          "Filesystem operation failed",
        );
        assert(error instanceof VeryfrontError);
        assertEquals(JSON.stringify(error).includes(secret), false);
        assertEquals(initializeCalls, 0);
        assertEquals(disposeCalls, 1);
      } finally {
        manager.dispose();
      }
    });

    it("cleans up synchronous initialization failures and permits a retry", async () => {
      const secret = "PRIVATE_SYNC_INIT_FAILURE/project-433";
      let factoryCalls = 0;
      let disposeCalls = 0;
      const manager = createManager({
        adapterFactory: (config) => {
          factoryCalls++;
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => {
            throw new Error(secret);
          };
          adapter.dispose = () => {
            disposeCalls++;
          };
          return adapter;
        },
      });

      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const error = await assertRejects(
            () => manager.getAdapter("project", "token", undefined, false),
            VeryfrontError,
            "Filesystem operation failed",
          );
          assert(error instanceof VeryfrontError);
          assertEquals(JSON.stringify(error).includes(secret), false);
        }
        assertEquals(factoryCalls, 2);
        assertEquals(disposeCalls, 2);
      } finally {
        manager.dispose();
      }
    });

    it("disposes asynchronous initialization failures and releases capacity", async () => {
      const failureSecret = "PRIVATE_ASYNC_INIT_FAILURE/project-439";
      const cleanupSecret = "PRIVATE_CLEANUP_FAILURE/project-439";
      let factoryCalls = 0;
      let disposeCalls = 0;
      const manager = createManager({
        maxAdapters: 1,
        adapterFactory: (config) => {
          factoryCalls++;
          const adapter = new VeryfrontFSAdapter(config);
          if (factoryCalls === 1) {
            adapter.initialize = () => Promise.reject(new Error(failureSecret));
            adapter.dispose = () => {
              disposeCalls++;
              throw new Error(cleanupSecret);
            };
          } else {
            adapter.initialize = () => Promise.resolve();
          }
          return adapter;
        },
      });

      try {
        const error = await assertRejects(
          () => manager.getAdapter("project-a", "token", undefined, false),
          VeryfrontError,
          "Filesystem operation failed",
        );
        assert(error instanceof VeryfrontError);
        const serializedError = JSON.stringify(error);
        assertEquals(serializedError.includes(failureSecret), false);
        assertEquals(serializedError.includes(cleanupSecret), false);
        assertEquals(disposeCalls, 1);

        const adapter = await manager.getAdapter("project-b", "token", undefined, false);
        assertExists(adapter);
        assertEquals(factoryCalls, 2);
      } finally {
        manager.dispose();
      }
    });
  });
});
