import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearRequestScopedFileCache,
  getCurrentRequestContext,
  getRequestScopedFile,
  isMultiProjectAdapter,
  MultiProjectFSAdapter,
  runWithRequestContext,
  setRequestScopedFile,
  wrapWithCurrentContext,
} from "./multi-project-adapter.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import { ProxyFSAdapterManager } from "./proxy-manager.ts";

function createAdapter(): MultiProjectFSAdapter {
  const config = {
    veryfront: {
      apiBaseUrl: "https://api.example.com",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache: { enabled: false },
    },
  };
  let manager: ProxyFSAdapterManager = new ProxyFSAdapterManager({ baseConfig: config });
  const bridge = {
    getAdapter: (...args: Parameters<ProxyFSAdapterManager["getAdapter"]>) =>
      manager.getAdapter(...args),
    getStats: () => manager.getStats(),
    dispose: () => manager.dispose(),
  };
  const adapter = new MultiProjectFSAdapter(
    config,
    bridge as unknown as ProxyFSAdapterManager,
  );
  Object.defineProperty(adapter, "manager", {
    configurable: true,
    get: () => manager,
    set: (replacement: ProxyFSAdapterManager) => {
      manager = replacement;
    },
  });
  return adapter;
}

function assertMethod(
  adapter: MultiProjectFSAdapter,
  name: keyof MultiProjectFSAdapter,
): void {
  const value = adapter[name];
  assertExists(value);
  assertEquals(typeof value, "function");
}

function withAdapter(fn: (adapter: MultiProjectFSAdapter) => void): void {
  const adapter = createAdapter();
  try {
    fn(adapter);
  } finally {
    adapter.dispose();
  }
}

async function withAdapterAsync(
  fn: (adapter: MultiProjectFSAdapter) => Promise<void>,
): Promise<void> {
  const adapter = createAdapter();
  try {
    await fn(adapter);
  } finally {
    adapter.dispose();
  }
}

