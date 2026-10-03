import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { ApiCacheBackend } from "#veryfront/cache/backends/api.ts";
import { isValidCacheKey, isValidCachePattern } from "#veryfront/cache/keys/api-policy.ts";
import { decodeFileOperationSource } from "#veryfront/cache/keys/file-operation-source.ts";
import {
  buildDirCacheKeyPrefix,
  buildFileCacheKeyPrefix,
  buildStatCacheKeyPrefix,
  scopeFileOperationCacheKeyPrefix,
} from "#veryfront/cache/keys/builders/file.ts";
import type { FileOperationContext } from "#veryfront/cache/keys/prefixes.ts";
import { WebSocketManager } from "#veryfront/platform/adapters/fs/veryfront/websocket-manager.ts";
import { clearAllPendingInvalidations } from "#veryfront/platform/adapters/fs/veryfront/invalidation-state.ts";
import type { FileCache } from "#veryfront/platform/adapters/fs/cache/file-cache.ts";
import type { VeryfrontApiClient } from "#veryfront/platform/adapters/veryfront-api-client/index.ts";

const builders = [buildFileCacheKeyPrefix, buildStatCacheKeyPrefix, buildDirCacheKeyPrefix];
const context = {
  sourceType: "branch" as const,
  projectSlug: "test-project",
  branch: "feature/foo",
};
const AUTHORITY_VARIANT = "authority:0123456789abcdef";

