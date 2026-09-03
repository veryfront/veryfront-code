import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import type { HandlerContext } from "#veryfront/server/handlers/types.ts";
import { invalidateProjectCandidateManifests } from "#veryfront/rendering/orchestrator/css-candidate-manifest.ts";
import {
  extractProjectCandidates,
  invalidateProjectCandidateScans,
} from "#veryfront/server/handlers/dev/styles-candidate-scanner.ts";
import {
  extractProjectCssImports,
  invalidateProjectCssImportScans,
} from "#veryfront/server/handlers/dev/styles-css-import-scanner.ts";
import { createServerStyleInvalidationCallbacks } from "./style-callbacks.ts";

const PROJECT_SLUG = "style-callback-project";
const LAYOUT_FILE = {
  path: "/project/app/layout.tsx",
  content: 'import "./styles.css";\nexport default ({ children }) => children;',
};
const PAGE_FILE = {
  path: "/project/app/page.tsx",
  content: '<div className="text-cyan-500">Hi</div>',
};

describe("server/style-callbacks", () => {
  it("drops the project's cached CSS import scan when its style caches are cleared", async () => {
    // The scan is memoized under an immutable release key, so nothing but this
    // callback can retire it — a content push that forgot to reach the scanner
    // would keep serving the previous release's module CSS imports forever.
    const adapter = createMockAdapter();
    let files: Array<{ path: string; content: string }> = [LAYOUT_FILE];
    let scanCount = 0;
    const underlyingAdapter = {
      getAllSourceFiles: () => {
        scanCount++;
        return Promise.resolve(files);
      },
      getContentContext: (): ResolvedContentContext =>
        ({
          sourceType: "release",
          projectSlug: PROJECT_SLUG,
          releaseId: "rel-callback",
        }) as ResolvedContentContext,
    };
    const ctx = {
      projectDir: "/project",
      adapter: {
        ...adapter,
        fs: { ...adapter.fs, getUnderlyingAdapter: () => underlyingAdapter },
      },
      securityConfig: null,
      projectSlug: PROJECT_SLUG,
    } as unknown as HandlerContext;

    try {
      invalidateProjectCssImportScans();

      assertEquals(await extractProjectCssImports(ctx), ["/project/app/styles.css"]);
      assertEquals(scanCount, 1);

      files = [];
      createServerStyleInvalidationCallbacks().clearProjectCSSCache?.(PROJECT_SLUG);

      assertEquals(await extractProjectCssImports(ctx), []);
      assertEquals(scanCount, 2, "clearing the project's style caches must retire the scan");
    } finally {
      invalidateProjectCssImportScans();
    }
  });

  it("leaves other projects' cached scans intact", async () => {
    const adapter = createMockAdapter();
    let scanCount = 0;
    const underlyingAdapter = {
      getAllSourceFiles: () => {
        scanCount++;
        return Promise.resolve([LAYOUT_FILE]);
      },
      getContentContext: (): ResolvedContentContext =>
        ({
          sourceType: "release",
          projectSlug: PROJECT_SLUG,
          releaseId: "rel-untouched",
        }) as ResolvedContentContext,
    };
    const ctx = {
      projectDir: "/project",
      adapter: {
        ...adapter,
        fs: { ...adapter.fs, getUnderlyingAdapter: () => underlyingAdapter },
      },
      securityConfig: null,
      projectSlug: PROJECT_SLUG,
    } as unknown as HandlerContext;

    try {
      invalidateProjectCssImportScans();

      assertEquals(await extractProjectCssImports(ctx), ["/project/app/styles.css"]);
      createServerStyleInvalidationCallbacks().clearProjectCSSCache?.("some-other-project");

      assertEquals(await extractProjectCssImports(ctx), ["/project/app/styles.css"]);
      assertEquals(scanCount, 1, "an unrelated project's push must not evict this scan");
    } finally {
      invalidateProjectCssImportScans();
    }
  });

  it("drops the project's cached candidate scan when its style caches are cleared", async () => {
    // The candidate scan is memoized under the same immutable release key, so
    // a content push that reached only the manifest would keep serving the
    // previous release's Tailwind candidates until the entry was evicted.
    const adapter = createMockAdapter();
    let files: Array<{ path: string; content: string }> = [PAGE_FILE];
    let scanCount = 0;
    const underlyingAdapter = {
      getAllSourceFiles: () => {
        scanCount++;
        return Promise.resolve(files);
      },
      getContentContext: (): ResolvedContentContext =>
        ({
          sourceType: "release",
          projectSlug: PROJECT_SLUG,
          releaseId: "rel-candidates",
        }) as ResolvedContentContext,
    };
    const ctx = {
      projectDir: "/project",
      adapter: {
        ...adapter,
        fs: { ...adapter.fs, getUnderlyingAdapter: () => underlyingAdapter },
      },
      securityConfig: null,
      projectSlug: PROJECT_SLUG,
    } as unknown as HandlerContext;

    try {
      invalidateProjectCandidateScans();
      invalidateProjectCandidateManifests();

      assertEquals((await extractProjectCandidates(ctx)).has("text-cyan-500"), true);
      assertEquals(scanCount, 1);

      files = [];
      createServerStyleInvalidationCallbacks().clearProjectCSSCache?.(PROJECT_SLUG);

      assertEquals((await extractProjectCandidates(ctx)).has("text-cyan-500"), false);
      assertEquals(scanCount, 2, "clearing the project's style caches must retire the scan");
    } finally {
      invalidateProjectCandidateScans();
      invalidateProjectCandidateManifests();
    }
  });
});