describe("MultiProjectFSAdapter", () => {
  it("keeps the credential manager outside the public object graph", () => {
    const adapter = new MultiProjectFSAdapter({
      veryfront: {
        apiBaseUrl: "https://api.example.com",
        apiToken: "test-token",
        projectSlug: "test-project",
        cache: { enabled: false },
      },
    });
    try {
      assertEquals(Object.getOwnPropertyNames(adapter).includes("manager"), false);
      assertEquals(
        Object.getOwnPropertyDescriptor(MultiProjectFSAdapter.prototype, "manager"),
        undefined,
      );
    } finally {
      adapter.dispose();
    }
  });

  describe("class", () => {
    it("should export MultiProjectFSAdapter class", () => {
      assertExists(MultiProjectFSAdapter);
      assertEquals(typeof MultiProjectFSAdapter, "function");
    });
  });

  describe("instance", () => {
    it("should be instantiable with minimal config", () => {
      withAdapter((adapter) => {
        assertExists(adapter);
      });
    });

    it("should have initialize method", () => {
      withAdapter((adapter) => assertMethod(adapter, "initialize"));
    });

    it("should have readFile method", () => {
      withAdapter((adapter) => assertMethod(adapter, "readFile"));
    });

    it("should have readTextFile method", () => {
      withAdapter((adapter) => assertMethod(adapter, "readTextFile"));
    });

    it("preserves effective read and snapshot methods from adapter subclasses", async () => {
      await withAdapterAsync(async (adapter) => {
        const calls: string[] = [];
        class SubclassAdapter extends VeryfrontFSAdapter {
          override readFile(path: string): Promise<string> {
            calls.push(`readFile:${path}`);
            return Promise.resolve("subclass-file");
          }

          override readTextFile(path: string): Promise<string> {
            calls.push(`readTextFile:${path}`);
            return Promise.resolve("subclass-text");
          }

          override refreshSourceSnapshot(reason?: string): Promise<void> {
            calls.push(`refresh:${reason}`);
            return Promise.resolve();
          }

          override ensureSourceSnapshotFresh(
            reason?: string,
            options?: { maxAgeMs?: number },
            initializedByManager?: boolean,
          ): Promise<void> {
            calls.push(
              `ensure:${reason}:${options?.maxAgeMs}:${initializedByManager ?? false}`,
            );
            return Promise.resolve();
          }

          override getSourceSnapshotVersion(): number {
            calls.push("version");
            return 41;
          }

          override getSourceSnapshotFingerprint(): Promise<string> {
            calls.push("fingerprint");
            return Promise.resolve("subclass-fingerprint");
          }

          override getSourceSnapshotIdentity(): string {
            calls.push("identity");
            return "subclass-identity";
          }
        }

        const selectedAdapter = new SubclassAdapter({
          veryfront: {
            apiBaseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            cache: { enabled: false },
          },
        });
        adapter.setDefaultAdapter(selectedAdapter);

        assertEquals(await adapter.readFile("pages/file.tsx"), "subclass-file");
        assertEquals(await adapter.readTextFile("pages/text.tsx"), "subclass-text");
        await adapter.refreshSourceSnapshot("manual");
        await adapter.ensureSourceSnapshotFresh("routing", { maxAgeMs: 0 });
        assertEquals(await adapter.getSourceSnapshotVersion(), 41);
        assertEquals(await adapter.getSourceSnapshotFingerprint(), "subclass-fingerprint");
        assertStringIncludes(
          await adapter.getSourceSnapshotIdentity() ?? "",
          "subclass-identity",
        );
        assertEquals(calls, [
          "readFile:pages/file.tsx",
          "readTextFile:pages/text.tsx",
          "refresh:manual",
          "version",
          "ensure:routing:0:false",
          "version",
          "version",
          "fingerprint",
          "identity",
        ]);
      });
    });

    it("should have exact bounded byte read method", () => {
      withAdapter((adapter) => assertMethod(adapter, "readFileBytesWithinLimit"));
    });

    it("rejects an invalid exact-read limit before selecting an adapter", async () => {
      await withAdapterAsync(async (adapter) => {
        await assertRejects(
          () => adapter.readFileBytesWithinLimit("asset.css", 0),
          RangeError,
          "positive safe integer",
        );
      });
    });

    it("rejects a context-less read with an actionable initialization error", async () => {
      await withAdapterAsync(async (adapter) => {
        const rejection = await assertRejects(
          () => adapter.readTextFile("a.ts"),
          Error,
          "Use runWithContext() to set project context before accessing files",
          "a read with neither a request context nor a default adapter must name runWithContext",
        );
        assertInstanceOf(
          rejection,
          Error,
          "the context-less read must reject with an Error carrying a message",
        );
        assertStringIncludes(
          rejection.message,
          "[MultiProjectFSAdapter] No request context available.",
          "the remedy must stay attached to the symptom that explains why the read failed",
        );
      });
    });

    it("forwards exact reads only to the selected captured authority", async () => {
      await withAdapterAsync(async (adapter) => {
        let exactCalls = 0;
        let unboundedCalls = 0;
        const source = new Uint8Array([1, 2, 3]);
        adapter.setDefaultAdapter(
          {
            readFileBytesWithinLimit(path: string, byteLimit: number) {
              exactCalls++;
              assertEquals(path, "asset.css");
              assertEquals(byteLimit, 3);
              return Promise.resolve(source);
            },
            readFileBytes() {
              unboundedCalls++;
              return Promise.resolve(source);
            },
            dispose() {},
          } as unknown as Parameters<MultiProjectFSAdapter["setDefaultAdapter"]>[0],
        );

        const result = await adapter.readFileBytesWithinLimit("asset.css", 3);
        source[0] = 9;
        assertEquals([...result], [1, 2, 3]);
        assertEquals(exactCalls, 1);
        assertEquals(unboundedCalls, 0);
      });
    });

    it("refuses a whole-file reader whose ceiling exceeds the requested limit", async () => {
      await withAdapterAsync(async (adapter) => {
        let reads = 0;
        adapter.setDefaultAdapter(
          {
            maxWholeFileReadBytes: 64,
            readFileBytes() {
              reads++;
              return Promise.resolve(new Uint8Array(3));
            },
            dispose() {},
          } as unknown as Parameters<MultiProjectFSAdapter["setDefaultAdapter"]>[0],
        );

        await assertRejects(
          () => adapter.readFileBytesWithinLimit("asset.css", 3),
          TypeError,
          "whole-file ceiling no larger than 3 bytes",
          "a whole-file ceiling above the requested limit must not satisfy a bounded read",
        );
        assertEquals(reads, 0, "an over-ceiling whole-file reader must not be read from");
      });
    });

    it("uses a whole-file reader whose ceiling fits inside the requested limit", async () => {
      await withAdapterAsync(async (adapter) => {
        let reads = 0;
        adapter.setDefaultAdapter(
          {
            maxWholeFileReadBytes: 3,
            readFileBytes() {
              reads++;
              return Promise.resolve(new Uint8Array([1, 2, 3]));
            },
            dispose() {},
          } as unknown as Parameters<MultiProjectFSAdapter["setDefaultAdapter"]>[0],
        );

        assertEquals(
          [...await adapter.readFileBytesWithinLimit("asset.css", 3)],
          [1, 2, 3],
          "a within-ceiling whole-file reader satisfies the bounded read",
        );
        assertEquals(reads, 1, "the whole-file reader is the one consulted");
      });
    });

    it("should have readOptionalTextFile method", () => {
      withAdapter((adapter) => assertMethod(adapter, "readOptionalTextFile"));
    });

    it("should have exists method", () => {
      withAdapter((adapter) => assertMethod(adapter, "exists"));
    });

    it("should have stat method", () => {
      withAdapter((adapter) => assertMethod(adapter, "stat"));
    });

    it("should have readdir method", () => {
      withAdapter((adapter) => assertMethod(adapter, "readdir"));
    });

    it("should have resolveFile method", () => {
      withAdapter((adapter) => assertMethod(adapter, "resolveFile"));
    });

    it("should have dispose method", () => {
      withAdapter((adapter) => assertMethod(adapter, "dispose"));
    });

    it("should have runWithContext method", () => {
      withAdapter((adapter) => assertMethod(adapter, "runWithContext"));
    });

    it("should have refreshSourceSnapshot method", () => {
      withAdapter((adapter) => assertMethod(adapter, "refreshSourceSnapshot"));
    });

    it("should expose source snapshot freshness methods", () => {
      withAdapter((adapter) => {
        assertMethod(adapter, "ensureSourceSnapshotFresh");
        assertMethod(adapter, "getSourceSnapshotVersion");
        assertMethod(adapter, "getSourceSnapshotFingerprint");
      });
    });

    it("should have getManagerStats method", () => {
      withAdapter((adapter) => assertMethod(adapter, "getManagerStats"));
    });

    it("should return manager stats", () => {
      withAdapter((adapter) => {
        const stats = adapter.getManagerStats();
        assertExists(stats);
        assertEquals(stats.adapters, 0);
        assertExists(stats.stats);
      });
    });

    it("preserves effective methods from injected manager subclasses", async () => {
      const config = {
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          cache: { enabled: false },
        },
      };
      const selectedAdapter = new VeryfrontFSAdapter(config);
      selectedAdapter.getSourceSnapshotFingerprint = () =>
        Promise.resolve("subclass-manager-snapshot");
      const calls = { getAdapter: 0, getStats: 0, dispose: 0 };
      class SubclassManager extends ProxyFSAdapterManager {
        override getAdapter(
          ..._args: Parameters<ProxyFSAdapterManager["getAdapter"]>
        ): ReturnType<ProxyFSAdapterManager["getAdapter"]> {
          calls.getAdapter += 1;
          return Promise.resolve(selectedAdapter);
        }

        override getStats(): ReturnType<ProxyFSAdapterManager["getStats"]> {
          calls.getStats += 1;
          return { adapters: 0, stats: {} };
        }

        override dispose(): void {
          calls.dispose += 1;
          super.dispose();
        }
      }
      const manager = new SubclassManager({ baseConfig: config });
      const adapter = new MultiProjectFSAdapter(config, manager);

      try {
        const fingerprint = await adapter.runWithContext(
          "project-a",
          "test-token",
          () => adapter.getSourceSnapshotFingerprint(),
          "project-id-a",
        );
        assertEquals(fingerprint, "subclass-manager-snapshot");
        assertEquals(adapter.getManagerStats(), { adapters: 0, stats: {} });
        assertEquals(calls, { getAdapter: 1, getStats: 1, dispose: 0 });
      } finally {
        adapter.dispose();
        selectedAdapter.dispose();
      }
      assertEquals(calls.dispose, 1);
    });

    it("does not expose credential lookup through a replaced manager property", async () => {
      const adapter = new MultiProjectFSAdapter({
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          apiToken: "test-token",
          projectSlug: "test-project",
          proxyMode: true,
          cache: { enabled: false },
        },
      });
      const internals = adapter as unknown as { manager: unknown };
      const originalManager = internals.manager;
      const observedTokens: string[] = [];
      internals.manager = {
        getAdapter(_slug: string, token: string) {
          observedTokens.push(token);
          return Promise.resolve({
            getSourceSnapshotFingerprint: () => "attacker-snapshot",
          });
        },
        getStats: () => ({ adapters: 0, stats: [] }),
        dispose: () => {},
      };

      try {
        await assertRejects(
          () =>
            adapter.runWithContext(
              "project-a",
              "signed-user-token",
              () => adapter.getSourceSnapshotFingerprint(),
              "",
            ),
          Error,
          "canonical project ID",
        );
        assertEquals(observedTokens, []);
      } finally {
        internals.manager = originalManager;
        adapter.dispose();
      }
    });

    it("initialize should resolve immediately", async () => {
      await withAdapterAsync((adapter) => adapter.initialize());
    });

    it("refreshSourceSnapshot should delegate and clear request-scoped file cache", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        let refreshedReason: string | undefined;
        let capturedProjectSlug: string | undefined;
        let capturedProjectId: string | undefined;
        let capturedBranch: string | null | undefined;
        let cachedBeforeRefresh: string | undefined;
        let cachedAfterRefresh: string | undefined;

        (adapter as any).manager = {
          getAdapter(
            projectSlug: string,
            _token: string,
            projectId?: string,
            _productionMode?: boolean,
            _releaseId?: string | null,
            _environmentName?: string | null,
            branch?: string | null,
          ) {
            capturedProjectSlug = projectSlug;
            capturedProjectId = projectId;
            capturedBranch = branch;
            return Promise.resolve({
              refreshSourceSnapshot(reason?: string) {
                refreshedReason = reason;
                return Promise.resolve();
              },
            });
          },
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };

        try {
          await adapter.runWithContext(
            "project-a",
            "test-token",
            async () => {
              setRequestScopedFile("file:pages/index.mdx", "stale-content");
              cachedBeforeRefresh = getRequestScopedFile("file:pages/index.mdx");
              await adapter.refreshSourceSnapshot("review-comment");
              cachedAfterRefresh = getRequestScopedFile("file:pages/index.mdx");
            },
            "project-id-a",
            { branch: "main" },
          );
        } finally {
          (adapter as any).manager = originalManager;
        }

        assertEquals(refreshedReason, "review-comment");
        assertEquals(capturedProjectSlug, "project-a");
        assertEquals(capturedProjectId, "project-id-a");
        assertEquals(capturedBranch, "main");
        assertEquals(cachedBeforeRefresh, "stale-content");
        assertEquals(cachedAfterRefresh, undefined);
      });
    });

    it("clears request-scoped files only when a freshness check advances the snapshot", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        let freshnessReason: string | undefined;
        let maxAgeMs: number | undefined;
        let freshnessChecks = 0;
        let sourceSnapshotVersion = 6;
        const snapshotAdapter = {
          ensureSourceSnapshotFresh(reason?: string, options?: { maxAgeMs?: number }) {
            freshnessReason = reason;
            maxAgeMs = options?.maxAgeMs;
            freshnessChecks++;
            if (freshnessChecks === 1) sourceSnapshotVersion++;
            return Promise.resolve();
          },
          getSourceSnapshotVersion() {
            return sourceSnapshotVersion;
          },
          getSourceSnapshotFingerprint() {
            return Promise.resolve("current-source-fingerprint");
          },
        } as unknown as VeryfrontFSAdapter;

        (adapter as any).manager = {
          getAdapter() {
            return Promise.resolve(snapshotAdapter);
          },
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };

        try {
          await adapter.runWithContext(
            "project-a",
            "test-token",
            async () => {
              setRequestScopedFile("file:pages/index.mdx", "stale-content");
              await adapter.ensureSourceSnapshotFresh("page-routing", { maxAgeMs: 0 });
              assertEquals(getRequestScopedFile("file:pages/index.mdx"), undefined);
              assertEquals(await adapter.getSourceSnapshotVersion(), 7);
              assertEquals(typeof await adapter.getSourceSnapshotFingerprint(), "string");

              setRequestScopedFile("file:pages/index.mdx", "current-content");
              await adapter.ensureSourceSnapshotFresh("page-routing", { maxAgeMs: 0 });
              assertEquals(getRequestScopedFile("file:pages/index.mdx"), "current-content");
            },
            "project-id-a",
            { branch: "main" },
          );
        } finally {
          (adapter as any).manager = originalManager;
        }

        assertEquals(freshnessReason, "page-routing");
        assertEquals(
          maxAgeMs,
          0,
          "the multi-project adapter must forward snapshot freshness options to the project adapter",
        );
      });
    });

    it("reuses manager initialization for the first strict freshness check", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        let authorityListings = 1;
        let selections = 0;
        const selectedAdapter = {
          ensureSourceSnapshotFresh(
            _reason?: string,
            _options?: { maxAgeMs?: number },
            initializedByManager = false,
          ) {
            if (!initializedByManager) authorityListings++;
            return Promise.resolve();
          },
          getSourceSnapshotVersion: () => 1,
        };

        (adapter as any).manager = {
          getAdapter(
            _projectSlug: string,
            _token: string,
            _projectId?: string,
            _productionMode?: boolean,
            _releaseId?: string | null,
            _environmentName?: string | null,
            _branch?: string | null,
            onResolved?: (initializedNow: boolean) => void,
          ) {
            onResolved?.(selections++ === 0);
            return Promise.resolve(selectedAdapter);
          },
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };

        try {
          await adapter.runWithContext(
            "project-a",
            "token-a",
            async () => {
              await adapter.ensureSourceSnapshotFresh("first-document", { maxAgeMs: 0 });
              assertEquals(
                authorityListings,
                1,
                "materialization already fetched the first document's complete listing",
              );

              await adapter.ensureSourceSnapshotFresh("later-document", { maxAgeMs: 0 });
              assertEquals(authorityListings, 2, "later zero-age checks must refresh normally");
            },
            "project-id-a",
            { branch: "main" },
          );
        } finally {
          (adapter as any).manager = originalManager;
        }
      });
    });

    it("forwards strict freshness only to each selected project adapter", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        const projectACalls: Array<{ reason: string | undefined; maxAgeMs: number | undefined }> =
          [];
        const projectBCalls: Array<{ reason: string | undefined; maxAgeMs: number | undefined }> =
          [];
        const projectAAdapter = {
          ensureSourceSnapshotFresh(reason?: string, options?: { maxAgeMs?: number }) {
            projectACalls.push({ reason, maxAgeMs: options?.maxAgeMs });
            return Promise.resolve();
          },
        };
        const projectBAdapter = {
          ensureSourceSnapshotFresh(reason?: string, options?: { maxAgeMs?: number }) {
            projectBCalls.push({ reason, maxAgeMs: options?.maxAgeMs });
            return Promise.resolve();
          },
        };

        (adapter as any).manager = {
          getAdapter(projectSlug: string) {
            if (projectSlug === "project-a") return Promise.resolve(projectAAdapter);
            if (projectSlug === "project-b") return Promise.resolve(projectBAdapter);
            return Promise.reject(new Error(`unexpected project: ${projectSlug}`));
          },
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };

        try {
          await adapter.runWithContext(
            "project-a",
            "token-a",
            () => adapter.ensureSourceSnapshotFresh("project-a-document", { maxAgeMs: 0 }),
            "project-id-a",
            { branch: "branch-a" },
          );
          await adapter.runWithContext(
            "project-b",
            "token-b",
            () => adapter.ensureSourceSnapshotFresh("project-b-document", { maxAgeMs: 0 }),
            "project-id-b",
            { branch: "branch-b" },
          );
        } finally {
          (adapter as any).manager = originalManager;
        }

        assertEquals(projectACalls, [{ reason: "project-a-document", maxAgeMs: 0 }]);
        assertEquals(projectBCalls, [{ reason: "project-b-document", maxAgeMs: 0 }]);
      });
    });

    it("reports the selected project adapter's snapshot identity", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;

        (adapter as any).manager = {
          getAdapter(projectSlug: string) {
            if (projectSlug === "project-a") {
              return Promise.resolve({
                getSourceSnapshotIdentity: () => "branch:project-a:branch-a",
              });
            }
            if (projectSlug === "project-b") return Promise.resolve({});
            return Promise.reject(new Error(`unexpected project: ${projectSlug}`));
          },
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };

        try {
          await adapter.runWithContext(
            "project-a",
            "token-a",
            async () => {
              assertEquals(
                (await adapter.getSourceSnapshotIdentity())?.endsWith(
                  ":branch:project-a:branch-a",
                ),
                true,
                "the identity must come from the context's selected project adapter",
              );
            },
            "project-id-a",
            { branch: "branch-a" },
          );
          await adapter.runWithContext(
            "project-b",
            "token-b",
            async () => {
              assertEquals(
                await adapter.getSourceSnapshotIdentity(),
                undefined,
                "a project adapter that cannot name its context reports no identity",
              );
            },
            "project-id-b",
            { branch: "branch-b" },
          );
        } finally {
          (adapter as any).manager = originalManager;
        }
      });
    });

    it("binds snapshot identity to the credential-selected adapter generation", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        const tokenAAdapter = {
          getSourceSnapshotIdentity: () => "branch:shared-project:main",
        };
        const tokenBAdapter = {
          getSourceSnapshotIdentity: () => "branch:shared-project:main",
        };

        (adapter as any).manager = {
          getAdapter(_projectSlug: string, token: string) {
            return Promise.resolve(token === "credential-a" ? tokenAAdapter : tokenBAdapter);
          },
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };

        const identityFor = (token: string) =>
          adapter.runWithContext(
            "shared-project",
            token,
            () => adapter.getSourceSnapshotIdentity(),
            "shared-project-id",
            { branch: "main" },
          );

        try {
          const firstIdentity = await identityFor("credential-a");
          const reusedIdentity = await identityFor("credential-a");
          const otherCredentialIdentity = await identityFor("credential-b");

          assertEquals(reusedIdentity, firstIdentity);
          assertEquals(
            otherCredentialIdentity === firstIdentity,
            false,
            "the same source context on another credential adapter cannot reuse freshness",
          );
          assertEquals(firstIdentity?.includes("credential-a"), false);
          assertEquals(otherCredentialIdentity?.includes("credential-b"), false);
        } finally {
          (adapter as any).manager = originalManager;
        }
      });
    });

    it("uses the captured concrete fingerprint method after project prototype mutation", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        const originalFingerprint = Object.getOwnPropertyDescriptor(
          VeryfrontFSAdapter.prototype,
          "getSourceSnapshotFingerprint",
        );
        const concreteAdapter = Object.assign(Object.create(VeryfrontFSAdapter.prototype), {
          sourceSnapshotFiles: [{ path: "pages/index.tsx", content: "trusted source" }],
          sourceSnapshotVersion: 1,
          sourceSnapshotFingerprint: undefined,
        }) as VeryfrontFSAdapter;

        (adapter as any).manager = {
          getAdapter: () => Promise.resolve(concreteAdapter),
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };
        Object.defineProperty(VeryfrontFSAdapter.prototype, "getSourceSnapshotFingerprint", {
          configurable: true,
          value: () => Promise.resolve("project-spoofed-fingerprint"),
        });

        try {
          const fingerprint = await adapter.runWithContext(
            "project-a",
            "runtime-token",
            () => adapter.getSourceSnapshotFingerprint(),
            "project-id-a",
            { branch: "main" },
          );
          assertEquals(typeof fingerprint, "string");
          assertNotEquals(fingerprint, "project-spoofed-fingerprint");
        } finally {
          Object.defineProperty(
            VeryfrontFSAdapter.prototype,
            "getSourceSnapshotFingerprint",
            originalFingerprint!,
          );
          (adapter as any).manager = originalManager;
        }
      });
    });

    it("keeps fingerprint lookup independent of a prototype getAdapter replacement", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        const originalLookup = Object.getOwnPropertyDescriptor(
          MultiProjectFSAdapter.prototype,
          "getAdapter",
        );
        const concreteAdapter = Object.assign(Object.create(VeryfrontFSAdapter.prototype), {
          sourceSnapshotFiles: [{ path: "pages/index.tsx", content: "trusted source" }],
          sourceSnapshotVersion: 1,
          sourceSnapshotFingerprint: undefined,
        }) as VeryfrontFSAdapter;
        let spoofedLookupCalls = 0;

        (adapter as any).manager = {
          getAdapter: () => Promise.resolve(concreteAdapter),
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };
        Object.defineProperty(MultiProjectFSAdapter.prototype, "getAdapter", {
          configurable: true,
          value: () => {
            spoofedLookupCalls++;
            return Promise.resolve({
              getSourceSnapshotFingerprint: () => "project-spoofed-fingerprint",
            });
          },
        });

        try {
          const fingerprint = await adapter.runWithContext(
            "project-a",
            "runtime-token",
            () => adapter.getSourceSnapshotFingerprint(),
            "project-id-a",
            { branch: "main" },
          );
          assertEquals(typeof fingerprint, "string");
          assertNotEquals(fingerprint, "project-spoofed-fingerprint");
          assertEquals(spoofedLookupCalls, 0);
        } finally {
          if (originalLookup) {
            Object.defineProperty(MultiProjectFSAdapter.prototype, "getAdapter", originalLookup);
          } else {
            Reflect.deleteProperty(MultiProjectFSAdapter.prototype, "getAdapter");
          }
          (adapter as any).manager = originalManager;
        }
      });
    });

    it("keeps adapter selection independent of a mutable public method name", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        const concreteAdapter = Object.assign(Object.create(VeryfrontFSAdapter.prototype), {
          sourceSnapshotFiles: [{ path: "pages/index.tsx", content: "trusted source" }],
          sourceSnapshotVersion: 1,
          sourceSnapshotFingerprint: undefined,
        }) as VeryfrontFSAdapter;
        const interceptedTokens: string[] = [];

        (adapter as any).manager = {
          getAdapter: () => Promise.resolve(concreteAdapter),
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };
        Object.defineProperty(adapter, "getAdapter", {
          configurable: true,
          value: () => {
            const token = getCurrentRequestContext()?.token;
            if (token) interceptedTokens.push(token);
            return Promise.resolve(concreteAdapter);
          },
        });

        try {
          const fingerprint = await adapter.runWithContext(
            "project-a",
            "signed-user-token",
            () => adapter.getSourceSnapshotFingerprint(),
            "project-id-a",
            { branch: "main" },
          );

          assertEquals(typeof fingerprint, "string");
          assertEquals(interceptedTokens, []);
        } finally {
          Reflect.deleteProperty(adapter, "getAdapter");
          (adapter as any).manager = originalManager;
        }
      });
    });

    it("keeps concrete freshness independent of mutable prototype helpers", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        const originalFreshness = Object.getOwnPropertyDescriptor(
          VeryfrontFSAdapter.prototype,
          "ensureSourceSnapshotFresh",
        );
        const originalVersion = Object.getOwnPropertyDescriptor(
          VeryfrontFSAdapter.prototype,
          "getSourceSnapshotVersion",
        );
        const originalRefresh = Object.getOwnPropertyDescriptor(
          VeryfrontFSAdapter.prototype,
          "refreshSourceSnapshot",
        );
        const originalInitialization = Object.getOwnPropertyDescriptor(
          VeryfrontFSAdapter.prototype,
          "ensureInitialized",
        );
        const originalPerformRefresh = Object.getOwnPropertyDescriptor(
          VeryfrontFSAdapter.prototype,
          "performSourceSnapshotRefresh",
        );
        const concreteAdapter = new VeryfrontFSAdapter({
          veryfront: {
            apiBaseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "project-a",
            cache: { enabled: false },
          },
        });
        const internals = concreteAdapter as unknown as {
          initialized: boolean;
          contentContext: null;
          sourceSnapshotVersion: number;
        };
        internals.initialized = true;
        internals.contentContext = null;
        internals.sourceSnapshotVersion = 7;
        let spoofedFreshnessCalls = 0;
        let spoofedRefreshCalls = 0;
        let spoofedInitializationCalls = 0;
        let spoofedPerformRefreshCalls = 0;

        (adapter as any).manager = {
          getAdapter: () => Promise.resolve(concreteAdapter),
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };
        Object.defineProperty(VeryfrontFSAdapter.prototype, "ensureSourceSnapshotFresh", {
          configurable: true,
          value: () => {
            spoofedFreshnessCalls++;
            return Promise.resolve();
          },
        });
        Object.defineProperty(VeryfrontFSAdapter.prototype, "getSourceSnapshotVersion", {
          configurable: true,
          value: () => -1,
        });
        Object.defineProperty(VeryfrontFSAdapter.prototype, "refreshSourceSnapshot", {
          configurable: true,
          value: () => {
            spoofedRefreshCalls++;
            return Promise.resolve();
          },
        });
        Object.defineProperty(VeryfrontFSAdapter.prototype, "ensureInitialized", {
          configurable: true,
          value: () => {
            spoofedInitializationCalls++;
            internals.sourceSnapshotVersion = -1;
            return Promise.resolve();
          },
        });
        Object.defineProperty(VeryfrontFSAdapter.prototype, "performSourceSnapshotRefresh", {
          configurable: true,
          value: () => {
            spoofedPerformRefreshCalls++;
            return Promise.resolve();
          },
        });

        try {
          const version = await adapter.runWithContext(
            "project-a",
            "runtime-token",
            async () => {
              await adapter.ensureSourceSnapshotFresh("config-load");
              return await adapter.getSourceSnapshotVersion();
            },
            "project-id-a",
            { branch: "main" },
          );
          await adapter.runWithContext(
            "project-a",
            "runtime-token",
            () => adapter.refreshSourceSnapshot("manual-check"),
            "project-id-a",
            { branch: "main" },
          );
          assertEquals(version, 7);
          assertEquals(spoofedFreshnessCalls, 0);
          assertEquals(spoofedRefreshCalls, 0);
          assertEquals(spoofedInitializationCalls, 0);
          assertEquals(spoofedPerformRefreshCalls, 0);
        } finally {
          Object.defineProperty(
            VeryfrontFSAdapter.prototype,
            "ensureSourceSnapshotFresh",
            originalFreshness!,
          );
          Object.defineProperty(
            VeryfrontFSAdapter.prototype,
            "getSourceSnapshotVersion",
            originalVersion!,
          );
          Object.defineProperty(
            VeryfrontFSAdapter.prototype,
            "refreshSourceSnapshot",
            originalRefresh!,
          );
          if (originalInitialization) {
            Object.defineProperty(
              VeryfrontFSAdapter.prototype,
              "ensureInitialized",
              originalInitialization,
            );
          } else {
            Reflect.deleteProperty(VeryfrontFSAdapter.prototype, "ensureInitialized");
          }
          if (originalPerformRefresh) {
            Object.defineProperty(
              VeryfrontFSAdapter.prototype,
              "performSourceSnapshotRefresh",
              originalPerformRefresh,
            );
          } else {
            Reflect.deleteProperty(VeryfrontFSAdapter.prototype, "performSourceSnapshotRefresh");
          }
          (adapter as any).manager = originalManager;
          concreteAdapter.dispose();
        }
      });
    });

    it("preserves optional snapshot capabilities for legacy project adapters", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;

        (adapter as any).manager = {
          getAdapter: () => Promise.resolve({}),
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };

        try {
          await adapter.runWithContext(
            "project-a",
            "test-token",
            async () => {
              await adapter.ensureSourceSnapshotFresh("config-load");
              assertEquals(await adapter.getSourceSnapshotVersion(), undefined);
              assertEquals(await adapter.getSourceSnapshotFingerprint(), undefined);
            },
            "project-id-a",
            { branch: "main" },
          );
        } finally {
          (adapter as any).manager = originalManager;
        }
      });
    });

    it("delegates optional text reads to the active project adapter", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        let optionalPath: string | undefined;
        let normalReadCalled = false;

        (adapter as any).manager = {
          getAdapter() {
            return Promise.resolve({
              readOptionalTextFile(path: string) {
                optionalPath = path;
                return Promise.resolve("optional stylesheet");
              },
              readTextFile() {
                normalReadCalled = true;
                return Promise.resolve("normal read");
              },
            });
          },
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };

        try {
          const content = await adapter.runWithContext(
            "project-a",
            "test-token",
            () => adapter.readOptionalTextFile("app/globals.css"),
            "project-id-a",
            { branch: "main" },
          );

          assertEquals(content, "optional stylesheet");
          assertEquals(optionalPath, "app/globals.css");
          assertEquals(normalReadCalled, false);
        } finally {
          (adapter as any).manager = originalManager;
        }
      });
    });

    it("materializes production release adapters before running the context callback", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        let getAdapterCalled = false;
        let callbackSawMaterializedAdapter = false;
        let capturedProjectSlug: string | undefined;
        let capturedProjectId: string | undefined;
        let capturedProductionMode: boolean | undefined;
        let capturedReleaseId: string | null | undefined;
        let capturedEnvironmentName: string | null | undefined;
        let capturedBranch: string | null | undefined;

        (adapter as any).manager = {
          getAdapter(
            projectSlug: string,
            _token: string,
            projectId?: string,
            productionMode?: boolean,
            releaseId?: string | null,
            environmentName?: string | null,
            branch?: string | null,
          ) {
            getAdapterCalled = true;
            capturedProjectSlug = projectSlug;
            capturedProjectId = projectId;
            capturedProductionMode = productionMode;
            capturedReleaseId = releaseId;
            capturedEnvironmentName = environmentName;
            capturedBranch = branch;
            return Promise.resolve({});
          },
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };

        try {
          await adapter.runWithContext(
            "project-release",
            "test-token",
            async () => {
              callbackSawMaterializedAdapter = getAdapterCalled;
            },
            "project-id-release",
            {
              productionMode: true,
              releaseId: "rel-first-hit",
              environmentName: "production",
              branch: "main",
            },
          );
        } finally {
          (adapter as any).manager = originalManager;
        }

        assertEquals(callbackSawMaterializedAdapter, true);
        assertEquals(capturedProjectSlug, "project-release");
        assertEquals(capturedProjectId, "project-id-release");
        assertEquals(capturedProductionMode, true);
        assertEquals(capturedReleaseId, "rel-first-hit");
        assertEquals(capturedEnvironmentName, "production");
        assertEquals(
          capturedBranch,
          null,
          "a production release request must not forward a branch",
        );
      });
    });

    it("does not forward a releaseId for a preview branch request", async () => {
      await withAdapterAsync(async (adapter) => {
        const originalManager = (adapter as any).manager;
        let capturedReleaseId: string | null | undefined;
        let capturedBranch: string | null | undefined;

        (adapter as any).manager = {
          getAdapter(
            _projectSlug: string,
            _token: string,
            _projectId?: string,
            _productionMode?: boolean,
            releaseId?: string | null,
            _environmentName?: string | null,
            branch?: string | null,
          ) {
            capturedReleaseId = releaseId;
            capturedBranch = branch;
            return Promise.resolve({
              readOptionalTextFile: () => Promise.resolve("preview stylesheet"),
            });
          },
          getStats: () => ({ adapters: 0, stats: [] }),
          dispose: () => {},
        };

        try {
          await adapter.runWithContext(
            "project-preview",
            "test-token",
            () => adapter.readOptionalTextFile("app/globals.css"),
            "project-id-preview",
            {
              productionMode: false,
              releaseId: "rel-x",
              branch: "feature-x",
            },
          );
        } finally {
          (adapter as any).manager = originalManager;
        }

        assertEquals(capturedReleaseId, null, "a preview request must not forward a releaseId");
        assertEquals(capturedBranch, "feature-x", "a preview request forwards its branch");
      });
    });
  });
});