/** Concrete key in the runtime shape: source prefix, credential scope, path. */
function runtimeKey(prefix: string, path: string): string {
  return `${scopeFileOperationCacheKeyPrefix(prefix, AUTHORITY_VARIANT)}:${path}`;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`);
}

/** Cache API double that enforces the API key policy and glob deletion. */
function createCacheApi() {
  const entries = new Map<string, string>();
  const patterns: string[] = [];
  const fetchMock: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(observeFetchRequestInit(init).body ?? "{}"));
    if (url.pathname.endsWith("/set")) {
      assertEquals(isValidCacheKey(body.key), true, `API-unsafe key ${body.key}`);
      entries.set(body.key, body.value);
      return Promise.resolve(Response.json({ success: true }));
    }
    if (url.pathname.endsWith("/get")) {
      return Promise.resolve(
        Response.json({ value: entries.get(url.searchParams.get("key")!) ?? null }),
      );
    }
    assertEquals(url.pathname.endsWith("/del-pattern"), true);
    assertEquals(isValidCachePattern(body.pattern), true, `API-unsafe glob ${body.pattern}`);
    patterns.push(body.pattern);
    const matcher = globToRegExp(body.pattern);
    let deleted = 0;
    for (const key of [...entries.keys()]) {
      if (matcher.test(key)) {
        entries.delete(key);
        deleted++;
      }
    }
    return Promise.resolve(Response.json({ deleted }));
  };
  return { entries, patterns, fetchMock };
}

function withApiBackend<T>(
  name: string,
  api: ReturnType<typeof createCacheApi>,
  fn: (backend: ApiCacheBackend) => Promise<T>,
): Promise<T> {
  return withMockFetch(api.fetchMock, () =>
    runWithRequestContext({
      projectSlug: context.projectSlug,
      token: "test-token",
      productionMode: false,
      releaseId: null,
      branch: context.branch,
      environmentName: null,
    }, () =>
      fn(
        new ApiCacheBackend({
          apiBaseUrl: "https://cache.example.test",
          apiToken: "test-token",
          circuitBreakerName: name,
        }),
      )));
}

/** The FileCache deletion contract, delegated to the API backend. */
function fileCacheOver(backend: ApiCacheBackend): FileCache {
  return {
    deleteByPrefixAsync: (prefix: string) => backend.delByPattern(`${prefix}*`),
    deleteByPrefixAndSuffixAsync: (prefix: string, suffix: string) =>
      backend.delByPattern(`${prefix}*:${suffix}`),
  } as unknown as FileCache;
}

class TestSocket {
  static readonly OPEN = 1;
  readyState = TestSocket.OPEN;
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  close(): void {
    this.readyState = 3;
  }
  send(): void {}
  poke(data: Record<string, unknown>): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "poke", data }) }));
  }
}

function createManager(
  cache: FileCache,
  source: { projectSlug: string; branch?: string },
  onReload: () => void,
): { manager: WebSocketManager; socket: () => TestSocket } {
  let socket: TestSocket | undefined;
  const manager = new WebSocketManager({
    apiBaseUrl: "https://api.example.test/api",
    apiToken: "test-token",
    projectSlug: source.projectSlug,
    cache,
    client: {
      getProjectId: () => "project-1",
      listAllFiles: () => Promise.resolve([]),
    } as unknown as VeryfrontApiClient,
    invalidationCallbacks: {
      isAdapterInUse: () => false,
      triggerReload: onReload,
    },
    getContentContext: () => ({
      sourceType: "branch",
      projectSlug: source.projectSlug,
      branch: source.branch,
    }),
    getContentSource: () => ({ type: "branch", branch: source.branch }),
    getProjectDir: () => undefined,
    clearMemoryCaches: () => {},
    replaceSourceSnapshot: () => Promise.resolve(0),
    createWebSocket: () => {
      socket = new TestSocket();
      return socket as unknown as WebSocket;
    },
  });
  manager.connect("project-1");
  return { manager, socket: () => socket! };
}

async function seed(
  backend: ApiCacheBackend,
  ctx: FileOperationContext,
  path: string,
  parentDir: string,
): Promise<string[]> {
  const keys = [
    runtimeKey(buildFileCacheKeyPrefix(ctx), path),
    runtimeKey(buildStatCacheKeyPrefix(ctx), path),
    runtimeKey(buildDirCacheKeyPrefix(ctx), parentDir),
  ];
  for (const key of keys) await backend.set(key, "stale");
  return keys;
}

afterEach(() => clearAllPendingInvalidations());

it("removes slash-branch runtime-scoped entries through the real API backend", async () => {
  const api = createCacheApi();
  await withApiBackend("slash-source-regression", api, async (backend) => {
    for (const build of builders) {
      const prefix = build(context);
      const key = runtimeKey(prefix, "app/page.tsx");
      const otherKey = runtimeKey(build({ ...context, branch: "feature/foobar" }), "app/page.tsx");
      await backend.set(key, "stale");
      await backend.set(otherKey, "other");
      assertEquals(await backend.get(key), "stale");
      assertEquals(api.entries.get(key), "stale", "the API must store the key unchanged");
      assertEquals(
        decodeFileOperationSource(key.split(":"))?.qualifier,
        context.branch,
        "the credential scope must not alter the encoded source",
      );
      assertEquals(await backend.delByPattern(`${prefix}:*`), 1);
      assertEquals(await backend.get(key), null);
      assertEquals(await backend.get(otherKey), "other");
    }
    assertEquals(
      api.patterns.length,
      3,
      "all invalidations must reach HTTP rather than be refused",
    );
  });
});

it("selective slash-branch POKE clears the changed entries and keeps a sibling branch", async () => {
  const api = createCacheApi();
  await withApiBackend("slash-selective-poke", api, async (backend) => {
    const current = await seed(backend, context, "app/page.tsx", "app");
    const sibling = await seed(
      backend,
      { ...context, branch: "feature/foobar" },
      "app/page.tsx",
      "app",
    );
    let reloads = 0;
    const { manager, socket } = createManager(fileCacheOver(backend), context, () => reloads++);
    try {
      socket().poke({ changedPaths: ["app/page.tsx"], branchName: context.branch });
      await waitFor(() => reloads > 0, { interval: 10, message: "selective invalidation" });
      for (const key of current) assertEquals(api.entries.has(key), false, key);
      for (const key of sibling) assertEquals(api.entries.get(key), "stale", key);
    } finally {
      manager.dispose();
    }
  });
});

it("full slash-branch POKE clears the current source and keeps a sibling branch", async () => {
  const api = createCacheApi();
  await withApiBackend("slash-full-poke", api, async (backend) => {
    const current = await seed(backend, context, "app/page.tsx", "app");
    const sibling = await seed(
      backend,
      { ...context, branch: "feature/foobar" },
      "app/page.tsx",
      "app",
    );
    let reloads = 0;
    const { manager, socket } = createManager(fileCacheOver(backend), context, () => reloads++);
    try {
      socket().poke({ branchName: context.branch });
      await waitFor(() => reloads > 0, { interval: 10, message: "full invalidation" });
      for (const key of current) assertEquals(api.entries.has(key), false, key);
      for (const key of sibling) assertEquals(api.entries.get(key), "stale", key);
    } finally {
      manager.dispose();
    }
  });
});

it("deployment POKE without a release ID clears versioned project release entries", async () => {
  const api = createCacheApi();
  await withApiBackend("deployment-poke-versioned", api, async (backend) => {
    const release = { sourceType: "release" as const, releaseId: "release/1" };
    const environment = {
      sourceType: "environment" as const,
      environmentName: "production",
      releaseId: "release/1",
    };
    const owned = [
      ...await seed(backend, { ...release, projectSlug: "test-project" }, "app/other.tsx", "app"),
      ...await seed(
        backend,
        { ...environment, projectSlug: "test-project" },
        "app/other.tsx",
        "app",
      ),
    ];
    const otherProject = [
      ...await seed(backend, { ...release, projectSlug: "other-project" }, "app/other.tsx", "app"),
      ...await seed(
        backend,
        { ...environment, projectSlug: "other-project" },
        "app/other.tsx",
        "app",
      ),
    ];
    for (const key of owned) assertEquals(key.split(":")[1]?.endsWith("-v2"), true, key);
    let reloads = 0;
    const { manager, socket } = createManager(
      fileCacheOver(backend),
      { projectSlug: "test-project" },
      () => reloads++,
    );
    try {
      socket().poke({ entityType: "deployment", changedPaths: ["app/page.tsx"] });
      await waitFor(
        () => reloads > 0 && owned.every((key) => !api.entries.has(key)),
        { interval: 10, message: "publish invalidation" },
      );
      for (const key of otherProject) assertEquals(api.entries.get(key), "stale", key);
    } finally {
      manager.dispose();
    }
  });
});
