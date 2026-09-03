/**
 * Real-filesystem CSS import scanning for the public stylesheet route.
 *
 * When the adapter exposes no underlying source-file provider, the scanner
 * falls back to walking `ctx.projectDir` on disk. That fallback needs a real
 * directory tree, so this case lives here rather than beside the hermetic unit
 * cases in src/server/handlers/dev/styles-css-import-scanner.test.ts.
 *
 * The behaviour under test is the security property the memoization exists for:
 * a content-less filesystem serves `ctx.projectDir` whatever the client claims,
 * so the cache identity must be that directory and never a request selector
 * such as `x-release-id`. Otherwise an unauthenticated caller mints a fresh key
 * per request and forces one full source walk each time.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { join } from "#veryfront/compat/path";
import { mkdir, readTextFile, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { normalizePath } from "#veryfront/utils/path-utils.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { HandlerContext } from "#veryfront/server/handlers/types.ts";
import {
  extractProjectCssImports,
  invalidateProjectCssImportScans,
} from "#veryfront/server/handlers/dev/styles-css-import-scanner.ts";

const PROJECT_SLUG = "css-import-scan-real-fs";

function makeCtx(
  adapter: RuntimeAdapter,
  overrides: Partial<HandlerContext> = {},
): HandlerContext {
  return {
    projectDir: "/project",
    adapter,
    securityConfig: null,
    projectSlug: PROJECT_SLUG,
    ...overrides,
  } as HandlerContext;
}

describe("server/handlers/dev/styles-css-import-scanner (real filesystem)", () => {
  it("keys a content-less filesystem on the local project directory", async () => {
    await withTempDir(async (projectDir) => {
      await mkdir(join(projectDir, "app"), { recursive: true });
      await writeTextFile(
        join(projectDir, "app", "layout.tsx"),
        'import "./styles.css";\n',
      );

      // No getUnderlyingAdapter, so the scanner takes the local-walk fallback.
      const mock = createMockAdapter();
      let reads = 0;
      const adapter = {
        ...mock,
        fs: {
          ...mock.fs,
          readFile: (path: string) => {
            reads++;
            return readTextFile(path);
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
      }
    }, { prefix: "styles-css-import-scan-" });
  });
});