describe("isMultiProjectAdapter", () => {
  it("should export isMultiProjectAdapter function", () => {
    assertExists(isMultiProjectAdapter);
    assertEquals(typeof isMultiProjectAdapter, "function");
  });

  it("should return true for MultiProjectFSAdapter instance", () => {
    withAdapter((adapter) => {
      assertEquals(isMultiProjectAdapter(adapter), true);
    });
  });

  it("should return false for non-MultiProjectFSAdapter", () => {
    assertEquals(isMultiProjectAdapter({}), false);
    assertEquals(isMultiProjectAdapter(null), false);
    assertEquals(isMultiProjectAdapter(undefined), false);
    assertEquals(isMultiProjectAdapter("string"), false);
  });
});

describe("getCurrentRequestContext", () => {
  it("should return null when no context is active", () => {
    assertEquals(getCurrentRequestContext(), null);
  });

  it("should return context within runWithRequestContext", async () => {
    await runWithRequestContext(
      { projectSlug: "test-project", token: "test-token" },
      async () => {
        const ctx = getCurrentRequestContext();
        assertExists(ctx);
        assertEquals(ctx!.projectSlug, "test-project");
        assertEquals(ctx!.token, "test-token");
        assertEquals(ctx!.productionMode, false);
      },
    );
  });

  it("should return null after context exits", async () => {
    await runWithRequestContext(
      { projectSlug: "test", token: "token" },
      async () => {},
    );
    assertEquals(getCurrentRequestContext(), null);
  });
});

