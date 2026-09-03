import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { getCacheStats } from "#veryfront/utils/memory/index.ts";
import { invalidateProjectCandidateManifests } from "#veryfront/rendering/orchestrator/css-candidate-manifest.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import type { HandlerContext } from "../types.ts";
import {
  extractProjectCandidates,
  invalidateProjectCandidateScans,
} from "./styles-candidate-scanner.ts";

const PROJECT_SLUG = "candidate-scan-project";
const PAGE_FILE = {
  path: "/project/app/page.tsx",
  content: '<div className="text-cyan-500">Hi</div>',
};

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
      fs: { ...adapter.fs, getUnderlyingAdapter: () => underlyingAdapter },
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

function reset(): void {
  invalidateProjectCandidateScans();
  invalidateProjectCandidateManifests();
}

describe("server/handlers/dev/styles-candidate-scanner", () => {
  it("reuses an immutable content version's scan instead of re-walking sources", async () => {
    // The stylesheet route is public and the candidate scan runs before the
    // prepared-CSS cache lookup, so an unauthenticated client must not be able
    // to force one full source walk per request. The candidate manifest
    // memoizes only the extraction, never the walk that feeds it.
    const scan = createScanAdapter([PAGE_FILE], releaseContent("rel-reuse"));
    const ctx = makeCtx(scan.adapter);

    try {
      reset();

      const first = await extractProjectCandidates(ctx);
      assertEquals(first.has("text-cyan-500"), true);
      assertEquals(scan.getScanCount(), 1);

      for (let i = 0; i < 5; i++) {
        assertEquals((await extractProjectCandidates(ctx)).has("text-cyan-500"), true);
      }

      assertEquals(
        scan.getScanCount(),
        1,
        "repeated stylesheet requests must not re-walk the project sources",
      );
    } finally {
      reset();
    }
  });

  it("retries an empty immutable source listing instead of caching it forever", async () => {
    const scan = createScanAdapter([], releaseContent("rel-empty-retry"));
    const ctx = makeCtx(scan.adapter);

    try {
      reset();
      assertEquals((await extractProjectCandidates(ctx)).has("text-cyan-500"), false);
      scan.setFiles([PAGE_FILE]);
      assertEquals((await extractProjectCandidates(ctx)).has("text-cyan-500"), true);
      assertEquals(scan.getScanCount(), 2);
    } finally {
      reset();
    }
  });

  it("coalesces concurrent scans into a single source walk", async () => {
    const scan = createScanAdapter([PAGE_FILE], releaseContent("rel-concurrent"));
    const ctx = makeCtx(scan.adapter);

    try {
      reset();

      const results = await Promise.all(
        Array.from({ length: 8 }, () => extractProjectCandidates(ctx)),
      );

      for (const result of results) assertEquals(result.has("text-cyan-500"), true);
      assertEquals(
        scan.getScanCount(),
        1,
        "parallel requests must share one scan rather than each starting their own",
      );
    } finally {
      reset();
    }
  });

  it("rescans after the project's style caches are invalidated", async () => {
    const scan = createScanAdapter([PAGE_FILE], releaseContent("rel-invalidate"));
    const ctx = makeCtx(scan.adapter);

    try {
      reset();

      assertEquals((await extractProjectCandidates(ctx)).has("text-cyan-500"), true);
      assertEquals(scan.getScanCount(), 1);

      scan.setFiles([]);
      reset();

      assertEquals((await extractProjectCandidates(ctx)).has("text-cyan-500"), false);
      assertEquals(scan.getScanCount(), 2);
    } finally {
      reset();
    }
  });

  it("waits for the file-list warmup only where the scan is frozen under a release key", async () => {
    // On a release-backed cold start `getAllSourceFiles()` schedules a warmup
    // and answers empty, and nothing else populates that list. An empty result
    // memoized under a `release:` key never expires, so the stylesheet would be
    // served with framework candidates only for the life of the process. A
    // mutable key self-heals on the TTL and must not pay for the fetch.
    const frozen = createScanAdapter([PAGE_FILE], releaseContent("rel-warmup"));
    const mutable = createScanAdapter([PAGE_FILE], {
      sourceType: "branch",
      projectSlug: PROJECT_SLUG,
      branch: "warmup",
    } as ResolvedContentContext);

    try {
      reset();

      await extractProjectCandidates(makeCtx(frozen.adapter));
      await extractProjectCandidates(makeCtx(mutable.adapter));

      assertEquals(frozen.getWaitForWarmupValues(), [true]);
      assertEquals(mutable.getWaitForWarmupValues(), [false]);
    } finally {
      reset();
    }
  });

  it("refreshes a mutable content version's scan once the TTL expires", async () => {
    // A branch preview's sources change under a stable content version, so the
    // scan must self-heal on the TTL rather than depend on a poke arriving.
    using time = new FakeTime();
    const scan = createScanAdapter([PAGE_FILE], {
      sourceType: "branch",
      projectSlug: PROJECT_SLUG,
      branch: "feature",
    } as ResolvedContentContext);
    const ctx = makeCtx(scan.adapter);

    try {
      reset();

      assertEquals((await extractProjectCandidates(ctx)).has("text-cyan-500"), true);
      assertEquals(scan.getScanCount(), 1);

      scan.setFiles([]);
      time.tick(2_500);

      assertEquals((await extractProjectCandidates(ctx)).has("text-cyan-500"), false);
      assertEquals(scan.getScanCount(), 2);
    } finally {
      reset();
    }
  });

  it("ignores the client-supplied slug on a non-proxy content-less filesystem", async () => {
    // Outside proxy mode the slug is the raw x-project-slug header or the
    // Host-parsed subdomain, with no trust gate, while the filesystem serves
    // `projectDir` whatever the client claims. Keying on it would let an
    // unauthenticated client mint a fresh key per request and force one full
    // source walk each time.
    const scan = createScanAdapter([PAGE_FILE], null);

    try {
      reset();

      for (const projectSlug of ["claim-1", "claim-2", "claim-3", "claim-4"]) {
        const candidates = await extractProjectCandidates(makeCtx(scan.adapter, { projectSlug }));
        assertEquals(candidates.has("text-cyan-500"), true);
      }

      assertEquals(
        scan.getScanCount(),
        1,
        "client-supplied slugs must not be able to multiply source walks on a standalone server",
      );
    } finally {
      reset();
    }
  });

  it("keys the scan on the admitted tenant when the proxy filesystem resolves no content", async () => {
    // A shared-proxy filesystem exposes getAllSourceFiles() but no content
    // context while every tenant keeps the same server-level projectDir, so
    // without the admitted slug in the key project B would be compiled with
    // project A's candidates.
    const tenantA = createScanAdapter([PAGE_FILE], null);
    const tenantB = createScanAdapter([], null);

    try {
      reset();

      const a = await extractProjectCandidates(
        makeCtx(tenantA.adapter, { projectSlug: "tenant-a", isProxyMode: true }),
      );
      const b = await extractProjectCandidates(
        makeCtx(tenantB.adapter, { projectSlug: "tenant-b", isProxyMode: true }),
      );

      assertEquals(a.has("text-cyan-500"), true);
      assertEquals(b.has("text-cyan-500"), false);
      assertEquals(
        tenantB.getScanCount(),
        1,
        "a second tenant must walk its own sources, not reuse the first tenant's scan",
      );
    } finally {
      reset();
    }
  });

  it("partitions a reassigned proxy slug by canonical project id", async () => {
    const oldProject = createScanAdapter([PAGE_FILE], null);
    const newProject = createScanAdapter([], null);
    const proxyContext = {
      projectSlug: "reassigned-slug",
      isProxyMode: true,
      requestContext: { token: "", slug: "reassigned-slug", branch: "main", mode: "preview" },
    } as Partial<HandlerContext>;

    try {
      reset();

      const oldCandidates = await extractProjectCandidates(
        makeCtx(oldProject.adapter, { ...proxyContext, projectId: "project-old" }),
      );
      const newCandidates = await extractProjectCandidates(
        makeCtx(newProject.adapter, { ...proxyContext, projectId: "project-new" }),
      );

      assertEquals(oldCandidates.has("text-cyan-500"), true);
      assertEquals(newCandidates.has("text-cyan-500"), false);
      assertEquals(newProject.getScanCount(), 1);
    } finally {
      reset();
    }
  });

  it("does not repopulate the candidate manifest from an invalidated scan", async () => {
    const adapter = createMockAdapter();
    const contentContext = {
      sourceType: "branch",
      projectSlug: PROJECT_SLUG,
      branch: "main",
    } as ResolvedContentContext;
    let currentFiles: Array<{ path: string; content?: string }> = [];
    let scanCount = 0;
    let settleFirst!: (files: Array<{ path: string; content?: string }>) => void;
    const firstFiles = new Promise<Array<{ path: string; content?: string }>>((resolve) => {
      settleFirst = resolve;
    });
    const controlledAdapter = {
      ...adapter,
      fs: {
        ...adapter.fs,
        getUnderlyingAdapter: () => ({
          getAllSourceFiles: () => {
            scanCount++;
            return scanCount === 1 ? firstFiles : Promise.resolve(currentFiles);
          },
          getContentContext: () => contentContext,
        }),
      },
    } as unknown as RuntimeAdapter;
    const ctx = makeCtx(controlledAdapter);

    try {
      reset();
      const staleScan = extractProjectCandidates(ctx);
      reset();
      currentFiles = [];
      settleFirst([PAGE_FILE]);

      assertEquals((await staleScan).has("text-cyan-500"), true);
      assertEquals((await extractProjectCandidates(ctx)).has("text-cyan-500"), false);
      assertEquals(scanCount, 2);
    } finally {
      reset();
    }
  });

  it("evicts the least recently used scan instead of growing without bound", async () => {
    try {
      reset();

      const first = createScanAdapter([PAGE_FILE], releaseContent("rel-evicted"));
      assertEquals(
        (await extractProjectCandidates(makeCtx(first.adapter))).has("text-cyan-500"),
        true,
      );
      assertEquals(first.getScanCount(), 1);

      for (let i = 0; i < 220; i++) {
        const filler = createScanAdapter(
          [{ path: "/project/app/empty.ts", content: "export {};\n" }],
          releaseContent(`rel-filler-${i}`),
        );
        await extractProjectCandidates(makeCtx(filler.adapter));
      }

      const stats = getCacheStats().find(
        (cache) => cache.name === "styles-project-candidate-scans",
      );
      assertEquals(stats?.maxEntries, 200);
      assertEquals(
        (stats?.entries ?? 0) <= 200,
        true,
        `candidate scan cache grew past its ceiling: ${stats?.entries}`,
      );

      assertEquals(
        (await extractProjectCandidates(makeCtx(first.adapter))).has("text-cyan-500"),
        true,
      );
      assertEquals(
        first.getScanCount(),
        2,
        "the least recently used scan should have been evicted",
      );
    } finally {
      reset();
    }
  });

  it("keeps a hot entry cached while colder entries are evicted", async () => {
    // Eviction by insertion order alone would drop the hottest long-lived
    // entries first, exactly under the sustained load this memo absorbs.
    try {
      reset();

      const hot = createScanAdapter([PAGE_FILE], releaseContent("rel-hot"));
      const hotCtx = makeCtx(hot.adapter);
      assertEquals((await extractProjectCandidates(hotCtx)).has("text-cyan-500"), true);

      for (let i = 0; i < 220; i++) {
        const filler = createScanAdapter(
          [{ path: "/project/app/empty.ts", content: "export {};\n" }],
          releaseContent(`rel-lru-filler-${i}`),
        );
        await extractProjectCandidates(makeCtx(filler.adapter));
        // Keep the hot entry in use while colder entries keep arriving.
        await extractProjectCandidates(hotCtx);
      }

      assertEquals(
        hot.getScanCount(),
        1,
        "an entry used on every request must not be evicted ahead of colder ones",
      );
    } finally {
      reset();
    }
  });
});
