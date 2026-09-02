import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
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
});