describe("runWithRequestContext", () => {
  it("should set productionMode from options", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok", productionMode: true },
      async () => {
        const ctx = getCurrentRequestContext();
        assertEquals(ctx!.productionMode, true);
      },
    );
  });

  it("should set releaseId from options", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok", releaseId: "rel-123" },
      async () => {
        const ctx = getCurrentRequestContext();
        assertEquals(ctx!.releaseId, "rel-123");
      },
    );
  });

  it("should set projectId from options", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok", projectId: "pid-456" },
      async () => {
        const ctx = getCurrentRequestContext();
        assertEquals(ctx!.projectId, "pid-456");
      },
    );
  });

  it("should set branch from options", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok", branch: "feature-branch" },
      async () => {
        const ctx = getCurrentRequestContext();
        assertEquals(ctx!.branch, "feature-branch");
      },
    );
  });

  it("should default releaseId to null", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        const ctx = getCurrentRequestContext();
        assertEquals(ctx!.releaseId, null);
      },
    );
  });

  it("should return the callback result", async () => {
    const result = await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => 42,
    );
    assertEquals(result, 42);
  });

  it("should provide a fileCache map", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        const ctx = getCurrentRequestContext();
        assertExists(ctx!.fileCache);
        assertEquals(ctx!.fileCache instanceof Map, true);
      },
    );
  });
});

