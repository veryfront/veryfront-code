/**
 * Preview MDX renders that import a stale compiled ESM module must flush the
 * cached artifact and retry once. The purge is observable only on a real cache
 * directory, so this case lives with the integration suites rather than beside
 * the hermetic rendering units.
 */

import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import { exists, mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { EntityInfo } from "#veryfront/types";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import {
  __resetStaleMdxEsmRecoveryStateForTests,
  handleMDXPage,
} from "#veryfront/rendering/page-rendering.ts";
import {
  __setServerModuleLoaderForTests,
  resetReactCache,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import {
  clearModulePathCache,
  getMdxEsmSsrCacheDir,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";

function createMDXPageInfo(content: string): EntityInfo {
  return {
    entity: {
      id: "page-1",
      path: "/project/pages/probe.mdx",
      slug: "probe",
      type: "page",
      content,
      frontmatter: {},
      kind: "mdx",
      isPage: true,
      isLayout: false,
      isComponent: false,
    },
  };
}

describe("rendering/page-rendering preview ESM cache recovery", () => {
  afterEach(() => {
    resetReactCache();
    __setServerModuleLoaderForTests(null);
    __resetStaleMdxEsmRecoveryStateForTests();
  });

  it("refreshes preview caches and retries once when MDX ESM imports have stale exports", async () => {
    const pageInfo = createMDXPageInfo("# MDX Probe");
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    let loadAttempts = 0;
    let sourceRefreshes = 0;

    const adapter = {
      id: "deno",
      name: "test",
      capabilities: {
        typescript: true,
        jsx: true,
        http2: false,
        websocket: false,
        workers: false,
        fileWatching: false,
        shell: false,
        kvStore: false,
        writableFs: true,
      },
      fs: {
        refreshSourceSnapshot: () => {
          sourceRefreshes++;
          return Promise.resolve();
        },
      },
      env: {},
      server: {},
      serve: () => Promise.reject(new Error("not used")),
    } as unknown as RuntimeAdapter;

    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };

    mutableRenderer.loadModuleESM = () => {
      loadAttempts++;
      if (loadAttempts === 1) {
        throw new Error(
          "The requested module 'file:///cache/vfmod.mjs' does not provide an export named 'default'",
        );
      }

      return Promise.resolve({
        default: () => null,
      });
    };

    const cacheBase = await makeTempDir({ prefix: "vf-page-rendering-stale-esm-" });

    try {
      await runWithCacheDir(cacheBase, async () => {
        // Seed the very cache that holds the stale compiled module, so the
        // retry cannot be satisfied by the source-snapshot refresh alone.
        const namespaceDir = getMdxEsmSsrCacheDir("project-1", "preview-main");
        const staleModulePath = join(namespaceDir, "stale.mjs");
        await mkdir(namespaceDir, { recursive: true });
        await writeTextFile(staleModulePath, "export default function Stale() {}");

        await handleMDXPage(
          pageInfo,
          "probe",
          "/project",
          {},
          () => Promise.resolve({ compiledCode: "", frontmatter: {}, headings: [] }),
          adapter,
          {
            projectId: "project-1",
            projectSlug: "project-slug",
            contentSourceId: "preview-main",
            studioEmbed: true,
          },
        );

        assertEquals(loadAttempts, 2, "the render must be retried exactly once");
        assertEquals(sourceRefreshes, 1, "the preview source snapshot must be flushed once");
        assertEquals(
          await exists(staleModulePath),
          false,
          "the stale compiled ESM module must be purged from the project's cache namespace before the retry",
        );
      });
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
      clearModulePathCache();
      await remove(cacheBase, { recursive: true });
    }
  });
});
