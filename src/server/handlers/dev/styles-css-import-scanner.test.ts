import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { getCacheStats } from "#veryfront/utils/memory/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import type { HandlerContext } from "../types.ts";
import {
  extractProjectCssImports,
  invalidateProjectCssImportScans,
} from "./styles-css-import-scanner.ts";

const PROJECT_SLUG = "css-import-scan-project";
const LAYOUT_FILE = {
  path: "/project/app/layout.tsx",
  content: 'import "./styles.css";\nexport default ({ children }) => children;',
};
const IMPORTED_CSS = "/project/app/styles.css";

interface ScanAdapter {
  adapter: RuntimeAdapter;
  getScanCount: () => number;
  getWaitForWarmupValues: () => Array<boolean | undefined>;
  setFiles: (nextFiles: Array<{ path: string; content?: string }>) => void;
}

/**
 * Adapter whose `getAllSourceFiles()` counts how many times the source tree is
 * actually walked, which is the quantity this scanner's memoization bounds.
 */
function createScanAdapter(
  files: Array<{ path: string; content?: string }>,
  contentContext: ResolvedContentContext | null,
): ScanAdapter {
  const adapter = createMockAdapter();
  let currentFiles = files;
  let scanCount = 0;
  const waitForWarmupValues: Array<boolean | undefined> = [];

  const underlyingAdapter = {
    getAllSourceFiles: async (options?: { waitForWarmup?: boolean }) => {
      scanCount++;
      waitForWarmupValues.push(options?.waitForWarmup);
      await Promise.resolve();
      return currentFiles;
    },
    getContentContext: () => contentContext,
  };

  return {
    adapter: {
      ...adapter,
      fs: {
        ...adapter.fs,
        getUnderlyingAdapter: () => underlyingAdapter,
      },
    } as unknown as RuntimeAdapter,
    getScanCount: () => scanCount,
    getWaitForWarmupValues: () => waitForWarmupValues,
    setFiles: (nextFiles) => {
      currentFiles = nextFiles;
    },
  };
}

function makeCtx(adapter: RuntimeAdapter, overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/project",
    adapter,
    securityConfig: null,
    projectSlug: PROJECT_SLUG,
    ...overrides,
  };
}

function releaseContent(releaseId: string): ResolvedContentContext {
  return { sourceType: "release", projectSlug: PROJECT_SLUG, releaseId } as ResolvedContentContext;
}

function environmentContent(environmentName: string): ResolvedContentContext {
  return {
    sourceType: "environment",
    projectSlug: PROJECT_SLUG,
    environmentName,
  } as ResolvedContentContext;
}

interface DeferredScanAdapter {
  adapter: RuntimeAdapter;
  getScanCount: () => number;
  /** Complete the oldest source walk that is still waiting. */
  settleNext: (nextFiles: Array<{ path: string; content?: string }>) => void;
  settleAt: (index: number, nextFiles: Array<{ path: string; content?: string }>) => void;
}

/**
 * Adapter that holds each source walk open until the test releases it, so an
 * invalidation can be interleaved with a scan that is already reading sources.
 */
function createDeferredScanAdapter(contentContext: ResolvedContentContext): DeferredScanAdapter {
  const adapter = createMockAdapter();
  const waiting: Array<(files: Array<{ path: string; content?: string }>) => void> = [];
  let scanCount = 0;

  const underlyingAdapter = {
    getAllSourceFiles: () => {
      scanCount++;
      return new Promise<Array<{ path: string; content?: string }>>((resolve) => {
        waiting.push(resolve);
      });
    },
    getContentContext: () => contentContext,
  };

  return {
    adapter: {
      ...adapter,
      fs: { ...adapter.fs, getUnderlyingAdapter: () => underlyingAdapter },
    } as unknown as RuntimeAdapter,
    getScanCount: () => scanCount,
    settleNext: (nextFiles) => waiting.shift()?.(nextFiles),
    settleAt: (index, nextFiles) => waiting[index]?.(nextFiles),
  };
}