describe("getRequestScopedFile / setRequestScopedFile", () => {
  it("should return undefined when no context is active", () => {
    assertEquals(getRequestScopedFile("key"), undefined);
  });

  it("should set and get files within context", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        setRequestScopedFile("file:test.ts", "content");
        assertEquals(getRequestScopedFile("file:test.ts"), "content");
      },
    );
  });

  it("should return undefined for non-existent keys within context", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        assertEquals(getRequestScopedFile("nonexistent"), undefined);
      },
    );
  });

  it("should not persist across contexts", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        setRequestScopedFile("key1", "value1");
      },
    );

    await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        assertEquals(getRequestScopedFile("key1"), undefined);
      },
    );
  });

  it("should clear all files in the current context", async () => {
    await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        setRequestScopedFile("file:a.ts", "a");
        setRequestScopedFile("file:b.ts", "b");

        assertEquals(clearRequestScopedFileCache(), 2);
        assertEquals(getRequestScopedFile("file:a.ts"), undefined);
        assertEquals(getRequestScopedFile("file:b.ts"), undefined);
      },
    );
  });

  it("should return zero when no context is active", () => {
    assertEquals(clearRequestScopedFileCache(), 0);
  });
});

describe("wrapWithCurrentContext", () => {
  it("should return the same function when no context is active", () => {
    const fn = () => "hello";
    const wrapped = wrapWithCurrentContext(fn);
    assertEquals(wrapped, fn);
  });

  it("should preserve context in wrapped function", async () => {
    const projectSlug = await runWithRequestContext(
      { projectSlug: "proj", token: "tok" },
      async () => {
        const wrappedFn = wrapWithCurrentContext(() => {
          return getCurrentRequestContext()?.projectSlug ?? null;
        });
        return wrappedFn();
      },
    );

    assertEquals(projectSlug, "proj");
  });
});

