import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { getCacheStats } from "#veryfront/utils/memory/index.ts";
import { normalizePath } from "#veryfront/utils/path-utils.ts";
import { join } from "#veryfront/compat/path/index.ts";
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

  const underlyingAdapter = {
    getAllSourceFiles: async () => {
      scanCount++;
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

  it("keys a content-less filesystem on the local project directory", async () => {
    // No underlying adapter at all: the scan walks ctx.projectDir from disk, so
    // that directory — not anything the request asked for — is the identity.
    const projectDir = Deno.makeTempDirSync();
    Deno.mkdirSync(join(projectDir, "app"));
    Deno.writeTextFileSync(join(projectDir, "app", "layout.tsx"), 'import "./styles.css";\n');

    const mock = createMockAdapter();
    let reads = 0;
    const adapter = {
      ...mock,
      fs: {
        ...mock.fs,
        readFile: (path: string) => {
          reads++;
          return Deno.readTextFile(path);
        },
      },
    } as unknown as RuntimeAdapter;

    try {
      invalidateProjectCssImportScans();

      const first = await extractProjectCssImports(
        makeCtx(adapter, { projectDir, releaseId: "rel-a" } as Partial<HandlerContext>),
      );
      assertEquals(first, [normalizePath(join(projectDir, "app", "styles.css"))]);
      assertEquals(reads, 1);

      await extractProjectCssImports(
        makeCtx(adapter, { projectDir, releaseId: "rel-b" } as Partial<HandlerContext>),
      );
      assertEquals(reads, 1, "a different claimed release must not re-walk the same directory");
    } finally {
      invalidateProjectCssImportScans();
      Deno.removeSync(projectDir, { recursive: true });
    }
  });

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