describe("server/handlers/dev/styles-css-import-scanner", () => {
  it("reuses an immutable content version's scan instead of re-walking sources", async () => {
    // The route this scanner runs for is public and the scan happens before the
    // prepared-CSS cache lookup, so an unauthenticated client must not be able
    // to force one full source walk per request.
    const scan = createScanAdapter([LAYOUT_FILE], releaseContent("rel-reuse"));
    const ctx = makeCtx(scan.adapter);

    try {
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const first = await extractProjectCssImports(ctx);
      assertEquals(first, [IMPORTED_CSS]);
      assertEquals(scan.getScanCount(), 1);

      for (let i = 0; i < 5; i++) {
        assertEquals(await extractProjectCssImports(ctx), [IMPORTED_CSS]);
      }

      assertEquals(
        scan.getScanCount(),
        1,
        "repeated stylesheet requests must not re-walk the project sources",
      );
      assertEquals(scan.getWaitForWarmupValues(), [true]);
    } finally {
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("coalesces concurrent scans into a single source walk", async () => {
    const scan = createScanAdapter([LAYOUT_FILE], releaseContent("rel-concurrent"));
    const ctx = makeCtx(scan.adapter);

    try {
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const results = await Promise.all(
        Array.from({ length: 8 }, () => extractProjectCssImports(ctx)),
      );

      for (const result of results) assertEquals(result, [IMPORTED_CSS]);
      assertEquals(
        scan.getScanCount(),
        1,
        "parallel requests must share one scan rather than each starting their own",
      );
    } finally {
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("does not reuse a scan across content versions", async () => {
    const scan = createScanAdapter([LAYOUT_FILE], releaseContent("rel-a"));
    const first = makeCtx(scan.adapter);

    try {
      invalidateProjectCssImportScans(PROJECT_SLUG);

      assertEquals(await extractProjectCssImports(first), [IMPORTED_CSS]);
      assertEquals(scan.getScanCount(), 1);

      const other = createScanAdapter([], releaseContent("rel-b"));
      const second = makeCtx(other.adapter);

      assertEquals(await extractProjectCssImports(second), []);
      assertEquals(other.getScanCount(), 1);
    } finally {
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("rescans after the project's style caches are invalidated", async () => {
    const scan = createScanAdapter([LAYOUT_FILE], releaseContent("rel-invalidate"));
    const ctx = makeCtx(scan.adapter);

    try {
      invalidateProjectCssImportScans(PROJECT_SLUG);

      assertEquals(await extractProjectCssImports(ctx), [IMPORTED_CSS]);
      assertEquals(scan.getScanCount(), 1);

      scan.setFiles([]);
      invalidateProjectCssImportScans(PROJECT_SLUG);

      assertEquals(await extractProjectCssImports(ctx), []);
      assertEquals(scan.getScanCount(), 2);
    } finally {
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("retires a release entry by its resolved content slug even when the admitted slug differs", async () => {
    // A content push invalidates by the resolved content slug. If the entry
    // stored the admitted request slug instead, a mismatch between the two
    // would leave a release-versioned entry that no targeted invalidation ever
    // matches, and nothing else retires a release entry.
    const scan = createScanAdapter([LAYOUT_FILE], releaseContent("rel-scope-precedence"));
    const ctx = makeCtx(scan.adapter, { projectSlug: "admitted-alias" });

    try {
      invalidateProjectCssImportScans(PROJECT_SLUG);

      assertEquals(await extractProjectCssImports(ctx), [IMPORTED_CSS]);
      assertEquals(scan.getScanCount(), 1);

      scan.setFiles([]);
      invalidateProjectCssImportScans(PROJECT_SLUG);

      assertEquals(await extractProjectCssImports(ctx), []);
      assertEquals(
        scan.getScanCount(),
        2,
        "invalidating by the resolved content slug must retire the entry",
      );
    } finally {
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("keeps a failed scan out of the cache", async () => {
    const adapter = createMockAdapter();
    let attempts = 0;
    const underlyingAdapter = {
      getAllSourceFiles: () => {
        attempts++;
        if (attempts === 1) return Promise.reject(new Error("source listing unavailable"));
        return Promise.resolve([LAYOUT_FILE]);
      },
      getContentContext: () => releaseContent("rel-failure"),
    };
    const ctx = makeCtx(
      {
        ...adapter,
        fs: { ...adapter.fs, getUnderlyingAdapter: () => underlyingAdapter },
      } as unknown as RuntimeAdapter,
    );

    try {
      invalidateProjectCssImportScans(PROJECT_SLUG);

      let failed = false;
      try {
        await extractProjectCssImports(ctx);
      } catch (_) {
        failed = true;
      }
      assertEquals(failed, true);

      assertEquals(await extractProjectCssImports(ctx), [IMPORTED_CSS]);
      assertEquals(attempts, 2);
    } finally {
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("refreshes an environment version's scan once the mutable TTL expires", async () => {
    // `environment:<name>` is a moving pointer: the same name resolves to
    // different release contents across redeploys, so the scan must self-heal
    // on the TTL rather than depending on an invalidation poke arriving.
    using time = new FakeTime();
    const scan = createScanAdapter([LAYOUT_FILE], environmentContent("staging"));
    const ctx = makeCtx(scan.adapter);

    try {
      invalidateProjectCssImportScans(PROJECT_SLUG);

      assertEquals(await extractProjectCssImports(ctx), [IMPORTED_CSS]);
      assertEquals(scan.getScanCount(), 1);

      scan.setFiles([]);
      time.tick(2_500);

      assertEquals(await extractProjectCssImports(ctx), []);
      assertEquals(
        scan.getScanCount(),
        2,
        "an environment scan must not be reused indefinitely without an invalidation",
      );
    } finally {
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("keeps reusing a release version's scan past the mutable TTL", async () => {
    using time = new FakeTime();
    const scan = createScanAdapter([LAYOUT_FILE], releaseContent("rel-frozen"));
    const ctx = makeCtx(scan.adapter);

    try {
      invalidateProjectCssImportScans(PROJECT_SLUG);

      assertEquals(await extractProjectCssImports(ctx), [IMPORTED_CSS]);
      time.tick(60_000);
      assertEquals(await extractProjectCssImports(ctx), [IMPORTED_CSS]);

      assertEquals(
        scan.getScanCount(),
        1,
        "a release names frozen content, so its scan never needs re-walking",
      );
    } finally {
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("does not let a scan that began before an invalidation repopulate the cache", async () => {
    const scan = createDeferredScanAdapter(releaseContent("rel-midflight"));
    const ctx = makeCtx(scan.adapter);

    try {
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const inFlight = extractProjectCssImports(ctx);
      assertEquals(scan.getScanCount(), 1);

      // A content push lands while the walk is still reading the old snapshot.
      invalidateProjectCssImportScans(PROJECT_SLUG);
      scan.settleNext([LAYOUT_FILE]);
      assertEquals(await inFlight, [IMPORTED_CSS]);

      const after = extractProjectCssImports(ctx);
      assertEquals(
        scan.getScanCount(),
        2,
        "the pre-invalidation snapshot must not have been written back to the cache",
      );
      scan.settleNext([]);
      assertEquals(await after, []);
    } finally {
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("does not serve a pre-invalidation walk to requests that arrive after it", async () => {
    const scan = createDeferredScanAdapter(releaseContent("rel-midflight-join"));
    const ctx = makeCtx(scan.adapter);

    try {
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const stale = extractProjectCssImports(ctx);
      assertEquals(scan.getScanCount(), 1);

      invalidateProjectCssImportScans(PROJECT_SLUG);

      const fresh = extractProjectCssImports(ctx);
      assertEquals(
        scan.getScanCount(),
        2,
        "a request after an invalidation must start its own walk, not join the retired one",
      );

      scan.settleNext([LAYOUT_FILE]);
      scan.settleNext([]);
      assertEquals(await stale, [IMPORTED_CSS]);
      assertEquals(await fresh, []);
    } finally {
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("does not let one project's invalidation retire another project's in-flight walk", async () => {
    // Invalidation is per project scope, so a content push for one tenant must
    // not force an unrelated tenant on the same runtime to re-walk its sources.
    const other = createDeferredScanAdapter(
      {
        sourceType: "release",
        projectSlug: "neighbour-project",
        releaseId: "rel-neighbour",
      } as ResolvedContentContext,
    );
    const otherCtx = makeCtx(other.adapter, { projectSlug: "neighbour-project" });

    try {
      invalidateProjectCssImportScans();

      const inFlight = extractProjectCssImports(otherCtx);
      assertEquals(other.getScanCount(), 1);

      // A push for an unrelated project lands mid-walk.
      invalidateProjectCssImportScans(PROJECT_SLUG);
      other.settleNext([LAYOUT_FILE]);
      assertEquals(await inFlight, [IMPORTED_CSS]);

      const reused = extractProjectCssImports(otherCtx);
      const scansAfterReuse = other.getScanCount();
      // Release the walk that only a regressed build would have started, so the
      // assertions below report the defect instead of hanging on it.
      other.settleNext([]);

      assertEquals(await reused, [IMPORTED_CSS]);
      assertEquals(
        scansAfterReuse,
        1,
        "an unrelated project's push must not discard this project's completed walk",
      );
    } finally {
      invalidateProjectCssImportScans();
    }
  });

  it("keys the scan on the admitted tenant when the proxy filesystem resolves no content", async () => {
    // A shared-proxy filesystem exposes getAllSourceFiles() but no content
    // context while every tenant keeps the same server-level projectDir, so
    // without the admitted slug in the key project B would be served project
    // A's imports. In proxy mode the slug is trusted tenant identity: the
    // proxy admission boundary resolved it, not the client.
    const tenantA = createScanAdapter([LAYOUT_FILE], null);
    const tenantB = createScanAdapter([], null);

    try {
      invalidateProjectCssImportScans();

      // Both tenants are served by one runtime, so they share `projectDir`.
      assertEquals(
        await extractProjectCssImports(
          makeCtx(tenantA.adapter, { projectSlug: "tenant-a", isProxyMode: true }),
        ),
        [IMPORTED_CSS],
      );
      assertEquals(
        await extractProjectCssImports(
          makeCtx(tenantB.adapter, { projectSlug: "tenant-b", isProxyMode: true }),
        ),
        [],
      );
      assertEquals(
        tenantB.getScanCount(),
        1,
        "a second tenant must walk its own sources, not reuse the first tenant's scan",
      );
    } finally {
      invalidateProjectCssImportScans();
    }
  });

  it("ignores the client-supplied slug on a non-proxy content-less filesystem", async () => {
    // Outside proxy mode there is no admission boundary for the slug: it is the
    // raw x-project-slug header or the Host-parsed subdomain, so keying on it
    // would let an unauthenticated client mint a fresh cache key per request
    // and force one full source walk each time. The filesystem serves
    // `projectDir` whatever the client claims, so that directory is the key.
    const scan = createScanAdapter([LAYOUT_FILE], null);

    try {
      invalidateProjectCssImportScans();

      for (const projectSlug of ["claim-1", "claim-2", "claim-3", "claim-4"]) {
        const ctx = makeCtx(scan.adapter, { projectSlug });
        assertEquals(await extractProjectCssImports(ctx), [IMPORTED_CSS]);
      }

      assertEquals(
        scan.getScanCount(),
        1,
        "client-supplied slugs must not be able to multiply source walks on a standalone server",
      );
    } finally {
      invalidateProjectCssImportScans();
    }
  });

  it("ignores request-supplied selectors when the filesystem resolves no content", async () => {
    // `x-release-id` reaches the handler without an identity-trust gate, so on a
    // standalone server a client could otherwise mint a distinct "immutable"
    // key per request and force one full source walk each time.
    const scan = createScanAdapter([LAYOUT_FILE], null);

    try {
      invalidateProjectCssImportScans(PROJECT_SLUG);

      for (const releaseId of ["rel-1", "rel-2", "rel-3", "rel-4"]) {
        const ctx = makeCtx(scan.adapter, { releaseId } as Partial<HandlerContext>);
        assertEquals(await extractProjectCssImports(ctx), [IMPORTED_CSS]);
      }

      assertEquals(
        scan.getScanCount(),
        1,
        "client-supplied release ids must not be able to multiply source walks",
      );
    } finally {
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("keys proxy scans on the admitted content snapshot", async () => {
    const scan = createScanAdapter([LAYOUT_FILE], null);

    try {
      invalidateProjectCssImportScans(PROJECT_SLUG);
      assertEquals(
        await extractProjectCssImports(
          makeCtx(scan.adapter, { isProxyMode: true, releaseId: "rel-a" }),
        ),
        [IMPORTED_CSS],
      );
      scan.setFiles([]);
      assertEquals(
        await extractProjectCssImports(
          makeCtx(scan.adapter, { isProxyMode: true, releaseId: "rel-b" }),
        ),
        [],
      );
      assertEquals(scan.getScanCount(), 2);
    } finally {
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  // The content-less (local-walk) identity case needs a real directory tree, so
  // it lives in tests/integration/server/styles-css-import-scanner-real-filesystem.test.ts
  // rather than here, where the unit cases stay hermetic.

  it("clears every project's scans when invalidated without a scope", async () => {
    const scan = createScanAdapter([LAYOUT_FILE], releaseContent("rel-global"));
    const ctx = makeCtx(scan.adapter);

    try {
      invalidateProjectCssImportScans();

      assertEquals(await extractProjectCssImports(ctx), [IMPORTED_CSS]);
      assertEquals(scan.getScanCount(), 1);

      invalidateProjectCssImportScans();
      scan.setFiles([]);

      assertEquals(await extractProjectCssImports(ctx), []);
      assertEquals(scan.getScanCount(), 2);
    } finally {
      invalidateProjectCssImportScans();
    }
  });

  it("does not reuse a generation while an overwritten scan is still pending", async () => {
    const scan = createDeferredScanAdapter(releaseContent("rel-aba"));
    const ctx = makeCtx(scan.adapter);

    try {
      invalidateProjectCssImportScans(PROJECT_SLUG);
      const oldScan = extractProjectCssImports(ctx);
      invalidateProjectCssImportScans(PROJECT_SLUG);
      const replacementScan = extractProjectCssImports(ctx);
      assertEquals(scan.getScanCount(), 2);

      scan.settleAt(1, []);
      assertEquals(await replacementScan, []);
      invalidateProjectCssImportScans(PROJECT_SLUG);

      scan.settleAt(0, [LAYOUT_FILE]);
      assertEquals(await oldScan, [IMPORTED_CSS]);

      const afterOldScan = extractProjectCssImports(ctx);
      assertEquals(scan.getScanCount(), 3);
      scan.settleAt(2, []);
      assertEquals(await afterOldScan, []);
    } finally {
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("evicts the oldest scan instead of growing without bound", async () => {
    try {
      invalidateProjectCssImportScans();

      const first = createScanAdapter([LAYOUT_FILE], releaseContent("rel-evicted"));
      assertEquals(await extractProjectCssImports(makeCtx(first.adapter)), [IMPORTED_CSS]);
      assertEquals(first.getScanCount(), 1);

      // Fill past the cache ceiling so the first entry ages out.
      for (let i = 0; i < 220; i++) {
        const filler = createScanAdapter([], releaseContent(`rel-filler-${i}`));
        await extractProjectCssImports(makeCtx(filler.adapter));
      }

      const stats = getCacheStats().find((cache) => cache.name === "styles-css-import-scans");
      assertEquals(stats?.maxEntries, 200);
      assertEquals(
        (stats?.entries ?? 0) <= 200,
        true,
        `scan cache grew past its ceiling: ${stats?.entries}`,
      );

      assertEquals(await extractProjectCssImports(makeCtx(first.adapter)), [IMPORTED_CSS]);
      assertEquals(first.getScanCount(), 2, "the oldest scan should have been evicted");
    } finally {
      invalidateProjectCssImportScans();
    }
  });
});