describe("globalThis.__vf_multi_project_adapter", () => {
  it("should be registered on globalThis", () => {
    assertExists(globalThis.__vf_multi_project_adapter);
  });

  it("should have getCurrentRequestContext function", () => {
    assertEquals(
      typeof globalThis.__vf_multi_project_adapter!.getCurrentRequestContext,
      "function",
    );
  });

  it("exposes no request credential through the global compatibility bridge", async () => {
    await runWithRequestContext(
      { projectSlug: "project", token: "private-request-token", productionMode: false },
      () => {
        assertEquals(getCurrentRequestContext()?.token, "private-request-token");
        assertEquals(globalThis.__vf_multi_project_adapter?.getCurrentRequestContext()?.token, "");
        return Promise.resolve();
      },
    );
  });

  it("should have getRequestScopedFile function", () => {
    assertEquals(typeof globalThis.__vf_multi_project_adapter!.getRequestScopedFile, "function");
  });

  it("should have setRequestScopedFile function", () => {
    assertEquals(typeof globalThis.__vf_multi_project_adapter!.setRequestScopedFile, "function");
  });

  it("should have clearRequestScopedFileCache function", () => {
    assertEquals(
      typeof globalThis.__vf_multi_project_adapter!.clearRequestScopedFileCache,
      "function",
    );
  });
});
