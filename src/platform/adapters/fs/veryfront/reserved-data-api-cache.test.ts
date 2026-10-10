import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { ApiCacheBackend, CacheBackends } from "#veryfront/cache/backend.ts";
import { initializeFileCacheBackend } from "../cache/file-cache.ts";
import { createAdapter } from "./adapter.test-helpers.ts";
import { buildFileListCacheKey } from "./cache-keys.ts";
import { scopeFileListCacheKeyToRequestAuthority } from "./request-authority.ts";
import { runWithRequestContext } from "./request-context.ts";

it("reserved data writes remove every authority listing from the shared API cache", async () => {
  const stored = new Map<string, string>();
  const patterns: string[] = [];
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  const originalFileBackend = CacheBackends.file;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  const backend = new ApiCacheBackend({
    apiBaseUrl: "https://api.example.com",
    apiToken: "test-token",
    circuitBreakerName: "reserved-data-api-cache",
  });
  CacheBackends.file = () => Promise.resolve(backend);
  try {
    await initializeFileCacheBackend();

    // Fake only the HTTP boundary. The real backend still sanitizes concrete
    // keys and validates deletion patterns before they reach this fake.
    const transport = backend as unknown as {
      request: (method: string, path: string, body?: Record<string, string>) => Promise<unknown>;
    };
    transport.request = (method, path, body = {}) => {
      const url = new URL(path, "https://api.example.com");
      const entryPrefix = "/entries/";
      if (method === "DELETE" && url.pathname === "/entries") {
        const pattern = url.searchParams.get("pattern");
        assertExists(pattern);
        patterns.push(pattern);
        // This path only receives a source prefix followed by one wildcard.
        assertEquals(pattern.endsWith("*"), true);
        const prefix = pattern.slice(0, -1);
        let deleted = 0;
        for (const key of stored.keys()) {
          if (key.startsWith(prefix)) {
            stored.delete(key);
            deleted++;
          }
        }
        return Promise.resolve({ pattern, status: "deleted", deleted_count: deleted });
      }
      if (url.pathname.startsWith(entryPrefix)) {
        const key = decodeURIComponent(url.pathname.slice(entryPrefix.length));
        if (method === "PUT") {
          assertExists(body.value);
          stored.set(key, body.value);
          return Promise.resolve({ key, expires_at: null });
        }
        if (method === "GET") {
          const value = stored.get(key) ?? null;
          return Promise.resolve({ key, found: value !== null, value, expires_at: null });
        }
        if (method === "DELETE") {
          const status = stored.delete(key) ? "deleted" : "absent";
          return Promise.resolve({ key, status });
        }
      }
      throw new Error(`Unexpected cache operation: ${method} ${url.pathname}`);
    };
    {
      for (
        const branch of [
          "main",
          "feature/foo",
          "feature%2Ffoo",
          "feature/東京",
          "vf-sanitized",
          "x".repeat(600),
        ]
      ) {
        const patternCountBefore = patterns.length;
        const request = (token: string) => ({
          projectSlug: "test-project",
          token,
          productionMode: false,
          branch,
        });
        await runWithRequestContext(request("writer-token"), async () => {
          const adapter = createAdapter({
            veryfront: {
              apiBaseUrl: "https://api.example.com",
              apiToken: "test-token",
              projectSlug: "test-project",
              contentSource: { type: "branch", branch: "main" },
              cache: { enabled: true },
            },
          });
          const files = [{ path: "agents/support.ts", content: "export default 1;" }];
          const created = { path: "knowledge/new.md", content: "new", type: "file", size: 3 };
          adapter.setContentContext({
            sourceType: "branch",
            projectSlug: "test-project",
            branch,
          });
          const client = adapter.getClient() as unknown as {
            initialize: () => Promise<void>;
            getProjectSlug: () => string;
            getProjectId: () => string;
            getCachedProject: () => { provider: string; layout: string };
            listAllFiles: () => Promise<typeof files>;
            getFile: () => Promise<typeof created>;
          };
          client.initialize = () => Promise.resolve();
          client.getProjectSlug = () => "test-project";
          client.getProjectId = () => "project-123";
          client.getCachedProject = () => ({ provider: "veryfront", layout: "default" });
          client.listAllFiles = () => Promise.resolve(files);
          client.getFile = () => Promise.resolve(created);
          const internals = adapter as unknown as {
            wsManager: { connect: () => void };
            cache: { setAsync: (key: string, value: unknown) => Promise<void> };
          };
          internals.wsManager.connect = () => {};
          try {
            await adapter.initialize();
            const context = adapter.getContentContext();
            assertExists(context);
            const sourceKey = buildFileListCacheKey(context);
            const writerKey = scopeFileListCacheKeyToRequestAuthority(sourceKey);
            const readerKey = await runWithRequestContext(
              request("reader-token"),
              () => Promise.resolve(scopeFileListCacheKeyToRequestAuthority(sourceKey)),
            );
            const otherBranchKey = scopeFileListCacheKeyToRequestAuthority(
              buildFileListCacheKey({ ...context, branch: "other" }),
            );
            for (const key of [sourceKey, writerKey, readerKey, otherBranchKey]) {
              await internals.cache.setAsync(key, files);
              assertExists(await backend.get(key), "the API backend must hold the stale listing");
            }

            await adapter.refreshReservedDataPaths([created.path]);

            for (const key of [sourceKey, writerKey, readerKey]) {
              assertEquals(await backend.get(key), null, "the stale shared listing must be gone");
            }
            assertExists(await backend.get(otherBranchKey), "another branch must remain cached");
            assertEquals(
              patterns.length,
              patternCountBefore + 1,
              "authority invalidation must reach the shared API",
            );
            assertEquals(
              warnings.filter((args) =>
                args.some((arg) => String(arg).includes("Refusing unsafe del-pattern"))
              ).length,
              0,
            );
          } finally {
            adapter.dispose();
          }
        });
      }
    }
  } finally {
    console.warn = originalWarn;
    CacheBackends.file = originalFileBackend;
  }
});
